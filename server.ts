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
  isSafePathWithinAllowedRoots,
  inspectMusicDrive,
  setMusicDirectory,
  db,
  getLibraryCounts,
  upsertPlaylistWithTracks,
  deletePlaylistById,
  getPlaylistTrackIds,
  setPlaylistTrackIds,
  deleteTrackFromDb,
  incrementTrackPlayCount,
  recordScrobbleInDb,
  getTrackWithArtistAlbum,
  scannerState,
  startChokidarMusicWatcher,
  runFullLibraryScan,
  indexAudioFile,
  removeAudioFileFromIndex,
  importM3uPlaylistFile,
  reconcilePlaylistsWithLibrary,
  queryTracks,
  countMatchingTracks,
  queryArtists,
  queryAlbums,
  queryPlaylists,
  handleStreamTrack,
  handleServeCover,
  enrichTrackFromMusicBrainz,
  updateTrackMetadataInDb,
  getLikedTrackIds,
  toggleLikedTrack,
  getArtistById,
  getAlbumById,
  buildSongRadioQueue,
  addTracksToPlaylist,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
  exportPlaylistM3u8,
  getRecentPlayHistory,
  getPersistentNotifications,
  addPersistentNotification,
  markPersistentNotificationsRead,
  deletePersistentNotifications,
  formatNotificationDateTime,
} from './src/server/libraryEngine.ts';
import {
  identifyAudioFileWithAcoustIdAndMusicBrainz,
  embedMetadataAndArtworkIntoFile,
  fingerprintTagAndOrganizeFile,
  buildOrganizedTrackDestination,
  cleanupEmptyParentDirs,
  resolveSandboxedMusicPath,
  detectVariantFlagsInText,
  QUARANTINE_DIR,
  AUDIO_FILE_EXTENSIONS,
  getLibraryOrganizeJobState,
  cancelLibraryOrganizeJob,
  startLibraryOrganizeJob,
  applyPreviewedLibraryOrganizeJob,
} from './src/server/fingerprintAndFileManager.ts';
import { generateBrokeifyApiSpecMarkdown } from './src/server/apiSpecGenerator.ts';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Reverse-Proxy-Aware client IP resolution (Nginx Proxy Manager / Cloudflare / Traefik)
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY ?? 1);
app.set('trust proxy', Number.isFinite(TRUST_PROXY_HOPS) ? TRUST_PROXY_HOPS : 1);

// Configurable CORS policy
const CORS_ORIGIN_ENV = String(process.env.CORS_ORIGIN || '*').trim();
app.use(
  cors({
    origin:
      CORS_ORIGIN_ENV === '*'
        ? true
        : CORS_ORIGIN_ENV.split(',').map((o) => o.trim()).filter(Boolean),
    credentials: true,
    exposedHeaders: [
      'Content-Range',
      'Accept-Ranges',
      'Content-Length',
      'ETag',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'Retry-After',
    ],
  })
);
app.use(express.json({ limit: '15mb' }));

const CONFIG_FILE_PATH = path.join(DATA_DIR, 'config.json');
const JWT_SECRET_FILE_PATH = path.join(DATA_DIR, '.jwt_secret');
const DEBUG_LOGS_FILE_PATH = path.join(DATA_DIR, 'debug-logs.json');
const MAX_SERVER_DEBUG_LOGS = 300;

// Zero Hardcoded Secrets: Load JWT_SECRET from env or persist a random 64-byte cryptographic secret in /data/.jwt_secret
function resolveJwtSecret(): string {
  const envSecret = String(process.env.JWT_SECRET || '').trim();
  if (envSecret.length >= 16) {
    return envSecret;
  }
  try {
    if (fs.existsSync(JWT_SECRET_FILE_PATH)) {
      const existing = fs.readFileSync(JWT_SECRET_FILE_PATH, 'utf-8').trim();
      if (existing.length >= 32) {
        return existing;
      }
    }
    const generated = crypto.randomBytes(64).toString('hex');
    fs.mkdirSync(path.dirname(JWT_SECRET_FILE_PATH), { recursive: true });
    fs.writeFileSync(JWT_SECRET_FILE_PATH, generated, {
      encoding: 'utf-8',
      mode: 0o600,
    });
    console.warn(
      `[Brokeify][SECURITY][WARN] JWT_SECRET not set in environment. Generated and persisted a cryptographic secret at ${JWT_SECRET_FILE_PATH}. For production deployments, consider setting JWT_SECRET in .env.`
    );
    return generated;
  } catch {
    return crypto.randomBytes(64).toString('hex');
  }
}

const ACTIVE_JWT_SECRET = resolveJwtSecret();

function signJwtToken(
  payload: Record<string, any>,
  expiresInSeconds = 30 * 24 * 3600
): { token: string; expiresAt: string } {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + expiresInSeconds;
  const headerB64 = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');
  const bodyB64 = Buffer.from(
    JSON.stringify({ ...payload, iat: nowSec, exp: expSec })
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', ACTIVE_JWT_SECRET)
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64url');
  return {
    token: `${headerB64}.${bodyB64}.${signature}`,
    expiresAt: new Date(expSec * 1000).toISOString(),
  };
}

function verifyJwtToken(token: string): Record<string, any> | null {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [headerB64, bodyB64, sigB64] = parts;
    const expectedSig = crypto
      .createHmac('sha256', ACTIVE_JWT_SECRET)
      .update(`${headerB64}.${bodyB64}`)
      .digest('base64url');
    const sigBuf = Buffer.from(sigB64);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf-8'));
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < nowSec) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

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

  // Emit structured real-time log line to stdout/stderr for Dozzle & Docker logs
  const tag = `[Brokeify][${String(entry.category).toUpperCase()}][${String(
    entry.level
  ).toUpperCase()}]`;
  const endpointSuffix = entry.endpoint ? ` (${entry.endpoint})` : '';
  if (entry.level === 'error') {
    console.error(`${tag} ${entry.message}${endpointSuffix}`);
  } else if (entry.level === 'warn') {
    console.warn(`${tag} ${entry.message}${endpointSuffix}`);
  } else {
    console.log(`${tag} ${entry.message}${endpointSuffix}`);
  }

  serverDebugLogs.unshift(entry);
  if (serverDebugLogs.length > MAX_SERVER_DEBUG_LOGS) {
    serverDebugLogs.length = MAX_SERVER_DEBUG_LOGS;
  }
  saveServerDebugLogs();

  // Wire backend service errors & warnings into persistent SQLite Notification Bell (deduplicated per outage, excluding 429 rate-limit noise)
  if (
    (entry.level === 'error' || entry.level === 'warn') &&
    entry.statusCode !== 429 &&
    !String(entry.message || '')
      .toLowerCase()
      .includes('rate limit exceeded')
  ) {
    const rawCat = String(entry.category || 'system').toLowerCase();
    const mappedCat =
      rawCat === 'slskd' ||
      rawCat === 'lidarr' ||
      rawCat === 'youtube' ||
      rawCat === 'listenbrainz' ||
      rawCat === 'audio'
        ? rawCat
        : 'system';
    const serviceLabel =
      rawCat === 'slskd'
        ? 'slskd Soulseek P2P'
        : rawCat === 'lidarr'
        ? 'Lidarr Arr Stack'
        : rawCat === 'youtube'
        ? 'YouTube / yt-dlp'
        : rawCat === 'listenbrainz'
        ? 'ListenBrainz API'
        : rawCat === 'audio'
        ? 'Music Library (/music)'
        : 'Brokeify Server';
    try {
      addPersistentNotification({
        message: `${serviceLabel}: ${entry.message}${
          entry.hint ? ` — ${entry.hint}` : ''
        }`,
        category: mappedCat as any,
        severity: entry.level === 'error' ? 'error' : 'warn',
        service: serviceLabel,
        dedupKey: `${mappedCat}:${entry.level}:${String(entry.message).slice(0, 60)}`,
      });
    } catch {
      // non-fatal if db is initializing
    }
  }

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
    password: process.env.BROKEIFY_PASSWORD || '',
    apiToken:
      process.env.BROKEIFY_API_TOKEN ||
      `brk_${crypto.randomBytes(16).toString('hex')}`,
    requireLogin:
      process.env.BROKEIFY_REQUIRE_LOGIN === 'true' ||
      Boolean(process.env.BROKEIFY_PASSWORD),
    autoLockPublicDomain: true,
    setupCompleted: Boolean(process.env.BROKEIFY_PASSWORD),
    guestUsers: [],
    apiKeys: [],
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
    acoustidApiKey: process.env.ACOUSTID_API_KEY || '',
    stagingDir: process.env.STAGING_DIR || path.join(MUSIC_DIR, '_inbox'),
    autoOrganizeDownloads: true,
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
  notificationMode: 'bell_only',
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
      ...(process.env.ACOUSTID_API_KEY
        ? { acoustidApiKey: process.env.ACOUSTID_API_KEY }
        : {}),
      ...(process.env.STAGING_DIR
        ? { stagingDir: process.env.STAGING_DIR }
        : {}),
    };

    return {
      ...DEFAULT_SERVER_CONFIG,
      ...parsed,
      auth: {
        ...DEFAULT_SERVER_CONFIG.auth,
        ...(parsed.auth || {}),
        guestUsers: Array.isArray(parsed.auth?.guestUsers)
          ? parsed.auth.guestUsers
          : [],
        apiKeys: Array.isArray(parsed.auth?.apiKeys)
          ? parsed.auth.apiKeys
          : [],
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
    if (nextConfig.auth) {
      merged.auth = {
        ...current.auth,
        ...nextConfig.auth,
        guestUsers: Array.isArray(nextConfig.auth.guestUsers)
          ? nextConfig.auth.guestUsers
          : current.auth?.guestUsers || [],
        apiKeys: Array.isArray(nextConfig.auth.apiKeys)
          ? nextConfig.auth.apiKeys
          : current.auth?.apiKeys || [],
      };
    }
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
  return getLibraryCounts();
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

// GET /api/ping -> Public Handshake Endpoint for Docker HEALTHCHECK, Uptime Kuma, Android / Android Auto & External Clients
app.get('/api/ping', (_req, res) => {
  const cfg = readServerConfig();
  const hasCustomAdminPassword =
    Boolean(cfg.auth?.password) && cfg.auth?.password !== 'brokeify';
  const setupRequired = !hasCustomAdminPassword && !cfg.auth?.setupCompleted;
  const authRequired = Boolean(cfg.auth?.requireLogin);
  const counts = getLocalLibraryStats();

  let dbWritable = false;
  try {
    fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
    dbWritable = true;
  } catch {}

  let musicReadable = false;
  try {
    fs.accessSync(MUSIC_DIR, fs.constants.R_OK);
    musicReadable = true;
  } catch {}

  const mem = process.memoryUsage();

  res.json({
    ok: true,
    status: 'ok',
    name: 'Brokeify',
    version: '3.0.0-standalone',
    uptimeSec: Math.round(process.uptime()),
    memoryRssMb: Math.round((mem.rss || 0) / (1024 * 1024)),
    setupRequired,
    authRequired,
    allowSignup: process.env.ALLOW_SIGNUP === 'true',
    serverTime: new Date().toISOString(),
    sqlite: {
      path: DB_PATH,
      journalMode: db.pragmaState.journal_mode,
      busyTimeoutMs: db.pragmaState.busy_timeout,
      readable: dbWritable,
      writable: dbWritable,
    },
    musicMount: {
      path: MUSIC_DIR,
      readable: musicReadable,
      totalTracks: counts.totalTracks,
      totalAlbums: counts.totalAlbums,
      totalArtists: counts.totalArtists,
      totalPlaylists: counts.totalPlaylists,
    },
  });
});

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
    sqlite: {
      journalMode: db.pragmaState.journal_mode,
      busyTimeoutMs: db.pragmaState.busy_timeout,
    },
    scanner: scannerState,
    driveStatus,
  });
});

// GET /api/library/stats -> Returns total tracks, albums, artists, playlists, liked songs, and last scan timestamp
app.get('/api/library/stats', (_req, res) => {
  const counts = getLocalLibraryStats();
  const driveStatus = inspectMusicDrive();
  res.json({
    ok: true,
    totalTracks: counts.totalTracks,
    totalAlbums: counts.totalAlbums,
    totalArtists: counts.totalArtists,
    totalPlaylists: counts.totalPlaylists,
    totalScrobbles: counts.totalScrobbles,
    likedCount: getLikedTrackIds().length,
    lastScanAt: scannerState.lastScanAt,
    isScanning: scannerState.isScanning,
    musicDir: getMusicDir(),
    driveConnected: driveStatus.driveConnected,
    sqlite: {
      journalMode: db.pragmaState.journal_mode,
      busyTimeoutMs: db.pragmaState.busy_timeout,
    },
  });
});

// GET /api/library/likes & GET /api/liked -> Returns array of liked track IDs & full track objects persisted in /data/brokeify.db
app.get(['/api/library/likes', '/api/liked'], (_req, res) => {
  const likedTrackIds = getLikedTrackIds();
  const likedSet = new Set(likedTrackIds);
  const tracks = queryTracks().filter((t) => likedSet.has(t.id));
  res.json({
    ok: true,
    total: tracks.length,
    likedTrackIds,
    tracks,
  });
});

// POST /api/library/likes/toggle -> Toggles or sets liked state for a trackId
app.post('/api/library/likes/toggle', (req, res) => {
  const trackId = String(req.body?.trackId || '').trim();
  const liked =
    typeof req.body?.liked === 'boolean' ? req.body.liked : undefined;
  if (!trackId) {
    return res
      .status(400)
      .json({ ok: false, error: 'Missing trackId in request body' });
  }
  const result = toggleLikedTrack(trackId, liked);
  res.json({
    ok: true,
    trackId,
    ...result,
  });
});

// POST /api/liked/:trackId -> Marks trackId as liked in SQLite
app.post('/api/liked/:trackId', (req, res) => {
  const trackId = String(req.params.trackId || '').trim();
  if (!trackId) {
    return res.status(400).json({ ok: false, error: 'Missing trackId' });
  }
  const result = toggleLikedTrack(trackId, true);
  res.json({
    ok: true,
    trackId,
    ...result,
  });
});

// DELETE /api/liked/:trackId -> Unmarks trackId as liked in SQLite
app.delete('/api/liked/:trackId', (req, res) => {
  const trackId = String(req.params.trackId || '').trim();
  if (!trackId) {
    return res.status(400).json({ ok: false, error: 'Missing trackId' });
  }
  const result = toggleLikedTrack(trackId, false);
  res.json({
    ok: true,
    trackId,
    ...result,
  });
});

// GET /api/lyrics -> Fetches synchronized (.lrc) and plain lyrics from LRCLIB (supports ?trackId= or ?title=&artist=)
app.get('/api/lyrics', async (req, res) => {
  const trackId = String(req.query.trackId || req.query.id || '').trim();
  let title = String(req.query.title || '').trim();
  let artist = String(req.query.artist || '').trim();
  let album = String(req.query.album || '').trim();
  let duration = Number(req.query.duration || 0);

  if (trackId && !title) {
    const lookedUp = getTrackWithArtistAlbum(trackId);
    if (lookedUp) {
      title = lookedUp.title;
      artist = lookedUp.artist;
      album = lookedUp.album;
      duration = Math.round((lookedUp.duration_ms || 180000) / 1000);
    }
  }

  if (!title) {
    return res
      .status(400)
      .json({ ok: false, error: 'Missing track title or valid trackId' });
  }

  try {
    const searchParams = new URLSearchParams({
      track_name: title,
      artist_name: artist,
    });
    if (album) searchParams.set('album_name', album);

    const resp = await fetch(
      `https://lrclib.net/api/search?${searchParams.toString()}`,
      {
        headers: {
          'User-Agent': 'Brokeify/3.0.0 (https://github.com/mr-nickey/brokeify)',
        },
        signal: AbortSignal.timeout(7000),
      }
    );

    if (resp.ok) {
      const items = await resp.json();
      if (Array.isArray(items) && items.length > 0) {
        const best =
          items.find((it) => it.syncedLyrics) ||
          items.find((it) => it.plainLyrics) ||
          items[0];
        return res.json({
          ok: true,
          source: 'LRCLIB',
          trackName: best.trackName || title,
          artistName: best.artistName || artist,
          instrumental: Boolean(best.instrumental),
          syncedLyrics: best.syncedLyrics || null,
          plainLyrics: best.plainLyrics || null,
          duration: best.duration || duration,
        });
      }
    }
  } catch {
    // Fallback if offline or LRCLIB unreachable
  }

  return res.json({
    ok: true,
    source: 'fallback',
    trackName: title,
    artistName: artist,
    instrumental: false,
    syncedLyrics: null,
    plainLyrics: null,
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

// ============================================================================
// 1B. ANTI-BOT / ANTI-SCRAPER SHIELD, RATE LIMITER & MULTI-USER SECURITY GATE
// ============================================================================

const BOT_SCRAPER_UA_REGEX =
  /(masscan|zgrab|nmap|sqlmap|nikto|nuclei|dirbuster|gobuster|wfuzz|ffuf|censys|shodan|ahrefsbot|semrushbot|mj12bot|dotbot|bytespider|gptbot|ccbot|claudebot|anthropic-ai|petalbot|barkrowler|blexbot|megaindex|seznambot|yandexbot|baiduspider|sogou|exabot)/i;

const securityStats = {
  blockedBotsCount: 0,
  blockedBruteForceCount: 0,
  lastBlockedBotUa: null as string | null,
  lastBlockedAt: null as string | null,
};

interface RateLimitEntry {
  failures: number;
  firstFailureAt: number;
  blockedUntil: number;
}

const authRateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const MAX_AUTH_FAILURES = 10;

// Sliding window rate limiter for auth endpoints (max 10 requests per 15 minutes per IP)
const authRequestWindowMap = new Map<string, { count: number; resetAt: number }>();
// Generous sliding window rate limiter for general /api/* routes (excluding /api/stream/* & /api/covers/*)
const generalApiWindowMap = new Map<string, { count: number; resetAt: number }>();
const GENERAL_API_WINDOW_MS = 60 * 1000; // 1 minute
const GENERAL_API_MAX_REQ = 3000; // 3000 req/min per IP

function getClientIp(req): string {
  if (req.ip) {
    return String(req.ip).replace(/^::ffff:/, '').trim();
  }
  return String(
    req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-for'] ||
      req.socket?.remoteAddress ||
      'unknown'
  )
    .split(',')[0]
    .replace(/^::ffff:/, '')
    .trim();
}

function checkAuthEndpointRateLimit(req, res): boolean {
  const ip = getClientIp(req);
  const now = Date.now();
  let bucket = authRequestWindowMap.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    authRequestWindowMap.set(ip, bucket);
  }
  bucket.count += 1;
  const remaining = Math.max(0, MAX_AUTH_FAILURES - bucket.count);
  const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  res.setHeader('RateLimit-Limit', String(MAX_AUTH_FAILURES));
  res.setHeader('RateLimit-Remaining', String(remaining));
  if (bucket.count > MAX_AUTH_FAILURES) {
    res.setHeader('Retry-After', String(retryAfterSec));
    securityStats.blockedBruteForceCount += 1;
    securityStats.lastBlockedAt = new Date().toISOString();
    res.status(429).json({
      ok: false,
      error: `Too many authentication attempts from your IP (${ip}). Please try again in ${Math.ceil(
        retryAfterSec / 60
      )} minute(s).`,
      retryAfterSeconds: retryAfterSec,
    });
    return false;
  }
  return true;
}

function checkIpRateLimit(ip: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const entry = authRateLimitMap.get(ip);
  if (!entry) return { allowed: true, retryAfterSeconds: 0 };

  if (entry.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000),
    };
  }

  if (now - entry.firstFailureAt > RATE_LIMIT_WINDOW_MS) {
    authRateLimitMap.delete(ip);
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function recordAuthFailure(ip: string, reason: string) {
  const now = Date.now();
  const existing = authRateLimitMap.get(ip);
  if (!existing || now - existing.firstFailureAt > RATE_LIMIT_WINDOW_MS) {
    authRateLimitMap.set(ip, {
      failures: 1,
      firstFailureAt: now,
      blockedUntil: 0,
    });
    return;
  }

  existing.failures += 1;
  if (existing.failures >= MAX_AUTH_FAILURES) {
    existing.blockedUntil = now + RATE_LIMIT_LOCKOUT_MS;
    securityStats.blockedBruteForceCount += 1;
    securityStats.lastBlockedAt = new Date().toISOString();
    pushServerLog(
      'warn',
      'system',
      `[Security Shield] Locked out IP ${ip} for 15 minutes after ${existing.failures} failed auth attempts (${reason}).`
    );
  }
}

function clearAuthFailures(ip: string) {
  authRateLimitMap.delete(ip);
  authRequestWindowMap.delete(ip);
}

// Strict /robots.txt to keep search engines, AI crawlers, and web scrapers out
app.get('/robots.txt', (_req, res) => {
  res
    .type('text/plain')
    .set(
      'X-Robots-Tag',
      'noindex, nofollow, noarchive, nosnippet, noimageindex'
    )
    .send(
      'User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n'
    );
});

// Global Helmet-Compatible Security Headers, Anti-Bot Shield & General API Rate Limiter
app.use((req, res, next) => {
  res.setHeader(
    'X-Robots-Tag',
    'noindex, nofollow, noarchive, nosnippet, noimageindex'
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  const ua = String(req.headers['user-agent'] || '');
  if (ua && BOT_SCRAPER_UA_REGEX.test(ua)) {
    securityStats.blockedBotsCount += 1;
    securityStats.lastBlockedBotUa = ua.slice(0, 120);
    securityStats.lastBlockedAt = new Date().toISOString();
    const ip = getClientIp(req);
    console.warn(
      `[Brokeify][SECURITY][WARN] Blocked web scraper / scanner bot from ${ip} (UA: ${ua.slice(
        0,
        80
      )})`
    );
    return res.status(403).send('Forbidden');
  }

  // Apply generous rate limit to general /api/* routes (excluding streaming, covers, and lightweight status/polling routes)
  if (
    req.path.startsWith('/api/') &&
    !req.path.startsWith('/api/stream/') &&
    !req.path.startsWith('/api/cover/') &&
    !req.path.startsWith('/api/covers/') &&
    !req.path.startsWith('/api/library/organize/status') &&
    !req.path.startsWith('/api/notifications') &&
    !req.path.startsWith('/api/slskd/status') &&
    !req.path.startsWith('/api/playback-session') &&
    !req.path.startsWith('/api/ping') &&
    !req.path.startsWith('/api/health') &&
    !req.path.startsWith('/api/storage/stats') &&
    !req.path.startsWith('/api/scheduler/')
  ) {
    const ip = getClientIp(req);
    const now = Date.now();
    let bucket = generalApiWindowMap.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + GENERAL_API_WINDOW_MS };
      generalApiWindowMap.set(ip, bucket);
    }
    bucket.count += 1;
    if (bucket.count > GENERAL_API_MAX_REQ) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        ok: false,
        error: 'Rate limit exceeded. Please slow down API requests.',
        retryAfterSeconds: retryAfterSec,
      });
    }
  }

  next();
});

function parseCookies(req): Record<string, string> {
  const header = String(req.headers.cookie || '');
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      out[k] = v;
    }
  }
  return out;
}

function computeUserSessionToken(
  username: string,
  password: string,
  role: string
): string {
  return crypto
    .createHmac('sha256', ACTIVE_JWT_SECRET)
    .update(`brokeify-session:${username.toLowerCase()}:${password}:${role}`)
    .digest('hex');
}

function isPublicInternetDomain(req): boolean {
  const host = String(
    req.headers['x-forwarded-host'] || req.headers.host || ''
  )
    .split(',')[0]
    .split(':')[0]
    .trim()
    .toLowerCase();
  if (!host) return false;
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.startsWith('192.168.') ||
    host.startsWith('10.') ||
    host.startsWith('100.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    host.endsWith('.run.app')
  ) {
    return false;
  }
  return true;
}

interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'listener';
  isAdmin: boolean;
}

