export interface ApiSpecOptions {
  baseUrl?: string;
  version?: string;
  port?: number;
  totalTracks?: number;
  totalAlbums?: number;
  totalArtists?: number;
  totalPlaylists?: number;
  authRequired?: boolean;
}

export function generateBrokeifyApiSpecMarkdown(options: ApiSpecOptions = {}): string {
  const baseUrl = (options.baseUrl || 'https://your-brokeify-server.com').replace(/\/+$/, '');
  const version = options.version || '3.0.0-standalone';
  const port = options.port || 3487;
  const generatedAt = new Date().toISOString();

  return `# Brokeify API Handshake & Companion Client Specification (\`brokeify-api-handshake.md\`)

> **Server Engine:** Brokeify Standalone Docker Server (\`v${version}\`)
> **Base URL:** \`${baseUrl}\` (Default Container Port: \`${port}\`)
> **Generated At:** \`${generatedAt}\`
> **SQLite Mode:** \`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;\` (\`/data/brokeify.db\`)

This specification defines the complete REST contract for the **Brokeify Android / Android Auto Companion App**, third-party mobile players, and external automation clients. Give this file directly to any AI coding assistant or mobile developer to implement a 100% compatible client with zero guesswork.

---

## 1. Base URL, Discovery & Authentication Handshake Sequence

### Step 1: Server Discovery & Handshake (\`GET /api/ping\`)
Before prompting for credentials, call \`GET ${baseUrl}/api/ping\` (unauthenticated).

\`\`\`http
GET /api/ping HTTP/1.1
Host: ${baseUrl.replace(/^https?:\/\//, '')}
Accept: application/json
\`\`\`

**Response (\`200 OK\`):**
\`\`\`json
{
  "ok": true,
  "name": "Brokeify",
  "version": "${version}",
  "setupRequired": false,
  "authRequired": true,
  "serverTime": "${generatedAt}",
  "sqlite": {
    "journalMode": "WAL",
    "busyTimeoutMs": 5000
  }
}
\`\`\`
- If \`setupRequired: true\`, direct the user to \`POST /api/auth/setup\` to create the initial admin account.
- If \`authRequired: true\`, proceed to Step 2 (\`POST /api/auth/login\`), Quick Connect 6-digit pairing (\`POST /api/mobile/verify\`), or use a Personal API Key (\`brk_live_...\`).

### Step 2: Obtain Bearer Token (\`POST /api/auth/login\`)
Authenticate with username and password to receive a signed JWT \`token\`, a \`refreshToken\`, and user profile metadata.

\`\`\`http
POST /api/auth/login HTTP/1.1
Content-Type: application/json

{
  "username": "admin",
  "password": "your-secure-password"
}
\`\`\`

**Response (\`200 OK\`):**
\`\`\`json
{
  "ok": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2026-12-12T07:30:00.000Z",
  "apiKey": "brk_live_...",
  "user": {
    "id": "usr-brokeify-admin",
    "username": "admin",
    "displayName": "admin",
    "role": "admin",
    "isAdmin": true
  }
}
\`\`\`

### Step 3: Authenticated Requests & Long-Lived Personal API Keys
Pass the token on every subsequent API request via the \`Authorization\` header:
\`\`\`http
Authorization: Bearer <token_or_brk_live_api_key>
\`\`\`
For audio streaming (\`/api/stream/:id\`) and cover art (\`/api/covers/:id\`) where native media players or \`<img>\` tags cannot easily attach headers, you may also pass \`?token=<token_or_api_key>\` as a URL query parameter.

---

## 2. Complete Endpoint Reference Table

| Category | Method | Path | Auth | Query / Body Params | Status Codes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Handshake** | \`GET\` | \`/api/ping\` | Public | None | \`200\` |
| **Setup** | \`POST\` | \`/api/auth/setup\` | Public* | \`{ username, password, displayName? }\` (*when \`setupRequired\` or \`ALLOW_SIGNUP=true\`) | \`201\`, \`400\`, \`403\`, \`429\` |
| **Auth** | \`POST\` | \`/api/auth/login\` | Public | \`{ username, password }\` | \`200\`, \`401\`, \`429\` |
| **Auth** | \`POST\` | \`/api/auth/refresh\` | Public | \`{ refreshToken }\` | \`200\`, \`401\` |
| **Auth** | \`GET\` | \`/api/auth/me\` | Bearer | None | \`200\`, \`401\` |
| **API Keys** | \`GET\` | \`/api/auth/api-keys\` | Bearer | None | \`200\`, \`401\` |
| **API Keys** | \`POST\` | \`/api/auth/api-keys\` | Bearer (Admin) | \`{ name: "Pixel 9 Pro / Android Auto" }\` | \`201\`, \`400\`, \`403\` |
| **API Keys** | \`DELETE\` | \`/api/auth/api-keys/:id\` | Bearer (Admin) | None | \`200\`, \`404\` |
| **Quick Connect** | \`POST\` | \`/api/mobile/verify\` | Public | \`{ code: "123456", deviceName?: "..." }\` | \`200\`, \`401\`, \`429\` |
| **Library** | \`GET\` | \`/api/library/stats\` | Bearer | None | \`200\`, \`401\` |
| **Library** | \`POST\` | \`/api/library/rescan\` | Bearer (Admin) | None | \`200\`, \`403\` |
| **Artists** | \`GET\` | \`/api/artists\` | Bearer | \`?q=&search=\` | \`200\`, \`401\` |
| **Artists** | \`GET\` | \`/api/artists/:id\` | Bearer | None | \`200\`, \`404\` |
| **Albums** | \`GET\` | \`/api/albums\` | Bearer | \`?artistId=&q=&search=\` | \`200\`, \`401\` |
| **Albums** | \`GET\` | \`/api/albums/:id\` | Bearer | None | \`200\`, \`404\` |
| **Tracks** | \`GET\` | \`/api/tracks\` | Bearer | \`?limit=100&offset=0&sort=title&order=asc&artistId=&albumId=&genre=&q=\` | \`200\`, \`401\` |
| **Search** | \`GET\` | \`/api/search\` | Bearer | \`?q=<query>\` | \`200\`, \`401\` |
| **Song Radio** | \`GET\` | \`/api/radio/track/:id\` | Bearer | \`?limit=25\` | \`200\`, \`404\` |
| **Lyrics** | \`GET\` | \`/api/lyrics\` | Bearer | \`?trackId=<id>\` or \`?title=&artist=&album=&duration=\` | \`200\`, \`400\` |
| **Cover Art** | \`GET\` | \`/api/covers/:id\` | Bearer / \`?token=\` | \`:id\` can be \`albumId\`, \`trackId\`, \`artistId\`, or \`playlistId\` | \`200\`, \`304\`, \`400\`, \`404\` |
| **Playlists** | \`GET\` | \`/api/playlists\` | Bearer | None | \`200\`, \`401\` |
| **Playlists** | \`POST\` | \`/api/playlists\` | Bearer | \`{ name, description?, trackIds? }\` | \`201\`, \`400\` |
| **Playlists** | \`GET\` | \`/api/playlists/:id\` | Bearer | None | \`200\`, \`404\` |
| **Playlists** | \`PATCH\` | \`/api/playlists/:id\` | Bearer | \`{ name?, description?, trackIds? }\` | \`200\`, \`404\` |
| **Playlists** | \`DELETE\` | \`/api/playlists/:id\` | Bearer | None | \`200\`, \`404\` |
| **Playlist Tracks**| \`POST\` | \`/api/playlists/:id/tracks\`| Bearer | \`{ trackIds: string[], force?: boolean }\` | \`200\`, \`404\` |
| **Playlist Tracks**| \`DELETE\`| \`/api/playlists/:id/tracks/:trackId\` | Bearer | None | \`200\`, \`404\` |
| **Playlist Order** | \`PUT\` | \`/api/playlists/:id/reorder\`| Bearer | \`{ trackIds: string[] }\` | \`200\`, \`404\` |
| **Playlist Export**| \`GET\` | \`/api/playlists/:id/export.m3u8\` | Bearer | None | \`200\`, \`404\` |
| **Playlist Import**| \`POST\` | \`/api/playlists/import\` | Bearer | \`{ name?, content?: "#EXTM3U...", trackIds?: string[] }\` | \`201\`, \`400\` |
| **Liked Songs** | \`GET\` | \`/api/liked\` | Bearer | None | \`200\`, \`401\` |
| **Liked Songs** | \`POST\` | \`/api/liked/:trackId\` | Bearer | None | \`200\`, \`400\` |
| **Liked Songs** | \`DELETE\` | \`/api/liked/:trackId\` | Bearer | None | \`200\`, \`400\` |
| **Play History** | \`POST\` | \`/api/history\` | Bearer | \`{ trackId, positionSec?, completed?: boolean }\` | \`200\`, \`400\` |
| **Play History** | \`GET\` | \`/api/history/recent\` | Bearer | \`?limit=50\` | \`200\`, \`401\` |
| **Audio Stream** | \`GET\` | \`/api/stream/:id\` | Bearer / \`?token=\` | Header \`Range: bytes=start-end\` | \`200\`, \`206\`, \`403\`, \`404\`, \`416\` |

---

## 3. Exact Data Models (TypeScript & JSON Schemas)

\`\`\`typescript
export interface BrokeifyUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'listener';
  isAdmin: boolean;
}

export interface BrokeifyTrack {
  id: string;                      // e.g. "trk-8f9d2a1b4c3e5f60"
  albumId: string | null;          // e.g. "alb-3c4d5e6f7a8b9c0d"
  artistId: string | null;         // e.g. "art-1a2b3c4d5e6f7a8b"
  title: string;
  artist: string;
  album: string;
  year: number | null;
  genre: string;
  trackNumber: number;
  discNumber: number;
  duration: number;                // Duration in seconds
  durationMs: number;              // Duration in milliseconds
  format: string;                  // e.g. "FLAC 44/16", "MP3", "OPUS"
  bitrate: number;                 // kbps, e.g. 320 or 1411
  sampleRate: number;              // Hz, e.g. 44100 or 48000
  loudnessLufs: number | null;     // EBU R128 integrated loudness (e.g. -13.8)
  replaygainTrackGain: number | null; // dB adjustment toward -14 LUFS target
  playCount: number;
  lastPlayedAt: string | null;     // ISO-8601 timestamp
  streamUrl: string;               // Relative path: "/api/stream/{id}"
  artworkUrl: string;              // Relative path: "/api/cover/album/{albumId}"
  coverUrl: string;                // Relative path: "/api/covers/{albumId}"
}

export interface BrokeifyAlbum {
  id: string;
  artistId: string | null;
  artistName: string;
  title: string;
  year: number | null;
  genre: string;
  coverUrl: string;                // "/api/covers/{id}"
  trackCount: number;
  tracks?: BrokeifyTrack[];        // Included on GET /api/albums/:id
}

export interface BrokeifyArtist {
  id: string;
  name: string;
  sortName: string;
  imageUrl: string;                // "/api/cover/artist/{id}"
  albumCount: number;
  trackCount: number;
  albums?: BrokeifyAlbum[];        // Included on GET /api/artists/:id
  topTracks?: BrokeifyTrack[];     // Included on GET /api/artists/:id
}

export interface BrokeifyPlaylist {
  id: string;
  name: string;
  description: string;
  coverUrl: string;                // "/api/cover/playlist/{id}"
  isSmart: boolean;
  trackCount: number;
  trackIds: string[];
  tracks?: BrokeifyTrack[];        // Included on GET /api/playlists/:id
  createdAt: string;
  updatedAt: string;
}

export interface BrokeifyLyricsResponse {
  ok: boolean;
  source: 'LRCLIB' | 'fallback';
  trackName: string;
  artistName: string;
  instrumental: boolean;
  syncedLyrics: string | null;     // Standard LRC format: "[00:12.40] Line text"
  plainLyrics: string | null;
  duration: number;
}
\`\`\`

---

## 4. Android / ExoPlayer (Media3) Audio Streaming & Cover Art Rules

### 4.1 Seekable Byte-Range Streaming (\`GET /api/stream/:id\`)
- \`/api/stream/:id\` implements full RFC 7233 **HTTP \`206 Partial Content\`** byte-range streaming (\`Accept-Ranges: bytes\`, \`Content-Range: bytes start-end/total\`, \`Content-Length\`).
- Supported native MIME types:
  - \`.flac\` -> \`audio/flac\`
  - \`.mp3\` -> \`audio/mpeg\`
  - \`.m4a\` -> \`audio/mp4\`
  - \`.ogg\` -> \`audio/ogg\`
  - \`.opus\` -> \`audio/ogg; codecs=opus\`
  - \`.wav\` -> \`audio/wav\`
  - \`.aac\` -> \`audio/aac\`

#### Kotlin / AndroidX Media3 (\`ExoPlayer\`) Configuration Snippet:
\`\`\`kotlin
val dataSourceFactory = DefaultHttpDataSource.Factory()
    .setUserAgent("BrokeifyAndroid/3.0 (Media3)")
    .setDefaultRequestProperties(mapOf("Authorization" to "Bearer \$apiToken"))
    .setAllowCrossProtocolRedirects(true)

val mediaItem = MediaItem.Builder()
    .setMediaId(track.id)
    .setUri("\$baseUrl/api/stream/\${track.id}")
    .setMediaMetadata(
        MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)
            .setArtworkUri(Uri.parse("\$baseUrl/api/covers/\${track.albumId ?: track.id}?token=\$apiToken"))
            .build()
    )
    .build()
\`\`\`

### 4.2 Cover Art Caching (\`GET /api/covers/:id\`)
- \`/api/covers/:id\` returns \`Cache-Control: public, max-age=86400\` and weak \`ETag\` headers (\`304 Not Modified\` on \`If-None-Match\`).
- Accepts \`Authorization: Bearer <token>\` or \`?token=<token>\` so Coil, Glide, and Android Auto \`MediaDescriptionCompat\` artwork URIs load directly.
`;
}
