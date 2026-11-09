// @ts-nocheck
/**
 * Brokeify Standalone Self-Hosted Music Server, Library Manager & Audio Streaming Engine
 * - Embedded SQLite Database (`better-sqlite3`) at /data/brokeify.db
 * - Real-time `/music` watcher (`chokidar`) + deep audio tag parser (`music-metadata`)
 * - Automatic `.m3u` / `.m3u8` playlist discovery and import
 * - Non-blocking EBU R128 LUFS audio normalization engine (`ffmpeg`)
 * - Seekable HTTP 206 Partial Content audio streaming (`/api/stream/:trackId`)
 * - Companion REST API with CORS enabled for Desktop Web Player & Android / Android Auto Client
 * - Native ListenBrainz Scrobbler, MusicBrainz Auto-Tagger, and Local Downloaders (slskd, Lidarr, yt-dlp)
 */

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  DATA_DIR,
  COVERS_DIR,
  DB_PATH,
  MUSIC_DIR,
  getMusicDir,
  inspectMusicDrive,
  setMusicDirectory,
  db,
  scannerState,
  startChokidarMusicWatcher,
  runFullLibraryScan,
  indexAudioFile,
  removeAudioFileFromIndex,
  importM3uPlaylistFile,
  queryTracks,
  queryArtists,
  queryAlbums,
  queryPlaylists,
  handleStreamTrack,
  handleServeCover,
  enrichTrackFromMusicBrainz,
} from './src/server/libraryEngine.ts';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

const CONFIG_FILE_PATH = path.join(DATA_DIR, 'config.json');
const DEBUG_LOGS_FILE_PATH = path.join(DATA_DIR, 'debug-logs.json');
const MAX_SERVER_DEBUG_LOGS = 300;

function redactSecrets(text) {
  if (!text) return '';
  return String(text).replace(
    /(api[_-]?key|token|password|authorization|secret)(["'\s:=]+)([^\s"',&}]+)/gi,
    '$1$2[REDACTED]'
  );
}

function loadServerDebugLogs() {
  try {
    if (fs.existsSync(DEBUG_LOGS_FILE_PATH)) {
      const raw = fs.readFileSync(DEBUG_LOGS_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, MAX_SERVER_DEBUG_LOGS);
      }
    }
  } catch {
    // ignore corrupt debug log file
  }
  return [];
}

let serverDebugLogs = loadServerDebugLogs();

function saveServerDebugLogs() {
  try {
    fs.writeFileSync(
      DEBUG_LOGS_FILE_PATH,
      JSON.stringify(serverDebugLogs.slice(0, MAX_SERVER_DEBUG_LOGS), null, 2),
      'utf-8'
    );
  } catch {
    // ignore write errors
  }
}

function inferServerCategory(urlPath = '') {
  const lower = String(urlPath).toLowerCase();
  if (lower.includes('lidarr')) return 'lidarr';
  if (lower.includes('slskd')) return 'slskd';
  if (lower.includes('listenbrainz') || lower.includes('scrobble'))
    return 'listenbrainz';
  if (lower.includes('spotify')) return 'spotify';
  if (lower.includes('youtube')) return 'youtube';
  if (lower.includes('autopilot')) return 'autopilot';
  if (lower.includes('playback-session')) return 'playback-sync';
  if (lower.includes('stream') || lower.includes('library')) return 'audio';
  return 'system';
}

function inferServerHint(category, message = '', statusCode = 0) {
  const lower = String(message).toLowerCase();
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    lower.includes('401') ||
    lower.includes('unauthorized')
  ) {
    return `Authentication rejected (${statusCode || 401}). Check your ${category.toUpperCase()} API Key or Token in Settings.`;
  }
  if (statusCode === 404 || lower.includes('404')) {
    return `Endpoint returned 404 Not Found. Verify your ${category.toUpperCase()} base URL.`;
  }
  if (
    lower.includes('fetch failed') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('timeout') ||
    lower.includes('aborted')
  ) {
    return `Connection failed or timed out reaching ${category.toUpperCase()}. In Docker, ensure both containers share a Docker network or use your host LAN IP (e.g. http://192.168.1.x:port).`;
  }
  return 'Expand Details below to inspect the full request endpoint, status code, and payload.';
}

function pushServerLog(level, category, message, extra = {}) {
  const entry = {
    id: `srv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    level: level || 'info',
    category: category || 'system',
    source: extra.source || 'server',
    message: redactSecrets(message),
    details: extra.details ? redactSecrets(extra.details) : undefined,
    endpoint: extra.endpoint ? redactSecrets(extra.endpoint) : undefined,
    statusCode: extra.statusCode ? Number(extra.statusCode) : undefined,
    hint:
      extra.hint ||
      (level === 'error' || level === 'warn'
        ? inferServerHint(category, message, extra.statusCode)
        : undefined),
  };

  serverDebugLogs.unshift(entry);
  if (serverDebugLogs.length > MAX_SERVER_DEBUG_LOGS) {
    serverDebugLogs.length = MAX_SERVER_DEBUG_LOGS;
  }
  saveServerDebugLogs();
  return entry;
}

// Express API response & error interceptor
app.use((req, res, next) => {
  if (
    !req.path.startsWith('/api/') ||
    req.path.startsWith('/api/debug/') ||
    req.path.startsWith('/api/stream/') ||
    req.path.startsWith('/api/cover/')
  ) {
    return next();
  }
  const startedAt = Date.now();
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    const durationMs = Date.now() - startedAt;
    const status = res.statusCode || 200;
    const category = inferServerCategory(req.path);
    const endpointLabel = `${req.method} ${req.originalUrl} (${durationMs}ms)`;

    if (status >= 400 || (body && body.ok === false && !body.skipped)) {
      const errText =
        body?.error ||
        body?.message ||
        `API request failed with HTTP ${status}`;
      pushServerLog(
        status >= 500 ? 'error' : 'warn',
        category,
        `${errText}`,
        {
          endpoint: endpointLabel,
          statusCode: status,
          details: JSON.stringify(
            {
              method: req.method,
              path: req.originalUrl,
              status,
              durationMs,
              response: body,
            },
            null,
            2
          ),
        }
      );
    } else if (
      req.method !== 'GET' &&
      !req.path.includes('/playback-session') &&
      !req.path.includes('/stats/record-play') &&
      !req.path.includes('/config')
    ) {
      const summaryMsg =
        body?.message ||
        `Completed ${req.method} ${req.path} in ${durationMs}ms`;
      pushServerLog('info', category, summaryMsg, {
        endpoint: endpointLabel,
        statusCode: status,
      });
    }
    return originalJson(body);
  };

  next();
});

process.on('uncaughtException', (err) => {
  console.error('[Brokeify] Uncaught Exception:', err);
  pushServerLog(
    'error',
    'system',
    `Uncaught Server Exception: ${err?.message || String(err)}`,
    {
      details: err?.stack || String(err),
    }
  );
});

process.on('unhandledRejection', (reason) => {
  console.error('[Brokeify] Unhandled Rejection:', reason);
  pushServerLog(
    'error',
    'system',
    `Unhandled Server Promise Rejection: ${
      reason instanceof Error ? reason.message : String(reason)
    }`,
    {
      details:
        reason instanceof Error ? reason.stack : JSON.stringify(reason, null, 2),
    }
  );
});

const DEFAULT_SERVER_CONFIG = {
  version: 3,
  updatedAt: new Date().toISOString(),
  auth: {
    username: process.env.BROKEIFY_USERNAME || 'admin',
    password: process.env.BROKEIFY_PASSWORD || 'brokeify',
    apiToken: process.env.BROKEIFY_API_TOKEN || 'brokeify-standalone-token',
  },
  integrations: {
    jellyfinUrl: '',
    jellyfinToken: '',
    jellyfinUserId: '',
    jellyfinUsername: 'admin',
    requireDeviceLogin: false,
    slskdUrl: process.env.SLSKD_URL || 'http://slskd:5030',
    slskdApiKey: process.env.SLSKD_API_KEY || '',
    lidarrUrl: process.env.LIDARR_URL || 'http://lidarr:8686',
    lidarrApiKey: process.env.LIDARR_API_KEY || '',
    lidarrRootFolderPath: MUSIC_DIR,
    lidarrQualityProfileId: 1,
    lidarrMetadataProfileId: 1,
    listenbrainzUsername:
      process.env.LISTENBRAINZ_USER || process.env.LISTENBRAINZ_USERNAME || '',
    listenbrainzToken: process.env.LISTENBRAINZ_TOKEN || '',
    preferredDownloader: 'auto',
    downloadDir: MUSIC_DIR,
    youtubeAudioFormat: 'mp3',
  },
  audioPrefs: {
    eqPreset: 'Car Stereo',
    eqGains: [4.5, 2.0, -1.5, 2.5, 4.0],
    carVolumeLeveler: true,
    stabilizerStrength: 'aggressive',
    lufsNormalizationEnabled: true,
    smartAntiRepeatEnabled: true,
    crossfadeSeconds: 4,
    offlinePreloadCount: 6,
    streamBufferSeconds: 6,
    shuffleEnabled: false,
    repeatMode: 'all',
    visualTheme: 'cyber-deck',
  },
  discoveryFilters: {
    excludeLive: true,
    excludeRemix: false,
    excludeAcoustic: false,
    excludeInstrumental: true,
    excludeSpedUpSlowed: true,
    excludeCommentary: true,
    customExcludedWords: [],
    minDurationSec: 45,
    maxDurationSec: 900,
    customScriptEnabled: false,
    customScriptCode: `// Return false to EXCLUDE a song, or true to KEEP it.
// Available variables: title, artist, album, durationSec
const lower = (title + ' ' + album).toLowerCase();
if (lower.includes('karaoke') || lower.includes('tribute')) return false;
if (durationSec > 0 && (durationSec < 45 || durationSec > 900)) return false;
return true;`,
  },
  customTheme: {
    enabled: false,
    customAppName: 'BROKEIFY',
    customTagline: '',
    primaryAccent: '#00ff66',
    secondaryAccent: '#a855f7',
    customCss: '',
  },
  picardConfig: {
    enabled: true,
    folderTemplate: '{Artist}/{Album} ({Year})/{TrackNumber} - {Title}.{ext}',
    useAiMetadataCleanup: true,
    embedId3Tags: true,
    targetMusicRoot: MUSIC_DIR,
  },
  autopilotRules: [],
  playStats: {},
  providers: [],
  playlists: [],
  customPlaylistNames: {},
  pinnedPlaylistId: null,
  playbackSession: null,
};

function readServerConfig() {
  try {
    let parsed = {};
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
      parsed = JSON.parse(raw) || {};
    }

    const envIntegrations = {
      ...(process.env.SLSKD_URL ? { slskdUrl: process.env.SLSKD_URL } : {}),
      ...(process.env.SLSKD_API_KEY
        ? { slskdApiKey: process.env.SLSKD_API_KEY }
        : {}),
      ...(process.env.LIDARR_URL ? { lidarrUrl: process.env.LIDARR_URL } : {}),
      ...(process.env.LIDARR_API_KEY
        ? { lidarrApiKey: process.env.LIDARR_API_KEY }
        : {}),
      ...(process.env.LISTENBRAINZ_USER || process.env.LISTENBRAINZ_USERNAME
        ? {
            listenbrainzUsername:
              process.env.LISTENBRAINZ_USER ||
              process.env.LISTENBRAINZ_USERNAME,
          }
        : {}),
      ...(process.env.LISTENBRAINZ_TOKEN
        ? { listenbrainzToken: process.env.LISTENBRAINZ_TOKEN }
        : {}),
    };

    return {
      ...DEFAULT_SERVER_CONFIG,
      ...parsed,
      auth: {
        ...DEFAULT_SERVER_CONFIG.auth,
        ...(parsed.auth || {}),
      },
      integrations: {
        ...DEFAULT_SERVER_CONFIG.integrations,
        ...(parsed.integrations || {}),
        ...envIntegrations,
        requireDeviceLogin: false,
        downloadDir:
          parsed.integrations?.downloadDir &&
          parsed.integrations.downloadDir !== '/app/downloads'
            ? parsed.integrations.downloadDir
            : MUSIC_DIR,
      },
      audioPrefs: {
        ...DEFAULT_SERVER_CONFIG.audioPrefs,
        ...(parsed.audioPrefs || {}),
      },
      discoveryFilters: {
        ...DEFAULT_SERVER_CONFIG.discoveryFilters,
        ...(parsed.discoveryFilters || {}),
      },
      customTheme: {
        ...DEFAULT_SERVER_CONFIG.customTheme,
        ...(parsed.customTheme || {}),
      },
      picardConfig: {
        ...DEFAULT_SERVER_CONFIG.picardConfig,
        ...(parsed.picardConfig || {}),
      },
      autopilotRules: Array.isArray(parsed.autopilotRules)
        ? parsed.autopilotRules
        : [],
      playStats:
        parsed.playStats && typeof parsed.playStats === 'object'
          ? parsed.playStats
          : {},
      customPlaylistNames: {
        ...(parsed.customPlaylistNames || {}),
      },
      playbackSession:
        parsed.playbackSession && typeof parsed.playbackSession === 'object'
          ? parsed.playbackSession
          : null,
    };
  } catch (err) {
    console.error('[Brokeify] Failed to read config.json:', err);
  }
  return structuredClone(DEFAULT_SERVER_CONFIG);
}

function writeServerConfig(nextConfig) {
  try {
    const current = readServerConfig();
    const merged = {
      ...current,
      ...nextConfig,
      updatedAt: new Date().toISOString(),
    };
    if (nextConfig.integrations) {
      merged.integrations = {
        ...current.integrations,
        ...nextConfig.integrations,
      };
    }
    if (nextConfig.audioPrefs) {
      merged.audioPrefs = {
        ...current.audioPrefs,
        ...nextConfig.audioPrefs,
      };
    }
    if (nextConfig.discoveryFilters) {
      merged.discoveryFilters = {
        ...current.discoveryFilters,
        ...nextConfig.discoveryFilters,
      };
    }
    if (nextConfig.customTheme) {
      merged.customTheme = {
        ...current.customTheme,
        ...nextConfig.customTheme,
      };
    }
    if (nextConfig.picardConfig) {
      merged.picardConfig = {
        ...current.picardConfig,
        ...nextConfig.picardConfig,
      };
    }
    if (Array.isArray(nextConfig.autopilotRules)) {
      merged.autopilotRules = nextConfig.autopilotRules;
    }
    if (nextConfig.playStats && typeof nextConfig.playStats === 'object') {
      merged.playStats = {
        ...current.playStats,
        ...nextConfig.playStats,
      };
    }
    if (nextConfig.customPlaylistNames) {
      merged.customPlaylistNames = {
        ...current.customPlaylistNames,
        ...nextConfig.customPlaylistNames,
      };
    }

    const dir = path.dirname(CONFIG_FILE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const tempPath = `${CONFIG_FILE_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(merged, null, 2), 'utf-8');
    fs.renameSync(tempPath, CONFIG_FILE_PATH);
    return merged;
  } catch (err) {
    console.error('[Brokeify] Failed to write config.json:', err);
    throw err;
  }
}

if (!fs.existsSync(CONFIG_FILE_PATH)) {
  try {
    writeServerConfig(DEFAULT_SERVER_CONFIG);
  } catch {}
}

function normalizeText(str = '') {
  return String(str)
    .toLowerCase()
    .replace(
      /\((feat|ft|featuring|radio|explicit|clean|remaster|version|edit)[^)]*\)/gi,
      ' '
    )
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getLocalLibraryStats() {
  const totalTracks = (
    db.prepare(`SELECT COUNT(*) as c FROM tracks`).get() as { c: number }
  ).c;
  const totalAlbums = (
    db.prepare(`SELECT COUNT(*) as c FROM albums`).get() as { c: number }
  ).c;
  const totalArtists = (
    db.prepare(`SELECT COUNT(*) as c FROM artists`).get() as { c: number }
  ).c;
  const totalPlaylists = (
    db.prepare(`SELECT COUNT(*) as c FROM playlists`).get() as { c: number }
  ).c;
  const totalScrobbles = (
    db.prepare(`SELECT COUNT(*) as c FROM scrobbles`).get() as { c: number }
  ).c;
  return {
    totalTracks,
    totalAlbums,
    totalArtists,
    totalPlaylists,
    totalScrobbles,
  };
}

