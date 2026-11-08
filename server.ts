// @ts-nocheck
/**
 * Brokeify Full-Stack Self-Hosted Server (Express + Vite / Static Dist)
 * - Persistent server-side configuration at /app/data/config.json (fallback ./data/config.json)
 * - Internal Docker proxy routes for Jellyfin (including DELETE /api/jellyfin/items/:id & Library/Refresh)
 * - ListenBrainz Discovery ("Weekly Exploration", "Weekly Jams", "Daily Jams") & Scrobbling proxy
 * - MusicBrainz Album & Track Search proxy
 * - Automated slskd "Grab Full Album / Track" Engine + background transfer watcher that triggers Jellyfin Library Refresh
 */

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '15mb' }));

// Determine persistent config.json path: prefer /app/data/config.json in Docker, fallback to ./data/config.json
function resolveConfigFilePath() {
  const dockerDataDir = '/app/data';
  try {
    if (fs.existsSync('/app')) {
      fs.mkdirSync(dockerDataDir, { recursive: true });
      fs.accessSync(dockerDataDir, fs.constants.W_OK);
      return path.join(dockerDataDir, 'config.json');
    }
  } catch {
    // Fallback to local workspace ./data/config.json
  }
  const localDataDir = path.join(__dirname, 'data');
  fs.mkdirSync(localDataDir, { recursive: true });
  return path.join(localDataDir, 'config.json');
}

const CONFIG_FILE_PATH = resolveConfigFilePath();
const DEBUG_LOGS_FILE_PATH = path.join(
  path.dirname(CONFIG_FILE_PATH),
  'debug-logs.json'
);
const MAX_SERVER_DEBUG_LOGS = 300;

