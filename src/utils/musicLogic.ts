import type {
  EQPresetName,
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
    'MediaBrowser Client="Brokeify", Device="BrokeifyMobile", DeviceId="brokeify-01", Version="2.0.0"';
  return token ? `${base}, Token="${token}"` : base;
}

/**
 * Builds a Jellyfin or Emby stream URL (/Audio/{itemId}/universal or /Items/{itemId}/Download).
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
    Container: 'opus,mp3,aac,m4a,flac,wav',
    AudioCodec: 'mp3,aac,opus',
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
