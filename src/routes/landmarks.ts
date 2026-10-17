import { Router } from 'express'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { distanceMeters } from '../domain/geo.js'
import { LANDMARK_CATEGORIES, type Landmark, type LandmarkSummary } from '../domain/types.js'
import { notFound } from '../lib/errors.js'

const listQuery = z.object({
  q: z.string().trim().optional(),
  category: z.enum(LANDMARK_CATEGORIES).optional(),
  free: z.enum(['true', 'false']).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export function toSummary(landmark: Landmark, origin?: { latitude: number; longitude: number }): LandmarkSummary {
  const { story: _story, ...summary } = landmark
  return origin ? { ...summary, distanceMeters: distanceMeters(origin, landmark) } : summary
}

export function landmarksRouter(ctx: AppContext) {
  const router = Router()

  // SRS 3.1.4.1 search/filter and 3.1.4.3.a nearby sorting.
  router.get('/landmarks', async (req, res) => {
    const query = listQuery.parse(req.query)
    const origin =
      query.lat !== undefined && query.lng !== undefined ? { latitude: query.lat, longitude: query.lng } : undefined
    const needle = query.q?.toLowerCase()

    let results = (await ctx.store.listLandmarks())
      .filter((l) => !needle || `${l.name} ${l.district} ${l.category}`.toLowerCase().includes(needle))
      .filter((l) => !query.category || l.category === query.category)
      .filter((l) => query.free === undefined || (query.free === 'true') === (l.admissionFee === 0))
      .filter((l) => query.minRating === undefined || l.rating >= query.minRating)
      .map((l) => toSummary(l, origin))

    if (origin) {
      if (query.radiusKm) results = results.filter((l) => (l.distanceMeters ?? 0) <= query.radiusKm! * 1000)
      results.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
    }

    res.json({ data: results.slice(0, query.limit) })
  })

  router.get('/landmarks/:id', async (req, res) => {
    const landmark = await ctx.store.getLandmark(req.params.id)
    if (!landmark) throw notFound('Landmark not found')
    res.json({ data: landmark })
  })

  return router
}
