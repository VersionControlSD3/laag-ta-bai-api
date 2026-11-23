import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { PasswordRecoveryOptions } from '../context.js'
import { badRequest, HttpError } from '../lib/errors.js'

const forgotBody = z.strictObject({ email: z.string().trim().max(254).email() })
const resetBody = z.strictObject({
  tokenHash: z.string().min(1).max(256),
  password: z.string().min(8).refine(
    (password) => Buffer.byteLength(password, 'utf8') <= 72,
    'Password must be at most 72 UTF-8 bytes',
  ),
})

const recoveryMessage = 'If an account exists for that email, password reset instructions will be sent.'
const rateError = { code: 'rate_limited', message: 'Too many password recovery attempts. Try again later.' }
const unavailable = () => new HttpError(503, 'service_unavailable', 'Password recovery is temporarily unavailable.')

function recoveryLimiter(limit: number) {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: rateError },
  })
}

export function passwordRecoveryRouter(options?: PasswordRecoveryOptions) {
  const router = Router()

  router.post('/forgot-password', recoveryLimiter(5), async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const { email } = forgotBody.parse(req.body)
    if (!options) throw unavailable()

    const { error } = await options.createAuthClient().auth.resetPasswordForEmail(email, {
      redirectTo: options.redirectTo,
    })
    // Return the same acknowledgement even when the provider declines to send mail.
    if (error && error.code !== 'user_not_found') {
      console.warn('Password recovery email was not sent', error.code ?? error.status ?? 'provider_error')
    }
    res.status(202).json({ data: { message: recoveryMessage } })
  })

  router.post('/reset-password', recoveryLimiter(10), async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const { tokenHash, password } = resetBody.parse(req.body)
    if (!options) throw unavailable()

    // verifyOtp installs a session in the SDK client. Keep it request-scoped so
    // concurrent password resets cannot change each other's authenticated user.
    const { auth } = options.createAuthClient()
    const verification = await auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
    if (verification.error?.status === 429) throw new HttpError(429, rateError.code, rateError.message)
    if (verification.error?.code === 'otp_expired' || verification.error?.status === 403) {
      throw badRequest('Invalid or expired password reset link.')
    }
    if (verification.error || !verification.data.session) throw unavailable()

    const { error } = await auth.updateUser({ password })
    if (error?.code === 'weak_password' || error?.code === 'same_password') {
      throw badRequest('Choose a different password that meets the password requirements.')
    }
    if (error) throw unavailable()

    res.json({ data: { message: 'Password updated. Sign in with your new password.' } })
  })

  return router
}
