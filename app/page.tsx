'use client';

import { useEffect, useState, useCallback } from 'react';
// @ts-ignore: Using CDN import to bypass bundling restrictions in the preview environment
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

/**
 * Assignment #4: Mutating Data (Rating/Voting)
 * Final Build:
 * - Schema aligned with captions, images, and caption_votes tables.
 * - Uses CDN import to ensure stability in the preview environment.
 * - Implements upsert logic for persistent voting state.
 */

// Types for Supabase logic
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
                "" // Key handled by execution context
            );
        }
    } catch (e) {
        console.error("Configuration Error:", e);
    }
    return createClient('https://placeholder.supabase.co', 'placeholder');
};

const supabase = getSupabaseClient();

export default function Home() {
    const [user, setUser] = useState<User | null>(null);
    const [displayData, setDisplayData] = useState<any[]>([]);
    const [userVotes, setUserVotes] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [votingId, setVotingId] = useState<string | null>(null);

    const fetchData = useCallback(async (userId: string) => {
        setLoading(true);
        setError(null);
        try {
            // 1. Fetch Captions and their related Images based on the schema
            // Relation: captions.image_id -> images.id
            const { data: captionData, error: fetchError } = await supabase
                .from('captions')
                .select(`
                    id,
                    content,
                    image_id,
                    images (
                        url,
                        image_description
                    )
                `);

            if (fetchError) throw fetchError;

            // 2. Fetch User's existing votes from caption_votes
            const { data: voteData, error: voteError } = await supabase
                .from('caption_votes')
                .select('caption_id, vote_value')
                .eq('profile_id', userId);

            if (voteError) throw voteError;

            const voteMap: Record<string, number> = {};
            (voteData as any[])?.forEach(v => {
                voteMap[v.caption_id] = v.vote_value;
            });

            setDisplayData(captionData || []);
            setUserVotes(voteMap);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const initAuth = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const currentUser = session?.user ?? null;
                setUser(currentUser);
                if (currentUser) {
                    await fetchData(currentUser.id);
                } else {
                    setLoading(false);
                }
            } catch (err) {
                console.error("Auth initialization error", err);
                setLoading(false);
            }
        };

        void initAuth();

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (_event: AuthChangeEvent, session: Session | null) => {
                const currentUser = session?.user ?? null;
                setUser(currentUser);
                if (currentUser) {
                    await fetchData(currentUser.id);
                } else {
                    setDisplayData([]);
                    setUserVotes({});
                    setLoading(false);
                }
            }
        );

        return () => subscription.unsubscribe();
    }, [fetchData]);

    /**
     * MUTATION: Submits a rating for a caption
     * Ensures only logged-in users can mutate data.
     */
    const handleVote = async (captionId: string, direction: 'up' | 'down') => {
        if (!user) return;

        const newValue = direction === 'up' ? 1 : -1;
        setVotingId(captionId);

        try {
            // Data Mutation: Recording the user's vote in the caption_votes table
            const { error: voteError } = await supabase
                .from('caption_votes')
                .upsert([
                    {
                        caption_id: captionId,
                        profile_id: user.id,
                        vote_value: newValue,
                        modified_datetime_utc: new Date().toISOString()
                    }
                ], { onConflict: 'profile_id,caption_id' });

            if (voteError) {
                setError(voteError.message);
            } else {
                // Optimistic UI update
                setUserVotes(prev => ({
                    ...prev,
                    [captionId]: newValue
                }));
                setError(null);
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setVotingId(null);
        }
    };

    const handleLogin = async () => {
        await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: typeof window !== 'undefined' ? window.location.origin : '' },
        });
    };

    if (loading) return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
            <div className="text-zinc-500 animate-pulse font-mono tracking-widest uppercase text-xs">Synchronizing Schema...</div>
        </div>
    );

    return (
        <main className="min-h-screen bg-zinc-50 px-4 py-8 md:px-8 md:py-12 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
            <div className="mx-auto max-w-6xl">

                {/* Header Section */}
                <header className="mb-12 flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-zinc-200 pb-8 dark:border-zinc-800">
                    <div className="space-y-1">
                        <h1 className="text-3xl font-black uppercase tracking-tighter md:text-5xl italic">Caption Engine</h1>
                        <p className="text-zinc-500 dark:text-zinc-400 font-medium">
                            {user ? `System User: ${user.email}` : 'Authorization required to access mutations.'}
                        </p>
                    </div>
                    <div>
                        {!user ? (
                            <button
                                onClick={handleLogin}
                                className="w-full md:w-auto rounded-full bg-zinc-900 px-8 py-3 text-sm font-bold text-white hover:scale-105 transition-transform active:scale-95 dark:bg-zinc-50 dark:text-zinc-900"
                            >
                                Connect with Google
                            </button>
                        ) : (
                            <button
                                onClick={() => supabase.auth.signOut()}
                                className="group flex items-center gap-2 text-xs font-bold text-zinc-400 hover:text-rose-500 transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                                Terminal Logout
                            </button>
                        )}
                    </div>
                </header>

                {!user ? (
                    <div className="flex flex-col items-center justify-center py-32 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[2rem] shadow-xl text-center px-6">
                        <div className="w-20 h-20 bg-zinc-100 dark:bg-zinc-800 rounded-3xl rotate-3 flex items-center justify-center mb-6">
                            <svg className="w-10 h-10 text-zinc-900 dark:text-zinc-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                        </div>
                        <h2 className="text-3xl font-black tracking-tight mb-3">Protected Assets</h2>
                        <p className="text-zinc-500 max-w-sm leading-relaxed">Voting, rating, and data mutation are only available to authenticated sessions.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {displayData.map((item) => {
                            const currentVote = userVotes[item.id];
                            const image = item.images;

                            return (
                                <div key={item.id} className="group relative flex flex-col bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl transition-all hover:ring-2 hover:ring-zinc-900 dark:hover:ring-zinc-50 overflow-hidden">
                                    <div className="aspect-[4/3] w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                                        {image?.url ? (
                                            <img src={image.url} alt={image.image_description || "Gallery Item"} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                                        ) : (
                                            <div className="flex h-full items-center justify-center text-zinc-400 font-mono text-xs uppercase">Null Image Reference</div>
                                        )}
                                    </div>

                                    <div className="p-6 flex flex-col flex-1">
                                        <div className="flex-1 space-y-4">
                                            <div className="flex items-center gap-2">
                                                <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Caption Asset</span>
                                            </div>
                                            <p className="text-lg font-bold leading-tight text-zinc-900 dark:text-zinc-50">
                                                {item.content}
                                            </p>
                                        </div>

                                        <div className="mt-8 flex items-center justify-between">
                                            <div className="flex -space-x-2">
                                                <div className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 border-2 border-white dark:border-zinc-900" />
                                                <div className="w-6 h-6 rounded-full bg-zinc-300 dark:bg-zinc-600 border-2 border-white dark:border-zinc-900" />
                                            </div>

                                            <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-2xl">
                                                <button
                                                    disabled={votingId === item.id}
                                                    onClick={() => handleVote(item.id, 'up')}
                                                    className={`p-2.5 rounded-xl transition-all shadow-sm ${
                                                        currentVote === 1
                                                            ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900'
                                                            : 'hover:bg-white dark:hover:bg-zinc-700 text-zinc-400'
                                                    }`}
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 15l7-7 7 7" /></svg>
                                                </button>

                                                <button
                                                    disabled={votingId === item.id}
                                                    onClick={() => handleVote(item.id, 'down')}
                                                    className={`p-2.5 rounded-xl transition-all shadow-sm ${
                                                        currentVote === -1
                                                            ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900'
                                                            : 'hover:bg-white dark:hover:bg-zinc-700 text-zinc-400'
                                                    }`}
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7" /></svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {error && (
                    <div className="fixed bottom-6 right-6 max-w-sm p-4 bg-rose-500 text-white rounded-2xl shadow-2xl animate-in slide-in-from-bottom-10 font-bold text-sm">
                        <div className="flex items-center gap-3">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            <span>Mutation Blocked: {error}</span>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}