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

describe('GET /v1/landmarks/:id - Landmark Details API (Task 40)', () => {
  describe('Successful Retrieval', () => {
    it('returns full landmark details including categorized story for a valid ID', async () => {
      const res = await request(app).get('/v1/landmarks/magellans-cross')

      expect(res.status).toBe(200)
      expect(res.body.data).toMatchObject({
        id: 'magellans-cross',
        name: "Magellan's Cross",
        category: 'monument',
        district: 'Cebu City (Downtown)',
        latitude: expect.any(Number),
        longitude: expect.any(Number),
        admissionFee: expect.any(Number),
        rating: expect.any(Number),
        visitCount: expect.any(Number),
        estimatedVisitMinutes: expect.any(Number),
        visitingHours: expect.any(String),
      })

      // Detailed story structure according to SRS 3.1.1.3 and 3.1.1.4
      const { story } = res.body.data
      expect(story).toBeDefined()
      expect(typeof story.about).toBe('string')
      expect(story.about.length).toBeGreaterThan(10)
      expect(typeof story.significance).toBe('string')
      expect(story.significance.length).toBeGreaterThan(10)
      expect(typeof story.architecture).toBe('string')
      expect(story.architecture.length).toBeGreaterThan(10)
      expect(typeof story.trivia).toBe('string')
      expect(story.trivia.length).toBeGreaterThan(10)

      // When no coordinates are supplied, distanceMeters should be undefined
      expect(res.body.data.distanceMeters).toBeUndefined()
    })

    it('calculates distanceMeters when valid coordinates are provided', async () => {
      // Nearby coordinates (roughly 100 meters away)
      const res = await request(app)
        .get('/v1/landmarks/magellans-cross')
        .query({ lat: 10.2937, lng: 123.9020 })

      expect(res.status).toBe(200)
      expect(res.body.data.id).toBe('magellans-cross')
      expect(typeof res.body.data.distanceMeters).toBe('number')
      expect(res.body.data.distanceMeters).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Validation & Error Handling', () => {
    it('returns 404 when the landmark does not exist', async () => {
      const res = await request(app).get('/v1/landmarks/unknown-landmark-slug')

      expect(res.status).toBe(404)
      expect(res.body).toEqual({
        error: {
          code: 'not_found',
          message: 'Landmark not found',
        },
      })
    })

    it('rejects empty or whitespace-only landmark ID with validation_error', async () => {
      const res = await request(app).get('/v1/landmarks/%20%20')

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('validation_error')
    })

    it('rejects coordinates when only latitude is supplied', async () => {
      const res = await request(app)
        .get('/v1/landmarks/magellans-cross')
        .query({ lat: 10.2937 })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('validation_error')
      expect(res.body.error.details[0].message).toBe('Supply lat and lng together.')
    })

    it('rejects coordinates when only longitude is supplied', async () => {
      const res = await request(app)
        .get('/v1/landmarks/magellans-cross')
        .query({ lng: 123.9020 })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('validation_error')
      expect(res.body.error.details[0].message).toBe('Supply lat and lng together.')
    })

    it('rejects out-of-range coordinates', async () => {
      const invalidLat = await request(app)
        .get('/v1/landmarks/magellans-cross')
        .query({ lat: 95, lng: 123.9020 })

      expect(invalidLat.status).toBe(400)
      expect(invalidLat.body.error.code).toBe('validation_error')

      const invalidLng = await request(app)
        .get('/v1/landmarks/magellans-cross')
        .query({ lat: 10.2937, lng: 190 })

      expect(invalidLng.status).toBe(400)
      expect(invalidLng.body.error.code).toBe('validation_error')
    })

    it('rejects non-numeric coordinates', async () => {
      const res = await request(app)
        .get('/v1/landmarks/magellans-cross')
        .query({ lat: 'abc', lng: 'xyz' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('validation_error')
    })
  })

  describe('Store Parity (Supabase Store)', () => {
    it('correctly maps Supabase columns and returns full landmark data', async () => {
      const fakeRow = {
        id: 'temple-of-leah',
        name: 'Temple of Leah',
        category: 'temple',
        district: 'Busay',
        latitude: '10.3688',
        longitude: '123.8683',
        image_url: 'https://example.com/temple.jpg',
        admission_fee: '150',
        rating: '4.5',
        visit_count: 320,
        estimated_visit_minutes: 60,
        visiting_hours: '6:00 AM - 11:00 PM',
        story: {
          about: 'A Roman-style temple built as a symbol of undying love.',
          significance: 'Built by Teodorico Soriano Adarna in honor of his wife Leah.',
          architecture: 'Greek-Roman architecture with 24 chambers, lion statues and grand staircase.',
          trivia: 'Contains a museum, art gallery, and library housing Leah Albino-Adarna personal treasures.',
        },
      }

      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
        const url = new URL(String(input))
        expect(url.pathname).toBe('/rest/v1/landmarks')
        expect(url.searchParams.get('id')).toBe('eq.temple-of-leah')
        return Response.json([fakeRow])
      })

      const db = createClient('https://supabase.example.test', 'test-key', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch },
      })
      const api = createApp({ ...ctx, store: createSupabaseStore(db), dataSource: 'supabase' })

      const res = await request(api).get('/v1/landmarks/temple-of-leah')

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual({
        id: 'temple-of-leah',
        name: 'Temple of Leah',
        category: 'temple',
        district: 'Busay',
        latitude: 10.3688,
        longitude: 123.8683,
        imageUrl: 'https://example.com/temple.jpg',
        admissionFee: 150,
        rating: 4.5,
        visitCount: 320,
        estimatedVisitMinutes: 60,
        visitingHours: '6:00 AM - 11:00 PM',
        story: fakeRow.story,
      })
    })

    it('returns 404 when Supabase finds no matching row', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
        return Response.json([])
      })

      const db = createClient('https://supabase.example.test', 'test-key', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch },
      })
      const api = createApp({ ...ctx, store: createSupabaseStore(db), dataSource: 'supabase' })

      const res = await request(api).get('/v1/landmarks/ghost-place')

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('not_found')
    })
  })
})
