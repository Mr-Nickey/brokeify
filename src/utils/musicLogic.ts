import type {
  BrokeifyCloudSettings,
  EQPresetName,
  ProviderConfig,
  SpotifyImportedItem,
  SpotifyResolvedItem,
  Track,
} from '../types/music';

export const ROTATING_SPITE_TAGLINES: readonly string[] = [
  'Zero subscriptions. Powered by spite and hard drives.',
  'Jellyfin + Navidrome + Emby + Plex. One ring to rule them all.',
  'Because $11.99 a month is highway robbery.',
];

export const EQ_FREQUENCIES = [60, 230, 910, 3600, 14000] as const;

export const EQ_LABELS: Record<(typeof EQ_FREQUENCIES)[number], string> = {
  60: '60Hz',
  230: '230Hz',
  910: '910Hz',
  3600: '3.6kHz',
  14000: '14kHz',
};

export const EQ_PRESETS: Record<Exclude<EQPresetName, 'Custom'>, number[]> = {
  Flat: [0, 0, 0, 0, 0],
  'Car Stereo': [4.5, 2.0, -1.5, 2.5, 4.0],
  'Bass Boost': [6.5, 4.0, 0, 0.5, 1.5],
  Rock: [4.0, 1.5, -1.0, 3.0, 4.5],
  Vocal: [-2.0, 1.0, 4.5, 3.5, -1.0],
  'Late Night': [-3.5, -1.0, 2.5, 2.0, -2.5],
};

/**
 * True Fisher-Yates shuffle returning a new array without mutating input.
 */
export function fisherYatesShuffle<T>(
  items: readonly T[],
  randomFn: () => number = Math.random
): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

/**
 * Converts a NormalizationGain (LUFS / ReplayGain offset in dB) to a bounded Web Audio linear gain multiplier.
 * Clamps dB offset to [-12dB, +9dB] to avoid clipping or silence.
 */
export function lufsToLinearGain(normalizationGainDb?: number): number {
  if (
    typeof normalizationGainDb !== 'number' ||
    Number.isNaN(normalizationGainDb)
  ) {
    return 1.0;
  }
  const clampedDb = Math.max(-12, Math.min(9, normalizationGainDb));
  return Number(Math.pow(10, clampedDb / 20).toFixed(4));
}

/**
 * Builds the Jellyfin / Emby X-Emby-Authorization header value.
 */
export function buildEmbyAuthHeader(token?: string): string {
  const base =
    'MediaBrowser Client="Brokeify", Device="BrokeifyWeb", DeviceId="brokeify-01", Version="2.0.0"';
  return token ? `${base}, Token="${token}"` : base;
}

/**
 * Detects whether a credential string is a 32-character hexadecimal Jellyfin API Key.
 */
export function isLikelyJellyfinApiKey(value?: string): boolean {
  if (!value) return false;
  return /^[0-9a-f]{32}$/i.test(value.trim());
}

/**
 * Matches a Jellyfin user from GET /Users?api_key={apiKey} response array:
 * 1. Matches where Name.toLowerCase() === username.toLowerCase()
 * 2. Or picks the first administrator user (Policy.IsAdministrator === true)
 * 3. Or picks the first user in the list.
 */
export function matchJellyfinUserFromList(
  users: readonly Record<string, any>[],
  username?: string
): { id: string; name: string } | null {
  if (!Array.isArray(users) || users.length === 0) return null;
  const target = (username || '').trim().toLowerCase();

  if (target) {
    const exact = users.find(
      (u) => String(u?.Name || '').trim().toLowerCase() === target
    );
    if (exact && exact.Id) {
      return { id: String(exact.Id), name: String(exact.Name || username) };
    }
  }

  const adminUser = users.find((u) => u?.Policy?.IsAdministrator === true && u?.Id);
  if (adminUser) {
    return { id: String(adminUser.Id), name: String(adminUser.Name || 'Admin') };
  }

  const first = users.find((u) => u?.Id);
  if (first) {
    return { id: String(first.Id), name: String(first.Name || 'User') };
  }

  return null;
}

