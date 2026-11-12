import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp, createContext } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'

let app: ReturnType<typeof createApp>
const authUser1 = { Authorization: 'Bearer dev:traveler-one' }
const authUser2 = { Authorization: 'Bearer dev:traveler-two' }

beforeEach(() => {
  app = createApp(createContext(loadEnv()))
})

describe('POST /v1/me/saved-places - Save Place API', () => {
  describe('Authentication & Authorization', () => {
    it('rejects unauthenticated requests with 401 unauthorized', async () => {
      const res = await request(app)
        .post('/v1/me/saved-places')
        .send({ landmarkId: 'fort-san-pedro' })

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('unauthorized')
    })

    it('rejects invalid bearer tokens with 401 unauthorized', async () => {
      const res = await request(app)
        .post('/v1/me/saved-places')
        .set({ Authorization: 'Bearer invalid-token' })
        .send({ landmarkId: 'fort-san-pedro' })

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('unauthorized')
    })
  })

  describe('Validation & Not Found', () => {
    it.each([
      {},
      { landmarkId: '' },
      { landmarkId: '   ' },
      { placeId: '' },
    ])('rejects empty or missing landmark input: %j', async (body) => {
      const res = await request(app)
        .post('/v1/me/saved-places')
        .set(authUser1)
        .send(body)

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('validation_error')
    })

    it('returns 404 not_found when landmark does not exist', async () => {
      const res = await request(app)
        .post('/v1/me/saved-places')
        .set(authUser1)
        .send({ landmarkId: 'non-existent-landmark' })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('not_found')
      expect(res.body.error.message).toContain('Landmark not found')
    })
  })

  describe('Saving Places', () => {
    it('saves a place successfully and returns 201 with landmark details', async () => {
      const res = await request(app)
        .post('/v1/me/saved-places')
        .set(authUser1)
        .send({ landmarkId: 'fort-san-pedro' })

      expect(res.status).toBe(201)
      expect(res.headers['cache-control']).toBe('private, no-store')
      expect(res.body.data).toMatchObject({
        landmarkId: 'fort-san-pedro',
        userId: 'traveler-one',
        landmark: {
          id: 'fort-san-pedro',
          name: 'Fort San Pedro',
        },
      })
      expect(res.body.data.id).toBeTruthy()
      expect(new Date(res.body.data.createdAt).toISOString()).toBe(res.body.data.createdAt)
    })

    it('accepts placeId as an alias for landmarkId', async () => {
      const res = await request(app)
        .post('/v1/me/saved-places')
        .set(authUser1)
        .send({ placeId: 'magellans-cross' })

      expect(res.status).toBe(201)
      expect(res.body.data.landmarkId).toBe('magellans-cross')
      expect(res.body.data.landmark.id).toBe('magellans-cross')
    })

    it('is idempotent when saving the same place multiple times', async () => {
      const first = await request(app)
        .post('/v1/me/saved-places')
        .set(authUser1)
        .send({ landmarkId: 'basilica-santo-nino' })
      expect(first.status).toBe(201)

      const second = await request(app)
        .post('/v1/me/saved-places')
        .set(authUser1)
        .send({ landmarkId: 'basilica-santo-nino' })
      expect(second.status).toBe(201)
      expect(second.body.data.id).toBe(first.body.data.id)

      const list = await request(app)
        .get('/v1/me/saved-places')
        .set(authUser1)
      expect(list.status).toBe(200)
      const matching = list.body.data.filter((p: { landmarkId: string }) => p.landmarkId === 'basilica-santo-nino')
      expect(matching.length).toBe(1)
    })

    it('scopes saved places strictly to the authenticated user', async () => {
      await request(app)
        .post('/v1/me/saved-places')
        .set(authUser1)
        .send({ landmarkId: 'casa-gorordo' })

      const listUser1 = await request(app)
        .get('/v1/me/saved-places')
        .set(authUser1)
      expect(listUser1.body.data.some((p: { landmarkId: string }) => p.landmarkId === 'casa-gorordo')).toBe(true)

      const listUser2 = await request(app)
        .get('/v1/me/saved-places')
        .set(authUser2)
      expect(listUser2.body.data.some((p: { landmarkId: string }) => p.landmarkId === 'casa-gorordo')).toBe(false)
    })

    it('deletes a saved place cleanly with 204 No Content', async () => {
      await request(app)
        .post('/v1/me/saved-places')
        .set(authUser1)
        .send({ landmarkId: 'yap-sandiego-house' })

      const del = await request(app)
        .delete('/v1/me/saved-places/yap-sandiego-house')
        .set(authUser1)
      expect(del.status).toBe(204)

      const list = await request(app)
        .get('/v1/me/saved-places')
        .set(authUser1)
      expect(list.body.data.some((p: { landmarkId: string }) => p.landmarkId === 'yap-sandiego-house')).toBe(false)
    })

    it('supports direct /v1/saved-places POST alias with bearer authentication', async () => {
      const res = await request(app)
        .post('/v1/saved-places')
        .set(authUser1)
        .send({ landmarkId: 'museo-sugbo' })

      expect(res.status).toBe(201)
      expect(res.body.data.landmarkId).toBe('museo-sugbo')
    })
  })
})
