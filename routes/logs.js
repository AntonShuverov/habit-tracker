// routes/logs.js
import { Router } from 'express'
import {
  upsertUser, getLogsByUserAndDate, upsertLog,
  getHabitsByUserId, getLogsByHabitAndMonth
} from '../database.js'

const router = Router()

// GET /api/logs/:userId/calendar/:month  — MUST be before /:userId/:date to avoid shadowing
// month = 'YYYY-MM'
router.get('/:userId/calendar/:month', (req, res) => {
  const { telegramUser } = req
  const user = upsertUser({
    telegram_id: telegramUser.id,
    username: telegramUser.username,
    first_name: telegramUser.first_name
  })
  if (user.id !== parseInt(req.params.userId)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  const habits = getHabitsByUserId(user.id)
  const result = habits.map(habit => ({
    habit,
    logs: getLogsByHabitAndMonth(habit.id, req.params.month)
  }))
  res.json(result)
})

// GET /api/logs/:userId/:date
router.get('/:userId/:date', (req, res) => {
  const { telegramUser } = req
  const user = upsertUser({
    telegram_id: telegramUser.id,
    username: telegramUser.username,
    first_name: telegramUser.first_name
  })
  if (user.id !== parseInt(req.params.userId)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  const logs = getLogsByUserAndDate(user.id, req.params.date)
  res.json(logs)
})

// POST /api/logs
router.post('/', (req, res) => {
  const { telegramUser } = req
  const user = upsertUser({
    telegram_id: telegramUser.id,
    username: telegramUser.username,
    first_name: telegramUser.first_name
  })
  const { habitId, date, completed } = req.body
  if (!habitId || !date || completed === undefined) {
    return res.status(400).json({ error: 'habitId, date, completed required' })
  }
  const log = upsertLog({ habit_id: habitId, user_id: user.id, date, completed })
  res.json(log)
})

export default router