function getSqliteAudioFingerprints() {
  const tracks = queryTracks();
  return tracks.map((t) => ({
    id: t.id,
    rawId: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    normTitle: normalizeText(t.title),
    normArtist: normalizeText(t.artist),
  }));
}

// ============================================================================
// 1. STANDALONE COMPANION REST API FOR ANDROID, ANDROID AUTO & WEB PLAYER
// ============================================================================

// GET /api/health -> Returns server status, version, drive connection status, and total indexed track/album/artist counts
app.get('/api/health', (_req, res) => {
  const counts = getLocalLibraryStats();
  const driveStatus = inspectMusicDrive();
  res.json({
    ok: true,
    status: 'ok',
    mode: 'standalone',
    server: 'Brokeify Native Engine',
    version: '3.0.0-standalone',
    totalTracks: counts.totalTracks,
    totalAlbums: counts.totalAlbums,
    totalArtists: counts.totalArtists,
    totalPlaylists: counts.totalPlaylists,
    totalScrobbles: counts.totalScrobbles,
    musicDir: getMusicDir(),
    dbPath: DB_PATH,
    coversDir: COVERS_DIR,
    scanner: scannerState,
    driveStatus,
  });
});

// GET /api/storage/drive-status -> Inspects current mounted music drive / NAS folder
app.get('/api/storage/drive-status', (_req, res) => {
  const driveStatus = inspectMusicDrive();
  const counts = getLocalLibraryStats();
  res.json({
    ok: true,
    ...driveStatus,
    ...counts,
  });
});

// POST /api/storage/test-drive -> Tests any local or NAS folder path before saving
app.post('/api/storage/test-drive', (req, res) => {
  const customPath = String(
    req.body?.path || req.body?.musicDir || getMusicDir()
  ).trim();
  const driveStatus = inspectMusicDrive(customPath);
  res.json({
    ok: driveStatus.exists && driveStatus.readable,
    ...driveStatus,
  });
});

// POST /api/storage/connect-drive -> Saves a new music drive / NAS folder path, restarts Chokidar watcher, and scans immediately
app.post('/api/storage/connect-drive', async (req, res) => {
  try {
    const newPath = String(
      req.body?.path || req.body?.musicDir || getMusicDir()
    ).trim();
    if (!newPath) {
      return res.status(400).json({
        ok: false,
        error: 'Please enter a valid folder path (e.g. /music or /mnt/nas/music).',
      });
    }

    const cfg = readServerConfig();
    writeServerConfig({
      ...cfg,
      integrations: {
        ...cfg.integrations,
        downloadDir: newPath,
        lidarrRootFolderPath: newPath,
      },
      picardConfig: {
        ...cfg.picardConfig,
        targetMusicRoot: newPath,
      },
    });

    const driveStatus = await setMusicDirectory(newPath);
    const counts = getLocalLibraryStats();

    return res.json({
      ok: true,
      ...driveStatus,
      ...counts,
      message: driveStatus.driveConnected
        ? `✅ Connected to "${newPath}"! Indexed ${counts.totalTracks} tracks across ${counts.totalAlbums} albums.`
        : driveStatus.statusMessage,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to update music drive path.',
    });
  }
});

// POST /api/auth/login -> Authenticates client and returns session token
app.post('/api/auth/login', (req, res) => {
  const cfg = readServerConfig();
  const username = String(
    req.body?.username || cfg.auth?.username || 'admin'
  ).trim();
  const password = String(req.body?.password || '').trim();
  const expectedPass = String(cfg.auth?.password || 'brokeify').trim();

  if (
    password &&
    password !== expectedPass &&
    password !== cfg.auth?.apiToken
  ) {
    return res.status(401).json({
      ok: false,
      error: 'Invalid Brokeify server credentials.',
    });
  }

  const token =
    cfg.auth?.apiToken ||
    crypto.createHash('sha256').update(`${username}:brokeify`).digest('hex');

  return res.json({
    ok: true,
    token,
    user: {
      id: 'usr-brokeify-admin',
      username,
      role: 'admin',
    },
    server: 'Brokeify Native Engine',
    mode: 'standalone',
  });
});

// Helper to detect host LAN IPv4 address for Android QR code pairing
function detectLanIpv4(): string {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          if (
            net.address.startsWith('192.168.') ||
            net.address.startsWith('10.') ||
            net.address.startsWith('100.')
          ) {
            return net.address;
          }
        }
      }
    }
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch {
    // ignore
  }
  return '192.168.1.175';
}

interface PairedAndroidDevice {
  id: string;
  deviceName: string;
  model: string;
  clientIp: string;
  connectedAt: string;
}

const pairedAndroidDevices: PairedAndroidDevice[] = [];

const TEMP_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
let activeTempPairingToken: { token: string; expiresAt: number } | null = null;

function ensureTempPairingToken(forceNew = false): {
  token: string;
  expiresAt: string;
  expiresInSeconds: number;
} {
  const now = Date.now();
  if (
    forceNew ||
    !activeTempPairingToken ||
    activeTempPairingToken.expiresAt <= now + 30_000
  ) {
    activeTempPairingToken = {
      token: `pair_${crypto.randomBytes(12).toString('hex')}`,
      expiresAt: now + TEMP_TOKEN_TTL_MS,
    };
  }
  return {
    token: activeTempPairingToken.token,
    expiresAt: new Date(activeTempPairingToken.expiresAt).toISOString(),
    expiresInSeconds: Math.max(
      0,
      Math.round((activeTempPairingToken.expiresAt - now) / 1000)
    ),
  };
}

function ensureMobileApiToken(forceNew = false): string {
  const cfg = readServerConfig();
  let currentToken = String(cfg.auth?.apiToken || '').trim();
  if (
    forceNew ||
    !currentToken ||
    currentToken === 'brokeify-standalone-token'
  ) {
    currentToken = `brk_${crypto.randomBytes(16).toString('hex')}`;
    writeServerConfig({
      ...cfg,
      auth: {
        ...(cfg.auth || { username: 'admin', password: 'brokeify' }),
        apiToken: currentToken,
      },
    });
  }
  return currentToken;
}

// GET /api/mobile/pair-info -> Returns QR pairing payload, LAN IP, temporary connection token, API token, and connected Android devices
app.get('/api/mobile/pair-info', (req, res) => {
  const apiToken = ensureMobileApiToken(false);
  const tempInfo = ensureTempPairingToken(false);
  const port = Number(process.env.PORT || 3487);
  const lanIp = detectLanIpv4();
  const lanUrl = `http://${lanIp}:${port}`;
  const proto =
    String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(
      ','
    )[0];
  const host = String(
    req.headers['x-forwarded-host'] || req.headers.host || `${lanIp}:${port}`
  ).split(',')[0];
  const detectedOriginUrl = `${proto}://${host}`;
  const counts = getLocalLibraryStats();
  const driveStatus = inspectMusicDrive();

  res.json({
    ok: true,
    app: 'brokeify',
    version: '3.0.0-standalone',
    serverUrl: detectedOriginUrl,
    localUrl: lanUrl,
    lanUrl,
    port,
    token: tempInfo.token,
    tempToken: tempInfo.token,
    expiresAt: tempInfo.expiresAt,
    expiresInSeconds: tempInfo.expiresInSeconds,
    apiKey: apiToken,
    libraryStats: counts,
    driveStatus,
    pairedDevices: pairedAndroidDevices,
    endpoints: {
      verify: '/api/mobile/verify',
      health: '/api/health',
      tracks: '/api/library/tracks',
      albums: '/api/library/albums',
      artists: '/api/library/artists',
      playlists: '/api/playlists',
      search: '/api/search?q={query}',
      stream: '/api/stream/{trackId}',
      cover: '/api/covers/{albumId}',
      scrobble: '/api/scrobble',
    },
  });
});

// POST /api/mobile/regenerate-token -> Rotates the temporary connection token (and optionally the API key)
app.post('/api/mobile/regenerate-token', (req, res) => {
  const rotatePermanent = Boolean(req.body?.rotateApiKey);
  const apiToken = ensureMobileApiToken(rotatePermanent);
  const tempInfo = ensureTempPairingToken(true);
  res.json({
    ok: true,
    token: tempInfo.token,
    tempToken: tempInfo.token,
    expiresAt: tempInfo.expiresAt,
    expiresInSeconds: tempInfo.expiresInSeconds,
    apiKey: apiToken,
    message: 'Generated new temporary connection token!',
  });
});

// GET or POST /api/mobile/verify -> Called by the Android app after scanning the QR code to verify connection
app.all('/api/mobile/verify', (req, res) => {
  const expectedApiKey = ensureMobileApiToken(false);
  const currentTemp = ensureTempPairingToken(false);
  const authHeader = String(req.headers.authorization || '').replace(
    /^Bearer\s+/i,
    ''
  );
  const providedToken = String(
    authHeader ||
      req.headers['x-api-key'] ||
      req.query.token ||
      req.query.tempToken ||
      req.query.apiKey ||
      req.body?.token ||
      req.body?.tempToken ||
      req.body?.apiKey ||
      ''
  ).trim();

  if (
    providedToken &&
    providedToken !== expectedApiKey &&
    providedToken !== currentTemp.token
  ) {
    return res.status(401).json({
      ok: false,
      error:
        'Invalid or expired Brokeify connection token. Please re-scan the QR code.',
    });
  }

  const deviceName = String(
    req.body?.deviceName ||
      req.query.deviceName ||
      req.headers['x-device-name'] ||
      'Android Phone'
  ).trim();
  const model = String(
    req.body?.model ||
      req.query.model ||
      req.headers['user-agent'] ||
      'Brokeify Android Client'
  )
    .slice(0, 80)
    .trim();
  const clientIp = String(
    req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'
  )
    .split(',')[0]
    .trim();

  const existingIdx = pairedAndroidDevices.findIndex(
    (d) => d.deviceName === deviceName && d.clientIp === clientIp
  );
  const deviceRecord: PairedAndroidDevice = {
    id: `android-${Date.now().toString(36)}`,
    deviceName,
    model,
    clientIp,
    connectedAt: new Date().toISOString(),
  };
  if (existingIdx >= 0) {
    pairedAndroidDevices[existingIdx] = deviceRecord;
  } else {
    pairedAndroidDevices.unshift(deviceRecord);
    if (pairedAndroidDevices.length > 10) pairedAndroidDevices.pop();
  }

  const counts = getLocalLibraryStats();
  return res.json({
    ok: true,
    authenticated: true,
    server: 'Brokeify Native Engine',
    version: '3.0.0-standalone',
    apiKey: expectedApiKey,
    device: deviceRecord,
    libraryStats: counts,
    endpoints: {
      tracks: '/api/library/tracks',
      albums: '/api/library/albums',
      artists: '/api/library/artists',
      playlists: '/api/playlists',
      stream: '/api/stream/{trackId}',
      cover: '/api/covers/{albumId}',
      scrobble: '/api/scrobble',
    },
  });
});

// GET /api/library/artists -> Returns all indexed artists
app.get('/api/library/artists', (req, res) => {
  const search = String(req.query.search || req.query.q || '').trim();
  const artists = queryArtists(search);
  res.json({
    ok: true,
    total: artists.length,
    artists,
  });
});

// GET /api/library/albums -> Returns all albums (filterable by ?artistId= and ?search=)
app.get('/api/library/albums', (req, res) => {
  const artistId = String(req.query.artistId || '').trim() || undefined;
  const search =
    String(req.query.search || req.query.q || '').trim() || undefined;
  const albums = queryAlbums({ artistId, search });
  res.json({
    ok: true,
    total: albums.length,
    albums,
  });
});

// GET /api/library/tracks -> Returns tracks (filterable by ?albumId=, ?artistId=, or ?search=)
app.get('/api/library/tracks', (req, res) => {
  const albumId = String(req.query.albumId || '').trim() || undefined;
  const artistId = String(req.query.artistId || '').trim() || undefined;
  const search =
    String(req.query.search || req.query.q || '').trim() || undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const tracks = queryTracks({ albumId, artistId, search, limit });
  res.json({
    ok: true,
    total: tracks.length,
    tracks,
  });
});

// POST /api/library/rescan -> Triggers a full recursive scan of /music and .m3u/.m3u8 import
app.post('/api/library/rescan', async (_req, res) => {
  try {
    const scanResult = await runFullLibraryScan();
    const counts = getLocalLibraryStats();
    res.json({
      ok: true,
      ...scanResult,
      ...counts,
      musicDir: MUSIC_DIR,
      dbPath: DB_PATH,
      message: `Scanned ${MUSIC_DIR}: indexed ${counts.totalTracks} tracks across ${counts.totalAlbums} albums & ${counts.totalArtists} artists (${counts.totalPlaylists} playlists).`,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error:
        err instanceof Error ? err.message : 'Failed to rescan /music folder.',
    });
  }
});

// GET /api/search?q= -> Global fuzzy search across artists, albums, tracks, and playlists
app.get('/api/search', (req, res) => {
  const q = String(req.query.q || req.query.search || '').trim();
  if (!q) {
    return res.json({
      ok: true,
      query: '',
      artists: [],
      albums: [],
      tracks: [],
      playlists: [],
    });
  }
  const artists = queryArtists(q);
  const albums = queryAlbums({ search: q });
  const tracks = queryTracks({ search: q, limit: 100 });
  const lowerQ = q.toLowerCase();
  const playlists = queryPlaylists().filter(
    (p) =>
      p.name.toLowerCase().includes(lowerQ) ||
      p.description.toLowerCase().includes(lowerQ)
  );

  res.json({
    ok: true,
    query: q,
    artists,
    albums,
    tracks,
    playlists,
  });
});

// ============================================================================
// 2. SQLITE PLAYLIST CRUD API (/api/playlists)
// ============================================================================

app.get('/api/playlists', (_req, res) => {
  const playlists = queryPlaylists();
  res.json({
    ok: true,
    total: playlists.length,
    playlists,
  });
});

app.get('/api/playlists/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  const playlists = queryPlaylists();
  const playlist = playlists.find((p) => p.id === id);
  if (!playlist) {
    return res.status(404).json({ ok: false, error: 'Playlist not found' });
  }
  const allTracksMap = new Map(queryTracks().map((t) => [t.id, t]));
  const tracks = playlist.trackIds
    .map((tid) => allTracksMap.get(tid))
    .filter(Boolean);

  res.json({
    ok: true,
    playlist: {
      ...playlist,
      tracks,
    },
  });
});

app.post('/api/playlists', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res
        .status(400)
        .json({ ok: false, error: 'Playlist name is required.' });
    }
    const id =
      String(req.body?.id || '').trim() ||
      `pl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const description = String(
      req.body?.description || 'Custom Brokeify SQLite Playlist'
    ).trim();
    const isSmart = req.body?.isSmart ? 1 : 0;
    const smartRulesJson = req.body?.smartRules
      ? JSON.stringify(req.body.smartRules)
      : null;
    const trackIds = Array.isArray(req.body?.trackIds)
      ? req.body.trackIds.map(String)
      : [];
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO playlists (id, name, description, cover_path, is_smart, smart_rules_json, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         is_smart = excluded.is_smart,
         smart_rules_json = excluded.smart_rules_json,
         updated_at = excluded.updated_at`
    ).run(id, name, description, isSmart, smartRulesJson, now, now);

    const syncTracksTx = db.transaction((ids: string[]) => {
      db.prepare(`DELETE FROM playlist_tracks WHERE playlist_id = ?`).run(id);
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`
      );
      ids.forEach((tid, idx) => {
        const exists = db
          .prepare(`SELECT 1 FROM tracks WHERE id = ?`)
          .get(tid);
        if (exists) {
          stmt.run(id, tid, idx);
        }
      });
    });
    syncTracksTx(trackIds);

    const created = queryPlaylists().find((p) => p.id === id);
    res.json({
      ok: true,
      playlist: created,
      playlists: queryPlaylists(),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to create playlist.',
    });
  }
});

app.put('/api/playlists/:id', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const existing = db
      .prepare(`SELECT * FROM playlists WHERE id = ?`)
      .get(id) as Record<string, any> | undefined;
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Playlist not found.' });
    }

    const name =
      req.body?.name !== undefined
        ? String(req.body.name).trim()
        : existing.name;
    const description =
      req.body?.description !== undefined
        ? String(req.body.description).trim()
        : existing.description;
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE playlists SET name = ?, description = ?, updated_at = ? WHERE id = ?`
    ).run(name, description, now, id);

    if (Array.isArray(req.body?.trackIds)) {
      const trackIds = req.body.trackIds.map(String);
      const syncTracksTx = db.transaction((ids: string[]) => {
        db.prepare(`DELETE FROM playlist_tracks WHERE playlist_id = ?`).run(id);
        const stmt = db.prepare(
          `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`
        );
        ids.forEach((tid, idx) => {
          const exists = db
            .prepare(`SELECT 1 FROM tracks WHERE id = ?`)
            .get(tid);
          if (exists) {
            stmt.run(id, tid, idx);
          }
        });
      });
      syncTracksTx(trackIds);
    }

    const updated = queryPlaylists().find((p) => p.id === id);
    res.json({
      ok: true,
      playlist: updated,
      playlists: queryPlaylists(),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to update playlist.',
    });
  }
});