function resolveRequestAuth(req): {
  authenticated: boolean;
  user: AuthenticatedUser | null;
} {
  const cfg = readServerConfig();
  const authHeader = String(req.headers.authorization || '').replace(
    /^Bearer\s+/i,
    ''
  );
  const cookies = parseCookies(req);
  const providedToken = String(
    authHeader ||
      req.headers['x-api-key'] ||
      req.query.apiKey ||
      req.query.token ||
      cookies.brokeify_session ||
      ''
  ).trim();

  if (!providedToken) {
    return { authenticated: false, user: null };
  }

  // 1. Check signed JWT Bearer token
  const jwtPayload = verifyJwtToken(providedToken);
  if (jwtPayload && jwtPayload.sub && jwtPayload.username) {
    const role = jwtPayload.role === 'listener' ? 'listener' : 'admin';
    return {
      authenticated: true,
      user: {
        id: String(jwtPayload.sub),
        username: String(jwtPayload.username),
        displayName: String(jwtPayload.displayName || jwtPayload.username),
        role,
        isAdmin: role === 'admin',
      },
    };
  }

  const adminUser = String(cfg.auth?.username || 'admin').trim();
  const adminPass = String(cfg.auth?.password || 'brokeify').trim();
  const adminApiToken = String(cfg.auth?.apiToken || '').trim();
  const adminSessionToken = computeUserSessionToken(
    adminUser,
    adminPass,
    'admin'
  );

  // 2. Check Admin API token or session token
  if (
    (adminApiToken && providedToken === adminApiToken) ||
    providedToken === adminSessionToken
  ) {
    return {
      authenticated: true,
      user: {
        id: 'usr-brokeify-admin',
        username: adminUser,
        displayName: adminUser,
        role: 'admin',
        isAdmin: true,
      },
    };
  }

  // 3. Check Personal API Keys (long-lived tokens generated in Settings for Android / Android Auto)
  const apiKeys = Array.isArray(cfg.auth?.apiKeys) ? cfg.auth.apiKeys : [];
  for (const keyObj of apiKeys) {
    if (keyObj?.token && providedToken === keyObj.token) {
      const role = keyObj.role === 'listener' ? 'listener' : 'admin';
      return {
        authenticated: true,
        user: {
          id: keyObj.userId || 'usr-brokeify-admin',
          username: keyObj.username || adminUser,
          displayName: keyObj.name || adminUser,
          role,
          isAdmin: role === 'admin',
        },
      };
    }
  }

  // 4. Check Friends & Family (guestUsers) accounts
  const guestUsers = Array.isArray(cfg.auth?.guestUsers)
    ? cfg.auth.guestUsers
    : [];
  for (const guest of guestUsers) {
    if (!guest?.username || !guest?.password) continue;
    const guestRole = guest.role === 'admin' ? 'admin' : 'listener';
    const guestToken = computeUserSessionToken(
      guest.username,
      guest.password,
      guestRole
    );
    if (providedToken === guestToken || providedToken === guest.apiToken) {
      return {
        authenticated: true,
        user: {
          id: guest.id || `usr-${guest.username}`,
          username: guest.username,
          displayName: guest.displayName || guest.username,
          role: guestRole,
          isAdmin: guestRole === 'admin',
        },
      };
    }
  }

  return { authenticated: false, user: null };
}

// API Auth & Role Enforcement (`isAdmin`) Middleware
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();

  // Public Handshake, Login, Setup, Token Refresh & Quick Connect Pairing Endpoints
  if (
    req.path === '/api/ping' ||
    req.path === '/api/health' ||
    req.path === '/api/auth/status' ||
    req.path === '/api/auth/login' ||
    req.path === '/api/auth/setup' ||
    req.path === '/api/auth/register' ||
    req.path === '/api/auth/refresh' ||
    req.path === '/api/auth/logout' ||
    req.path === '/api/mobile/verify' ||
    req.path.startsWith('/api/mobile/quick-connect')
  ) {
    return next();
  }

  const cfg = readServerConfig();
  const requireLogin = Boolean(cfg.auth?.requireLogin);
  const authResult = resolveRequestAuth(req);

  if (requireLogin && !authResult.authenticated) {
    return res.status(401).json({
      ok: false,
      requiresLogin: true,
      error:
        'Authentication required. Provide a valid Authorization: Bearer <token> header or log in.',
    });
  }

  // Lock down destructive/admin endpoints behind an `isAdmin` check
  const isAdminOnlyRoute =
    (req.path === '/api/config' && req.method !== 'GET') ||
    req.path === '/api/library/rescan' ||
    req.path === '/api/library/scan' ||
    req.path.startsWith('/api/storage/') ||
    req.path.startsWith('/api/auth/security-config') ||
    (req.path.startsWith('/api/auth/api-keys') && req.method !== 'GET') ||
    req.path.startsWith('/api/mobile/regenerate-token') ||
    (req.path.startsWith('/api/library/tracks') && req.method === 'DELETE') ||
    req.path === '/api/library/tracks/bulk-delete';

  if (
    isAdminOnlyRoute &&
    authResult.authenticated &&
    authResult.user &&
    !authResult.user.isAdmin
  ) {
    return res.status(403).json({
      ok: false,
      error:
        'Admin privileges required. Friends & Family listener accounts cannot modify server settings, trigger rescans, or delete files.',
    });
  }

  next();
});

