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
