'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { User, AuthChangeEvent, Session } from '@supabase/supabase-js';

export default function Home() {
    const [user, setUser] = useState<User | null>(null);
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
        setError(null);

        // Attempt to fetch from 'captions'
        // If your table is named 'images' or something else, change the string below
        const { data, error: fetchError } = await supabase
            .from('captions')
            .select('*');

        if (fetchError) {
            console.error('Fetch error:', fetchError);
            setError(fetchError.message);
        } else {
            setItems(data || []);
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
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
            <div className="text-center font-medium text-gray-500 italic">Loading Gallery Content...</div>
        </div>
    );

    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-6xl mx-auto">
                <header className="flex justify-between items-center mb-10 border-b pb-6">
                    <div>
                        <h1 className="text-3xl font-black text-gray-900 tracking-tight">Image Gallery</h1>
                        {user && <p className="text-sm text-gray-500 mt-1">Logged in as: {user.email}</p>}
                    </div>
                    {user ? (
                        <button
                            onClick={handleLogout}
                            className="text-sm font-bold text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg transition-colors"
                        >
                            Logout
                        </button>
                    ) : (
                        <button
                            onClick={handleLogin}
                            className="bg-black text-white px-6 py-2 rounded-lg font-bold shadow-lg hover:opacity-80 transition-all"
                        >
                            Login with Google
                        </button>
                    )}
                </header>

                {!user ? (
                    /* LOCKED STATE */
                    <div className="text-center py-24 bg-white border-2 border-dashed rounded-3xl">
                        <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-6">
                            <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900 mb-2">Authenticated Access Required</h2>
                        <p className="text-gray-500 mb-8 max-w-sm mx-auto">Please sign in with your Google account to view the image records from Supabase.</p>
                        <button
                            onClick={handleLogin}
                            className="bg-blue-600 text-white px-8 py-3 rounded-full font-bold shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all"
                        >
                            Login to View
                        </button>
                    </div>
                ) : (
                    /* PROTECTED GALLERY CONTENT */
                    <div>
                        {error && (
                            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm font-mono">
                                Error connecting to table: {error}
                            </div>
                        )}

                        {items.length === 0 && !error ? (
                            <div className="text-center py-20 text-gray-400 border rounded-xl bg-white italic">
                                No images found in the 'captions' table.
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                {items.map((item) => (
                                    <div key={item.id} className="group bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300">
                                        <div className="aspect-4/3 bg-gray-200 overflow-hidden">
                                            {item.url ? (
                                                <img
                                                    src={item.url}
                                                    alt=""
                                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-gray-400">No Image URL</div>
                                            )}
                                        </div>
                                        <div className="p-6">
                                            <h3 className="font-bold text-gray-900 text-xl mb-2">{item.title || 'Untitled'}</h3>
                                            <p className="text-gray-600 text-sm leading-relaxed">{item.caption || 'No description provided.'}</p>
                                            <div className="mt-4 pt-4 border-t border-gray-50 flex items-center text-[10px] font-mono text-gray-400">
                                                <span>DB_ID: {item.id}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </main>
    );
}