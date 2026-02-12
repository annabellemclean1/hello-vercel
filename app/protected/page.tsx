import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function ProtectedPage() {
    const cookieStore = await cookies()
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() { return cookieStore.getAll() },
            },
        }
    )

    // Check if a user session exists
    const { data: { user } } = await supabase.auth.getUser()

    // GATED UI LOGIC: If no user is found, redirect them to the home page
    if (!user) {
        redirect('/')
    }

    return (
        <div style={{ padding: '2rem' }}>
            <h1>Gated Content</h1>
            <p>Welcome, <strong>{user.email}</strong>!</p>
            <p>You have successfully bypassed the gate.</p>
        </div>
    )
}