import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// createBrowserClient uses PKCE flow by default, which sends a ?code= param
// to the callback route instead of a #access_token= hash fragment
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)