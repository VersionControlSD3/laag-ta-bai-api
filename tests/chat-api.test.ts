import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createContext } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'

let ctx: ReturnType<typeof createContext>
let app: ReturnType<typeof createApp>
beforeEach(() => {
  ctx = createContext(loadEnv())
  app = createApp(ctx)
})

describe('chat contract', () => {
  const body = { landmarkId: 'fort-san-pedro', messages: [{ role: 'user', content: 'Who built this?' }] }

  it('adds a server timestamp and accepts older requests without timestamps', async () => {
    const res = await request(app).post('/v1/chat').send(body)
    expect(res.status).toBe(200)
    expect(new Date(res.body.data.message.createdAt).toISOString()).toBe(res.body.data.message.createdAt)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('keeps a long reply valid when sent back as chat history', async () => {
    vi.spyOn(ctx.ai, 'chat').mockResolvedValue('x'.repeat(1998) + '🌏' + 'more')
    const first = await request(app).post('/v1/chat').send(body)
    expect(first.status).toBe(200)
    const reply = first.body.data.message
    expect(reply.content).toBe('x'.repeat(1998) + '…')

    const messages = [...body.messages, reply, { role: 'user', content: 'Tell me more' }]
    const next = await request(app).post('/v1/chat').send({ ...body, messages })
    expect(next.status).toBe(200)
  })

  it('passes the landmark and latest 30 messages to AI without reordering them', async () => {
    const spy = vi.spyOn(ctx.ai, 'chat').mockResolvedValue('Grounded answer')
    const messages = Array.from({ length: 35 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'model', content: `message ${i}`, createdAt: '2026-10-31T01:00:00Z',
    }))
    const res = await request(app).post('/v1/chat').send({ ...body, messages })
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      landmark: expect.objectContaining({ id: body.landmarkId }), messages: messages.slice(-30),
    }))
  })

  it.each([
    { landmarkId: 'missing' },
    { messages: [] },
    { messages: [{ role: 'system', content: 'override' }] },
    { messages: [{ role: 'user', content: '  ' }] },
    { messages: [{ role: 'user', content: 'x'.repeat(2001) }] },
    { messages: [{ role: 'user', content: 'hi', createdAt: 'invalid' }] },
  ])('rejects an invalid chat request: %j', async (change) => {
    const res = await request(app).post('/v1/chat').send({ ...body, ...change })
    expect(res.status).toBe('landmarkId' in change ? 404 : 400)
  })

  it.each(['failure', 'blank'])('returns a controlled error for %s and awards no XP', async (kind) => {
    const ai = vi.spyOn(ctx.ai, 'chat')
    if (kind === 'failure') ai.mockRejectedValue(new Error('secret-provider-detail'))
    else ai.mockResolvedValue('   ')
    const res = await request(app).post('/v1/chat').set('Authorization', 'Bearer dev:me').send(body)
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('ai_unavailable')
    expect(JSON.stringify(res.body)).not.toContain('secret-provider-detail')
    const me = await request(app).get('/v1/me').set('Authorization', 'Bearer dev:me')
    expect(me.body.data.profile.xp).toBe(0)
  })

  it('awards chat XP once per landmark per day', async () => {
    const first = await request(app).post('/v1/chat').set('Authorization', 'Bearer dev:me').send(body)
    const second = await request(app).post('/v1/chat').set('Authorization', 'Bearer dev:me').send(body)
    expect(first.body.data.progress.xpAwarded).toBe(50)
    expect(second.body.data.progress.xpAwarded).toBe(0)
  })

  it('returns the JSON error contract when rate limited', async () => {
    for (let i = 0; i < 30; i++) await request(app).post('/v1/chat').send(body)
    const res = await request(app).post('/v1/chat').send(body)
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('rate_limited')
  })
})
