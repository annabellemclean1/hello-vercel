'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { User, AuthChangeEvent, Session } from '@supabase/supabase-js';

/** * Assignment #4: Mutating Data (Rating/Voting)
 * Features:
 * - Original import structure maintained.
 * - Added handleVote to mutate 'caption_votes' table.
 * - Enforces authentication for voting.
 */
export default function Home() {
    const [user, setUser] = useState<User | null>(null);
    const [images, setImages] = useState<any[]>([]);
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
                const currentUser = session?.user ?? null;
                setUser(currentUser);
                if (currentUser) {
                    fetchData(currentUser.id);
                } else {
                    setImages([]);
                    setUserVotes({});
                    setLoading(false);
                }
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    const fetchData = async (userId: string) => {
        setLoading(true);
        try {
            const { data: imageData, error: fetchError } = await supabase
                .from('images')
                .select('*');

            if (fetchError) throw fetchError;

            const { data: voteData, error: voteError } = await supabase
                .from('caption_votes')
                .select('caption_id, vote_value')
                .eq('profile_id', userId);

            if (voteError) throw voteError;

            const voteMap: Record<string, number> = {};
            voteData?.forEach(v => {
                voteMap[v.caption_id] = v.vote_value;
            });

            setImages(imageData || []);
            setUserVotes(voteMap);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleVote = async (imageId: string, direction: 'up' | 'down') => {
        if (!user) return;

        const newValue = direction === 'up' ? 1 : -1;
        setVotingId(imageId);

        try {
            const { error: voteError } = await supabase
                .from('caption_votes')
                .upsert([
                    {
                        caption_id: imageId,
                        profile_id: user.id,
                        vote_value: newValue,
                        modified_datetime_utc: new Date().toISOString()
                    }
                ], { onConflict: 'profile_id,caption_id' });

            if (voteError) throw voteError;

            setUserVotes(prev => ({ ...prev, [imageId]: newValue }));
        } catch (err: any) {
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
                        <button onClick={handleLogin} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold">Sign In</button>
                    ) : (
                        <button onClick={() => supabase.auth.signOut()} className="text-sm text-red-500">Sign Out</button>
                    )}
                </header>

                {!user ? (
                    <div className="text-center py-20 border rounded-xl dark:border-zinc-800">
                        <p className="dark:text-zinc-400">Sign in to see images and vote.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {images.map((item) => {
                            const currentVote = userVotes[item.id];
                            return (
                                <div key={item.id} className="border rounded-xl bg-white dark:bg-zinc-900 dark:border-zinc-800 overflow-hidden shadow-sm">
                                    <img src={item.url} alt={item.title} className="aspect-video w-full object-cover" />
                                    <div className="p-4">
                                        <h3 className="font-bold truncate dark:text-white">{item.title}</h3>
                                        <p className="text-sm text-zinc-500 mt-1">{item.caption}</p>

                                        <div className="mt-4 flex gap-2 border-t pt-4 dark:border-zinc-800">
                                            <button
                                                disabled={votingId === item.id}
                                                onClick={() => handleVote(item.id, 'up')}
                                                className={`flex-1 py-1 rounded border transition-all duration-200 ${
                                                    currentVote === 1
                                                        ? 'bg-emerald-500 border-emerald-600 text-white shadow-inner' // Active State
                                                        : 'bg-transparent border-zinc-200 text-zinc-600 hover:bg-emerald-50 hover:border-emerald-300 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-emerald-950/30' // Neutral State
                                                }`}
                                            >
                                                ▲ Upvote
                                            </button>

                                            {/* DOWNVOTE BUTTON */}
                                            <button
                                                disabled={votingId === item.id}
                                                onClick={() => handleVote(item.id, 'down')}
                                                className={`flex-1 py-1 rounded border transition-all duration-200 ${
                                                    currentVote === -1
                                                        ? 'bg-orange-500 border-orange-600 text-white shadow-inner' // Active State
                                                        : 'bg-transparent border-zinc-200 text-zinc-600 hover:bg-orange-50 hover:border-orange-300 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-orange-950/30' // Neutral State
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
            </div>
        </main>
    );
}