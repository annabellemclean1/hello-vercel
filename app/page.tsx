'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { User, AuthChangeEvent, Session } from '@supabase/supabase-js';

/**
 * Assignment #5: Image Upload + Caption Pipeline
 * - Added handleUpload: 4-step pipeline (presigned URL → S3 upload → register → generate captions)
 * - New captions from upload are prepended to the gallery and shown immediately
 * - All existing voting functionality preserved
 */

interface CaptionRow {
  id: string;
  content: string;
  images: {
    id: string;
    url: string;
    image_description: string;
  } | null;
}

// Upload step labels shown in the UI during processing
const UPLOAD_STEPS = [
  'Generating upload URL...',
  'Uploading image...',
  'Registering image...',
  'Generating captions...',
];

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [captions, setCaptions] = useState<CaptionRow[]>([]);
  const [userVotes, setUserVotes] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [votingId, setVotingId] = useState<string | null>(null);

  // Upload state
  const [uploadStep, setUploadStep] = useState<number | null>(null); // null = idle
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const currentUser = session?.user ?? null;
        setUser(currentUser);
        if (currentUser) {
          fetchData(currentUser.id);
        } else {
          setLoading(false);
        }
      } catch (err) {
        setLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        const newUser = session?.user ?? null;
        setUser(prev => {
          if (prev?.id === newUser?.id) return prev;
          if (newUser) {
            fetchData(newUser.id);
          } else {
            setCaptions([]);
            setUserVotes({});
            setLoading(false);
          }
          return newUser;
        });
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const spreadByImage = (items: CaptionRow[]): CaptionRow[] => {
    const result: CaptionRow[] = [];
    const buckets = new Map<string, CaptionRow[]>();

    // Group captions by image ID
    items.forEach(item => {
      const key = item.images?.id ?? 'unknown';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(item);
    });

    // Round-robin across image groups so same image never appears adjacent
    const groups = Array.from(buckets.values());
    let i = 0;
    while (result.length < items.length) {
      const group = groups[i % groups.length];
      if (group.length > 0) result.push(group.shift()!);
      i++;
    }
    return result;
  };

  const fetchData = async (userId: string) => {
    setLoading(true);
    try {
      const [
        { data: captionData, error: captionError },
        { data: voteData, error: voteError }
      ] = await Promise.all([
        supabase
          .from('captions')
          .select('id, content, images(id, url, image_description)')
          .eq('is_public', true),
        supabase
          .from('caption_votes')
          .select('caption_id, vote_value')
          .eq('profile_id', userId)
      ]);

      if (captionError) throw captionError;
      if (voteError) throw voteError;

      const voteMap: Record<string, number> = {};
      voteData?.forEach(v => {
        voteMap[v.caption_id] = v.vote_value;
      });

      setCaptions(spreadByImage((captionData as unknown as CaptionRow[]) || []));
      setUserVotes(voteMap);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (captionId: string, direction: 'up' | 'down') => {
    if (!user) return;

    const newValue = direction === 'up' ? 1 : -1;
    const previousValue = userVotes[captionId];

    setUserVotes(prev => ({ ...prev, [captionId]: newValue }));
    setVotingId(captionId);

    try {
      const { error: voteError } = await supabase
        .from('caption_votes')
        .upsert([
          {
            caption_id: captionId,
            profile_id: user.id,
            vote_value: newValue,
            created_datetime_utc: new Date().toISOString(),
            modified_datetime_utc: new Date().toISOString()
          }
        ], { onConflict: 'profile_id,caption_id' });

      if (voteError) throw voteError;
    } catch (err: any) {
      setUserVotes(prev => ({ ...prev, [captionId]: previousValue }));
      setError(err.message);
    } finally {
      setVotingId(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
  };

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !user) return;

    // Get the JWT token for API auth
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setError('Not authenticated. Please sign in again.');
      return;
    }

    const API = 'https://api.almostcrackd.ai';
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    try {
      // Step 1: Generate presigned URL
      setUploadStep(0);
      const presignRes = await fetch(`${API}/pipeline/generate-presigned-url`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ contentType: file.type }),
      });
      if (!presignRes.ok) throw new Error('Failed to generate upload URL');
      const { presignedUrl, cdnUrl } = await presignRes.json();

      // Step 2: Upload image bytes directly to S3
      setUploadStep(1);
      const uploadRes = await fetch(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error('Failed to upload image');

      // Step 3: Register image URL in the pipeline
      setUploadStep(2);
      const registerRes = await fetch(`${API}/pipeline/upload-image-from-url`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ imageUrl: cdnUrl, isCommonUse: false }),
      });
      if (!registerRes.ok) throw new Error('Failed to register image');
      const { imageId } = await registerRes.json();

      // Step 4: Generate captions
      setUploadStep(3);
      const captionRes = await fetch(`${API}/pipeline/generate-captions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ imageId }),
      });
      if (!captionRes.ok) throw new Error('Failed to generate captions');
      const newCaptionData = await captionRes.json();

      // Prepend new captions to the gallery so they appear immediately
      const newCaptions: CaptionRow[] = (Array.isArray(newCaptionData) ? newCaptionData : [newCaptionData])
        .map((c: any) => ({
          id: c.id,
          content: c.content,
          images: {
            id: imageId,
            url: cdnUrl,
            image_description: c.image_description ?? '',
          },
        }));

      setCaptions(prev => spreadByImage([...newCaptions, ...prev]));

      // Reset upload UI
      setPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploadStep(null);
    }
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f5f0e8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", color: '#7a6f63' }}>
      Loading...
    </div>
  );

  const isUploading = uploadStep !== null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=DM+Sans:wght@300;400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: #f5f0e8; }
        .card { transition: transform 0.2s, box-shadow 0.2s; }
        .card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(26,20,16,0.12) !important; }
        .btn-vote { transition: all 0.15s; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-vote.up:hover { background: #edf7f1 !important; border-color: #2d7a4f !important; color: #2d7a4f !important; }
        .btn-vote.up.active { background: #2d7a4f !important; border-color: #2d7a4f !important; color: white !important; }
        .btn-vote.down:hover { background: #fdf0ec !important; border-color: #c8502a !important; color: #c8502a !important; }
        .btn-vote.down.active { background: #c8502a !important; border-color: #c8502a !important; color: white !important; }
        .btn-generate { transition: background 0.2s, transform 0.1s; }
        .btn-generate:hover:not(:disabled) { background: #c8502a !important; transform: translateY(-1px); }
        .signout-btn { transition: all 0.2s; }
        .signout-btn:hover { border-color: #c8502a !important; color: #c8502a !important; }
        .file-zone { transition: border-color 0.2s, color 0.2s; }
        .file-zone:hover { border-color: #c8502a !important; color: #1a1410 !important; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .card-anim { animation: fadeUp 0.4s ease both; }
      `}</style>

      <main style={{ minHeight: '100vh', background: '#f5f0e8', fontFamily: "'DM Sans', sans-serif", color: '#1a1410', padding: '0 2rem 4rem' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>

          {/* Header */}
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2rem 0 1.5rem', borderBottom: '1px solid #e0d8cc', marginBottom: '2.5rem' }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: '1.8rem', fontWeight: 900, letterSpacing: '-0.02em', color: '#1a1410' }}>
              Kinda <span style={{ color: '#c8502a' }}>Crackd</span>
            </div>
            {!user ? (
              <button
                onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })}
                style={{ background: '#1a1410', color: '#f5f0e8', border: 'none', padding: '0.6rem 1.4rem', borderRadius: 99, fontFamily: "'DM Sans', sans-serif", fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer', letterSpacing: '0.03em' }}
              >
                Sign In
              </button>
            ) : (
              <button
                className="signout-btn"
                onClick={() => supabase.auth.signOut()}
                style={{ fontSize: '0.8rem', fontWeight: 500, color: '#7a6f63', background: 'none', border: '1px solid #e0d8cc', padding: '0.4rem 1rem', borderRadius: 99, cursor: 'pointer', letterSpacing: '0.03em', textTransform: 'uppercase' }}
              >
                Sign Out
              </button>
            )}
          </header>

          {!user ? (
            <div style={{ minHeight: 'calc(100vh - 90px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '4rem 2rem', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
                {[
                  { text: `"You're about as useful as a penguin in a desert."`, style: { top: '8%', left: '-8%' } },
                  { text: `"When the mural's more lit than your Zoom class."`, style: { top: '14%', right: '-10%' } },
                  { text: `"POV: you just remembered you have a 9am tomorrow."`, style: { bottom: '18%', left: '-10%' } },
                  { text: `"Main character syndrome activated."`, style: { bottom: '12%', right: '-6%' } },
                  { text: `"Monday energy, Friday expectations."`, style: { top: '48%', left: '-9%' } },
                  { text: `"I've seen better resilience from a sleep-deprived sloth."`, style: { top: '42%', right: '-12%' } },
                ].map((f, i) => (
                  <div key={i} style={{ position: 'absolute', background: 'white', border: '1px solid #e0d8cc', borderRadius: 99, padding: '0.5rem 1.1rem', fontFamily: "'Playfair Display', serif", fontStyle: 'italic', fontSize: '0.8rem', color: '#7a6f63', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(26,20,16,0.06)', opacity: 0.75, ...f.style }}>
                    {f.text}
                  </div>
                ))}
              </div>
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#c8502a', marginBottom: '1.5rem' }}>
                  The Internet's Caption Arena
                </div>
                <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 'clamp(2.4rem, 6vw, 4.2rem)', fontWeight: 900, lineHeight: 1.1, letterSpacing: '-0.02em', color: '#1a1410', maxWidth: 760, marginBottom: '1.75rem' }}>
                  Upload an image.<br />
                  Get roasted by AI.<br />
                  Vote on what's <em style={{ fontStyle: 'italic', color: '#c8502a' }}>actually</em> funny.
                </h1>
                <p style={{ fontSize: '1rem', color: '#7a6f63', maxWidth: 480, lineHeight: 1.7, marginBottom: '2.5rem', textAlign: 'center' }}>
                  A gallery where every image gets a caption — and you decide which ones land.
                </p>
                <button
                  onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })}
                  style={{ background: '#1a1410', color: '#f5f0e8', border: 'none', padding: '0.9rem 2.2rem', borderRadius: 99, fontFamily: "'DM Sans', sans-serif", fontSize: '0.95rem', fontWeight: 500, cursor: 'pointer', letterSpacing: '0.03em', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '2rem' }}
                >
                  <span style={{ width: 18, height: 18, background: 'white', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#4285f4', flexShrink: 0 }}>G</span>
                  Continue with Google
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', width: '100%', maxWidth: 320 }}>
                  <div style={{ flex: 1, height: 1, background: '#e0d8cc' }} />
                  <span style={{ fontSize: '0.75rem', color: '#7a6f63' }}>what you get</span>
                  <div style={{ flex: 1, height: 1, background: '#e0d8cc' }} />
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {['↑ Upvote captions', '↓ Downvote captions', '+ Upload images', '✦ AI-generated captions'].map(label => (
                    <div key={label} style={{ background: 'white', border: '1px solid #e0d8cc', borderRadius: 99, padding: '0.35rem 0.9rem', fontSize: '0.75rem', color: '#7a6f63' }}>
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Upload Panel */}
              <div style={{ background: 'white', border: '1px solid #e0d8cc', borderRadius: 16, padding: '1.75rem 2rem', marginBottom: '3rem', display: 'flex', alignItems: 'center', gap: '1.5rem', boxShadow: '0 2px 12px rgba(26,20,16,0.05)', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: '1rem', fontWeight: 700, color: '#1a1410' }}>Upload an Image</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.72rem', color: '#7a6f63', marginTop: 2 }}>JPEG · PNG · WEBP · GIF · HEIC</div>
                </div>

                <div style={{ width: 1, height: 40, background: '#e0d8cc', flexShrink: 0 }} />

                <label className="file-zone" style={{ flex: 1, border: '1.5px dashed #e0d8cc', borderRadius: 10, padding: '0.75rem 1.25rem', fontSize: '0.85rem', color: '#7a6f63', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', minWidth: 180 }}>
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  {previewUrl ? 'File selected ✓' : 'Choose a file or drag it here'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/heic"
                    onChange={handleFileChange}
                    disabled={isUploading}
                    style={{ display: 'none' }}
                  />
                </label>

                {previewUrl && (
                  <img src={previewUrl} alt="Preview" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid #e0d8cc', flexShrink: 0 }} />
                )}

                <button
                  className="btn-generate"
                  onClick={handleUpload}
                  disabled={!previewUrl || isUploading}
                  style={{ background: '#1a1410', color: '#f5f0e8', border: 'none', padding: '0.7rem 1.5rem', borderRadius: 10, fontSize: '0.85rem', fontWeight: 500, cursor: !previewUrl || isUploading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.02em', opacity: !previewUrl || isUploading ? 0.4 : 1 }}
                >
                  {isUploading ? UPLOAD_STEPS[uploadStep!] : 'Generate Captions →'}
                </button>
              </div>

              {/* Progress steps */}
              {isUploading && (
                <div style={{ display: 'flex', gap: '1rem', marginTop: '-2rem', marginBottom: '2rem', paddingLeft: '0.5rem', flexWrap: 'wrap' }}>
                  {UPLOAD_STEPS.map((label, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: i < uploadStep! ? '#2d7a4f' : i === uploadStep ? '#c8502a' : '#e0d8cc' }} />
                      <span style={{ fontSize: '0.72rem', color: i === uploadStep ? '#c8502a' : i < uploadStep! ? '#2d7a4f' : '#b0a898', fontWeight: i === uploadStep ? 500 : 400 }}>{label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Section heading */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: '1.3rem', fontWeight: 700, color: '#1a1410', margin: 0 }}>Caption Gallery</h2>
                <span style={{ fontSize: '0.78rem', color: '#7a6f63' }}>{captions.length} captions</span>
              </div>

              {/* Gallery Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
                {captions.map((caption, idx) => {
                  const currentVote = userVotes[caption.id];
                  return (
                    <div
                      key={caption.id}
                      className="card card-anim"
                      style={{ background: 'white', border: '1px solid #e0d8cc', borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 8px rgba(26,20,16,0.06)', animationDelay: `${idx * 0.05}s` }}
                    >
                      <img
                        src={caption.images?.url}
                        alt={caption.images?.image_description}
                        style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }}
                      />
                      <div style={{ padding: '1rem 1.1rem 1.1rem' }}>
                        <p style={{ fontFamily: "'Playfair Display', serif", fontSize: '0.88rem', lineHeight: 1.55, color: '#1a1410', fontStyle: 'italic', margin: 0 }}>
                          <span style={{ color: '#c8502a' }}>"</span>{caption.content}<span style={{ color: '#c8502a' }}>"</span>
                        </p>

                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem', paddingTop: '0.9rem', borderTop: '1px solid #e0d8cc' }}>
                          <button
                            className={`btn-vote up${currentVote === 1 ? ' active' : ''}`}
                            disabled={votingId === caption.id}
                            onClick={() => handleVote(caption.id, 'up')}
                            style={{ flex: 1, padding: '0.45rem 0', borderRadius: 8, fontSize: '0.78rem', fontWeight: 500, border: '1.5px solid #e0d8cc', background: 'transparent', color: '#7a6f63', letterSpacing: '0.02em' }}
                          >
                            ▲ Upvote
                          </button>
                          <button
                            className={`btn-vote down${currentVote === -1 ? ' active' : ''}`}
                            disabled={votingId === caption.id}
                            onClick={() => handleVote(caption.id, 'down')}
                            style={{ flex: 1, padding: '0.45rem 0', borderRadius: 8, fontSize: '0.78rem', fontWeight: 500, border: '1.5px solid #e0d8cc', background: 'transparent', color: '#7a6f63', letterSpacing: '0.02em' }}
                          >
                            ▼ Downvote
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Error toast */}
          {error && (
            <div
              onClick={() => setError(null)}
              style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', background: '#fdf0ec', border: '1px solid #f5c5b0', color: '#c8502a', fontSize: '0.85rem', padding: '0.6rem 1rem', borderRadius: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', cursor: 'pointer' }}
            >
              {error} <span style={{ marginLeft: 8, opacity: 0.5 }}>✕</span>
            </div>
          )}
        </div>
      </main>
    </>
  );
}