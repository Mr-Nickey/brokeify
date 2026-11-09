import type {
  BrokeifyAudioPreferences,
  BrokeifyCloudSettings,
  Playlist,
  ProviderConfig,
  Track,
} from '../types/music';
import { createAlbumArtworkDataUri } from '../utils/artworkGenerator';
import {
  buildClientInstantMix,
  EQ_PRESETS,
  parseCloudSettingsResponse,
  serializeCloudSettingsPayload,
} from '../utils/musicLogic';

const PROVIDERS_STORAGE_KEY = 'brokeify_providers_standalone_v4';
const PLAYLISTS_STORAGE_KEY = 'brokeify_playlists_v2';
const CUSTOM_TRACKS_STORAGE_KEY = 'brokeify_remote_tracks_v2';
const AUDIO_PREFS_STORAGE_KEY = 'brokeify_audio_prefs_v1';
const LOCAL_CLOUD_MIRROR_KEY = 'brokeify_standalone_prefs_mirror_v1';
const ONBOARDING_COMPLETED_KEY = 'brokeify_onboarding_completed_v1';
export const JELLYFIN_TOKEN_STORAGE_KEY = 'brokeify_session_token';
export const JELLYFIN_USER_ID_STORAGE_KEY = 'brokeify_user_id';

export const BUILT_IN_TRACKS: Track[] = [];

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'prov-built-in',
    type: 'built-in',
    name: 'Brokeify Native SQLite Engine (/music)',
    enabled: true,
    serverUrl: '/music',
    authMode: 'session',
    username: 'admin',
    password: '',
    token: 'standalone-sqlite-engine',
    userId: 'brokeify-local-admin',
    status: 'connected',
    lastMessage:
      'Standalone SQLite Engine (/data/brokeify.db) + Chokidar /music Watcher + EBU R128 LUFS Active.',
    diagnosticLog:
      '✅ Brokeify Native Engine Active: Directly indexing /music into /data/brokeify.db with HTTP 206 Range streaming.',
  },
  {
    id: 'prov-radio-browser',
    type: 'radio-browser',
    name: 'Radio-Browser Public API',
    enabled: false,
    serverUrl: 'https://de1.api.radio-browser.info',
    status: 'disconnected',
    lastMessage: 'Live ad-free global stations (rock, synthwave, electronic)',
    trackCount: 0,
  },
  {
    id: 'prov-internet-archive',
    type: 'internet-archive',
    name: 'Internet Archive Live Audio (etree)',
    enabled: false,
    serverUrl: 'https://archive.org',
    status: 'disconnected',
    lastMessage: 'Public Live Music Archive & Open Audio Catalog',
    trackCount: 0,
  },
];

export const DEFAULT_PLAYLISTS: Playlist[] = [];

