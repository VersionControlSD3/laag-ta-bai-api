import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { CHAT_MEMORY_MESSAGES } from '../lib/ai.js'
import { HttpError, notFound } from '../lib/errors.js'
import { optionalAuth } from '../middleware/auth.js'
import { recordEngagement } from '../services/progress.js'

const CHAT_MESSAGE_LIMIT = 2_000

const chatBody = z.object({
  landmarkId: z.string().trim().min(1).max(200),
  messages: z
    .array(z.object({
      role: z.enum(['user', 'model']), content: z.string().trim().min(1).max(CHAT_MESSAGE_LIMIT),
      createdAt: z.iso.datetime({ offset: true }).optional(),
    }))
    .min(1)
    .max(100)
    .refine((messages) => messages.at(-1)?.role === 'user', 'The last message must be from the user.'),
})

export function chatRouter(ctx: AppContext) {
  const router = Router()
  const limiter = rateLimit({
    windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many chat requests. Please try again in a minute.' } },
  })

  // SRS 3.1.2: landmark-seeded, multi-turn guide chat. The client keeps the
  // transcript and sends it each turn; the server trims it to the memory window.
  router.post('/chat', limiter, optionalAuth(ctx.auth), async (req, res) => {
    const body = chatBody.parse(req.body)
    const landmark = await ctx.store.getLandmark(body.landmarkId)
    if (!landmark) throw notFound('Landmark not found')

    let reply: string
    try {
      reply = (await ctx.ai.chat({ landmark, messages: body.messages.slice(-CHAT_MEMORY_MESSAGES) })).trim()
      if (!reply) throw new Error('Empty AI response')
    } catch {
      throw new HttpError(503, 'ai_unavailable', 'The AI guide is unavailable. Please try again later.')
    }
    // The frontend sends replies back as history, subject to the same length limit.
    if (reply.length > CHAT_MESSAGE_LIMIT) {
      reply = reply.slice(0, CHAT_MESSAGE_LIMIT - 1).replace(/\p{Surrogate}$/u, '').trimEnd() + '…'
    }
    const engagement = req.user ? await recordEngagement(ctx.store, req.user.id, landmark.id, 'chat', { displayName: req.user.displayName }) : null

    res.set('Cache-Control', 'no-store')
    res.json({
      data: {
        message: { role: 'model', content: reply, createdAt: new Date().toISOString() },
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
