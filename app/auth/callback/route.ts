import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * FILE: app/auth/callback/route.ts
 * This handles the background "handshake" when returning from Google.
 * Resolved TS2339 by awaiting the cookies() helper.
 */
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')

    if (code) {
        // In Next.js 15+, cookies() returns a Promise and must be awaited
        const cookieStore = await cookies()

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) {
                        return cookieStore.get(name)?.value
                    },
                    set(name: string, value: string, options: CookieOptions) {
                        cookieStore.set({ name, value, ...options })
                    },
                    remove(name: string, options: CookieOptions) {
                        cookieStore.set({ name, value: '', ...options })
                    },
                },
            }
        )

        // Exchange the temporary code for a real login session
        await supabase.auth.exchangeCodeForSession(code)
    }

    // Once done, send the user back to the home page
    return NextResponse.redirect(origin)
}
