import { Router } from 'express'
import multer from 'multer'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { distanceMeters } from '../domain/geo.js'
import { LANDMARK_CATEGORIES, type Landmark } from '../domain/types.js'
import { badRequest, HttpError } from '../lib/errors.js'
import { optionalAuth } from '../middleware/auth.js'
import { tryRecordEngagement } from '../services/progress.js'
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

const coordinateNumber = z.union([
  z.number(),
  z.string().trim().min(1).pipe(z.coerce.number()),
])
const latitude = coordinateNumber.pipe(z.number().min(-90).max(90))
const longitude = coordinateNumber.pipe(z.number().min(-180).max(180))

const scanBody = z
  .object({
    lat: latitude.optional(),
    lng: longitude.optional(),
  })
  .refine(
    (body) => (body.lat === undefined) === (body.lng === undefined),
    'Supply lat and lng together.',
  )

/**
 * Gemini may describe a catalogued landmark in other words (e.g. "Magellan's
 * Cross Kiosk"). The position is usually the traveler's GPS, so allow some slack.
 */
export const DUPLICATE_RADIUS_METERS = 300

function finiteOr(value: unknown, fallback: number): number {
  const n = typeof value === 'string' && value.trim() === '' ? NaN : Number(value ?? NaN)
  return Number.isFinite(n) ? n : fallback
}

/** Words ignored entirely when comparing names. */
const NAME_STOPWORDS = new Set(['the', 'of', 'de', 'del', 'la', 'ng', 'sa', 'cebu', 'city'])

/**
 * Words that describe a kind of place rather than a particular one. They still
 * have to match, but a name match needs at least one word outside this list,
 * so "Cebu City Museum" never matches "Casa Gorordo Museum" on "museum" alone.
 */
const GENERIC_NAME_WORDS = new Set([
  'ancestral', 'basilica', 'building', 'cathedral', 'center', 'centre', 'chapel', 'church', 'cross',
  'fort', 'garden', 'hall', 'heritage', 'house', 'kiosk', 'landmark', 'memorial', 'minore', 'monument',
  'museum', 'national', 'old', 'park', 'parish', 'plaza', 'san', 'santa', 'santo', 'shrine', 'sto',
  'temple', 'tower',
])

/** Lowercase, accent-free words with possessives and plurals folded ("Magellan's" / "Magellans" -> "magellan"). */
export function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/['‘’ʼ`]/g, '')
      .split(/[^a-z0-9]+/)
      .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t))
      .filter((t) => t && !NAME_STOPWORDS.has(t)),
  )
}

/**
 * Finds an existing landmark that the discovered one most likely duplicates:
 * one nearby where every word of the shorter name appears in the longer one
 * and at least one shared word is distinctive (not GENERIC_NAME_WORDS).
 */
export function findDuplicate(
  landmarks: Landmark[],
  name: string,
  position: { latitude: number; longitude: number },
): Landmark | null {
  const discovered = nameTokens(name)
  let best: { landmark: Landmark; distance: number } | null = null
  for (const landmark of landmarks) {
    const distance = distanceMeters(position, landmark)
    if (distance > DUPLICATE_RADIUS_METERS) continue
    const existing = nameTokens(landmark.name)
    const shared = [...existing].filter((t) => discovered.has(t))
    // Every significant word of the shorter name must appear in the longer one.
    const smaller = Math.min(existing.size, discovered.size)
    if (smaller === 0 || shared.length < smaller) continue
    if (!shared.some((t) => !GENERIC_NAME_WORDS.has(t))) continue
    if (!best || distance < best.distance) best = { landmark, distance }
  }
  return best?.landmark ?? null
}

const rateError = { code: 'rate_limited', message: 'Too many scan requests. Please try again later.' }

export function scanRouter(ctx: AppContext) {
  const router = Router()
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: rateError },
  })

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

    let result
    try {
      result = await ctx.ai.identifyLandmark({
        image: file.buffer,
        mimeType: file.mimetype,
        candidates: ordered.map(({ id, name, district }) => ({ id, name, district })),
      })
    } catch {
      throw new HttpError(503, 'ai_unavailable', 'The landmark scanner is temporarily unavailable. Please try again later.')
    }

    let match = ordered.find((l) => l.id === result.landmarkId) ?? null

    // If Gemini identified a Cebu heritage landmark that was not in our initial candidate list,
    // dynamically register and save it to the store so travelers can view it, chat about it,
    // and visit it.
    if (!match && result.discovered && result.confidence >= MIN_CONFIDENCE) {
      const slug =
        result.discovered.name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') || `landmark-${Date.now()}`

      const latitude = origin?.latitude ?? finiteOr(result.discovered.latitude, 10.3157)
      const longitude = origin?.longitude ?? finiteOr(result.discovered.longitude, 123.8854)
      const existing =
        (await ctx.store.getLandmark(slug)) ??
        // The full catalog, not the first page used for the candidate list,
        // so a name variant of a later-page landmark is still caught.
        findDuplicate(await ctx.store.listLandmarks({ allPages: true }), result.discovered.name, { latitude, longitude })
      if (existing) {
        match = existing
      } else {
        const category = (LANDMARK_CATEGORIES as readonly string[]).includes(result.discovered.category)
          ? result.discovered.category
          : 'monument'

        const newLandmark: Landmark = {
          id: slug,
          name: result.discovered.name.trim(),
          category,
          district: result.discovered.district.trim(),
          latitude,
          longitude,
          imageUrl: null,
          // Gemini can send non-numeric or fractional values; NaN would be stored as null.
          admissionFee: Math.max(0, Math.round(finiteOr(result.discovered.admissionFee, 0) * 100) / 100),
          rating: 4.5,
          visitCount: 0,
          estimatedVisitMinutes: Math.max(10, Math.round(finiteOr(result.discovered.estimatedVisitMinutes, 30))),
          visitingHours: result.discovered.visitingHours?.trim() || 'Open daily',
          story: {
            about: result.discovered.story.about.trim(),
            significance: result.discovered.story.significance.trim(),
            architecture: result.discovered.story.architecture.trim(),
            trivia: result.discovered.story.trivia.trim(),
          },
        }
        match = await ctx.store.saveLandmark(newLandmark)
      }
    }

    let status: 'identified' | 'low_confidence' | 'not_nearby' | 'unrecognized'
    if (!match) status = 'unrecognized'
    else if (result.confidence < MIN_CONFIDENCE) status = 'low_confidence'
    else if (origin && distanceMeters(origin, match) > PROXIMITY_METERS) status = 'not_nearby'
    else status = 'identified'

    const candidates =
      status === 'identified'
        ? []
        : (origin ? ordered.filter((l) => distanceMeters(origin, l) <= CANDIDATE_RADIUS_METERS) : [])
            .slice(0, 5)
            .map((l) => toSummary(l, origin))

    const engagement =
      status === 'identified' && match && req.user
        ? await tryRecordEngagement(ctx.store, req.user.id, match.id, 'scan', { displayName: req.user.displayName })
        : null

    res.set('Cache-Control', 'no-store')
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
