import { Router } from 'express'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { distanceMeters } from '../domain/geo.js'
import { LANDMARK_CATEGORIES, type Landmark, type LandmarkSummary } from '../domain/types.js'
import { notFound } from '../lib/errors.js'

const numberQuery = z.string().trim().min(1).pipe(z.coerce.number())
const latitude = numberQuery.pipe(z.number().min(-90).max(90))
const longitude = numberQuery.pipe(z.number().min(-180).max(180))
const queryFields = z.object({
  q: z.string().trim().optional(),
  category: z.enum(LANDMARK_CATEGORIES).optional(),
  free: z.enum(['true', 'false']).optional(),
  minRating: numberQuery.pipe(z.number().min(0).max(5)).optional(),
  lat: latitude.optional(),
  lng: longitude.optional(),
  radiusKm: numberQuery.pipe(z.number().positive()).optional(),
  limit: numberQuery.pipe(z.number().int().min(1).max(100)).default(50),
})

// The current frontend sends radiusKm before permission is granted. Preserve the
// original list endpoint's fallback; dedicated discovery endpoints validate strictly.
const listQuery = queryFields.refine(
  (query) => (query.lat === undefined) === (query.lng === undefined),
  'Supply lat and lng together.',
)
const nearbyQuery = queryFields.extend({
  lat: latitude,
  lng: longitude,
  radiusKm: numberQuery.pipe(z.number().positive()).default(5),
  limit: numberQuery.pipe(z.number().int().min(1).max(100)).default(10),
})
type LandmarkQuery = z.infer<typeof listQuery>

async function findLandmarks(ctx: AppContext, query: LandmarkQuery) {
  const origin = query.lat !== undefined && query.lng !== undefined
    ? { latitude: query.lat, longitude: query.lng } : undefined
  const needle = query.q?.toLowerCase()
  return (await ctx.store.listLandmarks())
    .filter((l) => !needle || `${l.name} ${l.district} ${l.category}`.toLowerCase().includes(needle))
    .filter((l) => !query.category || l.category === query.category)
    .filter((l) => query.free === undefined || (query.free === 'true') === (l.admissionFee === 0))
    .filter((l) => query.minRating === undefined || l.rating >= query.minRating)
    .map((l) => toSummary(l, origin))
    .filter((l) => !origin || query.radiusKm === undefined || l.distanceMeters! <= query.radiusKm * 1000)
}

export function toSummary(landmark: Landmark, origin?: { latitude: number; longitude: number }): LandmarkSummary {
  const { story: _story, ...summary } = landmark
  return origin ? { ...summary, distanceMeters: distanceMeters(origin, landmark) } : summary
}

export function landmarksRouter(ctx: AppContext) {
  const router = Router()

  // SRS 3.1.4.1 search/filter and 3.1.4.3.a nearby sorting.
  router.get('/landmarks', async (req, res) => {
    const query = listQuery.parse(req.query)
    const results = await findLandmarks(ctx, query)
    if (query.lat !== undefined) {
      results.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
    }

    res.json({ data: results.slice(0, query.limit) })
  })

  // Register named routes before /landmarks/:id.
  router.get('/landmarks/nearby', async (req, res) => {
    const query = nearbyQuery.parse(req.query)
    const results = await findLandmarks(ctx, query)
    results.sort((a, b) => a.distanceMeters! - b.distanceMeters! || a.id.localeCompare(b.id))
    res.json({ data: results.slice(0, query.limit) })
  })

  router.get('/landmarks/:id', async (req, res) => {
    const landmark = await ctx.store.getLandmark(req.params.id)
    if (!landmark) throw notFound('Landmark not found')
    res.json({ data: landmark })
  })

  return router
}
