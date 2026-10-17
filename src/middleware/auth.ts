import type { NextFunction, Request, Response } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import { unauthorized } from '../lib/errors.js'

export type AuthUser = { id: string; email: string | null; displayName?: string }

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser
  }
}

export type AuthOptions = {
  supabase: SupabaseClient | null
  devAuthEnabled: boolean
}

const DEV_PREFIX = 'dev:'

async function resolveUser(token: string, options: AuthOptions): Promise<AuthUser | null> {
  if (options.devAuthEnabled && token.startsWith(DEV_PREFIX)) {
    const id = token.slice(DEV_PREFIX.length).trim()
    return id ? { id, email: null, displayName: 'Dev Traveler' } : null
  }
  if (!options.supabase) return null
  // Verifies the Supabase access token issued to the frontend by Supabase Auth.
  const { data, error } = await options.supabase.auth.getUser(token)
  if (error || !data.user) return null
  const meta = data.user.user_metadata as { display_name?: string } | undefined
  return { id: data.user.id, email: data.user.email ?? null, displayName: meta?.display_name }
}

function bearerToken(req: Request): string | null {
  const header = req.header('authorization')
  if (!header?.toLowerCase().startsWith('bearer ')) return null
  return header.slice(7).trim() || null
}

/** Attaches req.user when a valid token is present; never rejects. */
export function optionalAuth(options: AuthOptions) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearerToken(req)
    if (token) req.user = (await resolveUser(token, options)) ?? undefined
    next()
  }
}

/** Rejects with 401 unless a valid token is present. */
export function requireAuth(options: AuthOptions) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearerToken(req)
    const user = token ? await resolveUser(token, options) : null
    if (!user) return next(unauthorized())
    req.user = user
    next()
  }
}
