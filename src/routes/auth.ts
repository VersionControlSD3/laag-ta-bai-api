import { Router } from 'express'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { hashPassword } from '../lib/authCrypto.js'
import { conflict } from '../lib/errors.js'

const signupSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().trim().min(1, 'Display name is required').max(60),
})

export function authRouter(ctx: AppContext) {
  const router = Router()

  // Issue #6: Sign Up API
  router.post('/auth/signup', async (req, res) => {
    const { email, password, displayName } = signupSchema.parse(req.body)

    if (ctx.auth.supabase) {
      const { data, error } = await ctx.auth.supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
        },
      })

      if (error) {
        if (error.message.toLowerCase().includes('already registered') || error.status === 422) {
          throw conflict('User with this email already exists')
        }
        throw conflict(error.message)
      }

      const user = data.user
      const session = data.session

      return res.status(201).json({
        data: {
          user: user
            ? {
                id: user.id,
                email: user.email ?? email,
                displayName: (user.user_metadata?.display_name as string) ?? displayName,
              }
            : null,
          session: session
            ? {
                accessToken: session.access_token,
                refreshToken: session.refresh_token,
                tokenType: 'bearer',
                expiresIn: session.expires_in,
              }
            : null,
        },
      })
    }

    // In-memory mode (for local testing & dev)
    if (!ctx.store.createUserAccount) {
      throw new Error('User creation not supported on current store')
    }

    const existing = await ctx.store.findUserAccountByEmail?.(email)
    if (existing) {
      throw conflict('User with this email already exists')
    }

    const passwordHash = hashPassword(password)
    const user = await ctx.store.createUserAccount({
      email,
      passwordHash,
      displayName,
    })

    return res.status(201).json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        },
        session: {
          accessToken: `dev:${user.id}`,
          tokenType: 'bearer',
          expiresIn: 3600,
        },
      },
    })
  })

  return router
}
