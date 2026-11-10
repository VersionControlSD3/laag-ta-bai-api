import { createClient } from '@supabase/supabase-js'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp, createContext } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'

const redirectTo = 'https://app.example.test/reset-password'
const email = 'traveler@example.test'
const password = 'New password 2026'
const forgotPath = '/v1/auth/forgot-password'
const resetPath = '/v1/auth/reset-password'

function appWithProvider(fetch: typeof globalThis.fetch) {
  const createAuthClient = vi.fn(() => createClient('https://supabase.example.test', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  }))
  const ctx = createContext(loadEnv())
  return { app: createApp({ ...ctx, passwordRecovery: { createAuthClient, redirectTo } }), createAuthClient }
}

describe('password recovery', () => {
  it('uses the configured redirect and gives the same response for unknown email', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockImplementationOnce(async () => Response.json({}))
      .mockImplementationOnce(async () => Response.json({ code: 'user_not_found' }, { status: 404 }))
    const { app } = appWithProvider(fetch)
    const known = await request(app).post(forgotPath).send({ email })
    const unknown = await request(app).post(forgotPath).send({ email: 'missing@example.test' })

    expect(known.status).toBe(202)
    expect(unknown.status).toBe(202)
    expect(known.body).toEqual(unknown.body)
    expect(known.headers['cache-control']).toBe('no-store')
    const [url, init] = fetch.mock.calls[0]!
    expect(new URL(String(url)).pathname).toBe('/auth/v1/recover')
    expect(new URL(String(url)).searchParams.get('redirect_to')).toBe(redirectTo)
    expect(JSON.parse(String(init?.body))).toMatchObject({ email })
  })

  it('rejects expired or reused recovery links before updating a password', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
      Response.json({ code: 'otp_expired', message: 'provider details' }, { status: 403 }),
    )
    const { app } = appWithProvider(fetch)
    const res = await request(app).post(resetPath).send({ tokenHash: 'expired-token', password })

    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('Invalid or expired password reset link.')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses separate recovery sessions and changes only the account verified by each token', async () => {
    const verifyBodies: unknown[] = []
    const updates: Array<{ authorization: string | null; password: string }> = []
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init?.body))
      const pathname = new URL(String(url)).pathname
      if (pathname === '/auth/v1/verify') {
        verifyBodies.push(body)
        return Response.json({
          access_token: `session-${body.token_hash}`,
          refresh_token: `refresh-${body.token_hash}`,
          expires_in: 3600,
          token_type: 'bearer',
          user: { id: body.token_hash, aud: 'authenticated', user_metadata: {}, app_metadata: {} },
        })
      }
      expect(pathname).toBe('/auth/v1/user')
      expect(init?.method).toBe('PUT')
      updates.push({ authorization: new Headers(init?.headers).get('authorization'), password: body.password })
      return Response.json({ id: 'verified-user', aud: 'authenticated', user_metadata: {}, app_metadata: {} })
    })
    const { app, createAuthClient } = appWithProvider(fetch)
    const [a, b] = await Promise.all([
      request(app).post(resetPath).send({ tokenHash: 'one', password }),
      request(app).post(resetPath).send({ tokenHash: 'two', password: 'Other password 2026' }),
    ])

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(a.body).toEqual({ data: { message: 'Password updated. Sign in with your new password.' } })
    expect(createAuthClient).toHaveBeenCalledTimes(2)
    expect(verifyBodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ token_hash: 'one', type: 'recovery' }),
      expect.objectContaining({ token_hash: 'two', type: 'recovery' }),
    ]))
    expect(updates).toEqual(expect.arrayContaining([
      { authorization: 'Bearer session-one', password },
      { authorization: 'Bearer session-two', password: 'Other password 2026' },
    ]))
  })

  it('validates input before consuming a token and disallows caller-provided redirects', async () => {
    const { app, createAuthClient } = appWithProvider(vi.fn())
    expect((await request(app).post(forgotPath).send({ email, redirectTo: 'https://evil.example.test' })).status).toBe(400)
    expect((await request(app).post(resetPath).send({ tokenHash: 'one', password: 'short' })).status).toBe(400)
    expect((await request(app).post(resetPath).send({ tokenHash: 'one', password: '漢'.repeat(25) })).status).toBe(400)
    expect(createAuthClient).not.toHaveBeenCalled()
  })

  it('disables password recovery without a configured provider', async () => {
    const app = createApp(createContext(loadEnv()))
    expect((await request(app).post(forgotPath).send({ email })).status).toBe(503)
    expect((await request(app).post(resetPath).send({ tokenHash: 'one', password })).status).toBe(503)
  })

  it('rejects unsafe configured redirect URLs', () => {
    for (const url of ['http://app.example.test/reset', 'https://user:pass@app.example.test', 'https://app.example.test/#']) {
      expect(() => loadEnv({ PASSWORD_RESET_REDIRECT_URL: url })).toThrow('Invalid environment configuration')
    }
    expect(loadEnv({ PASSWORD_RESET_REDIRECT_URL: redirectTo }).PASSWORD_RESET_REDIRECT_URL).toBe(redirectTo)
  })

  it('rate limits repeated email requests', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({}))
    const { app } = appWithProvider(fetch)
    for (let count = 0; count < 5; count++) {
      expect((await request(app).post(forgotPath).send({ email })).status).toBe(202)
    }
    const blocked = await request(app).post(forgotPath).send({ email })
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('rate_limited')
    expect(fetch).toHaveBeenCalledTimes(5)
  })
})
