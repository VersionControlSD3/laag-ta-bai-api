import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { CHAT_MEMORY_MESSAGES } from '../lib/ai.js'
import { notFound } from '../lib/errors.js'
import { optionalAuth } from '../middleware/auth.js'
import { recordEngagement } from '../services/progress.js'

const chatBody = z.object({
  landmarkId: z.string().min(1),
  messages: z
    .array(z.object({ role: z.enum(['user', 'model']), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(100)
    .refine((messages) => messages.at(-1)?.role === 'user', 'The last message must be from the user.'),
})

export function chatRouter(ctx: AppContext) {
  const router = Router()
  const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })

  // SRS 3.1.2: landmark-seeded, multi-turn guide chat. The client keeps the
  // transcript and sends it each turn; the server trims it to the memory window.
  router.post('/chat', limiter, optionalAuth(ctx.auth), async (req, res) => {
    const body = chatBody.parse(req.body)
    const landmark = await ctx.store.getLandmark(body.landmarkId)
    if (!landmark) throw notFound('Landmark not found')

    const reply = await ctx.ai.chat({ landmark, messages: body.messages.slice(-CHAT_MEMORY_MESSAGES) })
    const engagement = req.user ? await recordEngagement(ctx.store, req.user.id, landmark.id, 'chat', { displayName: req.user.displayName }) : null

    res.json({
      data: {
        message: { role: 'model', content: reply },
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
