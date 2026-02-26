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

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  const isUploading = uploadStep !== null;

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-8">
      <div className="mx-auto max-w-6xl">

        {/* Header */}
        <header className="mb-8 flex justify-between items-center border-b pb-6 dark:border-zinc-800">
          <h1 className="text-2xl font-bold dark:text-white">Gallery</h1>
          {!user ? (
            <button
              onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold"
            >
              Sign In
            </button>
          ) : (
            <button onClick={() => supabase.auth.signOut()} className="text-sm text-red-500">
              Sign Out
            </button>
          )}
        </header>

        {!user ? (
          <div className="text-center py-20 border rounded-xl dark:border-zinc-800">
            <p className="dark:text-zinc-400">Sign in to see images and vote.</p>
          </div>
        ) : (
          <>
            {/* Upload Panel */}
            <div className="mb-8 border rounded-xl bg-white dark:bg-zinc-900 dark:border-zinc-800 p-6">
              <h2 className="font-bold text-sm uppercase tracking-wide text-zinc-400 mb-4">Upload an Image</h2>

              <div className="flex flex-col sm:flex-row gap-4 items-start">
                {/* File picker */}
                <div className="flex-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/heic"
                    onChange={handleFileChange}
                    disabled={isUploading}
                    className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200 dark:file:bg-zinc-800 dark:file:text-zinc-300"
                  />
                  <p className="mt-1 text-xs text-zinc-400">Supported: JPEG, PNG, WEBP, GIF, HEIC</p>
                </div>

                {/* Preview */}
                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="w-24 h-24 object-cover rounded-lg border dark:border-zinc-700"
                  />
                )}

                {/* Upload button */}
                <button
                  onClick={handleUpload}
                  disabled={!previewUrl || isUploading}
                  className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors whitespace-nowrap"
                >
                  {isUploading ? UPLOAD_STEPS[uploadStep!] : 'Generate Captions'}
                </button>
              </div>

              {/* Progress steps */}
              {isUploading && (
                <div className="mt-4 flex gap-2">
                  {UPLOAD_STEPS.map((label, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <div className={`w-2 h-2 rounded-full ${i < uploadStep! ? 'bg-emerald-500' : i === uploadStep ? 'bg-blue-500 animate-pulse' : 'bg-zinc-300 dark:bg-zinc-600'}`} />
                      <span className={`text-xs ${i === uploadStep ? 'text-blue-500 font-medium' : i < uploadStep! ? 'text-emerald-500' : 'text-zinc-400'}`}>{label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Gallery */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {captions.map((caption) => {
                const currentVote = userVotes[caption.id];
                return (
                  <div
                    key={caption.id}
                    className="border rounded-xl bg-white dark:bg-zinc-900 dark:border-zinc-800 overflow-hidden shadow-sm"
                  >
                    <img
                      src={caption.images?.url}
                      alt={caption.images?.image_description}
                      className="aspect-video w-full object-cover"
                    />
                    <div className="p-4">
                      <p className="text-sm text-zinc-500">{caption.content}</p>

                      <div className="mt-4 flex gap-2 border-t pt-4 dark:border-zinc-800">
                        {/* UPVOTE BUTTON */}
                        <button
                          disabled={votingId === caption.id}
                          onClick={() => handleVote(caption.id, 'up')}
                          className={`flex-1 py-1 rounded border transition-all duration-200 ${
                            currentVote === 1
                              ? 'bg-emerald-500 border-emerald-600 text-white shadow-inner'
                              : 'bg-transparent border-zinc-200 text-zinc-600 hover:bg-emerald-50 hover:border-emerald-300 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-emerald-950/30'
                          }`}
                        >
                          ▲ Upvote
                        </button>

                        {/* DOWNVOTE BUTTON */}
                        <button
                          disabled={votingId === caption.id}
                          onClick={() => handleVote(caption.id, 'down')}
                          className={`flex-1 py-1 rounded border transition-all duration-200 ${
                            currentVote === -1
                              ? 'bg-orange-500 border-orange-600 text-white shadow-inner'
                              : 'bg-transparent border-zinc-200 text-zinc-600 hover:bg-orange-50 hover:border-orange-300 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-orange-950/30'
                          }`}
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
            className="fixed bottom-4 right-4 bg-red-100 border border-red-300 text-red-700 text-sm px-4 py-2 rounded-lg shadow cursor-pointer"
          >
            {error} <span className="ml-2 opacity-50">✕</span>
          </div>
        )}
      </div>
    </main>
  );
}