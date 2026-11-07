import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { notFound } from '../lib/errors.js'

const commuteBody = z.object({
  origin: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
  destinationLandmarkId: z.string().trim().min(1).max(200),
  departureTime: z.iso.datetime({ offset: true }).optional().refine((value) => {
    if (!value) return true
    const delta = Date.parse(value) - Date.now()
    return delta >= -7 * 86_400_000 && delta <= 100 * 86_400_000
  }, 'Transit departureTime must be within the past 7 days or next 100 days.'),
  preference: z.enum(['LESS_WALKING', 'FEWER_TRANSFERS']).optional(),
})

export function commuteRouter(ctx: AppContext) {
  const router = Router()
  const limiter = rateLimit({
    windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many route requests. Please try again in a minute.' } },
  })

  // SRS 3.1.5: transit from the chosen origin to a known heritage landmark.
  router.post('/commute', limiter, async (req, res) => {
    const body = commuteBody.parse(req.body)
    const landmark = await ctx.store.getLandmark(body.destinationLandmarkId)
    if (!landmark) throw notFound('Destination landmark not found')
    const destination = { id: landmark.id, name: landmark.name, latitude: landmark.latitude, longitude: landmark.longitude }
    const routes = await ctx.commute.findRoutes({
      origin: body.origin, destination: { latitude: landmark.latitude, longitude: landmark.longitude },
      departureTime: body.departureTime, preference: body.preference,
    })
    res.set('Cache-Control', 'no-store')
    res.json({ data: { provider: 'google_routes', status: routes.length ? 'ok' : 'no_routes', destination, routes } })
  })
  return router
}
