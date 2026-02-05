import { supabase } from '@/lib/supabase';

/**
 * Assignment #2: Supabase Integration
 * This component fetches data from the 'images' table and renders it in a grid.
 */
export default async function Home() {
    // 1. Fetch rows from the pre-existing 'images' table
    // Note: if your table is named 'captions', change 'images' to 'captions' below.
    const { data: images, error } = await supabase
        .from('images')
        .select('*');

    // 2. Error handling (User-friendly message if fetch fails)
    if (error) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6 text-center">
                <div className="max-w-md rounded-lg border border-red-200 bg-white p-8 shadow-sm">
                    <h2 className="mb-2 text-xl font-bold text-red-600">Connection Error</h2>
                    <p className="text-gray-600">
                        Could not fetch data from Supabase. Make sure your environment variables
                        are set in Vercel and your table name is correct.
                    </p>
                    <p className="mt-4 font-mono text-xs text-red-400">{error.message}</p>
                </div>
            </div>
        );
    }

    // 3. Render the List Page (Grid format)
    return (
        <main className="min-h-screen bg-zinc-50 px-6 py-12 dark:bg-zinc-950">
            <div className="mx-auto max-w-6xl">
                {/* Header Section */}
                <div className="mb-12 border-b border-zinc-200 pb-8 dark:border-zinc-800">
                    <h1 className="text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
                        Supabase Gallery
                    </h1>
                    <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">
                        Rendering live data from the database images table.
                    </p>
                </div>

                {/* The Grid */}
                <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                    {images?.map((item: any) => (
                        <div
                            key={item.id}
                            className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-transform hover:scale-[1.02] hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                        >
                            {/* Image Preview (renders if 'url' exists) */}
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

                {/* Empty State */}
                {(!images || images.length === 0) && (
                    <div className="mt-20 text-center">
                        <p className="text-zinc-500">No data found in the "images" table.</p>
                    </div>
                )}
            </div>
        </main>
    );
}