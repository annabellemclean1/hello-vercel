'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { User, AuthChangeEvent, Session } from '@supabase/supabase-js';
import LoginButton from '@/components/LoginButton';

/**
 * Assignment #4: Mutating Data (Rating/Voting)
 * - Queries from captions as the primary unit, joining image data
 * - One caption per card; same image can appear multiple times with different captions
 * - Vote buttons keyed by caption ID
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

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [captions, setCaptions] = useState<CaptionRow[]>([]);
  const [userVotes, setUserVotes] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [votingId, setVotingId] = useState<string | null>(null);

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
          // Avoid double-fetching if the user hasn't changed
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

      setCaptions((captionData as unknown as CaptionRow[]) || []);
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

    // Optimistic update — reflect instantly, rollback if server fails
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
            created_datetime_utc: new Date().toISOString(),   // ← must be here
            modified_datetime_utc: new Date().toISOString()
          }
        ], { onConflict: 'profile_id,caption_id' });

      if (voteError) throw voteError;
    } catch (err: any) {
      // Rollback on failure
      setUserVotes(prev => ({ ...prev, [captionId]: previousValue }));
      setError(err.message);
    } finally {
      setVotingId(null);
    }
  };

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}` },
    });
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex justify-between items-center border-b pb-6 dark:border-zinc-800">
          <h1 className="text-2xl font-bold dark:text-white">Gallery</h1>
          {!user ? (
            <LoginButton />
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
        )}

        {error && (
          <div className="fixed bottom-4 right-4 bg-red-100 border border-red-300 text-red-700 text-sm px-4 py-2 rounded-lg shadow">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}