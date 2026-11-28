import { nextStreak, phtDate, rankFor, XP_PER_ENGAGEMENT, type RankInfo } from '../domain/xp.js'
import type { Profile, Quest, Visit, VisitSource } from '../domain/types.js'
import { DuplicateRewardError, type DataStore } from '../repositories/store.js'

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
      completed: quest.landmarkIds.length > 0 && completedLandmarkIds.length === quest.landmarkIds.length,
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
  const findRewardedToday = (list: Visit[]) =>
    list.find((visit) => visit.landmarkId === landmarkId && visit.xpAwarded > 0 && phtDate(new Date(visit.createdAt)) === today)

  // A same-day repeat earns nothing and changes nothing, so reuse the rewarded
  // visit instead of inserting a duplicate row (which would also inflate the
  // landmark's visit_count).
  const repeat = (visit: Visit): EngagementResult => ({
    visit, xpAwarded: 0, profile, rank: rankFor(profile.xp), leveledUp: false, newBadges: [],
  })
  const rewardedToday = findRewardedToday(visits)
  if (rewardedToday) return repeat(rewardedToday)

  const xpAwarded = XP_PER_ENGAGEMENT
  const before = questProgress(quests, visits)
  let visit: Visit
  try {
    visit = await store.addVisit({ userId, landmarkId, source, xpAwarded })
  } catch (err) {
    // A concurrent request for the same landmark earned today's XP between our
    // read and this insert; the database rejected ours, so this is a repeat.
    if (!(err instanceof DuplicateRewardError)) throw err
    const winner = findRewardedToday(await store.listVisits(userId))
    if (!winner) throw err
    return repeat(winner)
  }
  const after = questProgress(quests, [...visits, visit])

  const streak = nextStreak(profile, now)
  const updated = await store.awardXp(userId, { xp: xpAwarded, ...streak })

  const previousRank = rankFor(profile.xp)
  const rank = rankFor(updated.xp)
  const newBadges = after
    .filter((quest, i) => quest.completed && !before[i]?.completed)
    .map((quest) => quest.badgeName)

  return { visit, xpAwarded, profile: updated, rank, leveledUp: rank.level > previousRank.level, newBadges }
}

/**
 * For engagements that ride along with another result (a scan match, a chat
 * reply): a failed XP write is logged and reported as no progress, so the
 * traveler still gets their story or answer.
 */
export async function tryRecordEngagement(
  ...args: Parameters<typeof recordEngagement>
): Promise<EngagementResult | null> {
  try {
    return await recordEngagement(...args)
  } catch (err) {
    console.error(`Failed to record ${args[3]} engagement for landmark ${args[2]}:`, err)
    return null
  }
}
