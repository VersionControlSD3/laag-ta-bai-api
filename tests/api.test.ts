import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp, createContext } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'

const auth = { Authorization: 'Bearer dev:test-user' }
// Smallest valid PNG; the stub AI service does not inspect pixels.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const NEAR_MAGELLAN = { lat: '10.2937', lng: '123.9020' }

let app: ReturnType<typeof createApp>
beforeEach(() => {
  app = createApp(createContext(loadEnv()))
})

describe('GET /health', () => {
  it('reports the memory store and stub AI', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok', dataSource: 'memory', ai: 'stub' })
  })
})

describe('landmarks', () => {
  it('lists landmarks without story text', async () => {
    const res = await request(app).get('/v1/landmarks')
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    expect(res.body.data[0].story).toBeUndefined()
  })
  it('sorts by distance when coordinates are given', async () => {
    const res = await request(app).get('/v1/landmarks').query(NEAR_MAGELLAN)
    const distances = res.body.data.map((l: { distanceMeters: number }) => l.distanceMeters)
    expect(distances).toEqual([...distances].sort((a, b) => a - b))
    expect(res.body.data[0].id).toBe('magellans-cross')
  })
  it('filters by category and search text', async () => {
    const res = await request(app).get('/v1/landmarks').query({ category: 'fort', q: 'san pedro' })
    expect(res.body.data.map((l: { id: string }) => l.id)).toEqual(['fort-san-pedro'])
  })
  it('rejects an unknown category', async () => {
    const res = await request(app).get('/v1/landmarks').query({ category: 'mall' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('validation_error')
  })
  it('returns the story on the detail route and 404 for unknown ids', async () => {
    const ok = await request(app).get('/v1/landmarks/fort-san-pedro')
    expect(ok.body.data.story.about).toBeTruthy()
    const missing = await request(app).get('/v1/landmarks/nope')
    expect(missing.status).toBe(404)
  })
})

describe('POST /v1/scan', () => {
  it('identifies the nearest landmark and awards XP when signed in', async () => {
    const res = await request(app)
      .post('/v1/scan')
      .set(auth)
      .field('lat', NEAR_MAGELLAN.lat)
      .field('lng', NEAR_MAGELLAN.lng)
      .attach('image', PNG, { filename: 'photo.png', contentType: 'image/png' })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('identified')
    expect(res.body.data.landmark.id).toBe('magellans-cross')
    expect(res.body.data.progress.xpAwarded).toBe(50)
  })
  it('rejects unsupported formats', async () => {
    const res = await request(app)
      .post('/v1/scan')
      .attach('image', Buffer.from('GIF89a'), { filename: 'x.gif', contentType: 'image/gif' })
    expect(res.status).toBe(400)
  })
  it('requires an image', async () => {
    const res = await request(app).post('/v1/scan').field('lat', '10.29')
    expect(res.status).toBe(400)
  })
})

describe('POST /v1/chat', () => {
  it('answers with landmark context', async () => {
    const res = await request(app)
      .post('/v1/chat')
      .send({ landmarkId: 'fort-san-pedro', messages: [{ role: 'user', content: 'Who built this?' }] })
    expect(res.status).toBe(200)
    expect(res.body.data.message.role).toBe('model')
    expect(res.body.data.message.content).toContain('Fort San Pedro')
    expect(res.body.data.progress).toBeNull()
  })
  it('requires the last message to come from the user', async () => {
    const res = await request(app)
      .post('/v1/chat')
      .send({ landmarkId: 'fort-san-pedro', messages: [{ role: 'model', content: 'Hi' }] })
    expect(res.status).toBe(400)
  })
})

describe('/v1/me', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/v1/me')).status).toBe(401)
    expect((await request(app).get('/v1/me').set({ Authorization: 'Bearer not-a-token' })).status).toBe(401)
  })
  it('updates the profile', async () => {
    const res = await request(app).patch('/v1/me').set(auth).send({ displayName: 'Bai Juan', language: 'ceb' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ displayName: 'Bai Juan', language: 'ceb' })
  })
  it('awards XP once per landmark per day and unlocks a quest badge', async () => {
    for (const landmarkId of ['yap-sandiego-house', 'casa-gorordo']) {
      await request(app).post('/v1/me/visits').set(auth).send({ landmarkId })
    }
    const repeat = await request(app).post('/v1/me/visits').set(auth).send({ landmarkId: 'casa-gorordo' })
    expect(repeat.body.data.xpAwarded).toBe(0)

    const last = await request(app).post('/v1/me/visits').set(auth).send({ landmarkId: 'heritage-of-cebu-monument' })
    expect(last.status).toBe(201)
    expect(last.body.data.newBadges).toEqual(['Old Colonist'])

    const me = await request(app).get('/v1/me').set(auth)
    expect(me.body.data.profile.xp).toBe(150)
    expect(me.body.data.badges).toEqual([{ questId: 'parian-heritage-walk', name: 'Old Colonist' }])
    expect(me.body.data.stats.visitedCount).toBe(3)

    const quests = await request(app).get('/v1/quests').set(auth)
    const parian = quests.body.data.find((q: { id: string }) => q.id === 'parian-heritage-walk')
    expect(parian.completed).toBe(true)
  })
})

