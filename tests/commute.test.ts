import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, createContext } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'
import { createGoogleRoutesService } from '../src/lib/commute.js'

const origin = { latitude: 10.31, longitude: 123.9 }
const destination = { latitude: 10.29236, longitude: 123.90581 }
const input = { origin, destination }
const body = { origin, destinationLandmarkId: 'fort-san-pedro' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const googleRoute = {
  distanceMeters: 2500, duration: '720s', polyline: { encodedPolyline: 'encoded-path' },
  localizedValues: { transitFare: { text: 'PHP 20.00' } },
  legs: [{ steps: [
    { travelMode: 'WALK', distanceMeters: 100, staticDuration: '90s', navigationInstruction: { instructions: 'Walk to the stop' } },
    { travelMode: 'TRANSIT', distanceMeters: 2400, staticDuration: '600s', transitDetails: {
      headsign: 'Downtown', stopCount: 5,
      stopDetails: { departureStop: { name: 'Origin stop' }, arrivalStop: { name: 'Destination stop' },
        departureTime: '2026-10-31T01:00:00Z', arrivalTime: '2026-10-31T01:10:00Z' },
      transitLine: { name: 'Fixture bus', nameShort: 'TEST', vehicle: { type: 'BUS' },
        agencies: [{ name: 'Fixture agency', uri: 'https://example.com' }] },
    } },
  ] }],
}

afterEach(() => vi.restoreAllMocks())

describe('Google transit adapter', () => {
  it('requests transit and normalizes walking steps, transit stops, line and fare', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ routes: [googleRoute] }))
    const routes = await createGoogleRoutesService('server-secret', { fetchImpl }).findRoutes({
      ...input, departureTime: '2026-10-31T01:00:00Z', preference: 'FEWER_TRANSFERS',
    })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes')
    expect(init?.headers).toMatchObject({ 'X-Goog-Api-Key': 'server-secret' })
    expect(JSON.parse(init!.body as string)).toMatchObject({
      origin: { location: { latLng: origin } }, destination: { location: { latLng: destination } },
      travelMode: 'TRANSIT', departureTime: '2026-10-31T01:00:00Z', transitPreferences: { routingPreference: 'FEWER_TRANSFERS' },
    })
    expect(routes[0]).toMatchObject({ distanceMeters: 2500, durationSeconds: 720, encodedPolyline: 'encoded-path', fareText: 'PHP 20.00' })
    expect(routes[0]!.steps[0]).toMatchObject({ travelMode: 'WALK', durationSeconds: 90, transit: null })
    expect(routes[0]!.steps[1]!.transit).toMatchObject({ lineCode: 'TEST', departureStop: 'Origin stop', arrivalStop: 'Destination stop', stopCount: 5 })
  })

  it('returns no routes for Google\'s empty protobuf response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({}))
    await expect(createGoogleRoutesService('key', { fetchImpl }).findRoutes(input)).resolves.toEqual([])
  })

  it('preserves unknown fares as null rather than zero', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ routes: [{ ...googleRoute, localizedValues: {} }] }))
    const routes = await createGoogleRoutesService('key', { fetchImpl }).findRoutes(input)
    expect(routes[0]!.fareText).toBeNull()
  })

  it.each([[403, 502], [429, 503], [500, 503]])('handles provider HTTP %i with a sanitized %i', async (status, expected) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ error: 'server-secret' }, status))
    await expect(createGoogleRoutesService('key', { fetchImpl }).findRoutes(input)).rejects.toMatchObject({ status: expected, code: 'commute_provider_error' })
  })

  it('rejects malformed provider data', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ routes: [{ distanceMeters: -1 }] }))
    await expect(createGoogleRoutesService('key', { fetchImpl }).findRoutes(input)).rejects.toMatchObject({ status: 502 })
  })

  it('handles network failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('server-secret'))
    await expect(createGoogleRoutesService('key', { fetchImpl }).findRoutes(input)).rejects.toMatchObject({ status: 503 })
  })

  it('handles non-JSON provider output as a bad gateway response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>bad gateway</html>'))
    await expect(createGoogleRoutesService('key', { fetchImpl }).findRoutes(input)).rejects.toMatchObject({ status: 502 })
  })

  it('aborts a slow request', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
    }))
    await expect(createGoogleRoutesService('key', { fetchImpl, timeoutMs: 5 }).findRoutes(input)).rejects.toMatchObject({ status: 504 })
  })
  it('reports a timeout while reading the response body', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const signal = init!.signal!
      return new Response(new ReadableStream({
        start(controller) {
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
        },
      }))
    })
    await expect(createGoogleRoutesService('key', { fetchImpl, timeoutMs: 5 }).findRoutes(input))
      .rejects.toMatchObject({ status: 504, code: 'commute_timeout' })
  })
})

