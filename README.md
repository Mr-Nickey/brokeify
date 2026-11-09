<div align="center">

<img src="./public/pwa-192x192.png" alt="Brokeify Logo" width="110" height="110" />

# Brokeify (v0.1.2-beta)

*Standalone Self-Hosted Music Server on Port `3487` · Embedded SQLite Library Engine (`/data/brokeify.db`) · Real-Time Chokidar `/music` Drive & NAS Watcher · EBU R128 `-14 LUFS` Audio Normalizer · Android App QR Camera Pairing · `slskd` + Lidarr + YouTube Music Downloader*

[![Docker Ready](https://img.shields.io/badge/Docker%20%26%20Dockge-Port%203487-00ff66?style=for-the-badge&logo=docker&logoColor=black)](https://github.com/Mr-Nickey/brokeify)
[![Current Version](https://img.shields.io/badge/Version-v0.1.2--beta-purple?style=for-the-badge&logo=github)](https://github.com/Mr-Nickey/brokeify/releases)
[![Native SQLite Engine](https://img.shields.io/badge/Engine-Embedded%20SQLite%20%2B%20FFmpeg%20LUFS-38bdf8?style=for-the-badge&logo=sqlite&logoColor=white)](https://github.com/Mr-Nickey/brokeify)
[![Android Companion App](https://img.shields.io/badge/Android%20APK-brokeify--android-a855f7?style=for-the-badge&logo=android&logoColor=white)](https://github.com/Mr-Nickey/brokeify-android)

</div>

---

## 📱 Official Brokeify Android App (APK Download)

Download the companion mobile app to stream from your Brokeify Docker server on the go or in the car:

👉 **Android APK & Source:** **[github.com/Mr-Nickey/brokeify-android](https://github.com/Mr-Nickey/brokeify-android)**

> **Note:** The mobile companion app is **Android-only for now**. Install the APK from [`brokeify-android`](https://github.com/Mr-Nickey/brokeify-android), open the built-in camera scanner inside the app, and scan the QR code in Brokeify's **Settings → Connect Android App** tab to link your phone.

---

## 🎧 Overview

**Brokeify (`v0.1.2-beta`)** is a standalone, all-in-one self-hosted music server, library manager, and audio streaming engine built for **Port `3487`**. No external media servers are required.

Mount any local hard drive or NAS share at `/music`, and Brokeify handles indexing, normalization, playlists, discovery, and streaming:

- **Embedded SQLite Database (`/data/brokeify.db`):** Normalized tables (`artists`, `albums`, `tracks`, `playlists`, `playlist_tracks`, `scrobbles`) with fast search and filtering.
- **Zero Built-In Demo Tracks:** If no drive is connected or `/music` is empty, Brokeify displays a **Connect Your Music Drive / NAS Setup Guide** with copy-ready Docker Compose YAML and a live folder tester.
- **Real-Time `chokidar` File & Playlist Watcher (`/music`):** Automatically indexes `FLAC`, `MP3`, `OGG`, `OPUS`, `M4A`, `WAV`, and `AAC` audio files via `music-metadata`, caches embedded album art to `/data/covers/{album_id}.jpg`, and imports `.m3u` / `.m3u8` playlists.
- **Integrated EBU R128 (`-14 LUFS`) Audio Normalization:** Background `ffmpeg` loudness scanner computes integrated loudness (`loudness_lufs`) and ReplayGain (`replaygain_track_gain`) for consistent volume across tracks.
- **Connect Android App (`Settings → Connect Android App`):**
  - Displays a large, high-contrast QR code encoding a JSON payload with your server's local URL (`serverUrl` / `localUrl`), a 15-minute temporary connection token (`pair_...`), persistent API key, and streaming endpoints.
  - Includes a **Copy Server URL** button and instructions for scanning with the [**Brokeify Android App**](https://github.com/Mr-Nickey/brokeify-android) camera.
- **Discovery & Multi-Downloader (`Request / Discover` Tab):**
  - Search **MusicBrainz** or import a **Spotify Playlist / Album URL** to inspect missing tracks and download via **`slskd` (Soulseek)**, **`Lidarr`**, or **`YouTube Music` (`yt-dlp`)**.
- **ListenBrainz Scrobbler & MusicBrainz Auto-Tagger:**
  - Automatically scrobbles tracks at 50% or 4 minutes of playback to ListenBrainz and organizes tags into `{Artist}/{Album} ({Year})/{TrackNumber} - {Title}.{ext}`.

---

## 🐳 Quick Start: Dockge & Docker Compose (Port `3487`)

Brokeify runs on **Port `3487`** (`3487:3487` with `PORT=3487`).

### Option A: Dockge / Docker Compose Setup (Pulling from GitHub)

1. Open **Dockge** (`http://<your-server-ip>:5001`) and click **+ Compose**.
2. Set the Stack Name to `brokeify`.
3. Paste the following into `compose.yaml` and replace the left side of `:/music:rw` with your music drive or NAS path:

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

4. Click **Deploy** (to pull the latest GitHub changes later, click **Update** or run `docker compose build --no-cache && docker compose up -d`).
5. Open `http://<your-server-ip>:3487`.

---

### Option B: Mounting a Network NAS Share (SMB / CIFS)

If your music is stored on a NAS (`//192.168.1.x/music`), you can mount it directly in `docker-compose.yml`:

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

## 📱 Connecting the Brokeify Android App (Camera QR Code Scanner)

Download the Android app (**Android-only for now**) from **[github.com/Mr-Nickey/brokeify-android](https://github.com/Mr-Nickey/brokeify-android)**.

1. Open Brokeify in your desktop browser and go to **Settings** (or click **📱 Connect Android App** in the top navigation bar).
2. Open the [**Brokeify Android App**](https://github.com/Mr-Nickey/brokeify-android) on your phone and point its built-in camera scanner at the QR code.
3. The QR code encodes a JSON payload containing the server's local URL, temporary connection token (`pair_...`), persistent API key (`brk_...`), and REST endpoints:

```json
{
  "app": "brokeify",
  "v": 1,
  "serverUrl": "http://192.168.1.175:3487",
  "localUrl": "http://192.168.1.175:3487",
  "token": "pair_a1b2c3d4e5f6...",
  "apiKey": "brk_9f8e7d6c5b4a...",
  "endpoints": {
    "verify": "/api/mobile/verify",
    "tracks": "/api/library/tracks",
    "albums": "/api/library/albums",
    "artists": "/api/library/artists",
    "playlists": "/api/playlists",
    "stream": "/api/stream/{trackId}",
    "cover": "/api/covers/{albumId}",
    "scrobble": "/api/scrobble"
  }
}
```

### Companion REST API Reference (Android & Android Auto)

All endpoints support CORS and accept either `Authorization: Bearer <token>` or `X-API-Key: <token>` (or `?token=<token>` query param for audio/cover URLs):

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/api/health` | `GET` | Server status, SQLite library counts (`totalTracks`, `totalAlbums`, `totalArtists`), LUFS queue status, and mounted `/music` drive diagnostics. |
| `/api/mobile/pair-info` | `GET` | Generates/returns the QR pairing payload (`serverUrl`, `localUrl`, 15-min `token`, `apiKey`, and paired device list). |
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

## 🛠️ Building Locally

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
  <sub>Brokeify v0.1.2-beta · Self-Hosted SQLite Music Server on Port 3487 · <a href="https://github.com/Mr-Nickey/brokeify-android">Brokeify Android App</a></sub>
</div>
