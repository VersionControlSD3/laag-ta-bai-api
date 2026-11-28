import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp, createContext } from '../src/createApp.js'
import { loadEnv } from '../src/config/env.js'

// QA #50: signing in on the shared Supabase client stored the user's session in
// it, so later queries on the warm instance ran as that user under RLS and
// visit inserts failed with "new row violates row-level security policy".

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  email: 'traveler@example.test',
  user_metadata: { display_name: 'Traveler' },
  app_metadata: { provider: 'email' },
  created_at: '2026-11-28T00:00:00Z',
}
const session = {
  access_token: 'user-access-token',
  refresh_token: 'user-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
}

const authFetch: typeof globalThis.fetch = async (input) => {
  const path = new URL(String(input)).pathname
  if (path === '/auth/v1/token') return Response.json(session)
  if (path === '/auth/v1/signup') return Response.json(session)
  return Response.json({ message: `unexpected ${path}` }, { status: 500 })
}

function client(): SupabaseClient {
  return createClient('https://supabase.example.test', 'sb_secret_test', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: authFetch },
  })
}

function appWithSharedClient() {
  const shared = client()
  const createSessionClient = vi.fn(client)
  const ctx = createContext(loadEnv())
  const app = createApp({ ...ctx, auth: { supabase: shared, devAuthEnabled: false, createSessionClient } })
  return { app, shared, createSessionClient }
}

describe('auth session isolation', () => {
  it('logs in on a request-scoped client and leaves the shared client without a session', async () => {
    const { app, shared, createSessionClient } = appWithSharedClient()

    const res = await request(app).post('/v1/auth/login').send({ email: user.email, password: 'password123' })

    expect(res.status).toBe(200)
    expect(res.body.data.session.accessToken).toBe('user-access-token')
    expect(createSessionClient).toHaveBeenCalledTimes(1)
    expect((await shared.auth.getSession()).data.session).toBeNull()
  })

  it('signs up on a request-scoped client and leaves the shared client without a session', async () => {
    const { app, shared, createSessionClient } = appWithSharedClient()

    const res = await request(app)
      .post('/v1/auth/signup')
      .send({ email: user.email, password: 'password123', displayName: 'Traveler' })

    expect(res.status).toBe(201)
    expect(createSessionClient).toHaveBeenCalledTimes(1)
    expect((await shared.auth.getSession()).data.session).toBeNull()
  })

  it('uses a fresh client for every sign-in', async () => {
    const { app, createSessionClient } = appWithSharedClient()

    await request(app).post('/v1/auth/login').send({ email: user.email, password: 'password123' })
    await request(app).post('/v1/auth/login').send({ email: user.email, password: 'password123' })

    expect(createSessionClient).toHaveBeenCalledTimes(2)
    expect(createSessionClient.mock.results[0]!.value).not.toBe(createSessionClient.mock.results[1]!.value)
  })
})
