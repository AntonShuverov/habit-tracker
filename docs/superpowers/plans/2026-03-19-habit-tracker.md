# Habit Tracker Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram Mini App + Bot for tracking personal habits in a closed group of friends/family.

**Architecture:** Node.js monolith — Express serves both the REST API and the static Mini App HTML. SQLite stores all data via better-sqlite3 (synchronous). The Telegram bot runs in the same process using polling. Streak logic lives in an isolated pure module for testability.

**Tech Stack:** Node.js 18+, Express 4, better-sqlite3, node-telegram-bot-api, node-cron, dotenv

---

## File Map

```
habit-tracker/
├── server.js           — Express app init, middleware, route mounting, static serving
├── database.js         — SQLite connection, schema creation, all DB query functions
├── bot.js              — Telegram bot setup, commands (/start /setup /join /stats), cron jobs
├── streak.js           — Pure streak calculation function (no side effects, unit-testable)
├── public/
│   └── index.html      — Entire Mini App: HTML + CSS + JS (all screens, no build step)
├── data/               — SQLite file lives here (.gitignored)
├── tests/
│   └── streak.test.js  — Unit tests using node:test (built-in, Node 18+)
├── .env                — Secrets (gitignored)
├── .env.example        — Template for env vars
├── .gitignore
└── package.json
```

---

## Chunk 1: Project Setup + Database + Streak Logic

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "habit-tracker",
  "version": "1.0.0",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test tests/streak.test.js"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "dotenv": "^16.4.1",
    "express": "^4.18.2",
    "node-cron": "^3.0.3",
    "node-telegram-bot-api": "^0.64.0"
  }
}
```

- [ ] **Step 2: Create .env.example**

```
BOT_TOKEN=your_bot_token_here
WEBAPP_URL=https://your-domain.com
PORT=3000
DATABASE_PATH=./data/habits.db
ENABLE_CRON=false
CRON_TIMEZONE=Europe/Moscow
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
.env
data/
.superpowers/
```

- [ ] **Step 4: Create .env by copying .env.example**

```bash
cp .env.example .env
```

Then fill in `BOT_TOKEN` with your actual bot token from [@BotFather](https://t.me/BotFather).

- [ ] **Step 5: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Commit**

```bash
git init
git add package.json .env.example .gitignore
git commit -m "chore: project scaffold"
```

---

### Task 2: Database schema and queries

**Files:**
- Create: `database.js`

- [ ] **Step 1: Create database.js**

```js
// database.js
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

let db

export function getDb() {
  return db
}

export function initDb(path) {
  mkdirSync(dirname(path), { recursive: true })
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  createSchema()
  return db
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT NOT NULL,
      created_at TEXT DEFAULT (date('now'))
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_group_id INTEGER UNIQUE NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT DEFAULT (date('now'))
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      joined_at TEXT DEFAULT (date('now')),
      UNIQUE(group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('quit','build')),
      emoji TEXT NOT NULL DEFAULT '✅',
      created_at TEXT DEFAULT (date('now')),
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS habit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_id INTEGER NOT NULL REFERENCES habits(id),
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      completed INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(habit_id, date)
    );
  `)
}

// ── Users ──────────────────────────────────────────────

export function upsertUser({ telegram_id, username, first_name }) {
  return db.prepare(`
    INSERT INTO users (telegram_id, username, first_name)
    VALUES (@telegram_id, @username, @first_name)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name
    RETURNING *
  `).get({ telegram_id, username: username || null, first_name })
}

export function getUserByTelegramId(telegram_id) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegram_id)
}

// ── Groups ─────────────────────────────────────────────

export function upsertGroup({ telegram_group_id, title }) {
  return db.prepare(`
    INSERT INTO groups (telegram_group_id, title)
    VALUES (@telegram_group_id, @title)
    ON CONFLICT(telegram_group_id) DO UPDATE SET title = excluded.title
    RETURNING *
  `).get({ telegram_group_id, title })
}

export function getGroupById(id) {
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(id)
}

export function getGroupsByUserId(user_id) {
  return db.prepare(`
    SELECT g.* FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ?
  `).all(user_id)
}

export function getAllGroups() {
  return db.prepare('SELECT * FROM groups').all()
}

// ── Group Members ──────────────────────────────────────

export function addGroupMember({ group_id, user_id }) {
  return db.prepare(`
    INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)
  `).run(group_id, user_id)
}

export function getGroupMembers(group_id) {
  return db.prepare(`
    SELECT u.* FROM users u
    JOIN group_members gm ON gm.user_id = u.id
    WHERE gm.group_id = ?
  `).all(group_id)
}

export function isGroupMember({ group_id, user_id }) {
  return !!db.prepare(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(group_id, user_id)
}

// ── Habits ─────────────────────────────────────────────

export function createHabit({ user_id, title, type, emoji }) {
  return db.prepare(`
    INSERT INTO habits (user_id, title, type, emoji)
    VALUES (@user_id, @title, @type, @emoji)
    RETURNING *
  `).get({ user_id, title, type, emoji })
}

export function getHabitsByUserId(user_id) {
  return db.prepare(
    'SELECT * FROM habits WHERE user_id = ? AND is_active = 1 ORDER BY created_at'
  ).all(user_id)
}

export function getHabitById(id) {
  return db.prepare('SELECT * FROM habits WHERE id = ?').get(id)
}

export function updateHabit(id, { title, emoji }) {
  return db.prepare(`
    UPDATE habits SET title = @title, emoji = @emoji WHERE id = @id RETURNING *
  `).get({ id, title, emoji })
}

export function archiveHabit(id) {
  return db.prepare('UPDATE habits SET is_active = 0 WHERE id = ?').run(id)
}

// ── Habit Logs ─────────────────────────────────────────

export function upsertLog({ habit_id, user_id, date, completed }) {
  return db.prepare(`
    INSERT INTO habit_logs (habit_id, user_id, date, completed)
    VALUES (@habit_id, @user_id, @date, @completed)
    ON CONFLICT(habit_id, date) DO UPDATE SET
      completed = excluded.completed,
      created_at = datetime('now')
    RETURNING *
  `).get({ habit_id, user_id, date, completed: completed ? 1 : 0 })
}

export function getLogsByUserAndDate(user_id, date) {
  return db.prepare(`
    SELECT hl.*, h.title, h.emoji, h.type FROM habit_logs hl
    JOIN habits h ON h.id = hl.habit_id
    WHERE hl.user_id = ? AND hl.date = ?
  `).all(user_id, date)
}

export function getLogsByHabitAndMonth(habit_id, month) {
  // month = 'YYYY-MM'
  return db.prepare(`
    SELECT * FROM habit_logs
    WHERE habit_id = ? AND date LIKE ?
    ORDER BY date DESC
  `).all(habit_id, `${month}%`)
}

export function getLogsForStreakCalc(habit_id) {
  // Last 366 days for streak calculation
  return db.prepare(`
    SELECT date, completed FROM habit_logs
    WHERE habit_id = ?
    ORDER BY date DESC
    LIMIT 366
  `).all(habit_id)
}
```

