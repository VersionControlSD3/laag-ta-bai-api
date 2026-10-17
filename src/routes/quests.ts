import { Router } from 'express'
import type { AppContext } from '../context.js'
import { optionalAuth } from '../middleware/auth.js'
import { questProgress } from '../services/progress.js'

export function questsRouter(ctx: AppContext) {
  const router = Router()

  // SRS 3.1.3.3: quests with per-user progress when signed in.
  router.get('/quests', optionalAuth(ctx.auth), async (req, res) => {
    const [quests, visits] = await Promise.all([
      ctx.store.listQuests(),
      req.user ? ctx.store.listVisits(req.user.id) : Promise.resolve([]),
    ])
    res.json({ data: questProgress(quests, visits) })
  })

  return router
}