app.delete('/api/playlists/:id', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    db.prepare(`DELETE FROM playlist_tracks WHERE playlist_id = ?`).run(id);
    db.prepare(`DELETE FROM playlists WHERE id = ?`).run(id);
    res.json({
      ok: true,
      deletedId: id,
      playlists: queryPlaylists(),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to delete playlist.',
    });
  }
});

// ============================================================================
// 3. SEEKABLE HTTP 206 AUDIO STREAMING & CACHED COVER ART
// ============================================================================

app.get('/api/stream/:trackId', (req, res) => {
  return handleStreamTrack(req, res);
});

app.get('/api/cover/:type/:id', (req, res) => {
  return handleServeCover(req, res);
});

// ============================================================================
// 4. TRACK DISK CLEANUP & MAINTAINERR DUPLICATE JANITOR (SQLite + /music)
// ============================================================================

function deleteTrackFromDiskAndDb(rawId: string): boolean {
  const cleanId = String(rawId || '').trim();
  if (!cleanId) return false;

  const row = db
    .prepare(`SELECT id, file_path FROM tracks WHERE id = ?`)
    .get(cleanId) as { id: string; file_path: string } | undefined;

  if (!row) return false;

  try {
    if (row.file_path && fs.existsSync(row.file_path)) {
      fs.unlinkSync(row.file_path);
    }
  } catch {
    // ignore unlink error if read-only
  }

  removeAudioFileFromIndex(row.file_path);
  db.prepare(`DELETE FROM tracks WHERE id = ?`).run(cleanId);
  return true;
}

app.delete('/api/library/tracks/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  const ok = deleteTrackFromDiskAndDb(id);
  if (!ok) {
    return res
      .status(404)
      .json({ ok: false, error: 'Track not found in SQLite database.' });
  }
  return res.json({
    ok: true,
    deletedId: id,
    message: `Permanently deleted track ${id} from /music and SQLite index.`,
  });
});

app.post('/api/library/tracks/bulk-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids
    : Array.isArray(req.body?.itemIds)
      ? req.body.itemIds
      : [];

  const deletedIds: string[] = [];
  const failedIds: string[] = [];

  for (const rawId of ids) {
    if (deleteTrackFromDiskAndDb(String(rawId))) {
      deletedIds.push(String(rawId));
    } else {
      failedIds.push(String(rawId));
    }
  }

  return res.json({
    ok: true,
    deletedIds,
    failedIds,
    message: `Deleted ${deletedIds.length} track(s) from /music disk & SQLite database.`,
  });
});

// Backward-compatible aliases so existing frontend Maintainerr cleanup buttons work seamlessly
app.delete('/api/jellyfin/items/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  const ok = deleteTrackFromDiskAndDb(id);
  return res.json({
    ok,
    deletedId: id,
    message: ok
      ? `Deleted track ${id} from local /music storage.`
      : 'Track not found in local SQLite database.',
  });
});

app.post('/api/jellyfin/items/bulk-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids
    : Array.isArray(req.body?.itemIds)
      ? req.body.itemIds
      : [];
  const deletedIds: string[] = [];
  const failedIds: string[] = [];
  for (const rawId of ids) {
    if (deleteTrackFromDiskAndDb(String(rawId))) {
      deletedIds.push(String(rawId));
    } else {
      failedIds.push(String(rawId));
    }
  }
  return res.json({
    ok: true,
    deletedIds,
    failedIds,
    message: `Deleted ${deletedIds.length} track(s) from local /music storage.`,
  });
});

app.post('/api/jellyfin/refresh', async (_req, res) => {
  const scanResult = await runFullLibraryScan();
  return res.json({
    ok: true,
    status: 200,
    ...scanResult,
    message: `Rescanned /music directory (${scanResult.indexedTracks} tracks indexed).`,
  });
});

// ============================================================================
// 5. PERSISTENT SERVER-SIDE STORAGE (/api/config & /api/config/backup)
// ============================================================================

app.get('/api/config', (_req, res) => {
  const config = readServerConfig();
  const sqlPlaylists = queryPlaylists();
  res.json({
    ok: true,
    configPath: CONFIG_FILE_PATH,
    dbPath: DB_PATH,
    musicDir: MUSIC_DIR,
    config: {
      ...config,
      playlists:
        sqlPlaylists.length > 0 ? sqlPlaylists : config.playlists || [],
    },
  });
});

app.post('/api/config', (req, res) => {
  try {
    const incoming = req.body?.config || req.body || {};
    const saved = writeServerConfig(incoming);

    // Sync any incoming custom playlists into the SQLite playlists table as well
    if (Array.isArray(incoming.playlists)) {
      const now = new Date().toISOString();
      for (const pl of incoming.playlists) {
        if (!pl || !pl.id || !pl.name) continue;
        db.prepare(
          `INSERT INTO playlists (id, name, description, cover_path, is_smart, smart_rules_json, created_at, updated_at)
           VALUES (?, ?, ?, NULL, 0, NULL, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             description = excluded.description,
             updated_at = excluded.updated_at`
        ).run(
          String(pl.id),
          String(pl.name),
          String(pl.description || ''),
          String(pl.createdAt || now),
          now
        );

        if (Array.isArray(pl.trackIds)) {
          const syncTx = db.transaction((tids: string[]) => {
            db.prepare(
              `DELETE FROM playlist_tracks WHERE playlist_id = ?`
            ).run(String(pl.id));
            const ins = db.prepare(
              `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`
            );
            tids.forEach((tid, idx) => {
              const exists = db
                .prepare(`SELECT 1 FROM tracks WHERE id = ?`)
                .get(String(tid));
              if (exists) {
                ins.run(String(pl.id), String(tid), idx);
              }
            });
          });
          syncTx(pl.trackIds);
        }
      }
    }

    res.json({
      ok: true,
      configPath: CONFIG_FILE_PATH,
      config: saved,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to save config.json',
    });
  }
});

app.get('/api/config/backup', (_req, res) => {
  const config = readServerConfig();
  const filename = `brokeify-config-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(config, null, 2));
});

// ============================================================================
// 6. NATIVE LISTENBRAINZ DISCOVERY & SQLITE SCROBBLING ENGINE
// ============================================================================

async function handleScrobbleSubmission(req, res) {
  try {
    const cfg = readServerConfig();
    const token = String(
      req.body?.token || cfg.integrations?.listenbrainzToken || ''
    ).trim();

    const listenType =
      req.body?.listenType === 'playing_now' ? 'playing_now' : 'single';
    const track = req.body?.track || {
      id: req.body?.trackId,
      title: req.body?.title,
      artist: req.body?.artist,
      album: req.body?.album,
      duration: req.body?.duration,
    };

    const trackId = String(track.id || req.body?.trackId || '').trim();
    const nowIso = new Date().toISOString();
    const unixTs = Math.floor(Date.now() / 1000);

    // 1. Update local SQLite play_count, last_played_at, and scrobbles table
    let resolvedTrack = track;
    if (trackId) {
      const dbTrack = db
        .prepare(
          `SELECT t.id, t.title, t.duration_ms, COALESCE(ar.name, 'Unknown Artist') AS artist, COALESCE(al.title, 'Singles') AS album
           FROM tracks t
           LEFT JOIN artists ar ON t.artist_id = ar.id
           LEFT JOIN albums al ON t.album_id = al.id
           WHERE t.id = ?`
        )
        .get(trackId) as any;

      if (dbTrack) {
        resolvedTrack = {
          id: dbTrack.id,
          title: track.title || dbTrack.title,
          artist: track.artist || dbTrack.artist,
          album: track.album || dbTrack.album,
          duration:
            track.duration || Math.round((dbTrack.duration_ms || 180000) / 1000),
        };
        if (listenType === 'single') {
          db.prepare(
            `UPDATE tracks SET play_count = COALESCE(play_count, 0) + 1, last_played_at = ? WHERE id = ?`
          ).run(nowIso, dbTrack.id);
        }
      }
    }

    let syncedToLb = 0;
    let lbResponseData: any = null;

    // 2. Forward to ListenBrainz if token is configured
    if (token && resolvedTrack.title && resolvedTrack.artist) {
      const trackMetadata = {
        artist_name: resolvedTrack.artist,
        track_name: resolvedTrack.title,
        release_name: resolvedTrack.album || undefined,
        additional_info: {
          submission_client: 'Brokeify Standalone Server',
          submission_client_version: '3.0.0',
          music_service: 'brokeify-standalone',
          duration_ms: resolvedTrack.duration
            ? Math.round(Number(resolvedTrack.duration) * 1000)
            : undefined,
        },
      };

      const payloadEntry =
        listenType === 'playing_now'
          ? { track_metadata: trackMetadata }
          : {
              listened_at: unixTs,
              track_metadata: trackMetadata,
            };

      try {
        const lbResp = await fetch(
          'https://api.listenbrainz.org/1/submit-listens',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Token ${token}`,
              'User-Agent':
                'BrokeifyStandalone/3.0 (https://github.com/Mr-Nickey/brokeify)',
            },
            body: JSON.stringify({
              listen_type: listenType,
              payload: [payloadEntry],
            }),
          }
        );
        syncedToLb = lbResp.ok ? 1 : 0;
        lbResponseData = await lbResp.json().catch(() => ({}));
      } catch {
        syncedToLb = 0;
      }
    }

    // 3. Record scrobble row in SQLite `scrobbles` table
    if (listenType === 'single' && trackId) {
      const exists = db
        .prepare(`SELECT 1 FROM tracks WHERE id = ?`)
        .get(trackId);
      if (exists) {
        const scrobbleId = `scr-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        db.prepare(
          `INSERT INTO scrobbles (id, track_id, timestamp, synced_listenbrainz) VALUES (?, ?, ?, ?)`
        ).run(scrobbleId, trackId, unixTs, syncedToLb);
      }
    }

    return res.json({
      ok: true,
      listenType,
      syncedListenBrainz: Boolean(syncedToLb),
      response: lbResponseData,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Scrobble submission failed.',
    });
  }
}

app.post('/api/playback/scrobble', handleScrobbleSubmission);
app.post('/api/listenbrainz/scrobble', handleScrobbleSubmission);

app.get('/api/listenbrainz/discover', async (req, res) => {
  try {
    const cfg = readServerConfig();
    const username = String(
      req.query.username || cfg.integrations?.listenbrainzUsername || ''
    ).trim();
    const lbToken = String(cfg.integrations?.listenbrainzToken || '').trim();

    if (!username) {
      return res.json({
        ok: false,
        username: '',
        error:
          'Enter your ListenBrainz username above or in Settings to load your Weekly Exploration and Weekly Jams playlists.',
        playlists: [],
      });
    }

    const lbHeaders: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent':
        'BrokeifyStandalone/3.0 (https://github.com/Mr-Nickey/brokeify)',
    };
    if (lbToken) {
      lbHeaders['Authorization'] = `Token ${lbToken}`;
    }

    const createdForUrl = `https://api.listenbrainz.org/1/user/${encodeURIComponent(
      username
    )}/playlists/createdfor?count=10`;
    const listResp = await fetch(createdForUrl, { headers: lbHeaders });
    if (!listResp.ok) {
      return res.status(listResp.status).json({
        ok: false,
        username,
        error: `ListenBrainz returned HTTP ${listResp.status} for user "${username}".`,
        playlists: [],
      });
    }

    const listData = await listResp.json();
    const rawPlaylists = Array.isArray(listData?.playlists)
      ? listData.playlists
      : [];

    const localLibrary = getSqliteAudioFingerprints();
    const detailedPlaylists = [];

    for (const entry of rawPlaylists.slice(0, 6)) {
      const plSummary = entry?.playlist;
      if (!plSummary?.identifier) continue;

      const mbidMatch = String(plSummary.identifier).match(/([a-f0-9-]{36})$/i);
      const playlistMbid = mbidMatch ? mbidMatch[1] : null;
      if (!playlistMbid) continue;

      try {
        const plResp = await fetch(
          `https://api.listenbrainz.org/1/playlist/${playlistMbid}`,
          { headers: lbHeaders }
        );
        if (!plResp.ok) continue;
        const plData = await plResp.json();
        const fullPl = plData?.playlist;
        if (!fullPl) continue;

        const tracksRaw = Array.isArray(fullPl.track) ? fullPl.track : [];
        const tracks = tracksRaw.map((t, index) => {
          const title = t.title || 'Unknown Title';
          const artist = t.creator || 'Unknown Artist';
          const album = t.album || '';
          const normT = normalizeText(title);
          const normA = normalizeText(artist);

          const matchedLocal = localLibrary.find(
            (loc) =>
              loc.normTitle &&
              normT &&
              (loc.normTitle === normT ||
                loc.normTitle.includes(normT) ||
                normT.includes(loc.normTitle)) &&
              (!normA ||
                !loc.normArtist ||
                loc.normArtist.includes(normA) ||
                normA.includes(loc.normArtist))
          );

          return {
            id: `lb-${playlistMbid}-${index}`,
            title,
            artist,
            album,
            durationMs: t.duration || 210000,
            inLibrary: Boolean(matchedLocal),
            jellyfinTrackId: matchedLocal?.id || null,
          };
        });

        detailedPlaylists.push({
          id: playlistMbid,
          title: fullPl.title || plSummary.title || 'ListenBrainz Mix',
          annotation:
            fullPl.annotation ||
            plSummary.annotation ||
            `Created for ${username} by ListenBrainz`,
          date: fullPl.date || plSummary.date || '',
          trackCount: tracks.length,
          inLibraryCount: tracks.filter((t) => t.inLibrary).length,
          missingCount: tracks.filter((t) => !t.inLibrary).length,
          tracks,
        });
      } catch {
        // skip failed individual playlist
      }
    }

    return res.json({
      ok: true,
      username,
      playlists: detailedPlaylists,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to fetch ListenBrainz discovery playlists.',
      playlists: [],
    });
  }
});

// ============================================================================
// 7. MUSICBRAINZ SEARCH, ALBUM RESOLVER & TAG ENRICHER
// ============================================================================

const MB_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'BrokeifyStandalone/3.0.0 ( https://github.com/Mr-Nickey/brokeify )',
};

app.post('/api/musicbrainz/enrich/:trackId', async (req, res) => {
  try {
    const trackId = String(req.params.trackId || '').trim();
    const result = await enrichTrackFromMusicBrainz(trackId);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      message:
        err instanceof Error ? err.message : 'MusicBrainz enrichment failed.',
    });
  }
});

