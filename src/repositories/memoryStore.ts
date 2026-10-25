import { randomUUID } from 'node:crypto'
import { LANDMARKS, QUESTS } from '../data/seed.js'
import type { Profile, UserAccount, Visit } from '../domain/types.js'
import type { DataStore, NewUserAccount, StoredUserAccount } from './store.js'

export function createMemoryStore(): DataStore {
  const landmarks = structuredClone(LANDMARKS)
  const quests = structuredClone(QUESTS)
  const profiles = new Map<string, Profile>()
  const visits: Visit[] = []
  const users = new Map<string, StoredUserAccount>()
  const usersByEmail = new Map<string, string>()

  return {
    async listLandmarks() {
      return landmarks
    },
    async getLandmark(id) {
      return landmarks.find((landmark) => landmark.id === id) ?? null
    },
    async listQuests() {
      return quests
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
    async addVisit(input) {
      const visit: Visit = { id: randomUUID(), createdAt: new Date().toISOString(), ...input }
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
  }
}

