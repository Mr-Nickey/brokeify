<div align="center">

<img src="./public/pwa-192x192.png" alt="Brokeify Logo" width="110" height="110" />

# Brokeify (Docker Full-Stack Edition)

**Because $11.99 a month is highway robbery.**  
*Self-hosted Jellyfin car stereo, Spotify & ListenBrainz autopilot discovery engine, `slskd` + YouTube Music downloader, Picard folder organizer & Maintainerr disk cleaner — powered by spite, hard drives, and a '99 retro deck.*

[![Docker Ready](https://img.shields.io/badge/Docker%20%26%20Dockge-Port%203487-00ff66?style=for-the-badge&logo=docker&logoColor=black)](https://github.com/Mr-Nickey/brokeify)
[![Current Version](https://img.shields.io/badge/Version-v0.0.0.1--beta-purple?style=for-the-badge&logo=github)](https://github.com/Mr-Nickey/brokeify/releases)
[![Self-Hosted Music](https://img.shields.io/badge/Self--Hosted-Jellyfin%20%2B%20Lidarr%20%2B%20slskd-38bdf8?style=for-the-badge&logo=jellyfin&logoColor=black)](https://github.com/Mr-Nickey/brokeify)
[![Built with Google AI Studio](https://img.shields.io/badge/Built%20With-Google%20AI%20Studio-a855f7?style=for-the-badge&logo=google&logoColor=white)](https://aistudio.google.com/)
[![Buy Me a Coffee Coming Soon](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Coming%20Soon%20%E2%98%95-f59e0b?style=for-the-badge)](https://github.com/Mr-Nickey/brokeify)

<br />

<img src="./public/favicon.svg" alt="Brokeify Vector Icon" width="48" height="48" />

</div>

---

## 🎧 What is Brokeify?

**Brokeify** is a self-hosted, Docker-ready full-stack music player, automated playlist autopilot, and library cleanup hub (React/Vite frontend + Express/Node.js backend in `server.js`) designed to run on **Port `3487`** under a single domain (like `https://music.yourdomain.com`) and **completely replace Explo & Maintainerr**.

### Why Brokeify Exists:
- **Zero-Login Persistent Server Config (`/app/data/config.json`):** Configure your Jellyfin, `slskd`, and `ListenBrainz` credentials once. Every phone, car stereo, laptop, Chromecast, or 72-inch TV that opens your Brokeify URL loads `/api/config` from `/app/data/config.json` automatically—plus a 1-click **`Download config.json Backup`** button in Settings.
- **Better Than Explo (`Request / Discover` Tab):**
  - **Unified Search & Spotify Link Dropper:** Search any **Artist, Album, or Song** via MusicBrainz, OR drop any **Spotify Playlist / Album Link** (`https://open.spotify.com/playlist/...`) right into the search bar.
  - **Better-Than-Explo Playlist Status Matrix:** Inspect any Spotify or ListenBrainz playlist with live filter pills showing **🟢 On Jellyfin**, **🟡 Missing**, **🔵 Downloading**, **🔴 Can't Find**, and **⚪ Excluded by Filter**.
  - **Multi-Source Downloader (`slskd` + `YouTube Music` + `Open Audio Archive`):** Automatically searches `slskd` for lossless FLAC / 320kbps MP3 first and falls back to **YouTube Music (`yt-dlp`)** when a song isn't found on Soulseek (or grab directly from YouTube Music with 1 click!).
  - **Explo-Style Exclusion Filters & Custom JS Filter Scripts:** 1-click toggles to block `Live`, `Remix`, `Acoustic`, `Instrumental/Karaoke`, `Sped Up / Slowed`, and `Commentary` tracks, plus custom excluded keywords, min/max duration limits, and a live JavaScript filter script editor.
  - **Autopilot Linked Playlists (Daily, Weekly, or Monthly Spotify Sync):** Link any playlist to a Spotify Playlist URL so Brokeify automatically checks Spotify on a **Daily, Weekly, or Monthly** schedule, downloads new songs, and populates your playlist on autopilot.
  - **MusicBrainz Picard + AI Auto-Tagger & Folder Organizer:** Automatically cleans messy track titles, resolves canonical Album / Year / Track Number metadata via MusicBrainz, and organizes files into `{Artist}/{Album} ({Year})/{TrackNumber} - {Title}.{ext}` folders.
- **Maintainerr-Style Library Statistics & Disk Space Janitor (`Library → Stats & Cleanup`):**
  - See songs **On Repeat (Most Played)**, **Recently Played**, **Never Played (0 Plays)**, **Unplayed All Year (365+ Days)**, and **Duplicate Files Wasting Space**—and bulk-delete unwanted files from Jellyfin's hard drive (`POST /api/jellyfin/items/bulk-delete`).
- **Playlist `⋯` Menu & Safe Multi-Select Playlist Deletion:**
  - Click the **`⋯` (Three Dots)** menu on any playlist card to **Rename** (while always preserving `Real Name: <server name>`), **Link to Spotify Autopilot**, **Select Multiple Playlists**, or **Delete Playlists**—with a clear safety guarantee that deleting a playlist **only deletes the playlist container, never your songs or albums**.
- **Dedicated Themes & Custom CSS Studio (`Settings → 3. Themes & Custom CSS`):**
  - Choose from 6 built-in Dark & Daylight skins, pick your own custom app title & favorite button colors, or write your own **Custom CSS** saved directly to `config.json`.
- **Universal Responsive Layout (Phone, Car Stereo, Laptop, 32" Garage TV & 72" 4K Home Theater):**
  - Scales fluidly from Android Auto / CarPlay and mobile screens up to half-screen desktop windows and 72-inch 4K Smart TVs / Chromecasts without overlapping buttons or clipped toolbars.

---

## 🤖 Full Transparency: Coded with Google AI Studio

If you peek around the repo or commit history, you'll see **Google AI Studio** all over it—and there's zero hiding that!

This project was vibe-coded and iterated inside **Google AI Studio** to build a custom, nostalgic late-'90s stereo deck and homelab music stack that works the exact way the author wanted in the car and at home.

> **Friendly Disclaimer:**  
> If you enjoy tinkering with AI-built homelab tools, awesome—pull the container, fork it, break it, and have fun!  
> If you prefer 100% hand-crafted, organic, artisanal human code and don't like AI-coded apps, **no hard feelings at all—you definitely don't have to use it!** ❤️ Grab a coffee, enjoy your own setup, and have a great drive.

---

## ☕ Support / Buy Me a Coffee (Coming Soon!)

Enjoying **Brokeify** in your car, garage, or homelab?  
A **Buy Me a Coffee / GitHub Sponsors** link is **coming soon** right here on GitHub! In the meantime, starring ⭐ the repository or sharing feedback in Issues is hugely appreciated.

---

## 🐳 How to Install with Dockge or Docker Compose (100% Port `3487` — Zero Port `3000` Conflict!)

Port `3000` is already used by **Open WebUI**, **Grafana**, **Uptime Kuma**, and **Gitea** on almost every homelab server.

To make sure Brokeify **never touches Port `3000`**, Brokeify runs natively on **Port `3487`** both inside and outside the container (`3487:3487` with `PORT=3487`).

### Option A: 1-Minute Setup in Dockge (Connected Directly to GitHub)

1. Open **Dockge** in your homelab and click **+ Compose**.
2. Set the Stack Name to `brokeify`.
3. Paste the following into the `compose.yaml` editor on the right:

```yaml
services:
  brokeify:
    build: https://github.com/Mr-Nickey/brokeify.git#main
    container_name: brokeify
    restart: unless-stopped
    ports:
      - "3487:3487"
    environment:
      - NODE_ENV=production
      - PORT=3487
    volumes:
      - ./data:/app/data
      - ./downloads:/app/downloads
```

4. Click **Deploy** (and whenever you push updates to GitHub, just click **Update / Rebuild** in Dockge!).
5. Open `http://<your-server-ip>:3487` (or point your Cloudflare Tunnel / Nginx Proxy Manager / Caddy domain `https://music.yourdomain.com` to `http://<your-server-ip>:3487`).

---

### Option B: Standard `docker compose` via Terminal

```bash
# 1. Clone the repository
git clone https://github.com/Mr-Nickey/brokeify.git
cd brokeify

# 2. Build and start the container in the background on port 3487
docker compose up -d --build

# 3. View logs
docker compose logs -f brokeify
```

Your persistent configuration, custom CSS, exclusion filters, play statistics, and autopilot schedules are stored safely in `./data/config.json` (mounted to `/app/data/config.json` inside the container).

---

## 🖼️ App Icons & Assets

| Asset | Preview | Path |
| :--- | :---: | :--- |
| **Vector App Emblem** | <img src="./public/favicon.svg" width="44" height="44" alt="Favicon SVG" /> | `./public/favicon.svg` |
| **192×192 WebAPK Icon** | <img src="./public/pwa-192x192.png" width="48" height="48" alt="192x192 Icon" /> | `./public/pwa-192x192.png` |
| **512×512 Maskable Icon** | <img src="./public/pwa-512x512.png" width="56" height="56" alt="512x512 Icon" /> | `./public/pwa-512x512.png` |

---

<div align="center">
  <sub>Built with spite, hard drives, and Google AI Studio · Self-Hosted on Docker Port 3487 · Zero Subscriptions Forever</sub>
</div>
