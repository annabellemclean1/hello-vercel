'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { User, AuthChangeEvent, Session } from '@supabase/supabase-js';

/**
 * Assignment #2: Gated Supabase Integration
 * This version restores the original 'images' table fetching and styling
 * while maintaining the required Google Auth protection.
 */
export default function Home() {
    const [user, setUser] = useState<User | null>(null);
    const [images, setImages] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // 1. Handle initial session and auth state
        const initAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchData();
            } else {
                setLoading(false);
            }
        };

        initAuth();

        // 2. Listen for auth changes (Login/Logout)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event: AuthChangeEvent, session: Session | null) => {
                setUser(session?.user ?? null);
                if (session?.user) {
                    fetchData();
                } else {
                    setImages([]);
                    setLoading(false);
                }
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    // 3. Fetch data from the 'images' table (as per original code)
    const fetchData = async () => {
        setLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
            .from('images') // Restored table name to 'images'
            .select('*');

        if (fetchError) {
            console.error('Fetch error:', fetchError);
            setError(fetchError.message);
        } else {
            setImages(data || []);
        }
        setLoading(false);
    };

    const handleLogin = async () => {
        await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
    };

    if (loading) return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
            <div className="text-zinc-500 animate-pulse font-medium">Loading Gallery...</div>
        </div>
    );

    return (
        <main className="min-h-screen bg-zinc-50 px-6 py-12 dark:bg-zinc-950">
            <div className="mx-auto max-w-6xl">

                {/* Header Section */}
                <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between border-b border-zinc-200 pb-8 dark:border-zinc-800">
                    <div>
                        <h1 className="text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
                            Supabase Gallery
                        </h1>
                        <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">
                            {user ? 'Authenticated: Rendering live data from the database.' : 'Protected: Please sign in to view content.'}
                        </p>
                    </div>

                    <div className="mt-6 md:mt-0">
                        {user ? (
                            <div className="flex items-center gap-4">
                <span className="text-xs font-mono text-zinc-500 bg-zinc-100 dark:bg-zinc-900 px-2 py-1 rounded">
                  {user.email}
                </span>
                                <button
                                    onClick={handleLogout}
                                    className="text-sm font-bold text-red-600 hover:underline"
                                >
                                    Sign Out
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={handleLogin}
                                className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-6 py-3 text-sm font-bold text-zinc-50 shadow-lg transition-all hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
                            >
                                Sign in with Google
                            </button>
                        )}
                    </div>
                </div>

                {/* Content Section */}
                {!user ? (
                    /* Locked UI */
                    <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-sm text-center">
                        <div className="mb-4 text-zinc-300">
                            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Content Gated</h2>
                        <p className="mt-2 text-zinc-500 max-w-xs mx-auto">This route is protected. Authentication is required to fetch image data.</p>
                    </div>
                ) : (
                    /* Gallery UI */
                    <>
                        {error && (
                            <div className="mb-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
                                <strong>Connection Error:</strong> {error}
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                            {images.map((item) => (
                                <div
                                    key={item.id}
                                    className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-transform hover:scale-[1.02] hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                                >
                                    {/* Image Preview */}
                                    <div className="relative aspect-video w-full bg-zinc-100 dark:bg-zinc-800">
                                        {item.url ? (
                                            <img
                                                src={item.url}
                                                alt={item.title || 'Supabase entry'}
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-full items-center justify-center text-zinc-400 italic text-sm">
                                                No image available
                                            </div>
                                        )}
                                    </div>

                                    {/* Card Content */}
                                    <div className="flex flex-1 flex-col p-5">
                                        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                                            {item.title || item.name || 'Untitled Entry'}
                                        </h3>
                                        <p className="mt-2 flex-1 text-sm text-zinc-600 dark:text-zinc-400 line-clamp-3">
                                            {item.description || item.caption || 'No description provided.'}
                                        </p>

                                        {/* ID Badge */}
                                        <div className="mt-6 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                      <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-zinc-400">
                        ID: {item.id}
                      </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {images.length === 0 && !error && (
                            <div className="mt-20 text-center">
                                <p className="text-zinc-500 italic">No data found in the "images" table.</p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}