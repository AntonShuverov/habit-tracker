# Habit Tracker — Design Spec
Date: 2026-03-19

## Overview

Telegram Mini App + Bot for tracking habits in a closed group of friends/family. Private app, not public. Stack: Node.js + Express + SQLite + Vanilla JS.

## Constraints

- Private app: ~5–20 users, friends and family only
- Local dev first, then cheap VPS (Hetzner/DO)
- Auth simplified: no HMAC initData validation (add later if going public)
- Multiple groups supported (friends, family)

## File Structure

```
habit-tracker/
├── server.js       — Express API + static file serving
├── database.js     — SQLite schema + all query functions
├── bot.js          — Telegram bot commands + cron jobs
├── public/
│   └── index.html  — Mini App (all frontend in one file)
├── .env
└── package.json
```

## Database Schema

```sql
users (id, telegram_id INTEGER UNIQUE, username, first_name, created_at)

groups (id, telegram_group_id INTEGER UNIQUE, title, created_at)

group_members (id, group_id, user_id, joined_at,
               UNIQUE(group_id, user_id))
-- no soft-delete needed at MVP; if bot is removed from group, group just becomes inactive

habits (id, user_id, title, type TEXT CHECK(type IN ('quit','build')),
        emoji, created_at, is_active BOOLEAN DEFAULT 1)
-- habits are personal (not scoped to a group)
-- a user's habits are visible in all groups they belong to — intentional
-- type cannot be changed after creation

habit_logs (id, habit_id, user_id, date TEXT, completed BOOLEAN, created_at,
            UNIQUE(habit_id, date))
-- date stored as YYYY-MM-DD
-- upsert on conflict(habit_id, date) → update completed, created_at
-- user_id is denormalized here for faster group queries (accepted redundancy)
-- quit: completed=true means "didn't do the bad thing" = good
-- build: completed=true means "did the good thing" = good
```

## Auth

- Frontend reads `Telegram.WebApp.initDataUnsafe.user` for user info
- All API requests send raw `initData` string in `Authorization: tma <initData>` header
- Backend parses initData: URL-decode the string, extract the `user` field, JSON-parse it → get `user.id`. **No HMAC signature check** (private app).
- **userId in request bodies is ignored** — always use the id from parsed initData
- URL params like `:userId` in GET requests are validated: requester can only access their own data (or group data they belong to)
- `PUT /api/habits/:id` ownership check: requester's userId (from initData) must match the habit's `user_id`
- On first request, user is auto-created in DB if not exists

## Group Setup Flow

1. Admin adds bot to Telegram group
2. Admin sends `/setup` in the group → bot upserts group record in DB (idempotent)
3. Bot posts in the group: "✅ Настроено! Каждый участник: напишите мне /join **{db_id}** в личку" (db_id = the integer DB primary key of the group record, posted by the bot after insert)
4. Each participant opens bot DM and sends `/join {db_id}` → bot links them to that group

## API Endpoints

```
POST /api/auth                      — parse initData, upsert user, return user + their groups
GET  /api/habits/:userId            — list active habits (auth: requester must == userId)
POST /api/habits                    — create habit {title, type, emoji} — userId from auth
PUT  /api/habits/:id                — update {title, emoji} or archive {is_active:0}
                                      type cannot be changed
GET  /api/logs/:userId/:date        — get logs for YYYY-MM-DD (auth: requester must == userId)
POST /api/logs                      — upsert {habitId, date, completed} — userId from auth
GET  /api/group/:groupId/members    — members + their habits + today's logs + streaks
                                      (auth: requester must be member of groupId)
GET  /api/stats/:userId             — current streak per habit + last 30 days logs
                                      (auth: requester must == userId)
```

## Dates and Timezone

- All dates stored as `YYYY-MM-DD` strings in server timezone (`CRON_TIMEZONE`)
- The client explicitly sends the date string when logging (`POST /api/logs {date: "2026-03-19", ...}`) — no server-side "today" inference for log writes
- Streak calculation uses the server's current date in `CRON_TIMEZONE` as "today"
- Calendar queries: client sends `?month=2026-03` — server returns all logs for that month

