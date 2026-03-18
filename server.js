// server.js
import 'dotenv/config'
import express from 'express'
import { initDb } from './database.js'
import habitsRouter from './routes/habits.js'
import logsRouter from './routes/logs.js'
import groupRouter from './routes/group.js'

const app = express()
app.use(express.json())
app.use(express.static('public'))

// Init DB
initDb(process.env.DATABASE_PATH || './data/habits.db')

// Auth middleware — parses Telegram initData, attaches req.telegramUser
app.use('/api', (req, res, next) => {
  const auth = req.headers.authorization || ''
  const initData = auth.startsWith('tma ') ? auth.slice(4) : ''
  if (!initData) return res.status(401).json({ error: 'Missing auth' })

  try {
    const params = new URLSearchParams(initData)
    const userJson = params.get('user')
    if (!userJson) return res.status(401).json({ error: 'No user in initData' })
    req.telegramUser = JSON.parse(userJson)
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid initData' })
  }
})

// Auth endpoint
app.post('/api/auth', async (req, res) => {
  try {
    const { id, username, first_name } = req.telegramUser
    const { upsertUser, getGroupsByUserId } = await import('./database.js')
    const user = upsertUser({ telegram_id: id, username, first_name })
    const groups = getGroupsByUserId(user.id)
    res.json({ user, groups })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.use('/api/habits', habitsRouter)
app.use('/api/logs', logsRouter)
app.use('/api/group', groupRouter)

// Stats endpoint (streaks + last 30 days per habit)
app.get('/api/stats/:userId', async (req, res) => {
  try {
    const { upsertUser, getHabitsByUserId, getLogsForStreakCalc, getLogsByHabitAndMonth } = await import('./database.js')
    const { calculateStreak } = await import('./streak.js')
    const tgUser = req.telegramUser
    const user = upsertUser({ telegram_id: tgUser.id, username: tgUser.username, first_name: tgUser.first_name })
    if (user.id !== parseInt(req.params.userId)) return res.status(403).json({ error: 'Forbidden' })
    const today = new Date().toLocaleDateString('sv', { timeZone: process.env.CRON_TIMEZONE || 'UTC' })
    const month = today.slice(0, 7)
    const habits = getHabitsByUserId(user.id).map(habit => {
      const logs = getLogsForStreakCalc(habit.id)
      const monthLogs = getLogsByHabitAndMonth(habit.id, month)
      return { ...habit, streak: calculateStreak(logs, today), monthLogs }
    })
    res.json(habits)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))

export default app
