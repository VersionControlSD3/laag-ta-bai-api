import { nextStreak, phtDate, rankFor, XP_PER_ENGAGEMENT, type RankInfo } from '../domain/xp.js'
import type { Profile, Quest, Visit, VisitSource } from '../domain/types.js'
import type { DataStore } from '../repositories/store.js'

export type QuestProgress = Quest & {
  completedLandmarkIds: string[]
  completed: boolean
}

export type EngagementResult = {
  visit: Visit
  xpAwarded: number
  profile: Profile
  rank: RankInfo
  leveledUp: boolean
  newBadges: string[]
}

export function questProgress(quests: Quest[], visits: Visit[]): QuestProgress[] {
  const visited = new Set(visits.map((visit) => visit.landmarkId))
  return quests.map((quest) => {
    const completedLandmarkIds = quest.landmarkIds.filter((id) => visited.has(id))
    return {
      ...quest,
      completedLandmarkIds,
      completed: completedLandmarkIds.length === quest.landmarkIds.length,
    }
  })
}

/**
 * Records a landmark engagement. XP (SRS 3.1.3.1.a) is awarded once per landmark
 * per PHT day so repeated scans or chats can't farm XP. Updates the streak and
 * reports level-ups and newly completed quest badges.
 */
export async function recordEngagement(
  store: DataStore,
  userId: string,
  landmarkId: string,
  source: VisitSource,
  options: { displayName?: string; now?: Date } = {},
): Promise<EngagementResult> {
  const now = options.now ?? new Date()
  const [profile, visits, quests] = await Promise.all([
    store.getOrCreateProfile(userId, { displayName: options.displayName }),
    store.listVisits(userId),
    store.listQuests(),
  ])

  const today = phtDate(now)
  const alreadyToday = visits.some(
    (visit) => visit.landmarkId === landmarkId && phtDate(new Date(visit.createdAt)) === today && visit.xpAwarded > 0,
  )
  const xpAwarded = alreadyToday ? 0 : XP_PER_ENGAGEMENT

  const before = questProgress(quests, visits)
  const visit = await store.addVisit({ userId, landmarkId, source, xpAwarded })
  const after = questProgress(quests, [...visits, visit])

  const streak = nextStreak(profile, now)
  const updated = await store.updateProfile(userId, { xp: profile.xp + xpAwarded, ...streak })

  const previousRank = rankFor(profile.xp)
  const rank = rankFor(updated.xp)
  const newBadges = after
    .filter((quest, i) => quest.completed && !before[i]?.completed)
    .map((quest) => quest.badgeName)

  return { visit, xpAwarded, profile: updated, rank, leveledUp: rank.level > previousRank.level, newBadges }
}
