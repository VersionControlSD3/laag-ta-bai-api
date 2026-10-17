import { Router } from 'express'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { rankFor } from '../domain/xp.js'
import { notFound } from '../lib/errors.js'
import { requireAuth } from '../middleware/auth.js'
import { questProgress, recordEngagement } from '../services/progress.js'

const profileUpdate = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    avatarUrl: z.url().nullable(),
    nationality: z.string().trim().max(60).nullable(),
    bio: z.string().trim().max(280).nullable(),
    language: z.enum(['en', 'ceb']),
  })
  .partial()
  .strict()

const visitBody = z.object({ landmarkId: z.string().min(1) })

export function meRouter(ctx: AppContext) {
  const router = Router()
  router.use('/me', requireAuth(ctx.auth))

  // SRS 3.1.6.1 profile, 3.1.3 mastery stats, badges and visit history.
  router.get('/me', async (req, res) => {
    const user = req.user!
    const [profile, visits, quests, landmarks] = await Promise.all([
      ctx.store.getOrCreateProfile(user.id, { displayName: user.displayName }),
      ctx.store.listVisits(user.id),
      ctx.store.listQuests(),
      ctx.store.listLandmarks(),
    ])
    const visitedIds = new Set(visits.map((v) => v.landmarkId))
    const districts = new Set(landmarks.map((l) => l.district))
    const visitedDistricts = new Set(landmarks.filter((l) => visitedIds.has(l.id)).map((l) => l.district))

    res.json({
      data: {
        profile,
        email: user.email,
        rank: rankFor(profile.xp),
        stats: {
          visitedCount: visitedIds.size,
          districtCoveragePercent: districts.size ? Math.round((visitedDistricts.size / districts.size) * 100) : 0,
          streakCount: profile.streakCount,
        },
        badges: questProgress(quests, visits)
          .filter((q) => q.completed)
          .map((q) => ({ questId: q.id, name: q.badgeName })),
        recentVisits: visits.slice(0, 20),
      },
    })
  })

  router.patch('/me', async (req, res) => {
    const update = profileUpdate.parse(req.body)
    await ctx.store.getOrCreateProfile(req.user!.id, { displayName: req.user!.displayName })
    const profile = await ctx.store.updateProfile(req.user!.id, update)
    res.json({ data: profile })
  })

  // Manual check-in (e.g. tapping "I'm here" on a landmark).
  router.post('/me/visits', async (req, res) => {
    const { landmarkId } = visitBody.parse(req.body)
    if (!(await ctx.store.getLandmark(landmarkId))) throw notFound('Landmark not found')
    const result = await recordEngagement(ctx.store, req.user!.id, landmarkId, 'manual', { displayName: req.user!.displayName })
    res.status(201).json({
      data: {
        visit: result.visit,
        xpAwarded: result.xpAwarded,
        rank: result.rank,
        leveledUp: result.leveledUp,
        newBadges: result.newBadges,
      },
    })
  })

  return router
}
