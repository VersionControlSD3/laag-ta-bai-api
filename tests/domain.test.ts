import { describe, expect, it } from 'vitest'
import { loadEnv } from '../src/config/env.js'
import { distanceMeters } from '../src/domain/geo.js'
import { nextStreak, rankFor } from '../src/domain/xp.js'
import { withRetry } from '../src/lib/retry.js'

describe('rankFor', () => {
  it('starts at level 1 and reports the next threshold', () => {
    expect(rankFor(0)).toMatchObject({ level: 1, title: 'Newcomer', nextLevelXp: 200 })
  })
  it('promotes at the threshold', () => {
    expect(rankFor(200).level).toBe(2)
    expect(rankFor(199).level).toBe(1)
  })
  it('has no next level at the top rank', () => {
    expect(rankFor(99_999).nextLevelXp).toBeNull()
  })
})

describe('nextStreak', () => {
  const now = new Date('2026-10-17T04:00:00Z') // 12:00 PHT
  it('continues a streak from yesterday', () => {
    expect(nextStreak({ streakCount: 3, lastActiveDate: '2026-10-16' }, now)).toEqual({
      streakCount: 4,
      lastActiveDate: '2026-10-17',
    })
  })
  it('keeps the streak on the same day', () => {
    expect(nextStreak({ streakCount: 4, lastActiveDate: '2026-10-17' }, now).streakCount).toBe(4)
  })
  it('resets after a missed day', () => {
    expect(nextStreak({ streakCount: 9, lastActiveDate: '2026-10-10' }, now).streakCount).toBe(1)
  })
})

describe('distanceMeters', () => {
  it('measures Magellan’s Cross to Fort San Pedro at roughly 450 m', () => {
    const d = distanceMeters({ latitude: 10.29365, longitude: 123.90199 }, { latitude: 10.29236, longitude: 123.90581 })
    expect(d).toBeGreaterThan(400)
    expect(d).toBeLessThan(500)
  })
})

describe('withRetry', () => {
  it('retries until success', async () => {
    let calls = 0
    const result = await withRetry(
      async () => {
        calls++
        if (calls < 3) throw new Error('flaky')
        return 'ok'
      },
      { baseDelayMs: 1 },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })
  it('gives up after the last attempt', async () => {
    await expect(withRetry(async () => Promise.reject(new Error('down')), { baseDelayMs: 1 })).rejects.toThrow('down')
  })
})

describe('loadEnv', () => {
  it('defaults to the memory store without Supabase settings', () => {
    expect(loadEnv({}).dataSource).toBe('memory')
  })
  it('refuses to run production without Supabase', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/Production must use Supabase/)
  })
  it('never enables dev auth in production', () => {
    const env = loadEnv({ NODE_ENV: 'production', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'k' })
    expect(env.devAuthEnabled).toBe(false)
  })
})

describe('memoryStore user account operations', () => {
  it('creates user account, provisions profile, and prevents duplicate emails', async () => {
    const { createMemoryStore } = await import('../src/repositories/memoryStore.js')
    const store = createMemoryStore()

    const user = await store.createUserAccount!({
      email: 'traveler@example.com',
      passwordHash: 'hashed-secret',
      displayName: 'Cebu Explorer',
    })

    expect(user.id).toBeDefined()
    expect(user.email).toBe('traveler@example.com')
    expect(user.displayName).toBe('Cebu Explorer')

    // Profile should be automatically created (matching the DB trigger behavior)
    const profile = await store.getOrCreateProfile(user.id)
    expect(profile.displayName).toBe('Cebu Explorer')
    expect(profile.xp).toBe(0)

    // Querying by email and id
    const foundByEmail = await store.findUserAccountByEmail!('Traveler@example.com')
    expect(foundByEmail?.id).toBe(user.id)
    expect(foundByEmail?.passwordHash).toBe('hashed-secret')

    const foundById = await store.findUserAccountById!(user.id)
    expect(foundById?.email).toBe('traveler@example.com')

    // Duplicate email rejected
    await expect(
      store.createUserAccount!({
        email: 'traveler@example.com',
        passwordHash: 'another-hash',
        displayName: 'Imposter',
      }),
    ).rejects.toThrow(/User already exists/)
  })
})

