<div align="center">

<img src="./public/pwa-192x192.png" alt="Brokeify Logo" width="110" height="110" />

# Brokeify (Docker Full-Stack Edition)

**Because $11.99 a month is highway robbery.**  
*Self-hosted Jellyfin car stereo, ListenBrainz discovery engine & automated `slskd` downloader — powered by spite, hard drives, and a '99 retro deck.*

[![Docker Ready](https://img.shields.io/badge/Docker%20%26%20Dockge-Port%203487-00ff66?style=for-the-badge&logo=docker&logoColor=black)](https://github.com/Mr-Nickey/brokeify)
[![Self-Hosted Music](https://img.shields.io/badge/Self--Hosted-Jellyfin%20%2B%20slskd%20%2B%20ListenBrainz-38bdf8?style=for-the-badge&logo=jellyfin&logoColor=black)](https://github.com/Mr-Nickey/brokeify)
[![Built with Google AI Studio](https://img.shields.io/badge/Built%20With-Google%20AI%20Studio-a855f7?style=for-the-badge&logo=google&logoColor=white)](https://aistudio.google.com/)

<br />

<img src="./public/favicon.svg" alt="Brokeify Vector Icon" width="48" height="48" />

</div>

---

## 🎧 What is Brokeify?

**Brokeify** is a self-hosted, Docker-ready full-stack music player and automated discovery/downloader hub (React/Vite frontend + Express/Node.js backend in `server.js`) designed to run under a single domain (like `https://music.yourdomain.com`) and **completely replace Explo**.

### Why Brokeify Exists:
- **Zero-Login Persistent Server Config (`/app/data/config.json`):** Configure your Jellyfin, `slskd`, and `ListenBrainz` credentials once. Every phone, tablet, or desktop that opens your Brokeify URL loads `/api/config` from `/app/data/config.json` automatically—plus a 1-click **`Download config.json Backup`** button in Settings.
- **Replaces Explo (`Request / Discover` Tab):**
  - Search any **Artist, Album, or Song** via MusicBrainz (`GET /api/musicbrainz/search` + exact album tracklists).
  - Browse your **ListenBrainz** `"Created For You"` mixes (**Weekly Exploration**, **Weekly Jams**, **Daily Jams**) and see which songs are already in Jellyfin vs. missing.
  - Click **"Grab Full Album"** or **"Download Missing Playlist Tracks"** — the Node.js backend searches your local `slskd` instance (`POST /api/v0/searches`), picks the best peer with `hasFreeUploadSlot: true` (preferring **FLAC** or **320kbps MP3**), queues the downloads, watches `GET /api/v0/transfers/downloads` in the background, and automatically triggers `POST /Library/Refresh` on Jellyfin the instant it finishes (`"Linkin Park - Hybrid Theory is ready to play!"`).
- **Delete Duplicate Files Directly from Jellyfin's Hard Drive:**
  - Noticed duplicate tracks downloaded over time? Click the **`🗑️` Delete** button on any song row to call `DELETE /api/jellyfin/items/:id` and permanently remove the duplicate from your server's disk, while **Smart Anti-Repeat** guarantees the same song never plays back-to-back.
- **Built for Driving & Variable Mobile Data:**
  - **Aggressive FLAC / MP3 Volume Stabilizer** (5-band EQ + heavy-duty compressor + LUFS preamp) so loud FLACs and quiet 240kbps MP3s play at the same volume.
  - **Seamless Crossfade (0s–12s)** + **6s Proactive Stream Buffer** + **IndexedDB Offline Vault (2–12 Tracks)** + **Android Auto / Car Mode**.

---

## 🤖 Full Transparency: Coded with Google AI Studio

If you peek around the repo or commit history, you'll see **Google AI Studio** all over it—and there's zero hiding that!

This project was vibe-coded and iterated inside **Google AI Studio** to build a custom, nostalgic late-'90s stereo deck and homelab music stack that works the exact way the author wanted in the car and at home.

> **Friendly Disclaimer:**  
> If you enjoy tinkering with AI-built homelab tools, awesome—pull the container, fork it, break it, and have fun!  
> If you prefer 100% hand-crafted, organic, artisanal human code and don't like AI-coded apps, **no hard feelings at all—you definitely don't have to use it!** ❤️ Grab a coffee, enjoy your own setup, and have a great drive.

---

## 🐳 How to Install with Dockge or Docker Compose (Conflict-Free Port `3487`)

Every homelab already has a dozen services fighting over ports `3000` (Grafana / Uptime Kuma / Gitea), `5001` (Dockge), `5030` (slskd), `8080` (qBittorrent / SABnzbd), `8096` (Jellyfin), and `4533` (Navidrome).

To make sure Brokeify **never collides with anything in your homelab**, Brokeify maps host port **`3487`** → container port `3000` (`3487:3000`).

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
      - "3487:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    volumes:
      - ./data:/app/data
```

4. Click **Deploy** (and whenever you push updates to GitHub, just click **Update / Rebuild** in Dockge!).
5. Open `http://<your-server-ip>:3487` (or point your Cloudflare Tunnel / Nginx Proxy Manager / Caddy domain `https://music.yourdomain.com` to `http://<your-server-ip>:3487`).

---

### Option B: Standard `docker compose` via Terminal

```bash
# 1. Clone the repository
git clone https://github.com/Mr-Nickey/brokeify.git
cd brokeify

# 2. Build and start the container in the background
docker compose up -d --build

# 3. View logs
docker compose logs -f brokeify
```

Your persistent configuration and playlists will be stored safely in `./data/config.json` (mounted to `/app/data/config.json` inside the container).

---

## ⚙️ First-Run Setup & How to Use Everything

### 1. Connect Jellyfin (Quick Connect or Username/Password)
1. Open Brokeify at `https://music.yourdomain.com` (or `http://<server-ip>:3487`).
2. On the welcome modal (or **Settings ⚙️ → Manage Providers**), enter your Jellyfin URL (e.g. `https://jellyfin.yourdomain.com` or internal `http://jellyfin:8096`).
3. Authenticate with **⚡ Quick Connect** or **Username & Password**.
4. Brokeify immediately saves your token to `/app/data/config.json`. Any other device you open Brokeify on will automatically load your library and playlists without asking you to log in again!

### 2. Configure `slskd` & `ListenBrainz` (Replaces Explo)
1. Go to **Settings ⚙️ → Sources Hub**.
2. At the top card (**`Persistent Server Storage (/app/data/config.json) & Explo Replacement Keys`**):
   - **slskd Internal Docker / LAN URL:** e.g., `http://slskd:5030` or `http://192.168.1.50:5030`
   - **slskd API Key (`X-API-Key`):** Paste your `slskd` API key from your `slskd.yml` config.
   - **ListenBrainz Username:** Enter your ListenBrainz username (e.g., `your-listenbrainz-username`).
   - **ListenBrainz User Token:** Paste your token from `https://listenbrainz.org/settings/` to enable automatic `playing_now` and `single` listen scrobbling.
3. Click **`Save to config.json`** (and click **`Download config.json Backup`** anytime you want a local backup file).

### 3. Grab Full Albums, Missing Weekly Exploration Tracks & Auto-Import to Jellyfin
1. Click the **`Request / Discover`** tab in the top navigation bar.
2. **Search MusicBrainz:** Search for any Album or Song, click **View Tracklist** to inspect the exact tracks, and click **`Grab Full Album`** or **`Grab Track`**.
3. **ListenBrainz Weekly Exploration:** Switch to **`ListenBrainz Weekly Exploration`**, view your personalized mixes, and click **`Download Missing Playlist Tracks`**.
4. **Automatic Jellyfin Import:** Brokeify's backend watches `GET /api/v0/transfers/downloads` in `slskd`. The moment the files finish downloading, Brokeify sends `POST /Library/Refresh` to Jellyfin and pops up a green banner:
   > **`🎉 Linkin Park - Hybrid Theory is ready to play! [Sync & Play Now ▶]`**

### 4. Rename Playlists (While Keeping the Real Server Name) & Delete Duplicates
- **Rename Playlists:** On **Library → Playlists**, click the **Pencil (`✏️`)** icon on any playlist card to give it a custom display name. The card will always display both your custom name and `Real Name: <original server name>`.
- **Delete Duplicate Songs from Disk:** On **Library → Songs**, click the **Trash (`🗑️`)** button on any duplicate track and confirm **`Delete File`** to call `DELETE /api/jellyfin/items/:id` and remove it from your Jellyfin server.

---

## 🔌 Backend API Reference (`server.js`)

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/api/config` | `GET` / `POST` | Reads and writes persistent server configuration (`/app/data/config.json`). |
| `/api/config/backup` | `GET` | Downloads a timestamped `config.json` backup file. |
| `/api/jellyfin/items/:id` | `DELETE` | Calls Jellyfin `DELETE /Items/:id` to permanently delete duplicate tracks from disk. |
| `/api/jellyfin/refresh` | `POST` | Triggers `POST /Library/Refresh` on your Jellyfin server. |
| `/api/listenbrainz/discover` | `GET` | Fetches ListenBrainz `createdfor` playlists (`Weekly Exploration`, `Weekly Jams`) and cross-checks tracks against Jellyfin. |
| `/api/listenbrainz/scrobble` | `POST` | Submits `playing_now` and `single` listens to ListenBrainz. |
| `/api/musicbrainz/search` | `GET` | Searches MusicBrainz for albums (`release-group`) or songs (`recording`). |
| `/api/musicbrainz/album/:id` | `GET` | Resolves the official release tracklist for a MusicBrainz album. |
| `/api/slskd/grab` | `POST` | Searches `slskd`, selects the best peer with `hasFreeUploadSlot: true` (FLAC / 320kbps MP3), and queues downloads. |
| `/api/slskd/status` | `GET` | Returns active `slskd` download progress and completed Jellyfin import notifications. |

---

## 🖼️ App Icons & Assets

| Asset | Preview | Path |
| :--- | :---: | :--- |
| **Vector App Emblem** | <img src="./public/favicon.svg" width="44" height="44" alt="Favicon SVG" /> | `./public/favicon.svg` |
| **192×192 WebAPK Icon** | <img src="./public/pwa-192x192.png" width="48" height="48" alt="192x192 Icon" /> | `./public/pwa-192x192.png` |
| **512×512 Maskable Icon** | <img src="./public/pwa-512x512.png" width="56" height="56" alt="512x512 Icon" /> | `./public/pwa-512x512.png` |

---

<div align="center">
  <sub>Built with spite, hard drives, and Google AI Studio · Self-Hosted on Docker · Zero Subscriptions Forever</sub>
</div>
