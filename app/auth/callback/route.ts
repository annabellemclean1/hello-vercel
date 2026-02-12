import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    // Google sends a 'code' back in the URL
    const code = searchParams.get('code')

    if (code) {
        const cookieStore = await cookies()
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() { return cookieStore.getAll() },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    },
                },
            }
        )

        // This exchanges the temporary code for a real user session
        const { error } = await supabase.auth.exchangeCodeForSession(code)

        if (!error) {
            // SUCCESS: Send them to the protected route
            return NextResponse.redirect(`${origin}/protected`)
        }
    }

    // FAILURE: Send them back home if login fails
    return NextResponse.redirect(`${origin}/`)
}