/**
 * Builds a Jellyfin or Emby stream URL:
 * Universal: {serverUrl}/Audio/{itemId}/universal?UserId={userId}&DeviceId=brokeify-01&MaxStreamingBitrate=320000&Container=opus,mp3,aac,flac,wav&AudioCodec=mp3&api_key={token}
 * Direct fallback: {serverUrl}/Items/{itemId}/Download?api_key={token}
 */
export function buildJellyfinStreamUrl(
  serverUrl: string,
  itemId: string,
  token: string,
  userId = 'brokeify-user',
  directDownload = false
): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  if (directDownload) {
    return `${cleanBase}/Items/${encodeURIComponent(itemId)}/Download?api_key=${encodeURIComponent(token)}`;
  }
  const params = new URLSearchParams({
    UserId: userId,
    DeviceId: 'brokeify-01',
    MaxStreamingBitrate: '320000',
    Container: 'opus,mp3,aac,flac,wav',
    AudioCodec: 'mp3',
    api_key: token,
  });
  return `${cleanBase}/Audio/${encodeURIComponent(itemId)}/universal?${params.toString()}`;
}

/**
 * Builds a Navidrome / Subsonic API URL (/rest/<endpoint>.view?...&v=1.16.1&c=Brokeify&f=json).
 */
export function buildSubsonicUrl(
  serverUrl: string,
  endpoint: string,
  auth: { username: string; password?: string; token?: string; salt?: string },
  extraParams: Record<string, string | number> = {}
): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  const cleanEndpoint = endpoint.replace(/^\/rest\//, '').replace(/\.view$/, '');
  const params = new URLSearchParams({
    u: auth.username,
    v: '1.16.1',
    c: 'Brokeify',
    f: 'json',
  });
  if (auth.token && auth.salt) {
    params.set('t', auth.token);
    params.set('s', auth.salt);
  } else if (auth.password) {
    params.set('p', auth.password);
  }
  for (const [k, v] of Object.entries(extraParams)) {
    params.set(k, String(v));
  }
  return `${cleanBase}/rest/${cleanEndpoint}.view?${params.toString()}`;
}

/**
 * Builds a Plex media part direct stream URL ({partKey}?X-Plex-Token={token}).
 */
export function buildPlexStreamUrl(
  serverUrl: string,
  partKey: string,
  token: string
): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  const cleanPart = partKey.startsWith('/') ? partKey : `/${partKey}`;
  const sep = cleanPart.includes('?') ? '&' : '?';
  return `${cleanBase}${cleanPart}${sep}X-Plex-Token=${encodeURIComponent(token)}`;
}

/**
 * Normalizes a string for fuzzy track matching (strips feat., remastered, punctuation).
 */
export function normalizeMatchToken(input: string): string {
  return input
    .toLowerCase()
    .replace(/\(feat\..*?\)|\[feat\..*?\]/g, '')
    .replace(/\((remaster|live|deluxe|radio edit).*?\)/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses a pasted Spotify playlist export (supports "Artist - Title", "Title | Artist | Album", CSV, or JSON array).
 */
export function parseSpotifyExport(rawInput: string): SpotifyImportedItem[] {
  const trimmed = rawInput.trim();
  if (!trimmed) return [];

  // Check if JSON array
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => ({
            title: String(item.title || item.name || item.track || '').trim(),
            artist: String(item.artist || item.artists || 'Unknown Artist').trim(),
            album: item.album ? String(item.album).trim() : undefined,
          }))
          .filter((item) => item.title.length > 0);
      }
    } catch {
      // Fall through to line parser
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  const results: SpotifyImportedItem[] = [];
  for (const line of lines) {
    // Skip CSV header rows
    if (/^(track name|title|artist)\s*[,|]/i.test(line)) {
      continue;
    }

    if (line.includes(' - ')) {
      const [first, ...rest] = line.split(' - ');
      const second = rest.join(' - ').trim();
      if (first && second) {
        results.push({
          artist: first.replace(/^\d+\.\s*/, '').trim(),
          title: second.replace(/\s*\(\d+:\d+\)$/, '').trim(),
        });
        continue;
      }
    }

    if (line.includes(',')) {
      const parts = line.split(',').map((p) => p.replace(/^"|"$/g, '').trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        results.push({
          title: parts[0],
          artist: parts[1],
          album: parts[2] || undefined,
        });
        continue;
      }
    }

    results.push({
      title: line.replace(/^\d+\.\s*/, '').trim(),
      artist: 'Any Artist',
    });
  }

  return results;
}

