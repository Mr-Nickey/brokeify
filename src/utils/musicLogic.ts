import type {
  BrokeifyCloudSettings,
  CustomThemeConfig,
  DiscoveryFilterConfig,
  EQPresetName,
  Playlist,
  ProviderConfig,
  SpotifyImportedItem,
  SpotifyResolvedItem,
  Track,
  VisualThemeId,
} from '../types/music';

export interface VisualThemeDefinition {
  id: VisualThemeId;
  name: string;
  mode: 'dark' | 'light';
  badge: string;
  description: string;
  cssFilter: string;
  swatches: [string, string, string];
}

export const VISUAL_THEMES: readonly VisualThemeDefinition[] = [
  {
    id: 'cyber-deck',
    name: "Cyber Deck '99",
    mode: 'dark',
    badge: 'DEFAULT DARK',
    description:
      'Obsidian stereo rack with phosphor emerald LCD readouts and cyan wave scopes.',
    cssFilter: 'none',
    swatches: ['#070a0f', '#00ff66', '#38bdf8'],
  },
  {
    id: 'classic-rack',
    name: "Classic Stereo '98",
    mode: 'dark',
    badge: 'CLASSIC DARK',
    description:
      'Late-90s charcoal component deck with warm gold-tinted meters and high-contrast bevels.',
    cssFilter: 'contrast(1.07) saturate(1.15) sepia(0.09)',
    swatches: ['#111827', '#fbbf24', '#10b981'],
  },
  {
    id: 'modular-bento',
    name: 'Modular Studio',
    mode: 'dark',
    badge: 'STUDIO DARK',
    description:
      'High-density slate studio panels with cool electric cyan and ultraviolet spectrums.',
    cssFilter: 'contrast(1.05) saturate(1.22) hue-rotate(-14deg)',
    swatches: ['#090d16', '#38bdf8', '#a855f7'],
  },
  {
    id: 'amber-crt',
    name: 'Amber Phosphor',
    mode: 'dark',
    badge: 'CRT DARK',
    description:
      'Warm vintage amber CRT monitor filter with deep night-driving eye comfort.',
    cssFilter: 'sepia(0.36) hue-rotate(-18deg) saturate(1.42) contrast(1.08)',
    swatches: ['#140d06', '#f59e0b', '#fb923c'],
  },
  {
    id: 'platinum-light',
    name: "Platinum '99",
    mode: 'light',
    badge: 'SILVER LIGHT',
    description:
      'Classic late-90s brushed silver & platinum desktop skin with recessed dark LCD scopes.',
    cssFilter: 'contrast(1.03) saturate(1.05)',
    swatches: ['#e2e8f0', '#0f172a', '#059669'],
  },
  {
    id: 'solar-light',
    name: 'Solar Daylight',
    mode: 'light',
    badge: 'DAYLIGHT',
    description:
      'Warm ivory & glacier-blue daytime cabin skin engineered for bright sunlight legibility.',
    cssFilter: 'contrast(1.04) saturate(1.08) sepia(0.06)',
    swatches: ['#f8fafc', '#0284c7', '#10b981'],
  },
];

export function isValidVisualTheme(value?: string): value is VisualThemeId {
  return VISUAL_THEMES.some((t) => t.id === value);
}

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
 * Computes multi-stage loudness stabilization for mixed FLAC + MP3 (e.g. 240kbps) libraries.
 * Returns:
 * - `webAudioGain`: linear multiplier for Web Audio `GainNode` (can boost > 1.0 into the DynamicsCompressorNode)
 * - `htmlElementScale`: relative [0.25 .. 1.0] ceiling for direct HTML5 `<audio>` elements where volume cannot exceed 1.0.
 *   In 'aggressive' mode, hot un-normalized FLAC/WAV tracks are attenuated to ~0.58 on direct HTML5 streams while quiet
 *   <=256kbps MP3 tracks play at full 1.0 ceiling (and receive +5.5dB boost when routed through the Web Audio DSP graph).
 */
