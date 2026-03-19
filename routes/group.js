// routes/group.js
import { Router } from 'express'
import {
  upsertUser, getGroupById, isGroupMember, getGroupMembers,
  getHabitsByUserId, getLogsByUserAndDate, getLogsForStreakCalc,
  getGroupsByUserId
} from '../database.js'
import { calculateStreak } from '../streak.js'

const router = Router()

// GET /api/group/user/groups — MUST be before /:groupId/members to avoid shadowing
router.get('/user/groups', (req, res) => {
  const { telegramUser } = req
  const user = upsertUser({
    telegram_id: telegramUser.id,
    username: telegramUser.username,
    first_name: telegramUser.first_name
  })
  res.json(getGroupsByUserId(user.id))
})

// GET /api/group/:groupId/members
router.get('/:groupId/members', (req, res) => {
  const { telegramUser } = req
  const user = upsertUser({
    telegram_id: telegramUser.id,
    username: telegramUser.username,
    first_name: telegramUser.first_name
  })
  const groupId = parseInt(req.params.groupId)
  if (!isGroupMember({ group_id: groupId, user_id: user.id })) {
    return res.status(403).json({ error: 'Not a member' })
  }

  // Prefer client-sent date (avoids server timezone mismatches)
  const today = req.query.date || new Date().toLocaleDateString('sv', {
    timeZone: process.env.CRON_TIMEZONE || 'UTC'
  })

  const members = getGroupMembers(groupId).map(member => {
    const habits = getHabitsByUserId(member.id).map(habit => {
      const logs = getLogsForStreakCalc(habit.id)
      return { ...habit, streak: calculateStreak(logs, today) }
    })
    const todayLogs = getLogsByUserAndDate(member.id, today)
    const markedToday = todayLogs.length > 0
    return { ...member, habits, markedToday }
  })

  res.json(members)
})

export default router
