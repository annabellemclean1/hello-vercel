'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { User, AuthChangeEvent, Session } from '@supabase/supabase-js';

/**
 * Assignment #4: Mutating Data (Rating/Voting)
 * Updated to persist UI state (highlighting arrows) based on existing votes.
 * Fixed import path to resolve compilation error.
 */
export default function Home() {
    const [user, setUser] = useState<User | null>(null);
    const [images, setImages] = useState<any[]>([]);
    const [userVotes, setUserVotes] = useState<Record<string, 'up' | 'down'>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [votingId, setVotingId] = useState<string | null>(null);

    useEffect(() => {
        // Initialize Auth Session
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
                console.error("Auth initialization error", err);
                setLoading(false);
            }
        };

        initAuth();

        // Listen for Auth changes
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

    // Fetch from the 'images' table and 'caption_votes' for the current user
    const fetchData = async (userId: string) => {
        setLoading(true);
        setError(null);
        try {
            // 1. Fetch Images
            const { data: imageData, error: fetchError } = await supabase
                .from('images')
                .select('*');

            if (fetchError) throw fetchError;

            // 2. Fetch User's existing votes to persist UI state
            const { data: voteData, error: voteError } = await supabase
                .from('caption_votes')
                .select('image_id, vote_type')
                .eq('user_id', userId);

            if (voteError) throw voteError;

            // Convert vote array to a map for O(1) lookup: { image_id: 'up' }
            const voteMap: Record<string, 'up' | 'down'> = {};
            voteData?.forEach(v => {
                voteMap[v.image_id] = v.vote_type;
            });

            setImages(imageData || []);
            setUserVotes(voteMap);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    /**
     * Mutation: Inserts a vote into 'caption_votes'
     */
    const handleVote = async (imageId: string, voteType: 'up' | 'down') => {
        if (!user) return;

        setVotingId(imageId);

        try {
            // Mutation: insert new row
            const { error: voteError } = await supabase
                .from('caption_votes')
                .insert([
                    {
                        image_id: imageId,
                        user_id: user.id,
                        vote_type: voteType
                    }
                ]);

            if (voteError) {
                console.error('Vote failed:', voteError.message);
            } else {
                // Update local state so the UI reflects the vote immediately
                setUserVotes(prev => ({
                    ...prev,
                    [imageId]: voteType
                }));
                console.log(`Recorded ${voteType}vote for image ${imageId}`);
            }
        } catch (err) {
            console.error("Mutation error", err);
        } finally {
            setVotingId(null);
        }
    };

    const handleLogin = async () => {
        await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
    };

    if (loading) return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
            <div className="text-zinc-500 animate-pulse font-medium font-mono">Initializing Secure Gallery...</div>
        </div>
    );

    return (
        <main className="min-h-screen bg-zinc-50 px-6 py-12 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
            <div className="mx-auto max-w-6xl">

                {/* Header */}
                <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between border-b border-zinc-200 pb-8 dark:border-zinc-800">
                    <div>
                        <h1 className="text-4xl font-extrabold tracking-tight">Image Gallery</h1>
                        <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">
                            {user ? `Welcome back, ${user.email}` : 'Sign in to access protected content.'}
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
                                className="text-sm font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 px-3 py-2 rounded-lg transition-colors"
                            >
                                Sign Out
                            </button>
                        )}
                    </div>
                </header>

                {/* Gated Content */}
                {!user ? (
                    <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-sm text-center">
                        <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4">
                            <svg className="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        <h2 className="text-2xl font-bold">Authenticated Access Only</h2>
                        <p className="mt-2 text-zinc-500 max-w-xs">Please login to view image data and participate in community voting.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                        {images.map((item) => {
                            const currentVote = userVotes[item.id];
                            return (
                                <div key={item.id} className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-all hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">

                                    {/* Image Container */}
                                    <div className="relative aspect-video w-full bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-800">
                                        {item.url ? (
                                            <img src={item.url} alt={item.title} className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="flex h-full items-center justify-center text-zinc-400 italic text-sm">No image preview</div>
                                        )}
                                    </div>

                                    {/* Card Body */}
                                    <div className="flex flex-1 flex-col p-6">
                                        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 truncate">
                                            {item.title || 'Untitled Image'}
                                        </h3>
                                        <p className="mt-2 flex-1 text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2">
                                            {item.description || item.caption || 'No description provided.'}
                                        </p>

                                        {/* Vote Section */}
                                        <div className="mt-6 pt-5 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                                            <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-tighter">REF_{String(item.id).slice(0, 8)}</span>

                                            <div className="flex items-center gap-1 bg-zinc-50 dark:bg-zinc-800/50 p-1 rounded-xl border border-zinc-100 dark:border-zinc-800">
                                                <button
                                                    disabled={votingId === item.id}
                                                    onClick={() => handleVote(item.id, 'up')}
                                                    className={`p-2 rounded-lg transition-all disabled:opacity-30 shadow-sm ${
                                                        currentVote === 'up'
                                                            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
                                                            : 'hover:bg-white dark:hover:bg-zinc-700 text-zinc-400 hover:text-emerald-600'
                                                    }`}
                                                    aria-label="Upvote"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 15l7-7 7 7" />
                                                    </svg>
                                                </button>
                                                <button
                                                    disabled={votingId === item.id}
                                                    onClick={() => handleVote(item.id, 'down')}
                                                    className={`p-2 rounded-lg transition-all disabled:opacity-30 shadow-sm ${
                                                        currentVote === 'down'
                                                            ? 'bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'
                                                            : 'hover:bg-white dark:hover:bg-zinc-700 text-zinc-400 hover:text-rose-600'
                                                    }`}
                                                    aria-label="Downvote"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
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

                {/* Error Feedback */}
                {error && (
                    <div className="mt-8 p-4 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900 text-red-600 dark:text-red-400 rounded-xl text-sm font-mono">
                        <strong>System Error:</strong> {error}
                    </div>
                )}
            </div>
        </main>
    );
}