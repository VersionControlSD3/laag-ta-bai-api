/** SRS 3.1.3.1.a: flat XP per Gemini-powered landmark engagement. */
export const XP_PER_ENGAGEMENT = 50

/**
 * Mastery ranks by cumulative XP (SRS 3.1.3.1.b). The SRS leaves the exact
 * thresholds open; these are placeholders for the team to tune.
 */
export const RANKS = [
  { level: 1, title: 'Newcomer', minXp: 0 },
  { level: 2, title: 'Wanderer', minXp: 200 },
  { level: 3, title: 'Explorer', minXp: 500 },
  { level: 4, title: 'Pathfinder', minXp: 1000 },
  { level: 5, title: 'Heritage Keeper', minXp: 2000 },
  { level: 6, title: 'Legend of Sugbo', minXp: 4000 },
] as const

export type RankInfo = {
  level: number
  title: string
  xp: number
  currentLevelXp: number
  nextLevelXp: number | null
}

export function rankFor(xp: number): RankInfo {
  let index = 0
  RANKS.forEach((rank, i) => {
    if (xp >= rank.minXp) index = i
  })
  const rank = RANKS[index]!
  const next = RANKS[index + 1]
  return {
    level: rank.level,
    title: rank.title,
    xp,
    currentLevelXp: rank.minXp,
    nextLevelXp: next ? next.minXp : null,
  }
}

/** Streak update rule (SRS 3.1.3.2.a), using Philippine Time (UTC+8) calendar days. */
export function phtDate(date: Date): string {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function nextStreak(
  previous: { streakCount: number; lastActiveDate: string | null },
  now: Date,
): { streakCount: number; lastActiveDate: string } {
  const today = phtDate(now)
  if (previous.lastActiveDate === today) {
    return { streakCount: Math.max(previous.streakCount, 1), lastActiveDate: today }
  }
  const yesterday = phtDate(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const streakCount = previous.lastActiveDate === yesterday ? previous.streakCount + 1 : 1
  return { streakCount, lastActiveDate: today }
}
