import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateStreak } from '../streak.js'

const TODAY = '2026-03-19'

test('returns 0 when no logs', () => {
  assert.equal(calculateStreak([], TODAY), 0)
})

test('returns 1 when only today is completed', () => {
  const logs = [{ date: TODAY, completed: 1 }]
  assert.equal(calculateStreak(logs, TODAY), 1)
})

test('grace period: yesterday completed, today not logged → streak = 1', () => {
  const logs = [{ date: '2026-03-18', completed: 1 }]
  assert.equal(calculateStreak(logs, TODAY), 1)
})

test('today failed → streak = 0 immediately', () => {
  const logs = [
    { date: TODAY, completed: 0 },
    { date: '2026-03-18', completed: 1 },
  ]
  assert.equal(calculateStreak(logs, TODAY), 0)
})

test('streak breaks on false in past', () => {
  const logs = [
    { date: '2026-03-18', completed: 0 },
    { date: '2026-03-17', completed: 1 },
    { date: '2026-03-16', completed: 1 },
  ]
  assert.equal(calculateStreak(logs, TODAY), 0)
})

test('counts consecutive days correctly', () => {
  const logs = [
    { date: '2026-03-18', completed: 1 },
    { date: '2026-03-17', completed: 1 },
    { date: '2026-03-16', completed: 1 },
  ]
  // today not logged → grace, streak from 18→16 = 3
  assert.equal(calculateStreak(logs, TODAY), 3)
})

test('gap in past breaks streak', () => {
  const logs = [
    { date: '2026-03-18', completed: 1 },
    // 2026-03-17 missing
    { date: '2026-03-16', completed: 1 },
  ]
  assert.equal(calculateStreak(logs, TODAY), 1)
})

test('today + consecutive past = total', () => {
  const logs = [
    { date: TODAY, completed: 1 },
    { date: '2026-03-18', completed: 1 },
    { date: '2026-03-17', completed: 1 },
  ]
  assert.equal(calculateStreak(logs, TODAY), 3)
})