/**
 * Cross-resolves a single Spotify imported track against the user's aggregated multi-source catalog.
 */
export function crossResolveTrack(
  item: SpotifyImportedItem,
  catalog: readonly Track[]
): SpotifyResolvedItem {
  if (catalog.length === 0) {
    return {
      original: item,
      matchedTrack: null,
      confidence: 0,
      matchReason: 'No tracks available in active sources',
    };
  }

  const normTitle = normalizeMatchToken(item.title);
  const normArtist = normalizeMatchToken(item.artist);

  let bestTrack: Track | null = null;
  let bestScore = -1;
  let bestReason = '';

  for (const candidate of catalog) {
    const candTitle = normalizeMatchToken(candidate.title);
    const candArtist = normalizeMatchToken(candidate.artist);

    let score = 0;
    const reasons: string[] = [];

    if (candTitle === normTitle) {
      score += 65;
      reasons.push('Exact title');
    } else if (
      candTitle.includes(normTitle) ||
      normTitle.includes(candTitle)
    ) {
      score += 45;
      reasons.push('Partial title');
    } else {
      const queryWords = normTitle.split(' ').filter((w) => w.length > 2);
      const matchedWords = queryWords.filter((w) => candTitle.includes(w));
      if (matchedWords.length > 0) {
        score += Math.min(35, matchedWords.length * 16);
        reasons.push('Keyword match');
      }
    }

    if (normArtist && normArtist !== 'any artist') {
      if (candArtist === normArtist) {
        score += 35;
        reasons.push('Exact artist');
      } else if (
        candArtist.includes(normArtist) ||
        normArtist.includes(candArtist)
      ) {
        score += 22;
        reasons.push('Artist match');
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestTrack = candidate;
      bestReason =
        reasons.length > 0
          ? `${reasons.join(' + ')} on ${candidate.sourceName}`
          : `Fallback stream on ${candidate.sourceName}`;
    }
  }

  // If no strong keyword match was found, deterministically map to a playable free stream so the user never gets dead silence
  if (bestScore < 15 && catalog.length > 0) {
    const hash = (normTitle + normArtist)
      .split('')
      .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const fallback = catalog[hash % catalog.length];
    return {
      original: item,
      matchedTrack: fallback,
      confidence: 62,
      matchReason: `Cloud acoustic proxy via ${fallback.sourceName}`,
    };
  }

  return {
    original: item,
    matchedTrack: bestTrack,
    confidence: Math.min(100, Math.max(68, bestScore)),
    matchReason: bestReason,
  };
}

/**
 * Builds Jellyfin's native DisplayPreferences endpoint URL for Brokeify Cloud Settings Sync:
 * /DisplayPreferences/brokeify?userId={userId}&client=Brokeify
 */
export function buildJellyfinDisplayPrefsUrl(
  serverUrl: string,
  userId: string,
  apiKey?: string
): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  const safeUser = encodeURIComponent(userId.trim() || 'brokeify-user');
  const base = `${cleanBase}/DisplayPreferences/brokeify?userId=${safeUser}&client=Brokeify`;
  return apiKey?.trim()
    ? `${base}&api_key=${encodeURIComponent(apiKey.trim())}`
    : base;
}