app.get('/api/musicbrainz/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const type = String(req.query.type || 'album').toLowerCase();
    if (!q) {
      return res.json({ ok: true, results: [] });
    }

    if (type === 'track' || type === 'recording') {
      const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(
        q
      )}&limit=18&fmt=json`;
      const resp = await fetch(url, { headers: MB_HEADERS });
      if (!resp.ok) {
        return res.status(resp.status).json({
          ok: false,
          error: `MusicBrainz HTTP ${resp.status}`,
          results: [],
        });
      }
      const data = await resp.json();
      const recordings = Array.isArray(data?.recordings) ? data.recordings : [];
      const results = recordings.map((rec) => {
        const artist =
          rec['artist-credit']?.[0]?.name ||
          rec['artist-credit']?.[0]?.artist?.name ||
          'Unknown Artist';
        const release = rec.releases?.[0];
        return {
          id: rec.id,
          type: 'track',
          title: rec.title,
          artist,
          album: release?.title || 'Single',
          releaseId: release?.id || null,
          year: (release?.date || '').slice(0, 4),
          durationSec: rec.length ? Math.round(rec.length / 1000) : 210,
          coverUrl: release?.id
            ? `https://coverartarchive.org/release/${release.id}/front-250`
            : '',
        };
      });
      return res.json({ ok: true, type: 'track', results });
    }

    const url = `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(
      q
    )}%20AND%20primarytype:album&limit=15&fmt=json`;
    const resp = await fetch(url, { headers: MB_HEADERS });
    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        error: `MusicBrainz HTTP ${resp.status}`,
        results: [],
      });
    }
    const data = await resp.json();
    const groups = Array.isArray(data?.['release-groups'])
      ? data['release-groups']
      : [];
    const results = groups.map((rg) => {
      const artist =
        rg['artist-credit']?.[0]?.name ||
        rg['artist-credit']?.[0]?.artist?.name ||
        'Unknown Artist';
      return {
        id: rg.id,
        type: 'album',
        title: rg.title,
        artist,
        album: rg.title,
        year: (rg['first-release-date'] || '').slice(0, 4),
        primaryType: rg['primary-type'] || 'Album',
        coverUrl: `https://coverartarchive.org/release-group/${rg.id}/front-250`,
      };
    });
    return res.json({ ok: true, type: 'album', results });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'MusicBrainz search failed.',
      results: [],
    });
  }
});

app.get('/api/musicbrainz/album/:releaseGroupId', async (req, res) => {
  try {
    const rgId = String(req.params.releaseGroupId || '').trim();
    if (!rgId) {
      return res.status(400).json({ ok: false, error: 'Missing releaseGroupId' });
    }

    const rgUrl = `https://musicbrainz.org/ws/2/release-group/${encodeURIComponent(
      rgId
    )}?inc=releases+artist-credits&fmt=json`;
    const rgResp = await fetch(rgUrl, { headers: MB_HEADERS });
    if (!rgResp.ok) {
      return res.status(rgResp.status).json({
        ok: false,
        error: `MusicBrainz release-group HTTP ${rgResp.status}`,
      });
    }
    const rgData = await rgResp.json();
    const albumTitle = rgData?.title || 'Unknown Album';
    const artistName =
      rgData?.['artist-credit']?.[0]?.name ||
      rgData?.['artist-credit']?.[0]?.artist?.name ||
      'Unknown Artist';
    const releases = Array.isArray(rgData?.releases) ? rgData.releases : [];
    const chosenRelease =
      releases.find((r) => r.status === 'Official') || releases[0];

    if (!chosenRelease?.id) {
      return res.json({
        ok: true,
        album: {
          id: rgId,
          title: albumTitle,
          artist: artistName,
          tracks: [],
        },
      });
    }

    const relUrl = `https://musicbrainz.org/ws/2/release/${encodeURIComponent(
      chosenRelease.id
    )}?inc=recordings+artist-credits&fmt=json`;
    const relResp = await fetch(relUrl, { headers: MB_HEADERS });
    if (!relResp.ok) {
      return res.status(relResp.status).json({
        ok: false,
        error: `MusicBrainz release HTTP ${relResp.status}`,
      });
    }
    const relData = await relResp.json();
    const mediaList = Array.isArray(relData?.media) ? relData.media : [];
    const tracks = [];
    for (const medium of mediaList) {
      const mTracks = Array.isArray(medium?.tracks) ? medium.tracks : [];
      for (const tr of mTracks) {
        tracks.push({
          id:
            tr.id ||
            tr.recording?.id ||
            `${chosenRelease.id}-${tracks.length + 1}`,
          number: tr.number || String(tracks.length + 1),
          title: tr.title || tr.recording?.title || 'Untitled',
          artist: tr['artist-credit']?.[0]?.name || artistName,
          album: albumTitle,
          durationSec: tr.length ? Math.round(tr.length / 1000) : 210,
        });
      }
    }

    return res.json({
      ok: true,
      album: {
        id: rgId,
        releaseId: chosenRelease.id,
        title: albumTitle,
        artist: artistName,
        year: (rgData['first-release-date'] || '').slice(0, 4),
        coverUrl: `https://coverartarchive.org/release-group/${rgId}/front-250`,
        tracks,
      },
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error ? err.message : 'Failed to fetch album tracklist.',
    });
  }
});

// ============================================================================
// 8. SPOTIFY PUBLIC PLAYLIST / ALBUM / TRACK URL IMPORTER
// ============================================================================

app.post('/api/spotify/import-url', async (req, res) => {
  try {
    const rawUrl = String(req.body?.url || '').trim();
    if (!rawUrl) {
      return res.status(400).json({
        ok: false,
        error: 'Please provide a Spotify playlist, album, or track URL.',
      });
    }

    const match =
      rawUrl.match(
        /open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track)\/([a-zA-Z0-9]+)/i
      ) || rawUrl.match(/spotify:(playlist|album|track):([a-zA-Z0-9]+)/i);

    if (!match) {
      return res.status(400).json({
        ok: false,
        error:
          'Invalid Spotify link. Paste a link like https://open.spotify.com/playlist/... or album/... or track/...',
      });
    }

    const entityType = match[1].toLowerCase();
    const entityId = match[2];
    const embedUrl = `https://open.spotify.com/embed/${entityType}/${entityId}`;

    const resp = await fetch(embedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        error: `Spotify returned HTTP ${resp.status} for ${entityType} ${entityId}. Make sure the playlist is public.`,
      });
    }

    const html = await resp.text();
    let title = `Imported Spotify ${entityType.charAt(0).toUpperCase() + entityType.slice(1)}`;
    const tracks = [];

    const nextDataMatch = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i
    );
    if (nextDataMatch && nextDataMatch[1]) {
      try {
        const nextJson = JSON.parse(nextDataMatch[1]);
        const entity =
          nextJson?.props?.pageProps?.state?.data?.entity ||
          nextJson?.props?.pageProps?.entity ||
          null;
        if (entity) {
          if (entity.name || entity.title) {
            title = entity.name || entity.title;
          }
          const trackList =
            entity.trackList ||
            entity.tracks?.items ||
            (entity.type === 'track' ? [entity] : []);

          for (const item of trackList) {
            const tObj = item.track || item;
            const trackTitle = tObj.title || tObj.name || '';
            const trackArtist =
              tObj.subtitle ||
              (Array.isArray(tObj.artists)
                ? tObj.artists.map((a) => a.name).join(', ')
                : '') ||
              entity.subtitle ||
              'Unknown Artist';
            const durationMs = Number(tObj.duration || tObj.duration_ms || 0);
            if (trackTitle) {
              tracks.push({
                title: String(trackTitle).replace(/\u00a0/g, ' ').trim(),
                artist: String(trackArtist).replace(/\u00a0/g, ' ').trim(),
                album: entityType === 'album' ? title : '',
                durationSec:
                  durationMs > 0 ? Math.round(durationMs / 1000) : 210,
              });
            }
          }
        }
      } catch {}
    }

    if (tracks.length === 0) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        const cleaned = titleMatch[1]
          .replace(/\| Spotify.*$/i, '')
          .replace(/- playlist by.*$/i, '')
          .trim();
        if (cleaned) title = cleaned;
      }
    }

    return res.json({
      ok: true,
      entityType,
      entityId,
      playlistTitle: title,
      tracks,
      message:
        tracks.length > 0
          ? `Loaded ${tracks.length} track(s) from "${title}"!`
          : `Resolved "${title}", but Spotify hid the full tracklist. Paste the songs below or search directly.`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error ? err.message : 'Failed to import Spotify URL.',
    });
  }
});

// ============================================================================
// 9. LOCAL DOWNLOADERS (slskd + Lidarr + YouTube Music / yt-dlp -> /music)
// ============================================================================

const slskdJobs = new Map();
const grabJobs = slskdJobs;
(globalThis as any).grabJobs = slskdJobs;
(globalThis as any).slskdJobs = slskdJobs;
const readyNotifications: any[] = [];

function evaluateServerDiscoveryFilter(track, filtersConfig) {
  const filters = filtersConfig || readServerConfig().discoveryFilters || {};
  const title = String(track?.title || '').trim();
  const artist = String(track?.artist || '').trim();
  const album = String(track?.album || '').trim();
  const filename = String(track?.filename || '').trim();
  const durationSec = Number(track?.durationSec || 0);
  const combined = `${title} ${album} ${filename}`.toLowerCase();

  if (
    filters.excludeLive &&
    /\b(live|live\s+at|live\s+from|in\s+concert|concert\s+version|live\s+session)\b/i.test(
      combined
    )
  ) {
    return { excluded: true, reason: 'Excluded by Filter: Live Version' };
  }
  if (
    filters.excludeRemix &&
    /\b(remix|re-mix|club\s+mix|extended\s+mix|vip\s+mix|bootleg|mashup|dub\s+mix|dj\s+mix)\b/i.test(
      combined
    )
  ) {
    return { excluded: true, reason: 'Excluded by Filter: Remix / Club Edit' };
  }
  if (
    filters.excludeAcoustic &&
    /\b(acoustic|unplugged|stripped|piano\s+version|guitar\s+version)\b/i.test(
      combined
    )
  ) {
    return { excluded: true, reason: 'Excluded by Filter: Acoustic / Stripped' };
  }
  if (
    filters.excludeInstrumental &&
    /\b(instrumental|karaoke|backing\s+track|tribute|8-bit|lullaby\s+version)\b/i.test(
      combined
    )
  ) {
    return {
      excluded: true,
      reason: 'Excluded by Filter: Instrumental / Karaoke',
    };
  }
  if (
    filters.excludeSpedUpSlowed &&
    /\b(sped\s+up|nightcore|slowed|reverb|chopped\s+and\s+screwed|8d\s+audio)\b/i.test(
      combined
    )
  ) {
    return { excluded: true, reason: 'Excluded by Filter: Sped Up / Slowed' };
  }
  if (
    filters.excludeCommentary &&
    /\b(commentary|track\s+by\s+track|interview|skit|voice\s+memo|spoken\s+word)\b/i.test(
      combined
    )
  ) {
    return { excluded: true, reason: 'Excluded by Filter: Commentary / Skit' };
  }

  if (Array.isArray(filters.customExcludedWords)) {
    for (const rawWord of filters.customExcludedWords) {
      const w = String(rawWord || '').trim().toLowerCase();
      if (w && (combined.includes(w) || artist.toLowerCase().includes(w))) {
        return {
          excluded: true,
          reason: `Excluded by Keyword: "${rawWord.trim()}"`,
        };
      }
    }
  }

  if (durationSec > 0) {
    if (filters.minDurationSec > 0 && durationSec < filters.minDurationSec) {
      return {
        excluded: true,
        reason: `Excluded: Shorter than ${filters.minDurationSec}s`,
      };
    }
    if (filters.maxDurationSec > 0 && durationSec > filters.maxDurationSec) {
      return {
        excluded: true,
        reason: `Excluded: Longer than ${filters.maxDurationSec}s`,
      };
    }
  }

  if (filters.customScriptEnabled && filters.customScriptCode?.trim()) {
    try {
      const fn = new Function(
        'title',
        'artist',
        'album',
        'durationSec',
        filters.customScriptCode
      );
      if (fn(title, artist, album, durationSec) === false) {
        return { excluded: true, reason: 'Excluded by Custom Filter Script' };
      }
    } catch {}
  }

  return { excluded: false, reason: null };
}

function getSlskdConfig(override = {}) {
  const cfg = readServerConfig();
  const slskdUrl = String(
    override.slskdUrl || cfg.integrations?.slskdUrl || ''
  )
    .trim()
    .replace(/\/+$/, '');
  const slskdApiKey = String(
    override.slskdApiKey || cfg.integrations?.slskdApiKey || ''
  ).trim();
  return { slskdUrl, slskdApiKey };
}

function buildSlskdHeaders(apiKey) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return headers;
}

function scoreSlskdAudioFile(file, filtersConfig) {
  const filename = String(file?.filename || '');
  const lower = filename.toLowerCase();
  if (!/\.(flac|mp3|m4a|ogg|opus|wav)$/i.test(lower)) {
    return -1;
  }
  const filterCheck = evaluateServerDiscoveryFilter(
    {
      title: filename,
      filename,
      durationSec: Number(file?.length || 0),
    },
    filtersConfig
  );
  if (filterCheck.excluded) {
    return -1;
  }

  let score = 100;
  if (lower.endsWith('.flac')) {
    score += 1000;
  } else if (lower.endsWith('.mp3')) {
    const br = Number(file?.bitRate || 0);
    if (br >= 320) score += 750;
    else if (br >= 256) score += 550;
    else score += 350;
  } else {
    score += 300;
  }
  return score;
}