- [ ] **Step 2: Verify schema creates without error**

```bash
node -e "
import('./database.js').then(({ initDb }) => {
  initDb('./data/test.db')
  console.log('Schema OK')
})
"
```

Expected output: `Schema OK`

- [ ] **Step 3: Delete test DB**

```bash
rm ./data/test.db
```

- [ ] **Step 4: Commit**

```bash
git add database.js
git commit -m "feat: database schema and query functions"
```

---

### Task 3: Streak calculation (TDD)

**Files:**
- Create: `streak.js`
- Create: `tests/streak.test.js`

- [ ] **Step 1: Create tests directory**

```bash
mkdir -p tests
```

- [ ] **Step 2: Write the failing tests**

Create `tests/streak.test.js`:

```js
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test
```

Expected: all tests fail with `Cannot find module '../streak.js'`

- [ ] **Step 3: Create streak.js**

```js
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
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
npm test
```

Expected: `8 passing`

- [ ] **Step 5: Commit**

```bash
git add streak.js tests/streak.test.js
git commit -m "feat: streak calculation with TDD"
```

---

## Chunk 2: Express API

### Task 4: Express server + auth middleware

**Files:**
- Create: `server.js`

- [ ] **Step 1: Create server.js**

**Note:** `bot.js` doesn't exist yet — do NOT import it here. It will be added in Chunk 3, Task 5, Step 2.

```js
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
```

- [ ] **Step 2: Create routes directory**

```bash
mkdir -p routes
```

- [ ] **Step 3: Create routes/habits.js**

```js
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
```

- [ ] **Step 4: Create routes/logs.js**

```js
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
```

- [ ] **Step 5: Create routes/group.js**

```js
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

  const today = new Date().toLocaleDateString('sv', {
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
```

- [ ] **Step 6: Test server starts**

```bash
node server.js
```

Expected: `Server running on http://localhost:3000`

Stop with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add server.js routes/
git commit -m "feat: Express API with auth middleware and all route handlers"
```

---

## Chunk 3: Bot + Cron

### Task 5: Telegram bot commands

**Files:**
- Create: `bot.js`

- [ ] **Step 1: Create bot.js**

```js
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
```

- [ ] **Step 2: Wire bot into server.js — add import at top and call after DB init**

In `server.js`, add the import at the top of the file (after the other imports):

```js
import { setupBot } from './bot.js'
```

Then after the `initDb(...)` line, add:

```js
// Start bot
setupBot()
```

- [ ] **Step 3: Test bot starts (need real BOT_TOKEN)**

```bash
node server.js
```

Expected: `Bot started` and `Server running on http://localhost:3000`

