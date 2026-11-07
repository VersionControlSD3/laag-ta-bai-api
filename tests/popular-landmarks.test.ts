import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createContext } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'

let ctx: ReturnType<typeof createContext>
let app: ReturnType<typeof createApp>

beforeEach(() => {
  ctx = createContext(loadEnv())
  app = createApp(ctx)
})

describe('popular landmarks', () => {
  it('ranks the whole collection before limiting, with consistent ties', async () => {
    const source = await ctx.store.listLandmarks()
    vi.spyOn(ctx.store, 'listLandmarks').mockResolvedValue([
      { ...source[0]!, id: 'z', rating: 4.9, visitCount: 20 },
      { ...source[0]!, id: 'low', rating: 3, visitCount: 1000 },
      { ...source[0]!, id: 'a', rating: 4.9, visitCount: 20 },
      { ...source[0]!, id: 'many', rating: 4.9, visitCount: 50 },
    ])
    const res = await request(app).get('/v1/landmarks/popular').query({ limit: 3 })
    expect(res.status).toBe(200)
    expect(res.body.data.map((l: { id: string }) => l.id)).toEqual(['many', 'a', 'z'])
    expect(res.body.data[0].story).toBeUndefined()
    expect(res.body.data[0].distanceMeters).toBeUndefined()
  })

  it('supports filters and returns an empty list for no matches', async () => {
    const res = await request(app).get('/v1/landmarks/popular').query({ category: 'fort', q: 'san pedro' })
    expect(res.body.data.map((l: { id: string }) => l.id)).toEqual(['fort-san-pedro'])
    expect((await request(app).get('/v1/landmarks/popular').query({ q: 'no-such-place' })).body.data).toEqual([])
    expect((await request(app).get('/v1/landmarks/popular').query({ radiusKm: 5 })).status).toBe(400)
  })
})