describe('POST /v1/auth/signup', () => {
  it('registers a new user and returns user info with a valid session token', async () => {
    const res = await request(app).post('/v1/auth/signup').send({
      email: 'cebuano.traveler@example.com',
      password: 'SecurePassword123!',
      displayName: 'Lapu Lapu',
    })

    expect(res.status).toBe(201)
    expect(res.body.data.user).toMatchObject({
      email: 'cebuano.traveler@example.com',
      displayName: 'Lapu Lapu',
    })
    expect(res.body.data.user.id).toBeDefined()
    expect(res.body.data.session.accessToken).toBeDefined()

    // The session token should immediately work on protected routes like /v1/me
    const meRes = await request(app)
      .get('/v1/me')
      .set({ Authorization: `Bearer ${res.body.data.session.accessToken}` })
    expect(meRes.status).toBe(200)
    expect(meRes.body.data.profile.displayName).toBe('Lapu Lapu')
  })

  it('rejects signup with invalid email or short password', async () => {
    const invalidEmail = await request(app).post('/v1/auth/signup').send({
      email: 'not-an-email',
      password: 'ValidPassword123!',
      displayName: 'Traveler',
    })
    expect(invalidEmail.status).toBe(400)
    expect(invalidEmail.body.error.code).toBe('validation_error')

    const shortPassword = await request(app).post('/v1/auth/signup').send({
      email: 'valid@example.com',
      password: 'short',
      displayName: 'Traveler',
    })
    expect(shortPassword.status).toBe(400)
    expect(shortPassword.body.error.code).toBe('validation_error')
  })

  it('rejects duplicate email with 409 conflict', async () => {
    await request(app).post('/v1/auth/signup').send({
      email: 'duplicate@example.com',
      password: 'Password123!',
      displayName: 'First Traveler',
    })

    const duplicate = await request(app).post('/v1/auth/signup').send({
      email: 'duplicate@example.com',
      password: 'AnotherPassword123!',
      displayName: 'Second Traveler',
    })

    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe('conflict')
  })
})

describe('POST /v1/auth/login and GET /v1/auth/session', () => {
  beforeEach(async () => {
    await request(app).post('/v1/auth/signup').send({
      email: 'traveler.juan@example.com',
      password: 'MyPassword123!',
      displayName: 'Juan dela Cruz',
    })
  })

  it('authenticates user with correct password and returns session token', async () => {
    const res = await request(app).post('/v1/auth/login').send({
      email: 'traveler.juan@example.com',
      password: 'MyPassword123!',
    })

    expect(res.status).toBe(200)
    expect(res.body.data.user.email).toBe('traveler.juan@example.com')
    expect(res.body.data.user.displayName).toBe('Juan dela Cruz')
    expect(res.body.data.session.accessToken).toBeDefined()

    // Test GET /v1/auth/session with the token
    const sessionRes = await request(app)
      .get('/v1/auth/session')
      .set({ Authorization: `Bearer ${res.body.data.session.accessToken}` })

    expect(sessionRes.status).toBe(200)
    expect(sessionRes.body.data.user.displayName).toBe('Juan dela Cruz')
    expect(sessionRes.body.data.profile.xp).toBe(0)
  })

  it('rejects login with wrong password', async () => {
    const res = await request(app).post('/v1/auth/login').send({
      email: 'traveler.juan@example.com',
      password: 'WrongPassword!',
    })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('unauthorized')
  })

  it('rejects login for non-existent user', async () => {
    const res = await request(app).post('/v1/auth/login').send({
      email: 'nobody@example.com',
      password: 'Password123!',
    })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('unauthorized')
  })

  it('rejects GET /v1/auth/session without valid authentication', async () => {
    const noToken = await request(app).get('/v1/auth/session')
    expect(noToken.status).toBe(401)

    const badToken = await request(app)
      .get('/v1/auth/session')
      .set({ Authorization: 'Bearer bad-token' })
    expect(badToken.status).toBe(401)
  })
})


