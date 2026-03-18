// routes/habits.js
import { Router } from 'express'
import {
  getHabitsByUserId, createHabit, getHabitById, updateHabit, archiveHabit, upsertUser
} from '../database.js'
import { getLogsForStreakCalc } from '../database.js'
import { calculateStreak } from '../streak.js'

const router = Router()

// GET /api/habits/:userId
router.get('/:userId', (req, res) => {
  const { telegramUser } = req
  const user = upsertUser({
    telegram_id: telegramUser.id,
    username: telegramUser.username,
    first_name: telegramUser.first_name
  })

  // Auth: can only read own habits
  if (user.id !== parseInt(req.params.userId)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const today = new Date().toLocaleDateString('sv', {
    timeZone: process.env.CRON_TIMEZONE || 'UTC'
  })

  const habits = getHabitsByUserId(user.id).map(habit => {
    const logs = getLogsForStreakCalc(habit.id)
    return { ...habit, streak: calculateStreak(logs, today) }
  })

  res.json(habits)
})

// POST /api/habits
router.post('/', (req, res) => {
  const { telegramUser } = req
  const user = upsertUser({
    telegram_id: telegramUser.id,
    username: telegramUser.username,
    first_name: telegramUser.first_name
  })
  const { title, type, emoji } = req.body
  if (!title || !type || !emoji) {
    return res.status(400).json({ error: 'title, type, emoji required' })
  }
  if (!['quit', 'build'].includes(type)) {
    return res.status(400).json({ error: 'type must be quit or build' })
  }
  const habit = createHabit({ user_id: user.id, title, type, emoji })
  res.status(201).json(habit)
})

// PUT /api/habits/:id
router.put('/:id', (req, res) => {
  const { telegramUser } = req
  const user = upsertUser({
    telegram_id: telegramUser.id,
    username: telegramUser.username,
    first_name: telegramUser.first_name
  })
  const habit = getHabitById(parseInt(req.params.id))
  if (!habit) return res.status(404).json({ error: 'Not found' })
  if (habit.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' })

  const { title, emoji, is_active } = req.body
  if (is_active === 0) {
    archiveHabit(habit.id)
    return res.json({ archived: true })
  }
  const updated = updateHabit(habit.id, {
    title: title ?? habit.title,
    emoji: emoji ?? habit.emoji
  })
  res.json(updated)
})

export default router