describe('POST /v1/commute', () => {
  it('resolves the destination from the database and returns normalized routes', async () => {
    const ctx = createContext(loadEnv())
    const findRoutes = vi.spyOn(ctx.commute, 'findRoutes').mockResolvedValue([])
    const res = await request(createApp(ctx)).post('/v1/commute').send(body)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: 'no_routes', provider: 'google_routes', routes: [], destination: { id: body.destinationLandmarkId } })
    expect(findRoutes).toHaveBeenCalledWith(expect.objectContaining({ origin, destination }))
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('returns ok for a route result', async () => {
    const ctx = createContext(loadEnv())
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ routes: [googleRoute] }))
    ctx.commute = createGoogleRoutesService('key', { fetchImpl })
    const res = await request(createApp(ctx)).post('/v1/commute').send(body)
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('ok')
    expect(res.body.data.routes[0].durationSeconds).toBe(720)
  })

  it('reports missing configuration rather than fabricating directions', async () => {
    const res = await request(createApp(createContext(loadEnv()))).post('/v1/commute').send(body)
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('commute_unavailable')
  })

  it('returns 404 for an unknown destination without calling the provider', async () => {
    const ctx = createContext(loadEnv())
    const spy = vi.spyOn(ctx.commute, 'findRoutes')
    const res = await request(createApp(ctx)).post('/v1/commute').send({ ...body, destinationLandmarkId: 'missing' })
    expect(res.status).toBe(404)
    expect(spy).not.toHaveBeenCalled()
  })

  it.each([
    {}, { origin: { latitude: '10', longitude: 123 } }, { origin: { latitude: 91, longitude: 123 } },
    { origin: { latitude: 10, longitude: -181 } }, { departureTime: 'yesterday' },
    { preference: 'DRIVE' },
  ])('rejects malformed input without calling the provider: %j', async (change) => {
    const ctx = createContext(loadEnv())
    const spy = vi.spyOn(ctx.commute, 'findRoutes')
    const payload = Object.keys(change).length ? { ...body, ...change } : {}
    const res = await request(createApp(ctx)).post('/v1/commute').send(payload)
    expect(res.status).toBe(400)
    expect(spy).not.toHaveBeenCalled()
  })

  it.each([
    { departureTime: '2026-04-30T11:59:59.999Z', status: 400 },
    { departureTime: '2026-04-30T12:00:00.000Z', status: 200 },
    { departureTime: '2026-08-15T12:00:00.000Z', status: 200 },
    { departureTime: '2026-08-15T12:00:00.001Z', status: 400 },
  ])('returns $status at the transit window boundary $departureTime', async ({ departureTime, status }) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-05-07T12:00:00.000Z'))
    const ctx = createContext(loadEnv())
    const findRoutes = vi.spyOn(ctx.commute, 'findRoutes').mockResolvedValue([])

    const res = await request(createApp(ctx)).post('/v1/commute').send({ ...body, departureTime })
    expect(res.status).toBe(status)
    if (status === 200) {
      expect(findRoutes).toHaveBeenCalledOnce()
      expect(findRoutes).toHaveBeenCalledWith(expect.objectContaining({ departureTime }))
    } else {
      expect(res.body.error.code).toBe('validation_error')
      expect(findRoutes).not.toHaveBeenCalled()
    }
  })

  it('rate limits route requests with the JSON error shape', async () => {
    const ctx = createContext(loadEnv())
    vi.spyOn(ctx.commute, 'findRoutes').mockResolvedValue([])
    const app = createApp(ctx)
    for (let i = 0; i < 20; i++) await request(app).post('/v1/commute').send(body)
    const res = await request(app).post('/v1/commute').send(body)
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('rate_limited')
  })
})
