import type { SupabaseClient } from '@supabase/supabase-js'
import type { Landmark, Profile, Quest, SavedPlace, Visit } from '../domain/types.js'
import { DuplicateRewardError, type DataStore } from './store.js'

const UNIQUE_VIOLATION = '23505'
const ONE_REWARD_PER_DAY_INDEX = 'visits_one_reward_per_day'

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
  terms_accepted_at: string | null
}

type VisitRow = {
  id: string
  user_id: string
  landmark_id: string
  source: Visit['source']
  xp_awarded: number
  created_at: string
}

type SavedPlaceRow = {
  id: string
  user_id: string
  landmark_id: string
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
  termsAcceptedAt: row.terms_accepted_at,
})

const toVisit = (row: VisitRow): Visit => ({
  id: row.id,
  userId: row.user_id,
  landmarkId: row.landmark_id,
  source: row.source,
  xpAwarded: row.xp_awarded,
  createdAt: row.created_at,
})

const toSavedPlace = (row: SavedPlaceRow): SavedPlace => ({
  id: row.id,
  userId: row.user_id,
  landmarkId: row.landmark_id,
  createdAt: row.created_at,
})

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Supabase query failed: ${result.error.message}`)
  return result.data
}

export function createSupabaseStore(db: SupabaseClient): DataStore {
  return {
    async listLandmarks(options) {
      if (!options?.allPages) {
        const rows = check(await db.from('landmarks').select('*').order('name'))
        return (rows as LandmarkRow[]).map(toLandmark)
      }

      const landmarks: Landmark[] = []
      let afterId: string | undefined
      for (;;) {
        const page = db.from('landmarks').select('*').order('id').limit(500)
        const rows = check(await (afterId === undefined ? page : page.gt('id', afterId))) as LandmarkRow[]
        const last = rows.at(-1)
        // A short page can still have a successor if the project caps page size.
        if (!last) return landmarks

        for (const row of rows) landmarks.push(toLandmark(row))
        afterId = last.id
      }
    },
    async getLandmark(id) {
      const row = check(await db.from('landmarks').select('*').eq('id', id).maybeSingle())
      return row ? toLandmark(row as LandmarkRow) : null
    },
    async saveLandmark(landmark) {
      const row: LandmarkRow = {
        id: landmark.id,
        name: landmark.name,
        category: landmark.category,
        district: landmark.district,
        latitude: landmark.latitude,
        longitude: landmark.longitude,
        image_url: landmark.imageUrl,
        admission_fee: landmark.admissionFee,
        rating: landmark.rating,
        visit_count: landmark.visitCount,
        estimated_visit_minutes: landmark.estimatedVisitMinutes,
        visiting_hours: landmark.visitingHours,
        story: landmark.story,
      }
      const saved = check(await db.from('landmarks').upsert(row).select('*').single())
      return toLandmark(saved as LandmarkRow)
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
      if (update.termsAcceptedAt !== undefined) row.terms_accepted_at = update.termsAcceptedAt
      const updated = check(await db.from('profiles').update(row).eq('id', userId).select('*').single())
      return toProfile(updated as ProfileRow)
    },
    async listVisits(userId) {
      const rows = check(
        await db.from('visits').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      )
      return (rows as VisitRow[]).map(toVisit)
    },
    async recordReward(reward) {
      // record_visit inserts the visit and adds XP + streak in one transaction
      // (migration 20261128110000_xp_race_guards.sql).
      const result = check(
        await db.rpc('record_visit', {
          p_user_id: reward.userId,
          p_landmark_id: reward.landmarkId,
          p_source: reward.source,
          p_xp: reward.xpAwarded,
          p_streak_count: reward.streakCount,
          p_last_active_date: reward.lastActiveDate,
        }),
      ) as { duplicate: true } | { duplicate: false; visit: VisitRow; profile: ProfileRow }
      if (result.duplicate) throw new DuplicateRewardError()
      return { visit: toVisit(result.visit), profile: toProfile(result.profile) }
    },
    async addVisit(input) {
      const result = await db
        .from('visits')
        .insert({
          user_id: input.userId,
          landmark_id: input.landmarkId,
          source: input.source,
          xp_awarded: input.xpAwarded,
        })
        .select('*')
        .single()
      if (result.error?.code === UNIQUE_VIOLATION && result.error.message.includes(ONE_REWARD_PER_DAY_INDEX)) {
        throw new DuplicateRewardError()
      }
      return toVisit(check(result) as VisitRow)
    },
    async createUserAccount(input) {
      const { data, error } = await db.auth.admin.createUser({
        email: input.email,
        password: input.passwordHash,
        email_confirm: true,
        user_metadata: { display_name: input.displayName },
      })
      if (error || !data.user) throw new Error(`Supabase user creation failed: ${error?.message}`)
      return {
        id: data.user.id,
        email: data.user.email ?? input.email,
        displayName: input.displayName,
        createdAt: data.user.created_at,
      }
    },
    async isEmailRegistered(email) {
      // supabase/migrations/20261128000000_email_registered.sql; callable with the secret key only.
      const { data, error } = await db.rpc('email_registered', { p_email: email })
      if (error) throw new Error(`Email check failed: ${error.message}`)
      return data === true
    },
    async findUserAccountById(id) {
      const { data, error } = await db.auth.admin.getUserById(id)
      if (error || !data.user) return null
      const meta = data.user.user_metadata as { display_name?: string } | undefined
      return {
        id: data.user.id,
        email: data.user.email ?? '',
        displayName: meta?.display_name ?? 'Traveler',
        createdAt: data.user.created_at,
      }
    },
    async savePlace(userId, landmarkId) {
      const row = check(
        await db
          .from('saved_places')
          .upsert(
            { user_id: userId, landmark_id: landmarkId },
            { onConflict: 'user_id,landmark_id' },
          )
          .select('*')
          .single(),
      )
      return toSavedPlace(row as SavedPlaceRow)
    },
    async listSavedPlaces(userId) {
      const rows = check(
        await db
          .from('saved_places')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
      )
      return (rows as SavedPlaceRow[]).map(toSavedPlace)
    },
    async removeSavedPlace(userId, landmarkId) {
      const { error, count } = await db
        .from('saved_places')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .eq('landmark_id', landmarkId)
      if (error) throw new Error(`Failed to remove saved place: ${error.message}`)
      return (count ?? 0) > 0
    },
  }
}
