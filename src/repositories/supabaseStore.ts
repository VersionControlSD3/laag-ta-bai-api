import type { SupabaseClient } from '@supabase/supabase-js'
import type { Landmark, Profile, Quest, Visit } from '../domain/types.js'
import type { DataStore } from './store.js'

type LandmarkRow = {
  id: string
  name: string
  category: Landmark['category']
  district: string
  latitude: number
  longitude: number
  image_url: string | null
  admission_fee: number
  rating: number
  visit_count: number
  estimated_visit_minutes: number
  visiting_hours: string
  story: Landmark['story']
}

type ProfileRow = {
  id: string
  display_name: string
  avatar_url: string | null
  nationality: string | null
  bio: string | null
  language: Profile['language']
  xp: number
  streak_count: number
  last_active_date: string | null
}

type VisitRow = {
  id: string
  user_id: string
  landmark_id: string
  source: Visit['source']
  xp_awarded: number
  created_at: string
}

const toLandmark = (row: LandmarkRow): Landmark => ({
  id: row.id,
  name: row.name,
  category: row.category,
  district: row.district,
  latitude: Number(row.latitude),
  longitude: Number(row.longitude),
  imageUrl: row.image_url,
  admissionFee: Number(row.admission_fee),
  rating: Number(row.rating),
  visitCount: row.visit_count,
  estimatedVisitMinutes: row.estimated_visit_minutes,
  visitingHours: row.visiting_hours,
  story: row.story,
})

const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  displayName: row.display_name,
  avatarUrl: row.avatar_url,
  nationality: row.nationality,
  bio: row.bio,
  language: row.language,
  xp: row.xp,
  streakCount: row.streak_count,
  lastActiveDate: row.last_active_date,
})

const toVisit = (row: VisitRow): Visit => ({
  id: row.id,
  userId: row.user_id,
  landmarkId: row.landmark_id,
  source: row.source,
  xpAwarded: row.xp_awarded,
  createdAt: row.created_at,
})

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Supabase query failed: ${result.error.message}`)
  return result.data
}

export function createSupabaseStore(db: SupabaseClient): DataStore {
  return {
    async listLandmarks() {
      const rows = check(await db.from('landmarks').select('*').order('name'))
      return (rows as LandmarkRow[]).map(toLandmark)
    },
    async getLandmark(id) {
      const row = check(await db.from('landmarks').select('*').eq('id', id).maybeSingle())
      return row ? toLandmark(row as LandmarkRow) : null
    },
    async listQuests() {
      const rows = check(
        await db
          .from('quests')
          .select('id, title, description, badge_name, quest_landmarks(landmark_id, position)')
          .order('title'),
      ) as Array<{
        id: string
        title: string
        description: string
        badge_name: string
        quest_landmarks: Array<{ landmark_id: string; position: number }>
      }>
      return rows.map(
        (row): Quest => ({
          id: row.id,
          title: row.title,
          description: row.description,
          badgeName: row.badge_name,
          landmarkIds: [...row.quest_landmarks]
            .sort((a, b) => a.position - b.position)
            .map((link) => link.landmark_id),
        }),
      )
    },
    async getOrCreateProfile(userId, defaults) {
      // Profiles are normally created by the on_auth_user_created trigger; this is a fallback.
      const existing = check(await db.from('profiles').select('*').eq('id', userId).maybeSingle())
      if (existing) return toProfile(existing as ProfileRow)
      const created = check(
        await db
          .from('profiles')
          .insert({ id: userId, display_name: defaults?.displayName ?? 'Traveler' })
          .select('*')
          .single(),
      )
      return toProfile(created as ProfileRow)
    },
    async updateProfile(userId, update) {
      const row: Partial<ProfileRow> = {}
      if (update.displayName !== undefined) row.display_name = update.displayName
      if (update.avatarUrl !== undefined) row.avatar_url = update.avatarUrl
      if (update.nationality !== undefined) row.nationality = update.nationality
      if (update.bio !== undefined) row.bio = update.bio
      if (update.language !== undefined) row.language = update.language
      if (update.xp !== undefined) row.xp = update.xp
      if (update.streakCount !== undefined) row.streak_count = update.streakCount
      if (update.lastActiveDate !== undefined) row.last_active_date = update.lastActiveDate
      const updated = check(await db.from('profiles').update(row).eq('id', userId).select('*').single())
      return toProfile(updated as ProfileRow)
    },
    async listVisits(userId) {
      const rows = check(
        await db.from('visits').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      )
      return (rows as VisitRow[]).map(toVisit)
    },
    async addVisit(input) {
      const row = check(
        await db
          .from('visits')
          .insert({
            user_id: input.userId,
            landmark_id: input.landmarkId,
            source: input.source,
            xp_awarded: input.xpAwarded,
          })
          .select('*')
          .single(),
      )
      return toVisit(row as VisitRow)
    },
  }
}
