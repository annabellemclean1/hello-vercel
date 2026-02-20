'use client';

import { useEffect, useState, useCallback } from 'react';
// @ts-ignore: Using CDN import to bypass bundling restrictions in the preview environment
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

/**
 * Assignment #4: Mutating Data (Rating/Voting)
 * Updated to match the provided schema:
 * - images: { id, url, image_description }
 * - captions: { id, image_id, content, profile_id }
 * - caption_votes: { id, vote_value, profile_id, caption_id }
 */

// Types for Supabase
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
            // 1. Fetch Captions and their related Images
            // We join captions with images to display the image alongside the text being rated
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
     * MUTATION: Upserts a vote into 'caption_votes'
     * Logic: If a row with this profile_id and caption_id exists, update vote_value.
     * Otherwise, insert a new row.
     */
    const handleVote = async (captionId: string, direction: 'up' | 'down') => {
        if (!user) return;

        const newValue = direction === 'up' ? 1 : -1;
        setVotingId(captionId);

        try {
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
            <div className="text-zinc-500 animate-pulse font-medium font-mono">Loading Gallery & Ratings...</div>
        </div>
    );

    return (
        <main className="min-h-screen bg-zinc-50 px-6 py-12 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
            <div className="mx-auto max-w-6xl">
                <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between border-b border-zinc-200 pb-8 dark:border-zinc-800">
                    <div>
                        <h1 className="text-4xl font-extrabold tracking-tight italic">Rate My Caption</h1>
                        <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">
                            {user ? `Logged in as: ${user.email}` : 'Sign in to rate captions and influence the feed.'}
                        </p>
                    </div>
                    <div className="mt-6 md:mt-0">
                        {!user ? (
                            <button
                                onClick={handleLogin}
                                className="rounded-xl bg-zinc-900 px-6 py-3 text-sm font-bold text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 transition-all shadow-lg"
                            >
                                Sign in with Google
                            </button>
                        ) : (
                            <button
                                onClick={() => supabase.auth.signOut()}
                                className="text-sm font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 px-3 py-2 rounded-lg transition-colors"
                            >
                                Sign Out
                            </button>
                        )}
                    </div>
                </header>

                {!user ? (
                    <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-sm text-center">
                        <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4">
                            <svg className="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        <h2 className="text-2xl font-bold">Authentication Required</h2>
                        <p className="mt-2 text-zinc-500 max-w-xs">Data mutation (voting) is restricted to authenticated users to ensure system integrity.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                        {displayData.map((item) => {
                            const currentVote = userVotes[item.id];
                            const image = item.images;

                            return (
                                <div key={item.id} className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-all hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
                                    <div className="relative aspect-video w-full bg-zinc-100 dark:bg-zinc-800">
                                        {image?.url ? (
                                            <img src={image.url} alt="Context" className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="flex h-full items-center justify-center text-zinc-400 italic text-sm">Image data missing</div>
                                        )}
                                    </div>

                                    <div className="flex flex-1 flex-col p-6">
                                        <div className="flex-1">
                                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-2">Caption Content</span>
                                            <p className="text-base font-medium text-zinc-900 dark:text-zinc-50 leading-relaxed">
                                                "{item.content}"
                                            </p>
                                        </div>

                                        <div className="mt-6 pt-5 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                                            <span className="font-mono text-[9px] text-zinc-400">ID: {item.id.slice(0,8)}</span>

                                            <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/50 p-1.5 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                                                <button
                                                    disabled={votingId === item.id}
                                                    onClick={() => handleVote(item.id, 'up')}
                                                    className={`p-2 rounded-xl transition-all disabled:opacity-30 ${
                                                        currentVote === 1
                                                            ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                                                            : 'hover:bg-emerald-50 text-zinc-400 hover:text-emerald-600 dark:hover:bg-emerald-950/30'
                                                    }`}
                                                    aria-label="Upvote"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 15l7-7 7 7" />
                                                    </svg>
                                                </button>

                                                <button
                                                    disabled={votingId === item.id}
                                                    onClick={() => handleVote(item.id, 'down')}
                                                    className={`p-2 rounded-xl transition-all disabled:opacity-30 ${
                                                        currentVote === -1
                                                            ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20'
                                                            : 'hover:bg-rose-50 text-zinc-400 hover:text-rose-600 dark:hover:bg-rose-950/30'
                                                    }`}
                                                    aria-label="Downvote"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7" />
                                                    </svg>
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
                    <div className="mt-8 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900 text-amber-700 dark:text-amber-400 rounded-xl text-sm font-mono flex gap-3 items-center">
                        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span>{error}</span>
                    </div>
                )}
            </div>
        </main>
    );
}