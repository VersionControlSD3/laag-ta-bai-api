import { createClient } from '@supabase/supabase-js'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp, createContext } from '../src/createApp.js'
import { loadEnv } from '../src/config/env.js'
import { createMemoryStore } from '../src/repositories/memoryStore.js'
import { DuplicateRewardError } from '../src/repositories/store.js'
import { createSupabaseStore } from '../src/repositories/supabaseStore.js'
import { recordEngagement } from '../src/services/progress.js'

// Concurrent engagements: both requests read "no XP yet today" before either
// writes. The database (mirrored by the memory store) must reject the second
// reward, and profile XP must be added atomically.

describe('concurrent engagements', () => {
  it('awards XP once when the same landmark is engaged twice at the same moment', async () => {
    const store = createMemoryStore()
    const results = await Promise.all([
      recordEngagement(store, 'racer', 'fort-san-pedro', 'manual'),
      recordEngagement(store, 'racer', 'fort-san-pedro', 'scan'),
    ])

    expect(results.map((r) => r.xpAwarded).sort()).toEqual([0, 50])
    expect(results[0]!.visit.id).toBe(results[1]!.visit.id)
    expect((await store.getOrCreateProfile('racer')).xp).toBe(50)
    expect(await store.listVisits('racer')).toHaveLength(1)
    expect((await store.getLandmark('fort-san-pedro'))?.visitCount).toBe(1)
  })

  it('keeps both awards when different landmarks are engaged at the same moment', async () => {
    const store = createMemoryStore()
    const results = await Promise.all([
      recordEngagement(store, 'racer', 'fort-san-pedro', 'manual'),
      recordEngagement(store, 'racer', 'basilica-santo-nino', 'manual'),
    ])

    expect(results.map((r) => r.xpAwarded)).toEqual([50, 50])
    expect((await store.getOrCreateProfile('racer')).xp).toBe(100)
  })

  it('returns 201 with 50 XP total for two simultaneous check-ins over HTTP', async () => {
    const app = createApp(createContext(loadEnv()))
    const auth = { Authorization: 'Bearer dev:double-tapper' }
    const send = () => request(app).post('/v1/me/visits').set(auth).send({ landmarkId: 'casa-gorordo' })

    const [a, b] = await Promise.all([send(), send()])

    expect([a.status, b.status]).toEqual([201, 201])
    expect(a.body.data.xpAwarded + b.body.data.xpAwarded).toBe(50)
    const me = await request(app).get('/v1/me').set(auth)
    expect(me.body.data.profile.xp).toBe(50)
  })

  it('still allows unrewarded visits after the day\'s reward', async () => {
    const store = createMemoryStore()
    await store.addVisit({ userId: 'u', landmarkId: 'fort-san-pedro', source: 'manual', xpAwarded: 50 })
    await expect(
      store.addVisit({ userId: 'u', landmarkId: 'fort-san-pedro', source: 'scan', xpAwarded: 50 }),
    ).rejects.toBeInstanceOf(DuplicateRewardError)
    await expect(
      store.addVisit({ userId: 'u', landmarkId: 'fort-san-pedro', source: 'chat', xpAwarded: 0 }),
    ).resolves.toMatchObject({ xpAwarded: 0 })
  })
})

describe('failed reward writes', () => {
  it('keeps no partial state when the reward write fails, so a retry still earns XP', async () => {
    const store = createMemoryStore()
    const spy = vi.spyOn(store, 'recordReward').mockRejectedValueOnce(new Error('connection reset'))

    await expect(recordEngagement(store, 'traveler', 'fort-san-pedro', 'scan')).rejects.toThrow('connection reset')
    expect(await store.listVisits('traveler')).toEqual([])
    expect((await store.getOrCreateProfile('traveler')).xp).toBe(0)

    const retry = await recordEngagement(store, 'traveler', 'fort-san-pedro', 'scan')
    expect(retry.xpAwarded).toBe(50)
    expect((await store.getOrCreateProfile('traveler')).xp).toBe(50)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('writes nothing when the profile is missing', async () => {
    const store = createMemoryStore()
    await expect(
      store.recordReward({ userId: 'ghost', landmarkId: 'fort-san-pedro', source: 'scan', xpAwarded: 50, streakCount: 1, lastActiveDate: '2026-11-28' }),
    ).rejects.toThrow('not found')
    expect(await store.listVisits('ghost')).toEqual([])
    expect((await store.getLandmark('fort-san-pedro'))?.visitCount).toBe(0)
  })
})

describe('supabase store race guards', () => {
  function storeWith(handler: (path: string, init?: RequestInit) => Response) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url, init) => handler(new URL(String(url)).pathname, init))
    const db = createClient('https://supabase.example.test', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch },
    })
    return { store: createSupabaseStore(db), fetch }
  }

  it('maps the one-reward-per-day unique violation to DuplicateRewardError', async () => {
    const { store } = storeWith(() =>
      Response.json(
        { code: '23505', message: 'duplicate key value violates unique constraint "visits_one_reward_per_day"' },
        { status: 409 },
      ),
    )
    await expect(
      store.addVisit({ userId: 'u', landmarkId: 'l', source: 'manual', xpAwarded: 50 }),
    ).rejects.toBeInstanceOf(DuplicateRewardError)
  })

  it('does not hide other insert errors', async () => {
    const { store } = storeWith(() =>
      Response.json({ code: '42501', message: 'new row violates row-level security policy for table "visits"' }, { status: 403 }),
    )
    const error = await store.addVisit({ userId: 'u', landmarkId: 'l', source: 'manual', xpAwarded: 50 }).catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(DuplicateRewardError)
    expect(String(error)).toContain('row-level security')
  })

  it('records a reward through the transactional record_visit function', async () => {
    const { store, fetch } = storeWith((path) => {
      expect(path).toBe('/rest/v1/rpc/record_visit')
      return Response.json({
        duplicate: false,
        visit: { id: 'v1', user_id: 'u', landmark_id: 'l', source: 'scan', xp_awarded: 50, created_at: '2026-11-28T01:00:00+00:00' },
        profile: {
          id: 'u', display_name: 'T', avatar_url: null, nationality: null, bio: null, language: 'en',
          xp: 150, streak_count: 2, last_active_date: '2026-11-28', terms_accepted_at: null,
        },
      })
    })

    const saved = await store.recordReward({
      userId: 'u', landmarkId: 'l', source: 'scan', xpAwarded: 50, streakCount: 2, lastActiveDate: '2026-11-28',
    })

    expect(saved.visit).toMatchObject({ id: 'v1', landmarkId: 'l', xpAwarded: 50 })
    expect(saved.profile).toMatchObject({ xp: 150, streakCount: 2, lastActiveDate: '2026-11-28' })
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({
      p_user_id: 'u', p_landmark_id: 'l', p_source: 'scan', p_xp: 50, p_streak_count: 2, p_last_active_date: '2026-11-28',
    })
  })

  it('maps record_visit duplicate results to DuplicateRewardError', async () => {
    const { store } = storeWith(() => Response.json({ duplicate: true }))
    await expect(
      store.recordReward({ userId: 'u', landmarkId: 'l', source: 'scan', xpAwarded: 50, streakCount: 1, lastActiveDate: '2026-11-28' }),
    ).rejects.toBeInstanceOf(DuplicateRewardError)
  })
})
