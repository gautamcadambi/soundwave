# 🎵 SoundWave — Local Setup Guide

A Spotify-powered music discovery app. Swipe through tracks, hear the chorus play, like what you love.

---

## Prerequisites

- **Node.js** v18 or higher — https://nodejs.org
- A **Spotify Premium** account
- A registered app on the Spotify Developer Dashboard

---

## Step 1 — Register your Spotify App

1. Go to https://developer.spotify.com/dashboard
2. Click **"Create app"**
3. Fill in:
   - **App name**: SoundWave
   - **Redirect URI**: `http://localhost:3000/callback`  ← exact match required
   - **APIs used**: check "Web Playback SDK"
4. Save. You'll see your **Client ID** and **Client Secret** on the app page.

---

## Step 2 — Configure your environment

In the `soundwave/` folder:

```bash
cp .env.example .env
```

Open `.env` and fill in:

```
SPOTIFY_CLIENT_ID=paste_your_client_id
SPOTIFY_CLIENT_SECRET=paste_your_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/callback
SESSION_SECRET=any_long_random_string_here
PORT=3000
```

---

## Step 3 — Install dependencies

```bash
cd soundwave
npm install
```

---

## Step 4 — Run the app

```bash
npm start
```

You'll see:
```
🎵 SoundWave running at http://localhost:3000
```

Open http://localhost:3000 in your browser and click **"Continue with Spotify"**.

---

## How it works

| Feature | How |
|---|---|
| Login | Spotify OAuth 2.0 via your server |
| Playback | Spotify Web Playback SDK (streams in-browser) |
| Tracks | Spotify Search API filtered for indie artists (popularity < 40) |
| Recommendations | Spotify Recommendations API seeded by your liked tracks |
| Liked tracks | Saved to your Spotify library automatically |
| Progress bar | 15-second countdown per track (starts at ~30s into song for chorus) |

---

## Troubleshooting

**"INVALID_CLIENT" error** — Double-check Client ID and Client Secret in `.env`

**"Redirect URI mismatch"** — The redirect URI in your Spotify Dashboard must be exactly `http://localhost:3000/callback` with no trailing slash

**No audio / "Premium required"** — You must be logged in with a Premium Spotify account

**Blank screen after login** — Check the terminal for errors; usually a missing `.env` variable

**"Not available in your market"** — Change `market: 'IN'` in `server.js` to your country code (e.g. `US`, `GB`)

---

## Project structure

```
soundwave/
├── server.js          ← Express backend (auth, Spotify API proxy)
├── public/
│   ├── index.html     ← Login page
│   └── app.html       ← Main app (feed, player, likes)
├── .env               ← Your secrets (never commit this)
├── .env.example       ← Template
└── package.json
```
