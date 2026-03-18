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