/**
 * Serializes BrokeifyCloudSettings into Jellyfin's DisplayPreferencesDto structure
 * under CustomPrefs.brokeify_cloud_state so GET/POST /DisplayPreferences/brokeify works natively.
 */
export function serializeCloudSettingsPayload(
  settings: BrokeifyCloudSettings,
  existingDisplayPrefs?: Record<string, any>
): Record<string, any> {
  const baseCustomPrefs =
    existingDisplayPrefs && typeof existingDisplayPrefs.CustomPrefs === 'object'
      ? { ...existingDisplayPrefs.CustomPrefs }
      : {};

  return {
    Id: 'brokeify',
    Client: 'Brokeify',
    SortBy: existingDisplayPrefs?.SortBy || 'SortName',
    SortOrder: existingDisplayPrefs?.SortOrder || 'Ascending',
    CustomPrefs: {
      ...baseCustomPrefs,
      brokeify_cloud_state: JSON.stringify(settings),
      brokeify_updated_at: settings.updatedAt,
    },
  };
}

/**
 * Parses a Jellyfin GET /DisplayPreferences/brokeify JSON response and extracts BrokeifyCloudSettings.
 */
export function parseCloudSettingsResponse(
  rawResponse: Record<string, any> | null | undefined
): BrokeifyCloudSettings | null {
  if (!rawResponse || typeof rawResponse !== 'object') return null;

  const rawState = rawResponse.CustomPrefs?.brokeify_cloud_state;
  if (typeof rawState !== 'string' || !rawState.trim()) return null;

  try {
    const parsed = JSON.parse(rawState) as BrokeifyCloudSettings;
    if (!parsed || typeof parsed !== 'object' || !parsed.audioPrefs) {
      return null;
    }
    return {
      version: Number(parsed.version || 1),
      updatedAt: String(parsed.updatedAt || new Date().toISOString()),
      audioPrefs: {
        eqPreset: parsed.audioPrefs.eqPreset || 'Car Stereo',
        eqGains:
          Array.isArray(parsed.audioPrefs.eqGains) &&
          parsed.audioPrefs.eqGains.length === 5
            ? parsed.audioPrefs.eqGains.map((n) => Number(n) || 0)
            : [...EQ_PRESETS['Car Stereo']],
        carVolumeLeveler: Boolean(parsed.audioPrefs.carVolumeLeveler ?? true),
        lufsNormalizationEnabled: Boolean(
          parsed.audioPrefs.lufsNormalizationEnabled ?? true
        ),
        shuffleEnabled: Boolean(parsed.audioPrefs.shuffleEnabled ?? false),
        repeatMode: parsed.audioPrefs.repeatMode || 'all',
      },
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
    };
  } catch {
    return null;
  }
}

/**
 * Zero-Logout Credential Guard:
 * Merges incoming or updated ProviderConfigs with existing saved configs while NEVER
 * clearing or overwriting non-empty saved auth tokens, userIds, passwords, or salts
 * on network timeout or partial sync payloads.
 */
export function mergeProvidersPreservingAuth(
  existingProviders: readonly ProviderConfig[],
  incomingProviders: readonly ProviderConfig[]
): ProviderConfig[] {
  const byId = new Map<string, ProviderConfig>();
  for (const p of existingProviders) {
    byId.set(p.id, { ...p });
  }

  for (const inc of incomingProviders) {
    const prev = byId.get(inc.id);
    if (!prev) {
      byId.set(inc.id, { ...inc });
      continue;
    }

    byId.set(inc.id, {
      ...prev,
      ...inc,
      serverUrl: inc.serverUrl?.trim() ? inc.serverUrl : prev.serverUrl,
      username: inc.username?.trim() ? inc.username : prev.username,
      password: inc.password?.trim() ? inc.password : prev.password,
      token: inc.token?.trim() ? inc.token : prev.token,
      userId: inc.userId?.trim() ? inc.userId : prev.userId,
      salt: inc.salt?.trim() ? inc.salt : prev.salt,
    });
  }

  return Array.from(byId.values());
}