Stop with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add bot.js server.js
git commit -m "feat: telegram bot commands and cron notifications"
```

---

## Chunk 4: Mini App Frontend

### Task 6: Mini App HTML shell + Today screen

**Files:**
- Create: `public/index.html`

- [ ] **Step 1: Create public/index.html with shell, styles, Today screen**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Habit Tracker</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

  :root {
    --bg: #0F0F0F;
    --card: #1A1A1A;
    --border: #2D2D2D;
    --accent: #6C63FF;
    --success: #4CAF50;
    --fail: #FF5252;
    --text: #FFFFFF;
    --muted: #888888;
    --nav-h: 64px;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, 'Inter', system-ui, sans-serif;
    min-height: 100vh;
    overflow-x: hidden;
  }

  /* ── Screens ─────────────────────────────────────── */
  .screen { display: none; flex-direction: column; height: 100vh; }
  .screen.active { display: flex; }

  .scroll-content {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px 16px;
    -webkit-overflow-scrolling: touch;
  }

  /* ── Bottom Nav ──────────────────────────────────── */
  .bottom-nav {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    background: var(--bg);
    border-top: 1px solid #1a1a1a;
    padding-bottom: env(safe-area-inset-bottom, 8px);
    flex-shrink: 0;
  }

  .nav-btn {
    display: flex; flex-direction: column; align-items: center;
    gap: 3px; padding: 10px 4px; cursor: pointer;
    color: #444; font-size: 11px; border: none; background: none;
    border-radius: 12px; margin: 4px; transition: color 0.15s;
  }
  .nav-btn.active { color: var(--accent); background: rgba(108,99,255,0.1); }
  .nav-btn .icon { font-size: 22px; line-height: 1; }

  /* ── Header ─────────────────────────────────────── */
  .screen-header {
    padding: 16px 16px 10px;
    display: flex; align-items: center; justify-content: space-between;
    flex-shrink: 0;
  }

  /* ── Cards ───────────────────────────────────────── */
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 16px;
    margin-bottom: 10px;
    transition: border-color 0.2s, background 0.2s;
  }
  .card.done { background: #111e11; border-color: #1a3a1a; }
  .card.failed { background: #1e1111; border-color: #3a1a1a; }

  /* ── Buttons ─────────────────────────────────────── */
  .btn {
    border: none; border-radius: 12px; padding: 11px 16px;
    font-size: 14px; font-weight: 600; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  .btn-primary { background: var(--accent); color: white; }
  .btn-success { background: var(--success); color: white; width: 100%; }
  .btn-fail-state { background: var(--fail); color: white; width: 100%; }
  .btn-ghost {
    background: var(--card); border: 1px solid var(--border);
    color: var(--muted); width: 100%;
  }
  .btn-dashed {
    background: transparent; border: 1.5px dashed var(--border);
    color: #555; width: 100%; padding: 14px;
    font-size: 14px; cursor: pointer; border-radius: 16px;
    margin-top: 4px;
  }

  /* ── Habit card ──────────────────────────────────── */
  .habit-top {
    display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
  }
  .habit-emoji { font-size: 22px; line-height: 1; }
  .habit-info { flex: 1; }
  .habit-title { font-size: 15px; font-weight: 600; }
  .habit-streak { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .type-badge {
    font-size: 10px; padding: 3px 8px; border-radius: 10px; font-weight: 500;
  }
  .type-quit { background: #2a1a1a; color: #ff6b35; }
  .type-build { background: #1a2a1a; color: var(--success); }

  .habit-actions { display: grid; grid-template-columns: 1fr 72px; gap: 8px; }

  /* ── Progress bar ─────────────────────────────────── */
  .progress-wrap { margin: 4px 0 16px; }
  .progress-row {
    display: flex; justify-content: space-between;
    font-size: 11px; color: var(--muted); margin-bottom: 5px;
  }
  .progress-track {
    height: 3px; background: var(--border); border-radius: 2px; overflow: hidden;
  }
  .progress-fill {
    height: 100%; border-radius: 2px;
    background: linear-gradient(90deg, var(--accent), #a855f7);
    transition: width 0.4s ease;
  }

  /* ── Section label ───────────────────────────────── */
  .sec-label {
    font-size: 11px; font-weight: 600; letter-spacing: 1.2px;
    color: #444; text-transform: uppercase; margin: 8px 2px 12px;
  }

  /* ── Avatar letter ───────────────────────────────── */
  .avatar {
    width: 40px; height: 40px; border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), #a855f7);
    display: flex; align-items: center; justify-content: center;
    font-size: 16px; font-weight: 700; color: white; flex-shrink: 0;
  }

  /* ── Loading / Toast ─────────────────────────────── */
  #loading {
    position: fixed; inset: 0; background: var(--bg);
    display: flex; align-items: center; justify-content: center;
    font-size: 24px; z-index: 100;
  }
  #toast {
    position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
    background: #333; color: white; padding: 10px 20px; border-radius: 20px;
    font-size: 13px; opacity: 0; transition: opacity 0.3s;
    pointer-events: none; z-index: 200; white-space: nowrap;
  }
  #toast.show { opacity: 1; }

  /* ── Bottom sheet ────────────────────────────────── */
  .sheet-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    z-index: 50; display: none; align-items: flex-end;
  }
  .sheet-overlay.open { display: flex; }
  .sheet {
    width: 100%; background: var(--card);
    border-radius: 20px 20px 0 0; padding: 0 16px 32px;
    border-top: 1px solid var(--border);
    max-height: 90vh; overflow-y: auto;
  }
  .sheet-handle {
    width: 36px; height: 4px; background: var(--border);
    border-radius: 2px; margin: 12px auto 16px;
  }
  .sheet-title { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  .sheet-sub { font-size: 13px; color: var(--muted); margin-bottom: 20px; }

  /* ── Form elements ───────────────────────────────── */
  input[type="text"] {
    width: 100%; background: var(--bg); border: 1px solid var(--border);
    border-radius: 12px; padding: 12px 14px; color: white; font-size: 15px;
    outline: none; margin-bottom: 16px;
  }
  input[type="text"]:focus { border-color: var(--accent); }

  .radio-group { display: flex; gap: 10px; margin-bottom: 16px; }
  .radio-opt {
    flex: 1; padding: 12px; border-radius: 12px;
    border: 1.5px solid var(--border); background: var(--bg);
    cursor: pointer; text-align: center; font-size: 14px; color: var(--muted);
    transition: all 0.15s;
  }
  .radio-opt.selected { border-color: var(--accent); color: white; background: rgba(108,99,255,0.1); }
  .radio-opt .opt-icon { font-size: 20px; display: block; margin-bottom: 4px; }

  .emoji-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 20px; }
  .emoji-opt {
    aspect-ratio: 1; border-radius: 12px; border: 1.5px solid var(--border);
    background: var(--bg); display: flex; align-items: center; justify-content: center;
    font-size: 22px; cursor: pointer; transition: all 0.15s;
  }
  .emoji-opt.selected { border-color: var(--accent); background: rgba(108,99,255,0.15); }

  /* ── Calendar ────────────────────────────────────── */
  .cal-nav-row {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 14px;
  }
  .cal-month-name { font-size: 15px; font-weight: 700; }
  .cal-arrows { display: flex; gap: 20px; }
  .cal-arrow { color: var(--accent); font-size: 22px; cursor: pointer; line-height: 1; }

  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; margin-bottom: 14px; }
  .cal-dn { text-align: center; font-size: 11px; color: #444; padding: 2px 0 7px; }
  .cal-day {
    aspect-ratio: 1; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 500; cursor: pointer; position: relative;
  }
  .cal-day.x { visibility: hidden; cursor: default; }
  .cal-day.future { background: #141414; color: #2a2a2a; cursor: default; }
  .cal-day.ok { background: #1a3a1a; color: var(--success); font-weight: 600; }
  .cal-day.partial { background: #2a2000; color: #FFC107; font-weight: 600; }
  .cal-day.fail { background: #3a1010; color: var(--fail); font-weight: 600; }
  .cal-day.miss { background: #1a1a1a; color: #444; border: 1px dashed #333; }
  .cal-day.today-ring { box-shadow: 0 0 0 2px var(--accent); }

  .legend { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #666; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; }

  .hbar { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; margin-bottom: 8px; }
  .hbar-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .hbar-name { font-size: 14px; }
  .hbar-streak { color: var(--success); font-size: 13px; font-weight: 600; }
  .bar-track { height: 5px; background: var(--border); border-radius: 3px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--success), var(--accent)); }
  .bar-sub { color: #555; font-size: 11px; margin-top: 5px; }

  /* ── Retroactive sheet toggles ───────────────────── */
  .retro-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 0; border-bottom: 1px solid #222;
  }
  .retro-row:last-of-type { border-bottom: none; }
  .retro-name { font-size: 14px; display: flex; align-items: center; gap: 8px; }
  .toggle-group { display: flex; gap: 6px; }
  .tog {
    width: 36px; height: 36px; border-radius: 10px;
    border: 1px solid var(--border); display: flex; align-items: center;
    justify-content: center; font-size: 15px; cursor: pointer; background: var(--bg);
    transition: all 0.15s;
  }
  .tog.yes { background: #1a3a1a; border-color: var(--success); }
  .tog.no  { background: #3a1010; border-color: var(--fail); }

  /* ── Friends ─────────────────────────────────────── */
  .friend-card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 16px; margin-bottom: 10px; }
  .friend-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .friend-name { font-size: 15px; font-weight: 600; }
  .friend-status { font-size: 12px; color: var(--success); margin-top: 2px; }
  .friend-status.no { color: #555; }
  .friend-habits { display: flex; flex-direction: column; gap: 7px; }
  .friend-habit { display: flex; justify-content: space-between; align-items: center; }
  .friend-habit-name { color: #999; font-size: 13px; }
  .friend-habit-streak { color: white; font-size: 13px; font-weight: 600; }

  .group-switcher {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 20px; padding: 6px 12px; font-size: 12px;
    color: var(--accent); cursor: pointer; display: flex; align-items: center; gap: 4px;
  }
</style>
</head>
<body>

<div id="loading">⏳</div>
<div id="toast"></div>

<!-- ══════════════ TODAY SCREEN ══════════════ -->
<div id="screen-today" class="screen">
  <div class="screen-header">
    <div style="display:flex;align-items:center;gap:12px">
      <div class="avatar" id="user-avatar">?</div>
      <div>
        <div id="user-greeting" style="font-size:16px;font-weight:600">Загрузка...</div>
        <div id="today-date" style="font-size:12px;color:#666"></div>
      </div>
    </div>
    <div id="progress-badge" style="background:var(--card);border:1px solid var(--border);border-radius:20px;padding:6px 12px;font-size:12px;color:var(--muted)">0/0</div>
  </div>

  <div class="scroll-content">
    <div class="progress-wrap">
      <div class="progress-row">
        <span>Прогресс сегодня</span>
        <span id="progress-pct">0%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" id="progress-fill" style="width:0%"></div>
      </div>
    </div>

    <div class="sec-label">Мои привычки</div>
    <div id="habits-list"></div>
    <button class="btn-dashed" onclick="openAddHabit()">+ Добавить привычку</button>
  </div>

  <nav class="bottom-nav">
    <button class="nav-btn active" onclick="showScreen('today')" data-screen="today">
      <span class="icon">📅</span><span>Сегодня</span>
    </button>
    <button class="nav-btn" onclick="showScreen('calendar')" data-screen="calendar">
      <span class="icon">📆</span><span>Календарь</span>
    </button>
    <button class="nav-btn" onclick="showScreen('friends')" data-screen="friends">
      <span class="icon">👥</span><span>Друзья</span>
    </button>
  </nav>
</div>

<!-- ══════════════ CALENDAR SCREEN ══════════════ -->
<div id="screen-calendar" class="screen">
  <div class="screen-header">
    <div style="font-size:18px;font-weight:700">Мой календарь</div>
    <div id="cal-streak-badge" style="font-size:12px;color:var(--success)"></div>
  </div>

  <div class="scroll-content">
    <div class="cal-nav-row">
      <div class="cal-month-name" id="cal-month-label"></div>
      <div class="cal-arrows">
        <div class="cal-arrow" onclick="calChangeMonth(-1)">‹</div>
        <div class="cal-arrow" onclick="calChangeMonth(1)">›</div>
      </div>
    </div>
    <div class="cal-grid" id="cal-grid"></div>

    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:var(--success)"></div>Все выполнил</div>
      <div class="legend-item"><div class="legend-dot" style="background:#FFC107"></div>Частично</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--fail)"></div>Провалил</div>
      <div class="legend-item"><div class="legend-dot" style="background:#1a1a1a;border:1px dashed #444"></div>Нажми — заполни</div>
    </div>

    <div class="sec-label">Прогресс в месяце</div>
    <div id="cal-habit-bars"></div>
  </div>

  <nav class="bottom-nav">
    <button class="nav-btn" onclick="showScreen('today')" data-screen="today">
      <span class="icon">📅</span><span>Сегодня</span>
    </button>
    <button class="nav-btn active" onclick="showScreen('calendar')" data-screen="calendar">
      <span class="icon">📆</span><span>Календарь</span>
    </button>
    <button class="nav-btn" onclick="showScreen('friends')" data-screen="friends">
      <span class="icon">👥</span><span>Друзья</span>
    </button>
  </nav>
</div>

<!-- ══════════════ FRIENDS SCREEN ══════════════ -->
<div id="screen-friends" class="screen">
  <div class="screen-header">
    <div style="font-size:18px;font-weight:700">Друзья</div>
    <div class="group-switcher" id="group-switcher" onclick="openGroupSwitcher()">
      <span id="current-group-name">Загрузка...</span> ▾
    </div>
  </div>

  <div class="scroll-content">
    <div class="sec-label" id="friends-sec-label"></div>
    <div id="friends-list"></div>
  </div>

  <nav class="bottom-nav">
    <button class="nav-btn" onclick="showScreen('today')" data-screen="today">
      <span class="icon">📅</span><span>Сегодня</span>
    </button>
    <button class="nav-btn" onclick="showScreen('calendar')" data-screen="calendar">
      <span class="icon">📆</span><span>Календарь</span>
    </button>
    <button class="nav-btn active" onclick="showScreen('friends')" data-screen="friends">
      <span class="icon">👥</span><span>Друзья</span>
    </button>
  </nav>
</div>

<!-- ══════════════ ADD/EDIT HABIT SHEET ══════════════ -->
<div class="sheet-overlay" id="add-habit-sheet">
  <div class="sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-title" id="habit-sheet-title">Новая привычка</div>
    <div class="sheet-sub">Как называется?</div>

    <input type="text" id="habit-name-input" placeholder="Не курить / Читать книгу..." maxlength="60">

    <div class="sec-label">Тип привычки</div>
    <div class="radio-group">
      <div class="radio-opt" id="type-quit" onclick="selectType('quit')">
        <span class="opt-icon">🚫</span>
        Хочу бросить
      </div>
      <div class="radio-opt" id="type-build" onclick="selectType('build')">
        <span class="opt-icon">🌱</span>
        Хочу привить
      </div>
    </div>

    <div class="sec-label">Эмодзи</div>
    <div class="emoji-grid" id="emoji-grid"></div>

    <button class="btn btn-primary" style="width:100%" onclick="saveHabit()">
      <span id="save-habit-btn-text">Создать привычку</span>
    </button>
  </div>
</div>

<!-- ══════════════ RETROACTIVE LOG SHEET ══════════════ -->
<div class="sheet-overlay" id="retro-sheet">
  <div class="sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-title" id="retro-date-title"></div>
    <div class="sheet-sub">Заполни пропущенный день</div>
    <div id="retro-habits-list"></div>
    <button class="btn btn-primary" style="width:100%;margin-top:16px" onclick="saveRetroLog()">Сохранить</button>
  </div>
</div>

<!-- ══════════════ GROUP SWITCHER SHEET ══════════════ -->
<div class="sheet-overlay" id="group-switcher-sheet">
  <div class="sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-title">Выбери группу</div>
    <div id="group-list" style="margin-top:16px"></div>
  </div>
</div>

<script>
// ════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════
const tg = window.Telegram?.WebApp
const EMOJIS = ['🚬','🍬','🍺','🏋️','📚','🧘','💊','😴','🥗','💻']

let state = {
  user: null,
  groups: [],
  currentGroupId: null,
  habits: [],          // with .streak
  todayLogs: {},       // habitId → {completed}
  today: '',           // YYYY-MM-DD
  calMonth: '',        // YYYY-MM
  calData: [],         // [{habit, logs:[]}]
  editingHabitId: null,
  selectedType: null,
  selectedEmoji: null,
  retroDate: null,
  retroSelections: {}, // habitId → true|false|null
}

// ════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════
async function init() {
  tg?.ready()
  tg?.expand()

  state.today = new Date().toLocaleDateString('sv')
  state.calMonth = state.today.slice(0, 7)

  buildEmojiGrid()

  try {
    const authRes = await api('POST', '/api/auth', {})
    state.user = authRes.user
    state.groups = authRes.groups || []
    if (state.groups.length > 0) state.currentGroupId = state.groups[0].id

    await loadTodayData()
    renderToday()
    updateGroupSwitcher()
    showScreen('today')
  } catch (e) {
    showToast('Ошибка загрузки: ' + e.message)
    // Still show the app if auth fails in dev without initData
    showScreen('today')
  }

  document.getElementById('loading').style.display = 'none'
}

// ════════════════════════════════════════════════════════
//  API
// ════════════════════════════════════════════════════════
async function api(method, path, body) {
  const initData = tg?.initData || 'user=%7B%22id%22%3A12345%2C%22first_name%22%3A%22Dev%22%7D'
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'tma ' + initData,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  return res.json()
}

// ════════════════════════════════════════════════════════
//  TODAY
// ════════════════════════════════════════════════════════
async function loadTodayData() {
  if (!state.user) return
  state.habits = await api('GET', `/api/habits/${state.user.id}`)
  const logs = await api('GET', `/api/logs/${state.user.id}/${state.today}`)
  state.todayLogs = {}
  for (const log of logs) state.todayLogs[log.habit_id] = log
}

function renderToday() {
  const u = state.user
  const dateStr = new Date().toLocaleDateString('ru', { weekday:'long', day:'numeric', month:'long' })

  document.getElementById('user-avatar').textContent = u ? u.first_name[0].toUpperCase() : '?'
  document.getElementById('user-greeting').textContent = `Привет, ${u?.first_name || 'друг'} 👋`
  document.getElementById('today-date').textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1)

  const habits = state.habits
  const done = habits.filter(h => state.todayLogs[h.id]?.completed).length
  const total = habits.length
  const pct = total ? Math.round(done / total * 100) : 0

  document.getElementById('progress-badge').textContent = `${done}/${total} ✓`
  document.getElementById('progress-pct').textContent = pct + '%'
  document.getElementById('progress-fill').style.width = pct + '%'

  const list = document.getElementById('habits-list')
  list.innerHTML = ''

  for (const habit of habits) {
    const log = state.todayLogs[habit.id]
    const isCompleted = log?.completed === 1
    const isFailed = log?.completed === 0

    const card = document.createElement('div')
    card.className = 'card' + (isCompleted ? ' done' : isFailed ? ' failed' : '')

    // Long-press to edit habit
    let pressTimer
    card.addEventListener('pointerdown', () => {
      pressTimer = setTimeout(() => {
        tg?.HapticFeedback?.impactOccurred('heavy')
        openAddHabit(habit)
      }, 500)
    })
    card.addEventListener('pointerup', () => clearTimeout(pressTimer))
    card.addEventListener('pointerleave', () => clearTimeout(pressTimer))

    card.innerHTML = `
      <div class="habit-top">
        <div class="habit-emoji">${habit.emoji}</div>
        <div class="habit-info">
          <div class="habit-title">${habit.title}</div>
          <div class="habit-streak">${habit.streak > 0 ? `🔥 ${habit.streak} дней подряд` : 'Начни сегодня!'}</div>
        </div>
        <span class="type-badge ${habit.type === 'quit' ? 'type-quit' : 'type-build'}">
          ${habit.type === 'quit' ? 'бросаю' : 'привожу'}
        </span>
      </div>
    `

    if (isCompleted) {
      card.innerHTML += `<button class="btn btn-success" onclick="markHabit(${habit.id}, false)">✓ Выполнено</button>`
    } else if (isFailed) {
      card.innerHTML += `<button class="btn btn-fail-state" onclick="markHabit(${habit.id}, true)">✗ Провалено — исправить?</button>`
    } else {
      const label = habit.type === 'quit' ? 'Держусь' : 'Сделал'
      card.innerHTML += `
        <div class="habit-actions">
          <button class="btn btn-primary" onclick="markHabit(${habit.id}, true)">✓ ${label}</button>
          <button class="btn btn-ghost" onclick="markHabit(${habit.id}, false)">✗</button>
        </div>`
    }

    list.appendChild(card)
  }
}

async function markHabit(habitId, completed) {
  tg?.HapticFeedback?.impactOccurred('medium')
  await api('POST', '/api/logs', { habitId, date: state.today, completed })
  await loadTodayData()
  renderToday()
}

// ════════════════════════════════════════════════════════
//  ADD / EDIT HABIT
// ════════════════════════════════════════════════════════
function buildEmojiGrid() {
  const grid = document.getElementById('emoji-grid')
  grid.innerHTML = ''
  for (const e of EMOJIS) {
    const el = document.createElement('div')
    el.className = 'emoji-opt'
    el.textContent = e
    el.onclick = () => selectEmoji(e)
    grid.appendChild(el)
  }
}

function openAddHabit(habit = null) {
  state.editingHabitId = habit?.id || null
  state.selectedType = habit?.type || null
  state.selectedEmoji = habit?.emoji || null

  document.getElementById('habit-sheet-title').textContent = habit ? 'Редактировать привычку' : 'Новая привычка'
  document.getElementById('save-habit-btn-text').textContent = habit ? 'Сохранить' : 'Создать привычку'
  document.getElementById('habit-name-input').value = habit?.title || ''

  document.querySelectorAll('.radio-opt').forEach(el => el.classList.remove('selected'))
  document.querySelectorAll('.emoji-opt').forEach(el => el.classList.remove('selected'))

  if (habit?.type) document.getElementById('type-' + habit.type)?.classList.add('selected')
  if (habit?.emoji) {
    document.querySelectorAll('.emoji-opt').forEach(el => {
      if (el.textContent === habit.emoji) el.classList.add('selected')
    })
  }

  document.getElementById('add-habit-sheet').classList.add('open')
}

function selectType(type) {
  state.selectedType = type
  document.querySelectorAll('.radio-opt').forEach(el => el.classList.remove('selected'))
  document.getElementById('type-' + type)?.classList.add('selected')
}

function selectEmoji(emoji) {
  state.selectedEmoji = emoji
  document.querySelectorAll('.emoji-opt').forEach(el => {
    el.classList.toggle('selected', el.textContent === emoji)
  })
}

async function saveHabit() {
  const title = document.getElementById('habit-name-input').value.trim()
  if (!title) return showToast('Введи название привычки')
  if (!state.selectedType) return showToast('Выбери тип привычки')
  if (!state.selectedEmoji) return showToast('Выбери эмодзи')

  try {
    if (state.editingHabitId) {
      await api('PUT', `/api/habits/${state.editingHabitId}`, {
        title, emoji: state.selectedEmoji
      })
    } else {
      await api('POST', '/api/habits', {
        title, type: state.selectedType, emoji: state.selectedEmoji
      })
    }
    document.getElementById('add-habit-sheet').classList.remove('open')
    await loadTodayData()
    renderToday()
  } catch (e) {
    showToast('Ошибка: ' + e.message)
  }
}

// ════════════════════════════════════════════════════════
//  CALENDAR
// ════════════════════════════════════════════════════════
async function loadCalendar() {
  if (!state.user) return
  state.calData = await api('GET', `/api/logs/${state.user.id}/calendar/${state.calMonth}`)
  renderCalendar()
}

function calChangeMonth(delta) {
  const [y, m] = state.calMonth.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  state.calMonth = d.toLocaleDateString('sv').slice(0, 7)
  loadCalendar()
}

function renderCalendar() {
  const [y, m] = state.calMonth.split('-').map(Number)
  const monthName = new Date(y, m - 1).toLocaleDateString('ru', { month: 'long', year: 'numeric' })
  document.getElementById('cal-month-label').textContent =
    monthName.charAt(0).toUpperCase() + monthName.slice(1)

  // Build logMap: date → {total, done, failed}
  const logMap = {}
  for (const { habit, logs } of state.calData) {
    for (const log of logs) {
      if (!logMap[log.date]) logMap[log.date] = { total: 0, done: 0, failed: 0 }
      logMap[log.date].total++
      if (log.completed) logMap[log.date].done++
      else logMap[log.date].failed++
    }
  }
  const habitCount = state.calData.length

  const grid = document.getElementById('cal-grid')
  grid.innerHTML = ''
  const days = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']
  for (const d of days) {
    const el = document.createElement('div')
    el.className = 'cal-dn'
    el.textContent = d
    grid.appendChild(el)
  }

  // Day 1 weekday (Mon=1..Sun=7)
  const firstDay = new Date(y, m - 1, 1).getDay() || 7
  for (let i = 1; i < firstDay; i++) {
    const el = document.createElement('div')
    el.className = 'cal-day x'
    grid.appendChild(el)
  }

  const daysInMonth = new Date(y, m, 0).getDate()
  const todayStr = state.today

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    const el = document.createElement('div')
    const isToday = dateStr === todayStr
    const isFuture = dateStr > todayStr
    const entry = logMap[dateStr]

    let cls = 'cal-day'
    if (isFuture) {
      cls += ' future'
    } else if (!entry) {
      cls += ' miss'
      el.onclick = () => openRetroSheet(dateStr)
    } else if (entry.failed > 0) {
      cls += ' fail'
      el.onclick = () => openRetroSheet(dateStr)
    } else if (entry.done === habitCount && habitCount > 0) {
      cls += ' ok'
      el.onclick = () => openRetroSheet(dateStr)
    } else {
      cls += ' partial'
      el.onclick = () => openRetroSheet(dateStr)
    }
    if (isToday) cls += ' today-ring'

    el.className = cls
    el.textContent = day
    grid.appendChild(el)
  }

  // Habit bars
  const barsEl = document.getElementById('cal-habit-bars')
  barsEl.innerHTML = ''
  for (const { habit, logs } of state.calData) {
    const doneDays = logs.filter(l => l.completed).length
    const totalDays = new Date(y, m, 0).getDate()
    const pct = Math.round(doneDays / totalDays * 100)
    const streak = state.habits.find(h => h.id === habit.id)?.streak || 0

    barsEl.innerHTML += `
      <div class="hbar">
        <div class="hbar-top">
          <div class="hbar-name">${habit.emoji} ${habit.title}</div>
          <div class="hbar-streak">${streak > 0 ? '🔥 ' + streak + ' дней' : '—'}</div>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-sub">${doneDays} из ${totalDays} дней ✓</div>
      </div>`
  }
}

// ════════════════════════════════════════════════════════
//  RETROACTIVE LOG
// ════════════════════════════════════════════════════════
function openRetroSheet(dateStr) {
  state.retroDate = dateStr
  state.retroSelections = {}

  const d = new Date(dateStr + 'T00:00:00')
  const label = d.toLocaleDateString('ru', { weekday:'long', day:'numeric', month:'long' })
  document.getElementById('retro-date-title').textContent =
    'Что было ' + label.charAt(0).toUpperCase() + label.slice(1) + '?'

  const list = document.getElementById('retro-habits-list')
  list.innerHTML = ''
  for (const habit of state.habits) {
    const row = document.createElement('div')
    row.className = 'retro-row'
    row.innerHTML = `
      <div class="retro-name"><span>${habit.emoji}</span> ${habit.title}</div>
      <div class="toggle-group">
        <div class="tog" id="retro-yes-${habit.id}" onclick="setRetro(${habit.id}, true)">✓</div>
        <div class="tog" id="retro-no-${habit.id}" onclick="setRetro(${habit.id}, false)">✗</div>
      </div>`
    list.appendChild(row)
  }

  document.getElementById('retro-sheet').classList.add('open')
}

function setRetro(habitId, val) {
  state.retroSelections[habitId] = val
  document.getElementById(`retro-yes-${habitId}`).className = 'tog' + (val === true ? ' yes' : '')
  document.getElementById(`retro-no-${habitId}`).className = 'tog' + (val === false ? ' no' : '')
}

async function saveRetroLog() {
  const entries = Object.entries(state.retroSelections)
  if (entries.length === 0) {
    document.getElementById('retro-sheet').classList.remove('open')
    return
  }
  try {
    for (const [habitId, completed] of entries) {
      await api('POST', '/api/logs', {
        habitId: parseInt(habitId), date: state.retroDate, completed
      })
    }
    document.getElementById('retro-sheet').classList.remove('open')
    await loadCalendar()
    showToast('Сохранено ✓')
  } catch (e) {
    showToast('Ошибка: ' + e.message)
  }
}

// ════════════════════════════════════════════════════════
//  FRIENDS
// ════════════════════════════════════════════════════════
async function loadFriends() {
  if (!state.currentGroupId) {
    document.getElementById('friends-list').innerHTML =
      '<div style="color:var(--muted);text-align:center;padding:40px">Ты не в группе.<br>Попроси кого-то запустить /setup в групповом чате.</div>'
    return
  }
  try {
    const members = await api('GET', `/api/group/${state.currentGroupId}/members`)
    renderFriends(members)
  } catch (e) {
    showToast('Ошибка загрузки друзей')
  }
}

function renderFriends(members) {
  const grp = state.groups.find(g => g.id === state.currentGroupId)
  document.getElementById('friends-sec-label').textContent =
    `${members.length} участников · ${grp?.title || ''}`

  const list = document.getElementById('friends-list')
  list.innerHTML = ''

  for (const member of members) {
    const isSelf = member.id === state.user?.id
    const colors = ['#FF6B6B,#FF8E53','#6C63FF,#a855f7','#11998e,#38ef7d','#f093fb,#f5576c','#4facfe,#00f2fe']
    const colorIdx = member.id % colors.length
    const el = document.createElement('div')
    el.className = 'friend-card'
    el.innerHTML = `
      <div class="friend-header">
        <div class="avatar" style="background:linear-gradient(135deg,${colors[colorIdx]})">
          ${member.first_name[0].toUpperCase()}
        </div>
        <div>
          <div class="friend-name">${member.first_name}${isSelf ? ' (ты)' : ''}</div>
          <div class="friend-status ${member.markedToday ? '' : 'no'}">
            ${member.markedToday ? '✓ Отметил сегодня' : '— Не отметил'}
          </div>
        </div>
      </div>
      <div class="friend-habits">
        ${member.habits.map(h => `
          <div class="friend-habit">
            <span class="friend-habit-name">${h.emoji} ${h.title}</span>
            <span class="friend-habit-streak">${h.streak > 0 ? '🔥 ' + h.streak + ' дн.' : '—'}</span>
          </div>`).join('')}
      </div>`
    list.appendChild(el)
  }
}

// ════════════════════════════════════════════════════════
//  GROUP SWITCHER
// ════════════════════════════════════════════════════════
function updateGroupSwitcher() {
  const grp = state.groups.find(g => g.id === state.currentGroupId)
  document.getElementById('current-group-name').textContent = grp?.title || 'Нет группы'
}

function openGroupSwitcher() {
  const list = document.getElementById('group-list')
  list.innerHTML = ''
  for (const g of state.groups) {
    const btn = document.createElement('button')
    btn.style.cssText = 'width:100%;padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:12px;color:white;font-size:15px;cursor:pointer;margin-bottom:8px;text-align:left'
    btn.textContent = g.title
    if (g.id === state.currentGroupId) btn.style.borderColor = 'var(--accent)'
    btn.onclick = () => {
      state.currentGroupId = g.id
      updateGroupSwitcher()
      document.getElementById('group-switcher-sheet').classList.remove('open')
      loadFriends()
    }
    list.appendChild(btn)
  }
  document.getElementById('group-switcher-sheet').classList.add('open')
}

// ════════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════════
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === name)
  })
  document.getElementById('screen-' + name).classList.add('active')

  // Close any open sheets
  document.querySelectorAll('.sheet-overlay').forEach(s => s.classList.remove('open'))

  if (name === 'calendar') loadCalendar()
  if (name === 'friends') loadFriends()
}

// Close sheets on overlay click
document.querySelectorAll('.sheet-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open')
  })
})

// ════════════════════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════════════════════
function showToast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.classList.add('show')
  setTimeout(() => el.classList.remove('show'), 2500)
}

// ════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════
init()
</script>
</body>
</html>
```

