// streak.js

/**
 * Calculate current streak from habit logs.
 * @param {Array<{date: string, completed: 0|1}>} logs - any order, deduplicated
 * @param {string} today - 'YYYY-MM-DD' string (server date in configured timezone)
 * @returns {number} current streak length
 */
export function calculateStreak(logs, today) {
  if (logs.length === 0) return 0

  const logMap = new Map(logs.map(l => [l.date, l.completed]))

  // Helper: subtract one day from a YYYY-MM-DD string
  function prevDay(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  }

  let streak = 0
  let cursor = today

  // Handle today
  if (!logMap.has(today)) {
    // Grace period: today not logged yet, start counting from yesterday
    cursor = prevDay(today)
  } else if (!logMap.get(today)) {
    // Today explicitly failed
    return 0
  } else {
    // Today completed
    streak = 1
    cursor = prevDay(today)
  }

  // Walk backwards
  for (let i = 0; i < 365; i++) {
    if (!logMap.has(cursor)) break      // gap = streak ends
    if (!logMap.get(cursor)) break      // false = streak ends
    streak++
    cursor = prevDay(cursor)
  }

  return streak
}
