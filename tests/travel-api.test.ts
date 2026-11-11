import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp, createContext } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'

let ctx: ReturnType<typeof createContext>
let app: ReturnType<typeof createApp>
beforeEach(() => {
  ctx = createContext(loadEnv())
  app = createApp(ctx)
})
const origin = { lat: '10.2937', lng: '123.9020' }

describe('nearby landmarks', () => {
  it('limits the radius, returns distances and sorts before applying the limit', async () => {
    const res = await request(app).get('/v1/landmarks/nearby').query({ ...origin, radiusKm: 0.5, limit: 3 })
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    expect(res.body.data.length).toBeLessThanOrEqual(3)
    expect(res.body.data[0].id).toBe('magellans-cross')
    const distances = res.body.data.map((l: { distanceMeters: number; story?: unknown }) => {
      expect(l.story).toBeUndefined()
      expect(l.distanceMeters).toBeLessThanOrEqual(500)
      return l.distanceMeters
    })
    expect(distances).toEqual([...distances].sort((a, b) => a - b))
  })

  it('supports category, rating, free admission and search filters', async () => {
    const res = await request(app).get('/v1/landmarks/nearby').query({
      ...origin, category: 'monument', free: true, minRating: 4, q: 'magellan',
    })
    expect(res.status).toBe(200)
    expect(res.body.data.map((l: { id: string }) => l.id)).toEqual(['magellans-cross'])
  })

  it('returns an empty list when the radius contains no landmarks', async () => {
    const res = await request(app).get('/v1/landmarks/nearby').query({ lat: 0, lng: 0 })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it.each([
    {}, { lat: 10 }, { lng: 123 }, { ...origin, lat: '' }, { ...origin, lat: 91 },
    { ...origin, lng: 181 }, { ...origin, radiusKm: 0 }, { ...origin, limit: 101 },
    { ...origin, limit: 1.5 }, { ...origin, lat: ['10', '11'] },
  ])('rejects missing or invalid location queries: %j', async (query) => {
    const res = await request(app).get('/v1/landmarks/nearby').query(query)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('validation_error')
  })

  it.each([{ lat: 10 }, { lat: '', lng: 123 }])('validates coordinate pairs on the original endpoint too: %j', async (query) => {
    expect((await request(app).get('/v1/landmarks').query(query)).status).toBe(400)
  })

  it('preserves the current frontend fallback before coordinates are available', async () => {
    const res = await request(app).get('/v1/landmarks').query({ radiusKm: 5, limit: 10 })
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    expect(res.body.data[0].distanceMeters).toBeUndefined()
  })
})