- [ ] **Step 2: Start the server and open http://localhost:3000**

```bash
node server.js
```

Open in browser. The loading spinner should disappear and the Today screen should appear (empty habits list — that's expected, no habits created yet).

- [ ] **Step 3: Test adding a habit via the UI**

1. Click "Добавить привычку"
2. Enter a name, select type and emoji
3. Click "Создать привычку"
4. Habit should appear on Today screen

- [ ] **Step 4: Test marking a habit**

Click ✓ on a habit. Card should turn green.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: complete Mini App frontend (all screens)"
```

---

### Task 7: README and final smoke test

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

```markdown
# Habit Tracker

Telegram Mini App + Bot for tracking habits with friends.

## Setup

1. Clone repo and install:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in:
   - `BOT_TOKEN` — get from @BotFather
   - `WEBAPP_URL` — for local dev, use [ngrok](https://ngrok.com): `ngrok http 3000`, paste the https URL

3. Start:
   ```bash
   node server.js
   ```

## Group Setup Flow

1. Add your bot to a Telegram group
2. Send `/setup` in the group
3. Each member opens the bot in DM and sends `/join <group_id>` (bot posts the exact command)
4. Members click "Открыть трекер" to open the Mini App

## Local Dev

- The app works at `http://localhost:3000` in browser (uses a dev user when Telegram context unavailable)
- `ENABLE_CRON=false` by default — cron jobs won't run locally
- SQLite database is created at `./data/habits.db` automatically

## Deploy (cheap VPS)

1. Get a Hetzner CX11 (~€4/month) or similar
2. Install Node 18+, clone repo, `npm install`
3. Set real `WEBAPP_URL` in `.env`
4. Run with [PM2](https://pm2.keymetrics.io/): `pm2 start server.js`
5. Set `ENABLE_CRON=true` in `.env`
6. Configure reverse proxy (nginx) for HTTPS (required by Telegram for WebApps)
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: 8 streak tests passing.

- [ ] **Step 3: Final smoke test**

```bash
node server.js
```

Check:
- `http://localhost:3000` loads the Mini App
- `POST http://localhost:3000/api/auth` with header `Authorization: tma user=%7B%22id%22%3A1%2C%22first_name%22%3A%22Test%22%7D` returns `{user, groups}`

```bash
curl -s -X POST http://localhost:3000/api/auth \
  -H "Authorization: tma user=%7B%22id%22%3A1%2C%22first_name%22%3A%22Test%22%7D" \
  -H "Content-Type: application/json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)))"
```

Expected: JSON with `user` object and empty `groups` array.

- [ ] **Step 4: Final commit**

```bash
git add README.md
git commit -m "docs: add README with setup instructions"
```