function selectBestSlskdPeerAndFiles(
  responses,
  mode = 'track',
  expectedTracks = [],
  filtersConfig = null
) {
  if (!Array.isArray(responses) || responses.length === 0) return null;

  const candidates = [];

  for (const resp of responses) {
    const username = resp?.username;
    if (!username) continue;
    const hasFreeSlot = Boolean(resp?.hasFreeUploadSlot);
    const uploadSpeed = Number(resp?.uploadSpeed || 0);
    const queueLength = Number(resp?.queueLength || 0);
    const rawFiles = Array.isArray(resp?.files) ? resp.files : [];

    const audioFiles = rawFiles
      .map((f) => ({
        file: f,
        score: scoreSlskdAudioFile(f, filtersConfig),
      }))
      .filter((item) => item.score > 0);

    if (audioFiles.length === 0) continue;

    if (mode === 'album') {
      const byFolder = new Map();
      for (const item of audioFiles) {
        const fname = String(item.file.filename || '');
        const lastSlash = Math.max(
          fname.lastIndexOf('\\'),
          fname.lastIndexOf('/')
        );
        const folder = lastSlash > 0 ? fname.slice(0, lastSlash) : 'root';
        const list = byFolder.get(folder) || [];
        list.push(item);
        byFolder.set(folder, list);
      }

      for (const [, folderItems] of byFolder.entries()) {
        if (
          folderItems.length < Math.min(2, Math.max(1, expectedTracks.length))
        ) {
          continue;
        }
        const avgFileScore =
          folderItems.reduce((sum, x) => sum + x.score, 0) / folderItems.length;
        const peerScore =
          (hasFreeSlot ? 5000 : 0) +
          avgFileScore +
          Math.min(500, folderItems.length * 35) +
          Math.min(300, Math.floor(uploadSpeed / 10000)) -
          Math.min(500, queueLength * 15);

        candidates.push({
          username,
          hasFreeUploadSlot: hasFreeSlot,
          peerScore,
          files: folderItems.map((x) => x.file),
          formatLabel: folderItems.some((x) =>
            String(x.file.filename).toLowerCase().endsWith('.flac')
          )
            ? 'FLAC'
            : 'MP3 320kbps',
        });
      }
    } else {
      audioFiles.sort((a, b) => b.score - a.score);
      const best = audioFiles[0];
      const peerScore =
        (hasFreeSlot ? 5000 : 0) +
        best.score +
        Math.min(300, Math.floor(uploadSpeed / 10000)) -
        Math.min(500, queueLength * 15);

      candidates.push({
        username,
        hasFreeUploadSlot: hasFreeSlot,
        peerScore,
        files: [best.file],
        formatLabel: String(best.file.filename).toLowerCase().endsWith('.flac')
          ? 'FLAC'
          : 'MP3',
      });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.peerScore - a.peerScore);
  return candidates[0];
}

async function executeYouTubeOrArchiveGrabJob(
  job,
  preferredEngine = 'youtube'
) {
  try {
    const cfg = readServerConfig();
    const downloadDir = MUSIC_DIR;
    const audioFormat = cfg.integrations?.youtubeAudioFormat || 'mp3';
    try {
      fs.mkdirSync(downloadDir, { recursive: true });
    } catch {}

    job.sourceEngine = preferredEngine === 'archive' ? 'archive' : 'youtube';
    job.status = 'searching';
    job.message =
      job.sourceEngine === 'archive'
        ? `Searching Internet Archive Open Audio for "${job.label}"...`
        : `Searching YouTube Music for "${job.label}"...`;

    // 1. Try native yt-dlp CLI -> downloads directly into /music and indexes into SQLite
    if (job.sourceEngine === 'youtube') {
      try {
        const safeArtist = String(job.artist || 'Downloaded Artist')
          .replace(/[<>:"/\\|?*]/g, '_')
          .trim();
        const safeFileBase = `${safeArtist} - ${job.title || job.label}`
          .replace(/[<>:"/\\|?*]/g, '_')
          .slice(0, 120);
        const artistFolder = path.join(downloadDir, safeArtist);
        fs.mkdirSync(artistFolder, { recursive: true });
        const outTemplate = path.join(artistFolder, `${safeFileBase}.%(ext)s`);
        const query = `ytsearch1:${job.searchText} official audio`;

        job.status = 'downloading';
        job.matchedPeer = 'YouTube Music (yt-dlp)';
        job.matchedFormat = audioFormat.toUpperCase();
        job.message = `Downloading "${job.label}" via YouTube Music (yt-dlp -> ${audioFormat.toUpperCase()})...`;

        await execFileAsync(
          'yt-dlp',
          [
            '--no-playlist',
            '-x',
            '--audio-format',
            audioFormat,
            '--audio-quality',
            '0',
            '-o',
            outTemplate,
            query,
          ],
          { timeout: 120000 }
        );

        const finalFile = path.join(
          artistFolder,
          `${safeFileBase}.${audioFormat}`
        );
        await indexAudioFile(finalFile);

        job.files = [
          {
            filename: finalFile,
            size: 0,
            username: 'YouTube Music (yt-dlp)',
            completed: true,
          },
        ];
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        job.message = `${job.label} downloaded into /music & indexed in Brokeify SQLite!`;

        readyNotifications.unshift({
          id: `notif-${job.id}`,
          jobId: job.id,
          label: job.label,
          message: `${job.label} is ready to play in your Brokeify library!`,
          completedAt: job.completedAt,
        });
        return;
      } catch {
        // Fallback to Piped / Internet Archive stream resolver
      }
    }

    // 2. Try Piped / YouTube Music Public Audio API
    if (job.sourceEngine === 'youtube') {
      const pipedInstances = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.tokhmi.xyz',
        'https://pipedapi.moomoo.me',
      ];
      for (const base of pipedInstances) {
        try {
          const searchResp = await fetch(
            `${base}/search?q=${encodeURIComponent(
              `${job.searchText} audio`
            )}&filter=music_songs`,
            { signal: AbortSignal.timeout(6000) }
          );
          if (!searchResp.ok) continue;
          const searchJson = await searchResp.json();
          const items = Array.isArray(searchJson?.items) ? searchJson.items : [];
          const firstItem = items.find((i) => i?.url && i.url.includes('v='));
          if (!firstItem) continue;

          const videoId = String(firstItem.url).split('v=')[1]?.split('&')[0];
          if (!videoId) continue;

          const streamResp = await fetch(`${base}/streams/${videoId}`, {
            signal: AbortSignal.timeout(6000),
          });
          if (!streamResp.ok) continue;
          const streamJson = await streamResp.json();
          const audioStreams = Array.isArray(streamJson?.audioStreams)
            ? streamJson.audioStreams
            : [];
          audioStreams.sort(
            (a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0)
          );
          const bestAudio = audioStreams[0];
          if (bestAudio?.url) {
            job.matchedPeer = 'YouTube Music Stream';
            job.matchedFormat = `${Math.round(
              Number(bestAudio.bitrate || 160000) / 1000
            )}kbps M4A/OPUS`;
            job.streamUrl = bestAudio.url;
            job.files = [
              {
                filename: `${job.label}.m4a`,
                size: 0,
                username: 'YouTube Music',
                completed: true,
              },
            ];
            job.status = 'completed';
            job.completedAt = new Date().toISOString();
            job.message = `${job.label} resolved via YouTube Music!`;

            readyNotifications.unshift({
              id: `notif-${job.id}`,
              jobId: job.id,
              label: job.label,
              message: `${job.label} is ready via YouTube Music!`,
              completedAt: job.completedAt,
            });
            return;
          }
        } catch {
          // try next instance
        }
      }
    }

    // 3. Fallback / Archive Mode: Search Internet Archive Open Audio
    try {
      const iaQuery = encodeURIComponent(
        `(${job.searchText}) AND mediatype:(audio)`
      );
      const iaUrl = `https://archive.org/advancedsearch.php?q=${iaQuery}&fl[]=identifier,title,creator&rows=5&page=1&output=json`;
      const iaResp = await fetch(iaUrl, { signal: AbortSignal.timeout(7000) });
      if (iaResp.ok) {
        const iaData = await iaResp.json();
        const docs = iaData?.response?.docs || [];
        for (const doc of docs) {
          if (!doc?.identifier) continue;
          const metaResp = await fetch(
            `https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`,
            { signal: AbortSignal.timeout(6000) }
          );
          if (!metaResp.ok) continue;
          const metaJson = await metaResp.json();
          const files = Array.isArray(metaJson?.files) ? metaJson.files : [];
          const audioFile = files.find(
            (f) => f?.name && /\.(mp3|flac|ogg|m4a)$/i.test(String(f.name))
          );
          if (audioFile) {
            const directStream = `https://archive.org/download/${encodeURIComponent(
              doc.identifier
            )}/${encodeURIComponent(audioFile.name)}`;
            job.sourceEngine = 'archive';
            job.matchedPeer = `archive.org/${doc.identifier}`;
            job.matchedFormat = String(audioFile.name)
              .split('.')
              .pop()
              .toUpperCase();
            job.streamUrl = directStream;
            job.files = [
              {
                filename: audioFile.name,
                size: Number(audioFile.size || 0),
                username: 'Internet Archive',
                completed: true,
              },
            ];
            job.status = 'completed';
            job.completedAt = new Date().toISOString();
            job.message = `${job.label} resolved via Open Audio Archive (${job.matchedFormat})!`;

            readyNotifications.unshift({
              id: `notif-${job.id}`,
              jobId: job.id,
              label: job.label,
              message: `${job.label} is ready via Open Audio Archive!`,
              completedAt: job.completedAt,
            });
            return;
          }
        }
      }
    } catch {}

    job.status = 'not_found';
    job.message = `Could not find "${job.label}" on ${
      preferredEngine === 'youtube'
        ? 'YouTube Music (ensure yt-dlp is installed)'
        : 'Open Audio Archive'
    }.`;
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    job.message = job.error;
  }
}

function getLidarrConfig(override = {}) {
  const cfg = readServerConfig();
  const lidarrUrl = String(
    override.lidarrUrl || cfg.integrations?.lidarrUrl || ''
  )
    .trim()
    .replace(/\/+$/, '');
  const lidarrApiKey = String(
    override.lidarrApiKey || cfg.integrations?.lidarrApiKey || ''
  ).trim();
  const lidarrRootFolderPath = String(
    override.lidarrRootFolderPath ||
      cfg.integrations?.lidarrRootFolderPath ||
      MUSIC_DIR
  ).trim();
  const lidarrQualityProfileId = Number(
    override.lidarrQualityProfileId ||
      cfg.integrations?.lidarrQualityProfileId ||
      1
  );
  const lidarrMetadataProfileId = Number(
    override.lidarrMetadataProfileId ||
      cfg.integrations?.lidarrMetadataProfileId ||
      1
  );
  return {
    lidarrUrl,
    lidarrApiKey,
    lidarrRootFolderPath,
    lidarrQualityProfileId,
    lidarrMetadataProfileId,
  };
}

function buildLidarrHeaders(apiKey) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
  }
  return headers;
}

app.post('/api/lidarr/test', async (req, res) => {
  try {
    const { lidarrUrl, lidarrApiKey } = getLidarrConfig(req.body || {});
    if (!lidarrUrl || !lidarrApiKey) {
      return res.status(400).json({
        ok: false,
        error: 'Enter both your Lidarr Server URL and Lidarr API Key first.',
      });
    }

    const headers = buildLidarrHeaders(lidarrApiKey);
    const statusResp = await fetch(`${lidarrUrl}/api/v1/system/status`, {
      headers,
      signal: AbortSignal.timeout(7000),
    });
    if (!statusResp.ok) {
      return res.status(statusResp.status).json({
        ok: false,
        error: `Lidarr returned HTTP ${statusResp.status}. Verify your URL and API Key.`,
      });
    }

    const statusJson = await statusResp.json().catch(() => ({}));
    let rootFolderPath = '/music';
    let qualityProfileId = 1;
    let metadataProfileId = 1;

    try {
      const [rfResp, qpResp, mpResp] = await Promise.all([
        fetch(`${lidarrUrl}/api/v1/rootfolder`, {
          headers,
          signal: AbortSignal.timeout(5000),
        }),
        fetch(`${lidarrUrl}/api/v1/qualityprofile`, {
          headers,
          signal: AbortSignal.timeout(5000),
        }),
        fetch(`${lidarrUrl}/api/v1/metadataprofile`, {
          headers,
          signal: AbortSignal.timeout(5000),
        }),
      ]);
      if (rfResp.ok) {
        const rfs = await rfResp.json().catch(() => []);
        if (Array.isArray(rfs) && rfs[0]?.path) {
          rootFolderPath = String(rfs[0].path);
        }
      }
      if (qpResp.ok) {
        const qps = await qpResp.json().catch(() => []);
        if (Array.isArray(qps) && qps[0]?.id) {
          qualityProfileId = Number(qps[0].id);
        }
      }
      if (mpResp.ok) {
        const mps = await mpResp.json().catch(() => []);
        if (Array.isArray(mps) && mps[0]?.id) {
          metadataProfileId = Number(mps[0].id);
        }
      }
    } catch {}

    return res.json({
      ok: true,
      version: statusJson?.version || 'v1',
      rootFolderPath,
      qualityProfileId,
      metadataProfileId,
      message: `Connected to Lidarr v${statusJson?.version || '1.x'}! Root folder: ${rootFolderPath}`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error ? err.message : 'Could not reach Lidarr server.',
    });
  }
});

app.post('/api/slskd/test', async (req, res) => {
  try {
    const { slskdUrl, slskdApiKey } = getSlskdConfig(req.body || {});
    if (!slskdUrl) {
      return res.status(400).json({
        ok: false,
        error:
          'Enter your slskd URL first (e.g. http://192.168.1.175:5030 or http://slskd:5030).',
      });
    }

    const headers = buildSlskdHeaders(slskdApiKey);
    let appInfo: any = null;
    let endpointTried = `${slskdUrl}/api/v0/application`;

    try {
      const resp = await fetch(endpointTried, {
        headers,
        signal: AbortSignal.timeout(6000),
      });

      if (resp.status === 401 || resp.status === 403) {
        return res.status(resp.status).json({
          ok: false,
          error: `slskd rejected authentication (HTTP ${resp.status}). Check your slskd API Key (X-API-Key).`,
        });
      }

      if (resp.ok) {
        appInfo = await resp.json().catch(() => ({}));
      } else {
        endpointTried = `${slskdUrl}/api/v0/transfers/downloads`;
        const fallbackResp = await fetch(endpointTried, {
          headers,
          signal: AbortSignal.timeout(6000),
        });
        if (!fallbackResp.ok) {
          return res.status(fallbackResp.status).json({
            ok: false,
            error: `slskd returned HTTP ${fallbackResp.status} at ${endpointTried}.`,
          });
        }
        appInfo = { version: '0.6.x' };
      }
    } catch (fetchErr) {
      const errMsg =
        fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      return res.status(502).json({
        ok: false,
        error: `Unreachable at ${slskdUrl}: ${errMsg}`,
        hint: `If slskd is on another Docker compose stack, use your host LAN IP like http://192.168.1.175:5030.`,
      });
    }

    const version = appInfo?.version || appInfo?.appVersion || '0.6.x';
    return res.json({
      ok: true,
      version,
      url: slskdUrl,
      message: `Connected to slskd v${version}! Soulseek P2P engine is ready for 1-click downloads into /music.`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error ? err.message : 'Error testing slskd connection.',
    });
  }
});

// Native SQLite Engine health test (replaces legacy Jellyfin connection test)
app.post('/api/jellyfin/test', (_req, res) => {
  const counts = getLocalLibraryStats();
  return res.json({
    ok: true,
    serverName: 'Brokeify Native SQLite Engine',
    serverVersion: '3.0.0-standalone',
    serverUrl: 'local:///data/brokeify.db',
    authValid: true,
    username: 'admin',
    message: `Brokeify Native SQLite Engine Online (${counts.totalTracks} tracks, ${counts.totalAlbums} albums, ${counts.totalArtists} artists indexed from ${MUSIC_DIR})!`,
  });
});

app.post('/api/listenbrainz/test', async (req, res) => {
  try {
    const cfg = readServerConfig();
    const username = String(
      req.body?.username || cfg.integrations?.listenbrainzUsername || ''
    ).trim();
    const token = String(
      req.body?.token || cfg.integrations?.listenbrainzToken || ''
    ).trim();

    if (!username) {
      return res.status(400).json({
        ok: false,
        error: 'Enter your ListenBrainz username first (e.g. crazynick17).',
      });
    }

    try {
      const userResp = await fetch(
        `https://api.listenbrainz.org/1/user/${encodeURIComponent(username)}/playlists`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (!userResp.ok && userResp.status === 404) {
        return res.status(404).json({
          ok: false,
          error: `ListenBrainz user "${username}" was not found.`,
        });
      }
    } catch (e) {
      return res.status(502).json({
        ok: false,
        error: `Could not reach ListenBrainz API: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    let tokenValid = false;
    let tokenMessage = 'No User Token entered (token needed for scrobbling).';

    if (token) {
      try {
        const tokenResp = await fetch(
          'https://api.listenbrainz.org/1/validate-token',
          {
            headers: { Authorization: `Token ${token}` },
            signal: AbortSignal.timeout(6000),
          }
        );
        if (tokenResp.ok) {
          const tokenJson = (await tokenResp.json().catch(() => ({}))) as any;
          tokenValid = Boolean(tokenJson.valid);
          tokenMessage = tokenValid
            ? 'Scrobbler Token valid & authorized.'
            : 'Scrobbler Token is invalid or expired.';
        }
      } catch {
        tokenMessage = 'Could not validate scrobbler token right now.';
      }
    }

    return res.json({
      ok: true,
      username,
      tokenValid,
      message: `ListenBrainz profile "${username}" connected! ${tokenMessage}`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'ListenBrainz test error.',
    });
  }
});

app.post('/api/services/test-all', async (req, res) => {
  const cfg = readServerConfig();
  const slskdCreds = getSlskdConfig(req.body?.slskd || {});
  const lidarrCreds = getLidarrConfig(req.body?.lidarr || {});
  const lbUser = String(
    req.body?.listenbrainz?.username ||
      cfg.integrations?.listenbrainzUsername ||
      ''
  ).trim();
  const counts = getLocalLibraryStats();

  let storageStatus = {
    ok: true,
    path: DB_PATH,
    message: `SQLite Active (${DB_PATH} · ${counts.totalTracks} tracks)`,
  };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
  } catch (e) {
    storageStatus = {
      ok: false,
      path: DB_PATH,
      message: `Permission error writing to ${DATA_DIR}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const nativeEngineStatus = {
    ok: true,
    serverName: 'Brokeify Native Engine',
    version: '3.0.0-standalone',
    message: `SQLite Ready: ${counts.totalTracks} tracks, ${counts.totalAlbums} albums, ${counts.totalArtists} artists (${MUSIC_DIR})`,
  };

  let slskdStatus: {
    ok: boolean;
    version?: string;
    message: string;
    hint?: string;
  } = {
    ok: false,
    message: 'Not configured',
  };
  if (slskdCreds.slskdUrl) {
    try {
      const sResp = await fetch(`${slskdCreds.slskdUrl}/api/v0/application`, {
        headers: buildSlskdHeaders(slskdCreds.slskdApiKey),
        signal: AbortSignal.timeout(5000),
      }).catch(async () => {
        return await fetch(
          `${slskdCreds.slskdUrl}/api/v0/transfers/downloads`,
          {
            headers: buildSlskdHeaders(slskdCreds.slskdApiKey),
            signal: AbortSignal.timeout(5000),
          }
        );
      });
      if (sResp.ok) {
        const sInfo = (await sResp.json().catch(() => ({}))) as any;
        slskdStatus = {
          ok: true,
          version: sInfo.version || '0.6.x',
          message: `Connected to slskd v${sInfo.version || '0.6.x'}`,
        };
      } else {
        slskdStatus = {
          ok: false,
          message: `HTTP ${sResp.status} from slskd. Check API key.`,
        };
      }
    } catch {
      slskdStatus = {
        ok: false,
        message: `Unreachable at ${slskdCreds.slskdUrl}`,
        hint: 'Use host LAN IP (http://192.168.1.175:5030) or share Docker network.',
      };
    }
  }

  let lidarrStatus: {
    ok: boolean;
    version?: string;
    message: string;
    hint?: string;
  } = {
    ok: false,
    message: 'Not configured',
  };
  if (lidarrCreds.lidarrUrl && lidarrCreds.lidarrApiKey) {
    try {
      const lResp = await fetch(
        `${lidarrCreds.lidarrUrl}/api/v1/system/status`,
        {
          headers: buildLidarrHeaders(lidarrCreds.lidarrApiKey),
          signal: AbortSignal.timeout(5000),
        }
      );
      if (lResp.ok) {
        const lInfo = (await lResp.json().catch(() => ({}))) as any;
        lidarrStatus = {
          ok: true,
          version: lInfo.version || '1.x',
          message: `Connected to Lidarr v${lInfo.version || '1.x'}`,
        };
      } else {
        lidarrStatus = {
          ok: false,
          message: `HTTP ${lResp.status} from Lidarr.`,
        };
      }
    } catch {
      lidarrStatus = {
        ok: false,
        message: `Unreachable at ${lidarrCreds.lidarrUrl}`,
      };
    }
  }

  let listenbrainzStatus: { ok: boolean; username?: string; message: string } =
    {
      ok: false,
      message: 'Not configured',
    };
  if (lbUser) {
    try {
      const lbResp = await fetch(
        `https://api.listenbrainz.org/1/user/${encodeURIComponent(lbUser)}/playlists`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (lbResp.ok || lbResp.status === 200) {
        listenbrainzStatus = {
          ok: true,
          username: lbUser,
          message: `ListenBrainz profile "${lbUser}" verified!`,
        };
      } else if (lbResp.status === 404) {
        listenbrainzStatus = {
          ok: false,
          message: `User "${lbUser}" does not exist on ListenBrainz.`,
        };
      }
    } catch {
      listenbrainzStatus = {
        ok: false,
        message: 'Could not contact ListenBrainz API.',
      };
    }
  }

  return res.json({
    ok: true,
    services: {
      jellyfin: nativeEngineStatus,
      slskd: slskdStatus,
      lidarr: lidarrStatus,
      listenbrainz: listenbrainzStatus,
      storage: storageStatus,
    },
  });
});

async function executeLidarrGrabJob(job, override = {}) {
  const {
    lidarrUrl,
    lidarrApiKey,
    lidarrRootFolderPath,
    lidarrQualityProfileId,
    lidarrMetadataProfileId,
  } = getLidarrConfig(override);

  if (!lidarrUrl || !lidarrApiKey) {
    return false;
  }

  const headers = buildLidarrHeaders(lidarrApiKey);
  try {
    job.sourceEngine = 'lidarr';
    job.status = 'searching';
    job.message = `Searching Lidarr indexers for "${job.label}"...`;

    let rootFolderPath = lidarrRootFolderPath || '/music';
    let qualityProfileId = lidarrQualityProfileId || 1;
    let metadataProfileId = lidarrMetadataProfileId || 1;

    try {
      const [rfResp, qpResp, mpResp] = await Promise.all([
        fetch(`${lidarrUrl}/api/v1/rootfolder`, {
          headers,
          signal: AbortSignal.timeout(5000),
        }),
        fetch(`${lidarrUrl}/api/v1/qualityprofile`, {
          headers,
          signal: AbortSignal.timeout(5000),
        }),
        fetch(`${lidarrUrl}/api/v1/metadataprofile`, {
          headers,
          signal: AbortSignal.timeout(5000),
        }),
      ]);
      if (rfResp.ok) {
        const rfs = await rfResp.json().catch(() => []);
        if (Array.isArray(rfs) && rfs[0]?.path) {
          rootFolderPath = String(rfs[0].path);
        }
      }
      if (qpResp.ok) {
        const qps = await qpResp.json().catch(() => []);
        if (Array.isArray(qps) && qps[0]?.id) {
          qualityProfileId = Number(qps[0].id);
        }
      }
      if (mpResp.ok) {
        const mps = await mpResp.json().catch(() => []);
        if (Array.isArray(mps) && mps[0]?.id) {
          metadataProfileId = Number(mps[0].id);
        }
      }
    } catch {}

    const searchArtistTerm = job.artist || job.searchText || job.title;
    const lookupResp = await fetch(
      `${lidarrUrl}/api/v1/artist/lookup?term=${encodeURIComponent(
        searchArtistTerm
      )}`,
      { headers, signal: AbortSignal.timeout(10000) }
    );
    if (!lookupResp.ok) {
      throw new Error(
        `Lidarr artist/lookup returned HTTP ${lookupResp.status}`
      );
    }
    const lookupArtists = await lookupResp.json().catch(() => []);
    const matchedArtist = Array.isArray(lookupArtists)
      ? lookupArtists[0]
      : null;
    if (!matchedArtist || !matchedArtist.foreignArtistId) {
      throw new Error(
        `No matching artist found in Lidarr for "${searchArtistTerm}"`
      );
    }

    let lidarrArtist = null;
    const existingArtistsResp = await fetch(`${lidarrUrl}/api/v1/artist`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (existingArtistsResp.ok) {
      const existingList = await existingArtistsResp.json().catch(() => []);
      if (Array.isArray(existingList)) {
        lidarrArtist = existingList.find(
          (a) => a.foreignArtistId === matchedArtist.foreignArtistId
        );
      }
    }

    if (!lidarrArtist) {
      const addPayload = {
        ...matchedArtist,
        qualityProfileId,
        metadataProfileId,
        rootFolderPath,
        monitored: true,
        addOptions: {
          monitor: 'all',
          searchForMissingAlbums: true,
        },
      };
      const addResp = await fetch(`${lidarrUrl}/api/v1/artist`, {
        method: 'POST',
        headers,
        body: JSON.stringify(addPayload),
        signal: AbortSignal.timeout(12000),
      });
      if (addResp.ok) {
        lidarrArtist = await addResp.json().catch(() => null);
      }
    }

    if (lidarrArtist?.id) {
      await fetch(`${lidarrUrl}/api/v1/command`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'ArtistSearch',
          artistId: lidarrArtist.id,
        }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {});
    }

    job.matchedPeer = `Lidarr (${matchedArtist.artistName || job.artist})`;
    job.matchedFormat = 'Lidarr Monitored Release';
    job.organizedPath = `${rootFolderPath}/${matchedArtist.artistName || job.artist}`;
    job.files = [
      {
        filename: `${matchedArtist.artistName || job.artist} - ${job.title || job.label}`,
        size: 0,
        username: 'Lidarr Indexer',
        completed: true,
      },
    ];
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.message = `Queued "${job.label}" in Lidarr (${rootFolderPath}) — Chokidar will auto-index tracks as they land in /music!`;

    readyNotifications.unshift({
      id: `notif-${job.id}`,
      jobId: job.id,
      label: job.label,
      message: `${job.label} added & triggered in Lidarr (${rootFolderPath})!`,
      completedAt: job.completedAt,
    });
    return true;
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    return false;
  }
}

async function executeSlskdGrabJob(
  job,
  slskdUrl,
  slskdApiKey,
  sourceMode = 'auto',
  filtersConfig = null
) {
  if (sourceMode === 'youtube' || sourceMode === 'archive') {
    return executeYouTubeOrArchiveGrabJob(job, sourceMode);
  }

  if (sourceMode === 'lidarr') {
    const ok = await executeLidarrGrabJob(job);
    if (!ok) {
      job.status = 'not_found';
      job.message =
        job.error ||
        'Lidarr URL & API Key not configured or release not found.';
    }
    return;
  }

  if (!slskdUrl || !slskdApiKey) {
    if (sourceMode === 'auto') {
      const lidarrOk = await executeLidarrGrabJob(job);
      if (lidarrOk) return;
      return executeYouTubeOrArchiveGrabJob(job, 'youtube');
    }
    job.status = 'not_found';
    job.message = 'slskd API key not configured in Settings.';
    return;
  }

  const headers = buildSlskdHeaders(slskdApiKey);
  try {
    job.sourceEngine = 'slskd';
    job.status = 'searching';
    job.message = `Searching slskd for "${job.searchText}"...`;

    const searchId = crypto.randomUUID();
    const startSearchResp = await fetch(`${slskdUrl}/api/v0/searches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: searchId,
        searchText: job.searchText,
        searchTimeout: 10000,
        filterResponses: true,
        minimumPeerUploadSpeed: 0,
      }),
    });

    if (!startSearchResp.ok) {
      if (sourceMode === 'auto') {
        const lidarrOk = await executeLidarrGrabJob(job);
        if (lidarrOk) return;
        return executeYouTubeOrArchiveGrabJob(job, 'youtube');
      }
      const txt = await startSearchResp.text().catch(() => '');
      throw new Error(
        `slskd POST /api/v0/searches returned HTTP ${startSearchResp.status}${txt ? `: ${txt.slice(0, 120)}` : ''}`
      );
    }

    const searchData = await startSearchResp
      .json()
      .catch(() => ({ id: searchId }));
    const activeSearchId = searchData?.id || searchId;

    let chosen = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise((r) => setTimeout(r, 2200));
      const pollResp = await fetch(
        `${slskdUrl}/api/v0/searches/${encodeURIComponent(
          activeSearchId
        )}?includeResponses=true`,
        { headers }
      );
      if (!pollResp.ok) continue;
      const pollJson = await pollResp.json().catch(() => ({}));
      const responses = Array.isArray(pollJson?.responses)
        ? pollJson.responses
        : [];
      chosen = selectBestSlskdPeerAndFiles(
        responses,
        job.type === 'album' ? 'album' : 'track',
        job.expectedTracks || [],
        filtersConfig
      );
      if (chosen && chosen.hasFreeUploadSlot) {
        break;
      }
    }

    if (!chosen || chosen.files.length === 0) {
      if (sourceMode === 'auto') {
        const lidarrOk = await executeLidarrGrabJob(job);
        if (lidarrOk) return;
        job.message = `Not found on slskd — auto-falling back to YouTube Music for "${job.label}"...`;
        return executeYouTubeOrArchiveGrabJob(job, 'youtube');
      }
      job.status = 'not_found';
      job.message = `Not found on slskd for "${job.searchText}".`;
      return;
    }

    job.matchedPeer = chosen.username;
    job.matchedFormat = chosen.formatLabel;
    job.message = `Selected peer "${chosen.username}" (${chosen.formatLabel}) — queueing ${chosen.files.length} file(s)...`;

    const payload = chosen.files.map((f) => ({
      filename: f.filename,
      size: f.size,
    }));

    const queueResp = await fetch(
      `${slskdUrl}/api/v0/transfers/downloads/${encodeURIComponent(
        chosen.username
      )}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }
    );

    if (!queueResp.ok) {
      const errTxt = await queueResp.text().catch(() => '');
      throw new Error(
        `slskd POST /api/v0/transfers/downloads/${chosen.username} returned HTTP ${queueResp.status}: ${errTxt.slice(0, 140)}`
      );
    }

    job.status = 'downloading';
    job.files = chosen.files.map((f) => ({
      filename: f.filename,
      size: f.size || 0,
      username: chosen.username,
      completed: false,
    }));
    job.message = `Downloading ${chosen.files.length} ${chosen.formatLabel} track(s) from ${chosen.username}...`;
  } catch (err) {
    if (sourceMode === 'auto') {
      const lidarrOk = await executeLidarrGrabJob(job);
      if (lidarrOk) return;
      return executeYouTubeOrArchiveGrabJob(job, 'youtube');
    }
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    job.message = job.error;
  }
}

// ============================================================================
// 10. CROSS-DEVICE PLAYBACK HANDOFF SESSION (/api/playback-session)
// ============================================================================

let latestPlaybackSessionMemory = null;

app.get('/api/playback-session', (_req, res) => {
  if (!latestPlaybackSessionMemory) {
    const cfg = readServerConfig();
    if (cfg.playbackSession) {
      latestPlaybackSessionMemory = cfg.playbackSession;
    }
  }
  res.json({
    ok: true,
    playbackSession: latestPlaybackSessionMemory,
  });
});

app.post('/api/playback-session', (req, res) => {
  try {
    const incoming =
      req.body?.playbackSession || req.body?.session || req.body;
    if (!incoming || !incoming.track || !incoming.track.id) {
      return res
        .status(400)
        .json({ ok: false, error: 'Missing track in playbackSession.' });
    }
    const nextSession = {
      updatedAt: new Date().toISOString(),
      deviceId: String(incoming.deviceId || 'device-default'),
      deviceName: String(incoming.deviceName || 'Brokeify Device'),
      isPlaying: Boolean(incoming.isPlaying),
      trackId: String(incoming.track.id),
      track: incoming.track,
      positionSec: Math.max(0, Number(incoming.positionSec || 0)),
      durationSec: Math.max(
        1,
        Number(incoming.durationSec || incoming.track.duration || 180)
      ),
      playlistId: incoming.playlistId || null,
      playlistName: incoming.playlistName || null,
      queueTrackIds: Array.isArray(incoming.queueTrackIds)
        ? incoming.queueTrackIds.slice(0, 300)
        : [],
      shuffleEnabled: Boolean(incoming.shuffleEnabled),
      repeatMode: incoming.repeatMode || 'all',
    };
    latestPlaybackSessionMemory = nextSession;
    writeServerConfig({ playbackSession: nextSession });
    return res.json({
      ok: true,
      playbackSession: nextSession,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to save cross-device playback session.',
    });
  }
});

// POST /api/slskd/grab
app.post('/api/slskd/grab', async (req, res) => {
  try {
    const cfg = readServerConfig();
    const { slskdUrl, slskdApiKey } = getSlskdConfig(req.body || {});
    const { lidarrUrl, lidarrApiKey } = getLidarrConfig(req.body || {});
    const sourceMode = String(
      req.body?.sourceMode || cfg.integrations?.preferredDownloader || 'auto'
    ).toLowerCase();
    const ignoreFilters = Boolean(req.body?.ignoreFilters);
    const activeFilters = req.body?.filters || cfg.discoveryFilters;

    if (sourceMode === 'slskd' && !slskdUrl) {
      return res.status(400).json({
        ok: false,
        error:
          'slskd URL is not configured yet. Add your slskd URL & API key in Settings, or switch Downloader Source to "Auto".',
      });
    }

    if (sourceMode === 'lidarr' && (!lidarrUrl || !lidarrApiKey)) {
      return res.status(400).json({
        ok: false,
        error:
          'Lidarr URL & API Key are not configured yet. Add your Lidarr URL & API key in Settings, or switch Download Engine to "Auto".',
      });
    }

    const type = req.body?.type || 'track';
    const artist = String(req.body?.artist || '').trim();
    const title = String(req.body?.title || req.body?.album || '').trim();
    const tracks = Array.isArray(req.body?.tracks) ? req.body.tracks : [];

    if (type === 'playlist' && tracks.length > 0) {
      const createdJobs = [];
      let skippedCount = 0;

      for (const tr of tracks.slice(0, 35)) {
        const jobLabel = `${tr.artist} - ${tr.title}`;
        if (!ignoreFilters) {
          const check = evaluateServerDiscoveryFilter(tr, activeFilters);
          if (check.excluded) {
            skippedCount += 1;
            const filteredJob = {
              id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              type: 'track',
              sourceEngine:
                sourceMode === 'youtube'
                  ? 'youtube'
                  : sourceMode === 'lidarr'
                    ? 'lidarr'
                    : 'slskd',
              label: jobLabel,
              artist: tr.artist,
              title: tr.title,
              searchText: `${tr.artist} ${tr.title}`,
              status: 'filtered',
              message: check.reason || 'Skipped by Exclusion Filter',
              matchedPeer: null,
              matchedFormat: null,
              files: [],
              createdAt: new Date().toISOString(),
              completedAt: null,
            };
            slskdJobs.set(filteredJob.id, filteredJob);
            createdJobs.push(filteredJob);
            continue;
          }
        }

        const job = {
          id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'track',
          sourceEngine:
            sourceMode === 'youtube'
              ? 'youtube'
              : sourceMode === 'archive'
                ? 'archive'
                : sourceMode === 'lidarr'
                  ? 'lidarr'
                  : 'slskd',
          label: jobLabel,
          artist: tr.artist,
          title: tr.title,
          searchText: `${tr.artist} ${tr.title}`,
          status: 'searching',
          message: `Queued search for ${jobLabel} (${sourceMode.toUpperCase()})`,
          matchedPeer: null,
          matchedFormat: null,
          files: [],
          createdAt: new Date().toISOString(),
          completedAt: null,
        };
        slskdJobs.set(job.id, job);
        createdJobs.push(job);
        executeSlskdGrabJob(
          job,
          slskdUrl,
          slskdApiKey,
          sourceMode,
          ignoreFilters ? null : activeFilters
        );
      }

      const activeCount = createdJobs.length - skippedCount;
      return res.json({
        ok: true,
        jobs: createdJobs,
        message: `Queued ${activeCount} track(s) via ${sourceMode.toUpperCase()}${
          skippedCount > 0
            ? ` (${skippedCount} skipped by Exclusion Filters)`
            : ''
        }!`,
      });
    }

    const label = artist && title ? `${artist} - ${title}` : title || artist;
    if (!label) {
      return res.status(400).json({
        ok: false,
        error: 'Artist or Album/Track title is required.',
      });
    }

    if (!ignoreFilters && type === 'track') {
      const check = evaluateServerDiscoveryFilter(
        { title, artist, album: req.body?.album || '' },
        activeFilters
      );
      if (check.excluded) {
        return res.status(400).json({
          ok: false,
          filtered: true,
          error: `${check.reason}. Click "Override & Grab Anyway" or adjust your Exclusion Filters.`,
        });
      }
    }

    const job = {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: type === 'album' ? 'album' : 'track',
      sourceEngine:
        sourceMode === 'youtube'
          ? 'youtube'
          : sourceMode === 'archive'
            ? 'archive'
            : sourceMode === 'lidarr'
              ? 'lidarr'
              : 'slskd',
      label,
      artist,
      title,
      searchText: `${artist} ${title}`.trim(),
      expectedTracks: tracks,
      status: 'searching',
      message: `Searching ${sourceMode.toUpperCase()} for "${label}"...`,
      matchedPeer: null,
      matchedFormat: null,
      files: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    slskdJobs.set(job.id, job);
    executeSlskdGrabJob(
      job,
      slskdUrl,
      slskdApiKey,
      sourceMode,
      ignoreFilters ? null : activeFilters
    );

    return res.json({
      ok: true,
      job,
      message: `Started automated ${job.type} grab for "${label}" (${sourceMode.toUpperCase()}).`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to start download.',
    });
  }
});

app.get('/api/slskd/status', (_req, res) => {
  const jobs = Array.from(slskdJobs.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  res.json({
    ok: true,
    jobs,
    notifications: readyNotifications,
  });
});

app.post('/api/slskd/notifications/dismiss', (req, res) => {
  const id = req.body?.id;
  if (id) {
    const idx = readyNotifications.findIndex((n) => n.id === id);
    if (idx !== -1) readyNotifications.splice(idx, 1);
  } else {
    readyNotifications.length = 0;
  }
  res.json({ ok: true, notifications: readyNotifications });
});

async function pollSlskdTransfersAndScanLocalLibrary() {
  const activeDownloadingJobs = Array.from(slskdJobs.values()).filter(
    (j) => j.status === 'downloading' && j.sourceEngine === 'slskd'
  );
  if (activeDownloadingJobs.length === 0) return;

  const { slskdUrl, slskdApiKey } = getSlskdConfig();
  if (!slskdUrl) return;

  try {
    const resp = await fetch(`${slskdUrl}/api/v0/transfers/downloads`, {
      headers: buildSlskdHeaders(slskdApiKey),
    });
    if (!resp.ok) return;
    const transfersByUser = await resp.json().catch(() => []);
    if (!Array.isArray(transfersByUser)) return;

    const transferMap = new Map();
    for (const userEntry of transfersByUser) {
      const uname = userEntry?.username || '';
      const dirs = Array.isArray(userEntry?.directories)
        ? userEntry.directories
        : [];
      for (const dir of dirs) {
        const files = Array.isArray(dir?.files) ? dir.files : [];
        for (const f of files) {
          transferMap.set(`${uname}::${f.filename}`, f);
        }
      }
    }

    for (const job of activeDownloadingJobs) {
      if (!Array.isArray(job.files) || job.files.length === 0) continue;

      let completedCount = 0;
      for (const jf of job.files) {
        const match = transferMap.get(`${jf.username}::${jf.filename}`);
        const stateStr = String(match?.state || '');
        if (
          stateStr.includes('Completed') ||
          stateStr.includes('Succeeded') ||
          Number(match?.percentComplete || 0) >= 100
        ) {
          jf.completed = true;
          completedCount += 1;
        }
      }

      job.message = `Downloading from ${job.matchedPeer}: ${completedCount}/${job.files.length} file(s) complete`;

      if (completedCount === job.files.length) {
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        job.message = `${job.label} downloaded & indexed into Brokeify SQLite!`;

        await runFullLibraryScan();

        readyNotifications.unshift({
          id: `notif-${job.id}`,
          jobId: job.id,
          label: job.label,
          message: `${job.label} is ready to play in your library!`,
          completedAt: job.completedAt,
        });
      }
    }
  } catch {}
}

setInterval(pollSlskdTransfersAndScanLocalLibrary, 6000);

// ============================================================================
// 11. MUSICBRAINZ PICARD + GEMINI AI AUTO-TAGGER & ORGANIZED FOLDER ENGINE
// ============================================================================

async function resolvePicardAndAiMetadata(rawArtist, rawTitle, rawAlbum = '') {
  let cleanArtist = String(rawArtist || '').trim();
  let cleanTitle = String(rawTitle || '').trim();
  let cleanAlbum = String(rawAlbum || '').trim();
  let year = '';
  let trackNumber = '01';
  let genre = '';
  let source = 'musicbrainz';

  const cfg = readServerConfig();
  if (
    cfg.picardConfig?.useAiMetadataCleanup !== false &&
    process.env.GEMINI_API_KEY
  ) {
    try {
      const { GoogleGenAI, Type } = await import('@google/genai');
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Clean and standardize this music track metadata like MusicBrainz Picard. Input artist="${cleanArtist}", title="${cleanTitle}", album="${cleanAlbum}". Strip junk like "(Official Video)", "[HD]", "320kbps", track numbers in title, etc.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              artist: { type: Type.STRING },
              title: { type: Type.STRING },
              album: { type: Type.STRING },
              year: { type: Type.STRING },
              trackNumber: { type: Type.STRING },
              genre: { type: Type.STRING },
            },
          },
        },
      });
      const parsedAi = JSON.parse((response.text || '{}').trim());
      if (parsedAi.title) cleanTitle = parsedAi.title;
      if (parsedAi.artist) cleanArtist = parsedAi.artist;
      if (parsedAi.album && !cleanAlbum) cleanAlbum = parsedAi.album;
      if (parsedAi.year) year = parsedAi.year;
      if (parsedAi.trackNumber) trackNumber = parsedAi.trackNumber;
      if (parsedAi.genre) genre = parsedAi.genre;
      source = 'musicbrainz+ai';
    } catch {}
  }

  try {
    const q = `recording:"${cleanTitle}"${
      cleanArtist ? ` AND artist:"${cleanArtist}"` : ''
    }`;
    const mbUrl = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(
      q
    )}&limit=3&fmt=json`;
    const mbResp = await fetch(mbUrl, {
      headers: MB_HEADERS,
      signal: AbortSignal.timeout(6000),
    });
    if (mbResp.ok) {
      const mbData = await mbResp.json();
      const rec = mbData?.recordings?.[0];
      if (rec) {
        cleanTitle = rec.title || cleanTitle;
        cleanArtist =
          rec['artist-credit']?.[0]?.name ||
          rec['artist-credit']?.[0]?.artist?.name ||
          cleanArtist;
        const officialRel =
          (rec.releases || []).find((r) => r.status === 'Official') ||
          rec.releases?.[0];
        if (officialRel) {
          cleanAlbum = officialRel.title || cleanAlbum || 'Singles';
          year =
            (officialRel.date || rec['first-release-date'] || '').slice(0, 4) ||
            year ||
            '0000';
          const trNum = officialRel.media?.[0]?.track?.[0]?.number;
          if (trNum) {
            trackNumber = String(trNum).padStart(2, '0');
          }
        }
      }
    }
  } catch {}

  if (!cleanAlbum) cleanAlbum = 'Singles';
  if (!year) year = new Date().getFullYear().toString();
  const safeSeg = (s) =>
    String(s || 'Unknown')
      .replace(/[<>:"/\\|?*]/g, '_')
      .trim();

  const template =
    cfg.picardConfig?.folderTemplate ||
    '{Artist}/{Album} ({Year})/{TrackNumber} - {Title}.{ext}';

  const relativePathPreview = template
    .replace(/\{Artist\}/gi, safeSeg(cleanArtist))
    .replace(/\{Album\}/gi, safeSeg(cleanAlbum))
    .replace(/\{Year\}/gi, safeSeg(year))
    .replace(/\{TrackNumber\}/gi, safeSeg(trackNumber))
    .replace(/\{Title\}/gi, safeSeg(cleanTitle))
    .replace(/\{ext\}/gi, cfg.integrations?.youtubeAudioFormat || 'mp3');

  return {
    artist: cleanArtist || 'Unknown Artist',
    title: cleanTitle || 'Untitled',
    album: cleanAlbum,
    year,
    trackNumber,
    genre,
    source,
    organizedRelativePath: relativePathPreview,
  };
}

app.post('/api/picard/resolve-metadata', async (req, res) => {
  try {
    const artist = String(req.body?.artist || '').trim();
    const title = String(req.body?.title || '').trim();
    const album = String(req.body?.album || '').trim();
    if (!title && !artist) {
      return res
        .status(400)
        .json({ ok: false, error: 'Provide artist or title to resolve.' });
    }
    const resolved = await resolvePicardAndAiMetadata(artist, title, album);
    return res.json({ ok: true, metadata: resolved });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error ? err.message : 'Picard metadata lookup failed.',
    });
  }
});

// ============================================================================
// 12. AUTOPILOT LINKED PLAYLISTS (SPOTIFY -> BROKEIFY SQLITE AUTO-SYNC)
// ============================================================================

async function runSingleAutopilotRule(ruleId) {
  const cfg = readServerConfig();
  const rules = Array.isArray(cfg.autopilotRules) ? cfg.autopilotRules : [];
  const ruleIdx = rules.findIndex((r) => r.id === ruleId);
  if (ruleIdx === -1) {
    throw new Error('Autopilot rule not found.');
  }
  const rule = rules[ruleIdx];

  const match =
    String(rule.sourceUrl || rule.spotifyUrl || '').match(
      /open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album)\/([a-zA-Z0-9]+)/i
    ) ||
    String(rule.sourceUrl || rule.spotifyUrl || '').match(
      /spotify:(playlist|album):([a-zA-Z0-9]+)/i
    );

  if (!match) {
    throw new Error('Invalid Spotify URL in Autopilot rule.');
  }

  const entityType = match[1].toLowerCase();
  const entityId = match[2];
  const embedUrl = `https://open.spotify.com/embed/${entityType}/${entityId}`;
  const resp = await fetch(embedUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html',
    },
  });

  const tracks = [];
  if (resp.ok) {
    const html = await resp.text();
    const nextDataMatch = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i
    );
    if (nextDataMatch && nextDataMatch[1]) {
      try {
        const nextJson = JSON.parse(nextDataMatch[1]);
        const entity =
          nextJson?.props?.pageProps?.state?.data?.entity ||
          nextJson?.props?.pageProps?.entity;
        const trackList = entity?.trackList || entity?.tracks?.items || [];
        for (const item of trackList) {
          const tObj = item.track || item;
          const trackTitle = tObj.title || tObj.name || '';
          const trackArtist =
            tObj.subtitle ||
            (Array.isArray(tObj.artists)
              ? tObj.artists.map((a) => a.name).join(', ')
              : '') ||
            'Unknown Artist';
          if (trackTitle) {
            tracks.push({
              title: String(trackTitle).replace(/\u00a0/g, ' ').trim(),
              artist: String(trackArtist).replace(/\u00a0/g, ' ').trim(),
            });
          }
        }
      } catch {}
    }
  }

  const localLibrary = getSqliteAudioFingerprints();
  const matchedTrackIds = [];
  const missingTracks = [];

  for (const t of tracks) {
    const normT = normalizeText(t.title);
    const normA = normalizeText(t.artist);
    const matched = localLibrary.find(
      (loc) =>
        loc.normTitle &&
        normT &&
        (loc.normTitle === normT ||
          loc.normTitle.includes(normT) ||
          normT.includes(loc.normTitle)) &&
        (!normA ||
          !loc.normArtist ||
          loc.normArtist.includes(normA) ||
          normA.includes(loc.normArtist))
    );
    if (matched) {
      matchedTrackIds.push(matched.id);
    } else {
      const filterCheck = evaluateServerDiscoveryFilter(
        t,
        cfg.discoveryFilters
      );
      if (!filterCheck.excluded) {
        missingTracks.push(t);
      }
    }
  }

  // Update SQLite playlist_tracks for the linked playlist
  let addedCount = 0;
  if (rule.playlistId && matchedTrackIds.length > 0) {
    const existingRows = db
      .prepare(
        `SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC`
      )
      .all(rule.playlistId) as Array<{ track_id: string }>;
    const existingSet = new Set(existingRows.map((r) => r.track_id));
    const combinedIds = existingRows.map((r) => r.track_id);
    for (const tid of matchedTrackIds) {
      if (!existingSet.has(tid)) {
        existingSet.add(tid);
        combinedIds.push(tid);
        addedCount += 1;
      }
    }
    const tx = db.transaction((ids: string[]) => {
      db.prepare(`DELETE FROM playlist_tracks WHERE playlist_id = ?`).run(
        rule.playlistId
      );
      const ins = db.prepare(
        `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`
      );
      ids.forEach((tid, idx) => ins.run(rule.playlistId, tid, idx));
    });
    tx(combinedIds);
  }

  let queuedCount = 0;
  if (rule.autoDownloadMissing && missingTracks.length > 0) {
    const { slskdUrl, slskdApiKey } = getSlskdConfig();
    const sourceMode = cfg.integrations?.preferredDownloader || 'auto';
    for (const tr of missingTracks.slice(0, 15)) {
      queuedCount += 1;
      const jobLabel = `${tr.artist} - ${tr.title}`;
      const job = {
        id: `job-auto-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'track',
        sourceEngine: sourceMode === 'youtube' ? 'youtube' : 'slskd',
        label: jobLabel,
        artist: tr.artist,
        title: tr.title,
        searchText: `${tr.artist} ${tr.title}`,
        status: 'searching',
        message: `[Autopilot: ${rule.playlistName}] Queued ${jobLabel}`,
        matchedPeer: null,
        matchedFormat: null,
        files: [],
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      slskdJobs.set(job.id, job);
      executeSlskdGrabJob(
        job,
        slskdUrl,
        slskdApiKey,
        sourceMode,
        cfg.discoveryFilters
      );
    }
  }

  rules[ruleIdx] = {
    ...rule,
    lastSyncedAt: new Date().toISOString(),
    lastAddedCount: addedCount,
    lastMissingQueuedCount: queuedCount,
    statusMessage: `Synced ${tracks.length} Spotify tracks (${addedCount} added to SQLite playlist, ${queuedCount} missing queued for download).`,
  };

  writeServerConfig({
    autopilotRules: rules,
    playlists: queryPlaylists(),
  });

  return rules[ruleIdx];
}

app.get('/api/autopilot', (_req, res) => {
  const cfg = readServerConfig();
  res.json({
    ok: true,
    rules: cfg.autopilotRules || [],
    picardConfig: cfg.picardConfig || DEFAULT_SERVER_CONFIG.picardConfig,
  });
});

app.post('/api/autopilot/save', (req, res) => {
  const cfg = readServerConfig();
  const incomingRule = req.body?.rule;
  const incomingPicard = req.body?.picardConfig;

  const nextRules = Array.isArray(cfg.autopilotRules)
    ? [...cfg.autopilotRules]
    : [];
  if (
    incomingRule &&
    incomingRule.playlistId &&
    (incomingRule.sourceUrl || incomingRule.spotifyUrl)
  ) {
    const existingIdx = nextRules.findIndex(
      (r) =>
        r.id === incomingRule.id || r.playlistId === incomingRule.playlistId
    );
    const normalizedRule = {
      id: incomingRule.id || `ap-${Date.now()}`,
      playlistId: incomingRule.playlistId,
      playlistName: incomingRule.playlistName || 'Linked Playlist',
      sourceUrl: String(
        incomingRule.sourceUrl || incomingRule.spotifyUrl
      ).trim(),
      spotifyUrl: String(
        incomingRule.spotifyUrl || incomingRule.sourceUrl
      ).trim(),
      schedule: incomingRule.schedule || incomingRule.interval || 'weekly',
      interval: incomingRule.interval || incomingRule.schedule || 'weekly',
      autoDownloadMissing: incomingRule.autoDownloadMissing !== false,
      enabled: incomingRule.enabled !== false,
      lastSyncedAt: incomingRule.lastSyncedAt || null,
      lastAddedCount: Number(incomingRule.lastAddedCount || 0),
      lastMissingQueuedCount: Number(incomingRule.lastMissingQueuedCount || 0),
      statusMessage:
        incomingRule.statusMessage || 'Scheduled for Autopilot sync',
    };
    if (existingIdx !== -1) {
      nextRules[existingIdx] = normalizedRule;
    } else {
      nextRules.push(normalizedRule);
    }
  }

  const saved = writeServerConfig({
    autopilotRules: nextRules,
    ...(incomingPicard ? { picardConfig: incomingPicard } : {}),
  });

  res.json({
    ok: true,
    rules: saved.autopilotRules || [],
    picardConfig: saved.picardConfig,
  });
});

app.delete('/api/autopilot/:id', (req, res) => {
  const cfg = readServerConfig();
  const id = String(req.params.id || '');
  const nextRules = (cfg.autopilotRules || []).filter(
    (r) => r.id !== id && r.playlistId !== id
  );
  const saved = writeServerConfig({ autopilotRules: nextRules });
  res.json({ ok: true, rules: saved.autopilotRules || [] });
});

app.post('/api/autopilot/sync-now', async (req, res) => {
  try {
    const ruleId = String(req.body?.ruleId || '').trim();
    const updatedRule = await runSingleAutopilotRule(ruleId);
    const cfg = readServerConfig();
    res.json({
      ok: true,
      rule: updatedRule,
      rules: cfg.autopilotRules || [],
      playlists: queryPlaylists(),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Autopilot sync failed.',
    });
  }
});

// ============================================================================
// 13. PLAY STATISTICS & DIAGNOSTIC LOGS
// ============================================================================

app.post('/api/stats/record-play', (req, res) => {
  try {
    const rawTrack = req.body?.track || {
      id: req.body?.trackId || req.body?.id,
      title: req.body?.title,
      artist: req.body?.artist,
      album: req.body?.album,
      duration: req.body?.duration,
    };
    if (!rawTrack || !rawTrack.id) {
      return res.status(400).json({ ok: false, error: 'Missing track data.' });
    }

    const nowIso = new Date().toISOString();
    // Update SQLite tracks table play_count & last_played_at
    db.prepare(
      `UPDATE tracks SET play_count = COALESCE(play_count, 0) + 1, last_played_at = ? WHERE id = ?`
    ).run(nowIso, String(rawTrack.id));

    const cfg = readServerConfig();
    const stats = { ...(cfg.playStats || {}) };
    const prev = stats[rawTrack.id] || {
      trackId: rawTrack.id,
      title: rawTrack.title || 'Untitled',
      artist: rawTrack.artist || 'Unknown Artist',
      album: rawTrack.album || '',
      playCount: 0,
      lastPlayedAt: null,
      totalListenSeconds: 0,
    };
    stats[rawTrack.id] = {
      ...prev,
      title: rawTrack.title || prev.title,
      artist: rawTrack.artist || prev.artist,
      album: rawTrack.album || prev.album,
      playCount: (prev.playCount || 0) + 1,
      lastPlayedAt: nowIso,
      totalListenSeconds:
        (prev.totalListenSeconds || 0) + Number(rawTrack.duration || 180),
    };
    writeServerConfig({ playStats: stats });
    return res.json({ ok: true, stat: stats[rawTrack.id], playStats: stats });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to record play stat.',
    });
  }
});

async function checkBinaryInstalled(binName) {
  try {
    const { stdout } = await execFileAsync(binName, ['--version'], {
      timeout: 3000,
    });
    return {
      installed: true,
      version: String(stdout || '').split('\n')[0].trim(),
    };
  } catch {
    return { installed: false, version: null };
  }
}

app.get('/api/debug/logs', async (_req, res) => {
  const [ytDlpInfo, ffmpegInfo] = await Promise.all([
    checkBinaryInstalled('yt-dlp'),
    checkBinaryInstalled('ffmpeg'),
  ]);
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    logs: serverDebugLogs,
    serverInfo: {
      uptimeSec: Math.round(process.uptime()),
      nodeVersion: process.version,
      port: Number(process.env.BROKEIFY_PORT || process.env.PORT || 3487),
      configPath: CONFIG_FILE_PATH,
      dbPath: DB_PATH,
      musicDir: MUSIC_DIR,
      debugLogPath: DEBUG_LOGS_FILE_PATH,
      ytDlpAvailable: ytDlpInfo.installed,
      ytDlpVersion: ytDlpInfo.version,
      ffmpegAvailable: ffmpegInfo.installed,
      activeGrabJobs: Array.from(slskdJobs.values()).filter(
        (j) => j.status === 'searching' || j.status === 'downloading'
      ).length,
      memoryRssMb: Math.round((mem.rss || 0) / (1024 * 1024)),
    },
  });
});

app.post('/api/debug/logs', (req, res) => {
  const incoming = req.body?.entry;
  if (!incoming || !incoming.message) {
    return res.status(400).json({ ok: false, error: 'Missing log entry.' });
  }
  const saved = pushServerLog(
    incoming.level || 'info',
    incoming.category || 'client',
    incoming.message,
    {
      source: 'client',
      details: incoming.details,
      endpoint: incoming.endpoint,
      statusCode: incoming.statusCode,
      hint: incoming.hint,
    }
  );
  return res.json({ ok: true, entry: saved });
});

app.delete('/api/debug/logs', (_req, res) => {
  serverDebugLogs = [];
  saveServerDebugLogs();
  pushServerLog(
    'info',
    'system',
    'Cleared diagnostic & debug log buffer.',
    { source: 'server' }
  );
  return res.json({ ok: true, logs: serverDebugLogs });
});

app.post('/api/debug/diagnostics', async (_req, res) => {
  const cfg = readServerConfig();
  const counts = getLocalLibraryStats();
  const checks = [];

  // 1. Embedded SQLite Database & /data Storage Check
  try {
    const t0 = Date.now();
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    checks.push({
      id: 'sqlite',
      name: 'Embedded SQLite Database (better-sqlite3)',
      category: 'system',
      status: 'ok',
      latencyMs: Date.now() - t0,
      summary: `Online at ${DB_PATH} (${counts.totalTracks} tracks, ${counts.totalAlbums} albums, ${counts.totalArtists} artists)`,
      details: `Music Root: ${MUSIC_DIR} | Covers Cache: ${COVERS_DIR}`,
    });
  } catch (err) {
    checks.push({
      id: 'sqlite',
      name: 'Embedded SQLite Database (better-sqlite3)',
      category: 'system',
      status: 'error',
      summary: `Cannot write to ${DATA_DIR}`,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Chokidar /music Scanner & EBU R128 LUFS Engine Check
  const [ytDlpInfo, ffmpegInfo] = await Promise.all([
    checkBinaryInstalled('yt-dlp'),
    checkBinaryInstalled('ffmpeg'),
  ]);
  checks.push({
    id: 'scanner',
    name: 'Chokidar /music Watcher & EBU R128 LUFS Engine',
    category: 'audio',
    status: 'ok',
    summary: `Monitoring ${MUSIC_DIR} (${
      ffmpegInfo.installed
        ? 'ffmpeg EBU R128 LUFS active'
        : 'metadata ReplayGain active'
    })`,
    details: `Last scan: ${scannerState.lastScanAt || 'In progress'} | LUFS Queue: ${scannerState.lufsQueueLength}`,
  });

  // 3. slskd Soulseek Check
  const { slskdUrl, slskdApiKey } = getSlskdConfig();
  if (!slskdUrl || !slskdApiKey) {
    checks.push({
      id: 'slskd',
      name: 'slskd Soulseek P2P Engine',
      category: 'slskd',
      status: 'warn',
      summary: 'Optional — API Key not configured',
    });
  } else {
    const t0 = Date.now();
    try {
      const resp = await fetch(`${slskdUrl}/api/v0/application`, {
        headers: buildSlskdHeaders(slskdApiKey),
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - t0;
      checks.push({
        id: 'slskd',
        name: 'slskd Soulseek P2P Engine',
        category: 'slskd',
        status: resp.ok ? 'ok' : 'error',
        latencyMs,
        summary: resp.ok
          ? `Reachable at ${slskdUrl} (${latencyMs}ms)`
          : `slskd returned HTTP ${resp.status}`,
      });
    } catch (err) {
      checks.push({
        id: 'slskd',
        name: 'slskd Soulseek P2P Engine',
        category: 'slskd',
        status: 'error',
        summary: `Unreachable at ${slskdUrl}`,
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. Lidarr Check
  const { lidarrUrl, lidarrApiKey } = getLidarrConfig();
  if (!lidarrUrl || !lidarrApiKey) {
    checks.push({
      id: 'lidarr',
      name: 'Lidarr Music Manager',
      category: 'lidarr',
      status: 'warn',
      summary: 'Optional — API Key not configured',
    });
  } else {
    const t0 = Date.now();
    try {
      const resp = await fetch(`${lidarrUrl}/api/v1/system/status`, {
        headers: buildLidarrHeaders(lidarrApiKey),
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - t0;
      checks.push({
        id: 'lidarr',
        name: 'Lidarr Music Manager',
        category: 'lidarr',
        status: resp.ok ? 'ok' : 'error',
        latencyMs,
        summary: resp.ok
          ? `Connected to Lidarr (${latencyMs}ms)`
          : `Lidarr returned HTTP ${resp.status}`,
      });
    } catch (err) {
      checks.push({
        id: 'lidarr',
        name: 'Lidarr Music Manager',
        category: 'lidarr',
        status: 'error',
        summary: `Unreachable at ${lidarrUrl}`,
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 5. ListenBrainz Check
  const lbUser = String(cfg.integrations?.listenbrainzUsername || '').trim();
  if (!lbUser) {
    checks.push({
      id: 'listenbrainz',
      name: 'ListenBrainz Discovery & Scrobbler',
      category: 'listenbrainz',
      status: 'warn',
      summary: 'Optional — Username not configured',
    });
  } else {
    const t0 = Date.now();
    try {
      const resp = await fetch(
        `https://api.listenbrainz.org/1/user/${encodeURIComponent(
          lbUser
        )}/playlists/createdfor?count=1`,
        { signal: AbortSignal.timeout(6000) }
      );
      const latencyMs = Date.now() - t0;
      checks.push({
        id: 'listenbrainz',
        name: 'ListenBrainz Discovery & Scrobbler',
        category: 'listenbrainz',
        status: resp.ok ? 'ok' : 'error',
        latencyMs,
        summary: resp.ok
          ? `Connected for user "${lbUser}" (${latencyMs}ms)`
          : `ListenBrainz returned HTTP ${resp.status}`,
      });
    } catch (err) {
      checks.push({
        id: 'listenbrainz',
        name: 'ListenBrainz Discovery & Scrobbler',
        category: 'listenbrainz',
        status: 'error',
        summary: 'Failed to reach api.listenbrainz.org',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 6. Toolchain Check
  checks.push({
    id: 'toolchain',
    name: 'YouTube Music & Picard Audio Toolchain',
    category: 'youtube',
    status: ytDlpInfo.installed || ffmpegInfo.installed ? 'ok' : 'warn',
    summary: ytDlpInfo.installed
      ? `yt-dlp (${ytDlpInfo.version}) & ${
          ffmpegInfo.installed ? 'ffmpeg ready' : 'ffmpeg optional'
        }`
      : 'Docker image includes yt-dlp + ffmpeg',
  });

  return res.json({
    ok: true,
    checks,
    logs: serverDebugLogs,
  });
});

// ============================================================================
// 14. VERSION CHECKER
// ============================================================================

function readLocalVersionMetadata() {
  const versionFile = path.join(__dirname, 'version.json');
  try {
    if (fs.existsSync(versionFile)) {
      const raw = fs.readFileSync(versionFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        version: parsed.version || '3.0.0',
        channel: parsed.channel || 'standalone',
        displayVersion:
          parsed.displayVersion || `v${parsed.version || '3.0.0'}-standalone`,
        repository: parsed.repository || 'Mr-Nickey/brokeify',
        branch: parsed.branch || 'main',
        changelog: Array.isArray(parsed.changelog) ? parsed.changelog : [],
      };
    }
  } catch {}
  return {
    version: '3.0.0',
    channel: 'standalone',
    displayVersion: 'v3.0.0-standalone',
    repository: 'Mr-Nickey/brokeify',
    branch: 'main',
    changelog: [
      'v3.0.0-standalone: All-in-one standalone SQLite music server, chokidar scanner, EBU R128 LUFS normalizer & HTTP 206 Range streaming engine',
    ],
  };
}

app.get('/api/version', (_req, res) => {
  const localMeta = readLocalVersionMetadata();
  res.json({
    ok: true,
    version: {
      localVersion: localMeta.version,
      localDisplayVersion: localMeta.displayVersion,
      localChannel: localMeta.channel,
      localCommitSha: null,
      localBuildTime: null,
      remoteVersion: localMeta.version,
      remoteDisplayVersion: localMeta.displayVersion,
      remoteCommitSha: null,
      remoteCommitMessage: 'Standalone SQLite Music Server Engine',
      remoteCommitDate: new Date().toISOString(),
      remoteCommitUrl: `https://github.com/${localMeta.repository}`,
      repository: localMeta.repository,
      branch: localMeta.branch,
      updateAvailable: false,
      statusSummary: `Running ${localMeta.displayVersion} (Standalone Native SQLite Engine).`,
      checkedAt: new Date().toISOString(),
      changelog: localMeta.changelog,
    },
  });
});

