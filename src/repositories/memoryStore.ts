import { randomUUID } from 'node:crypto'
import { LANDMARKS, QUESTS } from '../data/seed.js'
import type { Profile, Visit } from '../domain/types.js'
import type { DataStore } from './store.js'

export function createMemoryStore(): DataStore {
  const landmarks = structuredClone(LANDMARKS)
  const quests = structuredClone(QUESTS)
  const profiles = new Map<string, Profile>()
  const visits: Visit[] = []

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
  }
}
