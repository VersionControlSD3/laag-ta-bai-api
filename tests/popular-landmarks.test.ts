import { createClient } from '@supabase/supabase-js'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createContext } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'
import { createSupabaseStore } from '../src/repositories/supabaseStore.js'

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

  it('finds the highest-rated landmark beyond a Supabase page capped below the requested size', async () => {
    const firstRow = {
      id: 'a', name: 'First landmark', category: 'church', district: 'Cebu City',
      latitude: 10.29, longitude: 123.9, admission_fee: 0, rating: 4, visit_count: 100,
    }
    const bestRow = { ...firstRow, id: 'b', name: 'Highest rated landmark', rating: 5 }
    const cursors: (string | null)[] = []
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/rest/v1/landmarks')
      expect(url.searchParams.get('order')).toBe('id.asc')
      expect(url.searchParams.get('limit')).toBe('500')
      const cursor = url.searchParams.get('id')
      cursors.push(cursor)
      // Simulate a server-side cap of one row, regardless of the requested size.
      if (cursor === null) return Response.json([firstRow])
      if (cursor === 'gt.a') return Response.json([bestRow])
      return Response.json([])
    })
    const db = createClient('https://supabase.example.test', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch },
    })
    const api = createApp({ ...ctx, store: createSupabaseStore(db), dataSource: 'supabase' })

    const res = await request(api).get('/v1/landmarks/popular').query({ limit: 1 })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([expect.objectContaining({ id: 'b', rating: 5 })])
    expect(cursors).toEqual([null, 'gt.a', 'gt.b'])
  })

  it('supports filters and returns an empty list for no matches', async () => {
    const res = await request(app).get('/v1/landmarks/popular').query({ category: 'fort', q: 'san pedro' })
    expect(res.body.data.map((l: { id: string }) => l.id)).toEqual(['fort-san-pedro'])
    expect((await request(app).get('/v1/landmarks/popular').query({ q: 'no-such-place' })).body.data).toEqual([])
    expect((await request(app).get('/v1/landmarks/popular').query({ radiusKm: 5 })).status).toBe(400)
  })
})
