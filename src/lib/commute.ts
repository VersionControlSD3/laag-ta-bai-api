import { z } from 'zod'
import type { Coordinates } from '../domain/geo.js'
import { HttpError } from './errors.js'

export type CommuteInput = {
  origin: Coordinates
  destination: Coordinates
  departureTime?: string
  preference?: 'LESS_WALKING' | 'FEWER_TRANSFERS'
}

// Google omits protobuf scalar defaults (including zero distances).
const duration = z.string().regex(/^\d+(?:\.\d+)?s$/).default('0s')
const stopDetails = z.object({
  departureStop: z.object({ name: z.string().optional() }).optional(),
  arrivalStop: z.object({ name: z.string().optional() }).optional(),
  departureTime: z.string().optional(),
  arrivalTime: z.string().optional(),
})
const stepSchema = z.object({
  travelMode: z.string(),
  distanceMeters: z.number().nonnegative().default(0),
  staticDuration: duration,
  navigationInstruction: z.object({ instructions: z.string().optional() }).optional(),
  transitDetails: z.object({
    headsign: z.string().optional(),
    stopCount: z.number().int().nonnegative().optional(),
    stopDetails: stopDetails.optional(),
    transitLine: z.object({
      name: z.string().optional(),
      nameShort: z.string().optional(),
      vehicle: z.object({ type: z.string().optional() }).optional(),
      agencies: z.array(z.object({ name: z.string().optional(), uri: z.string().optional() })).default([]),
    }).optional(),
  }).optional(),
})
const responseSchema = z.object({
  routes: z.array(z.object({
    distanceMeters: z.number().nonnegative().default(0),
    duration,
    polyline: z.object({ encodedPolyline: z.string().optional() }).optional(),
    localizedValues: z.object({ transitFare: z.object({ text: z.string() }).optional() }).optional(),
    legs: z.array(z.object({ steps: z.array(stepSchema) })).min(1),
  })).max(4).default([]),
})

function normalizeRoute(route: z.infer<typeof responseSchema>['routes'][number]) {
  return {
    distanceMeters: route.distanceMeters,
    durationSeconds: Number.parseFloat(route.duration),
    encodedPolyline: route.polyline?.encodedPolyline ?? null,
    fareText: route.localizedValues?.transitFare?.text ?? null,
    steps: route.legs.flatMap((leg) => leg.steps.map((step) => {
      const transit = step.transitDetails
      return {
        travelMode: step.travelMode,
        instruction: step.navigationInstruction?.instructions ?? null,
        distanceMeters: step.distanceMeters,
        durationSeconds: Number.parseFloat(step.staticDuration),
        transit: transit ? {
          lineName: transit.transitLine?.name ?? null,
          lineCode: transit.transitLine?.nameShort ?? null,
          vehicleType: transit.transitLine?.vehicle?.type ?? null,
          headsign: transit.headsign ?? null,
          departureStop: transit.stopDetails?.departureStop?.name ?? null,
          arrivalStop: transit.stopDetails?.arrivalStop?.name ?? null,
          departureTime: transit.stopDetails?.departureTime ?? null,
          arrivalTime: transit.stopDetails?.arrivalTime ?? null,
          stopCount: transit.stopCount ?? null,
          agencies: (transit.transitLine?.agencies ?? []).map((agency) => ({
            name: agency.name ?? null, uri: agency.uri ?? null,
          })),
        } : null,
      }
    })),
  }
}

export type CommuteRoute = ReturnType<typeof normalizeRoute>
export interface CommuteService {
  findRoutes(input: CommuteInput): Promise<CommuteRoute[]>
}

export function createUnavailableCommuteService(): CommuteService {
  return {
    async findRoutes() {
      throw new HttpError(503, 'commute_unavailable', 'Transit routing is not configured. Set the server GOOGLE_MAPS_API_KEY.')
    },
  }
}

const FIELD_MASK = [
  'routes.distanceMeters', 'routes.duration', 'routes.polyline.encodedPolyline',
  'routes.legs.steps', 'routes.localizedValues.transitFare',
].join(',')

export function createGoogleRoutesService(
  apiKey: string,
  { fetchImpl = fetch, timeoutMs = 10_000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): CommuteService {
  return {
    async findRoutes(input) {
      const signal = AbortSignal.timeout(timeoutMs)
      try {
        const response = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
          signal,
          body: JSON.stringify({
            origin: { location: { latLng: input.origin } },
            destination: { location: { latLng: input.destination } },
            travelMode: 'TRANSIT',
            computeAlternativeRoutes: true,
            languageCode: 'en',
            regionCode: 'PH',
            units: 'METRIC',
            ...(input.departureTime ? { departureTime: input.departureTime } : {}),
            ...(input.preference ? { transitPreferences: { routingPreference: input.preference } } : {}),
          }),
        })
        if (!response.ok) {
          const unavailable = response.status === 429 || response.status >= 500
          throw new HttpError(unavailable ? 503 : 502, 'commute_provider_error', 'The transit provider is unavailable. Please try again later.')
        }
        const body: unknown = await response.json().catch((error: unknown) => {
          if (error instanceof SyntaxError) return null
          throw error
        })
        const parsed = responseSchema.safeParse(body)
        if (!parsed.success) throw new HttpError(502, 'commute_provider_error', 'The transit provider returned an invalid response.')
        return parsed.data.routes.map(normalizeRoute)
      } catch (error) {
        if (error instanceof HttpError) throw error
        if (signal.aborted) throw new HttpError(504, 'commute_timeout', 'The transit provider took too long to respond. Please try again.')
        // Do not forward provider errors: they can contain credentials or internal details.
        throw new HttpError(503, 'commute_provider_error', 'Unable to reach the transit provider. Please try again later.')
      }
    },
  }
}
