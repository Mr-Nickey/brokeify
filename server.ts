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
import { fileURLToPath } from 'node:url';

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

const DEFAULT_SERVER_CONFIG = {
  version: 2,
  updatedAt: new Date().toISOString(),
  integrations: {
    jellyfinUrl: '',
    jellyfinToken: '',
    jellyfinUserId: '',
    jellyfinUsername: '',
    slskdUrl: 'http://slskd:5030',
    slskdApiKey: '',
    listenbrainzUsername: '',
    listenbrainzToken: '',
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
  providers: [],
  playlists: [],
  customPlaylistNames: {},
  pinnedPlaylistId: null,
};

function readServerConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SERVER_CONFIG,
        ...parsed,
        integrations: {
          ...DEFAULT_SERVER_CONFIG.integrations,
          ...(parsed.integrations || {}),
          listenbrainzUsername:
            parsed.integrations?.listenbrainzUsername || '',
        },
        audioPrefs: {
          ...DEFAULT_SERVER_CONFIG.audioPrefs,
          ...(parsed.audioPrefs || {}),
        },
        customPlaylistNames: {
          ...(parsed.customPlaylistNames || {}),
        },
      };
    }
  } catch (err) {
    console.error('[Brokeify] Failed to read config.json:', err);
  }
  return structuredClone(DEFAULT_SERVER_CONFIG);
}