function redactSecrets(text) {
  if (!text) return '';
  return String(text)
    .replace(
      /(api[_-]?key|token|password|authorization|secret)(["'\s:=]+)([^\s"',&}]+)/gi,
      '$1$2[REDACTED]'
    )
    .replace(/(MediaBrowser Token=")([^"]+)(")/gi, '$1[REDACTED]$3');
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
  if (lower.includes('jellyfin')) return 'jellyfin';
  if (lower.includes('lidarr')) return 'lidarr';
  if (lower.includes('slskd')) return 'slskd';
  if (lower.includes('listenbrainz')) return 'listenbrainz';
  if (lower.includes('spotify')) return 'spotify';
  if (lower.includes('youtube')) return 'youtube';
  if (lower.includes('autopilot')) return 'autopilot';
  if (lower.includes('playback-session')) return 'playback-sync';
  return 'system';
}

function inferServerHint(category, message = '', statusCode = 0) {
  const lower = String(message).toLowerCase();
  if (statusCode === 401 || statusCode === 403 || lower.includes('401') || lower.includes('unauthorized')) {
    return `Authentication rejected (${statusCode || 401}). Check your ${category.toUpperCase()} API Key or Token in Settings → 1. Server & Connections.`;
  }
  if (statusCode === 404 || lower.includes('404')) {
    return `Endpoint returned 404 Not Found. Verify your ${category.toUpperCase()} base URL does not have an extra subpath.`;
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

// Express API response & error interceptor: automatically logs any /api/* error or key homelab event
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || req.path.startsWith('/api/debug/')) {
    return next();
  }
  const startedAt = Date.now();
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    const durationMs = Date.now() - startedAt;
    const status = res.statusCode || 200;
    const category = inferServerCategory(req.path);
    const endpointLabel = `${req.method} ${req.originalUrl} (${durationMs}ms)`;

    if (status >= 400 || (body && body.ok === false)) {
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
      hint: 'Check the stack trace in Details to identify the failing server operation.',
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
      hint: 'An async background task rejected without being caught. Inspect Details for stack trace.',
    }
  );
});

const DEFAULT_SERVER_CONFIG = {
  version: 2,
  updatedAt: new Date().toISOString(),
  integrations: {
    jellyfinUrl: '',
    jellyfinToken: '',
    jellyfinUserId: '',
    jellyfinUsername: '',
    requireDeviceLogin: true,
    slskdUrl: 'http://slskd:5030',
    slskdApiKey: '',
    lidarrUrl: 'http://lidarr:8686',
    lidarrApiKey: '',
    lidarrRootFolderPath: '/music',
    lidarrQualityProfileId: 1,
    lidarrMetadataProfileId: 1,
    listenbrainzUsername: '',
    listenbrainzToken: '',
    preferredDownloader: 'auto',
    downloadDir: '/app/downloads',
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
      ...(process.env.JELLYFIN_URL
        ? { jellyfinUrl: process.env.JELLYFIN_URL }
        : {}),
      ...(process.env.JELLYFIN_TOKEN
        ? { jellyfinToken: process.env.JELLYFIN_TOKEN }
        : {}),
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
      integrations: {
        ...DEFAULT_SERVER_CONFIG.integrations,
        ...(parsed.integrations || {}),
        ...envIntegrations,
        listenbrainzUsername:
          envIntegrations.listenbrainzUsername ||
          parsed.integrations?.listenbrainzUsername ||
          '',
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

    // Also auto-sync Jellyfin credentials between providers[] and integrations
    if (Array.isArray(merged.providers)) {
      const jf = merged.providers.find((p) => p && p.type === 'jellyfin');
      if (jf) {
        if (jf.serverUrl && !nextConfig.integrations?.jellyfinUrl) {
          merged.integrations.jellyfinUrl = jf.serverUrl;
        }
        if (jf.token && !nextConfig.integrations?.jellyfinToken) {
          merged.integrations.jellyfinToken = jf.token;
        }
        if (jf.userId && !nextConfig.integrations?.jellyfinUserId) {
          merged.integrations.jellyfinUserId = jf.userId;
        }
        if (jf.username && !nextConfig.integrations?.jellyfinUsername) {
          merged.integrations.jellyfinUsername = jf.username;
        }
      }
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

// Ensure config.json exists on boot
if (!fs.existsSync(CONFIG_FILE_PATH)) {
  try {
    writeServerConfig(DEFAULT_SERVER_CONFIG);
  } catch {
    // ignore
  }
}

// Helper to resolve active Jellyfin credentials from config.json
function getActiveJellyfinCredentials(override = {}) {
  const cfg = readServerConfig();
  const jfProvider = Array.isArray(cfg.providers)
    ? cfg.providers.find((p) => p && p.type === 'jellyfin')
    : null;

  const serverUrl = (
    override.jellyfinUrl ||
    cfg.integrations?.jellyfinUrl ||
    jfProvider?.serverUrl ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  const token = (
    override.jellyfinToken ||
    cfg.integrations?.jellyfinToken ||
    jfProvider?.token ||
    ''
  ).trim();
  const userId = (
    override.jellyfinUserId ||
    cfg.integrations?.jellyfinUserId ||
    jfProvider?.userId ||
    ''
  ).trim();

  return { serverUrl, token, userId };
}

function buildJellyfinHeaders(token) {
  const authValue = token
    ? `MediaBrowser Client="Brokeify", Device="BrokeifyDocker", DeviceId="brokeify-docker-01", Version="2.0.0", Token="${token}"`
    : `MediaBrowser Client="Brokeify", Device="BrokeifyDocker", DeviceId="brokeify-docker-01", Version="2.0.0"`;
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: authValue,
  };
  if (token) {
    headers['X-Emby-Token'] = token;
  }
  return headers;
}

// Canonical string normalizer for matching ListenBrainz/MusicBrainz tracks with Jellyfin library
function normalizeText(str = '') {
  return String(str)
    .toLowerCase()
    .replace(/\((feat|ft|featuring|radio|explicit|clean|remaster|version|edit)[^)]*\)/gi, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ============================================================================
// 1. PERSISTENT SERVER-SIDE STORAGE (/api/config & /api/config/backup)
// ============================================================================

app.get('/api/config', (_req, res) => {
  const config = readServerConfig();
  res.json({
    ok: true,
    configPath: CONFIG_FILE_PATH,
    config,
  });
});

app.post('/api/config', (req, res) => {
  try {
    const incoming = req.body?.config || req.body || {};
    const saved = writeServerConfig(incoming);
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
// 2. INTERNAL DOCKER PROXY ROUTES FOR JELLYFIN
// ============================================================================

// Permanently delete a duplicate or unwanted track from the Jellyfin server's hard drive
app.delete('/api/jellyfin/items/:id', async (req, res) => {
  try {
    const rawId = String(req.params.id || '').replace(/^jellyfin-/, '');
    if (!rawId) {
      return res.status(400).json({ ok: false, error: 'Missing Jellyfin item ID.' });
    }

    const { serverUrl, token } = getActiveJellyfinCredentials({
      jellyfinUrl: req.query.serverUrl || req.headers['x-jellyfin-url'],
      jellyfinToken: req.query.token || req.headers['x-jellyfin-token'],
    });

    if (!serverUrl || !token) {
      return res.status(400).json({
        ok: false,
        error: 'Jellyfin server URL or token is not configured in /app/data/config.json.',
      });
    }

    const targetUrl = `${serverUrl}/Items/${encodeURIComponent(rawId)}`;
    const response = await fetch(targetUrl, {
      method: 'DELETE',
      headers: buildJellyfinHeaders(token),
    });

    if (response.status === 204 || response.ok) {
      return res.json({
        ok: true,
        deletedId: rawId,
        message: `Permanently deleted item ${rawId} from Jellyfin hard drive.`,
      });
    }

    const errText = await response.text().catch(() => '');
    return res.status(response.status).json({
      ok: false,
      error: `Jellyfin DELETE /Items/${rawId} returned HTTP ${response.status}${errText ? `: ${errText.slice(0, 180)}` : ''}`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to reach Jellyfin server.',
    });
  }
});

// Trigger Jellyfin Library Refresh on demand
app.post('/api/jellyfin/refresh', async (req, res) => {
  try {
    const { serverUrl, token } = getActiveJellyfinCredentials(req.body || {});
    if (!serverUrl || !token) {
      return res.status(400).json({
        ok: false,
        error: 'Jellyfin URL and token are required to trigger Library Refresh.',
      });
    }
    const response = await fetch(`${serverUrl}/Library/Refresh`, {
      method: 'POST',
      headers: buildJellyfinHeaders(token),
    });
    return res.json({
      ok: response.ok || response.status === 204,
      status: response.status,
      message:
        response.ok || response.status === 204
          ? 'Triggered Jellyfin Library/Refresh.'
          : `Jellyfin returned HTTP ${response.status}`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to refresh Jellyfin library.',
    });
  }
});

// Helper to fetch current Jellyfin audio catalog titles/artists for library cross-checking
async function fetchJellyfinAudioFingerprints() {
  const { serverUrl, token, userId } = getActiveJellyfinCredentials();
  if (!serverUrl || !token) return [];
  try {
    const endpoint = userId
      ? `${serverUrl}/Users/${encodeURIComponent(userId)}/Items?IncludeItemTypes=Audio&Recursive=true&Fields=Artists,Album&Limit=4000&api_key=${encodeURIComponent(token)}`
      : `${serverUrl}/Items?IncludeItemTypes=Audio&Recursive=true&Fields=Artists,Album&Limit=4000&api_key=${encodeURIComponent(token)}`;
    const resp = await fetch(endpoint, {
      headers: buildJellyfinHeaders(token),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const items = Array.isArray(data?.Items) ? data.Items : [];
    return items.map((item) => ({
      id: `jellyfin-${item.Id}`,
      rawId: item.Id,
      title: item.Name || 'Untitled',
      artist:
        (Array.isArray(item.Artists) && item.Artists[0]) ||
        item.AlbumArtist ||
        'Unknown Artist',
      album: item.Album || '',
      normTitle: normalizeText(item.Name || ''),
      normArtist: normalizeText(
        (Array.isArray(item.Artists) && item.Artists[0]) ||
          item.AlbumArtist ||
          ''
      ),
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// 3. LISTENBRAINZ DISCOVERY & SCROBBLING PROXY ROUTES
// ============================================================================

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
          'Enter your ListenBrainz username above or in Settings -> Sources Hub to load your Weekly Exploration and Weekly Jams playlists.',
        playlists: [],
      });
    }

    const lbHeaders = {
      Accept: 'application/json',
      'User-Agent': 'Brokeify/2.0 (https://github.com/Mr-Nickey/brokeify)',
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

    // Fetch Jellyfin library fingerprints so we can mark which tracks are already in Jellyfin vs missing
    const jfLibrary = await fetchJellyfinAudioFingerprints();

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

          const matchedJf = jfLibrary.find(
            (jf) =>
              jf.normTitle &&
              normT &&
              (jf.normTitle === normT ||
                jf.normTitle.includes(normT) ||
                normT.includes(jf.normTitle)) &&
              (!normA ||
                !jf.normArtist ||
                jf.normArtist === 'a' ||
                jf.normArtist.includes(normA) ||
                normA.includes(jf.normArtist))
          );

          return {
            id: `lb-${playlistMbid}-${index}`,
            title,
            artist,
            album,
            durationMs: t.duration || 210000,
            inLibrary: Boolean(matchedJf),
            jellyfinTrackId: matchedJf?.id || null,
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
        // skip failed individual playlist fetch
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

app.post('/api/listenbrainz/scrobble', async (req, res) => {
  try {
    const cfg = readServerConfig();
    const token = String(
      req.body?.token || cfg.integrations?.listenbrainzToken || ''
    ).trim();

    if (!token) {
      return res.json({
        ok: false,
        skipped: true,
        message: 'No ListenBrainz user token configured yet.',
      });
    }

    const listenType =
      req.body?.listenType === 'playing_now' ? 'playing_now' : 'single';
    const track = req.body?.track || {};
    if (!track.title || !track.artist) {
      return res
        .status(400)
        .json({ ok: false, error: 'Track title and artist are required.' });
    }

    const trackMetadata = {
      artist_name: track.artist,
      track_name: track.title,
      release_name: track.album || undefined,
      additional_info: {
        submission_client: 'Brokeify',
        submission_client_version: '2.0.0',
        music_service: 'jellyfin',
        duration_ms: track.duration ? Math.round(track.duration * 1000) : undefined,
      },
    };

    const payloadEntry =
      listenType === 'playing_now'
        ? { track_metadata: trackMetadata }
        : {
            listened_at: Math.floor(Date.now() / 1000),
            track_metadata: trackMetadata,
          };

    const lbResp = await fetch('https://api.listenbrainz.org/1/submit-listens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${token}`,
        'User-Agent': 'Brokeify/2.0 (https://github.com/Mr-Nickey/brokeify)',
      },
      body: JSON.stringify({
        listen_type: listenType,
        payload: [payloadEntry],
      }),
    });

    const data = await lbResp.json().catch(() => ({}));
    return res.status(lbResp.status).json({
      ok: lbResp.ok,
      listenType,
      status: lbResp.status,
      response: data,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'ListenBrainz scrobble failed.',
    });
  }
});

// ============================================================================
// 4. MUSICBRAINZ PUBLIC API SEARCH & ALBUM TRACKLIST RESOLVER
// ============================================================================

const MB_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Brokeify/2.0.0 ( https://github.com/Mr-Nickey/brokeify )',
};

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
        return res
          .status(resp.status)
          .json({ ok: false, error: `MusicBrainz HTTP ${resp.status}`, results: [] });
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

    // Default: search Release Groups (Albums)
    const url = `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(
      q
    )}%20AND%20primarytype:album&limit=15&fmt=json`;
    const resp = await fetch(url, { headers: MB_HEADERS });
    if (!resp.ok) {
      return res
        .status(resp.status)
        .json({ ok: false, error: `MusicBrainz HTTP ${resp.status}`, results: [] });
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

// Fetch exact album tracklist from MusicBrainz Release Group ID
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
          id: tr.id || tr.recording?.id || `${chosenRelease.id}-${tracks.length + 1}`,
          number: tr.number || String(tracks.length + 1),
          title: tr.title || tr.recording?.title || 'Untitled',
          artist:
            tr['artist-credit']?.[0]?.name ||
            artistName,
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
      error: err instanceof Error ? err.message : 'Failed to fetch album tracklist.',
    });
  }
});

// ============================================================================
// 4B. SPOTIFY PUBLIC PLAYLIST / ALBUM / TRACK URL IMPORTER (ZERO API KEY NEEDED)
// ============================================================================

app.post('/api/spotify/import-url', async (req, res) => {
  try {
    const rawUrl = String(req.body?.url || '').trim();
    if (!rawUrl) {
      return res
        .status(400)
        .json({ ok: false, error: 'Please provide a Spotify playlist, album, or track URL.' });
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

    // Strategy 1: Parse __NEXT_DATA__ JSON from Spotify Embed page
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
                durationSec: durationMs > 0 ? Math.round(durationMs / 1000) : 210,
              });
            }
          }
        }
      } catch {
        // Fallback below
      }
    }

    // Strategy 2: Fallback to oEmbed title if __NEXT_DATA__ had no tracks
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
        err instanceof Error
          ? err.message
          : 'Failed to import Spotify URL.',
    });
  }
});

// ============================================================================
// 5. AUTOMATED "GRAB FULL ALBUM / TRACK" ENGINE (slskd + YouTube Music + Filters)
// ============================================================================

const slskdJobs = new Map();
const grabJobs = slskdJobs;
(globalThis as any).grabJobs = slskdJobs;
(globalThis as any).slskdJobs = slskdJobs;
const readyNotifications: any[] = [];

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Brokeify] Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Brokeify] Uncaught Exception:', err);
});

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
    } catch {
      // ignore script error
    }
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
  const headers = {
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
        const lastSlash = Math.max(fname.lastIndexOf('\\'), fname.lastIndexOf('/'));
        const folder = lastSlash > 0 ? fname.slice(0, lastSlash) : 'root';
        const list = byFolder.get(folder) || [];
        list.push(item);
        byFolder.set(folder, list);
      }

      for (const [, folderItems] of byFolder.entries()) {
        if (folderItems.length < Math.min(2, Math.max(1, expectedTracks.length))) {
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

async function triggerJellyfinLibraryRefresh() {
  const { serverUrl, token } = getActiveJellyfinCredentials();
  if (serverUrl && token) {
    try {
      await fetch(`${serverUrl}/Library/Refresh`, {
        method: 'POST',
        headers: buildJellyfinHeaders(token),
      });
    } catch {
      // ignore network error
    }
  }
}

/**
 * YouTube Music / yt-dlp / Piped / Internet Archive Multi-Source Downloader
 * Used when:
 * - User selects "YouTube Music" or "Internet Archive" as the downloader source, OR
 * - User selects "Auto (slskd + YouTube Fallback)" and slskd is either unconfigured or finds 0 peers.
 */
async function executeYouTubeOrArchiveGrabJob(job, preferredEngine = 'youtube') {
  try {
    const cfg = readServerConfig();
    const downloadDir =
      cfg.integrations?.downloadDir || path.join(__dirname, 'downloads');
    const audioFormat = cfg.integrations?.youtubeAudioFormat || 'mp3';
    try {
      fs.mkdirSync(downloadDir, { recursive: true });
    } catch {
      // ignore if read-only
    }

    job.sourceEngine = preferredEngine === 'archive' ? 'archive' : 'youtube';
    job.status = 'searching';
    job.message =
      job.sourceEngine === 'archive'
        ? `Searching Internet Archive Open Audio for "${job.label}"...`
        : `Searching YouTube Music for "${job.label}"...`;

    // 1. Try native yt-dlp CLI first (installed in Docker via apk add yt-dlp ffmpeg)
    if (job.sourceEngine === 'youtube') {
      try {
        const safeFileBase = `${job.artist || 'Artist'} - ${job.title || job.label}`
          .replace(/[<>:"/\\|?*]/g, '_')
          .slice(0, 120);
        const outTemplate = path.join(downloadDir, `${safeFileBase}.%(ext)s`);
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

        const finalFile = `${safeFileBase}.${audioFormat}`;
        job.files = [
          {
            filename: path.join(downloadDir, finalFile),
            size: 0,
            username: 'YouTube Music (yt-dlp)',
            completed: true,
          },
        ];
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        job.message = `${job.label} downloaded via YouTube Music & sent to Jellyfin!`;

        await triggerJellyfinLibraryRefresh();
        readyNotifications.unshift({
          id: `notif-${job.id}`,
          jobId: job.id,
          label: job.label,
          message: `${job.label} is ready to play (Downloaded via YouTube Music)!`,
          completedAt: job.completedAt,
        });
        return;
      } catch {
        // If yt-dlp binary is not available on host or blocked, continue to Piped / Internet Archive HTTP resolver
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

            await triggerJellyfinLibraryRefresh();
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
    } catch {
      // ignore
    }

    job.status = 'not_found';
    job.message = `Could not find "${job.label}" on ${
      preferredEngine === 'youtube'
        ? 'YouTube Music (ensure yt-dlp is running in Docker)'
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
      '/music'
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
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
  }
  return headers;
}

// POST /api/lidarr/test — Test Lidarr connection & auto-discover root folder and quality/metadata profiles
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
        error: `Lidarr returned HTTP ${statusResp.status}. Verify your URL and API Key (Lidarr -> Settings -> General -> Security).`,
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
    } catch {
      // ignore secondary profile lookup errors
    }

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
        err instanceof Error
          ? err.message
          : 'Could not reach Lidarr server.',
    });
  }
});

// POST /api/slskd/test — Test slskd connection and API key with homelab diagnostics
app.post('/api/slskd/test', async (req, res) => {
  try {
    const { slskdUrl, slskdApiKey } = getSlskdConfig(req.body || {});
    if (!slskdUrl) {
      return res.status(400).json({
        ok: false,
        error: 'Enter your slskd URL first (e.g. http://192.168.1.175:5030 or http://slskd:5030).',
        hint: 'If running in Docker, enter your server LAN IP or docker service name.',
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
        // Fallback to /api/v0/transfers/downloads
        endpointTried = `${slskdUrl}/api/v0/transfers/downloads`;
        const fallbackResp = await fetch(endpointTried, {
          headers,
          signal: AbortSignal.timeout(6000),
        });
        if (!fallbackResp.ok) {
          return res.status(fallbackResp.status).json({
            ok: false,
            error: `slskd returned HTTP ${fallbackResp.status} at ${endpointTried}. Verify slskd URL and key.`,
          });
        }
        appInfo = { version: '0.6.x' };
      }
    } catch (fetchErr) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      let hint = 'Make sure your slskd Docker container is running.';
      if (
        errMsg.includes('fetch failed') ||
        errMsg.includes('ECONNREFUSED') ||
        errMsg.includes('ENOTFOUND') ||
        errMsg.includes('timeout')
      ) {
        hint = `Cannot reach ${slskdUrl} from inside this Docker container. If slskd is on another compose stack, "http://slskd:5030" cannot be resolved. Change URL to your server's LAN IP like http://192.168.1.175:5030 or join both containers to the same Docker bridge network.`;
      }
      return res.status(502).json({
        ok: false,
        error: `Unreachable at ${slskdUrl}: ${errMsg}`,
        hint,
      });
    }

    const version = appInfo?.version || appInfo?.appVersion || '0.6.x';
    return res.json({
      ok: true,
      version,
      url: slskdUrl,
      message: `Connected to slskd v${version}! Soulseek P2P engine is ready for 1-click downloads.`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Error testing slskd connection.',
    });
  }
});

// POST /api/jellyfin/test — Test Jellyfin connection, version, user auth, and library reachability
app.post('/api/jellyfin/test', async (req, res) => {
  try {
    const { serverUrl, token, userId } = getActiveJellyfinCredentials(req.body || {});
    const inputUsername = String(req.body?.username || '').trim();
    const inputPassword = String(req.body?.password || '').trim();

    if (!serverUrl) {
      return res.status(400).json({
        ok: false,
        error: 'Jellyfin Server URL is empty. Enter your server URL (e.g. http://192.168.1.175:8096).',
      });
    }

    let publicInfo: any = null;
    try {
      const publicResp = await fetch(`${serverUrl}/System/Info/Public`, {
        headers: buildJellyfinHeaders(token),
        signal: AbortSignal.timeout(6000),
      });

      if (!publicResp.ok) {
        return res.status(publicResp.status).json({
          ok: false,
          error: `Jellyfin server at ${serverUrl} responded with HTTP ${publicResp.status}.`,
          hint: 'Verify the port and protocol (http vs https).',
        });
      }
      publicInfo = await publicResp.json().catch(() => ({}));
    } catch (fetchErr) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      let hint = 'Make sure Jellyfin is running and port 8096 is exposed.';
      if (
        errMsg.includes('timeout') ||
        errMsg.includes('aborted') ||
        errMsg.includes('fetch failed') ||
        errMsg.includes('ECONNREFUSED')
      ) {
        hint = `Failed to connect to ${serverUrl}: ${errMsg}. If you are running Brokeify inside Docker, external domains (e.g. https://jellyfin.flockingreeds.farm) often fail due to router NAT loopback / hairpinning. Use your local host LAN IP instead: http://192.168.1.175:8096!`;
      }
      return res.status(502).json({
        ok: false,
        error: `Connection failed to ${serverUrl}: ${errMsg}`,
        hint,
      });
    }

    const serverName = publicInfo?.ServerName || 'Jellyfin Media Server';
    const serverVersion = publicInfo?.Version || '10.x';
    let authValid = false;
    let authedUser = '';

    // Check user auth if token or credentials provided
    if (token) {
      try {
        const meResp = await fetch(`${serverUrl}/Users/Me`, {
          headers: buildJellyfinHeaders(token),
          signal: AbortSignal.timeout(5000),
        });
        if (meResp.ok) {
          const meData = (await meResp.json().catch(() => ({}))) as any;
          authValid = true;
          authedUser = meData?.Name || '';
        }
      } catch {
        // non-blocking
      }
    } else if (inputUsername && inputPassword) {
      try {
        const authResp = await fetch(`${serverUrl}/Users/AuthenticateByName`, {
          method: 'POST',
          headers: buildJellyfinHeaders(''),
          body: JSON.stringify({ Username: inputUsername, Pw: inputPassword }),
          signal: AbortSignal.timeout(6000),
        });
        if (authResp.ok) {
          const authData = (await authResp.json().catch(() => ({}))) as any;
          authValid = true;
          authedUser = authData?.User?.Name || inputUsername;
        }
      } catch {
        // non-blocking
      }
    }

    return res.json({
      ok: true,
      serverName,
      serverVersion,
      serverUrl,
      authValid,
      username: authedUser || inputUsername || userId,
      message: `Connected to ${serverName} (Jellyfin v${serverVersion})! ${
        authValid ? `Signed in as ${authedUser || inputUsername}.` : 'Public endpoint reachable.'
      }`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Error testing Jellyfin.',
    });
  }
});

// POST /api/listenbrainz/test — Test ListenBrainz user & scrobbler token
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

    // Verify user exists on ListenBrainz
    try {
      const userResp = await fetch(
        `https://api.listenbrainz.org/1/user/${encodeURIComponent(username)}/playlists`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (!userResp.ok && userResp.status === 404) {
        return res.status(404).json({
          ok: false,
          error: `ListenBrainz user "${username}" was not found. Check your username spelling on listenbrainz.org.`,
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
        const tokenResp = await fetch('https://api.listenbrainz.org/1/validate-token', {
          headers: { Authorization: `Token ${token}` },
          signal: AbortSignal.timeout(6000),
        });
        if (tokenResp.ok) {
          const tokenJson = (await tokenResp.json().catch(() => ({}))) as any;
          tokenValid = Boolean(tokenJson.valid);
          tokenMessage = tokenValid
            ? 'Scrobbler Token valid & authorized.'
            : 'Scrobbler Token is invalid or expired. Check your token on listenbrainz.org/profile.';
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

// POST /api/services/test-all — Runs all connection tests in parallel and checks storage permissions
app.post('/api/services/test-all', async (req, res) => {
  const cfg = readServerConfig();
  const jfCreds = getActiveJellyfinCredentials(req.body?.jellyfin || {});
  const slskdCreds = getSlskdConfig(req.body?.slskd || {});
  const lidarrCreds = getLidarrConfig(req.body?.lidarr || {});
  const lbUser = String(req.body?.listenbrainz?.username || cfg.integrations?.listenbrainzUsername || '').trim();
  const lbToken = String(req.body?.listenbrainz?.token || cfg.integrations?.listenbrainzToken || '').trim();

  // Test Storage Permissions
  let storageStatus = { ok: true, path: CONFIG_FILE_PATH, message: 'Writable & Persistent (/app/data)' };
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE_PATH), { recursive: true });
    fs.accessSync(path.dirname(CONFIG_FILE_PATH), fs.constants.W_OK);
  } catch (e) {
    storageStatus = {
      ok: false,
      path: CONFIG_FILE_PATH,
      message: `Permission error writing to ${CONFIG_FILE_PATH}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Test Jellyfin
  let jellyfinStatus: { ok: boolean; serverName?: string; version?: string; message: string; hint?: string } = {
    ok: false,
    message: 'Not configured',
  };
  if (jfCreds.serverUrl) {
    try {
      const jfResp = await fetch(`${jfCreds.serverUrl}/System/Info/Public`, {
        headers: buildJellyfinHeaders(jfCreds.token),
        signal: AbortSignal.timeout(5000),
      });
      if (jfResp.ok) {
        const info = (await jfResp.json().catch(() => ({}))) as any;
        jellyfinStatus = {
          ok: true,
          serverName: info.ServerName || 'Jellyfin',
          version: info.Version || '10.x',
          message: `Connected to ${info.ServerName || 'Jellyfin'} (v${info.Version || '10.x'})`,
        };
      } else {
        jellyfinStatus = {
          ok: false,
          message: `HTTP ${jfResp.status} from ${jfCreds.serverUrl}`,
          hint: 'Check server URL and port.',
        };
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      let hint = 'Make sure Jellyfin is running.';
      if (errMsg.includes('timeout') || errMsg.includes('fetch failed')) {
        hint = 'In Docker, avoid external domain names. Use http://192.168.1.175:8096 directly!';
      }
      jellyfinStatus = {
        ok: false,
        message: `Failed to connect to ${jfCreds.serverUrl}: ${errMsg}`,
        hint,
      };
    }
  }

  // Test slskd
  let slskdStatus: { ok: boolean; version?: string; message: string; hint?: string } = {
    ok: false,
    message: 'Not configured',
  };
  if (slskdCreds.slskdUrl) {
    try {
      const sResp = await fetch(`${slskdCreds.slskdUrl}/api/v0/application`, {
        headers: buildSlskdHeaders(slskdCreds.slskdApiKey),
        signal: AbortSignal.timeout(5000),
      }).catch(async () => {
        return await fetch(`${slskdCreds.slskdUrl}/api/v0/transfers/downloads`, {
          headers: buildSlskdHeaders(slskdCreds.slskdApiKey),
          signal: AbortSignal.timeout(5000),
        });
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
    } catch (e) {
      slskdStatus = {
        ok: false,
        message: `Unreachable at ${slskdCreds.slskdUrl}`,
        hint: 'If running in Docker, use host LAN IP (http://192.168.1.175:5030) or connect to the same Docker network.',
      };
    }
  }

  // Test Lidarr
  let lidarrStatus: { ok: boolean; version?: string; message: string; hint?: string } = {
    ok: false,
    message: 'Not configured',
  };
  if (lidarrCreds.lidarrUrl && lidarrCreds.lidarrApiKey) {
    try {
      const lResp = await fetch(`${lidarrCreds.lidarrUrl}/api/v1/system/status`, {
        headers: buildLidarrHeaders(lidarrCreds.lidarrApiKey),
        signal: AbortSignal.timeout(5000),
      });
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
          message: `HTTP ${lResp.status} from Lidarr. Verify API key.`,
        };
      }
    } catch (e) {
      lidarrStatus = {
        ok: false,
        message: `Unreachable at ${lidarrCreds.lidarrUrl}`,
        hint: 'Check your Lidarr URL or use http://192.168.1.175:8686.',
      };
    }
  }

  // Test ListenBrainz
  let listenbrainzStatus: { ok: boolean; username?: string; message: string } = {
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
    } catch (e) {
      listenbrainzStatus = {
        ok: false,
        message: 'Could not contact ListenBrainz API.',
      };
    }
  }

  return res.json({
    ok: true,
    services: {
      jellyfin: jellyfinStatus,
      slskd: slskdStatus,
      lidarr: lidarrStatus,
      listenbrainz: listenbrainzStatus,
      storage: storageStatus,
    },
  });
});

// Execute an automated Lidarr artist/album lookup, add/monitor, and indexer search command
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

    // 1. Resolve Root Folder, Quality Profile, and Metadata Profile from Lidarr
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
    } catch {
      // use defaults
    }

    // 2. Lookup Artist in Lidarr
    const searchArtistTerm = job.artist || job.searchText || job.title;
    const lookupResp = await fetch(
      `${lidarrUrl}/api/v1/artist/lookup?term=${encodeURIComponent(
        searchArtistTerm
      )}`,
      { headers, signal: AbortSignal.timeout(10000) }
    );
    if (!lookupResp.ok) {
      throw new Error(`Lidarr artist/lookup returned HTTP ${lookupResp.status}`);
    }
    const lookupArtists = await lookupResp.json().catch(() => []);
    const matchedArtist = Array.isArray(lookupArtists) ? lookupArtists[0] : null;
    if (!matchedArtist || !matchedArtist.foreignArtistId) {
      throw new Error(`No matching artist found in Lidarr for "${searchArtistTerm}"`);
    }

    // 3. Check if Artist already exists in Lidarr library
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

    // 4. Add Artist to Lidarr if not already present
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

    // 5. Trigger Lidarr AlbumSearch / ArtistSearch command
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
    job.message = `Queued "${job.label}" in Lidarr (${rootFolderPath}) — Lidarr is now searching indexers & downloading!`;

    await triggerJellyfinLibraryRefresh();
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

// Execute a single slskd search -> peer selection -> download queue flow (with Auto-Fallback to Lidarr -> YouTube Music)
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
        'Lidarr URL & API Key not configured or release not found. Check Settings -> 1. Sources & Server Hub.';
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
    job.message =
      'slskd API key not configured in Settings -> Server & Connections.';
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
      job.message = `Not found on slskd for "${job.searchText}". Click "Retry via YouTube" or switch to Lidarr.`;
      return;
    }

    job.matchedPeer = chosen.username;
    job.matchedFormat = chosen.formatLabel;
    job.message = `Selected peer "${chosen.username}" (${chosen.formatLabel}, free slot: ${chosen.hasFreeUploadSlot ? 'YES' : 'queued'}) — queueing ${chosen.files.length} file(s)...`;

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
// 5A. CROSS-DEVICE PLAYBACK HANDOFF SESSION (/api/playback-session)
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
    const incoming = req.body?.playbackSession || req.body;
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
      durationSec: Math.max(1, Number(incoming.durationSec || incoming.track.duration || 180)),
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

// POST /api/slskd/grab — Queue a Full Album, Single Track, or Missing Playlist Tracks (via slskd, Lidarr, YouTube Music, or Auto)
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
          'slskd URL is not configured yet. Add your slskd URL & API key in Settings -> Server & Connections, or switch Downloader Source to "Auto", "Lidarr", or "YouTube Music".',
      });
    }

    if (sourceMode === 'lidarr' && (!lidarrUrl || !lidarrApiKey)) {
      return res.status(400).json({
        ok: false,
        error:
          'Lidarr URL & API Key are not configured yet. Add your Lidarr URL & API key in Settings -> 1. Sources & Server Hub, or switch Download Engine to "Auto".',
      });
    }

    const type = req.body?.type || 'track'; // 'album' | 'track' | 'playlist'
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
          skippedCount > 0 ? ` (${skippedCount} skipped by Exclusion Filters)` : ''
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

// GET /api/slskd/status — Returns active/completed jobs + ready notifications for the UI banner
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

// POST /api/slskd/notifications/dismiss — Dismiss a completed download notification banner
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

// Background polling loop: watches GET /api/v0/transfers/downloads in slskd every 6 seconds
// When a job's files finish downloading, automatically calls POST ${jellyfinUrl}/Library/Refresh
// and pushes "<Artist> - <Album/Track> is ready to play!" notification!
async function pollSlskdTransfersAndRefreshJellyfin() {
  const activeDownloadingJobs = Array.from(slskdJobs.values()).filter(
    (j) => j.status === 'downloading'
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

    // Flatten all transfer files across peers
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
        job.message = `${job.label} is ready to play!`;

        // Trigger Jellyfin Library/Refresh automatically
        const { serverUrl, token } = getActiveJellyfinCredentials();
        if (serverUrl && token) {
          try {
            await fetch(`${serverUrl}/Library/Refresh`, {
              method: 'POST',
              headers: buildJellyfinHeaders(token),
            });
          } catch {
            // ignore refresh network error
          }
        }

        readyNotifications.unshift({
          id: `notif-${job.id}`,
          jobId: job.id,
          label: job.label,
          message: `${job.label} is ready to play!`,
          completedAt: job.completedAt,
        });
      }
    }
  } catch {
    // ignore transient polling errors
  }
}

setInterval(pollSlskdTransfersAndRefreshJellyfin, 6000);

// ============================================================================
// 5B. MUSICBRAINZ PICARD + GEMINI AI AUTO-TAGGER & ORGANIZED FOLDER ENGINE
// ============================================================================

async function resolvePicardAndAiMetadata(rawArtist, rawTitle, rawAlbum = '') {
  let cleanArtist = String(rawArtist || '').trim();
  let cleanTitle = String(rawTitle || '').trim();
  let cleanAlbum = String(rawAlbum || '').trim();
  let year = '';
  let trackNumber = '01';
  let genre = '';
  let source = 'musicbrainz';

  // 1. Optional Gemini AI cleanup of messy filenames/tags (when GEMINI_API_KEY is available on server)
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
    } catch {
      // Fallback to MusicBrainz deterministic lookup
    }
  }

  // 2. MusicBrainz Recording Lookup for authoritative Album, Year, and Track Number
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
  } catch {
    // ignore MusicBrainz timeout
  }

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
// 5C. AUTOPILOT LINKED PLAYLISTS (SPOTIFY -> BROKEIFY / JELLYFIN AUTO-SYNC)
// ============================================================================

async function runSingleAutopilotRule(ruleId) {
  const cfg = readServerConfig();
  const rules = Array.isArray(cfg.autopilotRules) ? cfg.autopilotRules : [];
  const ruleIdx = rules.findIndex((r) => r.id === ruleId);
  if (ruleIdx === -1) {
    throw new Error('Autopilot rule not found.');
  }
  const rule = rules[ruleIdx];

  // Fetch tracks from the linked Spotify playlist URL
  const match =
    String(rule.sourceUrl || '').match(
      /open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album)\/([a-zA-Z0-9]+)/i
    ) ||
    String(rule.sourceUrl || '').match(
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
      } catch {
        // ignore
      }
    }
  }

  const jfLibrary = await fetchJellyfinAudioFingerprints();
  const matchedJfIds = [];
  const missingTracks = [];

  for (const t of tracks) {
    const normT = normalizeText(t.title);
    const normA = normalizeText(t.artist);
    const matched = jfLibrary.find(
      (jf) =>
        jf.normTitle &&
        normT &&
        (jf.normTitle === normT ||
          jf.normTitle.includes(normT) ||
          normT.includes(jf.normTitle)) &&
        (!normA ||
          !jf.normArtist ||
          jf.normArtist === 'a' ||
          jf.normArtist.includes(normA) ||
          normA.includes(jf.normArtist))
    );
    if (matched) {
      matchedJfIds.push(`jellyfin-${matched.id}`);
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

  // Update the target Brokeify playlist in config.json with any newly matched tracks
  const playlists = Array.isArray(cfg.playlists) ? [...cfg.playlists] : [];
  const plIdx = playlists.findIndex((p) => p.id === rule.playlistId);
  let addedCount = 0;
  if (plIdx !== -1) {
    const existingSet = new Set(playlists[plIdx].trackIds || []);
    for (const tid of matchedJfIds) {
      if (!existingSet.has(tid)) {
        existingSet.add(tid);
        addedCount += 1;
      }
    }
    playlists[plIdx] = {
      ...playlists[plIdx],
      trackIds: Array.from(existingSet),
      linkedSpotifyUrl: rule.sourceUrl,
      autopilotSchedule: rule.schedule,
      autopilotAutoDownload: rule.autoDownloadMissing,
      lastAutopilotSyncAt: new Date().toISOString(),
    };
  }

  // Queue missing tracks for download if autoDownloadMissing is enabled
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
    statusMessage: `Synced ${tracks.length} Spotify tracks (${addedCount} added, ${queuedCount} missing queued for download).`,
  };

  writeServerConfig({
    autopilotRules: rules,
    playlists,
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

  let nextRules = Array.isArray(cfg.autopilotRules)
    ? [...cfg.autopilotRules]
    : [];
  if (incomingRule && incomingRule.playlistId && incomingRule.sourceUrl) {
    const existingIdx = nextRules.findIndex(
      (r) =>
        r.id === incomingRule.id || r.playlistId === incomingRule.playlistId
    );
    const normalizedRule = {
      id: incomingRule.id || `ap-${Date.now()}`,
      playlistId: incomingRule.playlistId,
      playlistName: incomingRule.playlistName || 'Linked Playlist',
      sourceUrl: String(incomingRule.sourceUrl).trim(),
      schedule: incomingRule.schedule || 'weekly',
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
      playlists: cfg.playlists || [],
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Autopilot sync failed.',
    });
  }
});

// Background Autopilot Scheduler: checks every 30 minutes if any daily/weekly/monthly rule is due
setInterval(async () => {
  try {
    const cfg = readServerConfig();
    const rules = Array.isArray(cfg.autopilotRules) ? cfg.autopilotRules : [];
    const now = Date.now();
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const last = rule.lastSyncedAt ? new Date(rule.lastSyncedAt).getTime() : 0;
      const intervalMs =
        rule.schedule === 'daily'
          ? 24 * 3600 * 1000
          : rule.schedule === 'monthly'
          ? 30 * 24 * 3600 * 1000
          : 7 * 24 * 3600 * 1000;
      if (now - last >= intervalMs) {
        await runSingleAutopilotRule(rule.id);
      }
    }
  } catch {
    // ignore background scheduler errors
  }
}, 30 * 60 * 1000);

// ============================================================================
// 5D. MAINTAINERR-STYLE PLAY STATISTICS & BULK DISK CLEANUP
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
      lastPlayedAt: new Date().toISOString(),
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

app.post('/api/jellyfin/items/bulk-delete', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids
      : Array.isArray(req.body?.itemIds)
      ? req.body.itemIds
      : [];
    const { serverUrl, token } = getActiveJellyfinCredentials(req);
    if (!serverUrl || !token) {
      return res.status(400).json({
        ok: false,
        error: 'Jellyfin server URL and token are required for bulk delete.',
      });
    }

    const deletedIds = [];
    const failedIds = [];

    for (const rawId of ids) {
      const cleanItemId = String(rawId || '')
        .trim()
        .replace(/^(jellyfin|emby)-/, '');
      if (!cleanItemId) continue;
      try {
        const resp = await fetch(
          `${serverUrl}/Items/${encodeURIComponent(
            cleanItemId
          )}?api_key=${encodeURIComponent(token)}`,
          {
            method: 'DELETE',
            headers: buildJellyfinHeaders(token),
          }
        );
        if (resp.ok || resp.status === 204) {
          deletedIds.push(rawId);
        } else {
          failedIds.push(rawId);
        }
      } catch {
        failedIds.push(rawId);
      }
    }

    return res.json({
      ok: true,
      deletedIds,
      failedIds,
      message: `Deleted ${deletedIds.length} track(s) from Jellyfin disk${
        failedIds.length > 0 ? ` (${failedIds.length} failed)` : ''
      }.`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Bulk delete failed.',
    });
  }
});

// ============================================================================
// 5E. DIAGNOSTIC DEBUG LOGS & 1-CLICK HOMELAB HEALTH CHECK API
// ============================================================================

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
  const checks = [];

  // 1. Storage & config.json Check
  try {
    const t0 = Date.now();
    fs.accessSync(path.dirname(CONFIG_FILE_PATH), fs.constants.W_OK);
    checks.push({
      id: 'storage',
      name: 'Persistent Storage (config.json)',
      category: 'system',
      status: 'ok',
      latencyMs: Date.now() - t0,
      summary: `Writable at ${CONFIG_FILE_PATH}`,
      details: `Config version ${cfg.version || 2}, last updated ${cfg.updatedAt || 'N/A'}`,
    });
  } catch (err) {
    checks.push({
      id: 'storage',
      name: 'Persistent Storage (config.json)',
      category: 'system',
      status: 'error',
      summary: `Cannot write to ${CONFIG_FILE_PATH}`,
      details: err instanceof Error ? err.message : String(err),
      hint: 'Check Docker volume permissions for /app/data.',
    });
  }

  // 2. Jellyfin Server Check
  const jfUrl = String(cfg.integrations?.jellyfinUrl || '')
    .trim()
    .replace(/\/+$/, '');
  const jfToken = String(cfg.integrations?.jellyfinToken || '').trim();
  if (!jfUrl) {
    checks.push({
      id: 'jellyfin',
      name: 'Jellyfin Media Server',
      category: 'jellyfin',
      status: 'warn',
      summary: 'Not configured yet (no Server URL saved)',
      hint: 'Open Settings → 1. Server & Connections or Quick Connect Wizard to sign in.',
    });
  } else {
    const t0 = Date.now();
    try {
      const resp = await fetch(`${jfUrl}/System/Info/Public`, {
        headers: buildJellyfinHeaders(jfToken),
        signal: AbortSignal.timeout(6000),
      });
      const latencyMs = Date.now() - t0;
      if (resp.ok) {
        const info = await resp.json().catch(() => ({}));
        checks.push({
          id: 'jellyfin',
          name: 'Jellyfin Media Server',
          category: 'jellyfin',
          status: 'ok',
          latencyMs,
          summary: `Connected to ${info.ServerName || 'Jellyfin'} (v${info.Version || '10.x'}) in ${latencyMs}ms`,
          details: `URL: ${jfUrl} | Token: ${jfToken ? 'Present' : 'Missing'}`,
        });
      } else {
        checks.push({
          id: 'jellyfin',
          name: 'Jellyfin Media Server',
          category: 'jellyfin',
          status: 'error',
          latencyMs,
          summary: `HTTP ${resp.status} from ${jfUrl}/System/Info/Public`,
          hint: inferServerHint('jellyfin', `HTTP ${resp.status}`, resp.status),
        });
      }
    } catch (err) {
      checks.push({
        id: 'jellyfin',
        name: 'Jellyfin Media Server',
        category: 'jellyfin',
        status: 'error',
        summary: `Connection failed to ${jfUrl}`,
        details: err instanceof Error ? err.message : String(err),
        hint: inferServerHint('jellyfin', String(err), 0),
      });
    }
  }

  // 3. slskd Soulseek Check
  const { slskdUrl, slskdApiKey } = getSlskdConfig();
  if (!slskdUrl || !slskdApiKey) {
    checks.push({
      id: 'slskd',
      name: 'slskd Soulseek P2P Engine',
      category: 'slskd',
      status: 'warn',
      summary: 'Optional — API Key not configured',
      hint: 'Add your slskd URL and API Key in Settings → 1. Server & Connections if you use Soulseek.',
    });
  } else {
    const t0 = Date.now();
    try {
      const resp = await fetch(`${slskdUrl}/api/v0/application`, {
        headers: buildSlskdHeaders(slskdApiKey),
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - t0;
      if (resp.ok) {
        checks.push({
          id: 'slskd',
          name: 'slskd Soulseek P2P Engine',
          category: 'slskd',
          status: 'ok',
          latencyMs,
          summary: `Reachable at ${slskdUrl} (${latencyMs}ms)`,
        });
      } else {
        checks.push({
          id: 'slskd',
          name: 'slskd Soulseek P2P Engine',
          category: 'slskd',
          status: 'error',
          latencyMs,
          summary: `slskd returned HTTP ${resp.status}`,
          hint: inferServerHint('slskd', `HTTP ${resp.status}`, resp.status),
        });
      }
    } catch (err) {
      checks.push({
        id: 'slskd',
        name: 'slskd Soulseek P2P Engine',
        category: 'slskd',
        status: 'error',
        summary: `Unreachable at ${slskdUrl}`,
        details: err instanceof Error ? err.message : String(err),
        hint: inferServerHint('slskd', String(err), 0),
      });
    }
  }

  // 4. Lidarr Automated Music Manager Check
  const { lidarrUrl, lidarrApiKey } = getLidarrConfig();
  if (!lidarrUrl || !lidarrApiKey) {
    checks.push({
      id: 'lidarr',
      name: 'Lidarr Music Manager',
      category: 'lidarr',
      status: 'warn',
      summary: 'Optional — API Key not configured',
      hint: 'Add your Lidarr URL (http://lidarr:8686) and API Key in Settings → 1. Server & Connections when ready.',
    });
  } else {
    const t0 = Date.now();
    try {
      const resp = await fetch(`${lidarrUrl}/api/v1/system/status`, {
        headers: buildLidarrHeaders(lidarrApiKey),
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - t0;
      if (resp.ok) {
        const info = await resp.json().catch(() => ({}));
        checks.push({
          id: 'lidarr',
          name: 'Lidarr Music Manager',
          category: 'lidarr',
          status: 'ok',
          latencyMs,
          summary: `Connected to Lidarr v${info.version || '1.x'} (${latencyMs}ms)`,
        });
      } else {
        checks.push({
          id: 'lidarr',
          name: 'Lidarr Music Manager',
          category: 'lidarr',
          status: 'error',
          latencyMs,
          summary: `Lidarr returned HTTP ${resp.status}`,
          hint: inferServerHint('lidarr', `HTTP ${resp.status}`, resp.status),
        });
      }
    } catch (err) {
      checks.push({
        id: 'lidarr',
        name: 'Lidarr Music Manager',
        category: 'lidarr',
        status: 'error',
        summary: `Unreachable at ${lidarrUrl}`,
        details: err instanceof Error ? err.message : String(err),
        hint: inferServerHint('lidarr', String(err), 0),
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
      hint: 'Enter your ListenBrainz username in Settings → 1. Server & Connections for Weekly Exploration playlists.',
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

  // 6. MusicBrainz & yt-dlp / ffmpeg Toolchain Check
  const [ytDlpInfo, ffmpegInfo] = await Promise.all([
    checkBinaryInstalled('yt-dlp'),
    checkBinaryInstalled('ffmpeg'),
  ]);
  checks.push({
    id: 'toolchain',
    name: 'YouTube Music & Picard Audio Toolchain',
    category: 'youtube',
    status: ytDlpInfo.installed ? 'ok' : 'warn',
    summary: ytDlpInfo.installed
      ? `yt-dlp (${ytDlpInfo.version}) & ${
          ffmpegInfo.installed ? 'ffmpeg ready' : 'ffmpeg optional'
        }`
      : 'yt-dlp binary not detected on host (will use HTTP stream fallback; Docker image includes yt-dlp + ffmpeg)',
  });

  const errorCount = checks.filter((c) => c.status === 'error').length;
  pushServerLog(
    errorCount > 0 ? 'warn' : 'success',
    'system',
    `Homelab Health Check finished: ${
      checks.filter((c) => c.status === 'ok').length
    } OK, ${
      checks.filter((c) => c.status === 'warn').length
    } Optional/Warn, ${errorCount} Error(s).`,
    {
      details: JSON.stringify(checks, null, 2),
    }
  );

  return res.json({
    ok: true,
    checks,
    logs: serverDebugLogs,
  });
});

// ============================================================================
// 5F. VERSION CHECKER (DOCKER LOCAL VS GITHUB REPOSITORY COMPARISON)
// ============================================================================

function readLocalVersionMetadata() {
  const versionFile = path.join(__dirname, 'version.json');
  try {
    if (fs.existsSync(versionFile)) {
      const raw = fs.readFileSync(versionFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        version: parsed.version || '0.0.0.1',
        channel: parsed.channel || 'beta',
        displayVersion: parsed.displayVersion || `v${parsed.version || '0.0.0.1'}-beta`,
        repository: parsed.repository || 'Mr-Nickey/brokeify',
        branch: parsed.branch || 'main',
        changelog: Array.isArray(parsed.changelog) ? parsed.changelog : [],
      };
    }
  } catch {
    // fallback
  }
  return {
    version: '0.0.0.1',
    channel: 'beta',
    displayVersion: 'v0.0.0.1-beta',
    repository: 'Mr-Nickey/brokeify',
    branch: 'main',
    changelog: ['v0.0.0.1-beta: Initial full-stack Docker release on Port 3487'],
  };
}

let cachedVersionCheck = null;
let lastVersionCheckTime = 0;

function parseVersionNums(str) {
  if (!str) return [0, 0, 0, 0];
  const cleaned = String(str).trim().replace(/^v/i, '').split('-')[0];
  return cleaned.split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}

function compareVersions(a, b) {
  const pA = parseVersionNums(a);
  const pB = parseVersionNums(b);
  const len = Math.max(pA.length, pB.length);
  for (let i = 0; i < len; i++) {
    const vA = pA[i] || 0;
    const vB = pB[i] || 0;
    if (vA > vB) return 1;
    if (vA < vB) return -1;
  }
  return 0;
}

app.get('/api/version', async (req, res) => {
  const force = req.query.force === 'true';
  const localMeta = readLocalVersionMetadata();
  const repo = localMeta.repository || 'Mr-Nickey/brokeify';
  const branch = localMeta.branch || 'main';

  // Return cached result if checked within the last 15 minutes unless force is set
  const now = Date.now();
  if (!force && cachedVersionCheck && now - lastVersionCheckTime < 15 * 60 * 1000) {
    return res.json({ ok: true, version: cachedVersionCheck });
  }

  let remoteVersion = null;
  let remoteDisplayVersion = null;
  let remoteCommitSha = null;
  let remoteCommitMessage = null;
  let remoteCommitDate = null;
  let remoteCommitUrl = null;
  let updateAvailable = false;
  let errorMsg = null;

  try {
    // 1. Check GitHub Releases / Tags API
    const tagsResp = await fetch(
      `https://api.github.com/repos/${repo}/tags?per_page=5`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Brokeify-Docker-App',
        },
        signal: AbortSignal.timeout(6000),
      }
    );

    if (tagsResp.ok) {
      const tags = await tagsResp.json();
      if (Array.isArray(tags) && tags.length > 0) {
        const latestTag = tags[0];
        remoteVersion = String(latestTag.name || '').replace(/^v/i, '');
        remoteDisplayVersion = latestTag.name;
        remoteCommitSha = latestTag.commit?.sha ? latestTag.commit.sha.slice(0, 7) : null;
        remoteCommitUrl = `https://github.com/${repo}/releases/tag/${latestTag.name}`;
      }
    }

    // 2. Also check latest commit on main branch for cutting-edge Docker builds
    const branchResp = await fetch(
      `https://api.github.com/repos/${repo}/commits/${branch}`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Brokeify-Docker-App',
        },
        signal: AbortSignal.timeout(6000),
      }
    );

    if (branchResp.ok) {
      const branchCommit = await branchResp.json();
      if (branchCommit?.sha) {
        remoteCommitSha = branchCommit.sha.slice(0, 7);
        remoteCommitMessage = branchCommit.commit?.message
          ? branchCommit.commit.message.split('\n')[0].slice(0, 100)
          : null;
        remoteCommitDate = branchCommit.commit?.author?.date || null;
        remoteCommitUrl = `https://github.com/${repo}/commit/${branchCommit.sha}`;
      }
    }

    // 3. Fallback to raw version.json on GitHub repo if tags not published yet
    if (!remoteVersion) {
      try {
        const rawResp = await fetch(
          `https://raw.githubusercontent.com/${repo}/${branch}/version.json`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (rawResp.ok) {
          const rawData = await rawResp.json();
          if (rawData?.version) {
            remoteVersion = rawData.version;
            remoteDisplayVersion = rawData.displayVersion || `v${rawData.version}`;
          }
        }
      } catch {
        // ignore
      }
    }

    if (remoteVersion) {
      updateAvailable = compareVersions(remoteVersion, localMeta.version) > 0;
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  const result = {
    localVersion: localMeta.version,
    localDisplayVersion: localMeta.displayVersion,
    localChannel: localMeta.channel,
    localCommitSha: null,
    localBuildTime: null,
    remoteVersion,
    remoteDisplayVersion,
    remoteCommitSha,
    remoteCommitMessage,
    remoteCommitDate,
    remoteCommitUrl,
    repository: repo,
    branch,
    updateAvailable,
    statusSummary: updateAvailable
      ? `A newer version (${remoteDisplayVersion || remoteVersion}) is available on GitHub!`
      : remoteVersion
      ? `You are up to date on ${localMeta.displayVersion}.`
      : 'Running latest local Docker build.',
    checkedAt: new Date().toISOString(),
    changelog: localMeta.changelog || [],
    ...(errorMsg ? { error: errorMsg } : {}),
  };

  cachedVersionCheck = result;
  lastVersionCheckTime = now;

  return res.json({ ok: true, version: result });
});

app.post('/api/version/check', async (req, res) => {
  // Bust cache and re-check
  cachedVersionCheck = null;
  lastVersionCheckTime = 0;
  req.query.force = 'true';
  const url = `${req.protocol}://${req.get('host')}/api/version?force=true`;
  try {
    const checkResp = await fetch(url);
    const data = await checkResp.json();
    return res.json(data);
  } catch {
    return res.json({
      ok: true,
      version: {
        localVersion: '0.0.0.1',
        localDisplayVersion: 'v0.0.0.1-beta',
        localChannel: 'beta',
        updateAvailable: false,
        statusSummary: 'Using local Docker version.',
        checkedAt: new Date().toISOString(),
        changelog: [],
      },
    });
  }
});

// ============================================================================
// 6. FRONTEND STATIC SERVING (PRODUCTION DOCKER) OR VITE MIDDLEWARE (DEV)
// ============================================================================

async function startServer() {
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
          `[Brokeify] Full-Stack Server listening on http://0.0.0.0:${p} (config: ${CONFIG_FILE_PATH})`
        );
        pushServerLog(
          'success',
          'system',
          `Brokeify Server started on port ${p} (storage: ${CONFIG_FILE_PATH})`
        );
      });
    } else {
      try {
        const extraServer = app.listen(p, '0.0.0.0', () => {
          console.log(
            `[Brokeify] Dual-port listener active on http://0.0.0.0:${p}`
          );
        });
        extraServer.on('error', () => {
          // Port already in use, safe to ignore
        });
      } catch {
        // ignore
      }
    }
  }
}

startServer();
