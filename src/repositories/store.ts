import type { Landmark, Profile, ProfileUpdate, Quest, SavedPlace, UserAccount, Visit, VisitSource } from '../domain/types.js'

export type NewVisit = { userId: string; landmarkId: string; source: VisitSource; xpAwarded: number }

/**
 * Thrown by addVisit when the user already has an XP-earning visit at the
 * landmark on the same PHT day (enforced by the database, so concurrent
 * requests cannot both earn XP).
 */
export class DuplicateRewardError extends Error {
  constructor() {
    super('XP for this landmark was already awarded today')
    this.name = 'DuplicateRewardError'
  }
}

export type NewReward = NewVisit & { streakCount: number; lastActiveDate: string }

export type NewUserAccount ={ email: string; passwordHash: string; displayName: string }
export type StoredUserAccount = UserAccount & { passwordHash: string }

/**
 * Data access used by the routes. Two implementations exist:
 * - memoryStore: seed data in process memory (local dev, tests, CI)
 * - supabaseStore: Supabase Postgres via the server-side secret key
 */
export interface DataStore {
  /** Request all pages when the caller needs to rank the full collection. */
  listLandmarks(options?: { allPages?: boolean }): Promise<Landmark[]>
  getLandmark(id: string): Promise<Landmark | null>
  saveLandmark(landmark: Landmark): Promise<Landmark>
  listQuests(): Promise<Quest[]>
  /** Returns the profile, creating a default one on first access. */
  getOrCreateProfile(userId: string, defaults?: { displayName?: string }): Promise<Profile>
  updateProfile(userId: string, update: ProfileUpdate & Partial<Pick<Profile, 'xp' | 'streakCount' | 'lastActiveDate' | 'termsAcceptedAt'>>): Promise<Profile>
  listVisits(userId: string): Promise<Visit[]>
  /** Throws DuplicateRewardError for a second XP-earning visit on the same PHT day. */
  addVisit(visit: NewVisit): Promise<Visit>
  /**
   * Saves an XP-earning visit and adds its XP and streak to the profile as one
   * all-or-nothing operation: a failure never leaves a visit whose XP was not
   * credited. XP is added as xp + n, so concurrent rewards both count. Throws
   * DuplicateRewardError when today's reward for the landmark was already taken.
   */
  recordReward(reward: NewReward): Promise<{ visit: Visit; profile: Profile }>
  createUserAccount?(user: NewUserAccount): Promise<UserAccount>
  findUserAccountByEmail?(email: string): Promise<StoredUserAccount | null>
  findUserAccountById?(id: string): Promise<UserAccount | null>
  savePlace(userId: string, landmarkId: string): Promise<SavedPlace>
  listSavedPlaces(userId: string): Promise<SavedPlace[]>
  removeSavedPlace?(userId: string, landmarkId: string): Promise<boolean>
}