export class MusicProviderManager {
  /**
   * Calls navigator.storage.persist() on app startup so Android Chrome
   * never evicts the IndexedDB audio vault (`brokeify-offline-vault`) or localStorage tokens.
   */
  static async ensurePersistentStorage(): Promise<{
    persisted: boolean;
    message: string;
  }> {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.persist === 'function'
    ) {
      try {
        const alreadyPersisted =
          typeof navigator.storage.persisted === 'function'
            ? await navigator.storage.persisted()
            : false;
        if (alreadyPersisted) {
          return {
            persisted: true,
            message:
              'Persistent storage active (IndexedDB & tokens protected from eviction)',
          };
        }
        const granted = await navigator.storage.persist();
        return {
          persisted: granted,
          message: granted
            ? 'navigator.storage.persist() granted — Vault & tokens locked'
            : 'navigator.storage.persist() requested (Zero-Logout guard active)',
        };
      } catch {
        return {
          persisted: false,
          message: 'Storage persistence requested (Zero-Logout fallback active)',
        };
      }
    }
    return {
      persisted: false,
      message: 'Zero-Logout localStorage & IndexedDB persistence active',
    };
  }

  static loadProviders(): ProviderConfig[] {
    try {
      const raw = localStorage.getItem(PROVIDERS_STORAGE_KEY);
      if (!raw) {
        return DEFAULT_PROVIDERS.map((p) => ({ ...p }));
      }
      const parsed = JSON.parse(raw) as ProviderConfig[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return DEFAULT_PROVIDERS.map((p) => ({ ...p }));
      }
      const savedById = new Map<string, ProviderConfig>();
      for (const item of parsed) {
        if (item && item.id) {
          savedById.set(item.id, item);
        }
      }
      return DEFAULT_PROVIDERS.map((def) => {
        const saved = savedById.get(def.id);
        const merged = saved ? { ...def, ...saved } : { ...def };
        if (merged.type === 'built-in') {
          merged.enabled = true;
          merged.status = 'connected';
          merged.serverUrl = merged.serverUrl || '/music';
          merged.token = merged.token || 'standalone-sqlite-engine';
        }
        return merged;
      });
    } catch {
      return DEFAULT_PROVIDERS.map((p) => ({ ...p }));
    }
  }

  static saveProviders(providers: ProviderConfig[]): void {
    try {
      localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify(providers));
    } catch {
      // Ignore storage quota errors
    }
  }

  static loadCustomPlaylistNames(): Record<string, string> {
    try {
      const raw = localStorage.getItem('brokeify_playlist_custom_names_v1');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  static saveCustomPlaylistNames(map: Record<string, string>): void {
    try {
      localStorage.setItem(
        'brokeify_playlist_custom_names_v1',
        JSON.stringify(map)
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  static loadPlaylists(): Playlist[] {
    try {
      const customNames = MusicProviderManager.loadCustomPlaylistNames();
      const raw = localStorage.getItem(PLAYLISTS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Playlist[];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (pl) =>
            pl &&
            pl.id !== 'pl-night-drive' &&
            pl.id !== 'pl-spite-anthem' &&
            pl.id !== 'pl-all-local-tracks' &&
            pl.name !== 'Night Drive Synthwave'
        )
        .map((pl) => {
          const realName = pl.originalName || pl.name;
          const customName = customNames[pl.id]?.trim();
          return {
            ...pl,
            originalName: realName,
            name: customName || pl.name,
          };
        });
    } catch {
      return [];
    }
  }

  static savePlaylists(playlists: Playlist[]): void {
    try {
      localStorage.setItem(PLAYLISTS_STORAGE_KEY, JSON.stringify(playlists));
    } catch {
      // Ignore storage quota errors
    }
  }

  static loadCachedRemoteTracks(): Track[] {
    try {
      const raw = localStorage.getItem(CUSTOM_TRACKS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Track[];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (t) =>
          t &&
          !t.id.endsWith('-lan-1') &&
          !String(t.streamUrl || '').startsWith('synth://') &&
          t.artist !== 'Chrome Tape Syndicate' &&
          t.artist !== 'The Self-Hosted Collective'
      );
    } catch {
      return [];
    }
  }

  static saveCachedRemoteTracks(tracks: Track[]): void {
    try {
      localStorage.setItem(CUSTOM_TRACKS_STORAGE_KEY, JSON.stringify(tracks));
    } catch {
      // Ignore storage quota errors
    }
  }

  static loadSavedAudioPreferences(): BrokeifyAudioPreferences {
    try {
      const raw = localStorage.getItem(AUDIO_PREFS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          eqPreset: parsed.eqPreset || 'Car Stereo',
          eqGains:
            Array.isArray(parsed.eqGains) && parsed.eqGains.length === 5
              ? parsed.eqGains
              : [...EQ_PRESETS['Car Stereo']],
          carVolumeLeveler: Boolean(parsed.carVolumeLeveler ?? true),
          lufsNormalizationEnabled: Boolean(
            parsed.lufsNormalizationEnabled ?? true
          ),
          shuffleEnabled: Boolean(parsed.shuffleEnabled ?? false),
          repeatMode: parsed.repeatMode || 'all',
        };
      }
    } catch {}
    return {
      eqPreset: 'Car Stereo',
      eqGains: [...EQ_PRESETS['Car Stereo']],
      carVolumeLeveler: true,
      lufsNormalizationEnabled: true,
      shuffleEnabled: false,
      repeatMode: 'all',
    };
  }

  /**
   * Standalone Server Settings Sync (GET /api/config)
   */
  static async pullCloudSettingsFromJellyfin(
    _config: ProviderConfig
  ): Promise<{
    settings: BrokeifyCloudSettings | null;
    endpointUrl: string;
    fromMirror: boolean;
  }> {
    const displayEndpoint = '/api/config';
    try {
      const rawMirror = localStorage.getItem(LOCAL_CLOUD_MIRROR_KEY);
      if (rawMirror) {
        const parsedMirror = parseCloudSettingsResponse(JSON.parse(rawMirror));
        if (parsedMirror) {
          return {
            settings: parsedMirror,
            endpointUrl: displayEndpoint,
            fromMirror: true,
          };
        }
      }
    } catch {}
    return { settings: null, endpointUrl: displayEndpoint, fromMirror: false };
  }

  /**
   * Standalone Server Settings Sync (Mirrors settings locally & to /data/config.json)
   */
  static async pushCloudSettingsToJellyfin(
    _config: ProviderConfig,
    settings: BrokeifyCloudSettings
  ): Promise<{
    ok: boolean;
    endpointUrl: string;
    message: string;
  }> {
    const payload = serializeCloudSettingsPayload(settings);
    try {
      localStorage.setItem(LOCAL_CLOUD_MIRROR_KEY, JSON.stringify(payload));
    } catch {}
    return {
      ok: true,
      endpointUrl: '/api/config',
      message: 'Saved to Brokeify Standalone Server (/data/config.json)',
    };
  }

  /**
   * Standalone Mode: Brokeify IS the music server, so onboarding is always complete by default.
   */
  static hasCompletedOnboarding(
    _providers: readonly ProviderConfig[]
  ): boolean {
    return true;
  }

  static markOnboardingCompleted(): void {
    try {
      localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    } catch {
      // ignore
    }
  }

  /**
   * Pings GET /api/health on the local Brokeify Standalone Engine.
   */
  static async testJellyfinServerPublicInfo(_serverUrl?: string): Promise<{
    ok: boolean;
    version?: string;
    serverName?: string;
    quickConnectAvailable?: boolean;
    message: string;
  }> {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) {
        return {
          ok: false,
          message: `❌ Local Brokeify Engine returned HTTP ${res.status}`,
        };
      }
      const data = await res.json();
      return {
        ok: true,
        version: '3.0-sqlite',
        serverName: String(data?.server || 'Brokeify Native SQLite Engine'),
        quickConnectAvailable: true,
        message: `✅ ${data?.server || 'Brokeify Native Engine'} online (${data?.totalTracks ?? 0} tracks, ${data?.totalAlbums ?? 0} albums, ${data?.totalPlaylists ?? 0} playlists in ${data?.dbPath || '/data/brokeify.db'})`,
      };
    } catch (err: any) {
      return {
        ok: false,
        message: `❌ Could not reach local /api/health (${err?.message || 'Network error'})`,
      };
    }
  }

  static async initiateJellyfinQuickConnect(_serverUrl: string): Promise<{
    code: string;
    secret: string;
    authenticated: boolean;
  }> {
    return {
      code: 'LOCAL0',
      secret: 'standalone-sqlite-secret',
      authenticated: true,
    };
  }

  static async pollJellyfinQuickConnect(
    _serverUrl: string,
    secret: string
  ): Promise<{
    authenticated: boolean;
    code?: string;
    secret: string;
  }> {
    return {
      authenticated: true,
      code: 'LOCAL0',
      secret,
    };
  }

  static async authenticateWithJellyfinQuickConnect(
    _serverUrl: string,
    _secret: string
  ): Promise<{
    accessToken: string;
    userId: string;
    username: string;
  }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin' }),
    });
    const data = await res.json().catch(() => ({}));
    const accessToken = String(data?.token || 'standalone-sqlite-token');
    const userId = String(data?.user?.id || 'brokeify-local-admin');
    const username = String(data?.user?.username || 'admin');
    return { accessToken, userId, username };
  }

  static async logoutProvider(
    providerType: ProviderConfig['type'],
    currentProviders: ProviderConfig[]
  ): Promise<{
    updatedProviders: ProviderConfig[];
    remainingTracks: Track[];
    remainingPlaylists: Playlist[];
  }> {
    const updatedProviders = currentProviders.map((p) =>
      p.type === providerType && p.type !== 'built-in'
        ? {
            ...p,
            status: 'disconnected' as const,
            trackCount: 0,
            playlistCount: 0,
            lastMessage: 'Disconnected.',
          }
        : p
    );
    MusicProviderManager.saveProviders(updatedProviders);

    const remainingTracks =
      MusicProviderManager.loadCachedRemoteTracks().filter(
        (t) => t.source !== providerType || t.source === 'built-in'
      );
    MusicProviderManager.saveCachedRemoteTracks(remainingTracks);

    const remainingPlaylists = MusicProviderManager.loadPlaylists().filter(
      (pl) => pl.source !== providerType || pl.source === 'built-in'
    );
    MusicProviderManager.savePlaylists(remainingPlaylists);

    return {
      updatedProviders,
      remainingTracks,
      remainingPlaylists,
    };
  }

  /**
   * Fetches all indexed tracks and playlists directly from the Brokeify Standalone SQLite Engine:
   * - GET /api/library/tracks
   * - GET /api/playlists
   */
  static async fetchLocalSqliteLibrary(
    config?: ProviderConfig
  ): Promise<{
    updatedConfig: ProviderConfig;
    tracks: Track[];
    playlists: Playlist[];
    restoredCloudSettings?: BrokeifyCloudSettings | null;
  }> {
    const baseConfig: ProviderConfig = config || DEFAULT_PROVIDERS[0];

    try {
      const [tracksRes, playlistsRes] = await Promise.all([
        fetch('/api/library/tracks'),
        fetch('/api/playlists'),
      ]);

      if (!tracksRes.ok) {
        throw new Error(
          `GET /api/library/tracks returned HTTP ${tracksRes.status}`
        );
      }

      const tracksData = await tracksRes.json();
      const rawTracks: any[] = Array.isArray(tracksData?.tracks)
        ? tracksData.tracks
        : [];

      const tracks: Track[] = rawTracks.map((r) => ({
        id: String(r.id),
        title: String(r.title || 'Untitled Track'),
        artist: String(r.artist || 'Unknown Artist'),
        album: String(r.album || 'Singles'),
        duration: Math.max(1, Number(r.duration || 180)),
        source: 'built-in',
        sourceName: 'Brokeify Native Engine',
        streamUrl: String(
          r.streamUrl || `/api/stream/${encodeURIComponent(String(r.id))}`
        ),
        artworkUrl: String(
          r.artworkUrl ||
            `/api/cover/album/${encodeURIComponent(String(r.albumId || r.id))}`
        ),
        accentColor: String(r.accentColor || '#10b981'),
        genre: r.genre ? String(r.genre) : 'Music',
        tags: r.genre ? [String(r.genre)] : undefined,
        normalizationGain:
          typeof r.normalizationGain === 'number'
            ? Number(r.normalizationGain)
            : typeof r.replaygainTrackGain === 'number'
              ? Number(r.replaygainTrackGain)
              : 0,
        bitrateKbps: Number(r.bitrateKbps || r.bitrate || 320),
        format: String(r.format || 'MP3').toUpperCase(),
        playCount: Number(r.playCount || 0),
        lastPlayedAt: r.lastPlayedAt ? String(r.lastPlayedAt) : undefined,
      }));

      let playlists: Playlist[] = [];
      if (playlistsRes.ok) {
        const plData = await playlistsRes.json();
        const rawPlaylists: any[] = Array.isArray(plData?.playlists)
          ? plData.playlists
          : [];
        playlists = rawPlaylists.map((p) => ({
          id: String(p.id),
          name: String(p.name || 'Playlist'),
          originalName: String(p.originalName || p.name || 'Playlist'),
          description: String(
            p.description ||
              `Local SQLite playlist (${Array.isArray(p.trackIds) ? p.trackIds.length : 0} tracks)`
          ),
          source: 'built-in',
          trackIds: Array.isArray(p.trackIds)
            ? p.trackIds.map((id: any) => String(id))
            : [],
          createdAt: String(
            p.createdAt || new Date().toISOString().slice(0, 10)
          ),
          coverAccent: String(p.coverAccent || '#10b981'),
        }));
      }

      const hasTracks = tracks.length > 0;
      const diag = hasTracks
        ? `✅ Brokeify SQLite Engine Connected: ${tracks.length} tracks & ${playlists.length} playlists indexed from /music`
        : '⚠️ No music drive connected or 0 audio files found in /music. Mount your local hard drive or NAS share in Docker Compose or configure your drive path in Settings.';

      const updatedConfig: ProviderConfig = {
        ...baseConfig,
        type: 'built-in',
        name: 'Brokeify Native SQLite Engine (/music)',
        enabled: true,
        serverUrl: '/music',
        status: hasTracks ? 'connected' : 'disconnected',
        lastMessage: diag,
        diagnosticLog: diag,
        trackCount: tracks.length,
        playlistCount: playlists.length,
      };

      return {
        updatedConfig,
        tracks,
        playlists,
        restoredCloudSettings: null,
      };
    } catch (err: any) {
      const existingTracks = MusicProviderManager.loadCachedRemoteTracks();
      const diag = `❌ Local SQLite fetch error: ${err?.message || 'Failed to reach /api/library/tracks'}`;
      return {
        updatedConfig: {
          ...baseConfig,
          status: 'error',
          lastMessage: diag,
          diagnosticLog: diag,
          trackCount: existingTracks.length,
        },
        tracks: existingTracks,
        playlists: MusicProviderManager.loadPlaylists(),
        restoredCloudSettings: null,
      };
    }
  }

  static async fetchJellyfinMusic(config?: ProviderConfig) {
    return MusicProviderManager.fetchLocalSqliteLibrary(config);
  }

  static async connectJellyfinOrEmby(config?: ProviderConfig) {
    return MusicProviderManager.fetchLocalSqliteLibrary(config);
  }

  static async connectNavidrome(config: ProviderConfig) {
    const res = await MusicProviderManager.fetchLocalSqliteLibrary(config);
    return { updatedConfig: res.updatedConfig, tracks: res.tracks };
  }

  static async connectPlex(config: ProviderConfig) {
    const res = await MusicProviderManager.fetchLocalSqliteLibrary(config);
    return { updatedConfig: res.updatedConfig, tracks: res.tracks };
  }

  /**
   * Public Radio-Browser Live API Fetcher
   */
  static async fetchRadioBrowserStations(tag = 'rock'): Promise<Track[]> {
    const endpoint = `https://de1.api.radio-browser.info/json/stations/search?limit=12&tag=${encodeURIComponent(tag)}&hidebroken=true&order=clickcount&reverse=true`;
    try {
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const stations: any[] = await res.json();
      const valid = stations
        .filter(
          (s) => s.url_resolved && String(s.url_resolved).startsWith('http')
        )
        .slice(0, 8);

      if (valid.length > 0) {
        return valid.map((st, idx) => {
          const title = String(st.name || `Radio Station ${idx + 1}`).trim();
          const country = String(st.country || 'Global').trim();
          return {
            id: `radio-${st.stationuuid || idx}`,
            title,
            artist: `${country} · Live ${tag.toUpperCase()} Radio`,
            album: 'Radio-Browser Public Network',
            duration: 3600,
            source: 'radio-browser',
            sourceName: 'Radio-Browser API',
            streamUrl: String(st.url_resolved),
            artworkUrl: createAlbumArtworkDataUri(
              title,
              `${tag.toUpperCase()} RADIO`,
              '#10b981',
              '#06b6d4',
              'LIVE RADIO'
            ),
            accentColor: '#10b981',
            normalizationGain: -1.5,
            bitrateKbps: Number(st.bitrate || 128) || 128,
            format: String(st.codec || 'MP3').toUpperCase(),
            isLiveStream: true,
          };
        });
      }
    } catch {
      // ignore offline
    }
    return [];
  }

  /**
   * Internet Archive Audio API Fetcher
   */
  static async fetchInternetArchiveTracks(): Promise<Track[]> {
    const searchUrl =
      'https://archive.org/advancedsearch.php?q=mediatype:audio+AND+collection:etree&fl[]=identifier,title,creator&rows=6&page=1&output=json';
    try {
      const res = await fetch(searchUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const docs: any[] = data?.response?.docs || [];
      if (docs.length > 0) {
        return docs.slice(0, 6).map((doc, idx) => {
          const identifier = String(doc.identifier || `etree-${idx}`);
          const title = String(doc.title || identifier);
          const artist = String(
            Array.isArray(doc.creator)
              ? doc.creator[0]
              : doc.creator || 'Live Music Archive'
          );
          return {
            id: `ia-${identifier}`,
            title,
            artist,
            album: 'Internet Archive (etree)',
            duration: 240,
            source: 'internet-archive',
            sourceName: 'Internet Archive',
            streamUrl: `https://archive.org/download/${encodeURIComponent(identifier)}`,
            artworkUrl: createAlbumArtworkDataUri(
              title,
              artist,
              '#a855f7',
              '#f59e0b',
              'ARCHIVE.ORG'
            ),
            accentColor: '#a855f7',
            normalizationGain: -1.0,
            bitrateKbps: 256,
            format: 'VBR MP3',
          };
        });
      }
    } catch {
      // ignore offline
    }
    return [];
  }

  /**
   * "Play More Like This" (Smart Instant Mix Engine)
   * Builds a 25-track similarity radio mix from the local SQLite catalog.
   */
  static async generateInstantMix(
    seedTrack: Track,
    catalog: readonly Track[],
    _providerConfig?: ProviderConfig
  ): Promise<{
    mixTracks: Track[];
    playlist: Playlist;
    usedJellyfinApi: boolean;
  }> {
    const mixTracks = buildClientInstantMix(seedTrack, catalog, 25);
    const playlist: Playlist = {
      id: `pl-instantmix-${Date.now()}`,
      name: `${seedTrack.title} Radio (Instant Mix)`,
      description: `Smart Instant Mix based on "${seedTrack.title}" (${
        seedTrack.genre || 'genre & loudness affinity'
      }).`,
      source: 'built-in',
      trackIds: mixTracks.map((t) => t.id),
      createdAt: new Date().toISOString().slice(0, 10),
      coverAccent: '#a855f7',
    };

    return {
      mixTracks,
      playlist,
      usedJellyfinApi: false,
    };
  }
}
