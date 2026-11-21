import { createClient } from '@supabase/supabase-js'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createContext } from '../src/createApp.js'
import { loadEnv } from '../src/config/env.js'
import { createSupabaseStore } from '../src/repositories/supabaseStore.js'

let ctx: ReturnType<typeof createContext>
let app: ReturnType<typeof createApp>

beforeEach(() => {
  ctx = createContext(loadEnv())
  app = createApp(ctx)
})

describe('GET /v1/quests - Quests API (Task 41)', () => {
  describe('Unauthenticated (Guest) Access', () => {
    it('returns all quests with empty progress for guest travelers', async () => {
      const res = await request(app).get('/v1/quests')

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data.length).toBeGreaterThan(0)

      for (const quest of res.body.data) {
        expect(quest).toMatchObject({
          id: expect.any(String),
          title: expect.any(String),
          description: expect.any(String),
          badgeName: expect.any(String),
          landmarkIds: expect.any(Array),
          completedLandmarkIds: [],
          completed: false,
        })
        expect(quest.landmarkIds.length).toBeGreaterThan(0)
      }
    })

    it('returns quests sorted deterministically by title', async () => {
      const res = await request(app).get('/v1/quests')
      expect(res.status).toBe(200)

      const titles = res.body.data.map((q: { title: string }) => q.title)
      const sortedTitles = [...titles].sort((a, b) => a.localeCompare(b))
      expect(titles).toEqual(sortedTitles)
    })
  })

  describe('Authenticated Access & Progress Calculation', () => {
    const authHeader = (userId: string) => ({ Authorization: `Bearer dev:${userId}` })

    it('returns empty progress for an authenticated traveler with no visits', async () => {
      const res = await request(app)
        .get('/v1/quests')
        .set(authHeader('traveler-with-no-visits'))

      expect(res.status).toBe(200)
      for (const quest of res.body.data) {
        expect(quest.completedLandmarkIds).toEqual([])
        expect(quest.completed).toBe(false)
      }
    })

    it('tracks partial progress when some landmarks in a quest are visited', async () => {
      const userId = 'traveler-partial-progress'
      // Fort San Pedro is part of Spanish Colonial Heritage Trail and Cebu Port & Maritime Circuit
      await ctx.store.addVisit({
        userId,
        landmarkId: 'fort-san-pedro',
        source: 'manual',
        xpAwarded: 50,
      })

      const res = await request(app)
        .get('/v1/quests')
        .set(authHeader(userId))

      expect(res.status).toBe(200)

      const spanishTrail = res.body.data.find((q: { id: string }) => q.id === 'spanish-colonial-trail')
      expect(spanishTrail).toBeDefined()
      expect(spanishTrail.completedLandmarkIds).toEqual(['fort-san-pedro'])
      expect(spanishTrail.completed).toBe(false)

      const parianWalk = res.body.data.find((q: { id: string }) => q.id === 'parian-heritage-walk')
      expect(parianWalk).toBeDefined()
      expect(parianWalk.completedLandmarkIds).toEqual([])
      expect(parianWalk.completed).toBe(false)
    })

    it('marks a quest completed once all its landmarks are visited', async () => {
      const userId = 'traveler-parian-finisher'
      // Parian Heritage Walk consists of yap-sandiego-house, casa-gorordo, heritage-of-cebu-monument
      for (const landmarkId of ['yap-sandiego-house', 'casa-gorordo', 'heritage-of-cebu-monument']) {
        await ctx.store.addVisit({
          userId,
          landmarkId,
          source: 'scan',
          xpAwarded: 50,
        })
      }

      const res = await request(app)
        .get('/v1/quests')
        .set(authHeader(userId))

      expect(res.status).toBe(200)

      const parian = res.body.data.find((q: { id: string }) => q.id === 'parian-heritage-walk')
      expect(parian.completed).toBe(true)
      expect(parian.completedLandmarkIds).toEqual(
        expect.arrayContaining(['yap-sandiego-house', 'casa-gorordo', 'heritage-of-cebu-monument']),
      )
      expect(parian.completedLandmarkIds.length).toBe(3)

      // Other quests with only partial overlap remain incomplete
      const spanish = res.body.data.find((q: { id: string }) => q.id === 'spanish-colonial-trail')
      expect(spanish.completed).toBe(false)
      expect(spanish.completedLandmarkIds).toEqual(['casa-gorordo'])
    })

    it('deduplicates repeat visits to the same landmark', async () => {
      const userId = 'traveler-repeat-visitor'
      // Visiting Fort San Pedro three times
      for (let i = 0; i < 3; i++) {
        await ctx.store.addVisit({
          userId,
          landmarkId: 'fort-san-pedro',
          source: 'manual',
          xpAwarded: i === 0 ? 50 : 0,
        })
      }

      const res = await request(app)
        .get('/v1/quests')
        .set(authHeader(userId))

      expect(res.status).toBe(200)

      const portCircuit = res.body.data.find((q: { id: string }) => q.id === 'port-maritime-circuit')
      expect(portCircuit.completedLandmarkIds).toEqual(['fort-san-pedro'])
    })

    it('scopes quest progress strictly to the authenticated user', async () => {
      const userA = 'user-alice'
      const userB = 'user-bob'

      await ctx.store.addVisit({
        userId: userA,
        landmarkId: 'magellans-cross',
        source: 'manual',
        xpAwarded: 50,
      })

      const resA = await request(app).get('/v1/quests').set(authHeader(userA))
      const resB = await request(app).get('/v1/quests').set(authHeader(userB))

      const questA = resA.body.data.find((q: { id: string }) => q.id === 'spanish-colonial-trail')
      const questB = resB.body.data.find((q: { id: string }) => q.id === 'spanish-colonial-trail')

      expect(questA.completedLandmarkIds).toContain('magellans-cross')
      expect(questB.completedLandmarkIds).toEqual([])
      expect(questB.completed).toBe(false)
    })
  })

  describe('Store Parity (Supabase Store)', () => {
    it('correctly maps Supabase joined quest rows and respects title ordering', async () => {
      const fakeQuests = [
        {
          id: 'b-quest',
          title: 'Beta Quest',
          description: 'A beta quest',
          badge_name: 'Beta Badge',
          quest_landmarks: [
            { landmark_id: 'place-2', position: 2 },
            { landmark_id: 'place-1', position: 1 },
          ],
        },
        {
          id: 'a-quest',
          title: 'Alpha Quest',
          description: 'An alpha quest',
          badge_name: 'Alpha Badge',
          quest_landmarks: [{ landmark_id: 'place-3', position: 1 }],
        },
      ]

      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
        const url = new URL(String(input))
        if (url.pathname === '/rest/v1/quests') {
          expect(url.searchParams.get('order')).toBe('title.asc')
          return Response.json(fakeQuests)
        }
        return Response.json([])
      })

      const db = createClient('https://supabase.example.test', 'test-key', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch },
      })
      const api = createApp({ ...ctx, store: createSupabaseStore(db), dataSource: 'supabase' })

      const res = await request(api).get('/v1/quests')

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([
        {
          id: 'b-quest',
          title: 'Beta Quest',
          description: 'A beta quest',
          badgeName: 'Beta Badge',
          landmarkIds: ['place-1', 'place-2'],
          completedLandmarkIds: [],
          completed: false,
        },
        {
          id: 'a-quest',
          title: 'Alpha Quest',
          description: 'An alpha quest',
          badgeName: 'Alpha Badge',
          landmarkIds: ['place-3'],
          completedLandmarkIds: [],
          completed: false,
        },
      ])
    })
  })
})