function writeServerConfig(nextConfig) {
  try {
    const merged = {
      ...readServerConfig(),
      ...nextConfig,
      updatedAt: new Date().toISOString(),
    };
    if (nextConfig.integrations) {
      merged.integrations = {
        ...readServerConfig().integrations,
        ...nextConfig.integrations,
      };
    }
    if (nextConfig.audioPrefs) {
      merged.audioPrefs = {
        ...readServerConfig().audioPrefs,
        ...nextConfig.audioPrefs,
      };
    }
    if (nextConfig.customPlaylistNames) {
      merged.customPlaylistNames = {
        ...readServerConfig().customPlaylistNames,
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
// 5. AUTOMATED "GRAB FULL ALBUM / TRACK" ENGINE (slskd + Jellyfin Refresh)
// ============================================================================

/**
 * In-memory active & completed grab jobs + ready notifications.
 * Each job tracks:
 * - id, label ("Linkin Park - Hybrid Theory"), type ('album' | 'track' | 'playlist')
 * - status: 'searching' | 'queued' | 'downloading' | 'completed' | 'failed'
 * - matchedPeer, matchedFormat, files: [{ filename, size, username, status }]
 * - createdAt, completedAt, error
 */
const slskdJobs = new Map();
const readyNotifications = [];

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

/**
 * Score an individual slskd file for audio quality:
 * - Prefer FLAC (.flac) -> +1000
 * - Next 320kbps MP3 (.mp3 with bitRate >= 320) -> +750
 * - Next other MP3 / M4A / OGG / OPUS -> +400
 * - Ignore non-audio files (.jpg, .png, .txt, .nfo, .cue, .log) -> -1
 */
function scoreSlskdAudioFile(file) {
  const filename = String(file?.filename || '');
  const lower = filename.toLowerCase();
  if (!/\.(flac|mp3|m4a|ogg|opus|wav)$/i.test(lower)) {
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

/**
 * Given slskd search responses, pick the best peer with `hasFreeUploadSlot: true`
 * (falling back to any peer with audio files if none report free slot)
 * and select either the best matching single file or full album folder.
 */
function selectBestSlskdPeerAndFiles(responses, mode = 'track', expectedTracks = []) {
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
        score: scoreSlskdAudioFile(f),
      }))
      .filter((item) => item.score > 0);

    if (audioFiles.length === 0) continue;

    if (mode === 'album') {
      // Group files by folder directory so we grab a cohesive album folder from one peer
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
      // Single track mode: pick the highest-scoring audio file from this peer
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

// Execute a single slskd search -> peer selection -> download queue flow
async function executeSlskdGrabJob(job, slskdUrl, slskdApiKey) {
  const headers = buildSlskdHeaders(slskdApiKey);
  try {
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
      const txt = await startSearchResp.text().catch(() => '');
      throw new Error(
        `slskd POST /api/v0/searches returned HTTP ${startSearchResp.status}${txt ? `: ${txt.slice(0, 120)}` : ''}`
      );
    }

    const searchData = await startSearchResp.json().catch(() => ({ id: searchId }));
    const activeSearchId = searchData?.id || searchId;

    // Poll search results up to 4 times over ~9 seconds until we find a peer with hasFreeUploadSlot: true
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
        job.expectedTracks || []
      );
      if (chosen && chosen.hasFreeUploadSlot) {
        break;
      }
    }

    if (!chosen || chosen.files.length === 0) {
      job.status = 'failed';
      job.message = `No peers with audio files found for "${job.searchText}".`;
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
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    job.message = job.error;
  }
}

// POST /api/slskd/grab — Queue a Full Album, Single Track, or Missing Playlist Tracks
app.post('/api/slskd/grab', async (req, res) => {
  try {
    const { slskdUrl, slskdApiKey } = getSlskdConfig(req.body || {});
    if (!slskdUrl) {
      return res.status(400).json({
        ok: false,
        error:
          'slskd URL is not configured yet. Add your slskd URL & API key in Settings -> Sources Hub.',
      });
    }

    const type = req.body?.type || 'track'; // 'album' | 'track' | 'playlist'
    const artist = String(req.body?.artist || '').trim();
    const title = String(req.body?.title || req.body?.album || '').trim();
    const tracks = Array.isArray(req.body?.tracks) ? req.body.tracks : [];

    if (type === 'playlist' && tracks.length > 0) {
      const createdJobs = [];
      for (const tr of tracks.slice(0, 25)) {
        const jobLabel = `${tr.artist} - ${tr.title}`;
        const job = {
          id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'track',
          label: jobLabel,
          artist: tr.artist,
          title: tr.title,
          searchText: `${tr.artist} ${tr.title}`,
          status: 'searching',
          message: `Queued search for ${jobLabel}`,
          matchedPeer: null,
          matchedFormat: null,
          files: [],
          createdAt: new Date().toISOString(),
          completedAt: null,
        };
        slskdJobs.set(job.id, job);
        createdJobs.push(job);
        // Fire async without blocking HTTP response
        executeSlskdGrabJob(job, slskdUrl, slskdApiKey);
      }

      return res.json({
        ok: true,
        jobs: createdJobs,
        message: `Queued ${createdJobs.length} missing playlist track(s) in slskd!`,
      });
    }

    const label = artist && title ? `${artist} - ${title}` : title || artist;
    if (!label) {
      return res.status(400).json({
        ok: false,
        error: 'Artist or Album/Track title is required.',
      });
    }

    const job = {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: type === 'album' ? 'album' : 'track',
      label,
      artist,
      title,
      searchText: `${artist} ${title}`.trim(),
      expectedTracks: tracks,
      status: 'searching',
      message: `Searching slskd for "${label}"...`,
      matchedPeer: null,
      matchedFormat: null,
      files: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    slskdJobs.set(job.id, job);
    executeSlskdGrabJob(job, slskdUrl, slskdApiKey);

    return res.json({
      ok: true,
      job,
      message: `Started automated ${job.type} grab for "${label}" via slskd.`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to start slskd grab.',
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
// 6. FRONTEND STATIC SERVING (PRODUCTION DOCKER) OR VITE MIDDLEWARE (DEV)
// ============================================================================

async function startServer() {
  const PORT = Number(process.env.BROKEIFY_PORT || 3000);
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[Brokeify] Full-Stack Server listening on http://0.0.0.0:${PORT} (config: ${CONFIG_FILE_PATH})`
    );
  });
}

startServer();