export function computeTrackStabilizationGain(
  track: Pick<
    Track,
    'format' | 'bitrateKbps' | 'normalizationGain' | 'streamUrl'
  > | null,
  options: {
    carVolumeLeveler: boolean;
    lufsNormalizationEnabled: boolean;
    stabilizerStrength?: 'off' | 'normal' | 'aggressive';
  }
): { webAudioGain: number; htmlElementScale: number; profileLabel: string } {
  if (!track) {
    return { webAudioGain: 1.0, htmlElementScale: 1.0, profileLabel: 'Unity' };
  }

  const strength = options.carVolumeLeveler
    ? options.stabilizerStrength || 'aggressive'
    : 'off';

  const fmt = (track.format || '').trim().toUpperCase();
  const urlLower = (track.streamUrl || '').toLowerCase();
  const bitrate = track.bitrateKbps || 0;

  const isLossless =
    fmt.includes('FLAC') ||
    fmt.includes('WAV') ||
    fmt.includes('ALAC') ||
    fmt.includes('PCM') ||
    urlLower.includes('.flac') ||
    urlLower.includes('.wav') ||
    bitrate >= 700;

  const isLowMidBitrateMp3 =
    !isLossless &&
    (fmt.includes('MP3') ||
      fmt.includes('MPEG') ||
      urlLower.includes('.mp3') ||
      (bitrate > 0 && bitrate <= 265));

  const hasExplicitLufs =
    typeof track.normalizationGain === 'number' &&
    !Number.isNaN(track.normalizationGain) &&
    Math.abs(track.normalizationGain) > 0.05;

  const baseLufsLinear = options.lufsNormalizationEnabled
    ? lufsToLinearGain(track.normalizationGain)
    : 1.0;

  if (strength === 'off') {
    const htmlScale = Math.max(0.25, Math.min(1.0, baseLufsLinear));
    return {
      webAudioGain: baseLufsLinear,
      htmlElementScale: htmlScale,
      profileLabel: 'Bypass',
    };
  }

  if (strength === 'normal') {
    // Standard stabilization: mild FLAC trim (-2.5dB) and mild MP3 boost (+2.5dB)
    const codecDbOffset = hasExplicitLufs
      ? 0
      : isLossless
      ? -2.5
      : isLowMidBitrateMp3
      ? 2.5
      : 0.5;
    const codecLinear = Math.pow(10, codecDbOffset / 20);
    const webGain = Number((baseLufsLinear * codecLinear * 1.18).toFixed(3));
    const htmlScale = isLossless
      ? Math.min(0.76, baseLufsLinear * 0.78)
      : Math.min(1.0, baseLufsLinear * 1.0);
    return {
      webAudioGain: Math.max(0.35, Math.min(2.4, webGain)),
      htmlElementScale: Number(Math.max(0.3, Math.min(1.0, htmlScale)).toFixed(3)),
      profileLabel: isLossless
        ? 'Standard FLAC Trim (-2.5dB)'
        : 'Standard MP3 Boost (+2.5dB)',
    };
  }

  // 'aggressive' mode: Designed specifically for libraries mixing loud FLACs with quiet 192-256kbps MP3s
  const aggressiveCodecDb = hasExplicitLufs
    ? isLossless
      ? -1.5
      : 2.0
    : isLossless
    ? -4.8 // Tame hot brickwalled FLAC masters by -4.8dB
    : isLowMidBitrateMp3
    ? 5.5 // Boost quiet 240kbps MP3s by +5.5dB into the brickwall compressor
    : 2.5;

  const codecLinear = Math.pow(10, aggressiveCodecDb / 20);
  const makeupBoost = 1.32;
  const webGain = Number(
    Math.max(0.35, Math.min(2.8, baseLufsLinear * codecLinear * makeupBoost)).toFixed(3)
  );

  // For direct HTML5 <audio> elements (where max volume is 1.0), scale FLAC down to ~0.58 of master volume
  // so switching to a 240kbps MP3 (at 1.0 of master volume) has matching perceived loudness!
  let htmlScale = 0.85;
  if (hasExplicitLufs) {
    // Map [-10dB .. +6dB] relative to a 0.72 reference point so positive LUFS tracks can be louder than negative LUFS tracks
    htmlScale = Math.max(0.35, Math.min(1.0, 0.72 * baseLufsLinear));
    if (isLossless) htmlScale = Math.min(htmlScale, 0.65);
  } else if (isLossless) {
    htmlScale = 0.58;
  } else if (isLowMidBitrateMp3) {
    htmlScale = 1.0;
  } else {
    htmlScale = 0.88;
  }

  return {
    webAudioGain: webGain,
    htmlElementScale: Number(htmlScale.toFixed(3)),
    profileLabel: isLossless
      ? 'Aggressive FLAC Tamer (-4.8dB)'
      : isLowMidBitrateMp3
      ? 'Aggressive MP3 Booster (+5.5dB)'
      : 'Aggressive AGC Active',
  };
}

/**
 * Builds the Jellyfin / Emby Authorization header value:
 * MediaBrowser Client="Brokeify", Device="BrokeifyWeb", DeviceId="brokeify-01", Version="2.0.0"
 */
export function buildEmbyAuthHeader(token?: string): string {
  const base =
    'MediaBrowser Client="Brokeify", Device="BrokeifyWeb", DeviceId="brokeify-01", Version="2.0.0"';
  return token ? `${base}, Token="${token.trim()}"` : base;
}

/**
 * Builds the standard authenticated Jellyfin request headers with both X-Emby-Token and Authorization.
 */
export function buildJellyfinAuthHeaders(token: string): Record<string, string> {
  const cleanToken = token.trim();
  return {
    Accept: 'application/json',
    'X-Emby-Token': cleanToken,
    Authorization: `MediaBrowser Client="Brokeify", Device="BrokeifyWeb", DeviceId="brokeify-01", Version="2.0.0", Token="${cleanToken}"`,
  };
}

/**
 * Builds Jellyfin Public System Info URL: GET {serverUrl}/System/Info/Public
 */
export function buildJellyfinPublicSystemInfoUrl(serverUrl: string): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  return `${cleanBase}/System/Info/Public`;
}

/**
 * Builds Jellyfin Quick Connect endpoints:
 * - Initiate: POST {serverUrl}/QuickConnect/Initiate
 * - Poll: GET {serverUrl}/QuickConnect/Connect?Secret={secret}
 * - Authenticate: POST {serverUrl}/Users/AuthenticateWithQuickConnect
 */
export function buildJellyfinQuickConnectInitiateUrl(serverUrl: string): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  return `${cleanBase}/QuickConnect/Initiate`;
}

export function buildJellyfinQuickConnectPollUrl(
  serverUrl: string,
  secret: string
): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  return `${cleanBase}/QuickConnect/Connect?Secret=${encodeURIComponent(
    secret.trim()
  )}`;
}

export function buildJellyfinQuickConnectAuthUrl(serverUrl: string): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  return `${cleanBase}/Users/AuthenticateWithQuickConnect`;
}

/**
 * Builds Jellyfin /Users/Me endpoint with ?api_key={token} fallback.
 */
export function buildJellyfinUsersMeUrl(
  serverUrl: string,
  token: string
): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  return `${cleanBase}/Users/Me?api_key=${encodeURIComponent(token.trim())}`;
}

