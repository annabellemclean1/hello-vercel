'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { User, AuthChangeEvent, Session } from '@supabase/supabase-js';

/**
 * FILE: app/page.tsx
 * This is the main UI. It shows the login button or the gallery cards.
 * Resolved TS2551 (onAuthStateChange typo) and TS7006 (implicit any types).
 * Updated import path to use the absolute alias to fix resolution errors.
 */
export default function Home() {
    const [user, setUser] = useState<User | null>(null);
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const getSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchData();
            } else {
                setLoading(false);
            }
        };

        getSession();

        // Fixed typo: changed onAuthStateChanged to onAuthStateChange
        // Added explicit types for _event and session to resolve TS7006
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event: AuthChangeEvent, session: Session | null) => {
                setUser(session?.user ?? null);
                if (session?.user) {
                    fetchData();
                } else {
                    setItems([]);
                    setLoading(false);
                }
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        const { data, error } = await supabase.from('captions').select('*');
        if (!error) setItems(data || []);
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
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
            <div className="text-center font-medium text-gray-500">Loading your gallery...</div>
        </div>
    );

    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-6xl mx-auto">
                <div className="flex justify-between items-center mb-10">
                    <h1 className="text-2xl font-bold text-gray-900">My Protected Gallery</h1>
                    {user ? (
                        <div className="flex items-center gap-4">
                            <span className="text-sm text-gray-500">{user.email}</span>
                            <button
                                onClick={handleLogout}
                                className="text-red-600 font-bold hover:underline"
                            >
                                LOGOUT
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={handleLogin}
                            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-md"
                        >
                            LOGIN WITH GOOGLE
                        </button>
                    )}
                </div>

                {!user ? (
                    <div className="text-center py-20 bg-white rounded-2xl border border-gray-200 shadow-sm">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 rounded-full mb-4">
                            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900">Protected Content</h2>
                        <p className="text-gray-500 mt-2 max-w-xs mx-auto">Please sign in with your Google account to view the image collection.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {items.map((item: any) => (
                            <div key={item.id} className="group bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                                <div className="aspect-video bg-gray-100 overflow-hidden">
                                    {item.url ? (
                                        <img
                                            src={item.url}
                                            alt={item.title || "Gallery image"}
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-400">No Image</div>
                                    )}
                                </div>
                                <div className="p-5">
                                    <h3 className="font-bold text-gray-900 text-lg mb-1">{item.title || 'Untitled'}</h3>
                                    <p className="text-gray-600 text-sm line-clamp-2">{item.caption || 'No description provided.'}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}