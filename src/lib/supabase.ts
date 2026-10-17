import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** Server-side client using the secret key. Bypasses RLS: always filter by the verified user id. */
export function createSupabaseAdmin(url: string, secretKey: string): SupabaseClient {
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
