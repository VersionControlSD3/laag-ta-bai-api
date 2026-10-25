import type { Landmark, Profile, ProfileUpdate, Quest, UserAccount, Visit, VisitSource } from '../domain/types.js'

export type NewVisit = { userId: string; landmarkId: string; source: VisitSource; xpAwarded: number }

export type NewUserAccount = { email: string; passwordHash: string; displayName: string }
export type StoredUserAccount = UserAccount & { passwordHash: string }

/**
 * Data access used by the routes. Two implementations exist:
 * - memoryStore: seed data in process memory (local dev, tests, CI)
 * - supabaseStore: Supabase Postgres via the server-side secret key
 */
export interface DataStore {
  listLandmarks(): Promise<Landmark[]>
  getLandmark(id: string): Promise<Landmark | null>
  listQuests(): Promise<Quest[]>
  /** Returns the profile, creating a default one on first access. */
  getOrCreateProfile(userId: string, defaults?: { displayName?: string }): Promise<Profile>
  updateProfile(userId: string, update: ProfileUpdate & Partial<Pick<Profile, 'xp' | 'streakCount' | 'lastActiveDate'>>): Promise<Profile>
  listVisits(userId: string): Promise<Visit[]>
  addVisit(visit: NewVisit): Promise<Visit>
  createUserAccount?(user: NewUserAccount): Promise<UserAccount>
  findUserAccountByEmail?(email: string): Promise<StoredUserAccount | null>
  findUserAccountById?(id: string): Promise<UserAccount | null>
}
