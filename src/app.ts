import cors from 'cors'
import express from 'express'
// Use Helmet's CommonJS declarations consistently in local and Vercel builds.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import helmet = require('helmet')
import type { AppContext } from './context.js'
import { loadEnv, type Env } from './config/env.js'
import { createGeminiService, createStubAiService } from './lib/ai.js'
import { createSupabaseAdmin } from './lib/supabase.js'
import { errorHandler, notFoundHandler } from './middleware/errors.js'
import { createMemoryStore } from './repositories/memoryStore.js'
import { createSupabaseStore } from './repositories/supabaseStore.js'
import { chatRouter } from './routes/chat.js'
import { healthRouter } from './routes/health.js'
import { landmarksRouter } from './routes/landmarks.js'
import { meRouter } from './routes/me.js'
import { questsRouter } from './routes/quests.js'
import { scanRouter } from './routes/scan.js'

export function createContext(env: Env): AppContext {
  const supabase =
    env.SUPABASE_URL && env.SUPABASE_SECRET_KEY ? createSupabaseAdmin(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY) : null
  return {
    store: env.dataSource === 'supabase' && supabase ? createSupabaseStore(supabase) : createMemoryStore(),
    ai: env.GEMINI_API_KEY ? createGeminiService(env.GEMINI_API_KEY, env.GEMINI_MODEL) : createStubAiService(),
    auth: { supabase, devAuthEnabled: env.devAuthEnabled },
    corsOrigins: env.CORS_ORIGINS,
    dataSource: env.dataSource,
  }
}

export function createApp(ctx: AppContext = createContext(loadEnv())) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(helmet.default())
  app.use(cors({ origin: ctx.corsOrigins, credentials: false }))
  app.use(express.json({ limit: '1mb' }))

  app.use(healthRouter(ctx))
  const v1 = express.Router()
  v1.use(landmarksRouter(ctx))
  v1.use(questsRouter(ctx))
  v1.use(scanRouter(ctx))
  v1.use(chatRouter(ctx))
  v1.use(meRouter(ctx))
  app.use('/v1', v1)

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
