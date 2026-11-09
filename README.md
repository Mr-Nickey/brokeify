<div align="center">

<img src="./public/pwa-192x192.png" alt="Brokeify Logo" width="110" height="110" />

# Brokeify v3.0 (Standalone All-In-One SQLite Edition)

**Because $11.99 a month is highway robbery.**  
*100% Standalone Self-Hosted Music Server, Embedded SQLite Library Engine (`/data/brokeify.db`), Real-Time Chokidar `/music` Drive & NAS Watcher, EBU R128 `-14 LUFS` Car-Stereo Normalizer, Android App QR Camera Pairing, and `slskd` + Lidarr + YouTube Music Autopilot — powered by spite, hard drives, and a '99 retro deck.*

[![Docker Ready](https://img.shields.io/badge/Docker%20%26%20Dockge-Port%203487-00ff66?style=for-the-badge&logo=docker&logoColor=black)](https://github.com/Mr-Nickey/brokeify)
[![Current Version](https://img.shields.io/badge/Version-v3.0.0--standalone-00ff66?style=for-the-badge&logo=github)](https://github.com/Mr-Nickey/brokeify/releases)
[![Native SQLite Engine](https://img.shields.io/badge/Engine-Embedded%20SQLite%20%2B%20FFmpeg%20LUFS-38bdf8?style=for-the-badge&logo=sqlite&logoColor=white)](https://github.com/Mr-Nickey/brokeify)
[![Android Companion API](https://img.shields.io/badge/Android%20App-Camera%20QR%20Pairing%20%2B%20HTTP%20206-a855f7?style=for-the-badge&logo=android&logoColor=white)](https://github.com/Mr-Nickey/brokeify)

</div>

---

## 🎧 What is Brokeify v3.0?

**Brokeify** is a completely standalone, all-in-one self-hosted music server, library manager, and audio streaming engine built for **Port `3487`**. No external media servers (no Jellyfin, Plex, Navidrome, or Subsonic) are required.

Point Brokeify at any local hard drive or NAS share mounted at `/music`, and Brokeify handles everything:

- **Embedded SQLite Database (`/data/brokeify.db`):** High-speed normalized tables (`artists`, `albums`, `tracks`, `playlists`, `playlist_tracks`, `scrobbles`) with instant search and filtering.
- **Zero Built-In Demo Tracks:** If no drive is connected or `/music` is empty, Brokeify displays an interactive **Connect Your Music Drive / NAS Setup Guide** with copy-ready Dockge/Docker Compose YAML and a live folder tester.
- **Real-Time `chokidar` File & Playlist Watcher (`/music`):** Automatically indexes `FLAC`, `MP3`, `OGG`, `OPUS`, `M4A`, `WAV`, and `AAC` audio files via `music-metadata`, extracts embedded album art to `/data/covers/{album_id}.jpg`, and imports `.m3u` / `.m3u8` playlists.
- **Integrated EBU R128 (`-14 LUFS`) Audio Normalization:** Background `ffmpeg` loudness scanner computes integrated loudness (`loudness_lufs`) and ReplayGain (`replaygain_track_gain`) so your car stereo and Android app play every album at a consistent volume without harsh jumps.
- **Native Android App Camera QR Code Pairing (`Settings → Connect Android App`):**
  - Displays a large, high-contrast QR code encoding a JSON payload with your server's local URL (`serverUrl` / `localUrl`), a 15-minute temporary connection token (`pair_...`), persistent API key, and streaming endpoints.
  - Includes a 1-click **Copy Server URL** button and step-by-step instructions for scanning with your Android app's built-in camera.
- **Better-Than-Explo Discovery & Multi-Downloader (`Request / Discover` Tab):**
  - Drop any **Spotify Playlist / Album URL** or search **MusicBrainz** to inspect missing tracks and grab lossless FLAC / 320k MP3 via **`slskd` (Soulseek)**, **`Lidarr`**, or **`YouTube Music` (`yt-dlp`)**.
- **Native ListenBrainz Scrobbler & MusicBrainz Auto-Tagger:**
  - Automatically scrobbles tracks at 50% or 4 minutes of playback to ListenBrainz and cleans/organizes messy tags into `{Artist}/{Album} ({Year})/{TrackNumber} - {Title}.{ext}`.

---

## 🐳 Quick Start: Dockge & Docker Compose (Port `3487`)

Brokeify runs natively on **Port `3487`** (`3487:3487`) so it never conflicts with Port `3000` (Grafana, Open WebUI, Uptime Kuma, Gitea).

### Option A: 1-Minute Setup in Dockge (Pulling Directly from GitHub)

1. Open **Dockge** (`http://<your-server-ip>:5001`) and click **+ Compose**.
2. Set the Stack Name to `brokeify`.
3. Paste the following into the `compose.yaml` editor and replace the left side of `:/music:rw` with your actual music drive or NAS mount path:

```yaml
services:
  brokeify:
    build: https://github.com/Mr-Nickey/brokeify.git#main
    container_name: brokeify
    restart: unless-stopped
    ports:
      - "3487:3487"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      - NODE_ENV=production
      - PORT=3487
      - BROKEIFY_DATA_DIR=/data
      - BROKEIFY_MUSIC_DIR=/music
      # Optional downloader & scrobbler integrations (can also be configured in Web UI Settings):
      # - SLSKD_URL=http://192.168.1.175:5030
      # - SLSKD_API_KEY=your_slskd_api_key
      # - LISTENBRAINZ_USER=your_listenbrainz_username
    volumes:
      - ./data:/data
      # Mount your local hard drive or NAS music folder to /music inside the container:
      # Windows Docker / WSL2 example: /d/Message:/music:rw
      # Linux / NAS example: /mnt/nas/music:/music:rw
      - /d/Message:/music:rw
```

4. Click **Deploy** (and whenever you push updates to GitHub, click **Update** or run `docker compose build --no-cache && docker compose up -d` to pull the latest commit from `main`).
5. Open `http://<your-server-ip>:3487`.

---

### Option B: Mounting a Network NAS Share (Synology / TrueNAS / Unraid SMB or NFS)

If your music lives on a NAS (`//192.168.1.x/music`), you can mount it directly in `docker-compose.yml` so Brokeify's `chokidar` scanner indexes it automatically:

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
      - BROKEIFY_DATA_DIR=/data
      - BROKEIFY_MUSIC_DIR=/music
    volumes:
      - ./data:/data
      - nas_music:/music:rw

volumes:
  nas_music:
    driver: local
    driver_opts:
      type: cifs
      o: "username=YOUR_NAS_USER,password=YOUR_NAS_PASS,vers=3.0,uid=1000,gid=1000,iocharset=utf8"
      device: "//192.168.1.200/music"
```

---

## 📱 Connecting Your Custom Android App (Camera QR Code Scanner)

Brokeify includes a dedicated **Connect Android App** pairing workflow in the top navigation bar (**`Connect Android App (QR)`**) and inside **`Settings → 1. Music Sources & Storage`**:

1. Open Brokeify in your desktop browser and go to **Settings** (or click **Connect Android App (QR)** in the top bar).
2. Point your Android app's built-in camera scanner at the high-contrast QR code.
3. The QR code encodes a JSON payload containing the server's local URL, temporary connection token (`pair_...`), persistent API key (`brk_...`), and REST endpoints:

```json
{
  "app": "brokeify",
  "version": "3.0-sqlite",
  "serverName": "Brokeify Music Server",
  "serverUrl": "http://192.168.1.175:3487",
  "localUrl": "http://192.168.1.175:3487",
  "token": "pair_a1b2c3d4e5f6...",
  "tokenExpiresAt": 1762709800000,
  "apiKey": "brk_9f8e7d6c5b4a...",
  "endpoints": {
    "verify": "/api/mobile/verify",
    "tracks": "/api/library/tracks",
    "albums": "/api/library/albums",
    "artists": "/api/library/artists",
    "playlists": "/api/playlists",
    "stream": "/api/stream/{trackId}",
    "covers": "/api/covers/{albumId}",
    "scrobble": "/api/scrobble"
  }
}
```

### Companion REST API Reference (Android & Android Auto)

All endpoints support CORS and accept either `Authorization: Bearer <token>` or `X-API-Key: <token>` (or `?token=<token>` query param for audio/cover URLs):

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/api/health` | `GET` | Server status, SQLite library counts (`totalTracks`, `totalAlbums`, `totalArtists`), LUFS queue status, and mounted `/music` drive diagnostics. |
| `/api/mobile/pair-info` | `GET` | Generates/returns the QR pairing payload (`serverUrl`, `localUrl`, 15-min `token`, `apiKey`, and QR Data URL). |
| `/api/mobile/regenerate-token` | `POST` | Issues a fresh 15-minute temporary pairing token (`pair_...`). |
| `/api/mobile/verify` | `GET` / `POST` | Verifies the temporary `token` or persistent `apiKey` during camera QR handshake and returns server library summary + persistent `apiKey`. |
| `/api/library/artists` | `GET` | Paginated list of artists (`?search=&limit=&offset=`). |
| `/api/library/albums` | `GET` | Paginated list of albums (`?artistId=&search=&limit=&offset=`). |
| `/api/library/tracks` | `GET` | Indexed tracks with `loudnessLufs`, `replaygainTrackGain`, `streamUrl`, and `coverUrl` (`?albumId=&artistId=&search=&limit=&offset=`). |
| `/api/stream/:trackId` | `GET` | RFC 7233 HTTP `206 Partial Content` byte-range audio stream (`Accept-Ranges: bytes`) for instant ExoPlayer seeking (`?transcode=mp3&bitrate=192k` optional). |
| `/api/covers/:albumId` | `GET` | Serves cached album artwork from `/data/covers/{albumId}.jpg` (`Cache-Control: public, max-age=31536000, immutable`). |
| `/api/playlists` | `GET` / `POST` | List all SQLite playlists or create/update a playlist. |
| `/api/scrobble` | `POST` | Increments `play_count` in SQLite, logs to `scrobbles`, and forwards to ListenBrainz (`https://api.listenbrainz.org/1/submit-listen`). |

---

## 🛠️ Building Locally for Development or Production

```bash
# 1. Install dependencies
npm install

# 2. Build frontend & server TypeScript bundle
npm run build

# 3. Start production server on port 3487
PORT=3487 npm start
```

---

<div align="center">
  <sub>Built with spite, hard drives, and Google AI Studio · Standalone SQLite Engine on Docker Port 3487 · Zero Subscriptions Forever</sub>
</div>
