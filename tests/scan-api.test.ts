import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createContext } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'
import { ALLOWED_IMAGE_TYPES } from '../src/routes/scan.js'

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
})
