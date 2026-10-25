// Shapes returned by the API. Keep in sync with openapi.yaml and the
// frontend's src/api/types.ts.

export const LANDMARK_CATEGORIES = ['church', 'fort', 'monument', 'museum', 'heritage_house', 'temple'] as const
export type LandmarkCategory = (typeof LANDMARK_CATEGORIES)[number]

export type LandmarkStory = {
  about: string
  significance: string
  architecture: string
  trivia: string
}

export type Landmark = {
  id: string
  name: string
  category: LandmarkCategory
  district: string
  latitude: number
  longitude: number
  imageUrl: string | null
  admissionFee: number
  rating: number
  visitCount: number
  estimatedVisitMinutes: number
  visitingHours: string
  story: LandmarkStory
}

export type LandmarkSummary = Omit<Landmark, 'story'> & { distanceMeters?: number }

export type Quest = {
  id: string
  title: string
  description: string
  badgeName: string
  landmarkIds: string[]
}

export type UserAccount = {
  id: string
  email: string
  displayName: string
  createdAt: string
}

export type Profile = {
  id: string
  displayName: string
  avatarUrl: string | null
  nationality: string | null
  bio: string | null
  language: 'en' | 'ceb'
  xp: number
  streakCount: number
  lastActiveDate: string | null
}

export type ProfileUpdate = Partial<
  Pick<Profile, 'displayName' | 'avatarUrl' | 'nationality' | 'bio' | 'language'>
>

export type VisitSource = 'scan' | 'chat' | 'manual'

export type Visit = {
  id: string
  userId: string
  landmarkId: string
  source: VisitSource
  xpAwarded: number
  createdAt: string
}

export type ChatMessage = { role: 'user' | 'model'; content: string }
