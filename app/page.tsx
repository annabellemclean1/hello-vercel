'use client';

import { useEffect, useState, useCallback } from 'react';
// @ts-ignore: Using CDN import for preview environment compatibility.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

/**
 * Assignment #3 & #4: Gated Supabase Integration
 * * CORE FUNCTIONALITY:
 * 1. Data Source: Exclusively uses Supabase 'captions' and 'caption_votes' tables.
 * 2. Authentication: Gated UI that requires Google Auth to view or mutate data.
 * 3. Voting Logic:
 * - CREATE/UPDATE: Uses .upsert() to record or change a vote (+1 or -1).
 * - DELETE: Removes the row if a user clicks their active vote again (Undo).
 * 4. Persistence: Fetches user vote history on load to highlight active buttons.
 */

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

// Configuration helper to securely initialize the Supabase client
const getSupabaseConfig = () => {
    try {
        // @ts-ignore: __firebase_config is a global provided at runtime in this environment
        if (typeof __firebase_config !== 'undefined') {
            // @ts-ignore
            const config = JSON.parse(__firebase_config);
            return {
                url: `https://${config.projectId}.supabase.co`,
                key: "" // Key provided by the execution context
            };
        }
    } catch (e) {
        console.error("Configuration Error:", e);
    }
    return { url: '', key: '' };
};

const config = getSupabaseConfig();
const supabase = createClient(config.url, config.key);