## Streak Logic

- **Current streak**: count of consecutive days ending today where `completed = true`, scanning backwards through `habit_logs`. Stop scanning when a gap or `completed = false` is found (max scan = 365 days back)
- Grace period applies **only to today**: if today has no log entry yet, today doesn't break the streak
- Yesterday and older: no grace period — missing log = streak broken
- `completed = false` always breaks the streak, including retroactively filled past dates
- Past dates can be retroactively set to either `true` or `false` — no restriction
- Streak is calculated on read, not stored

### Calendar day color rules (priority order)
1. ⬛ Dark: future date (not tappable)
2. 🔴 Red: at least one `completed = false` for that day
3. 🟢 Green: all active habits have `completed = true`
4. 🟡 Yellow: at least one `completed = true`, none `false` (partial — some habits not yet logged)
5. ⬜ Dashed grey: no logs at all (past date — tappable to retroactively fill)
6. 🟣 Purple ring overlay on today's cell regardless of completion state (shows which day is today)

## Cron Jobs (bot.js)

Controlled by `ENABLE_CRON=true` in `.env` — off by default for local dev.
Timezone controlled by `CRON_TIMEZONE` (e.g. `Europe/Moscow`).

- **21:00 daily** — reminder to each group: "🔔 Не забудьте отметить привычки!" + inline button to open Mini App
- **22:00 daily** — streak milestone check (after reminder window): if any user's current streak is exactly 7/14/30/60/100 → post congratulations in their group(s). Runs after 21:00 reminder so users have time to mark habits first.

## Bot Commands

- `/start` — greeting + list of groups to join (if not yet linked) or "Открыть трекер" WebApp button
- `/setup` — (group chat only) creates/links group in DB, idempotent
- `/stats` — (group chat) posts today's summary for all members; internally reuses the same group members query as `GET /api/group/:groupId/members`

## Mini App — Screens

### Today (default)
- Header: avatar, greeting, today's date, badge "X/Y done"
- Progress bar: % of today's habits completed
- Habit cards: emoji, title, current streak, type badge, ✓/✗ buttons
- After mark: card animates to green (✓) or red (✗), haptic feedback
- "Add habit" dashed button at bottom

### Calendar
- Month grid (Mon–Sun), prev/next month arrows
- Day dot colors per rules above
- Tap past missed day (dashed) → bottom sheet: "Что было [дата]?" with ✓/✗ toggle per habit + Save
- Below grid: progress bars per habit (X of Y days this month) + current streak label

### Friends
- Group switcher dropdown in header
- List of group members: avatar letter, name, their habits with current streaks, "✓ отметил сегодня" or "— не отметил"

### Add Habit (bottom sheet)
- Text input: habit name
- Type radio: quit / build
- Emoji picker: 10 presets (🚬🍬🍺🏋️📚🧘💊😴🥗💻)
- Create button
- Edit existing habit: same sheet (title + emoji only, type locked), reachable via long-press on habit card in Today screen
- Archiving a habit is permanent at MVP (no reactivation UI). Archived habits disappear from all screens. `GET /api/habits/:userId` returns only `is_active = 1` habits. This is intentional.

### Navigation
Bottom bar: Today | Calendar | Friends

## Frontend

- `Telegram.WebApp.ready()` + `Telegram.WebApp.expand()` on load
- Haptic: `HapticFeedback.impactOccurred('medium')` on habit mark
- Always dark theme (#0F0F0F bg, #1A1A1A cards, #6C63FF accent, #4CAF50 success, #FF5252 fail)
- Single `index.html` — no build step
- Loading/error states: simple spinner overlay + toast messages for errors

## Environment Variables

```
BOT_TOKEN=
WEBAPP_URL=https://yourdomain.com   # ngrok URL for local dev
PORT=3000
DATABASE_PATH=./data/habits.db
ENABLE_CRON=false
CRON_TIMEZONE=Europe/Moscow
```

## Dependencies

```json
{
  "express": "^4.x",
  "better-sqlite3": "^9.x",
  "node-telegram-bot-api": "^0.64.x",
  "node-cron": "^3.x",
  "dotenv": "^16.x"
}
```
