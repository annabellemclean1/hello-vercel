'use client';

import { useEffect, useState, useCallback } from 'react';
// @ts-ignore: Using CDN import to bypass bundling restrictions in the preview environment
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

/**
 * Assignment #3 & #4: Gated Supabase Integration
 * Features:
 * 1. Data Source: Uses 'captions' and 'caption_votes' tables.
 * 2. Authentication: Gated UI requiring Google Auth.
 * 3. Voting Logic:
 * - UPSERT: Create/Update vote (+1 or -1).
 * - DELETE: Remove row if same button is clicked (Undo).
 * * NOTE: Using ESM CDN for createClient to ensure functionality in the preview environment.
 */

// Types normally imported from @supabase/supabase-js
type User = any;
type AuthChangeEvent = any;
type Session = any;

const getSupabaseClient = () => {
    try {
        // @ts-ignore: __firebase_config is a global provided at runtime
        if (typeof __firebase_config !== 'undefined') {
            // @ts-ignore
            const config = JSON.parse(__firebase_config);
            return createClient(
                `https://${config.projectId}.supabase.co`,
                "" // Key provided by the execution context
            );
        }
    } catch (e) {
        console.error("Configuration Error:", e);
    }
    return createClient('https://placeholder.supabase.co', 'placeholder');
};

const supabase = getSupabaseClient();

interface Caption {
    id: string;
    content: string;
    is_featured: boolean;
    created_datetime_utc: string;
}

interface Vote {
    caption_id: string;
    vote_value: number;
}

export default function App() {
    const [user, setUser] = useState<User | null>(null);
    const [captions, setCaptions] = useState<Caption[]>([]);
    const [userVotes, setUserVotes] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const fetchUserVotes = useCallback(async (userId: string) => {
        const { data, error: fetchError } = await supabase
            .from('caption_votes')
            .select('caption_id, vote_value')
            .eq('profile_id', userId);

        if (fetchError) {
            console.error('Error loading user votes:', fetchError.message);
            return;
        }

        const votesMap = (data as Vote[] || []).reduce((acc: Record<string, number>, vote: Vote) => {
            acc[vote.caption_id] = vote.vote_value;
            return acc;
        }, {});

        setUserVotes(votesMap);
    }, []);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
            .from('captions')
            .select('*');

        if (fetchError) {
            setError(fetchError.message);
            setLoading(false);
            return;
        }

        setCaptions(data as Caption[] || []);
        setLoading(false);
    }, []);

    useEffect(() => {
        const initAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            const currentUser = session?.user ?? null;
            setUser(currentUser);

            if (currentUser) {
                await fetchData();
                await fetchUserVotes(currentUser.id);
            } else {
                setLoading(false);
            }
        };

        void initAuth();

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (_event: AuthChangeEvent, session: Session | null) => {
                const currentUser = session?.user ?? null;
                setUser(currentUser);

                if (currentUser) {
                    await fetchData();
                    await fetchUserVotes(currentUser.id);
                } else {
                    setCaptions([]);
                    setUserVotes({});
                    setLoading(false);
                }
            }
        );

        return () => subscription.unsubscribe();
    }, [fetchData, fetchUserVotes]);

    const handleLogin = async () => {
        await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: typeof window !== 'undefined' ? window.location.origin : '',
            },
        });
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
    };

    const handleVote = async (captionId: string, value: number) => {
        if (!user) return;

        const existingVoteValue = userVotes[captionId];

        try {
            if (existingVoteValue === value) {
                const { error: deleteError } = await supabase
                    .from('caption_votes')
                    .delete()
                    .eq('caption_id', captionId)
                    .eq('profile_id', user.id);

                if (deleteError) {
                    setError(deleteError.message);
                    return;
                }

                setUserVotes((prev) => {
                    const newVotes = { ...prev };
                    delete newVotes[captionId];
                    return newVotes;
                });
                return;
            }

            const { error: upsertError } = await supabase
                .from('caption_votes')
                .upsert({
                    caption_id: captionId,
                    profile_id: user.id,
                    vote_value: value,
                    modified_datetime_utc: new Date().toISOString()
                }, {
                    onConflict: 'profile_id,caption_id'
                });

            if (upsertError) {
                setError(upsertError.message);
                return;
            }

            setUserVotes((prev) => ({
                ...prev,
                [captionId]: value
            }));
        } catch (err: any) {
            setError(err.message);
        }
    };

    if (loading) return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
            <div className="text-zinc-500 animate-pulse font-medium">Loading Gallery...</div>
        </div>
    );

    return (
        <main className="min-h-screen bg-zinc-50 px-6 py-12 dark:bg-zinc-950">
            <div className="mx-auto max-w-6xl">
                <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between border-b border-zinc-200 pb-8 dark:border-zinc-800">
                    <div>
                        <h1 className="text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">Supabase Gallery</h1>
                        <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">
                            {user ? `Signed in as ${user.email}` : 'Sign in to rate captions.'}
                        </p>
                    </div>
                    <div className="mt-6 md:mt-0">
                        {user ? (
                            <button onClick={handleLogout} className="text-sm font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 px-3 py-2 rounded-lg transition-colors">
                                Sign Out
                            </button>
                        ) : (
                            <button onClick={handleLogin} className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-6 py-3 text-sm font-bold text-zinc-50 shadow-lg transition-all hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900">
                                Sign in with Google
                            </button>
                        )}
                    </div>
                </div>

                {!user ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-sm text-center">
                        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Protected Content</h2>
                        <p className="mt-2 text-zinc-500">Log in to interact with the database.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                        {captions.map((item) => {
                            const currentVote = userVotes[item.id];
                            return (
                                <div key={item.id} className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 transition-all hover:border-zinc-300 dark:hover:border-zinc-700">
                                    <div className="p-6">
                                        <div className="mb-4 flex items-center justify-between">
                                            <span className="text-[10px] font-bold uppercase text-zinc-400">ID: {item.id.slice(0, 8)}</span>
                                            {item.is_featured && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">★ Featured</span>}
                                        </div>
                                        <p className="text-lg font-medium text-zinc-800 dark:text-zinc-200">"{item.content}"</p>
                                        <div className="mt-8 flex gap-2 border-t border-zinc-100 pt-5 dark:border-zinc-800">
                                            <button
                                                onClick={() => handleVote(item.id, 1)}
                                                className={`flex-1 rounded-lg py-2.5 text-xs font-bold transition-all ${currentVote === 1 ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 hover:bg-emerald-100'}`}
                                            >
                                                ▲ Upvote
                                            </button>
                                            <button
                                                onClick={() => handleVote(item.id, -1)}
                                                className={`flex-1 rounded-lg py-2.5 text-xs font-bold transition-all ${currentVote === -1 ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 hover:bg-rose-100'}`}
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
                {error && <div className="mt-8 rounded-lg bg-red-50 p-4 text-sm text-red-600 font-mono">Error: {error}</div>}
            </div>
        </main>
    );
}