export default function App() {
    const [user, setUser] = useState<any>(null);
    const [captions, setCaptions] = useState<Caption[]>([]);
    const [userVotes, setUserVotes] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    // --- DATABASE READ OPERATIONS ---

    // Fetches the specific votes cast by the logged-in user to drive UI state
    const fetchUserVotes = useCallback(async (userId: string) => {
        const { data, error: fetchError } = await supabase
            .from('caption_votes')
            .select('caption_id, vote_value')
            .eq('profile_id', userId);

        if (fetchError) {
            console.error('Error loading user votes from Supabase:', fetchError.message);
            return;
        }

        const votesMap = (data as Vote[] || []).reduce((acc: Record<string, number>, vote: Vote) => {
            acc[vote.caption_id] = vote.vote_value;
            return acc;
        }, {});

        setUserVotes(votesMap);
    }, []);

    // Fetches the main gallery content from the 'captions' table
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

    // --- AUTHENTICATION & STATE SYNC ---

    useEffect(() => {
        const initAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            const currentUser = session?.user ?? null;
            setUser(currentUser);

            if (currentUser) {
                // Rely on database for initial state
                await fetchData();
                await fetchUserVotes(currentUser.id);
            } else {
                setLoading(false);
            }
        };

        // Handle the returned promise to avoid ignored promise warnings
        initAuth().catch((err) => console.error("Auth sync failed:", err));

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (_event: any, session: any) => {
                const currentUser = session?.user ?? null;
                setUser(currentUser);

                if (currentUser) {
                    await fetchData();
                    await fetchUserVotes(currentUser.id);
                } else {
                    // Clear local state when logged out
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

    // --- DATABASE MUTATION OPERATIONS ---

    const handleVote = async (captionId: string, value: number) => {
        // Enforce authentication check per assignment requirement
        if (!user) return;

        const existingVoteValue = userVotes[captionId];

        try {
            // SCENARIO 1: DELETE (Undo Vote)
            // Triggered if the user clicks the same rating button twice
            if (existingVoteValue === value) {
                const { error: deleteError } = await supabase
                    .from('caption_votes')
                    .delete()
                    .eq('caption_id', captionId)
                    .eq('profile_id', user.id);

                if (deleteError) {
                    console.error('Failed to remove vote from Supabase:', deleteError.message);
                    return;
                }

                setUserVotes((prev) => {
                    const newVotes = { ...prev };
                    delete newVotes[captionId];
                    return newVotes;
                });
                return;
            }

            // SCENARIO 2: UPSERT (Create or Update Vote)
            // Uses the database constraint on (profile_id, caption_id) to update existing rows
            const { error: upsertError } = await supabase
                .from('caption_votes')
                .upsert({
                    caption_id: captionId,
                    profile_id: user.id,
                    vote_value: value,
                    modified_datetime_utc: new Date().toISOString()
                }, {
                    onConflict: 'profile_id, caption_id'
                });

            if (upsertError) {
                console.error('Failed to record vote in Supabase:', upsertError.message);
                return;
            }

            // Optimistically update the local view to match the database mutation
            setUserVotes((prev) => ({
                ...prev,
                [captionId]: value
            }));
        } catch (err: any) {
            console.error('Voting error unexpected:', err.message);
        }
    };

    // --- UI RENDERING ---

    if (loading) return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
            <div className="text-zinc-500 animate-pulse font-medium">Synchronizing with Supabase...</div>
        </div>
    );

    return (
        <main className="min-h-screen bg-zinc-50 px-6 py-12 dark:bg-zinc-950">
            <div className="mx-auto max-w-6xl">

                {/* Header: Displays login status and user info */}
                <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between border-b border-zinc-200 pb-8 dark:border-zinc-800">
                    <div>
                        <h1 className="text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
                            Supabase Gallery
                        </h1>
                        <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">
                            {user ? 'Authenticated: Use the database to rate your favorite captions.' : 'Protected: Log in to see database entries.'}
                        </p>
                    </div>

                    <div className="mt-6 md:mt-0">
                        {user ? (
                            <div className="flex items-center gap-4">
                                <span className="text-xs font-mono text-zinc-500 bg-zinc-100 dark:bg-zinc-900 px-2 py-1 rounded">
                                    {user.email}
                                </span>
                                <button onClick={handleLogout} className="text-sm font-bold text-red-600 hover:underline">
                                    Sign Out
                                </button>
                            </div>
                        ) : (
                            <button onClick={handleLogin} className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-6 py-3 text-sm font-bold text-zinc-50 shadow-lg transition-all hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900">
                                Sign in with Google
                            </button>
                        )}
                    </div>
                </div>

                {/* Main Content Area */}
                {!user ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-sm text-center">
                        <div className="mb-4 text-zinc-300">
                            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Data Access Restricted</h2>
                        <p className="mt-2 text-zinc-500 max-w-xs mx-auto">Please authenticate to fetch captions from the Supabase database.</p>
                    </div>
                ) : (
                    <>
                        {error && (
                            <div className="mb-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
                                <strong>Supabase Error:</strong> {error}
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                            {captions.map((item) => {
                                const currentVote = userVotes[item.id];
                                return (
                                    <div
                                        key={item.id}
                                        className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-transform hover:scale-[1.01] hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                                    >
                                        <div className="flex flex-1 flex-col p-6">
                                            <div className="mb-4 flex items-center justify-between">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                                                    ID: {item.id.slice(0, 8)}
                                                </span>
                                                {item.is_featured && (
                                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                                        ★ Featured
                                                    </span>
                                                )}
                                            </div>

                                            <p className="text-lg font-medium leading-relaxed text-zinc-800 dark:text-zinc-200">
                                                "{item.content}"
                                            </p>

                                            {/* Interaction Area: Buttons highlight based on user's database vote records */}
                                            <div className="mt-8 border-t border-zinc-100 pt-5 dark:border-zinc-800">
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleVote(item.id, 1)}
                                                        className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold transition-all active:scale-95
                                                            ${currentVote === 1
                                                            ? 'bg-emerald-600 text-white shadow-md'
                                                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400'}`}
                                                    >
                                                        {currentVote === 1 ? '▲ Upvoted' : '▲ Upvote'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleVote(item.id, -1)}
                                                        className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold transition-all active:scale-95
                                                            ${currentVote === -1
                                                            ? 'bg-rose-600 text-white shadow-md'
                                                            : 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-400'}`}
                                                    >
                                                        {currentVote === -1 ? '▼ Downvoted' : '▼ Downvote'}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {captions.length === 0 && !error && (
                            <div className="mt-20 text-center">
                                <p className="text-zinc-500 italic">No entries found in the 'captions' table.</p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}