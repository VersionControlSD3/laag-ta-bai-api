import { randomUUID } from 'node:crypto'
import { LANDMARKS, QUESTS } from '../data/seed.js'
import type { Profile, SavedPlace, UserAccount, Visit } from '../domain/types.js'
import { phtDate } from '../domain/xp.js'
import { DuplicateRewardError, type DataStore, type NewUserAccount, type StoredUserAccount } from './store.js'

export function createMemoryStore(): DataStore {
  const landmarks = structuredClone(LANDMARKS)
  const quests = structuredClone(QUESTS)
  const profiles = new Map<string, Profile>()
  const visits: Visit[] = []
  const users = new Map<string, StoredUserAccount>()
  const usersByEmail = new Map<string, string>()
  const savedPlaces: SavedPlace[] = []

  return {
    async listLandmarks() {
      return landmarks
    },
    async getLandmark(id) {
      return landmarks.find((landmark) => landmark.id === id) ?? null
    },
    async saveLandmark(landmark) {
      const index = landmarks.findIndex((l) => l.id === landmark.id)
      if (index >= 0) {
        landmarks[index] = landmark
      } else {
        landmarks.push(landmark)
      }
      return landmark
    },
    async listQuests() {
      return [...quests].sort((a, b) => a.title.localeCompare(b.title))
    },
    async getOrCreateProfile(userId, defaults) {
      let profile = profiles.get(userId)
      if (!profile) {
        profile = {
          id: userId,
          displayName: defaults?.displayName ?? 'Traveler',
          avatarUrl: null,
          nationality: null,
          bio: null,
          language: 'en',
          xp: 0,
          streakCount: 0,
          lastActiveDate: null,
          termsAcceptedAt: null,
        }
        profiles.set(userId, profile)
      }
      return profile
    },
    async updateProfile(userId, update) {
      const current = await this.getOrCreateProfile(userId)
      const next = { ...current, ...update }
      profiles.set(userId, next)
      return next
    },
    async listVisits(userId) {
      return visits
        .filter((visit) => visit.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async recordReward({ streakCount, lastActiveDate, ...input }) {
      // Mirrors public.record_visit: validate first so a failure writes nothing.
      if (!profiles.has(input.userId)) throw new Error(`profile ${input.userId} not found`)
      const visit = await this.addVisit(input) // duplicate check + insert run without yielding
      // No await between reading and writing the profile, so concurrent
      // rewards cannot overwrite each other's XP.
      const current = profiles.get(input.userId)!
      const profile = { ...current, xp: current.xp + input.xpAwarded, streakCount, lastActiveDate }
      profiles.set(input.userId, profile)
      return { visit, profile }
    },
    async addVisit(input) {
      const createdAt = new Date().toISOString()
      // Mirrors the visits_one_reward_per_day unique index.
      if (
        input.xpAwarded > 0 &&
        visits.some(
          (v) =>
            v.userId === input.userId &&
            v.landmarkId === input.landmarkId &&
            v.xpAwarded > 0 &&
            phtDate(new Date(v.createdAt)) === phtDate(new Date(createdAt)),
        )
      ) {
        throw new DuplicateRewardError()
      }
      const visit: Visit = { id: randomUUID(), createdAt, ...input }
      visits.push(visit)
      const landmark = landmarks.find((l) => l.id === input.landmarkId)
      if (landmark) landmark.visitCount += 1
      return visit
    },
    async createUserAccount(input: NewUserAccount): Promise<UserAccount> {
      const emailKey = input.email.trim().toLowerCase()
      if (usersByEmail.has(emailKey)) {
        throw new Error('User already exists')
      }
      const id = randomUUID()
      const user: StoredUserAccount = {
        id,
        email: input.email.trim(),
        displayName: input.displayName.trim() || 'Traveler',
        passwordHash: input.passwordHash,
        createdAt: new Date().toISOString(),
      }
      users.set(id, user)
      usersByEmail.set(emailKey, id)
      // Mirror the on_auth_user_created trigger in Postgres
      await this.getOrCreateProfile(id, { displayName: user.displayName })
      return { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt }
    },
    async isEmailRegistered(email: string): Promise<boolean> {
      return usersByEmail.has(email.trim().toLowerCase())
    },
    async findUserAccountByEmail(email: string): Promise<StoredUserAccount | null> {
      const id = usersByEmail.get(email.trim().toLowerCase())
      if (!id) return null
      return users.get(id) ?? null
    },
    async findUserAccountById(id: string): Promise<UserAccount | null> {
      const user = users.get(id)
      if (!user) return null
      return { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt }
    },
    async savePlace(userId: string, landmarkId: string): Promise<SavedPlace> {
      const existing = savedPlaces.find((p) => p.userId === userId && p.landmarkId === landmarkId)
      if (existing) return existing
      const place: SavedPlace = {
        id: randomUUID(),
        userId,
        landmarkId,
        createdAt: new Date().toISOString(),
      }
      savedPlaces.push(place)
      return place
    },
    async listSavedPlaces(userId: string): Promise<SavedPlace[]> {
      return savedPlaces
        .filter((p) => p.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async removeSavedPlace(userId: string, landmarkId: string): Promise<boolean> {
      const index = savedPlaces.findIndex((p) => p.userId === userId && p.landmarkId === landmarkId)
      if (index === -1) return false
      savedPlaces.splice(index, 1)
      return true
    },
  }
}
