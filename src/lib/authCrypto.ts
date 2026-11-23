import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, combined: string): boolean {
  const [salt, key] = combined.split(':')
  if (!salt || !key) return false
  const hash = scryptSync(password, salt, 64)
  const keyBuffer = Buffer.from(key, 'hex')
  return hash.length === keyBuffer.length && timingSafeEqual(hash, keyBuffer)
}
