'use client'

import { createBrowserClient } from '@supabase/ssr'

export default function LoginButton() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Strict requirement: must be /auth/callback
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  return (
    <button onClick={handleLogin} style={{ padding: '10px 20px', fontSize: '16px' }}>
      Log in with Google
    </button>
  )
}