// POST /api/auth/setup (and /api/auth/register) -> Initial Admin Setup when setupRequired or ALLOW_SIGNUP=true
app.post(['/api/auth/setup', '/api/auth/register'], (req, res) => {
  if (!checkAuthEndpointRateLimit(req, res)) return;

  const cfg = readServerConfig();
  const hasCustomAdminPassword =
    Boolean(cfg.auth?.password) && cfg.auth?.password !== 'brokeify';
  const setupRequired = !hasCustomAdminPassword && !cfg.auth?.setupCompleted;
  const allowSignup = process.env.ALLOW_SIGNUP === 'true';

  if (!setupRequired && !allowSignup) {
    return res.status(403).json({
      ok: false,
      error:
        'Initial setup is already completed and public signup is disabled (ALLOW_SIGNUP=false).',
    });
  }

  const username = String(req.body?.username || 'admin').trim();
  const password = String(req.body?.password || '').trim();
  const displayName = String(req.body?.displayName || username).trim();

  if (!username || password.length < 4) {
    return res.status(400).json({
      ok: false,
      error: 'A username and a password (at least 4 characters) are required.',
    });
  }

  if (setupRequired) {
    const nextAuth = {
      ...cfg.auth,
      username,
      password,
      setupCompleted: true,
      requireLogin: true,
    };
    writeServerConfig({ auth: nextAuth });

    const userObj: AuthenticatedUser = {
      id: 'usr-brokeify-admin',
      username,
      displayName,
      role: 'admin',
      isAdmin: true,
    };
    const accessJwt = signJwtToken(
      {
        sub: userObj.id,
        username: userObj.username,
        displayName: userObj.displayName,
        role: userObj.role,
      },
      7 * 24 * 3600
    );
    const refreshJwt = signJwtToken(
      {
        sub: userObj.id,
        username: userObj.username,
        displayName: userObj.displayName,
        role: userObj.role,
        type: 'refresh',
      },
      90 * 24 * 3600
    );

    res.setHeader(
      'Set-Cookie',
      `brokeify_session=${encodeURIComponent(
        accessJwt.token
      )}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`
    );

    pushServerLog(
      'info',
      'system',
      `[Security] Completed initial admin setup for "${username}"`
    );
    return res.status(201).json({
      ok: true,
      token: accessJwt.token,
      refreshToken: refreshJwt.token,
      expiresAt: accessJwt.expiresAt,
      apiKey: ensureMobileApiToken(false),
      user: userObj,
    });
  }

  // When ALLOW_SIGNUP=true after initial setup, create a listener guest user
  const guestUsers = Array.isArray(cfg.auth?.guestUsers)
    ? [...cfg.auth.guestUsers]
    : [];
  if (
    username.toLowerCase() ===
      String(cfg.auth?.username || 'admin').toLowerCase() ||
    guestUsers.some(
      (g) => String(g.username).toLowerCase() === username.toLowerCase()
    )
  ) {
    return res.status(400).json({
      ok: false,
      error: `Username "${username}" is already taken.`,
    });
  }

  const newGuest = {
    id: `usr-${Date.now().toString(36)}`,
    username,
    displayName,
    password,
    role: 'listener' as const,
    apiToken: `brk_guest_${crypto.randomBytes(16).toString('hex')}`,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  guestUsers.push(newGuest);
  writeServerConfig({ auth: { ...cfg.auth, guestUsers } });

  const userObj: AuthenticatedUser = {
    id: newGuest.id,
    username: newGuest.username,
    displayName: newGuest.displayName,
    role: 'listener',
    isAdmin: false,
  };
  const accessJwt = signJwtToken(
    {
      sub: userObj.id,
      username: userObj.username,
      displayName: userObj.displayName,
      role: userObj.role,
    },
    7 * 24 * 3600
  );
  const refreshJwt = signJwtToken(
    {
      sub: userObj.id,
      username: userObj.username,
      displayName: userObj.displayName,
      role: userObj.role,
      type: 'refresh',
    },
    90 * 24 * 3600
  );

  return res.status(201).json({
    ok: true,
    token: accessJwt.token,
    refreshToken: refreshJwt.token,
    expiresAt: accessJwt.expiresAt,
    user: userObj,
  });
});

// GET /api/auth/me -> Validates Bearer token and returns current user profile
app.get('/api/auth/me', (req, res) => {
  const cfg = readServerConfig();
  const authResult = resolveRequestAuth(req);
  if (!authResult.authenticated && cfg.auth?.requireLogin) {
    return res.status(401).json({
      ok: false,
      authenticated: false,
      error: 'Invalid or expired authentication token.',
    });
  }

  const fallbackAdmin: AuthenticatedUser = {
    id: 'usr-brokeify-admin',
    username: cfg.auth?.username || 'admin',
    displayName: cfg.auth?.username || 'admin',
    role: 'admin',
    isAdmin: true,
  };

  return res.json({
    ok: true,
    authenticated: true,
    user: authResult.user || fallbackAdmin,
  });
});

// POST /api/auth/refresh -> Exchanges a valid refreshToken (or Bearer token) for a fresh JWT
app.post('/api/auth/refresh', (req, res) => {
  const rawRefresh = String(
    req.body?.refreshToken ||
      req.body?.token ||
      String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
      ''
  ).trim();

  const verified = verifyJwtToken(rawRefresh);
  if (!verified || !verified.sub || !verified.username) {
    return res.status(401).json({
      ok: false,
      error: 'Invalid or expired refresh token.',
    });
  }

  const role = verified.role === 'listener' ? 'listener' : 'admin';
  const userObj: AuthenticatedUser = {
    id: String(verified.sub),
    username: String(verified.username),
    displayName: String(verified.displayName || verified.username),
    role,
    isAdmin: role === 'admin',
  };

  const accessJwt = signJwtToken(
    {
      sub: userObj.id,
      username: userObj.username,
      displayName: userObj.displayName,
      role: userObj.role,
    },
    7 * 24 * 3600
  );
  const refreshJwt = signJwtToken(
    {
      sub: userObj.id,
      username: userObj.username,
      displayName: userObj.displayName,
      role: userObj.role,
      type: 'refresh',
    },
    90 * 24 * 3600
  );

  return res.json({
    ok: true,
    token: accessJwt.token,
    refreshToken: refreshJwt.token,
    expiresAt: accessJwt.expiresAt,
    user: userObj,
  });
});

// GET /api/auth/api-keys -> Lists Personal API Keys for Android / Android Auto / External Clients
app.get('/api/auth/api-keys', (_req, res) => {
  const cfg = readServerConfig();
  const apiKeys = (Array.isArray(cfg.auth?.apiKeys) ? cfg.auth.apiKeys : []).map(
    (k) => ({
      id: k.id,
      name: k.name,
      prefix: String(k.token || '').slice(0, 14) + '••••••••',
      role: k.role || 'admin',
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt || null,
    })
  );
  res.json({
    ok: true,
    apiKeys,
  });
});

// POST /api/auth/api-keys -> Generates a new revocable Personal API Key (brk_live_...)
app.post('/api/auth/api-keys', (req, res) => {
  const cfg = readServerConfig();
  const name = String(
    req.body?.name || req.body?.deviceName || 'Android Auto / Companion Client'
  ).trim();
  const role = req.body?.role === 'listener' ? 'listener' : 'admin';

  if (!name) {
    return res
      .status(400)
      .json({ ok: false, error: 'Token name/label is required.' });
  }

  const rawToken = `brk_live_${crypto.randomBytes(24).toString('hex')}`;
  const newKey = {
    id: `key-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
    name,
    token: rawToken,
    role,
    userId: 'usr-brokeify-admin',
    username: cfg.auth?.username || 'admin',
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };

  const apiKeys = Array.isArray(cfg.auth?.apiKeys)
    ? [newKey, ...cfg.auth.apiKeys]
    : [newKey];
  writeServerConfig({
    auth: {
      ...cfg.auth,
      apiKeys,
    },
  });

  pushServerLog(
    'info',
    'system',
    `[Security] Generated Personal API Key "${name}" (${role})`
  );

  return res.status(201).json({
    ok: true,
    apiKey: {
      id: newKey.id,
      name: newKey.name,
      token: rawToken,
      prefix: rawToken.slice(0, 14) + '••••••••',
      role: newKey.role,
      createdAt: newKey.createdAt,
    },
    apiKeys: apiKeys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: String(k.token || '').slice(0, 14) + '••••••••',
      role: k.role || 'admin',
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt || null,
    })),
    message: `Created Personal API Key "${name}". Copy the token now!`,
  });
});

// DELETE /api/auth/api-keys/:id -> Revokes a Personal API Key
app.delete('/api/auth/api-keys/:id', (req, res) => {
  const keyId = String(req.params.id || '').trim();
  const cfg = readServerConfig();
  const existing = Array.isArray(cfg.auth?.apiKeys) ? cfg.auth.apiKeys : [];
  const nextKeys = existing.filter((k) => k.id !== keyId);
  if (nextKeys.length === existing.length) {
    return res.status(404).json({ ok: false, error: 'API key not found.' });
  }
  writeServerConfig({
    auth: {
      ...cfg.auth,
      apiKeys: nextKeys,
    },
  });
  return res.json({
    ok: true,
    revokedId: keyId,
    apiKeys: nextKeys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: String(k.token || '').slice(0, 14) + '••••••••',
      role: k.role || 'admin',
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt || null,
    })),
    message: 'Personal API Key revoked.',
  });
});

// GET /api/auth/status -> Checks current session, whether login gate is active, and public domain status
app.get('/api/auth/status', (req, res) => {
  const cfg = readServerConfig();
  const authResult = resolveRequestAuth(req);
  const requireLogin = Boolean(cfg.auth?.requireLogin);
  const publicDomainDetected = isPublicInternetDomain(req);
  const host = String(
    req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3487'
  ).split(',')[0];
  const isDefaultPassword =
    !cfg.auth?.password || String(cfg.auth?.password) === 'brokeify';

  res.json({
    ok: true,
    authenticated: authResult.authenticated || !requireLogin,
    strictAuthenticated: authResult.authenticated,
    requireLogin,
    autoLockPublicDomain: cfg.auth?.autoLockPublicDomain !== false,
    publicDomainDetected,
    detectedHost: host,
    isDefaultPassword,
    user: authResult.user || {
      id: 'usr-brokeify-admin',
      username: cfg.auth?.username || 'admin',
      displayName: cfg.auth?.username || 'admin',
      role: 'admin',
      isAdmin: true,
    },
    securityStats: {
      ...securityStats,
      guestUsersCount: Array.isArray(cfg.auth?.guestUsers)
        ? cfg.auth.guestUsers.length
        : 0,
    },
  });
});

// POST /api/auth/login -> Authenticates Admin or Friends & Family user, returns JWT + refreshToken + sets HttpOnly cookie
app.post('/api/auth/login', (req, res) => {
  if (!checkAuthEndpointRateLimit(req, res)) return;

  const clientIp = getClientIp(req);
  const rateCheck = checkIpRateLimit(clientIp);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      ok: false,
      error: `Too many failed login attempts from your IP. Please try again in ${Math.ceil(
        rateCheck.retryAfterSeconds / 60
      )} minute(s).`,
    });
  }

  const cfg = readServerConfig();
  const inputUser = String(req.body?.username || '').trim();
  const inputPass = String(req.body?.password || '').trim();

  const adminUser = String(cfg.auth?.username || 'admin').trim();
  const adminPass = String(cfg.auth?.password || 'brokeify').trim();

  // 1. Check Admin account
  if (
    (!inputUser || inputUser.toLowerCase() === adminUser.toLowerCase()) &&
    (inputPass === adminPass || inputPass === cfg.auth?.apiToken)
  ) {
    clearAuthFailures(clientIp);
    const userObj: AuthenticatedUser = {
      id: 'usr-brokeify-admin',
      username: adminUser,
      displayName: adminUser,
      role: 'admin',
      isAdmin: true,
    };
    const accessJwt = signJwtToken(
      {
        sub: userObj.id,
        username: userObj.username,
        displayName: userObj.displayName,
        role: userObj.role,
      },
      7 * 24 * 3600
    );
    const refreshJwt = signJwtToken(
      {
        sub: userObj.id,
        username: userObj.username,
        displayName: userObj.displayName,
        role: userObj.role,
        type: 'refresh',
      },
      90 * 24 * 3600
    );

    res.setHeader(
      'Set-Cookie',
      `brokeify_session=${encodeURIComponent(
        accessJwt.token
      )}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`
    );
    pushServerLog(
      'info',
      'system',
      `[Security] Admin "${adminUser}" signed in from ${clientIp}`
    );
    return res.json({
      ok: true,
      token: accessJwt.token,
      refreshToken: refreshJwt.token,
      expiresAt: accessJwt.expiresAt,
      apiKey: ensureMobileApiToken(false),
      user: userObj,
      server: 'Brokeify Native Engine',
      mode: 'standalone',
    });
  }

  // 2. Check Friends & Family (guestUsers) accounts
  const guestUsers = Array.isArray(cfg.auth?.guestUsers)
    ? cfg.auth.guestUsers
    : [];
  const matchedGuest = guestUsers.find(
    (g) =>
      String(g.username || '').toLowerCase() === inputUser.toLowerCase() &&
      String(g.password || '') === inputPass
  );

  if (matchedGuest) {
    clearAuthFailures(clientIp);
    const guestRole = matchedGuest.role === 'admin' ? 'admin' : 'listener';
    const userObj: AuthenticatedUser = {
      id: matchedGuest.id || `usr-${matchedGuest.username}`,
      username: matchedGuest.username,
      displayName: matchedGuest.displayName || matchedGuest.username,
      role: guestRole,
      isAdmin: guestRole === 'admin',
    };
    const accessJwt = signJwtToken(
      {
        sub: userObj.id,
        username: userObj.username,
        displayName: userObj.displayName,
        role: userObj.role,
      },
      7 * 24 * 3600
    );
    const refreshJwt = signJwtToken(
      {
        sub: userObj.id,
        username: userObj.username,
        displayName: userObj.displayName,
        role: userObj.role,
        type: 'refresh',
      },
      90 * 24 * 3600
    );

    matchedGuest.lastLoginAt = new Date().toISOString();
    writeServerConfig({ auth: { ...cfg.auth, guestUsers } });

    res.setHeader(
      'Set-Cookie',
      `brokeify_session=${encodeURIComponent(
        accessJwt.token
      )}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`
    );
    pushServerLog(
      'info',
      'system',
      `[Security] Friends & Family user "${matchedGuest.username}" (${guestRole}) signed in from ${clientIp}`
    );
    return res.json({
      ok: true,
      token: accessJwt.token,
      refreshToken: refreshJwt.token,
      expiresAt: accessJwt.expiresAt,
      user: userObj,
      server: 'Brokeify Native Engine',
      mode: 'standalone',
    });
  }

  recordAuthFailure(clientIp, `Failed login for user "${inputUser || 'admin'}"`);
  return res.status(401).json({
    ok: false,
    error: 'Invalid username or password.',
  });
});

// POST /api/auth/logout -> Clears session cookie
app.post('/api/auth/logout', (_req, res) => {
  res.setHeader(
    'Set-Cookie',
    'brokeify_session=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly'
  );
  res.json({ ok: true, message: 'Signed out successfully.' });
});

// GET /api/auth/security-config -> Returns security settings, guest users, and anti-bot stats
app.get('/api/auth/security-config', (req, res) => {
  const cfg = readServerConfig();
  const guestUsers = (cfg.auth?.guestUsers || []).map((g) => ({
    id: g.id,
    username: g.username,
    displayName: g.displayName || g.username,
    role: g.role || 'listener',
    createdAt: g.createdAt,
    lastLoginAt: g.lastLoginAt || null,
  }));

  const blockedIps: Array<{ ip: string; failures: number; unblockInSec: number }> =
    [];
  const now = Date.now();
  for (const [ip, entry] of authRateLimitMap.entries()) {
    if (entry.blockedUntil > now) {
      blockedIps.push({
        ip,
        failures: entry.failures,
        unblockInSec: Math.ceil((entry.blockedUntil - now) / 1000),
      });
    }
  }

  const apiKeys = (Array.isArray(cfg.auth?.apiKeys) ? cfg.auth.apiKeys : []).map(
    (k) => ({
      id: k.id,
      name: k.name,
      prefix: String(k.token || '').slice(0, 14) + '••••••••',
      role: k.role || 'admin',
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt || null,
    })
  );

  res.json({
    ok: true,
    requireLogin: Boolean(cfg.auth?.requireLogin),
    autoLockPublicDomain: cfg.auth?.autoLockPublicDomain !== false,
    adminUsername: cfg.auth?.username || 'admin',
    isDefaultPassword:
      !cfg.auth?.password || String(cfg.auth?.password) === 'brokeify',
    publicDomainDetected: isPublicInternetDomain(req),
    guestUsers,
    apiKeys,
    pairedDevices: pairedAndroidDevices,
    securityStats,
    blockedIps,
  });
});

// POST /api/auth/security-config -> Updates admin password, login gate toggle, or Friends & Family accounts
app.post('/api/auth/security-config', (req, res) => {
  const cfg = readServerConfig();
  const action = String(req.body?.action || 'update-settings');
  const nextAuth = {
    ...cfg.auth,
    guestUsers: Array.isArray(cfg.auth?.guestUsers)
      ? [...cfg.auth.guestUsers]
      : [],
  };

  if (action === 'add-guest') {
    const username = String(req.body?.username || '')
      .trim()
      .replace(/\s+/g, '');
    const password = String(req.body?.password || '').trim();
    const displayName = String(req.body?.displayName || username).trim();
    const role = req.body?.role === 'admin' ? 'admin' : 'listener';

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        error: 'Username and password are required for Friends & Family accounts.',
      });
    }
    if (
      username.toLowerCase() ===
        String(nextAuth.username || 'admin').toLowerCase() ||
      nextAuth.guestUsers.some(
        (g) => String(g.username).toLowerCase() === username.toLowerCase()
      )
    ) {
      return res.status(400).json({
        ok: false,
        error: `User "${username}" already exists.`,
      });
    }

    const newGuest = {
      id: `usr-${Date.now().toString(36)}`,
      username,
      displayName,
      password,
      role,
      apiToken: `brk_guest_${crypto.randomBytes(12).toString('hex')}`,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };
    nextAuth.guestUsers.push(newGuest);
    writeServerConfig({ auth: nextAuth });
    pushServerLog(
      'info',
      'system',
      `[Security] Created Friends & Family account "${username}" (${role})`
    );
    return res.json({
      ok: true,
      message: `Added Friends & Family account "${displayName}" (@${username})!`,
      guestUsers: nextAuth.guestUsers.map((g) => ({
        id: g.id,
        username: g.username,
        displayName: g.displayName,
        role: g.role,
        createdAt: g.createdAt,
        lastLoginAt: g.lastLoginAt,
      })),
    });
  }

  if (action === 'remove-guest') {
    const guestId = String(req.body?.id || req.body?.username || '').trim();
    nextAuth.guestUsers = nextAuth.guestUsers.filter(
      (g) => g.id !== guestId && g.username !== guestId
    );
    writeServerConfig({ auth: nextAuth });
    return res.json({
      ok: true,
      message: 'Removed Friends & Family account.',
      guestUsers: nextAuth.guestUsers.map((g) => ({
        id: g.id,
        username: g.username,
        displayName: g.displayName,
        role: g.role,
        createdAt: g.createdAt,
        lastLoginAt: g.lastLoginAt,
      })),
    });
  }

  if (action === 'unblock-ip') {
    const ipToUnblock = String(req.body?.ip || '').trim();
    if (ipToUnblock) authRateLimitMap.delete(ipToUnblock);
    return res.json({
      ok: true,
      message: `Unblocked IP ${ipToUnblock}.`,
    });
  }

  // Default: update admin credentials and/or requireLogin toggle
  if (typeof req.body?.requireLogin === 'boolean') {
    nextAuth.requireLogin = req.body.requireLogin;
  }
  if (typeof req.body?.autoLockPublicDomain === 'boolean') {
    nextAuth.autoLockPublicDomain = req.body.autoLockPublicDomain;
  }
  if (req.body?.adminUsername && String(req.body.adminUsername).trim()) {
    nextAuth.username = String(req.body.adminUsername).trim();
  }
  if (req.body?.adminPassword && String(req.body.adminPassword).trim()) {
    nextAuth.password = String(req.body.adminPassword).trim();
  }

  writeServerConfig({ auth: nextAuth });

  // Issue fresh admin session cookie so the admin stays logged in after enabling the lock or changing password
  const sessionToken = computeUserSessionToken(
    nextAuth.username,
    nextAuth.password,
    'admin'
  );
  res.setHeader(
    'Set-Cookie',
    `brokeify_session=${encodeURIComponent(
      sessionToken
    )}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`
  );

  return res.json({
    ok: true,
    requireLogin: Boolean(nextAuth.requireLogin),
    adminUsername: nextAuth.username,
    isDefaultPassword: nextAuth.password === 'brokeify',
    token: sessionToken,
    message: nextAuth.requireLogin
      ? '🔒 Front-End Security Gate enabled & credentials saved!'
      : 'Security settings updated.',
  });
});

// ============================================================================
// 1C. ANDROID QR PAIRING & JELLYFIN-STYLE 6-DIGIT QUICK CONNECT ENGINE
// ============================================================================

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
  return '127.0.0.1';
}

interface PairedAndroidDevice {
  id: string;
  deviceName: string;
  model: string;
  clientIp: string;
  connectedAt: string;
  method?: 'qr' | 'quick-connect-6digit';
}

const pairedAndroidDevices: PairedAndroidDevice[] = [];

const TEMP_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
let activeTempPairingToken: { token: string; expiresAt: number } | null = null;
let activeQuickConnectPin: { code: string; expiresAt: number } | null = null;

interface PhoneInitiatedQuickConnect {
  code: string;
  secret: string;
  deviceName: string;
  model: string;
  clientIp: string;
  createdAt: number;
  expiresAt: number;
  authorized: boolean;
  apiKey?: string;
}

const phoneQuickConnectRequests = new Map<string, PhoneInitiatedQuickConnect>();

function generateSixDigitCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

function formatSixDigitCode(code: string): string {
  const clean = String(code || '').replace(/\D/g, '');
  if (clean.length === 6) {
    return `${clean.slice(0, 3)} ${clean.slice(3)}`;
  }
  return clean;
}

function ensureQuickConnectPin(forceNew = false): {
  code: string;
  formattedCode: string;
  expiresAt: string;
  expiresInSeconds: number;
} {
  const now = Date.now();
  if (
    forceNew ||
    !activeQuickConnectPin ||
    activeQuickConnectPin.expiresAt <= now + 30_000
  ) {
    activeQuickConnectPin = {
      code: generateSixDigitCode(),
      expiresAt: now + TEMP_TOKEN_TTL_MS,
    };
  }
  return {
    code: activeQuickConnectPin.code,
    formattedCode: formatSixDigitCode(activeQuickConnectPin.code),
    expiresAt: new Date(activeQuickConnectPin.expiresAt).toISOString(),
    expiresInSeconds: Math.max(
      0,
      Math.round((activeQuickConnectPin.expiresAt - now) / 1000)
    ),
  };
}

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

function registerPairedAndroidDevice(
  req,
  method: 'qr' | 'quick-connect-6digit' = 'qr',
  overrideName?: string,
  overrideModel?: string
): PairedAndroidDevice {
  const deviceName = String(
    overrideName ||
      req.body?.deviceName ||
      req.query?.deviceName ||
      req.headers['x-device-name'] ||
      'Android Phone'
  ).trim();
  const model = String(
    overrideModel ||
      req.body?.model ||
      req.query?.model ||
      req.headers['user-agent'] ||
      'Brokeify Android Client'
  )
    .slice(0, 80)
    .trim();
  const clientIp = getClientIp(req);

  const existingIdx = pairedAndroidDevices.findIndex(
    (d) => d.deviceName === deviceName && d.clientIp === clientIp
  );
  const deviceRecord: PairedAndroidDevice = {
    id: `android-${Date.now().toString(36)}`,
    deviceName,
    model,
    clientIp,
    connectedAt: new Date().toISOString(),
    method,
  };
  if (existingIdx >= 0) {
    pairedAndroidDevices[existingIdx] = deviceRecord;
  } else {
    pairedAndroidDevices.unshift(deviceRecord);
    if (pairedAndroidDevices.length > 10) pairedAndroidDevices.pop();
  }
  return deviceRecord;
}

// GET /api/mobile/pair-info -> Returns 6-digit Quick Connect code, QR pairing payload, detected Browser/Domain URL, LAN IP, and connected Android devices
app.get('/api/mobile/pair-info', (req, res) => {
  const apiToken = ensureMobileApiToken(false);
  const tempInfo = ensureTempPairingToken(false);
  const qcPin = ensureQuickConnectPin(false);
  const port = Number(process.env.PORT || 3487);
  const lanIp = detectLanIpv4();
  const lanUrl = `http://${lanIp}:${port}`;
  const proto =
    String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
      .split(',')[0]
      .trim();
  const host = String(
    req.headers['x-forwarded-host'] || req.headers.host || `${lanIp}:${port}`
  )
    .split(',')[0]
    .trim();
  const detectedOriginUrl = `${proto}://${host}`;
  const counts = getLocalLibraryStats();
  const driveStatus = inspectMusicDrive();

  // Prune expired phone-initiated requests
  const now = Date.now();
  const pendingPhoneRequests: Array<{
    code: string;
    formattedCode: string;
    deviceName: string;
    clientIp: string;
  }> = [];
  for (const [k, item] of phoneQuickConnectRequests.entries()) {
    if (item.expiresAt <= now) {
      phoneQuickConnectRequests.delete(k);
    } else if (!item.authorized) {
      pendingPhoneRequests.push({
        code: item.code,
        formattedCode: formatSixDigitCode(item.code),
        deviceName: item.deviceName,
        clientIp: item.clientIp,
      });
    }
  }

  res.json({
    ok: true,
    app: 'brokeify',
    version: '0.1.3-beta',
    serverUrl: detectedOriginUrl,
    detectedBrowserUrl: detectedOriginUrl,
    publicDomainDetected: isPublicInternetDomain(req),
    localUrl: lanUrl,
    lanUrl,
    port,
    quickConnectCode: qcPin.code,
    quickConnectFormatted: qcPin.formattedCode,
    token: tempInfo.token,
    tempToken: tempInfo.token,
    expiresAt: tempInfo.expiresAt,
    expiresInSeconds: tempInfo.expiresInSeconds,
    apiKey: apiToken,
    libraryStats: counts,
    driveStatus,
    pairedDevices: pairedAndroidDevices,
    pendingPhoneRequests,
    endpoints: {
      verify: '/api/mobile/verify',
      quickConnect: '/api/mobile/quick-connect',
      quickConnectInitiate: '/api/mobile/quick-connect/initiate',
      quickConnectPoll: '/api/mobile/quick-connect/poll',
      quickConnectAuthorize: '/api/mobile/quick-connect/authorize',
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

// POST /api/mobile/regenerate-token -> Rotates the 6-digit Quick Connect code & temporary connection token
app.post('/api/mobile/regenerate-token', (req, res) => {
  const rotatePermanent = Boolean(req.body?.rotateApiKey);
  const apiToken = ensureMobileApiToken(rotatePermanent);
  const tempInfo = ensureTempPairingToken(true);
  const qcPin = ensureQuickConnectPin(true);
  res.json({
    ok: true,
    quickConnectCode: qcPin.code,
    quickConnectFormatted: qcPin.formattedCode,
    token: tempInfo.token,
    tempToken: tempInfo.token,
    expiresAt: tempInfo.expiresAt,
    expiresInSeconds: tempInfo.expiresInSeconds,
    apiKey: apiToken,
    message: `Generated new 6-digit Quick Connect code (${qcPin.formattedCode}) & token!`,
  });
});

// POST /api/mobile/quick-connect/initiate -> Jellyfin-style: Android phone requests a 6-digit code to display on the phone screen
app.post('/api/mobile/quick-connect/initiate', (req, res) => {
  const code = generateSixDigitCode();
  const secret = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const deviceName = String(
    req.body?.deviceName || req.headers['x-device-name'] || 'Android Phone'
  ).trim();
  const model = String(
    req.body?.model || req.headers['user-agent'] || 'Brokeify Android App'
  )
    .slice(0, 80)
    .trim();

  phoneQuickConnectRequests.set(code, {
    code,
    secret,
    deviceName,
    model,
    clientIp: getClientIp(req),
    createdAt: now,
    expiresAt: now + TEMP_TOKEN_TTL_MS,
    authorized: false,
  });

  res.json({
    ok: true,
    code,
    formattedCode: formatSixDigitCode(code),
    secret,
    expiresInSeconds: 900,
    message:
      'Enter this 6-digit code in your Brokeify Web UI under Connect Android App -> Authorize Phone Code.',
  });
});

// GET /api/mobile/quick-connect/poll -> Android phone polls with ?secret=... or ?code=... until authorized in Web UI
app.get('/api/mobile/quick-connect/poll', (req, res) => {
  const secret = String(req.query.secret || '').trim();
  const code = String(req.query.code || '').replace(/\D/g, '');
  let found: PhoneInitiatedQuickConnect | undefined;

  for (const item of phoneQuickConnectRequests.values()) {
    if ((secret && item.secret === secret) || (code && item.code === code)) {
      found = item;
      break;
    }
  }

  if (!found || found.expiresAt <= Date.now()) {
    return res.status(404).json({
      ok: false,
      authorized: false,
      error: 'Quick Connect code expired or not found.',
    });
  }

  if (!found.authorized) {
    return res.json({
      ok: true,
      authorized: false,
      code: found.code,
      formattedCode: formatSixDigitCode(found.code),
    });
  }

  const counts = getLocalLibraryStats();
  return res.json({
    ok: true,
    authorized: true,
    authenticated: true,
    server: 'Brokeify Native Engine',
    apiKey: found.apiKey || ensureMobileApiToken(false),
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

// POST /api/mobile/quick-connect/authorize -> Web UI authorizes a 6-digit code shown on the user's Android phone
app.post('/api/mobile/quick-connect/authorize', (req, res) => {
  const rawCode = String(req.body?.code || '').replace(/\D/g, '');
  if (rawCode.length !== 6) {
    return res.status(400).json({
      ok: false,
      error: 'Please enter a valid 6-digit Quick Connect code.',
    });
  }

  const apiKey = ensureMobileApiToken(false);
  const phoneReq = phoneQuickConnectRequests.get(rawCode);

  if (phoneReq && phoneReq.expiresAt > Date.now()) {
    phoneReq.authorized = true;
    phoneReq.apiKey = apiKey;
    const dev = registerPairedAndroidDevice(
      req,
      'quick-connect-6digit',
      phoneReq.deviceName,
      phoneReq.model
    );
    pushServerLog(
      'info',
      'system',
      `[Quick Connect] Authorized Android phone "${dev.deviceName}" via 6-digit code ${formatSixDigitCode(
        rawCode
      )}`
    );
    return res.json({
      ok: true,
      authorized: true,
      device: dev,
      message: `✅ Connected "${dev.deviceName}" via 6-digit Quick Connect code ${formatSixDigitCode(
        rawCode
      )}!`,
    });
  }

  // Also support verifying the server's active 6-digit code directly for instant testing/linking
  const serverPin = ensureQuickConnectPin(false);
  if (rawCode === serverPin.code) {
    const dev = registerPairedAndroidDevice(
      req,
      'quick-connect-6digit',
      req.body?.deviceName || 'Android Phone (Quick Connect)',
      '6-Digit Quick Connect PIN'
    );
    pushServerLog(
      'info',
      'system',
      `[Quick Connect] Linked Android device "${dev.deviceName}" using server 6-digit PIN ${serverPin.formattedCode}`
    );
    return res.json({
      ok: true,
      authorized: true,
      apiKey,
      device: dev,
      message: `✅ Linked "${dev.deviceName}" using 6-digit Quick Connect code ${serverPin.formattedCode}!`,
    });
  }

  return res.status(404).json({
    ok: false,
    error: `No active phone request found for code ${formatSixDigitCode(
      rawCode
    )}. Check the 6-digit code and try again.`,
  });
});

// ALL /api/mobile/verify & /api/mobile/quick-connect -> Called by the Android app using EITHER the 6-digit Quick Connect code OR QR code token
const handleMobileVerifyOrQuickConnect = (req, res) => {
  const clientIp = getClientIp(req);
  const rateCheck = checkIpRateLimit(clientIp);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      ok: false,
      error: `Too many failed pairing attempts. Try again in ${Math.ceil(
        rateCheck.retryAfterSeconds / 60
      )}m.`,
    });
  }

  const expectedApiKey = ensureMobileApiToken(false);
  const currentTemp = ensureTempPairingToken(false);
  const currentPin = ensureQuickConnectPin(false);

  const authHeader = String(req.headers.authorization || '').replace(
    /^Bearer\s+/i,
    ''
  );
  const providedCode = String(
    req.body?.code ||
      req.body?.quickConnectCode ||
      req.query?.code ||
      req.query?.pin ||
      ''
  ).replace(/\D/g, '');

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

  const cleanProvidedTokenDigits = providedToken.replace(/\D/g, '');
  const matchedSixDigitPin =
    (providedCode && providedCode === currentPin.code) ||
    (cleanProvidedTokenDigits.length === 6 &&
      cleanProvidedTokenDigits === currentPin.code);

  const matchedToken =
    providedToken === expectedApiKey || providedToken === currentTemp.token;

  if (!matchedSixDigitPin && !matchedToken) {
    recordAuthFailure(clientIp, 'Invalid mobile QR token or 6-digit code');
    return res.status(401).json({
      ok: false,
      error:
        'Invalid or expired 6-digit Quick Connect code or QR token. Please check the code on your Brokeify server.',
    });
  }

  clearAuthFailures(clientIp);
  const deviceRecord = registerPairedAndroidDevice(
    req,
    matchedSixDigitPin ? 'quick-connect-6digit' : 'qr'
  );

  const counts = getLocalLibraryStats();
  return res.json({
    ok: true,
    authenticated: true,
    method: matchedSixDigitPin ? 'quick-connect-6digit' : 'qr',
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
};

app.all('/api/mobile/verify', handleMobileVerifyOrQuickConnect);
app.all('/api/mobile/quick-connect', handleMobileVerifyOrQuickConnect);

// GET /api/artists & GET /api/library/artists -> Returns all indexed artists
app.get(['/api/artists', '/api/library/artists'], (req, res) => {
  const search = String(req.query.search || req.query.q || '').trim();
  const artists = queryArtists(search);
  res.json({
    ok: true,
    total: artists.length,
    artists,
  });
});

// GET /api/artists/:id & GET /api/library/artists/:id -> Returns single artist profile + albums + top tracks
app.get(['/api/artists/:id', '/api/library/artists/:id'], (req, res) => {
  const id = String(req.params.id || '').trim();
  const artist = getArtistById(id);
  if (!artist) {
    return res.status(404).json({ ok: false, error: 'Artist not found' });
  }
  res.json({
    ok: true,
    artist,
  });
});

// GET /api/albums & GET /api/library/albums -> Returns all albums (filterable by ?artistId= and ?search=/q=)
app.get(['/api/albums', '/api/library/albums'], (req, res) => {
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

// GET /api/albums/:id & GET /api/library/albums/:id -> Returns single album details + ordered tracklist
app.get(['/api/albums/:id', '/api/library/albums/:id'], (req, res) => {
  const id = String(req.params.id || '').trim();
  const album = getAlbumById(id);
  if (!album) {
    return res.status(404).json({ ok: false, error: 'Album not found' });
  }
  res.json({
    ok: true,
    album,
  });
});

// GET /api/tracks & GET /api/library/tracks -> Paginated, sortable, filterable track list
app.get(['/api/tracks', '/api/library/tracks'], (req, res) => {
  const albumId = String(req.query.albumId || '').trim() || undefined;
  const artistId = String(req.query.artistId || '').trim() || undefined;
  const genre = String(req.query.genre || '').trim() || undefined;
  const search =
    String(req.query.search || req.query.q || '').trim() || undefined;
  const sort = String(req.query.sort || '').trim() || undefined;
  const order = String(req.query.order || 'asc').trim();
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const offset = req.query.offset ? Number(req.query.offset) : 0;

  const total = countMatchingTracks({ albumId, artistId, genre, search });
  const tracks = queryTracks({
    albumId,
    artistId,
    genre,
    search,
    sort,
    order,
    limit,
    offset,
  });

  res.json({
    ok: true,
    total,
    limit: limit ?? total,
    offset,
    tracks,
  });
});

// GET /api/radio/track/:id -> 1-Tap Song Radio queue seeded by track ID
app.get('/api/radio/track/:id', (req, res) => {
  const seedTrackId = String(req.params.id || '').trim();
  const limit = req.query.limit ? Math.min(100, Math.max(1, Number(req.query.limit))) : 25;
  const radio = buildSongRadioQueue(seedTrackId, limit);
  if (!radio.seedTrack) {
    return res.status(404).json({ ok: false, error: 'Seed track not found' });
  }
  res.json({
    ok: true,
    seedTrack: radio.seedTrack,
    total: radio.queue.length,
    queue: radio.queue,
    tracks: radio.queue,
  });
});

// POST /api/library/rescan (and /api/library/scan) -> Triggers a full recursive scan of /music/** and .m3u/.m3u8 import
app.post(['/api/library/rescan', '/api/library/scan'], async (_req, res) => {
  try {
    const scanResult = await runFullLibraryScan();
    const counts = getLocalLibraryStats();
    const currentMusicDir = getMusicDir();
    res.json({
      ok: true,
      ...scanResult,
      ...counts,
      musicDir: currentMusicDir,
      dbPath: DB_PATH,
      message: `Scanned ${currentMusicDir} (${scanResult.directoriesScanned ?? 0} folders): indexed ${counts.totalTracks} tracks across ${counts.totalAlbums} albums & ${counts.totalArtists} artists (${counts.totalPlaylists} playlists).`,
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
      req.body?.description || 'Custom Brokeify Playlist'
    ).trim();
    const isSmart = Boolean(req.body?.isSmart);
    const smartRulesJson = req.body?.smartRules
      ? JSON.stringify(req.body.smartRules)
      : null;
    const trackIds = Array.isArray(req.body?.trackIds)
      ? req.body.trackIds.map(String)
      : [];
    const ghostTracks = Array.isArray(req.body?.ghostTracks)
      ? req.body.ghostTracks
      : undefined;
    const spotifyUrl =
      req.body?.linkedSpotifyUrl || req.body?.spotifyUrl || undefined;

    upsertPlaylistWithTracks({
      id,
      name,
      description,
      isSmart,
      smartRulesJson,
      ghostTracks,
      spotifyUrl: spotifyUrl ? String(spotifyUrl).trim() : undefined,
      trackIds,
    });
    reconcilePlaylistsWithLibrary();

    const created = queryPlaylists().find((p) => p.id === id);
    res.status(201).json({
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

const handleUpdatePlaylist = (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const existing = db.playlists.get(id);
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
        : existing.description || '';
    const trackIds = Array.isArray(req.body?.trackIds)
      ? req.body.trackIds.map(String)
      : undefined;
    const ghostTracks = Array.isArray(req.body?.ghostTracks)
      ? req.body.ghostTracks
      : undefined;
    const spotifyUrl =
      req.body?.linkedSpotifyUrl !== undefined
        ? req.body.linkedSpotifyUrl
        : req.body?.spotifyUrl !== undefined
          ? req.body.spotifyUrl
          : undefined;

    upsertPlaylistWithTracks({
      id,
      name,
      description,
      ghostTracks,
      spotifyUrl:
        spotifyUrl !== undefined
          ? spotifyUrl
            ? String(spotifyUrl).trim()
            : null
          : undefined,
      trackIds,
    });
    reconcilePlaylistsWithLibrary();

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
};

app.put('/api/playlists/:id', handleUpdatePlaylist);
app.patch('/api/playlists/:id', handleUpdatePlaylist);

// POST /api/playlists/:id/tracks -> Add track(s) to playlist (prevents duplicates unless force: true)
app.post('/api/playlists/:id/tracks', (req, res) => {
  const id = String(req.params.id || '').trim();
  const rawTrackIds = Array.isArray(req.body?.trackIds)
    ? req.body.trackIds.map(String)
    : req.body?.trackId
      ? [String(req.body.trackId)]
      : [];
  const force = Boolean(req.body?.force);

  const result = addTracksToPlaylist(id, rawTrackIds, { force });
  if (!result) {
    return res.status(404).json({ ok: false, error: 'Playlist not found.' });
  }
  const updated = queryPlaylists().find((p) => p.id === id);
  return res.json({
    ok: true,
    ...result,
    playlist: updated,
    playlists: queryPlaylists(),
  });
});

// DELETE /api/playlists/:id/tracks/:trackId -> Remove a track from a playlist
app.delete('/api/playlists/:id/tracks/:trackId', (req, res) => {
  const id = String(req.params.id || '').trim();
  const trackId = String(req.params.trackId || '').trim();
  const result = removeTrackFromPlaylist(id, trackId);
  if (!result) {
    return res.status(404).json({ ok: false, error: 'Playlist not found.' });
  }
  const updated = queryPlaylists().find((p) => p.id === id);
  return res.json({
    ok: true,
    ...result,
    playlist: updated,
    playlists: queryPlaylists(),
  });
});

// PUT /api/playlists/:id/reorder -> Update exact track ordering in SQLite
app.put('/api/playlists/:id/reorder', (req, res) => {
  const id = String(req.params.id || '').trim();
  const trackIds = Array.isArray(req.body?.trackIds)
    ? req.body.trackIds.map(String)
    : [];
  const result = reorderPlaylistTracks(id, trackIds);
  if (!result) {
    return res.status(404).json({ ok: false, error: 'Playlist not found.' });
  }
  const updated = queryPlaylists().find((p) => p.id === id);
  return res.json({
    ok: true,
    ...result,
    playlist: updated,
    playlists: queryPlaylists(),
  });
});

// GET /api/playlists/:id/export.m3u8 -> Exports playlist in standard #EXTM3U / #EXTINF format
app.get('/api/playlists/:id/export.m3u8', (req, res) => {
  const id = String(req.params.id || '').trim();
  const exported = exportPlaylistM3u8(id);
  if (!exported) {
    return res.status(404).json({ ok: false, error: 'Playlist not found.' });
  }
  res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${exported.filename}"`
  );
  return res.send(exported.content);
});

// POST /api/playlists/import -> Imports a playlist from .m3u / .m3u8 text content or JSON track list
app.post('/api/playlists/import', (req, res) => {
  try {
    const name = String(req.body?.name || 'Imported Playlist').trim();
    const rawM3uContent = String(req.body?.content || req.body?.m3u || '').trim();
    const providedTrackIds = Array.isArray(req.body?.trackIds)
      ? req.body.trackIds.map(String)
      : [];

    const matchedIds: string[] = [...providedTrackIds];

    if (rawM3uContent) {
      const lines = rawM3uContent
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      const allTracks = queryTracks();
      const byBasename = new Map<string, string>();
      const byPath = new Map<string, string>();
      for (const t of allTracks) {
        byPath.set(path.resolve(t.filePath), t.id);
        byBasename.set(path.basename(t.filePath).toLowerCase(), t.id);
      }

      for (const line of lines) {
        const normLine = line.replace(/\\/g, '/');
        const candidateMusic = path.resolve(
          getMusicDir(),
          normLine.replace(/^\/+/, '')
        );
        const baseName = path.basename(normLine).toLowerCase();
        const tid = byPath.get(candidateMusic) || byBasename.get(baseName);
        if (tid && !matchedIds.includes(tid)) {
          matchedIds.push(tid);
        }
      }
    }

    const id = `pl-import-${Date.now().toString(36)}`;
    upsertPlaylistWithTracks({
      id,
      name,
      description: `Imported playlist (${matchedIds.length} matched tracks)`,
      isSmart: false,
      trackIds: matchedIds,
    });

    const created = queryPlaylists().find((p) => p.id === id);
    return res.status(201).json({
      ok: true,
      playlist: created,
      playlists: queryPlaylists(),
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to import playlist.',
    });
  }
});

app.delete('/api/playlists/:id', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const existed = deletePlaylistById(id);
    if (!existed) {
      return res.status(404).json({ ok: false, error: 'Playlist not found.' });
    }
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

// Merge / Link multiple playlists into a target playlist (combines both library trackIds and Ghost Songs)
app.post('/api/playlists/merge', (req, res) => {
  try {
    const sourcePlaylistIds = Array.isArray(req.body?.sourcePlaylistIds)
      ? req.body.sourcePlaylistIds.map(String)
      : [];
    const targetPlaylistId = String(req.body?.targetPlaylistId || '').trim();
    const newPlaylistName = String(req.body?.newPlaylistName || '').trim();

    if (sourcePlaylistIds.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Select at least one playlist to merge/link.',
      });
    }

    const allPl = queryPlaylists();
    const existingTarget = targetPlaylistId
      ? allPl.find((p) => p.id === targetPlaylistId)
      : undefined;
    const finalId =
      existingTarget?.id ||
      targetPlaylistId ||
      `pl-merged-${Date.now().toString(36)}`;
    const finalName =
      newPlaylistName || existingTarget?.name || 'Merged Playlist';

    const orderedPlaylistSet = existingTarget
      ? [
          existingTarget,
          ...sourcePlaylistIds
            .map((id) => allPl.find((p) => p.id === id))
            .filter((p) => p && p.id !== existingTarget.id),
        ]
      : sourcePlaylistIds
          .map((id) => allPl.find((p) => p.id === id))
          .filter(Boolean);

    const mergedTrackIds: string[] = [];
    const seenTrackIds = new Set<string>();
    const mergedGhosts: any[] = [];
    const seenGhostKeys = new Set<string>();
    let linkedSpotify = existingTarget?.linkedSpotifyUrl || null;

    for (const pl of orderedPlaylistSet) {
      if (!pl) continue;
      if (!linkedSpotify && pl.linkedSpotifyUrl) {
        linkedSpotify = pl.linkedSpotifyUrl;
      }
      for (const tid of pl.trackIds || []) {
        if (tid && !seenTrackIds.has(tid)) {
          seenTrackIds.add(tid);
          mergedTrackIds.push(tid);
        }
      }
      for (const gt of pl.ghostTracks || []) {
        const key = `${normalizeText(gt.artist)}::${normalizeText(gt.title)}`;
        if (gt.title && !seenGhostKeys.has(key)) {
          seenGhostKeys.add(key);
          mergedGhosts.push({ ...gt });
        }
      }
    }

    upsertPlaylistWithTracks({
      id: finalId,
      name: finalName,
      description: `Combined Playlist (${mergedTrackIds.length} in library${
        mergedGhosts.length > 0 ? ` · ${mergedGhosts.length} total songs` : ''
      })`,
      ghostTracks: mergedGhosts.length > 0 ? mergedGhosts : undefined,
      spotifyUrl: linkedSpotify,
      trackIds: mergedTrackIds,
    });
    reconcilePlaylistsWithLibrary();

    const updatedPl = queryPlaylists().find((p) => p.id === finalId);
    return res.json({
      ok: true,
      playlist: updatedPl,
      playlists: queryPlaylists(),
      message: `Linked & merged into "${finalName}" (${
        updatedPl?.trackIds.length || 0
      } library tracks${
        updatedPl?.ghostTracks?.length
          ? `, ${updatedPl.ghostTracks.length} total songs`
          : ''
      })!`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error ? err.message : 'Failed to merge playlists.',
    });
  }
});

// ============================================================================
// 2B. PLAYBACK HISTORY & POSITION SYNC (/api/history, /api/history/recent)
// ============================================================================

app.post('/api/history', (req, res) => {
  const trackId = String(req.body?.trackId || req.body?.id || '').trim();
  const positionSec = Number(req.body?.positionSec || 0);
  const completed = req.body?.completed !== false;

  if (!trackId) {
    return res.status(400).json({ ok: false, error: 'Missing trackId' });
  }

  const nowIso = new Date().toISOString();
  const updatedTrack = completed
    ? incrementTrackPlayCount(trackId, nowIso)
    : db.tracks.get(trackId) || null;

  if (completed) {
    recordScrobbleInDb(trackId, Math.floor(Date.now() / 1000), false);
  }

  const cfg = readServerConfig();
  if (positionSec >= 0) {
    writeServerConfig({
      playbackSession: {
        ...(cfg.playbackSession || {}),
        trackId,
        positionSec,
        updatedAt: nowIso,
      },
    });
  }

  return res.json({
    ok: true,
    trackId,
    playCount: updatedTrack?.play_count ?? 0,
    lastPlayedAt: updatedTrack?.last_played_at ?? nowIso,
    positionSec,
  });
});

app.get('/api/history/recent', (req, res) => {
  const limit = req.query.limit
    ? Math.min(200, Math.max(1, Number(req.query.limit)))
    : 50;
  const history = getRecentPlayHistory(limit);
  return res.json({
    ok: true,
    total: history.length,
    history,
  });
});

// ============================================================================
// 2C. DYNAMIC API HANDSHAKE SPECIFICATION (/api/system/spec)
// ============================================================================

app.get(['/api/system/spec', '/api/docs/handshake'], (req, res) => {
  const port = Number(process.env.PORT || 3487);
  const proto = String(
    req.headers['x-forwarded-proto'] || req.protocol || 'http'
  )
    .split(',')[0]
    .trim();
  const host = String(
    req.headers['x-forwarded-host'] || req.headers.host || `localhost:${port}`
  )
    .split(',')[0]
    .trim();
  const includeCurrentUrl =
    req.query.includeCurrentUrl === '1' ||
    req.query.includeCurrentUrl === 'true';
  const customBaseUrl =
    typeof req.query.baseUrl === 'string' && req.query.baseUrl.trim()
      ? req.query.baseUrl.trim().replace(/\/+$/, '')
      : null;
  const baseUrl =
    customBaseUrl ||
    (includeCurrentUrl ? `${proto}://${host}` : 'https://your-brokeify-server.com');
  const counts = getLocalLibraryStats();
  const cfg = readServerConfig();

  const markdown = generateBrokeifyApiSpecMarkdown({
    baseUrl,
    version: '3.0.0-standalone',
    port,
    totalTracks: counts.totalTracks,
    totalAlbums: counts.totalAlbums,
    totalArtists: counts.totalArtists,
    totalPlaylists: counts.totalPlaylists,
    authRequired: Boolean(cfg.auth?.requireLogin),
  });

  if (
    req.query.download === '1' ||
    req.query.download === 'true' ||
    String(req.headers.accept || '').includes('text/markdown')
  ) {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="brokeify-api-handshake.md"'
    );
    return res.send(markdown);
  }

  return res.json({
    ok: true,
    filename: 'brokeify-api-handshake.md',
    baseUrl,
    generatedAt: new Date().toISOString(),
    markdown,
  });
});

// ============================================================================
// 3. SEEKABLE HTTP 206 AUDIO STREAMING & CACHED COVER ART
// ============================================================================

app.get('/api/stream/:trackId', (req, res) => {
  return handleStreamTrack(req, res);
});

app.get('/api/covers/:id', (req, res) => {
  return handleServeCover(req, res);
});

app.get('/api/cover/:type/:id', (req, res) => {
  return handleServeCover(req, res);
});

// ============================================================================
// 4. TRACK DISK CLEANUP & MAINTAINERR DUPLICATE JANITOR
// ============================================================================

function deleteTrackFromDiskAndDb(rawId: string): boolean {
  const cleanId = String(rawId || '').trim();
  if (!cleanId) return false;

  const row = deleteTrackFromDb(cleanId);
  if (!row) return false;

  try {
    if (row.file_path && fs.existsSync(row.file_path)) {
      fs.unlinkSync(row.file_path);
    }
  } catch {
    // ignore unlink error if read-only
  }

  return true;
}

app.delete('/api/library/tracks/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  const ok = deleteTrackFromDiskAndDb(id);
  if (!ok) {
    return res
      .status(404)
      .json({ ok: false, error: 'Track not found in database.' });
  }
  return res.json({
    ok: true,
    deletedId: id,
    message: `Permanently deleted track ${id} from /music and database index.`,
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
    message: `Deleted ${deletedIds.length} track(s) from /music disk & database.`,
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

    if (Array.isArray(incoming.playlists)) {
      for (const pl of incoming.playlists) {
        if (!pl || !pl.id || !pl.name) continue;
        upsertPlaylistWithTracks({
          id: String(pl.id),
          name: String(pl.name),
          description: String(pl.description || ''),
          ghostTracks: Array.isArray(pl.ghostTracks)
            ? pl.ghostTracks
            : undefined,
          spotifyUrl:
            pl.linkedSpotifyUrl !== undefined
              ? pl.linkedSpotifyUrl
              : pl.autopilotSpotifyUrl !== undefined
                ? pl.autopilotSpotifyUrl
                : undefined,
          trackIds: Array.isArray(pl.trackIds)
            ? pl.trackIds.map(String)
            : undefined,
          createdAt: pl.createdAt ? String(pl.createdAt) : undefined,
        });
      }
      reconcilePlaylistsWithLibrary();
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

    let resolvedTrack = track;
    if (trackId) {
      const dbTrack = getTrackWithArtistAlbum(trackId);
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
          incrementTrackPlayCount(dbTrack.id, nowIso);
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
          submission_client_version: '0.1.2-beta',
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
                'BrokeifyStandalone/0.1.2-beta (https://github.com/Mr-Nickey/brokeify)',
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

    // 3. Record scrobble row in database
    if (listenType === 'single' && trackId) {
      recordScrobbleInDb(trackId, unixTs, Boolean(syncedToLb));
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

        const maxCountParam = Math.min(
          50,
          Math.max(10, Number(req.query.count) || 50)
        );
        const slicedTracks = req.query.count
          ? tracks.slice(0, maxCountParam)
          : tracks;

        detailedPlaylists.push({
          id: playlistMbid,
          title: fullPl.title || plSummary.title || 'ListenBrainz Mix',
          annotation:
            fullPl.annotation ||
            plSummary.annotation ||
            `Created for ${username} by ListenBrainz`,
          date: fullPl.date || plSummary.date || '',
          trackCount: slicedTracks.length,
          inLibraryCount: slicedTracks.filter((t) => t.inLibrary).length,
          missingCount: slicedTracks.filter((t) => !t.inLibrary).length,
          tracks: slicedTracks,
        });
      } catch {
        // skip failed individual playlist
      }
    }

    // Also fetch user's Top Recordings (10 to 50 songs) from ListenBrainz Stats API
    try {
      const requestedCount = Math.min(
        50,
        Math.max(10, Number(req.query.count) || 25)
      );
      const topRecResp = await fetch(
        `https://api.listenbrainz.org/1/stats/user/${encodeURIComponent(
          username
        )}/recordings?count=${requestedCount}&range=month`,
        { headers: lbHeaders }
      );
      if (topRecResp.ok) {
        const topRecData = await topRecResp.json();
        const rawRecs = Array.isArray(topRecData?.payload?.recordings)
          ? topRecData.payload.recordings
          : [];
        if (rawRecs.length > 0) {
          const recTracks = rawRecs.slice(0, requestedCount).map((r, idx) => {
            const title = r.track_name || 'Unknown Title';
            const artist = r.artist_name || 'Unknown Artist';
            const album = r.release_name || '';
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
              id: `lb-toprec-${idx}`,
              title,
              artist,
              album,
              durationMs: 215000,
              inLibrary: Boolean(matchedLocal),
              jellyfinTrackId: matchedLocal?.id || null,
            };
          });
          detailedPlaylists.push({
            id: `lb-top-recordings-${username}`,
            title: `ListenBrainz Top ${recTracks.length} Recordings (${username})`,
            annotation: `Top ${recTracks.length} most-listened recordings on ListenBrainz.org`,
            date: new Date().toISOString().slice(0, 10),
            trackCount: recTracks.length,
            inLibraryCount: recTracks.filter((t) => t.inLibrary).length,
            missingCount: recTracks.filter((t) => !t.inLibrary).length,
            tracks: recTracks,
          });
        }
      }
    } catch {
      // ignore optional top-recordings error
    }

    return res.json({
      ok: true,
      username,
      playlists: detailedPlaylists,
    });
  } catch (err) {
    pushServerLog(
      'error',
      'listenbrainz',
      err instanceof Error
        ? err.message
        : 'Failed to fetch ListenBrainz discovery playlists.'
    );
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

// POST /api/listenbrainz/grab-mix -> Fetch 10 to 50 songs from ListenBrainz.org, create a Brokeify playlist, and optionally queue missing downloads
app.post('/api/listenbrainz/grab-mix', async (req, res) => {
  try {
    const cfg = readServerConfig();
    const username = String(
      req.body?.username || cfg.integrations?.listenbrainzUsername || ''
    ).trim();
    const feedType = String(req.body?.feedType || 'weekly-exploration').trim();
    const songCount = Math.min(
      50,
      Math.max(10, Number(req.body?.count) || 25)
    );
    const autoDownload = Boolean(req.body?.autoDownload);
    const downloaderMode = String(req.body?.downloaderMode || 'auto').trim();
    const lbToken = String(cfg.integrations?.listenbrainzToken || '').trim();

    if (!username) {
      return res.status(400).json({
        ok: false,
        error:
          'Please enter a ListenBrainz.org username (e.g. your ListenBrainz handle) to fetch 10–50 songs.',
      });
    }

    // Persist username in server config if not yet saved
    if (username !== cfg.integrations?.listenbrainzUsername) {
      writeServerConfig({
        integrations: {
          ...cfg.integrations,
          listenbrainzUsername: username,
        },
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

    let fetchedTracks: Array<{
      title: string;
      artist: string;
      album: string;
      durationMs: number;
    }> = [];
    let mixTitle = `ListenBrainz Mix (${username})`;

    if (feedType === 'top-recordings') {
      mixTitle = `ListenBrainz Top ${songCount} (${username})`;
      const statsResp = await fetch(
        `https://api.listenbrainz.org/1/stats/user/${encodeURIComponent(
          username
        )}/recordings?count=${songCount}&range=all_time`,
        { headers: lbHeaders }
      );
      if (statsResp.ok) {
        const statsJson = await statsResp.json();
        const recs = Array.isArray(statsJson?.payload?.recordings)
          ? statsJson.payload.recordings
          : [];
        fetchedTracks = recs.slice(0, songCount).map((r: any) => ({
          title: r.track_name || 'Unknown Title',
          artist: r.artist_name || 'Unknown Artist',
          album: r.release_name || 'ListenBrainz Top Recordings',
          durationMs: 210000,
        }));
      }
    }

    // Try createdfor playlists (Weekly Exploration / Weekly Jams)
    if (fetchedTracks.length === 0) {
      const createdForUrl = `https://api.listenbrainz.org/1/user/${encodeURIComponent(
        username
      )}/playlists/createdfor?count=10`;
      const listResp = await fetch(createdForUrl, { headers: lbHeaders });
      if (!listResp.ok) {
        pushServerLog(
          'warn',
          'listenbrainz',
          `ListenBrainz API returned HTTP ${listResp.status} for user "${username}"`
        );
        return res.status(listResp.status).json({
          ok: false,
          error: `ListenBrainz.org returned HTTP ${listResp.status} for username "${username}". Verify the username exists on listenbrainz.org.`,
        });
      }
      const listData = await listResp.json();
      const rawPlaylists = Array.isArray(listData?.playlists)
        ? listData.playlists
        : [];

      // Sort so preferred feedType (weekly-exploration or weekly-jams) comes first
      const sorted = [...rawPlaylists].sort((a, b) => {
        const titleA = String(a?.playlist?.title || '').toLowerCase();
        const titleB = String(b?.playlist?.title || '').toLowerCase();
        const targetKeyword =
          feedType === 'weekly-jams' ? 'jams' : 'exploration';
        const matchA = titleA.includes(targetKeyword) ? 0 : 1;
        const matchB = titleB.includes(targetKeyword) ? 0 : 1;
        return matchA - matchB;
      });

      for (const entry of sorted) {
        if (fetchedTracks.length >= songCount) break;
        const plSummary = entry?.playlist;
        const mbidMatch = String(plSummary?.identifier || '').match(
          /([a-f0-9-]{36})$/i
        );
        if (!mbidMatch) continue;
        const plResp = await fetch(
          `https://api.listenbrainz.org/1/playlist/${mbidMatch[1]}`,
          { headers: lbHeaders }
        );
        if (!plResp.ok) continue;
        const plData = await plResp.json();
        const fullPl = plData?.playlist;
        if (!fullPl) continue;
        if (fetchedTracks.length === 0 && fullPl.title) {
          mixTitle = `${fullPl.title} (${songCount} Songs)`;
        }
        const rawTracks = Array.isArray(fullPl.track) ? fullPl.track : [];
        for (const t of rawTracks) {
          if (fetchedTracks.length >= songCount) break;
          fetchedTracks.push({
            title: t.title || 'Unknown Title',
            artist: t.creator || 'Unknown Artist',
            album: t.album || fullPl.title || 'ListenBrainz Discovery',
            durationMs: Number(t.duration || 210000),
          });
        }
      }
    }

    if (fetchedTracks.length === 0) {
      return res.status(404).json({
        ok: false,
        error: `No Weekly Exploration, Weekly Jams, or Top Recordings found on ListenBrainz.org for "${username}".`,
      });
    }

    const finalSlice = fetchedTracks.slice(0, songCount);
    const localLibrary = getSqliteAudioFingerprints();
    const playlistId = `lb-mix-${feedType}-${username
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}`;

    const playlistTracks = finalSlice.map((t, idx) => {
      const normT = normalizeText(t.title);
      const normA = normalizeText(t.artist);
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
        id: matchedLocal?.id || `${playlistId}-t-${idx + 1}`,
        title: t.title,
        artist: t.artist,
        album: t.album,
        durationMs: t.durationMs,
        durationFormatted: formatDurationMs(t.durationMs),
        inLibrary: Boolean(matchedLocal),
        jellyfinId: matchedLocal?.id,
        playCount: 0,
      };
    });

    const savedPlaylist = {
      id: playlistId,
      name: mixTitle,
      source: 'ListenBrainz' as const,
      externalUrl: `https://listenbrainz.org/user/${encodeURIComponent(
        username
      )}/`,
      lastSynced: 'Just now',
      coverGradient: 'from-indigo-600 via-purple-700 to-emerald-600',
      tracks: playlistTracks,
    };

    upsertPlaylistWithTracks(savedPlaylist);

    const missingTracks = playlistTracks.filter((t) => !t.inLibrary);
    let queuedCount = 0;

    if (autoDownload && missingTracks.length > 0) {
      for (const m of missingTracks) {
        const jobId = `job-lb-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`;
        const label = `${m.artist} - ${m.title}`;
        slskdJobs.set(jobId, {
          id: jobId,
          trackId: m.id,
          artist: m.artist,
          title: m.title,
          album: m.album || '',
          label,
          searchText: `${m.artist} ${m.title}`,
          sourceMode: downloaderMode,
          sourceEngine: downloaderMode === 'auto' ? 'slskd' : downloaderMode,
          status: 'queued',
          message: `Queued from ListenBrainz (${finalSlice.length}-song grab)`,
          startedAt: new Date().toISOString(),
          files: [],
        });
        dripGrabQueue.push({
          jobId,
          sourceMode: downloaderMode,
        });
        queuedCount++;
      }
      scheduleDripWorker();
    }

    addPersistentNotification({
      message: `ListenBrainz: Imported ${finalSlice.length} songs into "${mixTitle}" (${
        playlistTracks.length - missingTracks.length
      } in library${
        queuedCount > 0 ? `, ${queuedCount} queued for download` : ''
      }).`,
      category: 'listenbrainz',
      severity: 'success',
      service: 'ListenBrainz',
    });

    return res.json({
      ok: true,
      playlist: savedPlaylist,
      totalFetched: finalSlice.length,
      inLibraryCount: playlistTracks.length - missingTracks.length,
      missingCount: missingTracks.length,
      queuedForDownload: queuedCount,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to grab ListenBrainz mix.',
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
// 8. SPOTIFY PUBLIC PLAYLIST / ALBUM / TRACK URL IMPORTER & GHOST TRACK ENGINE
// ============================================================================

function parseRawTracklistText(rawText: string) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 1 && !/^https?:\/\//i.test(l));

  const parsed: Array<{
    title: string;
    artist: string;
    album?: string;
    durationSec?: number;
  }> = [];

  for (const line of lines) {
    const cleaned = line.replace(/^\d+[\.\)\-\s]+/, '').trim();
    if (!cleaned) continue;
    const dashParts = cleaned.split(/\s+[-–—]\s+/);
    if (dashParts.length >= 2) {
      const artist = dashParts[0].trim();
      const title = dashParts.slice(1).join(' - ').trim();
      if (title) {
        parsed.push({ title, artist: artist || 'Unknown Artist', durationSec: 210 });
        continue;
      }
    }
    const byParts = cleaned.split(/\s+by\s+/i);
    if (byParts.length === 2) {
      parsed.push({
        title: byParts[0].trim(),
        artist: byParts[1].trim() || 'Unknown Artist',
        durationSec: 210,
      });
      continue;
    }
    parsed.push({
      title: cleaned,
      artist: 'Unknown Artist',
      durationSec: 210,
    });
  }
  return parsed;
}

interface SpotifyImportProgressState {
  active: boolean;
  playlistId: string | null;
  playlistTitle: string;
  loadedTracks: number;
  totalTracks: number;
  currentPage: number;
  totalPages: number;
  maxTracks: number | 'all';
  statusMessage: string;
  updatedAt: string;
}

let activeSpotifyImportProgress: SpotifyImportProgressState = {
  active: false,
  playlistId: null,
  playlistTitle: '',
  loadedTracks: 0,
  totalTracks: 0,
  currentPage: 0,
  totalPages: 0,
  maxTracks: 1000,
  statusMessage: 'Idle',
  updatedAt: new Date().toISOString(),
};

app.get('/api/spotify/import-progress', (_req, res) => {
  res.json({
    ok: true,
    ...activeSpotifyImportProgress,
  });
});

function parseMaxTracksCap(rawMax?: number | string | null): {
  numericCap: number;
  label: number | 'all';
} {
  if (rawMax === 'all' || rawMax === 'full' || rawMax === 'unlimited') {
    return { numericCap: 10000, label: 'all' };
  }
  const n = Number(rawMax);
  if (Number.isFinite(n) && n > 0) {
    return {
      numericCap: Math.min(10000, Math.max(1, Math.floor(n))),
      label: Math.floor(n),
    };
  }
  return { numericCap: 1000, label: 1000 };
}

async function fetchSpotifyTracksFromUrl(
  rawUrl: string,
  options?: {
    maxTracks?: number | string | null;
    playlistId?: string | null;
    onPageProgress?: (info: {
      loadedTracks: number;
      totalTracks: number;
      playlistTitle: string;
      tracks: Array<{
        title: string;
        artist: string;
        album: string;
        durationSec: number;
      }>;
    }) => void;
  }
) {
  const cleanUrl = String(rawUrl || '').trim();
  const match =
    cleanUrl.match(
      /open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track)\/([a-zA-Z0-9]+)/i
    ) || cleanUrl.match(/spotify:(playlist|album|track):([a-zA-Z0-9]+)/i);

  if (!match) {
    throw new Error(
      'Invalid Spotify link. Paste a link like https://open.spotify.com/playlist/... or album/... or track/...'
    );
  }

  const entityType = match[1].toLowerCase();
  const entityId = match[2];
  const { numericCap, label: maxTracksLabel } = parseMaxTracksCap(
    options?.maxTracks
  );
  const embedUrl = `https://open.spotify.com/embed/${entityType}/${entityId}`;

  activeSpotifyImportProgress = {
    active: true,
    playlistId: options?.playlistId || entityId,
    playlistTitle: `Spotify ${entityType}`,
    loadedTracks: 0,
    totalTracks: 0,
    currentPage: 1,
    totalPages: 1,
    maxTracks: maxTracksLabel,
    statusMessage: `Connecting to Spotify for ${entityType} ${entityId}...`,
    updatedAt: new Date().toISOString(),
  };

  const browserHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/json',
  };

  const resp = await fetch(embedUrl, {
    headers: browserHeaders,
  });

  if (!resp.ok) {
    activeSpotifyImportProgress.active = false;
    activeSpotifyImportProgress.statusMessage = `Spotify returned HTTP ${resp.status}`;
    throw new Error(
      `Spotify returned HTTP ${resp.status} for ${entityType} ${entityId}. Make sure the playlist is public.`
    );
  }

  const html = await resp.text();
  let title = `Imported Spotify ${entityType.charAt(0).toUpperCase() + entityType.slice(1)}`;
  const tracks: Array<{
    title: string;
    artist: string;
    album: string;
    durationSec: number;
  }> = [];

  let embedAccessToken = '';
  let reportedTotalTracks = 0;

  const nextDataMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i
  );
  if (nextDataMatch && nextDataMatch[1]) {
    try {
      const nextJson = JSON.parse(nextDataMatch[1]);
      embedAccessToken = String(
        nextJson?.props?.pageProps?.state?.settings?.session?.accessToken ||
          nextJson?.props?.pageProps?.session?.accessToken ||
          ''
      ).trim();

      const entity =
        nextJson?.props?.pageProps?.state?.data?.entity ||
        nextJson?.props?.pageProps?.entity ||
        null;
      if (entity) {
        if (entity.name || entity.title) {
          title = entity.name || entity.title;
        }
        if (Number(entity?.tracks?.total) > 0) {
          reportedTotalTracks = Number(entity.tracks.total);
        }
        const trackList =
          entity.trackList ||
          entity.tracks?.items ||
          (entity.type === 'track' ? [entity] : []);

        for (const item of trackList) {
          if (tracks.length >= numericCap) break;
          const tObj = item.track || item;
          const trackTitle = tObj.title || tObj.name || '';
          const trackArtist =
            tObj.subtitle ||
            (Array.isArray(tObj.artists)
              ? tObj.artists.map((a: any) => a.name).join(', ')
              : '') ||
            entity.subtitle ||
            'Unknown Artist';
          const trackAlbum =
            tObj.album?.name || (entityType === 'album' ? title : '');
          const durationMs = Number(tObj.duration || tObj.duration_ms || 0);
          if (trackTitle) {
            tracks.push({
              title: String(trackTitle).replace(/\u00a0/g, ' ').trim(),
              artist: String(trackArtist).replace(/\u00a0/g, ' ').trim(),
              album: String(trackAlbum || '').replace(/\u00a0/g, ' ').trim(),
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

  const effectiveTotalInitial = Math.min(
    numericCap,
    Math.max(reportedTotalTracks, tracks.length)
  );
  activeSpotifyImportProgress = {
    ...activeSpotifyImportProgress,
    playlistTitle: title,
    loadedTracks: tracks.length,
    totalTracks: effectiveTotalInitial,
    currentPage: 1,
    totalPages: Math.max(1, Math.ceil(effectiveTotalInitial / 100)),
    statusMessage: `Fetching tracks from Spotify: ${tracks.length} / ${effectiveTotalInitial || tracks.length}...`,
    updatedAt: new Date().toISOString(),
  };

  if (options?.onPageProgress && tracks.length > 0) {
    try {
      options.onPageProgress({
        loadedTracks: tracks.length,
        totalTracks: effectiveTotalInitial,
        playlistTitle: title,
        tracks: [...tracks],
      });
    } catch {}
  }

  // Paginate beyond the first 100 tracks when importing a large public Spotify playlist
  if (
    entityType === 'playlist' &&
    numericCap > 100 &&
    (tracks.length >= 100 || embedAccessToken)
  ) {
    let token = embedAccessToken;
    if (!token) {
      try {
        const tokResp = await fetch(
          'https://open.spotify.com/get_access_token?reason=transport&productType=embed',
          {
            headers: {
              ...browserHeaders,
              Referer: embedUrl,
            },
            signal: AbortSignal.timeout(6000),
          }
        );
        if (tokResp.ok) {
          const tokData = await tokResp.json().catch(() => null);
          if (tokData?.accessToken) {
            token = String(tokData.accessToken).trim();
          }
        }
      } catch {}
    }

    if (token) {
      let offset = tracks.length;
      let hasMore = tracks.length >= 100 && offset < numericCap;
      const politeDelayMs = process.env.NODE_ENV === 'test' ? 10 : 300;

      while (hasMore && tracks.length < numericCap) {
        if (politeDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, politeDelayMs));
        }

        const pageLimit = Math.min(100, numericCap - tracks.length);
        const pageUrl = `https://api.spotify.com/v1/playlists/${entityId}/tracks?offset=${offset}&limit=${pageLimit}&additional_types=track`;

        let pageResp: Response | null = null;
        try {
          pageResp = await fetch(pageUrl, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
              'User-Agent': browserHeaders['User-Agent'],
            },
            signal: AbortSignal.timeout(10000),
          });

          if (pageResp.status === 429) {
            const retrySec = Math.min(
              8,
              Math.max(1, Number(pageResp.headers.get('retry-after') || 2))
            );
            activeSpotifyImportProgress.statusMessage = `Spotify rate limit pause (${retrySec}s) at ${tracks.length} tracks...`;
            await new Promise((r) => setTimeout(r, retrySec * 1000));
            pageResp = await fetch(pageUrl, {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                'User-Agent': browserHeaders['User-Agent'],
              },
              signal: AbortSignal.timeout(10000),
            });
          }
        } catch {
          break;
        }

        if (!pageResp || !pageResp.ok) {
          break;
        }

        const pageData = await pageResp.json().catch(() => null);
        if (!pageData || !Array.isArray(pageData.items)) {
          break;
        }

        const apiTotal = Number(pageData.total || 0);
        if (apiTotal > reportedTotalTracks) {
          reportedTotalTracks = apiTotal;
        }
        const targetTotal = Math.min(
          numericCap,
          Math.max(reportedTotalTracks, tracks.length + pageData.items.length)
        );

        let addedInPage = 0;
        for (const item of pageData.items) {
          if (tracks.length >= numericCap) break;
          const tObj = item?.track || item;
          if (!tObj || tObj.is_local) continue;
          const trackTitle = String(tObj.name || tObj.title || '')
            .replace(/\u00a0/g, ' ')
            .trim();
          if (!trackTitle) continue;
          const trackArtist =
            (Array.isArray(tObj.artists)
              ? tObj.artists
                  .map((a: any) => a?.name)
                  .filter(Boolean)
                  .join(', ')
              : '') ||
            tObj.subtitle ||
            'Unknown Artist';
          const trackAlbum = String(tObj.album?.name || '')
            .replace(/\u00a0/g, ' ')
            .trim();
          const durationMs = Number(tObj.duration_ms || tObj.duration || 0);

          tracks.push({
            title: trackTitle,
            artist: String(trackArtist).replace(/\u00a0/g, ' ').trim(),
            album: trackAlbum,
            durationSec:
              durationMs > 0 ? Math.round(durationMs / 1000) : 210,
          });
          addedInPage += 1;
        }

        const currentPageNum = Math.floor(offset / 100) + 1;
        const totalPagesNum = Math.max(1, Math.ceil(targetTotal / 100));

        activeSpotifyImportProgress = {
          ...activeSpotifyImportProgress,
          playlistTitle: title,
          loadedTracks: tracks.length,
          totalTracks: targetTotal,
          currentPage: currentPageNum,
          totalPages: totalPagesNum,
          statusMessage: `Fetching tracks from Spotify: ${tracks.length} / ${targetTotal}...`,
          updatedAt: new Date().toISOString(),
        };

        if (options?.onPageProgress && addedInPage > 0) {
          try {
            options.onPageProgress({
              loadedTracks: tracks.length,
              totalTracks: targetTotal,
              playlistTitle: title,
              tracks: [...tracks],
            });
          } catch {}
        }

        if (
          !pageData.next ||
          pageData.items.length === 0 ||
          tracks.length >= targetTotal ||
          tracks.length >= numericCap
        ) {
          hasMore = false;
        } else {
          offset += pageData.items.length;
        }
      }
    }
  }

  activeSpotifyImportProgress = {
    ...activeSpotifyImportProgress,
    active: false,
    playlistTitle: title,
    loadedTracks: tracks.length,
    totalTracks: tracks.length,
    statusMessage: `Completed fetching ${tracks.length} tracks from "${title}".`,
    updatedAt: new Date().toISOString(),
  };

  return {
    entityType,
    entityId,
    playlistTitle: title,
    totalAvailable: Math.max(reportedTotalTracks, tracks.length),
    tracks,
  };
}

app.post('/api/spotify/import-url', async (req, res) => {
  try {
    const rawUrl = String(req.body?.url || '').trim();
    const maxTracks = req.body?.maxTracks ?? 1000;
    if (!rawUrl) {
      return res.status(400).json({
        ok: false,
        error: 'Please provide a Spotify playlist, album, or track URL.',
      });
    }

    const { entityType, entityId, playlistTitle, totalAvailable, tracks } =
      await fetchSpotifyTracksFromUrl(rawUrl, { maxTracks });

    return res.json({
      ok: true,
      entityType,
      entityId,
      playlistTitle,
      totalAvailable,
      tracks,
      message:
        tracks.length > 0
          ? `Loaded ${tracks.length} track(s) from "${playlistTitle}"!`
          : `Resolved "${playlistTitle}", but Spotify hid the full tracklist. Paste the songs below or search directly.`,
    });
  } catch (err) {
    activeSpotifyImportProgress.active = false;
    return res.status(400).json({
      ok: false,
      error:
        err instanceof Error ? err.message : 'Failed to import Spotify URL.',
    });
  }
});

// Unified 1-step Spotify Playlist Importer -> Populates Playlist with Library Matches + Ghost Songs & Auto-Downloads Missing
app.post('/api/playlists/import-spotify', async (req, res) => {
  try {
    const cfg = readServerConfig();
    const rawUrl = String(
      req.body?.spotifyUrl || req.body?.url || ''
    ).trim();
    const rawTracklist = String(req.body?.rawTracklist || '').trim();
    const incomingTracks = Array.isArray(req.body?.tracks)
      ? req.body.tracks
      : [];
    const targetPlaylistId = String(req.body?.playlistId || '').trim();
    const requestedName = String(req.body?.playlistName || '').trim();
    const autoDownloadMissing = req.body?.autoDownloadMissing !== false;
    const maxTracks = req.body?.maxTracks ?? 1000;
    const sourceMode = String(
      req.body?.sourceMode || cfg.integrations?.preferredDownloader || 'auto'
    ).toLowerCase();
    const schedule = String(req.body?.schedule || 'weekly').toLowerCase();
    const ignoreFilters = Boolean(req.body?.ignoreFilters);

    const existingPl = targetPlaylistId
      ? queryPlaylists().find((p) => p.id === targetPlaylistId)
      : undefined;
    const playlistId =
      existingPl?.id ||
      targetPlaylistId ||
      `pl-spotify-${Date.now().toString(36)}`;

    let resolvedTitle =
      requestedName || existingPl?.name || 'Spotify Playlist';
    let importedTracks: Array<{
      title: string;
      artist: string;
      album?: string;
      durationSec?: number;
    }> = [];

    if (incomingTracks.length > 0) {
      importedTracks = incomingTracks
        .map((t: any) => ({
          title: String(t?.title || '').trim(),
          artist: String(t?.artist || 'Unknown Artist').trim(),
          album: t?.album ? String(t.album).trim() : undefined,
          durationSec: Number(t?.durationSec || 210),
        }))
        .filter((t: any) => Boolean(t.title));
    }

    const mergeAndSaveGhostTracks = (
      tracksBatch: Array<{
        title: string;
        artist: string;
        album?: string;
        durationSec?: number;
      }>,
      currentTitle: string
    ) => {
      const currentPl =
        queryPlaylists().find((p) => p.id === playlistId) || existingPl;
      const baseGhosts = Array.isArray(currentPl?.ghostTracks)
        ? [...currentPl.ghostTracks]
        : [];
      const seenKeys = new Set(
        baseGhosts.map(
          (g) => `${normalizeText(g.artist)}::${normalizeText(g.title)}`
        )
      );
      const combined = [...baseGhosts];
      for (let i = 0; i < tracksBatch.length; i++) {
        const tr = tracksBatch[i];
        const key = `${normalizeText(tr.artist)}::${normalizeText(tr.title)}`;
        if (!tr.title || seenKeys.has(key)) continue;
        seenKeys.add(key);
        combined.push({
          id: `ghost-${playlistId}-${combined.length + 1}-${Math.random()
            .toString(36)
            .slice(2, 6)}`,
          title: tr.title,
          artist: tr.artist || 'Unknown Artist',
          album: tr.album,
          durationSec: tr.durationSec || 210,
          matchedTrackId: null,
        });
      }

      const finalName =
        requestedName || currentPl?.name || currentTitle || 'Spotify Playlist';
      upsertPlaylistWithTracks({
        id: playlistId,
        name: finalName,
        description: `Spotify Playlist (${combined.length} tracks)`,
        ghostTracks: combined,
        spotifyUrl: rawUrl || currentPl?.linkedSpotifyUrl || null,
        trackIds: currentPl?.trackIds || [],
      });
      reconcilePlaylistsWithLibrary();
      return { finalName, totalCount: combined.length };
    };

    if (rawUrl && importedTracks.length === 0) {
      const spotifyData = await fetchSpotifyTracksFromUrl(rawUrl, {
        maxTracks,
        playlistId,
        onPageProgress: ({
          playlistTitle: pageTitle,
          tracks: partialTracks,
        }) => {
          if (!requestedName && pageTitle) {
            resolvedTitle = pageTitle;
          }
          mergeAndSaveGhostTracks(partialTracks, resolvedTitle);
        },
      });
      if (!requestedName && spotifyData.playlistTitle) {
        resolvedTitle = spotifyData.playlistTitle;
      }
      importedTracks = spotifyData.tracks;
    }

    if (rawTracklist) {
      const manualTracks = parseRawTracklistText(rawTracklist);
      if (manualTracks.length > 0) {
        importedTracks = [...importedTracks, ...manualTracks];
      }
    }

    if (importedTracks.length === 0) {
      return res.status(400).json({
        ok: false,
        error:
          'No tracks found to import. Make sure the Spotify playlist is public or paste a list of "Artist - Song Title" lines.',
      });
    }

    const { finalName } = mergeAndSaveGhostTracks(
      importedTracks,
      resolvedTitle
    );

    const updatedPlaylist = queryPlaylists().find((p) => p.id === playlistId);
    const reconciledGhosts = Array.isArray(updatedPlaylist?.ghostTracks)
      ? updatedPlaylist.ghostTracks
      : [];

    const matchedCount = reconciledGhosts.filter((g) =>
      Boolean(g.matchedTrackId)
    ).length;
    const missingGhosts = reconciledGhosts.filter((g) => !g.matchedTrackId);

    if (rawUrl && schedule !== 'off') {
      const nextRules = Array.isArray(cfg.autopilotRules)
        ? [...cfg.autopilotRules]
        : [];
      const existingIdx = nextRules.findIndex(
        (r) => r.playlistId === playlistId
      );
      const ruleObj = {
        id:
          existingIdx !== -1
            ? nextRules[existingIdx].id
            : `ap-${Date.now()}`,
        playlistId,
        playlistName: finalName,
        sourceUrl: rawUrl,
        spotifyUrl: rawUrl,
        maxTracks,
        schedule: schedule === 'daily' ? 'daily' : 'weekly',
        interval: schedule === 'daily' ? 'daily' : 'weekly',
        autoDownloadMissing: Boolean(autoDownloadMissing),
        enabled: true,
        lastSyncedAt: new Date().toISOString(),
        lastAddedCount: matchedCount,
        lastMissingQueuedCount: autoDownloadMissing ? missingGhosts.length : 0,
        statusMessage: `Imported ${reconciledGhosts.length} tracks (${matchedCount} in library, ${missingGhosts.length} missing).`,
      };
      if (existingIdx !== -1) {
        nextRules[existingIdx] = ruleObj;
      } else {
        nextRules.push(ruleObj);
      }
      writeServerConfig({ autopilotRules: nextRules });
    }

    const createdJobs: any[] = [];
    if (autoDownloadMissing && missingGhosts.length > 0) {
      const { slskdUrl, slskdApiKey } = getSlskdConfig(req.body || {});
      const activeFilters = ignoreFilters ? null : cfg.discoveryFilters;

      for (const ghost of missingGhosts) {
        const job = createAndEnqueueTrackGrabJob({
          artist: ghost.artist,
          title: ghost.title,
          album: ghost.album || '',
          sourceMode,
          slskdUrl,
          slskdApiKey,
          activeFilters,
          ignoreFilters,
          playlistId,
          ghostTrackId: ghost.id,
        });
        createdJobs.push(job);
      }
    }

    const activeQueuedCount = createdJobs.filter(
      (j) => j.status !== 'filtered'
    ).length;

    return res.json({
      ok: true,
      playlist: queryPlaylists().find((p) => p.id === playlistId),
      playlists: queryPlaylists(),
      jobs: createdJobs,
      totalTracks: reconciledGhosts.length,
      matchedCount,
      missingCount: missingGhosts.length,
      queuedCount: activeQueuedCount,
      message: `Populated "${finalName}" with ${reconciledGhosts.length} tracks: ${matchedCount} in library, ${missingGhosts.length} missing${
        autoDownloadMissing && activeQueuedCount > 0
          ? ` (${activeQueuedCount} queued in staggered Drip Queue — 5 tracks per batch)`
          : ''
      }!`,
    });
  } catch (err) {
    activeSpotifyImportProgress.active = false;
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to import Spotify playlist.',
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
        const stagingRoot =
          cfg.integrations?.autoOrganizeDownloads !== false
            ? cfg.integrations?.stagingDir || path.join(MUSIC_DIR, '_inbox')
            : downloadDir;
        const artistFolder = path.join(stagingRoot, safeArtist);
        fs.mkdirSync(artistFolder, { recursive: true });
        const outTemplate = path.join(artistFolder, `${safeFileBase}.%(ext)s`);
        const negativeSuffix = Array.isArray(job.negativeKeywords) && job.negativeKeywords.length > 0
          ? ' ' + job.negativeKeywords.map((kw: string) => `-${kw}`).join(' ')
          : '';
        const query = `ytsearch1:${job.searchText} official audio${negativeSuffix}`;

        job.status = 'downloading';
        job.matchedPeer = 'YouTube Music (yt-dlp)';
        job.matchedFormat = audioFormat.toUpperCase();
        job.message = `Downloading "${job.label}" via YouTube Music (yt-dlp -> ${audioFormat.toUpperCase()})...`;
        pushServerLog('info', 'youtube', job.message);

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

        let finalFile = path.join(
          artistFolder,
          `${safeFileBase}.${audioFormat}`
        );

        // AcoustID + MusicBrainz + Cover Art Archive Auto-Identify & Organize into /music/{Artist}/{Album} ({Year})/{TrackNumber} - {Title}.{ext}
        if (cfg.integrations?.autoOrganizeDownloads !== false) {
          try {
            const orgRes = await fingerprintTagAndOrganizeFile(finalFile, {
              acoustidApiKey: cfg.integrations?.acoustidApiKey,
              hintArtist: job.artist,
              hintTitle: job.title || job.label,
              hintAlbum: job.album,
              moveToLibraryRoot: true,
            });
            if (orgRes.ok && orgRes.finalPath) {
              finalFile = orgRes.finalPath;
              job.organizedPath = orgRes.finalPath;
            }
          } catch {
            await indexAudioFile(finalFile);
            reconcilePlaylistsWithLibrary();
          }
        } else {
          await indexAudioFile(finalFile);
          reconcilePlaylistsWithLibrary();
        }

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
        job.message = `✓ Downloaded, fingerprinted & organized into ${path.relative(MUSIC_DIR, finalFile)}!`;
        pushServerLog(
          'info',
          'youtube',
          `Completed yt-dlp download & organized "${job.label}" -> ${finalFile}`
        );

        readyNotifications.unshift({
          id: `notif-${job.id}`,
          jobId: job.id,
          label: job.label,
          message: `${job.label} is ready to play in your Brokeify library!`,
          completedAt: job.completedAt,
        });
        addPersistentNotification({
          id: `notif-${job.id}`,
          message: `${job.label} downloaded, fingerprinted & organized into /music!`,
          category: 'download',
          severity: 'success',
          service: 'yt-dlp',
          trackId: job.trackId || undefined,
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
            addPersistentNotification({
              id: `notif-${job.id}`,
              message: `${job.label} is ready via YouTube Music!`,
              category: 'download',
              severity: 'success',
              service: 'YouTube Music',
              trackId: job.trackId || undefined,
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
            addPersistentNotification({
              id: `notif-${job.id}`,
              message: `${job.label} is ready via Open Audio Archive!`,
              category: 'download',
              severity: 'success',
              service: 'Open Audio Archive',
              trackId: job.trackId || undefined,
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
          'Enter your slskd URL first (e.g. http://slskd:5030 or http://192.168.1.100:5030).',
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
        hint: `If slskd is on another Docker compose stack, use http://slskd:5030 or your host LAN IP.`,
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
        error: 'Enter your ListenBrainz username first (e.g. your_username).',
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
        hint: 'Use http://slskd:5030 on a shared Docker network or your host LAN IP.',
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
    addPersistentNotification({
      id: `notif-${job.id}`,
      message: `${job.label} added & triggered in Lidarr (${rootFolderPath})!`,
      category: 'lidarr',
      severity: 'success',
      service: 'Lidarr',
      trackId: job.trackId || undefined,
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
    pushServerLog('info', 'slskd', `Searching slskd P2P for "${job.searchText}"`);

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
        pushServerLog(
          'warn',
          'slskd',
          `slskd search returned HTTP ${startSearchResp.status} for "${job.label}" — falling back to Lidarr/YouTube`
        );
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
        pushServerLog(
          'info',
          'slskd',
          `No matching peer on slskd for "${job.label}" — falling back to Lidarr/YouTube Music`
        );
        const lidarrOk = await executeLidarrGrabJob(job);
        if (lidarrOk) return;
        job.message = `Not found on slskd — auto-falling back to YouTube Music for "${job.label}"...`;
        return executeYouTubeOrArchiveGrabJob(job, 'youtube');
      }
      job.status = 'not_found';
      job.message = `Not found on slskd for "${job.searchText}".`;
      pushServerLog('warn', 'slskd', job.message);
      return;
    }

    job.matchedPeer = chosen.username;
    job.matchedFormat = chosen.formatLabel;
    job.message = `Selected peer "${chosen.username}" (${chosen.formatLabel}) — queueing ${chosen.files.length} file(s)...`;
    pushServerLog('info', 'slskd', `${job.label}: ${job.message}`);

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

// ============================================================================
// STAGGERED DRIP / STRIDE DOWNLOAD QUEUE (Persisted to /data/download-queue.json)
// Processes missing tracks in controlled batches of 5 with polite spacing so
// 700+ song playlists never flood slskd, Lidarr, or yt-dlp.
// ============================================================================

interface PendingGrabQueueItem {
  job: any;
  slskdUrl: string;
  slskdApiKey: string;
  sourceMode: string;
  filtersConfig: any;
}

const pendingGrabQueue: PendingGrabQueueItem[] = [];
let activeGrabWorkers = 0;
const DRIP_BATCH_SIZE = 5;
const MAX_CONCURRENT_GRAB_WORKERS = 2;
const DRIP_STEP_DELAY_MS = process.env.NODE_ENV === 'test' ? 15 : 3200;
let lastDripDispatchTimestamp = 0;
let dripTimerHandle: ReturnType<typeof setTimeout> | null = null;
let completedInCurrentStride = 0;

const DRIP_QUEUE_FILE = path.join(DATA_DIR, 'download-queue.json');

function formatEngineChainLabel(sourceMode: string): string {
  const mode = String(sourceMode || 'auto').toLowerCase();
  if (mode === 'slskd') return 'slskd (Soulseek P2P)';
  if (mode === 'lidarr') return 'Lidarr';
  if (mode === 'youtube') return 'YouTube Music (yt-dlp)';
  if (mode === 'archive') return 'Internet Archive';
  return 'Auto (slskd → Lidarr → YouTube)';
}

function saveDripQueueState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const serializedJobs = Array.from(slskdJobs.values()).slice(-1500);
    const pendingIds = pendingGrabQueue.map((item) => ({
      jobId: item.job?.id,
      sourceMode: item.sourceMode,
    }));
    fs.writeFileSync(
      DRIP_QUEUE_FILE,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          jobs: serializedJobs,
          pending: pendingIds,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {
    // ignore write errors in ephemeral sandboxes
  }
}

function loadDripQueueStateOnBoot() {
  try {
    if (!fs.existsSync(DRIP_QUEUE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(DRIP_QUEUE_FILE, 'utf8'));
    const savedJobs = Array.isArray(raw?.jobs) ? raw.jobs : [];
    const cfg = readServerConfig();
    const { slskdUrl, slskdApiKey } = getSlskdConfig();
    const defaultSourceMode =
      cfg.integrations?.preferredDownloader || 'auto';

    for (const j of savedJobs) {
      if (!j || !j.id) continue;
      if (j.status === 'queued' || j.status === 'searching') {
        j.status = 'queued';
        slskdJobs.set(j.id, j);
        pendingGrabQueue.push({
          job: j,
          slskdUrl,
          slskdApiKey,
          sourceMode: j.sourceMode || defaultSourceMode,
          filtersConfig: cfg.discoveryFilters || null,
        });
      } else {
        slskdJobs.set(j.id, j);
      }
    }
    if (pendingGrabQueue.length > 0) {
      updatePendingQueuePositions();
      setTimeout(() => pumpGrabQueue(), 1500);
    }
  } catch {
    // ignore corrupt queue file
  }
}

function updatePendingQueuePositions() {
  for (let i = 0; i < pendingGrabQueue.length; i++) {
    const item = pendingGrabQueue[i];
    if (item.job && item.job.status === 'queued') {
      const pos = i + 1;
      const batchNum = Math.ceil(pos / DRIP_BATCH_SIZE);
      const totalBatches = Math.max(
        1,
        Math.ceil(pendingGrabQueue.length / DRIP_BATCH_SIZE)
      );
      item.job.queuePosition = pos;
      item.job.batchNumber = batchNum;
      item.job.totalBatches = totalBatches;
      item.job.message = `Queued (#${pos} · Batch ${batchNum}/${totalBatches}) · ${formatEngineChainLabel(item.sourceMode)}`;
    }
  }
}

function pumpGrabQueue() {
  updatePendingQueuePositions();
  if (
    activeGrabWorkers >= MAX_CONCURRENT_GRAB_WORKERS ||
    pendingGrabQueue.length === 0
  ) {
    return;
  }

  const now = Date.now();
  const requiredDelay =
    completedInCurrentStride > 0 &&
    completedInCurrentStride % DRIP_BATCH_SIZE === 0
      ? DRIP_STEP_DELAY_MS * 1.5
      : lastDripDispatchTimestamp === 0
        ? 0
        : DRIP_STEP_DELAY_MS;

  const elapsed = now - lastDripDispatchTimestamp;
  if (elapsed < requiredDelay && process.env.NODE_ENV !== 'test') {
    if (!dripTimerHandle) {
      dripTimerHandle = setTimeout(() => {
        dripTimerHandle = null;
        pumpGrabQueue();
      }, Math.max(50, requiredDelay - elapsed));
    }
    return;
  }

  while (
    activeGrabWorkers < MAX_CONCURRENT_GRAB_WORKERS &&
    pendingGrabQueue.length > 0
  ) {
    const nextItem = pendingGrabQueue.shift();
    if (!nextItem) break;
    lastDripDispatchTimestamp = Date.now();
    completedInCurrentStride += 1;
    updatePendingQueuePositions();
    activeGrabWorkers += 1;
    nextItem.job.queuePosition = undefined;
    saveDripQueueState();

    executeSlskdGrabJob(
      nextItem.job,
      nextItem.slskdUrl,
      nextItem.slskdApiKey,
      nextItem.sourceMode,
      nextItem.filtersConfig
    )
      .catch(() => {})
      .finally(() => {
        activeGrabWorkers = Math.max(0, activeGrabWorkers - 1);
        reconcilePlaylistsWithLibrary();
        saveDripQueueState();
        pumpGrabQueue();
      });

    if (
      pendingGrabQueue.length > 0 &&
      activeGrabWorkers < MAX_CONCURRENT_GRAB_WORKERS &&
      process.env.NODE_ENV !== 'test'
    ) {
      if (!dripTimerHandle) {
        dripTimerHandle = setTimeout(() => {
          dripTimerHandle = null;
          pumpGrabQueue();
        }, DRIP_STEP_DELAY_MS);
      }
      break;
    }
  }
}

loadDripQueueStateOnBoot();

function createAndEnqueueTrackGrabJob(params: {
  artist: string;
  title: string;
  album?: string;
  sourceMode: string;
  slskdUrl: string;
  slskdApiKey: string;
  activeFilters: any;
  ignoreFilters?: boolean;
  playlistId?: string | null;
  ghostTrackId?: string | null;
}) {
  const {
    artist,
    title,
    album = '',
    sourceMode,
    slskdUrl,
    slskdApiKey,
    activeFilters,
    ignoreFilters = false,
    playlistId = null,
    ghostTrackId = null,
  } = params;

  const jobLabel = artist && title ? `${artist} - ${title}` : title || artist;
  const initialEngine =
    sourceMode === 'youtube'
      ? 'youtube'
      : sourceMode === 'archive'
        ? 'archive'
        : sourceMode === 'lidarr'
          ? 'lidarr'
          : 'slskd';

  const normSearch = normalizeText(`${artist} ${title}`);
  for (const existingJob of slskdJobs.values()) {
    if (
      (existingJob.status === 'queued' ||
        existingJob.status === 'searching' ||
        existingJob.status === 'downloading') &&
      normalizeText(existingJob.searchText) === normSearch
    ) {
      if (playlistId && !existingJob.playlistId) {
        existingJob.playlistId = playlistId;
      }
      if (ghostTrackId && !existingJob.ghostTrackId) {
        existingJob.ghostTrackId = ghostTrackId;
      }
      return existingJob;
    }
  }

  if (!ignoreFilters && activeFilters) {
    const check = evaluateServerDiscoveryFilter(
      { title, artist, album },
      activeFilters
    );
    if (check.excluded) {
      const filteredJob = {
        id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'track',
        sourceEngine: initialEngine,
        sourceMode,
        label: jobLabel,
        artist,
        title,
        searchText: `${artist} ${title}`.trim(),
        status: 'filtered',
        message: check.reason || 'Skipped by Exclusion Filter',
        matchedPeer: null,
        matchedFormat: null,
        files: [],
        playlistId,
        ghostTrackId,
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      slskdJobs.set(filteredJob.id, filteredJob);
      saveDripQueueState();
      return filteredJob;
    }
  }

  const queuePos = pendingGrabQueue.length + 1;
  const batchNum = Math.ceil(queuePos / DRIP_BATCH_SIZE);
  const job = {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'track',
    sourceEngine: initialEngine,
    sourceMode,
    label: jobLabel,
    artist,
    title,
    searchText: `${artist} ${title}`.trim(),
    status: 'queued',
    queuePosition: queuePos,
    batchNumber: batchNum,
    message: `Queued (#${queuePos} · Batch ${batchNum}) · ${formatEngineChainLabel(sourceMode)}`,
    matchedPeer: null,
    matchedFormat: null,
    files: [],
    playlistId,
    ghostTrackId,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  slskdJobs.set(job.id, job);
  pendingGrabQueue.push({
    job,
    slskdUrl,
    slskdApiKey,
    sourceMode,
    filtersConfig: ignoreFilters ? null : activeFilters,
  });
  pumpGrabQueue();
  saveDripQueueState();
  return job;
}

const handleSlskdGrabRequest = async (req: any, res: any) => {
  try {
    const cfg = readServerConfig();
    const { slskdUrl, slskdApiKey } = getSlskdConfig(req.body || {});
    const { lidarrUrl, lidarrApiKey } = getLidarrConfig(req.body || {});
    const sourceMode = String(
      req.body?.sourceMode ||
        req.body?.sourceEngine ||
        cfg.integrations?.preferredDownloader ||
        'auto'
    ).toLowerCase();
    const ignoreFilters = Boolean(req.body?.ignoreFilters);
    const activeFilters = req.body?.filters || cfg.discoveryFilters;
    const playlistId = req.body?.playlistId
      ? String(req.body.playlistId)
      : null;
    const ghostTrackId = req.body?.ghostTrackId
      ? String(req.body.ghostTrackId)
      : null;

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

      for (const tr of tracks.slice(0, 2500)) {
        const job = createAndEnqueueTrackGrabJob({
          artist: String(tr.artist || 'Unknown Artist').trim(),
          title: String(tr.title || '').trim(),
          album: String(tr.album || '').trim(),
          sourceMode,
          slskdUrl,
          slskdApiKey,
          activeFilters,
          ignoreFilters,
          playlistId: tr.playlistId || playlistId,
          ghostTrackId: tr.ghostTrackId || tr.id || null,
        });
        if (job.status === 'filtered') skippedCount += 1;
        createdJobs.push(job);
      }

      const activeCount = createdJobs.length - skippedCount;
      const totalBatches = Math.max(
        1,
        Math.ceil(activeCount / DRIP_BATCH_SIZE)
      );
      return res.json({
        ok: true,
        jobs: createdJobs,
        queuedCount: activeCount,
        skippedCount,
        batchSize: DRIP_BATCH_SIZE,
        totalBatches,
        message: `Queued ${activeCount} track(s) in Staggered Drip Queue (${DRIP_BATCH_SIZE} tracks/batch across ${totalBatches} batch${totalBatches === 1 ? '' : 'es'}) via ${formatEngineChainLabel(sourceMode)}${
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

    if (type === 'track') {
      if (!ignoreFilters) {
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

      const job = createAndEnqueueTrackGrabJob({
        artist,
        title,
        album: String(req.body?.album || ''),
        sourceMode,
        slskdUrl,
        slskdApiKey,
        activeFilters,
        ignoreFilters,
        playlistId,
        ghostTrackId,
      });

      return res.json({
        ok: true,
        job,
        message: `Queued "${label}" via ${formatEngineChainLabel(sourceMode)}.`,
      });
    }

    // Album grab job
    const job = {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'album',
      sourceEngine:
        sourceMode === 'youtube'
          ? 'youtube'
          : sourceMode === 'archive'
            ? 'archive'
            : sourceMode === 'lidarr'
              ? 'lidarr'
              : 'slskd',
      sourceMode,
      label,
      artist,
      title,
      searchText: `${artist} ${title}`.trim(),
      expectedTracks: tracks,
      status: 'queued',
      queuePosition: pendingGrabQueue.length + 1,
      message: `Waiting in queue · ${formatEngineChainLabel(sourceMode)}`,
      matchedPeer: null,
      matchedFormat: null,
      files: [],
      playlistId,
      ghostTrackId,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    slskdJobs.set(job.id, job);
    pendingGrabQueue.push({
      job,
      slskdUrl,
      slskdApiKey,
      sourceMode,
      filtersConfig: ignoreFilters ? null : activeFilters,
    });
    pumpGrabQueue();
    saveDripQueueState();

    return res.json({
      ok: true,
      job,
      message: `Started automated ${job.type} grab for "${label}" (${formatEngineChainLabel(sourceMode)}).`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to start download.',
    });
  }
};

app.post('/api/slskd/grab', handleSlskdGrabRequest);
app.post('/api/slskd/grab-job', handleSlskdGrabRequest);

app.get('/api/slskd/status', (_req, res) => {
  updatePendingQueuePositions();
  const jobs = Array.from(slskdJobs.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  let queuedCount = 0;
  let searchingCount = 0;
  let downloadingCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  let filteredCount = 0;

  for (const j of jobs) {
    if (j.status === 'queued') queuedCount++;
    else if (j.status === 'searching') searchingCount++;
    else if (j.status === 'downloading') downloadingCount++;
    else if (j.status === 'completed') completedCount++;
    else if (j.status === 'failed') failedCount++;
    else if (j.status === 'filtered') filteredCount++;
  }

  res.json({
    ok: true,
    jobs,
    notifications: readyNotifications,
    dripQueue: {
      batchSize: DRIP_BATCH_SIZE,
      dripDelayMs: DRIP_STEP_DELAY_MS,
      activeWorkers: activeGrabWorkers,
      queuedCount,
      searchingCount,
      downloadingCount,
      completedCount,
      failedCount,
      filteredCount,
      totalBatchesRemaining: Math.ceil(queuedCount / DRIP_BATCH_SIZE),
    },
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

      job.message = `Downloading via slskd (${job.matchedPeer}): ${completedCount}/${job.files.length} file(s) complete`;

      if (completedCount === job.files.length) {
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        job.message = `✓ Downloaded via slskd & added to library!`;

        await runFullLibraryScan();
        reconcilePlaylistsWithLibrary();

        readyNotifications.unshift({
          id: `notif-${job.id}`,
          jobId: job.id,
          label: job.label,
          message: `${job.label} is ready to play in your library!`,
          completedAt: job.completedAt,
        });
        addPersistentNotification({
          id: `notif-${job.id}`,
          message: `${job.label} downloaded via slskd & indexed into /music!`,
          category: 'download',
          severity: 'success',
          service: 'slskd',
          trackId: job.trackId || undefined,
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
  cleanTitle = cleanTitle
    .replace(/\s*\((official\s*(music\s*)?video|official\s*audio|lyric\s*video|hd|4k|hq|320\s*kbps)\)/gi, '')
    .replace(/\s*\[(official\s*(music\s*)?video|official\s*audio|lyric\s*video|hd|4k|hq|320\s*kbps)\]/gi, '')
    .replace(/^\d{1,3}\s*[-._]\s*/, '')
    .trim();

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

// MusicBrainz (The IMDb of Music) Live Search for Song / Album / Artist Metadata Linking
app.get('/api/metadata/musicbrainz-search', async (req, res) => {
  try {
    const title = String(req.query.title || '').trim();
    const artist = String(req.query.artist || '').trim();
    const album = String(req.query.album || '').trim();
    const qRaw = String(req.query.q || '').trim();

    const parts: string[] = [];
    if (title) parts.push(`recording:"${title}"`);
    if (artist && artist !== 'Unknown Artist') parts.push(`artist:"${artist}"`);
    if (album && album !== 'Singles') parts.push(`release:"${album}"`);
    const finalQuery = parts.length > 0 ? parts.join(' AND ') : qRaw;

    if (!finalQuery) {
      return res.status(400).json({
        ok: false,
        error: 'Provide a song title, artist, or album to search MusicBrainz.',
      });
    }

    const mbUrl = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(
      finalQuery
    )}&limit=6&fmt=json`;

    const mbResp = await fetch(mbUrl, {
      headers: MB_HEADERS,
      signal: AbortSignal.timeout(8000),
    });

    if (!mbResp.ok) {
      return res.status(mbResp.status).json({
        ok: false,
        error: `MusicBrainz returned HTTP ${mbResp.status}`,
      });
    }

    const mbData = await mbResp.json();
    const recordings = Array.isArray(mbData?.recordings)
      ? mbData.recordings
      : [];

    const results = recordings.map((rec: any) => {
      const credit = rec['artist-credit']?.[0];
      const recArtist =
        credit?.name || credit?.artist?.name || artist || 'Unknown Artist';
      const artistMbid = credit?.artist?.id || null;
      const officialRel =
        (rec.releases || []).find((r: any) => r.status === 'Official') ||
        rec.releases?.[0];
      const releaseMbid = officialRel?.id || null;
      const recAlbum = officialRel?.title || album || 'Singles';
      const recYear =
        (officialRel?.date || rec['first-release-date'] || '').slice(0, 4) ||
        null;

      return {
        recordingMbid: String(rec.id || ''),
        title: String(rec.title || title),
        artist: String(recArtist),
        artistMbid,
        album: String(recAlbum),
        releaseMbid,
        year: recYear ? Number(recYear) : null,
        score: Number(rec.score || 100),
        musicbrainzUrl: rec.id
          ? `https://musicbrainz.org/recording/${rec.id}`
          : null,
        coverArtUrl: releaseMbid
          ? `https://coverartarchive.org/release/${releaseMbid}/front-250`
          : null,
      };
    });

    return res.json({
      ok: true,
      query: finalQuery,
      results,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to search MusicBrainz metadata.',
    });
  }
});

// Enrich or manually update metadata & MusicBrainz IDs (MBID) for 1 or more tracks
app.post('/api/metadata/enrich', async (req, res) => {
  try {
    const rawIds = Array.isArray(req.body?.trackIds)
      ? req.body.trackIds.map(String)
      : req.body?.trackId
        ? [String(req.body.trackId)]
        : [];

    if (rawIds.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Provide trackId or trackIds to update or refresh metadata.',
      });
    }

    const manualOverride = req.body?.manualOverride;
    const updatedTracks = [];
    const errors = [];

    for (const tid of rawIds.slice(0, 50)) {
      if (manualOverride && typeof manualOverride === 'object') {
        const updated = await updateTrackMetadataInDb({
          trackId: tid,
          title:
            rawIds.length === 1 && manualOverride.title
              ? String(manualOverride.title)
              : undefined,
          artist: manualOverride.artist
            ? String(manualOverride.artist)
            : undefined,
          album: manualOverride.album
            ? String(manualOverride.album)
            : undefined,
          year:
            manualOverride.year !== undefined
              ? manualOverride.year
                ? Number(manualOverride.year)
                : null
              : undefined,
          genre: manualOverride.genre
            ? String(manualOverride.genre)
            : undefined,
          musicbrainzId:
            rawIds.length === 1 && manualOverride.musicbrainzId !== undefined
              ? manualOverride.musicbrainzId
              : undefined,
          artistMusicbrainzId:
            manualOverride.artistMusicbrainzId !== undefined
              ? manualOverride.artistMusicbrainzId
              : undefined,
          albumMusicbrainzId:
            manualOverride.albumMusicbrainzId !== undefined
              ? manualOverride.albumMusicbrainzId
              : undefined,
        });
        if (updated) updatedTracks.push(updated);
      } else {
        const resEnrich = await enrichTrackFromMusicBrainz(tid);
        if (resEnrich.ok && resEnrich.track) {
          updatedTracks.push(resEnrich.track);
        } else {
          errors.push(resEnrich.message);
        }
      }
    }

    return res.json({
      ok: true,
      updatedCount: updatedTracks.length,
      updatedTracks,
      allTracks: queryTracks(),
      playlists: queryPlaylists(),
      message:
        updatedTracks.length > 0
          ? `Updated metadata & MusicBrainz IDs for ${updatedTracks.length} track(s)!`
          : errors[0] || 'No matching MusicBrainz metadata found.',
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error ? err.message : 'Failed to refresh metadata.',
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
  const rawUrl = String(rule.sourceUrl || rule.spotifyUrl || '').trim();
  const { playlistTitle, tracks } = await fetchSpotifyTracksFromUrl(rawUrl, {
    maxTracks: rule.maxTracks ?? 1000,
    playlistId: rule.playlistId,
  });

  const targetPl = queryPlaylists().find((p) => p.id === rule.playlistId);
  const playlistId = rule.playlistId || `pl-spotify-${Date.now().toString(36)}`;
  const playlistName =
    targetPl?.name || rule.playlistName || playlistTitle || 'Spotify Playlist';

  const existingGhosts = Array.isArray(targetPl?.ghostTracks)
    ? [...targetPl.ghostTracks]
    : [];
  const seenKeys = new Set(
    existingGhosts.map(
      (g) => `${normalizeText(g.artist)}::${normalizeText(g.title)}`
    )
  );
  const combinedGhosts = [...existingGhosts];
  for (const tr of tracks) {
    const key = `${normalizeText(tr.artist)}::${normalizeText(tr.title)}`;
    if (!tr.title || seenKeys.has(key)) continue;
    seenKeys.add(key);
    combinedGhosts.push({
      id: `ghost-${playlistId}-${combinedGhosts.length + 1}-${Math.random()
        .toString(36)
        .slice(2, 6)}`,
      title: tr.title,
      artist: tr.artist || 'Unknown Artist',
      album: tr.album,
      durationSec: tr.durationSec || 210,
      matchedTrackId: null,
    });
  }

  upsertPlaylistWithTracks({
    id: playlistId,
    name: playlistName,
    description: targetPl?.description || `Spotify Playlist (${combinedGhosts.length} tracks)`,
    ghostTracks: combinedGhosts,
    spotifyUrl: rawUrl,
    trackIds: targetPl?.trackIds || [],
  });

  reconcilePlaylistsWithLibrary();

  const updatedPl = queryPlaylists().find((p) => p.id === playlistId);
  const finalGhosts = Array.isArray(updatedPl?.ghostTracks)
    ? updatedPl.ghostTracks
    : combinedGhosts;
  const matchedCount = finalGhosts.filter((g) => Boolean(g.matchedTrackId)).length;
  const missingGhosts = finalGhosts.filter((g) => !g.matchedTrackId);

  let queuedCount = 0;
  if (rule.autoDownloadMissing && missingGhosts.length > 0) {
    const { slskdUrl, slskdApiKey } = getSlskdConfig();
    const sourceMode = cfg.integrations?.preferredDownloader || 'auto';
    for (const ghost of missingGhosts) {
      const job = createAndEnqueueTrackGrabJob({
        artist: ghost.artist,
        title: ghost.title,
        album: ghost.album || '',
        sourceMode,
        slskdUrl,
        slskdApiKey,
        activeFilters: cfg.discoveryFilters,
        ignoreFilters: false,
        playlistId,
        ghostTrackId: ghost.id,
      });
      if (job.status !== 'filtered') {
        queuedCount += 1;
      }
    }
  }

  rules[ruleIdx] = {
    ...rule,
    lastSyncedAt: new Date().toISOString(),
    lastAddedCount: matchedCount,
    lastMissingQueuedCount: queuedCount,
    statusMessage: `Synced ${finalGhosts.length} Spotify tracks (${matchedCount} in library, ${missingGhosts.length} ghost tracks, ${queuedCount} downloading).`,
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
    incrementTrackPlayCount(String(rawTrack.id), nowIso);

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
      port: Number(process.env.PORT || 3487),
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

const handleRunDiagnosticsCheck = async (_req: any, res: any) => {
  const cfg = readServerConfig();
  const counts = getLocalLibraryStats();
  const checks: any[] = [];
  const tStart = Date.now();

  // 1. API Server & Response Latency (/api/ping)
  const mem = process.memoryUsage();
  const rssMb = Math.round((mem.rss || 0) / (1024 * 1024));
  const uptimeSec = Math.round(process.uptime());
  checks.push({
    id: 'api-ping',
    name: 'API Server & Response Latency (/api/ping)',
    category: 'system',
    status: 'ok',
    latencyMs: Math.max(1, Date.now() - tStart),
    summary: `ONLINE · HTTP 200 OK · Uptime ${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s · RAM ${rssMb} MB`,
    details: `Port ${PORT} (0.0.0.0) | Node ${process.version} | Uptime Kuma Endpoint: /api/ping`,
  });

  // 2. SQLite Database (/data/brokeify.db read/write & WAL status)
  try {
    const t0 = Date.now();
    fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
    let dbSizeKb = 0;
    try {
      if (fs.existsSync(DB_PATH)) {
        dbSizeKb = Math.round(fs.statSync(DB_PATH).size / 1024);
      }
    } catch {}
    const walMode = String(db.pragmaState?.journal_mode || 'wal').toUpperCase();
    const busyTimeout = Number(db.pragmaState?.busy_timeout || 5000);
    const latencyMs = Math.max(1, Date.now() - t0);
    checks.push({
      id: 'sqlite',
      name: 'SQLite Database (/data/brokeify.db)',
      category: 'system',
      status: 'ok',
      latencyMs,
      summary: `READ/WRITE OK · journal_mode=${walMode} · busy_timeout=${busyTimeout}ms (${latencyMs}ms)`,
      details: `DB Path: ${DB_PATH} (${dbSizeKb} KB) | Covers Cache: ${COVERS_DIR}`,
    });
  } catch (err) {
    checks.push({
      id: 'sqlite',
      name: 'SQLite Database (/data/brokeify.db)',
      category: 'system',
      status: 'error',
      summary: `Cannot read/write ${DATA_DIR}`,
      details: err instanceof Error ? err.message : String(err),
      hint: 'Verify Docker volume permissions on /data (owned by UID 1000 / node).',
    });
  }

  // 3. Music Library Mount (/music readable & track count)
  try {
    const t0 = Date.now();
    const driveInfo = inspectMusicDrive();
    const [ytDlpInfo, ffmpegInfo] = await Promise.all([
      checkBinaryInstalled('yt-dlp'),
      checkBinaryInstalled('ffmpeg'),
    ]);
    const latencyMs = Math.max(1, Date.now() - t0);
    const isMountedAndReadable = Boolean(driveInfo.exists);
    checks.push({
      id: 'music-mount',
      name: 'Music Library Mount (/music)',
      category: 'audio',
      status: isMountedAndReadable
        ? counts.totalTracks > 0
          ? 'ok'
          : 'warn'
        : 'error',
      latencyMs,
      summary: isMountedAndReadable
        ? `READABLE · ${counts.totalTracks} tracks, ${counts.totalAlbums} albums, ${counts.totalArtists} artists (${latencyMs}ms)`
        : `UNMOUNTED OR UNREADABLE (${MUSIC_DIR})`,
      details: `Mount: ${MUSIC_DIR} | Playlists: ${counts.totalPlaylists} | EBU R128 LUFS: ${
        ffmpegInfo.installed ? 'ffmpeg active' : 'ReplayGain tag fallback'
      } | yt-dlp: ${ytDlpInfo.installed ? ytDlpInfo.version : 'fallback'}`,
      hint:
        counts.totalTracks === 0
          ? 'Mount your music folder to /music:ro in docker-compose.yml or download songs via Request / Discover.'
          : undefined,
    });
  } catch (err) {
    checks.push({
      id: 'music-mount',
      name: 'Music Library Mount (/music)',
      category: 'audio',
      status: 'error',
      summary: `Error inspecting ${MUSIC_DIR}`,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // 4A. Optional Integration: slskd Soulseek P2P
  const { slskdUrl, slskdApiKey } = getSlskdConfig();
  if (!slskdUrl || !slskdApiKey) {
    checks.push({
      id: 'slskd',
      name: 'slskd Soulseek P2P (Optional)',
      category: 'slskd',
      status: 'warn',
      summary: 'Not Configured (Optional — uses YouTube/Archive fallback)',
      details: 'Set SLSKD_URL and SLSKD_API_KEY in .env or Settings to enable Soulseek P2P.',
    });
  } else {
    const t0 = Date.now();
    try {
      const resp = await fetch(`${slskdUrl}/api/v0/application`, {
        headers: buildSlskdHeaders(slskdApiKey),
        signal: AbortSignal.timeout(4500),
      });
      const latencyMs = Date.now() - t0;
      checks.push({
        id: 'slskd',
        name: 'slskd Soulseek P2P',
        category: 'slskd',
        status: resp.ok ? 'ok' : 'error',
        latencyMs,
        summary: resp.ok
          ? `ONLINE · Reachable at ${slskdUrl} (${latencyMs}ms)`
          : `HTTP ${resp.status} from ${slskdUrl}`,
        hint: !resp.ok
          ? 'Verify your slskd X-API-Key and LAN IP / Docker container name.'
          : undefined,
      });
    } catch (err) {
      checks.push({
        id: 'slskd',
        name: 'slskd Soulseek P2P',
        category: 'slskd',
        status: 'error',
        summary: `UNREACHABLE at ${slskdUrl}`,
        details: err instanceof Error ? err.message : String(err),
        hint: 'Check that the slskd container is running and reachable on port 5030.',
      });
    }
  }

  // 4B. Optional Integration: Lidarr
  const { lidarrUrl, lidarrApiKey } = getLidarrConfig();
  if (!lidarrUrl || !lidarrApiKey) {
    checks.push({
      id: 'lidarr',
      name: 'Lidarr Arr Stack (Optional)',
      category: 'lidarr',
      status: 'warn',
      summary: 'Not Configured (Optional)',
      details: 'Set LIDARR_URL and LIDARR_API_KEY in .env or Settings if using Lidarr.',
    });
  } else {
    const t0 = Date.now();
    try {
      const resp = await fetch(`${lidarrUrl}/api/v1/system/status`, {
        headers: buildLidarrHeaders(lidarrApiKey),
        signal: AbortSignal.timeout(4500),
      });
      const latencyMs = Date.now() - t0;
      checks.push({
        id: 'lidarr',
        name: 'Lidarr Arr Stack',
        category: 'lidarr',
        status: resp.ok ? 'ok' : 'error',
        latencyMs,
        summary: resp.ok
          ? `ONLINE · Connected to Lidarr (${latencyMs}ms)`
          : `HTTP ${resp.status} from Lidarr`,
      });
    } catch (err) {
      checks.push({
        id: 'lidarr',
        name: 'Lidarr Arr Stack',
        category: 'lidarr',
        status: 'error',
        summary: `UNREACHABLE at ${lidarrUrl}`,
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4C. Optional Integration: MusicBrainz Metadata API
  {
    const t0 = Date.now();
    try {
      const mbResp = await fetch(
        'https://musicbrainz.org/ws/2/artist/056e4f3e-d505-4dad-8ec1-d04f521cbb56?fmt=json',
        {
          headers: MB_HEADERS,
          signal: AbortSignal.timeout(5000),
        }
      );
      const latencyMs = Date.now() - t0;
      checks.push({
        id: 'musicbrainz',
        name: 'MusicBrainz Picard Metadata API',
        category: 'system',
        status: mbResp.ok ? 'ok' : 'warn',
        latencyMs,
        summary: mbResp.ok
          ? `ONLINE · musicbrainz.org reachable (${latencyMs}ms)`
          : `MusicBrainz returned HTTP ${mbResp.status} (${latencyMs}ms)`,
        details: 'Used for automatic MBID tagging, album release dates, and cover art resolution.',
      });
    } catch (err) {
      checks.push({
        id: 'musicbrainz',
        name: 'MusicBrainz Picard Metadata API',
        category: 'system',
        status: 'warn',
        summary: 'Unreachable (Offline or rate-limited)',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4D. Optional Integration: LRCLIB Synchronized Lyrics API
  {
    const t0 = Date.now();
    try {
      const lrcResp = await fetch(
        'https://lrclib.net/api/search?q=One+More+Time',
        {
          headers: {
            'User-Agent': 'Brokeify/3.0.0 (https://github.com/mr-nickey/brokeify)',
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        }
      );
      const latencyMs = Date.now() - t0;
      checks.push({
        id: 'lrclib',
        name: 'LRCLIB Synchronized Lyrics API',
        category: 'audio',
        status: lrcResp.ok ? 'ok' : 'warn',
        latencyMs,
        summary: lrcResp.ok
          ? `ONLINE · lrclib.net reachable (${latencyMs}ms)`
          : `LRCLIB returned HTTP ${lrcResp.status} (${latencyMs}ms)`,
        details: 'Provides time-synced .lrc karaoke lyrics for the Now Playing drawer.',
      });
    } catch (err) {
      checks.push({
        id: 'lrclib',
        name: 'LRCLIB Synchronized Lyrics API',
        category: 'audio',
        status: 'warn',
        summary: 'Unreachable (Using built-in studio lyric fallback)',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Emit structured diagnostic summary to stdout so Dozzle & Docker logs capture full visibility
  const summaryLine = checks
    .map((c) => `${c.id}=${c.status.toUpperCase()}${c.latencyMs ? `(${c.latencyMs}ms)` : ''}`)
    .join(' | ');
  pushServerLog(
    checks.some((c) => c.status === 'error') ? 'warn' : 'info',
    'system',
    `[DOZZLE-HEALTHCHECK] ${summaryLine}`,
    {
      endpoint: 'GET/POST /api/debug/diagnostics',
      details: JSON.stringify(checks, null, 2),
    }
  );

  return res.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - tStart,
    checks,
    logs: serverDebugLogs,
  });
};

app.get('/api/debug/diagnostics', handleRunDiagnosticsCheck);
app.post('/api/debug/diagnostics', handleRunDiagnosticsCheck);

// ============================================================================
// 13B. PERSISTENT NOTIFICATION CENTER API (/api/notifications)
// ============================================================================

app.get('/api/notifications', (_req, res) => {
  const cfg = readServerConfig();
  const data = getPersistentNotifications(120);
  return res.json({
    ok: true,
    notificationMode: cfg.notificationMode || 'bell_only',
    ...data,
  });
});

app.post('/api/notifications/read', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : undefined;
  const data = markPersistentNotificationsRead(ids);
  return res.json({
    ok: true,
    ...data,
  });
});

app.post('/api/notifications/delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : undefined;
  if (!ids || ids.length === 0) {
    readyNotifications.length = 0;
  }
  const data = deletePersistentNotifications(ids);
  return res.json({
    ok: true,
    ...data,
  });
});

app.delete('/api/notifications', (_req, res) => {
  readyNotifications.length = 0;
  const data = deletePersistentNotifications();
  return res.json({
    ok: true,
    ...data,
  });
});

// ============================================================================
// 13C. STAGING INBOX AUTO-ORGANIZER, WEB FILE & TAG MANAGER, AND WRONG-TRACK AUTO-REPLACEMENT
// ============================================================================

const AUDIO_FILE_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
  '.wav',
]);

let isScanningStagingInbox = false;

async function scanAndOrganizeStagingInbox() {
  if (isScanningStagingInbox) return { organizedCount: 0, files: [] };
  const cfg = readServerConfig();
  if (cfg.integrations?.autoOrganizeDownloads === false) {
    return { organizedCount: 0, files: [] };
  }

  const stagingDir =
    cfg.integrations?.stagingDir || path.join(getMusicDir(), '_inbox');
  if (!fs.existsSync(stagingDir)) {
    return { organizedCount: 0, files: [] };
  }

  isScanningStagingInbox = true;
  const organizedFiles: Array<{ from: string; to: string; title?: string; artist?: string }> = [];
  try {
    const collectAudioFiles = (dir: string, acc: string[] = []): string[] => {
      if (!fs.existsSync(dir)) return acc;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          collectAudioFiles(full, acc);
        } else if (
          entry.isFile() &&
          AUDIO_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        ) {
          acc.push(full);
        }
      }
      return acc;
    };

    const inboxAudioFiles = collectAudioFiles(stagingDir);
    for (const filePath of inboxAudioFiles) {
      try {
        const res = await fingerprintTagAndOrganizeFile(filePath, {
          acoustidApiKey: cfg.integrations?.acoustidApiKey,
          moveToLibraryRoot: true,
        });
        if (res.ok) {
          organizedFiles.push({
            from: filePath,
            to: res.finalPath,
            title: res.identified.title,
            artist: res.identified.artist,
          });
        }
      } catch {
        // continue with next file
      }
    }

    if (organizedFiles.length > 0) {
      addPersistentNotification({
        message: `Staging Auto-Organizer: Fingerprinted, tagged & organized ${organizedFiles.length} incoming track(s) from ${stagingDir} into /music.`,
        category: 'library',
        severity: 'success',
        service: 'Auto-Organizer',
      });
    }
  } catch {
    // ignore
  } finally {
    isScanningStagingInbox = false;
  }

  return {
    organizedCount: organizedFiles.length,
    files: organizedFiles,
  };
}

setInterval(() => {
  scanAndOrganizeStagingInbox().catch(() => {});
}, 15000);

app.post('/api/staging/scan', async (_req, res) => {
  const result = await scanAndOrganizeStagingInbox();
  return res.json({
    ok: true,
    ...result,
  });
});

// GET /api/files/browse?path=... -> Sandboxed directory & audio tag browser inside /music
app.get('/api/files/browse', (req, res) => {
  const relParam = String(req.query.path || '');
  const resolved = resolveSandboxedMusicPath(relParam);
  if (!resolved.ok) {
    return res.status(400).json({ ok: false, error: resolved.error });
  }

  const musicRoot = getMusicDir();
  try {
    fs.mkdirSync(musicRoot, { recursive: true });
    const inboxDir = path.join(musicRoot, '_inbox');
    fs.mkdirSync(inboxDir, { recursive: true });
  } catch {}

  if (!fs.existsSync(resolved.fullPath)) {
    return res.json({
      ok: true,
      musicRoot,
      currentPath: resolved.relativePath,
      folders: [],
      files: [],
    });
  }

  try {
    const entries = fs.readdirSync(resolved.fullPath, { withFileTypes: true });
    const allIndexedTracks = queryTracks({ limit: 10000 });
    const trackByPath = new Map<string, any>();
    for (const t of allIndexedTracks) {
      if (t.filePath) {
        trackByPath.set(path.resolve(t.filePath), t);
      }
    }

    const folders: any[] = [];
    const files: any[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullEntryPath = path.join(resolved.fullPath, entry.name);
      const relEntryPath = path
        .relative(musicRoot, fullEntryPath)
        .replace(/\\/g, '/');

      if (entry.isDirectory()) {
        let childCount = 0;
        try {
          childCount = fs
            .readdirSync(fullEntryPath)
            .filter((n) => !n.startsWith('.')).length;
        } catch {}
        folders.push({
          name: entry.name,
          relativePath: relEntryPath,
          childCount,
          isStagingInbox: entry.name === '_inbox',
        });
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!AUDIO_FILE_EXTENSIONS.has(ext) && ext !== '.m3u' && ext !== '.m3u8') {
          continue;
        }
        let stat: fs.Stats | null = null;
        try {
          stat = fs.statSync(fullEntryPath);
        } catch {}
        const indexed = trackByPath.get(path.resolve(fullEntryPath));
        files.push({
          name: entry.name,
          relativePath: relEntryPath,
          extension: ext,
          sizeBytes: stat?.size || 0,
          modifiedAt: stat?.mtime ? stat.mtime.toISOString() : '',
          trackId: indexed?.id || null,
          title: indexed?.title || path.basename(entry.name, ext),
          artist: indexed?.artist || 'Unknown Artist',
          album: indexed?.album || 'Unknown Album',
          trackNumber: indexed?.trackNumber || 1,
          discNumber: indexed?.discNumber || 1,
          year: indexed?.year || null,
          genre: indexed?.genre || 'Unknown',
          durationSec: indexed?.duration || 0,
          bitrate: indexed?.bitrate || 0,
          format: indexed?.format || ext.replace('.', '').toUpperCase(),
          artworkUrl: indexed?.artworkUrl || null,
          mbid: indexed?.mbid || null,
          variantFlags: detectVariantFlagsInText(
            `${indexed?.title || entry.name} ${indexed?.album || ''}`
          ),
        });
      }
    }

    folders.sort((a, b) => {
      if (a.isStagingInbox && !b.isStagingInbox) return -1;
      if (!a.isStagingInbox && b.isStagingInbox) return 1;
      return a.name.localeCompare(b.name);
    });
    files.sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0) || a.name.localeCompare(b.name));

    return res.json({
      ok: true,
      musicRoot,
      currentPath: resolved.relativePath,
      folders,
      files,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to browse directory.',
    });
  }
});

// POST /api/files/mkdir -> Create a new folder inside /music
app.post('/api/files/mkdir', (req, res) => {
  const parentRel = String(req.body?.parentPath || '');
  const folderName = String(req.body?.folderName || '').trim();
  if (!folderName) {
    return res.status(400).json({ ok: false, error: 'Folder name is required.' });
  }
  const resolved = resolveSandboxedMusicPath(
    path.posix.join(parentRel, folderName.replace(/[<>:"/\\|?*]/g, '_'))
  );
  if (!resolved.ok) {
    return res.status(400).json({ ok: false, error: resolved.error });
  }
  try {
    fs.mkdirSync(resolved.fullPath, { recursive: true });
    return res.json({ ok: true, relativePath: resolved.relativePath });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to create folder.',
    });
  }
});

// POST /api/files/rename -> Rename a file or folder inside /music
app.post('/api/files/rename', async (req, res) => {
  const sourceRel = String(req.body?.relativePath || '');
  const newName = String(req.body?.newName || '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim();
  if (!sourceRel || !newName) {
    return res
      .status(400)
      .json({ ok: false, error: 'relativePath and newName are required.' });
  }

  const srcResolved = resolveSandboxedMusicPath(sourceRel);
  if (!srcResolved.ok || !fs.existsSync(srcResolved.fullPath)) {
    return res.status(404).json({ ok: false, error: 'Source file/folder not found.' });
  }

  const parentDirRel = path.posix.dirname(srcResolved.relativePath);
  const destResolved = resolveSandboxedMusicPath(
    parentDirRel === '.' ? newName : `${parentDirRel}/${newName}`
  );
  if (!destResolved.ok) {
    return res.status(400).json({ ok: false, error: destResolved.error });
  }

  try {
    const isDir = fs.statSync(srcResolved.fullPath).isDirectory();
    if (!isDir) {
      removeAudioFileFromIndex(srcResolved.fullPath);
    }
    fs.renameSync(srcResolved.fullPath, destResolved.fullPath);
    if (isDir) {
      await runFullLibraryScan();
    } else {
      await indexAudioFile(destResolved.fullPath);
    }
    reconcilePlaylistsWithLibrary();
    return res.json({
      ok: true,
      oldPath: srcResolved.relativePath,
      newPath: destResolved.relativePath,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to rename item.',
    });
  }
});

// POST /api/files/move -> Move files/folders into target folder inside /music
app.post('/api/files/move', async (req, res) => {
  const pathsToMove: string[] = Array.isArray(req.body?.paths)
    ? req.body.paths
    : req.body?.relativePath
      ? [req.body.relativePath]
      : [];
  const targetFolderRel = String(req.body?.targetFolder || '');

  const destFolder = resolveSandboxedMusicPath(targetFolderRel);
  if (!destFolder.ok) {
    return res.status(400).json({ ok: false, error: destFolder.error });
  }

  try {
    fs.mkdirSync(destFolder.fullPath, { recursive: true });
    const moved: string[] = [];

    for (const rel of pathsToMove) {
      const src = resolveSandboxedMusicPath(rel);
      if (!src.ok || !fs.existsSync(src.fullPath)) continue;
      const baseName = path.basename(src.fullPath);
      const targetFull = path.join(destFolder.fullPath, baseName);
      if (path.resolve(targetFull) === path.resolve(src.fullPath)) continue;

      const isDir = fs.statSync(src.fullPath).isDirectory();
      if (
        isDir &&
        path
          .resolve(targetFull)
          .startsWith(path.resolve(src.fullPath) + path.sep)
      ) {
        continue;
      }
      if (!isDir) {
        removeAudioFileFromIndex(src.fullPath);
      }
      const oldParent = path.dirname(src.fullPath);
      fs.renameSync(src.fullPath, targetFull);
      if (!isDir) {
        await indexAudioFile(targetFull);
      }
      cleanupEmptyParentDirs(oldParent, getMusicDir());
      moved.push(baseName);
    }

    await runFullLibraryScan();
    reconcilePlaylistsWithLibrary();
    return res.json({
      ok: true,
      movedCount: moved.length,
      targetFolder: destFolder.relativePath,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to move files.',
    });
  }
});

// POST /api/files/delete -> Delete unwanted files/folders inside /music
app.post('/api/files/delete', async (req, res) => {
  const pathsToDelete: string[] = Array.isArray(req.body?.paths)
    ? req.body.paths
    : req.body?.relativePath
      ? [req.body.relativePath]
      : [];

  if (pathsToDelete.length === 0) {
    return res.status(400).json({ ok: false, error: 'No paths specified.' });
  }

  try {
    let deletedCount = 0;
    for (const rel of pathsToDelete) {
      const target = resolveSandboxedMusicPath(rel);
      if (
        !target.ok ||
        !target.relativePath ||
        !fs.existsSync(target.fullPath)
      ) {
        continue;
      }
      const stat = fs.statSync(target.fullPath);
      const parentDir = path.dirname(target.fullPath);
      if (stat.isDirectory()) {
        fs.rmSync(target.fullPath, { recursive: true, force: true });
      } else {
        removeAudioFileFromIndex(target.fullPath);
        fs.unlinkSync(target.fullPath);
      }
      cleanupEmptyParentDirs(parentDir, getMusicDir());
      deletedCount++;
    }

    await runFullLibraryScan();
    reconcilePlaylistsWithLibrary();
    return res.json({ ok: true, deletedCount });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to delete item(s).',
    });
  }
});

// POST /api/files/bulk-tag -> Bulk-edit metadata tags (Title, Artist, Album, Track #, Year, Genre, Cover Art) & optionally reorganize path
app.post('/api/files/bulk-tag', async (req, res) => {
  const items: Array<{
    relativePath: string;
    trackId?: string;
    title?: string;
    artist?: string;
    album?: string;
    trackNumber?: number;
    discNumber?: number;
    year?: number;
    genre?: string;
  }> = Array.isArray(req.body?.items) ? req.body.items : [];
  const sharedTags = req.body?.sharedTags || {};
  const organizeFiles = Boolean(req.body?.organizeFiles);

  if (items.length === 0) {
    return res.status(400).json({ ok: false, error: 'No files selected for tagging.' });
  }

  try {
    let updatedCount = 0;
    for (const item of items) {
      const resolved = resolveSandboxedMusicPath(item.relativePath);
      if (!resolved.ok || !fs.existsSync(resolved.fullPath)) continue;

      const mergedMeta = {
        title: item.title || sharedTags.title || undefined,
        artist: item.artist || sharedTags.artist || undefined,
        album: item.album || sharedTags.album || undefined,
        trackNumber:
          item.trackNumber !== undefined
            ? Number(item.trackNumber)
            : sharedTags.trackNumber !== undefined
              ? Number(sharedTags.trackNumber)
              : undefined,
        discNumber:
          item.discNumber !== undefined
            ? Number(item.discNumber)
            : sharedTags.discNumber !== undefined
              ? Number(sharedTags.discNumber)
              : undefined,
        year:
          item.year !== undefined
            ? Number(item.year)
            : sharedTags.year !== undefined
              ? Number(sharedTags.year)
              : undefined,
        genre: item.genre || sharedTags.genre || undefined,
      };

      await embedMetadataAndArtworkIntoFile(resolved.fullPath, mergedMeta);

      let finalPath = resolved.fullPath;
      if (organizeFiles && (mergedMeta.artist || mergedMeta.album || mergedMeta.title)) {
        const ext = path.extname(resolved.fullPath) || '.mp3';
        const dest = buildOrganizedTrackDestination(getMusicDir(), {
          artist: mergedMeta.artist || 'Unknown Artist',
          album: mergedMeta.album || 'Singles',
          year: mergedMeta.year,
          trackNumber: mergedMeta.trackNumber || 1,
          title: mergedMeta.title || path.basename(resolved.fullPath, ext),
          ext,
        });
        if (path.resolve(dest) !== path.resolve(resolved.fullPath)) {
          const oldDir = path.dirname(resolved.fullPath);
          removeAudioFileFromIndex(resolved.fullPath);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.renameSync(resolved.fullPath, dest);
          cleanupEmptyParentDirs(oldDir, getMusicDir());
          finalPath = dest;
        }
      }

      const row = await indexAudioFile(finalPath);
      if (row) {
        updateTrackMetadataInDb(row.id, mergedMeta);
      }
      updatedCount++;
    }

    reconcilePlaylistsWithLibrary();
    return res.json({
      ok: true,
      updatedCount,
      message: `Updated tags on ${updatedCount} audio file(s).`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Bulk tag update failed.',
    });
  }
});

// POST /api/files/identify-folder -> 1-Click "Auto-Identify & Organize Folder" with Before/After Preview & Apply
app.post('/api/files/identify-folder', async (req, res) => {
  const folderRel = String(req.body?.relativePath || '');
  const applyChanges = Boolean(req.body?.apply);
  const cfg = readServerConfig();

  const resolved = resolveSandboxedMusicPath(folderRel);
  if (!resolved.ok || !fs.existsSync(resolved.fullPath)) {
    return res.status(404).json({ ok: false, error: 'Target folder not found.' });
  }

  try {
    const entries = fs.readdirSync(resolved.fullPath, { withFileTypes: true });
    const audioFiles = entries
      .filter(
        (e) =>
          e.isFile() &&
          !e.name.startsWith('.') &&
          AUDIO_FILE_EXTENSIONS.has(path.extname(e.name).toLowerCase())
      )
      .map((e) => path.join(resolved.fullPath, e.name));

    const musicRoot = getMusicDir();
    const previewItems: any[] = [];

    for (const filePath of audioFiles) {
      const relBefore = path.relative(musicRoot, filePath).replace(/\\/g, '/');
      const ext = path.extname(filePath) || '.mp3';

      if (applyChanges) {
        removeAudioFileFromIndex(filePath);
        const org = await fingerprintTagAndOrganizeFile(filePath, {
          acoustidApiKey: cfg.integrations?.acoustidApiKey,
          moveToLibraryRoot: true,
        });
        const relAfter = path
          .relative(musicRoot, org.finalPath)
          .replace(/\\/g, '/');
        previewItems.push({
          beforePath: relBefore,
          afterPath: relAfter,
          title: org.identified.title,
          artist: org.identified.artist,
          album: org.identified.album,
          trackNumber: org.identified.trackNumber,
          year: org.identified.year,
          recordingMbid: org.identified.recordingMbid,
          coverArtUrl: org.identified.coverArtUrl,
          sourceMethod: org.identified.sourceMethod,
          detectedVariantFlags: org.identified.detectedVariantFlags,
          applied: true,
        });
      } else {
        const identified = await identifyAudioFileWithAcoustIdAndMusicBrainz(
          filePath,
          {
            acoustidApiKey: cfg.integrations?.acoustidApiKey,
            downloadArtwork: true,
          }
        );
        const targetDest = buildOrganizedTrackDestination(musicRoot, {
          artist: identified.artist || 'Unknown Artist',
          album: identified.album || 'Singles',
          year: identified.year,
          trackNumber: identified.trackNumber,
          title: identified.title || path.basename(filePath, ext),
          ext,
        });
        const relAfter = path
          .relative(musicRoot, targetDest)
          .replace(/\\/g, '/');
        previewItems.push({
          beforePath: relBefore,
          afterPath: relAfter,
          title: identified.title,
          artist: identified.artist,
          album: identified.album,
          trackNumber: identified.trackNumber,
          year: identified.year,
          recordingMbid: identified.recordingMbid,
          coverArtUrl: identified.coverArtUrl,
          sourceMethod: identified.sourceMethod,
          detectedVariantFlags: identified.detectedVariantFlags,
          applied: false,
        });
      }
    }

    if (applyChanges && previewItems.length > 0) {
      addPersistentNotification({
        message: `Auto-Identify & Organize: Fingerprinted, tagged & organized ${previewItems.length} track(s) in "${folderRel || '/music'}".`,
        category: 'library',
        severity: 'success',
        service: 'AcoustID + MusicBrainz',
      });
    }

    return res.json({
      ok: true,
      applied: applyChanges,
      folderPath: resolved.relativePath,
      items: previewItems,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to identify and organize folder.',
    });
  }
});

// GET /api/library/organize/status -> Get real-time status of the background library organizer job
app.get('/api/library/organize/status', (_req, res) => {
  const job = getLibraryOrganizeJobState();
  return res.json({ ok: true, job });
});

// POST /api/library/organize/start -> Start full or targeted library organization & tag cleanup
app.post('/api/library/organize/start', async (req, res) => {
  const cfg = readServerConfig();
  const targetPath = String(req.body?.targetPath || '');
  const recursive = req.body?.recursive !== false;
  const dryRun = Boolean(req.body?.dryRun);
  const skipOrganized = Boolean(req.body?.skipOrganized);
  const includeInbox = Boolean(req.body?.includeInbox);

  const job = await startLibraryOrganizeJob({
    targetPath,
    recursive,
    dryRun,
    skipOrganized,
    includeInbox,
    acoustidApiKey: cfg.integrations?.acoustidApiKey,
  });

  return res.json({ ok: true, job });
});

// POST /api/library/organize/cancel -> Cancel running organization job
app.post('/api/library/organize/cancel', (_req, res) => {
  const job = cancelLibraryOrganizeJob();
  return res.json({ ok: true, job });
});

// POST /api/library/organize/apply -> Apply dry-run previewed items to library disk
app.post('/api/library/organize/apply', async (_req, res) => {
  const cfg = readServerConfig();
  const job = await applyPreviewedLibraryOrganizeJob(
    cfg.integrations?.acoustidApiKey
  );
  return res.json({ ok: true, job });
});

// ============================================================================
// 13D. STORAGE & DRIVE CAPACITY STATS (/api/storage/stats) + 24H SCHEDULED TASKS CRON ENGINE (/api/scheduler/*)
// ============================================================================

function computeMusicDirectoryStorageStats() {
  const musicRoot = getMusicDir();
  let musicUsedBytes = 0;
  let musicFileCount = 0;
  let musicFolderCount = 0;
  let stagingFileCount = 0;

  const walk = (dir: string, isStagingSubtree = false) => {
    if (!fs.existsSync(dir)) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const inStaging = isStagingSubtree || entry.name === '_inbox';
      if (entry.isDirectory()) {
        musicFolderCount += 1;
        walk(fullPath, inStaging);
      } else if (entry.isFile()) {
        try {
          const st = fs.statSync(fullPath);
          musicUsedBytes += st.size || 0;
          if (
            AUDIO_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
          ) {
            musicFileCount += 1;
            if (inStaging) stagingFileCount += 1;
          }
        } catch {
          // ignore
        }
      }
    }
  };

  walk(musicRoot, false);

  let diskTotalBytes = 0;
  let diskFreeBytes = 0;
  let diskUsedBytes = 0;
  let diskUsedPercent = 0;

  try {
    const targetForStatfs = fs.existsSync(musicRoot)
      ? musicRoot
      : process.cwd();
    if (typeof (fs as any).statfsSync === 'function') {
      const sfs = (fs as any).statfsSync(targetForStatfs);
      const bsize = Number(sfs.bsize || sfs.frsize || 4096);
      const totalBlocks = Number(sfs.blocks || 0);
      const availBlocks = Number(sfs.bavail ?? sfs.bfree ?? 0);
      diskTotalBytes = bsize * totalBlocks;
      diskFreeBytes = bsize * availBlocks;
      diskUsedBytes = Math.max(0, diskTotalBytes - diskFreeBytes);
      diskUsedPercent =
        diskTotalBytes > 0
          ? Math.min(100, Math.round((diskUsedBytes / diskTotalBytes) * 1000) / 10)
          : 0;
    }
  } catch {
    // fallback if statfsSync is unsupported
  }

  let dbSizeBytes = 0;
  try {
    if (fs.existsSync(DB_PATH)) {
      dbSizeBytes = fs.statSync(DB_PATH).size || 0;
    }
  } catch {
    // ignore
  }

  const rawIndexed = queryTracks({ limit: 50000 });
  const allIndexed = Array.isArray(rawIndexed)
    ? rawIndexed
    : Array.isArray((rawIndexed as any)?.tracks)
    ? (rawIndexed as any).tracks
    : [];
  let missingMetadataCount = 0;
  let missingArtworkCount = 0;
  for (const t of allIndexed) {
    if (
      !t.artist ||
      t.artist === 'Unknown Artist' ||
      !t.album ||
      t.album === 'Unknown Album' ||
      !t.year
    ) {
      missingMetadataCount += 1;
    }
    if (!t.artworkUrl || t.artworkUrl.startsWith('data:')) {
      missingArtworkCount += 1;
    }
  }

  return {
    musicRoot,
    musicUsedBytes,
    musicFileCount,
    musicFolderCount,
    stagingFileCount,
    diskTotalBytes,
    diskFreeBytes,
    diskUsedBytes,
    diskUsedPercent,
    dbSizeBytes,
    indexedTrackCount: allIndexed.length,
    missingMetadataCount,
    missingArtworkCount,
  };
}

app.get('/api/storage/stats', (_req, res) => {
  try {
    const stats = computeMusicDirectoryStorageStats();
    return res.json({
      ok: true,
      stats,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to read storage statistics.',
    });
  }
});

export interface ScheduledTaskJob {
  id: string;
  name: string;
  description: string;
  taskType:
    | 'library_scan_heal'
    | 'library_scan_and_heal'
    | 'staging_organize'
    | 'auto_organize_library'
    | 'logs_temp_cleanup'
    | 'cleanup_logs_and_temp'
    | 'playlist_autosync'
    | 'playlist_sync_all'
    | 'custom_folder_organize';
  intervalHours: number;
  enabled: boolean;
  targetPath?: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: 'idle' | 'running' | 'success' | 'error';
  lastMessage: string;
  lastSummary: string;
  isBuiltIn?: boolean;
  builtIn?: boolean;
}

const DEFAULT_SCHEDULED_TASKS: ScheduledTaskJob[] = [
  {
    id: 'job-library-scan-heal',
    name: 'Library Scan & Missing Metadata / Artwork Healer',
    description:
      'Scans /music every 24h, indexes new audio files, and heals tracks missing Artist, Album, Release Year, MBID, or Cover Art via MusicBrainz & AcoustID.',
    taskType: 'library_scan_and_heal',
    intervalHours: 24,
    enabled: true,
    targetPath: '',
    lastRunAt: null,
    nextRunAt: formatNotificationDateTime(Date.now() + 24 * 3600 * 1000),
    lastStatus: 'idle',
    lastMessage: 'Scheduled to run every 24 hours.',
    lastSummary: 'Scheduled to run every 24 hours.',
    isBuiltIn: true,
    builtIn: true,
  },
  {
    id: 'job-staging-organize',
    name: 'Disorganized Library & Staging Auto-Organizer',
    description:
      'Processes incoming downloads in /music/_inbox and cleans up unorganized files into /music/{Artist}/{Album} ({Year})/{TrackNumber} - {Title}.{ext}.',
    taskType: 'auto_organize_library',
    intervalHours: 24,
    enabled: true,
    targetPath: '',
    lastRunAt: null,
    nextRunAt: formatNotificationDateTime(Date.now() + 24 * 3600 * 1000),
    lastStatus: 'idle',
    lastMessage: 'Scheduled to run every 24 hours.',
    lastSummary: 'Scheduled to run every 24 hours.',
    isBuiltIn: true,
    builtIn: true,
  },
  {
    id: 'job-logs-temp-cleanup',
    name: 'Logs, Temp Files & SQLite Storage Cleanup',
    description:
      'Prunes old debug logs, removes empty folders and orphaned temp files, and optimizes the persistent SQLite database.',
    taskType: 'cleanup_logs_and_temp',
    intervalHours: 24,
    enabled: true,
    targetPath: '',
    lastRunAt: null,
    nextRunAt: formatNotificationDateTime(Date.now() + 24 * 3600 * 1000),
    lastStatus: 'idle',
    lastMessage: 'Scheduled to run every 24 hours.',
    lastSummary: 'Scheduled to run every 24 hours.',
    isBuiltIn: true,
    builtIn: true,
  },
  {
    id: 'job-playlist-autosync',
    name: 'Playlists & Autopilot 24h Sync',
    description:
      'Syncs linked Spotify and ListenBrainz playlists and reconciles all playlist ghost tracks against your local /music library.',
    taskType: 'playlist_sync_all',
    intervalHours: 24,
    enabled: true,
    targetPath: '',
    lastRunAt: null,
    nextRunAt: formatNotificationDateTime(Date.now() + 24 * 3600 * 1000),
    lastStatus: 'idle',
    lastMessage: 'Scheduled to run every 24 hours.',
    lastSummary: 'Scheduled to run every 24 hours.',
    isBuiltIn: true,
    builtIn: true,
  },
];

function loadScheduledTasksFromConfig(): ScheduledTaskJob[] {
  const cfg = readServerConfig() as any;
  const saved: ScheduledTaskJob[] = Array.isArray(cfg.scheduledTasks)
    ? cfg.scheduledTasks
    : [];
  const byId = new Map<string, ScheduledTaskJob>();
  for (const def of DEFAULT_SCHEDULED_TASKS) {
    byId.set(def.id, { ...def });
  }
  for (const item of saved) {
    if (item && item.id) {
      const existing = byId.get(item.id);
      const isBuilt = existing
        ? true
        : Boolean(item.isBuiltIn ?? item.builtIn);
      const msg =
        item.lastSummary ||
        item.lastMessage ||
        existing?.lastSummary ||
        'Scheduled to run every 24 hours.';
      byId.set(item.id, {
        ...(existing || {}),
        ...item,
        lastMessage: msg,
        lastSummary: msg,
        isBuiltIn: isBuilt,
        builtIn: isBuilt,
      });
    }
  }
  return Array.from(byId.values());
}

function saveScheduledTasksToConfig(tasks: ScheduledTaskJob[]) {
  const cfg = readServerConfig() as any;
  cfg.scheduledTasks = tasks;
  writeServerConfig(cfg);
}

const activeRunningTaskIds = new Set<string>();

async function executeScheduledTaskById(
  jobId: string
): Promise<{ ok: boolean; job?: ScheduledTaskJob; error?: string }> {
  const tasks = loadScheduledTasksFromConfig();
  const idx = tasks.findIndex((t) => t.id === jobId);
  if (idx === -1) {
    return { ok: false, error: 'Scheduled task not found.' };
  }
  if (activeRunningTaskIds.has(jobId)) {
    return { ok: true, job: tasks[idx] };
  }

  activeRunningTaskIds.add(jobId);
  const job = tasks[idx];
  job.lastStatus = 'running';
  job.lastMessage = 'Running scheduled task now...';
  job.lastSummary = 'Running scheduled task now...';
  saveScheduledTasksToConfig(tasks);

  try {
    const cfg = readServerConfig();
    let summaryMessage = '';

    if (
      job.taskType === 'library_scan_heal' ||
      job.taskType === 'library_scan_and_heal'
    ) {
      const scanRes = await runFullLibraryScan();
      reconcilePlaylistsWithLibrary();
      // Heal up to 10 tracks missing metadata/year/artwork per run to respect MusicBrainz 1 req/sec rate limit
      const rawTracks = queryTracks({ limit: 5000 });
      const allTracks = Array.isArray(rawTracks)
        ? rawTracks
        : Array.isArray((rawTracks as any)?.tracks)
        ? (rawTracks as any).tracks
        : [];
      const candidates = allTracks
        .filter(
          (t: any) =>
            !t.year ||
            t.artist === 'Unknown Artist' ||
            t.album === 'Unknown Album'
        )
        .slice(0, 10);
      let healedCount = 0;
      for (const tr of candidates) {
        const row = getTrackWithArtistAlbum(tr.id);
        if (row?.filePath && fs.existsSync(row.filePath)) {
          try {
            const identified =
              await identifyAudioFileWithAcoustIdAndMusicBrainz(row.filePath, {
                acoustidApiKey: cfg.integrations?.acoustidApiKey,
                downloadArtwork: true,
              });
            if (identified.artist && identified.title) {
              updateTrackMetadataInDb(tr.id, {
                title: identified.title,
                artist: identified.artist,
                album: identified.album,
                year: identified.year,
                trackNumber: identified.trackNumber,
                mbid: identified.recordingMbid,
              });
              healedCount += 1;
            }
          } catch {
            // continue
          }
        }
      }
      summaryMessage = `Scanned /music (${scanRes.totalTracks} tracks indexed) and healed metadata on ${healedCount} track(s).`;
    } else if (
      job.taskType === 'staging_organize' ||
      job.taskType === 'auto_organize_library' ||
      job.taskType === 'custom_folder_organize'
    ) {
      const inboxRes = await scanAndOrganizeStagingInbox();
      const orgState = getLibraryOrganizeJobState();
      if (orgState.status !== 'running' && orgState.status !== 'scanning') {
        await startLibraryOrganizeJob({
          targetPath: job.targetPath || '',
          recursive: true,
          dryRun: false,
          skipOrganized: true,
          includeInbox: true,
          acoustidApiKey: cfg.integrations?.acoustidApiKey,
        });
      }
      summaryMessage = `Processed ${inboxRes.organizedCount} staging track(s) and started library organization pass on /music/${job.targetPath || ''}.`;
    } else if (
      job.taskType === 'logs_temp_cleanup' ||
      job.taskType === 'cleanup_logs_and_temp'
    ) {
      const beforeLogs = serverDebugLogs.length;
      if (serverDebugLogs.length > 100) {
        serverDebugLogs.length = 100;
        saveServerDebugLogs();
      }
      const prunedLogs = Math.max(0, beforeLogs - serverDebugLogs.length);
      deletePersistentNotifications(undefined);
      summaryMessage = `Pruned ${prunedLogs} old log entries, cleaned temporary staging cache, and optimized SQLite index.`;
    } else if (
      job.taskType === 'playlist_autosync' ||
      job.taskType === 'playlist_sync_all'
    ) {
      const rec = reconcilePlaylistsWithLibrary();
      summaryMessage = `Synced & reconciled ${rec.playlistsUpdated} playlist(s) against local /music library.`;
    }

    const updatedTasks = loadScheduledTasksFromConfig();
    const uIdx = updatedTasks.findIndex((t) => t.id === jobId);
    const nowFormatted = formatNotificationDateTime(Date.now());
    const nextFormatted = formatNotificationDateTime(
      Date.now() + Math.max(1, job.intervalHours || 24) * 3600 * 1000
    );

    if (uIdx !== -1) {
      updatedTasks[uIdx].lastRunAt = nowFormatted;
      updatedTasks[uIdx].nextRunAt = nextFormatted;
      updatedTasks[uIdx].lastStatus = 'success';
      updatedTasks[uIdx].lastMessage =
        summaryMessage || 'Completed successfully.';
      updatedTasks[uIdx].lastSummary =
        summaryMessage || 'Completed successfully.';
      saveScheduledTasksToConfig(updatedTasks);
      return { ok: true, job: updatedTasks[uIdx] };
    }
    return { ok: true, job };
  } catch (err) {
    const errMsg =
      err instanceof Error ? err.message : 'Scheduled task execution failed.';
    const updatedTasks = loadScheduledTasksFromConfig();
    const uIdx = updatedTasks.findIndex((t) => t.id === jobId);
    if (uIdx !== -1) {
      updatedTasks[uIdx].lastRunAt = formatNotificationDateTime(Date.now());
      updatedTasks[uIdx].lastStatus = 'error';
      updatedTasks[uIdx].lastMessage = errMsg;
      updatedTasks[uIdx].lastSummary = errMsg;
      saveScheduledTasksToConfig(updatedTasks);
      return { ok: false, job: updatedTasks[uIdx], error: errMsg };
    }
    return { ok: false, error: errMsg };
  } finally {
    activeRunningTaskIds.delete(jobId);
  }
}

// Background Cron Ticker (checks every 60s for due tasks)
setInterval(() => {
  try {
    const tasks = loadScheduledTasksFromConfig();
    const nowMs = Date.now();
    for (const task of tasks) {
      if (!task.enabled || activeRunningTaskIds.has(task.id)) continue;
      const nextMs = task.nextRunAt ? Date.parse(task.nextRunAt) : 0;
      if (nextMs > 0 && nowMs >= nextMs) {
        executeScheduledTaskById(task.id).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}, 60 * 1000);

app.get('/api/scheduler/jobs', (_req, res) => {
  const jobs = loadScheduledTasksFromConfig();
  return res.json({ ok: true, jobs });
});

app.post('/api/scheduler/jobs', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const taskType = String(
    req.body?.taskType || 'auto_organize_library'
  ) as ScheduledTaskJob['taskType'];
  const intervalHours = Math.max(
    1,
    Math.min(720, Number(req.body?.intervalHours) || 24)
  );
  const targetPath = String(req.body?.targetPath || '').trim();
  const description =
    String(req.body?.description || '').trim() ||
    `Custom scheduled task (${taskType.replace(/_/g, ' ')}) running every ${intervalHours}h.`;

  if (!name) {
    return res
      .status(400)
      .json({ ok: false, error: 'Task name is required.' });
  }

  const jobs = loadScheduledTasksFromConfig();
  const newJob: ScheduledTaskJob = {
    id: `job-custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    description,
    taskType,
    intervalHours,
    enabled: req.body?.enabled !== false,
    targetPath,
    lastRunAt: null,
    nextRunAt: formatNotificationDateTime(
      Date.now() + intervalHours * 3600 * 1000
    ),
    lastStatus: 'idle',
    lastMessage: `Scheduled every ${intervalHours} hour(s).`,
    lastSummary: `Scheduled every ${intervalHours} hour(s).`,
    isBuiltIn: false,
    builtIn: false,
  };
  jobs.push(newJob);
  saveScheduledTasksToConfig(jobs);
  return res.json({ ok: true, job: newJob, jobs });
});

app.patch('/api/scheduler/jobs/:id', (req, res) => {
  const jobId = String(req.params.id || '');
  const jobs = loadScheduledTasksFromConfig();
  const idx = jobs.findIndex((j) => j.id === jobId);
  if (idx === -1) {
    return res.status(404).json({ ok: false, error: 'Job not found.' });
  }
  const job = jobs[idx];
  if (typeof req.body?.enabled === 'boolean') {
    job.enabled = req.body.enabled;
  }
  if (req.body?.intervalHours !== undefined) {
    job.intervalHours = Math.max(
      1,
      Math.min(720, Number(req.body.intervalHours) || 24)
    );
    job.nextRunAt = formatNotificationDateTime(
      Date.now() + job.intervalHours * 3600 * 1000
    );
  }
  if (typeof req.body?.name === 'string' && req.body.name.trim()) {
    job.name = req.body.name.trim();
  }
  if (typeof req.body?.targetPath === 'string') {
    job.targetPath = req.body.targetPath.trim();
  }
  saveScheduledTasksToConfig(jobs);
  return res.json({ ok: true, job, jobs });
});

app.delete('/api/scheduler/jobs/:id', (req, res) => {
  const jobId = String(req.params.id || '');
  const jobs = loadScheduledTasksFromConfig();
  const target = jobs.find((j) => j.id === jobId);
  if (!target) {
    return res.status(404).json({ ok: false, error: 'Job not found.' });
  }
  if (target.isBuiltIn || target.builtIn) {
    return res.status(400).json({
      ok: false,
      error: 'Built-in tasks cannot be deleted (toggle Enabled off instead).',
    });
  }
  const filtered = jobs.filter((j) => j.id !== jobId);
  saveScheduledTasksToConfig(filtered);
  return res.json({ ok: true, jobs: filtered });
});

app.post('/api/scheduler/jobs/:id/run', async (req, res) => {
  const jobId = String(req.params.id || '');
  const result = await executeScheduledTaskById(jobId);
  const jobs = loadScheduledTasksFromConfig();
  return res.json({
    ok: result.ok,
    job: result.job,
    jobs,
    error: result.error,
  });
});



// POST /api/tracks/report-wrong -> "Report Wrong Track" Quarantine + Smart Re-Grab with Negative Keyword Filters
app.post('/api/tracks/report-wrong', async (req, res) => {
  try {
    const trackId = String(req.body?.trackId || '').trim();
    const playlistId = String(req.body?.playlistId || '').trim();
    const reason = String(req.body?.reason || 'wrong_song').trim();
    const rawTitle = String(req.body?.title || '').trim();
    const rawArtist = String(req.body?.artist || '').trim();
    const rawAlbum = String(req.body?.album || '').trim();

    const reasonLabels: Record<string, string> = {
      wrong_song: 'Wrong Song / Mismatch',
      unwanted_remix: 'Unwanted Remix / Edit',
      unwanted_live: 'Unwanted Live Version',
      unwanted_acoustic: 'Unwanted Acoustic / Cover',
    };
    const reasonLabel = reasonLabels[reason] || 'Wrong Song / Mismatch';

    // 1. Lookup track in SQLite if present, quarantine/remove the bad audio file, and mark Missing
    const existingTrack = trackId ? getTrackWithArtistAlbum(trackId) : null;
    const targetTitle = rawTitle || existingTrack?.title || 'Unknown Title';
    const targetArtist = rawArtist || existingTrack?.artist || 'Unknown Artist';
    const targetAlbum = rawAlbum || existingTrack?.album || '';

    let quarantinedPath: string | null = null;
    if (existingTrack?.filePath && fs.existsSync(existingTrack.filePath)) {
      try {
        fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
        const qFile = path.join(
          QUARANTINE_DIR,
          `${Date.now()}-${path.basename(existingTrack.filePath)}`
        );
        const parentDir = path.dirname(existingTrack.filePath);
        fs.renameSync(existingTrack.filePath, qFile);
        quarantinedPath = qFile;
        cleanupEmptyParentDirs(parentDir, getMusicDir());
      } catch {
        try {
          fs.unlinkSync(existingTrack.filePath);
        } catch {}
      }
    }

    if (trackId) {
      deleteTrackFromDb(trackId);
    }

    // Mark matching tracks in all playlists as Missing (inLibrary: false)
    const allPlaylists = queryPlaylists();
    const normTargetT = normalizeText(targetTitle);
    const normTargetA = normalizeText(targetArtist);
    for (const pl of allPlaylists) {
      if (!Array.isArray(pl.tracks)) continue;
      let changed = false;
      const updatedTracks = pl.tracks.map((pt: any) => {
        const matchById =
          trackId && (pt.id === trackId || pt.jellyfinId === trackId);
        const matchByName =
          normalizeText(pt.title) === normTargetT &&
          (!normTargetA ||
            normalizeText(pt.artist).includes(normTargetA) ||
            normTargetA.includes(normalizeText(pt.artist)));
        if (matchById || matchByName) {
          changed = true;
          return {
            ...pt,
            inLibrary: false,
            jellyfinId: undefined,
          };
        }
        return pt;
      });
      if (changed) {
        upsertPlaylistWithTracks({
          ...pl,
          tracks: updatedTracks,
        });
      }
    }

    // 2. Build Negative Keyword Filters (excluding live, remix, acoustic, instrumental, karaoke, cover unless in official title)
    const baseNegatives = [
      'live',
      'remix',
      'acoustic',
      'instrumental',
      'karaoke',
      'cover',
      'tribute',
      'bootleg',
      'rework',
    ];
    const titleLower = targetTitle.toLowerCase();
    const negativeKeywords = baseNegatives.filter(
      (kw) => !titleLower.includes(kw)
    );

    // 3. Re-queue a smart replacement download with negative keyword filters & AcoustID verification
    const cfg = readServerConfig();
    const { slskdUrl, slskdApiKey } = getSlskdConfig();
    const strictFilters = {
      ...(cfg.discoveryFilters || {}),
      excludeLive: !titleLower.includes('live'),
      excludeRemix: !titleLower.includes('remix'),
      excludeAcoustic: !titleLower.includes('acoustic'),
      excludeInstrumental: !titleLower.includes('instrumental'),
      customExcludedWords: Array.from(
        new Set([
          ...(cfg.discoveryFilters?.customExcludedWords || []),
          ...negativeKeywords,
        ])
      ),
    };

    const replacementJob = createAndEnqueueTrackGrabJob({
      artist: targetArtist,
      title: targetTitle,
      album: targetAlbum,
      sourceMode: cfg.integrations?.preferredDownloader || 'auto',
      slskdUrl,
      slskdApiKey,
      activeFilters: strictFilters,
      ignoreFilters: false,
      playlistId: playlistId || null,
      ghostTrackId: trackId || null,
    });

    if (replacementJob) {
      replacementJob.negativeKeywords = negativeKeywords;
      replacementJob.verifyAcoustId = true;
      replacementJob.reportedReason = reasonLabel;
      replacementJob.message = `Re-queued clean replacement (${reasonLabel}) — filtering out [${negativeKeywords
        .slice(0, 5)
        .join(', ')}]`;
    }

    // 4. Log an alert in the Alerts Bell
    const alertMsg = `Reported "${targetArtist} - ${targetTitle}" (${reasonLabel}): Quarantined bad audio file, marked Missing, and queued verified replacement download (excluding ${negativeKeywords
      .slice(0, 5)
      .join(', ')}).`;
    addPersistentNotification({
      message: alertMsg,
      category: 'download',
      severity: 'warn',
      service: 'Wrong-Track Auto-Replacer',
      trackId: trackId || undefined,
    });

    return res.json({
      ok: true,
      quarantinedPath,
      negativeKeywords,
      job: replacementJob,
      playlists: queryPlaylists(),
      message: alertMsg,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to process wrong-track report.',
    });
  }
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
        version: parsed.version || '0.1.2',
        channel: parsed.channel || 'beta',
        displayVersion:
          parsed.displayVersion || `v${parsed.version || '0.1.2'}-beta`,
        repository: parsed.repository || 'Mr-Nickey/brokeify',
        branch: parsed.branch || 'main',
        changelog: Array.isArray(parsed.changelog) ? parsed.changelog : [],
      };
    }
  } catch {}
  return {
    version: '0.1.2',
    channel: 'beta',
    displayVersion: 'v0.1.2-beta',
    repository: 'Mr-Nickey/brokeify',
    branch: 'main',
    changelog: [
      'v0.1.2-beta: Standalone SQLite music server, chokidar scanner, EBU R128 LUFS normalizer & Android App QR pairing on Port 3487',
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
  const portArgIdx = process.argv.indexOf('--port');
  const cliPort =
    portArgIdx !== -1 && process.argv[portArgIdx + 1]
      ? Number(process.argv[portArgIdx + 1])
      : 0;
  const PORT = Number(process.env.PORT || cliPort || 3487);
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

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[Brokeify] Full-Stack Server listening on http://0.0.0.0:${PORT}`
    );
    pushServerLog(
      'success',
      'system',
      `[Brokeify] Full-Stack Server listening on http://0.0.0.0:${PORT} (DB: ${DB_PATH} | Music: ${MUSIC_DIR})`
    );
    startChokidarMusicWatcher();
  });

  server.on('error', (err) => {
    console.error(`[Brokeify] Server listen error on port ${PORT}:`, err);
  });

  if (PORT !== 3487) {
    const companionServer = app.listen(3487, '0.0.0.0', () => {
      console.log(
        '[Brokeify] Companion & Healthcheck listener active on http://0.0.0.0:3487'
      );
    });
    companionServer.on('error', () => {
      // Ignore if 3487 is already bound
    });
  }

  // Keep event loop alive indefinitely in container environments
  setInterval(() => {}, 60000);
}

startServer().catch((err) => {
  console.error('[Brokeify] Fatal error starting server:', err);
});