/**
 * Builds Jellyfin User-scoped Audio & Playlist endpoints with ?api_key={token} fallback:
 * - Audio: ${serverUrl}/Users/${userId}/Items?IncludeItemTypes=Audio&Recursive=true&Fields=MediaSources,NormalizationGain,Album,Artists&Limit=3000&api_key=${token}
 * - Playlists: ${serverUrl}/Users/${userId}/Items?IncludeItemTypes=Playlist&Recursive=true&api_key=${token}
 * - Playlist Items: ${serverUrl}/Playlists/${playlistId}/Items?UserId=${userId}&Fields=MediaSources,NormalizationGain&api_key=${token}
 */
export function buildJellyfinUserAudioItemsUrl(
  serverUrl: string,
  userId: string,
  token: string
): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  return `${cleanBase}/Users/${encodeURIComponent(
    userId.trim()
  )}/Items?IncludeItemTypes=Audio&Recursive=true&Fields=MediaSources,NormalizationGain,Album,Artists&Limit=3000&api_key=${encodeURIComponent(
    token.trim()
  )}`;
}

export function buildJellyfinUserPlaylistsUrl(
  serverUrl: string,
  userId: string,
  token: string
): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  return `${cleanBase}/Users/${encodeURIComponent(
    userId.trim()
  )}/Items?IncludeItemTypes=Playlist&Recursive=true&api_key=${encodeURIComponent(
    token.trim()
  )}`;
}

export function buildJellyfinPlaylistItemsUrl(
  serverUrl: string,
  playlistId: string,
  userId: string,
  token: string
): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  const userParam = userId.trim()
    ? `UserId=${encodeURIComponent(userId.trim())}&`
    : '';
  return `${cleanBase}/Playlists/${encodeURIComponent(
    playlistId.trim()
  )}/Items?${userParam}Fields=MediaSources,NormalizationGain&api_key=${encodeURIComponent(
    token.trim()
  )}`;
}

/**
 * Builds Jellyfin Direct API Key global items endpoints:
 * - Audio: GET {serverUrl}/Items?IncludeItemTypes=Audio&Recursive=true&Fields=MediaSources,NormalizationGain,Album,Artists&Limit=3000&api_key={apiKey}
 * - Playlists: GET {serverUrl}/Items?IncludeItemTypes=Playlist&Recursive=true&api_key={apiKey}
 */
export function buildJellyfinGlobalAudioItemsUrl(
  serverUrl: string,
  apiKey: string
): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  return `${cleanBase}/Items?IncludeItemTypes=Audio&Recursive=true&Fields=MediaSources,NormalizationGain,Album,Artists&Limit=3000&api_key=${encodeURIComponent(
    apiKey.trim()
  )}`;
}

export function buildJellyfinGlobalPlaylistsUrl(
  serverUrl: string,
  apiKey: string
): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  return `${cleanBase}/Items?IncludeItemTypes=Playlist&Recursive=true&api_key=${encodeURIComponent(
    apiKey.trim()
  )}`;
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
 * Builds a Jellyfin or Emby progressive HTTP stream URL:
 * Primary: ${serverUrl}/Audio/${trackId}/universal?UserId=${userId}&DeviceId=brokeify-01&MaxStreamingBitrate=140000000&Container=mp3,flac,aac,m4a,ogg,wav,opus,webma,webm&TranscodingContainer=mp3&TranscodingProtocol=http&AudioCodec=mp3&api_key=${token}
 * Direct static fallback: ${serverUrl}/Audio/${trackId}/stream?static=true&api_key=${token}
 */
export function buildJellyfinStreamUrl(
  serverUrl: string,
  itemId: string,
  token: string,
  userId = '',
  directDownload = false
): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  const rawItemId = itemId.replace(/^(jellyfin|emby)-/, '').trim();
  const cleanToken = token.trim();
  const cleanUserId = userId.trim();
  if (directDownload) {
    return `${cleanBase}/Audio/${encodeURIComponent(rawItemId)}/stream?static=true&api_key=${encodeURIComponent(cleanToken)}`;
  }
  const userQuery = cleanUserId
    ? `UserId=${encodeURIComponent(cleanUserId)}&`
    : '';
  return `${cleanBase}/Audio/${encodeURIComponent(rawItemId)}/universal?${userQuery}DeviceId=brokeify-01&MaxStreamingBitrate=140000000&Container=mp3,flac,aac,m4a,ogg,wav,opus,webma,webm&TranscodingContainer=mp3&TranscodingProtocol=http&AudioCodec=mp3&api_key=${encodeURIComponent(cleanToken)}`;
}

/**
 * Builds an ordered list of progressive HTTP stream URLs for a Jellyfin/Emby track
 * so native HTML5 <audio> playback automatically falls back across static stream,
 * universal HTTP stream, explicit MP3 stream, and raw Download stream.
 */
