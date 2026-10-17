import type { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import { ZodError } from 'zod'
import { HttpError } from '../lib/errors.js'

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } })
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } })
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'validation_error', message: 'Request validation failed', details: err.issues },
    })
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: { code: 'upload_error', message: err.message } })
  }
  console.error(err)
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } })
}
