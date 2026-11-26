import { createClient } from '@supabase/supabase-js'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp, createContext } from '../src/createApp.js'
import { loadEnv } from '../src/config/env.js'

describe('GET /v1/me', () => {
  it('returns the signed-in local account and ignores another user ID in the query', async () => {
    const app = createApp(createContext(loadEnv()))
    const signup = async (email: string, displayName: string) => {
      const response = await request(app).post('/v1/auth/signup')
        .send({ email, displayName, password: 'Test password 2026' })
      expect(response.status).toBe(201)
      return response.body.data
    }
    const first = await signup('first@example.test', 'First Traveler')
    const other = await signup('other@example.test', 'Other Traveler')

    const response = await request(app).get('/v1/me')
      .set('Authorization', `Bearer ${first.session.accessToken}`)
      .query({ userId: other.user.id })
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.body.data).toMatchObject({
      profile: { id: first.user.id, displayName: 'First Traveler' },
      email: 'first@example.test',
      rank: { xp: 0 },
      stats: { visitedCount: 0 },
      badges: [],
      recentVisits: [],
    })
    expect(response.body.data.profile).not.toHaveProperty('passwordHash')
  })

  it('preserves email-less guest profiles in development', async () => {
    const app = createApp(createContext(loadEnv()))
    const response = await request(app).get('/v1/me').set('Authorization', 'Bearer dev:guest')
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ profile: { id: 'guest' }, email: null })
  })

  it('returns the profile for the Supabase-verified user and rejects an invalid bearer token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url, init) => {
      expect(new URL(String(url)).pathname).toBe('/auth/v1/user')
      const token = new Headers(init?.headers).get('authorization')
      return token === 'Bearer verified-token'
        ? Response.json({
          id: 'verified-user',
          email: 'verified@example.test',
          user_metadata: { display_name: 'Verified Traveler' },
        })
        : Response.json({ code: 'bad_jwt' }, { status: 401 })
    })
    const supabase = createClient('https://supabase.example.test', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch },
    })
    const ctx = createContext(loadEnv())
    const app = createApp({ ...ctx, auth: { supabase, devAuthEnabled: false } })
    const verified = await request(app).get('/v1/me').set('Authorization', 'Bearer verified-token')
    expect(verified.status).toBe(200)
    expect(verified.body.data).toMatchObject({
      profile: { id: 'verified-user', displayName: 'Verified Traveler' },
      email: 'verified@example.test',
    })
    expect((await request(app).get('/v1/me').set('Authorization', 'Bearer invalid-token')).status).toBe(401)
    expect((await request(app).get('/v1/me').set('Authorization', 'Bearer dev:verified-user')).status).toBe(401)
  })
})

describe('PATCH /v1/me terms acceptance', () => {
  it('stamps termsAcceptedAt once and keeps the first acceptance', async () => {
    const app = createApp(createContext(loadEnv()))
    const auth = { Authorization: 'Bearer dev:new-google-user' }

    const before = await request(app).get('/v1/me').set(auth)
    expect(before.body.data.profile.termsAcceptedAt).toBeNull()

    const first = await request(app).patch('/v1/me').set(auth).send({ nationality: 'Filipino', acceptTerms: true })
    expect(first.status).toBe(200)
    expect(first.body.data).toMatchObject({ nationality: 'Filipino' })
    const acceptedAt = first.body.data.termsAcceptedAt
    expect(new Date(acceptedAt).toString()).not.toBe('Invalid Date')

    const again = await request(app).patch('/v1/me').set(auth).send({ acceptTerms: true, bio: 'Hi' })
    expect(again.body.data.termsAcceptedAt).toBe(acceptedAt)

    const other = await request(app).patch('/v1/me').set(auth).send({ bio: 'Still accepted' })
    expect(other.body.data.termsAcceptedAt).toBe(acceptedAt)
  })

  it('rejects anything but acceptTerms: true, including a client timestamp', async () => {
    const app = createApp(createContext(loadEnv()))
    const auth = { Authorization: 'Bearer dev:someone' }
    expect((await request(app).patch('/v1/me').set(auth).send({ acceptTerms: false })).status).toBe(400)
    expect((await request(app).patch('/v1/me').set(auth).send({ termsAcceptedAt: '2020-01-01T00:00:00Z' })).status).toBe(400)
  })
})