app.post('/api/version/check', (_req, res) => {
  const localMeta = readLocalVersionMetadata();
  res.json({
    ok: true,
    version: {
      localVersion: localMeta.version,
      localDisplayVersion: localMeta.displayVersion,
      localChannel: localMeta.channel,
      updateAvailable: false,
      statusSummary: `Running ${localMeta.displayVersion} (Standalone Native SQLite Engine).`,
      checkedAt: new Date().toISOString(),
      changelog: localMeta.changelog,
    },
  });
});

// ============================================================================
// 15. START CHOKIDAR WATCHER + EXPRESS / VITE SERVER
// ============================================================================

async function startServer() {
  startChokidarMusicWatcher();

  const PORT = Number(process.env.BROKEIFY_PORT || process.env.PORT || 3487);
  const distPath = path.join(__dirname, 'dist');
  const distIndex = path.join(distPath, 'index.html');
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true, hmr: false },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      console.log('[Brokeify] Mounted Vite development middleware');
    } catch (err) {
      console.warn(
        '[Brokeify] Vite dev middleware unavailable, serving static dist:',
        err
      );
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(distIndex);
      });
    }
  } else {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(distIndex);
    });
  }

  const portsToBind = Array.from(new Set([PORT, 3487, 3000]));
  for (const p of portsToBind) {
    if (p === PORT) {
      app.listen(p, '0.0.0.0', () => {
        console.log(
          `[Brokeify Standalone Server] Listening on http://0.0.0.0:${p} (SQLite: ${DB_PATH} | Music: ${MUSIC_DIR})`
        );
        pushServerLog(
          'success',
          'system',
          `Brokeify Standalone Server started on port ${p} (SQLite: ${DB_PATH} | Music: ${MUSIC_DIR})`
        );
      });
    } else {
      try {
        const extraServer = app.listen(p, '0.0.0.0', () => {
          console.log(
            `[Brokeify Standalone Server] Dual-port listener active on http://0.0.0.0:${p}`
          );
        });
        extraServer.on('error', () => {});
      } catch {}
    }
  }
}

startServer();