export function buildJellyfinStreamCandidates(
  track: Pick<Track, 'id' | 'source' | 'streamUrl' | 'fallbackStreamUrl'>,
  latestToken?: string,
  latestUserId?: string
): string[] {
  if (track.source !== 'jellyfin' && track.source !== 'emby') {
    return [track.streamUrl, track.fallbackStreamUrl].filter(
      (u): u is string => Boolean(u && u.trim())
    );
  }

  const rawItemId = track.id.replace(/^(jellyfin|emby)-/, '').trim();
  let baseUrl = '';
  let parsedToken = (latestToken ?? '').trim();
  let parsedUserId = (latestUserId ?? '').trim();

  const sourceUrl = track.streamUrl || track.fallbackStreamUrl || '';
  try {
    const u = new URL(sourceUrl);
    const pathMatch = u.pathname.match(/^(.*?)\/(?:Audio|Items)\//i);
    const basePath = pathMatch ? pathMatch[1] : '';
    baseUrl = `${u.origin}${basePath}`.replace(/\/+$/, '');
    if (!parsedToken) {
      parsedToken = (
        u.searchParams.get('api_key') ||
        u.searchParams.get('ApiKey') ||
        ''
      ).trim();
    }
    if (!parsedUserId) {
      parsedUserId = (
        u.searchParams.get('UserId') ||
        u.searchParams.get('userId') ||
        ''
      ).trim();
    }
  } catch {
    // Fallback if URL parsing fails
  }

  if (!baseUrl || !rawItemId || !parsedToken) {
    return [track.streamUrl, track.fallbackStreamUrl].filter(
      (u): u is string => Boolean(u && u.trim())
    );
  }

  const encId = encodeURIComponent(rawItemId);
  const encToken = encodeURIComponent(parsedToken);
  const userQuery = parsedUserId
    ? `UserId=${encodeURIComponent(parsedUserId)}&`
    : '';

  const candidates = [
    // 1. Direct static byte-range stream (fastest start, zero transcoding overhead)
    `${baseUrl}/Audio/${encId}/stream?static=true&api_key=${encToken}`,
    // 2. Universal HTTP progressive stream (direct plays supported containers, transcodes others to HTTP MP3)
    `${baseUrl}/Audio/${encId}/universal?${userQuery}DeviceId=brokeify-01&MaxStreamingBitrate=140000000&Container=mp3,flac,aac,m4a,ogg,wav,opus,webma,webm&TranscodingContainer=mp3&TranscodingProtocol=http&AudioCodec=mp3&api_key=${encToken}`,
    // 3. Explicit progressive MP3 stream fallback (in case browser rejects original container e.g. WMA/ALAC)
    `${baseUrl}/Audio/${encId}/stream.mp3?AudioCodec=mp3&AudioBitrate=320000&api_key=${encToken}`,
    // 4. Direct Item Download endpoint
    `${baseUrl}/Items/${encId}/Download?api_key=${encToken}`,
  ];

  return Array.from(new Set(candidates));
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

  // If no good match was found, return null so Brokeify correctly flags track as Missing for slskd/Lidarr download
  if (bestScore < 30 || !bestTrack) {
    return {
      original: item,
      matchedTrack: null,
      confidence: 0,
      matchReason: 'Not found in local library (Missing - Available for Download)',
    };
  }

  return {
    original: item,
    matchedTrack: bestTrack,
    confidence: Math.min(100, Math.max(50, bestScore)),
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
        crossfadeSeconds:
          typeof parsed.audioPrefs.crossfadeSeconds === 'number'
            ? Math.max(0, Math.min(12, parsed.audioPrefs.crossfadeSeconds))
            : 4,
        offlinePreloadCount:
          typeof parsed.audioPrefs.offlinePreloadCount === 'number'
            ? Math.max(2, Math.min(12, Math.round(parsed.audioPrefs.offlinePreloadCount)))
            : 4,
        stabilizerStrength:
          parsed.audioPrefs.stabilizerStrength === 'off' ||
          parsed.audioPrefs.stabilizerStrength === 'normal' ||
          parsed.audioPrefs.stabilizerStrength === 'aggressive'
            ? parsed.audioPrefs.stabilizerStrength
            : 'aggressive',
        visualTheme: isValidVisualTheme(parsed.audioPrefs.visualTheme)
          ? parsed.audioPrefs.visualTheme
          : 'cyber-deck',
        streamBufferSeconds:
          typeof parsed.audioPrefs.streamBufferSeconds === 'number'
            ? Math.max(0, Math.min(15, Math.round(parsed.audioPrefs.streamBufferSeconds)))
            : 6,
        smartAntiRepeatEnabled: Boolean(
          parsed.audioPrefs.smartAntiRepeatEnabled ?? true
        ),
      },
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      integrations:
        parsed.integrations && typeof parsed.integrations === 'object'
          ? parsed.integrations
          : undefined,
      customTheme:
        parsed.customTheme && typeof parsed.customTheme === 'object'
          ? parsed.customTheme
          : undefined,
      discoveryFilters:
        parsed.discoveryFilters && typeof parsed.discoveryFilters === 'object'
          ? parsed.discoveryFilters
          : undefined,
      picardConfig:
        parsed.picardConfig && typeof parsed.picardConfig === 'object'
          ? parsed.picardConfig
          : undefined,
      autopilotRules: Array.isArray(parsed.autopilotRules)
        ? parsed.autopilotRules
        : undefined,
      customPlaylistNames:
        parsed.customPlaylistNames &&
        typeof parsed.customPlaylistNames === 'object'
          ? parsed.customPlaylistNames
          : undefined,
      pinnedPlaylistId: parsed.pinnedPlaylistId ?? undefined,
      playbackSession:
        parsed.playbackSession && typeof parsed.playbackSession === 'object'
          ? parsed.playbackSession
          : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Computes how many seconds of continuous audio are currently buffered ahead of `currentTime`.
 * Used by the proactive pre-buffering check and mid-song anti-skip monitor on variable mobile networks.
 */
export function computeBufferedAheadSeconds(
  ranges: readonly { start: number; end: number }[],
  currentTime: number
): number {
  if (!ranges || ranges.length === 0) return 0;
  const now = Math.max(0, currentTime || 0);
  // Find range containing `now` (with 0.35s tolerance for initial seek/start)
  for (const r of ranges) {
    if (now + 0.35 >= r.start && now <= r.end) {
      return Number(Math.max(0, r.end - now).toFixed(2));
    }
  }
  // Fallback: check highest buffered end if currentTime is at 0
  if (now < 0.5) {
    const lastEnd = ranges[ranges.length - 1]?.end ?? 0;
    return Number(Math.max(0, lastEnd - now).toFixed(2));
  }
  return 0;
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

/**
 * Merges incoming server playlists with existing playlists while preserving any custom user-defined
 * playlist names (`name`) and always keeping the server's real playlist name in `originalName`.
 */
export function mergePlaylistsPreservingCustomNames(
  existingPlaylists: readonly Playlist[],
  incomingPlaylists: readonly Playlist[],
  customNamesById: Record<string, string> = {}
): Playlist[] {
  const byId = new Map<string, Playlist>();
  for (const pl of existingPlaylists) {
    const realName = pl.originalName || pl.name;
    const customName = customNamesById[pl.id]?.trim();
    byId.set(pl.id, {
      ...pl,
      originalName: realName,
      name: customName || pl.name,
    });
  }

  for (const inc of incomingPlaylists) {
    const prev = byId.get(inc.id);
    const serverRealName = inc.originalName || inc.name;
    const savedCustom = customNamesById[inc.id]?.trim();
    const prevHadCustomName =
      prev &&
      prev.name.trim() &&
      prev.originalName &&
      prev.name !== prev.originalName
        ? prev.name.trim()
        : '';

    const effectiveDisplayName =
      savedCustom || prevHadCustomName || inc.name || serverRealName;

    byId.set(inc.id, {
      ...(prev || {}),
      ...inc,
      originalName: serverRealName,
      name: effectiveDisplayName,
    });
  }

  return Array.from(byId.values());
}

/**
 * Builds the Jellyfin InstantMix endpoint URL:
 * GET {serverUrl}/Items/{trackId}/InstantMix?[UserId={userId}&]Limit=25&Fields=MediaSources,NormalizationGain,Album,Artists,Genres&api_key={token}
 */
export function buildJellyfinInstantMixUrl(
  serverUrl: string,
  trackId: string,
  token: string,
  userId = '',
  limit = 25
): string {
  const cleanBase = serverUrl.trim().replace(/\/+$/, '');
  const rawItemId = trackId.replace(/^(jellyfin|emby)-/, '');
  const params = new URLSearchParams();
  if (userId && userId.trim()) {
    params.set('UserId', userId.trim());
  }
  params.set('Limit', String(limit));
  params.set('Fields', 'MediaSources,NormalizationGain,Album,Artists,Genres');
  if (token && token.trim()) {
    params.set('api_key', token.trim());
  }
  return `${cleanBase}/Items/${encodeURIComponent(rawItemId)}/InstantMix?${params.toString()}`;
}

/**
 * Smart Client-Side Instant Mix Engine:
 * Scores library tracks by genre, tags, tempo/BPM, and acoustic/synth vibe,
 * prioritizes high-affinity matches, and shuffles up to `limit` (25) tracks with `seedTrack` leading.
 */
export function buildClientInstantMix(
  seedTrack: Track,
  catalog: readonly Track[],
  limit = 25,
  randomFn: () => number = Math.random
): Track[] {
  if (catalog.length === 0) return [seedTrack];

  const seedGenre = (seedTrack.genre || '').trim().toLowerCase();
  const seedTags = new Set(
    (seedTrack.tags || []).map((t) => t.trim().toLowerCase())
  );
  const seedBpm = seedTrack.bpm ?? seedTrack.synthRecipe?.bpm ?? 118;
  const seedDrive = seedTrack.synthRecipe?.driveAmount ?? 1.25;
  const seedArtist = normalizeMatchToken(seedTrack.artist);

  const others = catalog.filter((t) => t.id !== seedTrack.id);

  const scored = others.map((cand) => {
    let score = 0;
    const candGenre = (cand.genre || '').trim().toLowerCase();
    const candTags = (cand.tags || []).map((t) => t.trim().toLowerCase());
    const candBpm = cand.bpm ?? cand.synthRecipe?.bpm ?? 118;
    const candDrive = cand.synthRecipe?.driveAmount ?? 1.25;
    const candArtist = normalizeMatchToken(cand.artist);

    if (seedGenre && candGenre) {
      if (candGenre === seedGenre) {
        score += 50;
      } else if (
        candGenre.includes(seedGenre) ||
        seedGenre.includes(candGenre)
      ) {
        score += 30;
      }
    }

    for (const tag of candTags) {
      if (seedTags.has(tag)) {
        score += 20;
      }
    }

    const bpmDiff = Math.abs(candBpm - seedBpm);
    if (bpmDiff <= 15) {
      score += 25;
    } else if (bpmDiff <= 30) {
      score += 12;
    }

    if (Math.abs(candDrive - seedDrive) <= 0.25) {
      score += 15;
    }

    if (candArtist === seedArtist) {
      score += 20;
    }

    return { track: cand, score };
  });

  const highAffinity = scored.filter((s) => s.score >= 35).map((s) => s.track);
  const mediumAffinity = scored
    .filter((s) => s.score >= 15 && s.score < 35)
    .map((s) => s.track);
  const remaining = scored.filter((s) => s.score < 15).map((s) => s.track);

  const combined = [
    seedTrack,
    ...fisherYatesShuffle(highAffinity, randomFn),
    ...fisherYatesShuffle(mediumAffinity, randomFn),
    ...fisherYatesShuffle(remaining, randomFn),
  ];

  return combined.slice(0, Math.max(1, limit));
}

/**
 * Extracts a canonical song title signature so duplicate downloads with messy tags
 * (e.g. "(When You Gonna) Give It Up To Me (Radio Version) - Sean Paul; Keyshia Cole" vs
 * "(When You Gonna) Give It Up To Me (feat. Keyshia Cole) (Radio Version)")
 * produce the exact same fingerprint ("when you gonna give it up to me").
 */
export function getCanonicalSongSignature(
  track: Pick<Track, 'title' | 'artist'>
): string {
  let rawTitle = (track.title || '').trim();
  // Strip leading track numbers like "01. " or "02 - "
  rawTitle = rawTitle.replace(/^\d{1,3}(?:\s*[._-]\s*|\s+)/, '');

  // Strip common edition/version/feat parentheticals & brackets before splitting on " - "
  const stripEditions = (s: string) =>
    s
      .replace(
        /\(\s*(?:feat\.?|ft\.?|featuring|with|radio\s+version|radio\s+edit|album\s+version|single\s+version|remaster(?:ed)?|live|deluxe|explicit|clean|official\s+.*?|audio|video|lyrics?|bonus\s+track|version|edit|mix).*?\)/gi,
        ' '
      )
      .replace(
        /\[\s*(?:feat\.?|ft\.?|featuring|with|radio\s+version|radio\s+edit|album\s+version|single\s+version|remaster(?:ed)?|live|deluxe|explicit|clean|official\s+.*?|audio|video|lyrics?|bonus\s+track|version|edit|mix).*?\]/gi,
        ' '
      );

  rawTitle = stripEditions(rawTitle);

  // If the downloader embedded "Song Title - Artist1; Artist2" in the title field, take the core title segment
  if (rawTitle.includes(' - ')) {
    const segments = rawTitle
      .split(' - ')
      .map((seg) => stripEditions(seg).trim())
      .filter(Boolean);
    if (segments.length >= 2) {
      // Pick the first non-empty segment unless it's just the artist name
      const cleanArtist = normalizeMatchToken(track.artist || '');
      const seg0Norm = normalizeMatchToken(segments[0]);
      if (
        cleanArtist &&
        cleanArtist.length > 2 &&
        seg0Norm === cleanArtist &&
        segments[1]
      ) {
        rawTitle = segments[1];
      } else {
        rawTitle = segments[0];
      }
    }
  }

  // Strip inline "feat. ..." or "ft. ..." at the end of the title
  rawTitle = rawTitle.replace(/\b(?:feat\.?|ft\.?|featuring)\s+.*$/i, '');

  // Normalize punctuation (turns "(When You Gonna) Give It Up To Me" into "when you gonna give it up to me")
  const canonicalTitle = rawTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return canonicalTitle || normalizeMatchToken(track.title || '');
}

/**
 * Determines whether two tracks are the same underlying song (even if downloaded multiple times
 * with slightly different filenames, feat. tags, or missing artist metadata like artist="a").
 */
export function areTracksSameSong(
  a: Pick<Track, 'id' | 'title' | 'artist'> | null | undefined,
  b: Pick<Track, 'id' | 'title' | 'artist'> | null | undefined
): boolean {
  if (!a || !b) return false;
  if (a.id === b.id) return true;

  const sigA = getCanonicalSongSignature(a);
  const sigB = getCanonicalSongSignature(b);
  if (!sigA || !sigB) return false;

  if (sigA === sigB) {
    return true;
  }

  // Also catch cases where one canonical title is a prefix/substring of the other (>= 10 chars) and shares artist
  if (sigA.length >= 10 && sigB.length >= 10) {
    if (sigA.includes(sigB) || sigB.includes(sigA)) {
      const artA = normalizeMatchToken(a.artist || '');
      const artB = normalizeMatchToken(b.artist || '');
      if (
        !artA ||
        !artB ||
        artA.length <= 2 ||
        artB.length <= 2 ||
        artA.includes(artB) ||
        artB.includes(artA)
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Scores a track's metadata & audio quality so when multiple duplicate copies of the same song exist,
 * Brokeify keeps the best copy (real artist name instead of "a"/"Unknown" + lossless/higher bitrate).
 */
function scoreTrackCopyQuality(track: Track): number {
  let score = 0;
  const artist = (track.artist || '').trim();
  if (
    artist.length > 2 &&
    artist.toLowerCase() !== 'unknown artist' &&
    artist.toLowerCase() !== 'unknown'
  ) {
    score += 30;
  }
  if (!track.title.includes(';')) {
    score += 10;
  }
  if (track.bitrateKbps) {
    score += Math.min(25, Math.round(track.bitrateKbps / 60));
  }
  const fmt = (track.format || '').toUpperCase();
  if (fmt.includes('FLAC') || fmt.includes('WAV') || fmt.includes('ALAC')) {
    score += 20;
  }
  return score;
}

/**
 * Smart Anti-Repeat & Deduplication Engine:
 * - When `removeDuplicateSongs` is true (default), collapses duplicate downloaded copies of the same song
 *   (keeping the highest-quality copy with the cleanest tags) AND ensures no two identical songs ever sit back-to-back.
 * - When `removeDuplicateSongs` is false, keeps all tracks but spreads any duplicate copies apart so they never play back-to-back.
 */
export function dedupeAndSpreadTracks(
  tracks: readonly Track[],
  removeDuplicateSongs = true
): Track[] {
  if (tracks.length <= 1) return [...tracks];

  if (removeDuplicateSongs) {
    const bySignature = new Map<string, Track>();
    const order: string[] = [];

    for (const tr of tracks) {
      const sig = getCanonicalSongSignature(tr) || tr.id;
      const existing = bySignature.get(sig);
      if (!existing) {
        bySignature.set(sig, tr);
        order.push(sig);
      } else if (scoreTrackCopyQuality(tr) > scoreTrackCopyQuality(existing)) {
        bySignature.set(sig, tr);
      }
    }

    return order
      .map((sig) => bySignature.get(sig))
      .filter((t): t is Track => Boolean(t));
  }

  // Spread-apart mode: reorder any back-to-back duplicates so they never play consecutively
  const result = [...tracks];
  for (let i = 1; i < result.length; i++) {
    if (areTracksSameSong(result[i - 1], result[i])) {
      let swapIdx = -1;
      for (let j = i + 1; j < result.length; j++) {
        if (!areTracksSameSong(result[i - 1], result[j])) {
          swapIdx = j;
          break;
        }
      }
      if (swapIdx !== -1) {
        const temp = result[i];
        result[i] = result[swapIdx];
        result[swapIdx] = temp;
      }
    }
  }
  return result;
}

/**
 * Shuffles tracks using Fisher-Yates while deduplicating identical downloaded songs (when `smartAntiRepeat` is true)
 * and spacing tracks so the same song or same artist doesn't play back-to-back.
 */
export function smartAntiRepeatShuffle(
  tracks: readonly Track[],
  smartAntiRepeat = true,
  randomFn: () => number = Math.random
): Track[] {
  const basePool = smartAntiRepeat
    ? dedupeAndSpreadTracks(tracks, true)
    : [...tracks];
  const shuffled = fisherYatesShuffle(basePool, randomFn);

  // Space out same-artist or same-song tracks so playback feels freshly mixed
  for (let i = 1; i < shuffled.length; i++) {
    const prev = shuffled[i - 1];
    const curr = shuffled[i];
    const sameSong = areTracksSameSong(prev, curr);
    const sameArtist =
      normalizeMatchToken(prev.artist) === normalizeMatchToken(curr.artist) &&
      normalizeMatchToken(prev.artist).length > 2;

    if (sameSong || sameArtist) {
      let swapIdx = -1;
      for (let j = i + 1; j < shuffled.length; j++) {
        const cand = shuffled[j];
        if (
          !areTracksSameSong(prev, cand) &&
          normalizeMatchToken(prev.artist) !== normalizeMatchToken(cand.artist)
        ) {
          swapIdx = j;
          break;
        }
      }
      if (swapIdx !== -1) {
        const tmp = shuffled[i];
        shuffled[i] = shuffled[swapIdx];
        shuffled[swapIdx] = tmp;
      }
    }
  }

  return shuffled;
}

export const DEFAULT_DISCOVERY_FILTERS: DiscoveryFilterConfig = {
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
};

export interface DiscoveryFilterEvaluation {
  excluded: boolean;
  reason: string | null;
}

/**
 * Evaluates a candidate track against Explo-style exclusion toggles, duration bounds,
 * custom excluded words, and an optional user-defined custom JavaScript filter script.
 */
export function evaluateDiscoveryFilter(
  track: {
    title: string;
    artist?: string;
    album?: string;
    durationSec?: number;
  },
  filters: DiscoveryFilterConfig = DEFAULT_DISCOVERY_FILTERS
): DiscoveryFilterEvaluation {
  const title = (track.title || '').trim();
  const artist = (track.artist || '').trim();
  const album = (track.album || '').trim();
  const durationSec = Number(track.durationSec || 0);
  const combined = `${title} ${album}`.toLowerCase();

  if (
    filters.excludeLive &&
    /\b(live|live\s+at|live\s+from|in\s+concert|concert\s+version|live\s+session)\b/i.test(
      combined
    )
  ) {
    return { excluded: true, reason: 'Excluded: Live Version' };
  }

  if (
    filters.excludeRemix &&
    /\b(remix|re-mix|club\s+mix|extended\s+mix|vip\s+mix|bootleg|mashup|dub\s+mix|dj\s+mix)\b/i.test(
      combined
    )
  ) {
    return { excluded: true, reason: 'Excluded: Remix / Club Edit' };
  }

  if (
    filters.excludeAcoustic &&
    /\b(acoustic|unplugged|stripped|piano\s+version|guitar\s+version)\b/i.test(
      combined
    )
  ) {
    return { excluded: true, reason: 'Excluded: Acoustic / Stripped' };
  }

  if (
    filters.excludeInstrumental &&
    /\b(instrumental|karaoke|backing\s+track|tribute|8-bit|lullaby\s+version)\b/i.test(
      combined
    )
  ) {
    return { excluded: true, reason: 'Excluded: Instrumental / Karaoke' };
  }

  if (
    filters.excludeSpedUpSlowed &&
    /\b(sped\s+up|nightcore|slowed|reverb|chopped\s+and\s+screwed|8d\s+audio)\b/i.test(
      combined
    )
  ) {
    return { excluded: true, reason: 'Excluded: Sped Up / Slowed' };
  }

  if (
    filters.excludeCommentary &&
    /\b(commentary|track\s+by\s+track|interview|skit|voice\s+memo|spoken\s+word)\b/i.test(
      combined
    )
  ) {
    return { excluded: true, reason: 'Excluded: Commentary / Skit' };
  }

  if (Array.isArray(filters.customExcludedWords)) {
    for (const rawWord of filters.customExcludedWords) {
      const w = (rawWord || '').trim().toLowerCase();
      if (w && (combined.includes(w) || artist.toLowerCase().includes(w))) {
        return { excluded: true, reason: `Excluded Keyword: "${rawWord.trim()}"` };
      }
    }
  }

  if (durationSec > 0) {
    if (filters.minDurationSec > 0 && durationSec < filters.minDurationSec) {
      return {
        excluded: true,
        reason: `Excluded: Shorter than ${filters.minDurationSec}s (${durationSec}s)`,
      };
    }
    if (filters.maxDurationSec > 0 && durationSec > filters.maxDurationSec) {
      return {
        excluded: true,
        reason: `Excluded: Longer than ${filters.maxDurationSec}s (${durationSec}s)`,
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
      const keep = fn(title, artist, album, durationSec);
      if (keep === false) {
        return { excluded: true, reason: 'Excluded: Custom Filter Script' };
      }
    } catch {
      // Ignore syntax error in user script during live typing
    }
  }

  return { excluded: false, reason: null };
}

/**
 * Detects whether a user string is a Spotify URL or URI (playlist, album, or track).
 */
export function extractSpotifyUrlInfo(
  input: string
): { type: 'playlist' | 'album' | 'track'; id: string; url: string } | null {
  const clean = (input || '').trim();
  if (!clean) return null;

  // Match https://open.spotify.com/{playlist|album|track}/{id}
  const webMatch = clean.match(
    /open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track)\/([a-zA-Z0-9]+)/i
  );
  if (webMatch) {
    const type = webMatch[1].toLowerCase() as 'playlist' | 'album' | 'track';
    const id = webMatch[2];
    return {
      type,
      id,
      url: `https://open.spotify.com/${type}/${id}`,
    };
  }

  // Match spotify:{playlist|album|track}:{id}
  const uriMatch = clean.match(/spotify:(playlist|album|track):([a-zA-Z0-9]+)/i);
  if (uriMatch) {
    const type = uriMatch[1].toLowerCase() as 'playlist' | 'album' | 'track';
    const id = uriMatch[2];
    return {
      type,
      id,
      url: `https://open.spotify.com/${type}/${id}`,
    };
  }

  return null;
}

export const DEFAULT_CUSTOM_THEME: CustomThemeConfig = {
  enabled: false,
  customAppName: 'BROKEIFY',
  customTagline: '',
  primaryAccent: '#00ff66',
  secondaryAccent: '#a855f7',
  customCss: '',
};

export const CUSTOM_CSS_PRESETS: ReadonlyArray<{
  id: string;
  name: string;
  description: string;
  primaryAccent: string;
  secondaryAccent: string;
  css: string;
}> = [
  {
    id: 'neon-synthwave',
    name: 'Neon Synthwave Pink & Cyan',
    description: 'Turns the stereo deck into a glowing Miami 1986 OutRun dashboard.',
    primaryAccent: '#ff2a85',
    secondaryAccent: '#00f0ff',
    css: `/* Neon Synthwave Pink & Cyan Theme */
.winamp-bezel {
  border-color: rgba(255, 42, 133, 0.45) !important;
  box-shadow: 0 0 24px rgba(255, 42, 133, 0.12) !important;
}
.winamp-titlebar {
  background: linear-gradient(90deg, #190826 0%, #2d0b38 50%, #091d34 100%) !important;
}`,
  },
  {
    id: 'gold-obsidian',
    name: 'Gold & Obsidian Hi-Fi Audiophile',
    description: 'Warm brushed champagne gold accents over deep matte black.',
    primaryAccent: '#f59e0b',
    secondaryAccent: '#fbbf24',
    css: `/* Gold & Obsidian Hi-Fi Theme */
.winamp-bezel {
  border-color: rgba(245, 158, 11, 0.4) !important;
}
.winamp-titlebar {
  background: linear-gradient(90deg, #18130a 0%, #271e0c 100%) !important;
}`,
  },
  {
    id: 'oceanic-cobalt',
    name: 'Oceanic Ice Blue Deck',
    description: 'Crisp electric sky-blue LEDs and deep navy midnight panels.',
    primaryAccent: '#38bdf8',
    secondaryAccent: '#818cf8',
    css: `/* Oceanic Ice Blue Deck */
.winamp-bezel {
  border-color: rgba(56, 189, 248, 0.4) !important;
}
.winamp-titlebar {
  background: linear-gradient(90deg, #081426 0%, #0c2340 100%) !important;
}`,
  },
  {
    id: 'easy-reader-xl',
    name: 'Easy-Read Boomer XL Mode',
    description: 'Boosts font contrast, button borders, and spacing for effortless reading.',
    primaryAccent: '#00ff66',
    secondaryAccent: '#38bdf8',
    css: `/* Easy-Read Boomer XL Mode */
body {
  letter-spacing: 0.015em;
}
button, input, select {
  border-width: 1.5px !important;
}`,
  },
];

/**
 * Compiles the user's Custom Color Overrides + Custom CSS into a single stylesheet string.
 */
export function compileUserCustomThemeCss(
  theme?: CustomThemeConfig | null
): string {
  if (!theme || theme.enabled === false) return '';
  const rules: string[] = [];
  const primary = (theme.primaryAccent || '').trim();
  const secondary = (theme.secondaryAccent || '').trim();

  if (primary && primary.toLowerCase() !== '#00ff66') {
    rules.push(`
      :root { --brokeify-primary: ${primary}; }
      .text-\\[\\#00ff66\\] { color: ${primary} !important; }
      .bg-\\[\\#00ff66\\] { background-color: ${primary} !important; }
      .border-\\[\\#00ff66\\] { border-color: ${primary} !important; }
    `);
  }

  if (secondary && secondary.toLowerCase() !== '#a855f7') {
    rules.push(`
      :root { --brokeify-secondary: ${secondary}; }
      .bg-\\[\\#a855f7\\], .bg-purple-600 { background-color: ${secondary} !important; }
    `);
  }

  if (theme.customCss && theme.customCss.trim()) {
    rules.push(theme.customCss.trim());
  }

  return rules.join('\n');
}

/**
 * Formats a duration in seconds as M:SS (e.g. 215 -> "3:35").
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const totalSec = Math.floor(seconds);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export { createAlbumArtworkDataUri } from './artworkGenerator';

/**
 * Parses numeric parts of a version string like "0.0.0.1", "v0.0.0.2-beta", "0.1.0"
 */
export function parseVersionString(ver: string): number[] {
  if (!ver) return [0, 0, 0, 0];
  const cleaned = ver.trim().replace(/^v/i, '').split('-')[0];
  return cleaned
    .split('.')
    .map((p) => {
      const n = parseInt(p, 10);
      return Number.isNaN(n) ? 0 : n;
    });
}

/**
 * Compares two version strings (supports 3 or 4 segments like 0.0.0.1 vs 0.0.0.2).
 * Returns:
 *   1 if a > b (a is newer)
 *  -1 if a < b (b is newer)
 *   0 if identical
 */
export function compareSemVerVersions(a: string, b: string): number {
  const partsA = parseVersionString(a);
  const partsB = parseVersionString(b);
  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const valA = partsA[i] ?? 0;
    const valB = partsB[i] ?? 0;
    if (valA > valB) return 1;
    if (valA < valB) return -1;
  }
  return 0;
}
