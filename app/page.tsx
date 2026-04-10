'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { User, AuthChangeEvent, Session } from '@supabase/supabase-js';

interface CaptionRow {
  id: string;
  content: string;
  images: {
    id: string;
    url: string;
    image_description: string;
  } | null;
}

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
  const [uploadStep, setUploadStep] = useState<number | null>(null);
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
    items.forEach(item => {
      const key = item.images?.id ?? 'unknown';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(item);
    });
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
      voteData?.forEach(v => { voteMap[v.caption_id] = v.vote_value; });

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
        .upsert([{
          caption_id: captionId,
          profile_id: user.id,
          vote_value: newValue,
          created_by_user_id: user.id,
          modified_by_user_id: user.id,
        }], { onConflict: 'profile_id,caption_id' });
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

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setError('Not authenticated. Please sign in again.'); return; }

    const API = 'https://api.almostcrackd.ai';
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    try {
      setUploadStep(0);
      const presignRes = await fetch(`${API}/pipeline/generate-presigned-url`, {
        method: 'POST', headers, body: JSON.stringify({ contentType: file.type }),
      });
      if (!presignRes.ok) throw new Error('Failed to generate upload URL');
      const { presignedUrl, cdnUrl } = await presignRes.json();

      setUploadStep(1);
      const uploadRes = await fetch(presignedUrl, {
        method: 'PUT', headers: { 'Content-Type': file.type }, body: file,
      });
      if (!uploadRes.ok) throw new Error('Failed to upload image');

      setUploadStep(2);
      const registerRes = await fetch(`${API}/pipeline/upload-image-from-url`, {
        method: 'POST', headers, body: JSON.stringify({ imageUrl: cdnUrl, isCommonUse: false }),
      });
      if (!registerRes.ok) throw new Error('Failed to register image');
      const { imageId } = await registerRes.json();

      setUploadStep(3);
      const captionRes = await fetch(`${API}/pipeline/generate-captions`, {
        method: 'POST', headers, body: JSON.stringify({ imageId }),
      });
      if (!captionRes.ok) throw new Error('Failed to generate captions');
      const newCaptionData = await captionRes.json();

      const newCaptions: CaptionRow[] = (Array.isArray(newCaptionData) ? newCaptionData : [newCaptionData])
        .map((c: any) => ({
          id: c.id,
          content: c.content,
          images: { id: imageId, url: cdnUrl, image_description: c.image_description ?? '' },
        }));

      setCaptions(prev => [...newCaptions, ...spreadByImage(prev)]);
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
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=DM+Sans:wght@300;400;500;600&display=swap');
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

        .upload-drop-zone { transition: border-color 0.2s, background 0.2s; }
        .upload-drop-zone:hover { border-color: #c8502a !important; background: #fdf8f4 !important; }

        .signin-btn-main { transition: background 0.2s, transform 0.15s, box-shadow 0.2s; }
        .signin-btn-main:hover { background: #c8502a !important; transform: translateY(-2px); box-shadow: 0 6px 20px rgba(200,80,42,0.3) !important; }

        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .card-anim { animation: fadeUp 0.4s ease both; }
        .anim-1 { animation: fadeUp 0.5s ease 0.05s both; opacity: 0; }
        .anim-2 { animation: fadeUp 0.5s ease 0.15s both; opacity: 0; }
        .anim-3 { animation: fadeUp 0.5s ease 0.25s both; opacity: 0; }
        .anim-4 { animation: fadeUp 0.5s ease 0.35s both; opacity: 0; }
        .anim-5 { animation: fadeUp 0.5s ease 0.45s both; opacity: 0; }
      `}</style>

      <main style={{ minHeight: '100vh', background: '#f5f0e8', fontFamily: "'DM Sans', sans-serif", color: '#1a1410', padding: '0 2rem 4rem' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>

          {/* ── Header ── */}
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
            /* ── Sign-in / Landing state ── */
            <div style={{ maxWidth: 680, margin: '0 auto', padding: '3rem 0 5rem' }}>

              {/* What is this app */}
              <div className="anim-1" style={{ marginBottom: '2.5rem' }}>
                <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 900, lineHeight: 1.15, letterSpacing: '-0.02em', color: '#1a1410', margin: '0 0 1rem' }}>
                  AI-generated captions.<br />You decide what's funny.
                </h1>
                <p style={{ fontSize: '1rem', color: '#7a6f63', lineHeight: 1.75, margin: 0 }}>
                  Kinda Crackd is a caption voting app. Upload any image and our AI generates several captions for it. Then browse the gallery and vote on which captions actually land — and which ones fall flat.
                </p>
              </div>

              {/* How it works */}
              <div className="anim-2" style={{ background: 'white', border: '1px solid #e0d8cc', borderRadius: 14, padding: '1.5rem 1.75rem', marginBottom: '2rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#c8502a', marginBottom: '1rem' }}>How it works</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {[
                    { step: '1', label: 'Sign in with your Google account below' },
                    { step: '2', label: 'Upload an image — our AI generates captions for it automatically' },
                    { step: '3', label: 'Browse the gallery and upvote or downvote each caption' },
                  ].map(({ step, label }) => (
                    <div key={step} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.9rem' }}>
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#f5f0e8', border: '1.5px solid #e0d8cc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, color: '#c8502a', flexShrink: 0, marginTop: 1 }}>
                        {step}
                      </div>
                      <p style={{ fontSize: '0.9rem', color: '#1a1410', lineHeight: 1.5, margin: 0 }}>{label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sign-in CTA */}
              <div className="anim-3" style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '0.85rem', color: '#7a6f63', marginBottom: '1rem' }}>
                  Sign in to upload images and vote on captions.
                </p>
                <button
                  className="signin-btn-main"
                  onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })}
                  style={{ background: '#1a1410', color: '#f5f0e8', border: 'none', padding: '0.9rem 2.5rem', borderRadius: 12, fontFamily: "'DM Sans', sans-serif", fontSize: '1rem', fontWeight: 600, cursor: 'pointer', letterSpacing: '0.02em', display: 'inline-flex', alignItems: 'center', gap: '0.6rem' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.8 }}>
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </button>
              </div>
            </div>

          ) : (
            <>
              {/* ── Upload Section ── */}
              <section style={{ background: 'white', border: '1px solid #e0d8cc', borderRadius: 16, padding: '2rem 2.25rem', marginBottom: '3rem', boxShadow: '0 2px 12px rgba(26,20,16,0.05)' }}>

                {/* Section header */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: '1.3rem', fontWeight: 700, color: '#1a1410', margin: '0 0 0.35rem' }}>
                    Generate Captions for Your Image
                  </h2>
                  <p style={{ fontSize: '0.85rem', color: '#7a6f63', margin: 0, lineHeight: 1.6 }}>
                    Upload any photo and our AI will generate several captions for it. Your image and its captions will appear at the top of the gallery below.
                  </p>
                </div>

                <div style={{ height: 1, background: '#f0ebe3', marginBottom: '1.5rem' }} />

                {/* Drop zone */}
                <label
                  className="upload-drop-zone"
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', border: '2px dashed #e0d8cc', borderRadius: 12, padding: '2.5rem 1.5rem', cursor: 'pointer', background: previewUrl ? '#fdf8f4' : 'transparent', marginBottom: '1.25rem', textAlign: 'center' }}
                >
                  {previewUrl ? (
                    <>
                      <img src={previewUrl} alt="Preview" style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 8, border: '1px solid #e0d8cc' }} />
                      <span style={{ fontSize: '0.82rem', color: '#2d7a4f', fontWeight: 500 }}>✓ Image ready — click Generate below</span>
                      <span style={{ fontSize: '0.75rem', color: '#b0a898' }}>Click to choose a different image</span>
                    </>
                  ) : (
                    <>
                      <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="#b0a898" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                      <span style={{ fontSize: '0.9rem', color: '#7a6f63', fontWeight: 500 }}>Click to choose an image</span>
                      <span style={{ fontSize: '0.75rem', color: '#b0a898' }}>Supports JPEG, PNG, WEBP, GIF, HEIC</span>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/heic"
                    onChange={handleFileChange}
                    disabled={isUploading}
                    style={{ display: 'none' }}
                  />
                </label>

                {/* Generate button */}
                <button
                  className="btn-generate"
                  onClick={handleUpload}
                  disabled={!previewUrl || isUploading}
                  style={{ width: '100%', background: '#1a1410', color: '#f5f0e8', border: 'none', padding: '0.9rem', borderRadius: 10, fontSize: '0.95rem', fontWeight: 600, cursor: !previewUrl || isUploading ? 'not-allowed' : 'pointer', letterSpacing: '0.02em', opacity: !previewUrl || isUploading ? 0.4 : 1 }}
                >
                  {isUploading ? UPLOAD_STEPS[uploadStep!] : 'Generate Captions →'}
                </button>

                {/* Progress steps */}
                {isUploading && (
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                    {UPLOAD_STEPS.map((label, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: i < uploadStep! ? '#2d7a4f' : i === uploadStep ? '#c8502a' : '#e0d8cc' }} />
                        <span style={{ fontSize: '0.72rem', color: i === uploadStep ? '#c8502a' : i < uploadStep! ? '#2d7a4f' : '#b0a898', fontWeight: i === uploadStep ? 500 : 400 }}>{label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ── Gallery Section ── */}
              <section>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                  <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: '1.3rem', fontWeight: 700, color: '#1a1410', margin: 0 }}>
                    Caption Gallery
                  </h2>
                  <span style={{ fontSize: '0.78rem', color: '#7a6f63' }}>{captions.length} captions</span>
                </div>
                <p style={{ fontSize: '0.85rem', color: '#7a6f63', margin: '0 0 1.5rem', lineHeight: 1.6 }}>
                  Read each caption and vote — upvote the ones that made you laugh, downvote the ones that missed.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
                  {captions.map((caption, idx) => {
                    const currentVote = userVotes[caption.id];
                    return (
                      <div
                        key={caption.id}
                        className="card card-anim"
                        style={{ background: 'white', border: '1px solid #e0d8cc', borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 8px rgba(26,20,16,0.06)', animationDelay: `${Math.min(idx, 8) * 0.05}s` }}
                      >
                        <img
                          src={caption.images?.url}
                          alt={caption.images?.image_description}
                          style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }}
                        />
                        <div style={{ padding: '1.1rem 1.2rem 1.2rem' }}>
                          <p style={{ fontFamily: "'Playfair Display', serif", fontSize: '1rem', lineHeight: 1.6, color: '#1a1410', fontStyle: 'italic', margin: '0 0 1rem' }}>
                            <span style={{ color: '#c8502a' }}>"</span>{caption.content}<span style={{ color: '#c8502a' }}>"</span>
                          </p>
                          <div style={{ fontSize: '0.72rem', color: '#b0a898', marginBottom: '0.75rem' }}>
                            Vote for this caption:
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              className={`btn-vote up${currentVote === 1 ? ' active' : ''}`}
                              disabled={votingId === caption.id}
                              onClick={() => handleVote(caption.id, 'up')}
                              style={{ flex: 1, padding: '0.55rem 0', borderRadius: 8, fontSize: '0.82rem', fontWeight: 500, border: '1.5px solid #e0d8cc', background: 'transparent', color: '#7a6f63', letterSpacing: '0.02em' }}
                            >
                              ▲ Funny
                            </button>
                            <button
                              className={`btn-vote down${currentVote === -1 ? ' active' : ''}`}
                              disabled={votingId === caption.id}
                              onClick={() => handleVote(caption.id, 'down')}
                              style={{ flex: 1, padding: '0.55rem 0', borderRadius: 8, fontSize: '0.82rem', fontWeight: 500, border: '1.5px solid #e0d8cc', background: 'transparent', color: '#7a6f63', letterSpacing: '0.02em' }}
                            >
                              ▼ Not funny
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}

          {/* Error toast */}
          {error && (
            <div
              onClick={() => setError(null)}
              style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', background: '#fdf0ec', border: '1px solid #f5c5b0', color: '#c8502a', fontSize: '0.85rem', padding: '0.6rem 1rem', borderRadius: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', cursor: 'pointer', zIndex: 100 }}
            >
              {error} <span style={{ marginLeft: 8, opacity: 0.5 }}>✕</span>
            </div>
          )}
        </div>
      </main>
    </>
  );
}