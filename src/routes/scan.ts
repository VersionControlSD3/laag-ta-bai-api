import { Router } from 'express'
import multer from 'multer'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { distanceMeters } from '../domain/geo.js'
import { badRequest } from '../lib/errors.js'
import { optionalAuth } from '../middleware/auth.js'
import { recordEngagement } from '../services/progress.js'
import { toSummary } from './landmarks.js'

// SRS 3.1.1.1.c supported formats. The 720p minimum is checked in the frontend
// before upload because decoding HEIC on the server would need a native library.
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif']
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MIN_CONFIDENCE = 0.8 // SRS 3.1.1.2.c
export const PROXIMITY_METERS = 500 // SRS 3.1.1.2.b
export const CANDIDATE_RADIUS_METERS = 1000 // SRS 3.1.1.2.c

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
})

const scanBody = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
})

export function scanRouter(ctx: AppContext) {
  const router = Router()
  const limiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false })

  router.post('/scan', limiter, optionalAuth(ctx.auth), upload.single('image'), async (req, res) => {
    const file = req.file
    if (!file) throw badRequest('Attach a photo in the "image" field.')
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      throw badRequest('Unsupported image format. Use JPEG, PNG or HEIC.')
    }
    const { lat, lng } = scanBody.parse(req.body)
    const origin = lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : undefined

    const landmarks = await ctx.store.listLandmarks()
    const ordered = origin
      ? [...landmarks].sort((a, b) => distanceMeters(origin, a) - distanceMeters(origin, b))
      : landmarks

    const result = await ctx.ai.identifyLandmark({
      image: file.buffer,
      mimeType: file.mimetype,
      candidates: ordered.map(({ id, name, district }) => ({ id, name, district })),
    })
    const match = ordered.find((l) => l.id === result.landmarkId) ?? null
    const candidates = (origin ? ordered.filter((l) => distanceMeters(origin, l) <= CANDIDATE_RADIUS_METERS) : [])
      .slice(0, 5)
      .map((l) => toSummary(l, origin))

    let status: 'identified' | 'low_confidence' | 'not_nearby' | 'unrecognized'
    if (!match) status = 'unrecognized'
    else if (result.confidence < MIN_CONFIDENCE) status = 'low_confidence'
    else if (origin && distanceMeters(origin, match) > PROXIMITY_METERS) status = 'not_nearby'
    else status = 'identified'

    const engagement =
      status === 'identified' && match && req.user
        ? await recordEngagement(ctx.store, req.user.id, match.id, 'scan', { displayName: req.user.displayName })
        : null

    res.json({
      data: {
        status,
        confidence: result.confidence,
        landmark: status === 'identified' ? match : null,
        candidates,
        progress: engagement && {
          xpAwarded: engagement.xpAwarded,
          rank: engagement.rank,
          leveledUp: engagement.leveledUp,
          newBadges: engagement.newBadges,
        },
      },
    })
  })

  return router
}
