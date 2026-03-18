// bot.js
import TelegramBot from 'node-telegram-bot-api'
import cron from 'node-cron'
import {
  upsertUser, upsertGroup, addGroupMember, getGroupById,
  getAllGroups, getGroupMembers, getHabitsByUserId,
  getLogsByUserAndDate, getLogsForStreakCalc, getUserByTelegramId
} from './database.js'
import { calculateStreak } from './streak.js'

let bot

export function setupBot() {
  if (!process.env.BOT_TOKEN) {
    console.warn('BOT_TOKEN not set — bot disabled')
    return
  }

  bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true })

  // /start — greeting + open Mini App button (or group join prompt)
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const tgUser = msg.from
    const user = upsertUser({
      telegram_id: tgUser.id,
      username: tgUser.username,
      first_name: tgUser.first_name
    })

    const webAppUrl = process.env.WEBAPP_URL
    await bot.sendMessage(msg.chat.id,
      `Привет, ${tgUser.first_name}! 👋\n\nОткрой трекер привычек:`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '📅 Открыть трекер', web_app: { url: webAppUrl } }
          ]]
        }
      }
    )
  })

  // /setup — group chat only, creates/links group in DB
  bot.onText(/\/setup/, async (msg) => {
    if (msg.chat.type === 'private') {
      return bot.sendMessage(msg.chat.id, 'Команда /setup используется в групповом чате.')
    }
    const group = upsertGroup({
      telegram_group_id: msg.chat.id,
      title: msg.chat.title
    })
    await bot.sendMessage(msg.chat.id,
      `✅ Группа "${group.title}" настроена!\n\n` +
      `Каждый участник должен написать мне в личку:\n` +
      `/join ${group.id}`
    )
  })

  // /join <group_db_id> — DM only, links user to group
  bot.onText(/\/join(?:\s+(\d+))?/, async (msg, match) => {
    if (msg.chat.type !== 'private') {
      return bot.sendMessage(msg.chat.id, 'Команда /join работает только в личке.')
    }
    const groupId = parseInt(match?.[1])
    if (!groupId) {
      return bot.sendMessage(msg.chat.id, 'Укажи ID группы: /join 42')
    }
    const group = getGroupById(groupId)
    if (!group) {
      return bot.sendMessage(msg.chat.id, '❌ Группа не найдена. Попроси администратора запустить /setup в группе.')
    }
    const user = upsertUser({
      telegram_id: msg.from.id,
      username: msg.from.username,
      first_name: msg.from.first_name
    })
    addGroupMember({ group_id: group.id, user_id: user.id })
    await bot.sendMessage(msg.chat.id,
      `✅ Ты добавлен в группу "${group.title}"!\n\nТеперь открой трекер:`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '📅 Открыть трекер', web_app: { url: process.env.WEBAPP_URL } }
          ]]
        }
      }
    )
  })

  // /stats — group chat, posts today's summary
  bot.onText(/\/stats/, async (msg) => {
    if (msg.chat.type === 'private') {
      return bot.sendMessage(msg.chat.id, '/stats работает в групповом чате.')
    }
    await postGroupStats(msg.chat.id)
  })

  // Setup cron if enabled
  if (process.env.ENABLE_CRON === 'true') {
    setupCron()
  }

  console.log('Bot started')
  return bot
}

async function postGroupStats(chatId) {
  // Find group by telegram_group_id
  const { getDb } = await import('./database.js')
  const group = getDb().prepare('SELECT * FROM groups WHERE telegram_group_id = ?').get(chatId)
  if (!group) return

  const today = new Date().toLocaleDateString('sv', {
    timeZone: process.env.CRON_TIMEZONE || 'UTC'
  })

  const members = getGroupMembers(group.id)
  if (members.length === 0) return

  let text = `📊 *Прогресс сегодня, ${today}*\n\n`

  for (const member of members) {
    const habits = getHabitsByUserId(member.id)
    const logs = getLogsByUserAndDate(member.id, today)
    const logMap = new Map(logs.map(l => [l.habit_id, l.completed]))

    const marked = habits.some(h => logMap.has(h.id))
    text += `*${member.first_name}* ${marked ? '✓' : '—'}\n`

    for (const habit of habits) {
      const allLogs = getLogsForStreakCalc(habit.id)
      const streak = calculateStreak(allLogs, today)
      const status = logMap.has(habit.id)
        ? (logMap.get(habit.id) ? '✅' : '❌')
        : '⬜'
      text += `  ${status} ${habit.emoji} ${habit.title}`
      if (streak > 0) text += ` 🔥${streak}д`
      text += '\n'
    }
    text += '\n'
  }

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
}

function setupCron() {
  const tz = process.env.CRON_TIMEZONE || 'UTC'

  // 21:00 — daily reminder
  cron.schedule('0 21 * * *', async () => {
    const groups = getAllGroups()
    for (const group of groups) {
      try {
        await bot.sendMessage(group.telegram_group_id,
          '🔔 Эй! Не забудьте отметить привычки сегодня',
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '📅 Открыть трекер', web_app: { url: process.env.WEBAPP_URL } }
              ]]
            }
          }
        )
      } catch (e) {
        console.error(`Failed to send reminder to group ${group.id}:`, e.message)
      }
    }
  }, { timezone: tz })

  // 22:00 — streak milestone check
  cron.schedule('0 22 * * *', async () => {
    const MILESTONES = [7, 14, 30, 60, 100]
    const today = new Date().toLocaleDateString('sv', { timeZone: tz })
    const groups = getAllGroups()

    for (const group of groups) {
      const members = getGroupMembers(group.id)
      for (const member of members) {
        const habits = getHabitsByUserId(member.id)
        for (const habit of habits) {
          const logs = getLogsForStreakCalc(habit.id)
          const streak = calculateStreak(logs, today)
          if (MILESTONES.includes(streak)) {
            try {
              await bot.sendMessage(group.telegram_group_id,
                `🔥 Поздравляем ${member.first_name}! ` +
                `${habit.emoji} ${habit.title} — уже ${streak} дней подряд!`
              )
            } catch (e) {
              console.error(`Failed to send milestone to group ${group.id}:`, e.message)
            }
          }
        }
      }
    }
  }, { timezone: tz })

  console.log('Cron jobs scheduled')
}
