import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { hashPassword, verifyPassword } from '../lib/authCrypto.js'
import { conflict, unauthorized } from '../lib/errors.js'
import { requireAuth } from '../middleware/auth.js'
import { passwordRecoveryRouter } from './passwordRecovery.js'

const signupSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().trim().min(1, 'Display name is required').max(60),
})

const emailStatusSchema = z.object({ email: z.string().trim().email() })

const EMAIL_TAKEN = 'An account with this email already exists.'

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1, 'Password is required'),
})

export function authRouter(ctx: AppContext) {
  const router = Router()
  router.use('/auth', passwordRecoveryRouter(ctx.passwordRecovery))

  // Bugs #11 / #16: the sign-up form asks before calling Supabase, because Supabase hides taken
  // emails (no error, a fake new user, and a "reset your password" email to the owner).
  // This does tell a caller whether an email has an account, so it is rate limited per IP.
  const emailStatusLimiter = rateLimit({
    windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many requests. Please try again in a minute.' } },
  })
  router.post('/auth/email-status', emailStatusLimiter, async (req, res) => {
    const { email } = emailStatusSchema.parse(req.body)
    res.set('Cache-Control', 'no-store')
    res.json({ data: { registered: await ctx.store.isEmailRegistered(email) } })
  })

  // Issue #6: Sign Up API
  router.post('/auth/signup', async (req, res) => {
    const { email, password, displayName } = signupSchema.parse(req.body)

    if (ctx.auth.supabase) {
      // Supabase would answer a taken email as if it were new (and email the owner), so check first.
      if (await ctx.store.isEmailRegistered(email)) throw conflict(EMAIL_TAKEN)
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

      // Raced with another sign-up for the same email: Supabase returns a user with no identities.
      if (data.user && data.user.identities?.length === 0) throw conflict(EMAIL_TAKEN)

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

    if (await ctx.store.isEmailRegistered(email)) throw conflict(EMAIL_TAKEN)

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

  // Issue #7: Login API
  router.post('/auth/login', async (req, res) => {
    const { email, password } = loginSchema.parse(req.body)

    if (ctx.auth.supabase) {
      const { data, error } = await ctx.auth.supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error || !data.user) {
        throw unauthorized('Invalid email or password')
      }

      const user = data.user
      const session = data.session

      return res.json({
        data: {
          user: {
            id: user.id,
            email: user.email ?? email,
            displayName: (user.user_metadata?.display_name as string) ?? 'Traveler',
          },
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
    const stored = await ctx.store.findUserAccountByEmail?.(email)
    if (!stored || !verifyPassword(password, stored.passwordHash)) {
      throw unauthorized('Invalid email or password')
    }

    return res.json({
      data: {
        user: {
          id: stored.id,
          email: stored.email,
          displayName: stored.displayName,
        },
        session: {
          accessToken: `dev:${stored.id}`,
          tokenType: 'bearer',
          expiresIn: 3600,
        },
      },
    })
  })

  // Issue #7: Session verification API
  router.get('/auth/session', requireAuth(ctx.auth), async (req, res) => {
    const user = req.user!
    const profile = await ctx.store.getOrCreateProfile(user.id, { displayName: user.displayName })

    return res.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: profile.displayName || user.displayName || 'Traveler',
        },
        profile,
      },
    })
  })

  return router
}

