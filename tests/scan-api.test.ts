import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createContext } from '../src/createApp.js'
import { loadEnv } from '../src/config/env.js'
import { LANDMARKS } from '../src/data/seed.js'
import { ALLOWED_IMAGE_TYPES, findDuplicate, nameTokens } from '../src/routes/scan.js'

let ctx: ReturnType<typeof createContext>
let app: ReturnType<typeof createApp>

const auth = { Authorization: 'Bearer dev:traveler-juan' }

// Smallest valid 1x1 PNG.
const PNG_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

// Magellan's Cross coordinates (~10.2937, 123.9020).
const AT_MAGELLAN = { lat: '10.2937', lng: '123.9020' }
// Remote coordinates far from any Cebu landmark (e.g., in the sea / out of range).
const FAR_AWAY = { lat: '11.0000', lng: '124.5000' }

beforeEach(() => {
  ctx = createContext(loadEnv())
  app = createApp(ctx)
})

describe('POST /v1/scan - Scan-to-Story API', () => {
  describe('Landmark Identification & Status', () => {
    it('identifies landmark within 500m with high confidence and awards XP to authenticated user', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: 'magellans-cross',
        confidence: 0.95,
      })

      const res = await request(app)
        .post('/v1/scan')
        .set(auth)
        .field('lat', AT_MAGELLAN.lat)
        .field('lng', AT_MAGELLAN.lng)
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

      expect(res.status).toBe(200)
      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.body.data.status).toBe('identified')
      expect(res.body.data.confidence).toBe(0.95)
      expect(res.body.data.landmark).toMatchObject({
        id: 'magellans-cross',
        name: "Magellan's Cross",
      })
      expect(res.body.data.candidates).toEqual([])
      expect(res.body.data.progress).toMatchObject({
        xpAwarded: 50,
        leveledUp: false,
      })
    })

    it('awards 0 XP on duplicate scans of the same landmark on the same calendar day', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: 'magellans-cross',
        confidence: 0.95,
      })

      const first = await request(app)
        .post('/v1/scan')
        .set(auth)
        .field('lat', AT_MAGELLAN.lat)
        .field('lng', AT_MAGELLAN.lng)
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })
      expect(first.body.data.progress.xpAwarded).toBe(50)

      const second = await request(app)
        .post('/v1/scan')
        .set(auth)
        .field('lat', AT_MAGELLAN.lat)
        .field('lng', AT_MAGELLAN.lng)
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })
      expect(second.body.data.progress.xpAwarded).toBe(0)
    })

    it('identifies landmark for unauthenticated guest without awarding XP', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: 'magellans-cross',
        confidence: 0.92,
      })

      const res = await request(app)
        .post('/v1/scan')
        .field('lat', AT_MAGELLAN.lat)
        .field('lng', AT_MAGELLAN.lng)
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('identified')
      expect(res.body.data.landmark.id).toBe('magellans-cross')
      expect(res.body.data.progress).toBeNull()
    })

    it('identifies landmark when location coordinates are omitted', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: 'fort-san-pedro',
        confidence: 0.9,
      })

      const res = await request(app)
        .post('/v1/scan')
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('identified')
      expect(res.body.data.landmark.id).toBe('fort-san-pedro')
      expect(res.body.data.candidates).toEqual([])
    })

    it('returns low_confidence status and candidates within 1km when confidence is below 0.8', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: 'magellans-cross',
        confidence: 0.74,
      })

      const res = await request(app)
        .post('/v1/scan')
        .field('lat', AT_MAGELLAN.lat)
        .field('lng', AT_MAGELLAN.lng)
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('low_confidence')
      expect(res.body.data.confidence).toBe(0.74)
      expect(res.body.data.landmark).toBeNull()
      expect(res.body.data.progress).toBeNull()
      expect(res.body.data.candidates.length).toBeGreaterThan(0)
      expect(res.body.data.candidates[0].id).toBe('magellans-cross')
      expect(res.body.data.candidates[0].distanceMeters).toBeLessThanOrEqual(1000)
    })

    it('returns not_nearby status when identified landmark is beyond 500m from GPS location', async () => {
      // User is at Magellan's Cross (~10.2937, 123.9020), but photo matches Taoist Temple (~10.3344, 123.8878, ~5 km away).
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: 'taoist-temple',
        confidence: 0.95,
      })

      const res = await request(app)
        .post('/v1/scan')
        .field('lat', AT_MAGELLAN.lat)
        .field('lng', AT_MAGELLAN.lng)
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('not_nearby')
      expect(res.body.data.landmark).toBeNull()
      expect(res.body.data.progress).toBeNull()
      // Candidates should be near the user's GPS (Magellan area), not the remote matched site
      expect(res.body.data.candidates.some((c: { id: string }) => c.id === 'magellans-cross')).toBe(true)
    })

    it('returns unrecognized status when AI does not match any landmark', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: null,
        confidence: 0.2,
      })

      const res = await request(app)
        .post('/v1/scan')
        .field('lat', AT_MAGELLAN.lat)
        .field('lng', AT_MAGELLAN.lng)
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('unrecognized')
      expect(res.body.data.landmark).toBeNull()
      expect(res.body.data.candidates.length).toBeGreaterThan(0)
    })

    it('returns empty candidates array when no landmarks are within 1km', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: null,
        confidence: 0.1,
      })

      const res = await request(app)
        .post('/v1/scan')
        .field('lat', FAR_AWAY.lat)
        .field('lng', FAR_AWAY.lng)
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('unrecognized')
      expect(res.body.data.candidates).toEqual([])
    })
  })

  describe('Validation & Format Handling', () => {
    it('rejects requests missing an image', async () => {
      const res = await request(app)
        .post('/v1/scan')
        .field('lat', AT_MAGELLAN.lat)
        .field('lng', AT_MAGELLAN.lng)

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('bad_request')
      expect(res.body.error.message).toContain('Attach a photo')
    })

    it('rejects unsupported image formats', async () => {
      const res = await request(app)
        .post('/v1/scan')
        .attach('image', Buffer.from('GIF89a...'), { filename: 'test.gif', contentType: 'image/gif' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('bad_request')
      expect(res.body.error.message).toContain('Unsupported image format')
    })

    it.each(ALLOWED_IMAGE_TYPES)('accepts supported image format: %s', async (mimeType) => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: 'magellans-cross',
        confidence: 0.9,
      })

      const res = await request(app)
        .post('/v1/scan')
        .attach('image', PNG_IMAGE, { filename: 'sample.img', contentType: mimeType })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('identified')
    })

    it.each([
      { lat: '10.29' },
      { lng: '123.90' },
      { lat: '', lng: '123.90' },
      { lat: '10.29', lng: '' },
      { lat: '91', lng: '123.90' },
      { lat: '-91', lng: '123.90' },
      { lat: '10.29', lng: '181' },
      { lat: '10.29', lng: '-181' },
      { lat: 'invalid', lng: '123.90' },
    ])('rejects invalid or incomplete coordinates: %j', async (coords) => {
      let req = request(app).post('/v1/scan')
      for (const [k, v] of Object.entries(coords)) {
        req = req.field(k, v)
      }
      const res = await req.attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('validation_error')
    })
  })

  describe('Resilience & Rate Limiting', () => {
    it('returns HTTP 503 ai_unavailable when AI service fails without leaking internals', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockRejectedValue(new Error('Internal gemini timeout / quota leak'))

      const res = await request(app)
        .post('/v1/scan')
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

      expect(res.status).toBe(503)
      expect(res.body.error.code).toBe('ai_unavailable')
      expect(JSON.stringify(res.body)).not.toContain('Internal gemini timeout')
    })

    it('returns HTTP 429 JSON contract when rate limited (20 req/min)', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: 'magellans-cross',
        confidence: 0.9,
      })

      for (let i = 0; i < 20; i++) {
        const res = await request(app)
          .post('/v1/scan')
          .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })
        expect(res.status).toBe(200)
      }

      const throttled = await request(app)
        .post('/v1/scan')
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

      expect(throttled.status).toBe(429)
      expect(throttled.body.error.code).toBe('rate_limited')
    })
  })

  describe('Dynamic AI Discovery of Uncurated Landmarks', () => {
    it('discovers and automatically saves an uncurated Cebu landmark to the database', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: null,
        confidence: 0.94,
        discovered: {
          name: 'Cebu Provincial Capitol',
          category: 'monument',
          district: 'Capitol Site, Cebu City',
          latitude: 10.3168,
          longitude: 123.8907,
          visitingHours: '8:00 AM - 5:00 PM',
          admissionFee: 0,
          estimatedVisitMinutes: 40,
          story: {
            about: 'The seat of the provincial government of Cebu, designed by Juan M. Arellano.',
            significance: 'One of the finest Art Deco government buildings in the Philippines, built in 1937.',
            architecture: 'Neoclassical and Art Deco fusion featuring a semicircular colonnade and high central dome.',
            trivia: 'Its facade bears the inscription: "The authority of the government emanates from the people."',
          },
        },
      })

      const res = await request(app)
        .post('/v1/scan')
        .set(auth)
        .field('lat', '10.3168')
        .field('lng', '123.8907')
        .attach('image', PNG_IMAGE, { filename: 'capitol.png', contentType: 'image/png' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('identified')
      expect(res.body.data.confidence).toBe(0.94)
      expect(res.body.data.landmark).toMatchObject({
        id: 'cebu-provincial-capitol',
        name: 'Cebu Provincial Capitol',
        category: 'monument',
        district: 'Capitol Site, Cebu City',
        latitude: 10.3168,
        longitude: 123.8907,
        story: {
          about: expect.stringContaining('seat of the provincial government'),
        },
      })
      expect(res.body.data.progress).toMatchObject({
        xpAwarded: 50,
      })

      // The new landmark should now be in the store and queryable
      const fetched = await ctx.store.getLandmark('cebu-provincial-capitol')
      expect(fetched).not.toBeNull()
      expect(fetched?.name).toBe('Cebu Provincial Capitol')

      // It should also work on the GET /v1/landmarks/:id endpoint
      const detailRes = await request(app).get('/v1/landmarks/cebu-provincial-capitol')
      expect(detailRes.status).toBe(200)
      expect(detailRes.body.data.name).toBe('Cebu Provincial Capitol')

      // It should also be conversational via POST /v1/chat
      const chatRes = await request(app)
        .post('/v1/chat')
        .send({
          landmarkId: 'cebu-provincial-capitol',
          messages: [{ role: 'user', content: 'What style is this building?' }],
        })
      expect(chatRes.status).toBe(200)
      expect(chatRes.body.data.message.role).toBe('model')
    })

    it('reuses existing landmark record if an uncurated landmark was already discovered', async () => {
      // First save it
      await ctx.store.saveLandmark({
        id: 'sirao-flower-garden',
        name: 'Sirao Flower Garden',
        category: 'monument',
        district: 'Busay, Cebu City',
        latitude: 10.4284,
        longitude: 123.8687,
        imageUrl: null,
        admissionFee: 100,
        rating: 4.5,
        visitCount: 5,
        estimatedVisitMinutes: 60,
        visitingHours: '6:00 AM - 6:30 PM',
        story: {
          about: 'A scenic flower farm known as the Little Amsterdam of Cebu.',
          significance: 'Popularized celosia flowers in Cebu tourism.',
          architecture: 'Terraced flower gardens with windmills and viewing decks.',
          trivia: 'The farm started in 2015 when visitors began flocking to take photos before harvest.',
        },
      })

      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: null,
        confidence: 0.91,
        discovered: {
          name: 'Sirao Flower Garden',
          category: 'monument',
          district: 'Busay, Cebu City',
          story: {
            about: 'New scan story.',
            significance: 'Significance.',
            architecture: 'Architecture.',
            trivia: 'Trivia.',
          },
        },
      })

      const res = await request(app)
        .post('/v1/scan')
        .set(auth)
        .field('lat', '10.4284')
        .field('lng', '123.8687')
        .attach('image', PNG_IMAGE, { filename: 'sirao.png', contentType: 'image/png' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('identified')
      expect(res.body.data.landmark.id).toBe('sirao-flower-garden')
      expect(res.body.data.landmark.name).toBe('Sirao Flower Garden')
      expect(res.body.data.landmark.story.about).toBe('A scenic flower farm known as the Little Amsterdam of Cebu.')
    })

    it('returns unrecognized when image is not a Cebu landmark (discovered is null)', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: null,
        confidence: 0.25,
        discovered: null,
      })

      const res = await request(app)
        .post('/v1/scan')
        .attach('image', PNG_IMAGE, { filename: 'shoes.png', contentType: 'image/png' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('unrecognized')
      expect(res.body.data.landmark).toBeNull()
    })
  })

  describe('Regression: staging 500s on authenticated scans (#50)', () => {
    const story = {
      about: 'About.',
      significance: 'Significance.',
      architecture: 'Architecture.',
      trivia: 'Trivia.',
    }

    it('still returns the identified landmark when recording XP fails', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({ landmarkId: 'magellans-cross', confidence: 0.95 })
      vi.spyOn(ctx.store, 'recordReward').mockRejectedValue(new Error('Supabase query failed: connection reset'))
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await request(app)
        .post('/v1/scan')
        .set(auth)
        .field('lat', AT_MAGELLAN.lat)
        .field('lng', AT_MAGELLAN.lng)
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('identified')
      expect(res.body.data.landmark.id).toBe('magellans-cross')
      expect(res.body.data.progress).toBeNull()
    })

    it('does not insert a duplicate visit for a same-day repeat scan', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({ landmarkId: 'magellans-cross', confidence: 0.95 })
      const recordReward = vi.spyOn(ctx.store, 'recordReward')
      for (let i = 0; i < 2; i++) {
        await request(app)
          .post('/v1/scan')
          .set(auth)
          .field('lat', AT_MAGELLAN.lat)
          .field('lng', AT_MAGELLAN.lng)
          .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })
      }
      expect(recordReward).toHaveBeenCalledTimes(1)
      expect((await ctx.store.getLandmark('magellans-cross'))?.visitCount).toBe(1)
    })

    it('matches a discovered landmark to a nearby catalogued one instead of saving a duplicate', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: null,
        confidence: 0.92,
        discovered: { name: "Magellan's Cross Kiosk", category: 'monument', district: 'Cebu City', story },
      })
      const saveLandmark = vi.spyOn(ctx.store, 'saveLandmark')

      const res = await request(app)
        .post('/v1/scan')
        .set(auth)
        .field('lat', AT_MAGELLAN.lat)
        .field('lng', AT_MAGELLAN.lng)
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('identified')
      expect(res.body.data.landmark.id).toBe('magellans-cross')
      expect(saveLandmark).not.toHaveBeenCalled()
    })

    it('stores safe numbers when Gemini returns non-numeric or fractional details', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: null,
        confidence: 0.9,
        discovered: {
          name: 'Cebu Provincial Capitol',
          category: 'monument',
          district: 'Capitol Site, Cebu City',
          admissionFee: 'free' as unknown as number,
          estimatedVisitMinutes: 37.6,
          story,
        },
      })

      const res = await request(app)
        .post('/v1/scan')
        .set(auth)
        .field('lat', '10.3168')
        .field('lng', '123.8907')
        .attach('image', PNG_IMAGE, { filename: 'capitol.png', contentType: 'image/png' })

      expect(res.status).toBe(200)
      expect(res.body.data.landmark).toMatchObject({ admissionFee: 0, estimatedVisitMinutes: 38 })
    })
  })

  describe('Duplicate detection for discovered landmarks (PR review)', () => {
    const MAGELLAN = { latitude: 10.29365, longitude: 123.90199 }
    const CASA_GORORDO = { latitude: 10.29638, longitude: 123.90432 }

    it.each([
      "Magellan's Cross Kiosk",
      'Magellans Cross Kiosk',
      'Magellan’s Cross Kiosk',
      "MAGELLAN'S CROSS",
    ])('matches %s to magellans-cross', (name) => {
      expect(findDuplicate(LANDMARKS, name, MAGELLAN)?.id).toBe('magellans-cross')
    })

    it('folds possessives and plurals the same way on both sides', () => {
      expect(nameTokens("Magellan's Cross")).toEqual(nameTokens('Magellans Cross'))
      expect(nameTokens('Magellans Cross')).toEqual(new Set(['magellan', 'cross']))
    })

    it('does not match on a generic word alone', () => {
      expect(findDuplicate(LANDMARKS, 'Cebu City Museum', CASA_GORORDO)).toBeNull()
      expect(findDuplicate(LANDMARKS, 'Museum', CASA_GORORDO)).toBeNull()
    })

    it('still matches a variant that shares a distinctive word', () => {
      expect(findDuplicate(LANDMARKS, 'Casa Gorordo', CASA_GORORDO)?.id).toBe('casa-gorordo')
    })

    it('saves Cebu City Museum as a new landmark instead of crediting Casa Gorordo', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: null,
        confidence: 0.9,
        discovered: {
          name: 'Cebu City Museum',
          category: 'museum',
          district: 'Cebu City',
          story: { about: 'A.', significance: 'S.', architecture: 'Ar.', trivia: 'T.' },
        },
      })

      const res = await request(app)
        .post('/v1/scan')
        .set(auth)
        .field('lat', String(CASA_GORORDO.latitude))
        .field('lng', String(CASA_GORORDO.longitude))
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

      expect(res.body.data.landmark.id).toBe('cebu-city-museum')
    })

    it('checks the full catalog for duplicates', async () => {
      vi.spyOn(ctx.ai, 'identifyLandmark').mockResolvedValue({
        landmarkId: null,
        confidence: 0.92,
        discovered: {
          name: 'Magellans Cross Kiosk',
          category: 'monument',
          district: 'Cebu City',
          story: { about: 'A.', significance: 'S.', architecture: 'Ar.', trivia: 'T.' },
        },
      })
      const listLandmarks = vi.spyOn(ctx.store, 'listLandmarks')

      const res = await request(app)
        .post('/v1/scan')
        .set(auth)
        .field('lat', String(MAGELLAN.latitude))
        .field('lng', String(MAGELLAN.longitude))
        .attach('image', PNG_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

      expect(res.body.data.landmark.id).toBe('magellans-cross')
      expect(listLandmarks).toHaveBeenCalledWith({ allPages: true })
    })
  })
})
