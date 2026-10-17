import { Router } from 'express'
import type { AppContext } from '../context.js'

export function healthRouter(ctx: AppContext) {
  const router = Router()
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', dataSource: ctx.dataSource, ai: ctx.ai.mode, version: process.env.npm_package_version ?? '0.1.0' })
  })
  return router
}
