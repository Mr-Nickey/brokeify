export type ProviderType =
  | 'built-in'
  | 'jellyfin'
  | 'emby'
  | 'navidrome'
  | 'plex'
  | 'radio-browser'
  | 'internet-archive';

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  name: string;
  enabled: boolean;
  serverUrl: string;
  authMode?: 'session' | 'quickconnect' | 'apikey' | 'password';
  username?: string;
  password?: string;
  token?: string;
  userId?: string;
  salt?: string;
  status: 'connected' | 'disconnected' | 'testing' | 'error';
  lastMessage?: string;
  diagnosticLog?: string;
  trackCount?: number;
  playlistCount?: number;
}

export interface SynthRecipe {
  bpm: number;
  rootHz: number;
  scaleRatios: number[];
  progression: number[];
  bassPattern: number[];
  padWave: OscillatorType;
  leadWave: OscillatorType;
  driveAmount: number;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // in seconds
  source: ProviderType;
  sourceName: string;
  streamUrl: string;
  fallbackStreamUrl?: string;
  artworkUrl: string;
  accentColor: string;
  genre?: string;
  tags?: string[];
  bpm?: number;
  /**
   * ReplayGain / LUFS normalization offset in dB (e.g. -4.2 or +2.5)
   * Used by GainNode in Web Audio API
   */
  normalizationGain?: number;
  bitrateKbps?: number;
  format?: string;
  isLiveStream?: boolean;
  synthRecipe?: SynthRecipe;
}

export interface Playlist {
  id: string;
  name: string;
  originalName?: string;
  description: string;
  source: ProviderType | 'mixed' | 'spotify-resolved';
  trackIds: string[];
  createdAt: string;
  coverAccent: string;
}

export type EQPresetName =
  | 'Flat'
  | 'Car Stereo'
  | 'Bass Boost'
  | 'Rock'
  | 'Vocal'
  | 'Late Night'
  | 'Custom';

export interface EQBand {
  frequency: 60 | 230 | 910 | 3600 | 14000;
  label: string;
  gainDb: number;
}

export interface SpotifyImportedItem {
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
}

export interface SpotifyResolvedItem {
  original: SpotifyImportedItem;
  matchedTrack: Track | null;
  confidence: number; // 0 to 100
  matchReason: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

export type StabilizerStrength = 'off' | 'normal' | 'aggressive';

export type VisualThemeId =
  | 'cyber-deck'
  | 'classic-rack'
  | 'modular-bento'
  | 'amber-crt'
  | 'platinum-light'
  | 'solar-light';

export interface BrokeifyAudioPreferences {
  eqPreset: EQPresetName;
  eqGains: number[];
  carVolumeLeveler: boolean;
  lufsNormalizationEnabled: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  crossfadeSeconds?: number;
  offlinePreloadCount?: number;
  stabilizerStrength?: StabilizerStrength;
  visualTheme?: VisualThemeId;
  streamBufferSeconds?: number;
  smartAntiRepeatEnabled?: boolean;
}

export interface BrokeifyCloudSettings {
  version: number;
  updatedAt: string;
  audioPrefs: BrokeifyAudioPreferences;
  providers: ProviderConfig[];
  playlists: Playlist[];
}

export interface CloudSyncStatus {
  state: 'idle' | 'syncing' | 'restored' | 'pushed' | 'cached-fallback';
  lastSyncedAt: string | null;
  message: string;
}

export interface BrokeifyServerIntegrations {
  jellyfinUrl: string;
  jellyfinToken: string;
  jellyfinUserId: string;
  jellyfinUsername?: string;
  slskdUrl: string;
  slskdApiKey: string;
  listenbrainzUsername: string;
  listenbrainzToken: string;
}

export interface BrokeifyServerConfig {
  version: number;
  updatedAt: string;
  integrations: BrokeifyServerIntegrations;
  audioPrefs: BrokeifyAudioPreferences;
  providers: ProviderConfig[];
  playlists: Playlist[];
  customPlaylistNames?: Record<string, string>;
  pinnedPlaylistId?: string | null;
}

export interface ListenBrainzDiscoverTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  inLibrary: boolean;
  jellyfinTrackId: string | null;
}

export interface ListenBrainzDiscoverPlaylist {
  id: string;
  title: string;
  annotation: string;
  date: string;
  trackCount: number;
  inLibraryCount: number;
  missingCount: number;
  tracks: ListenBrainzDiscoverTrack[];
}

export interface MusicBrainzSearchResult {
  id: string;
  type: 'album' | 'track';
  title: string;
  artist: string;
  album: string;
  year: string;
  coverUrl: string;
  durationSec?: number;
  primaryType?: string;
}

export interface MusicBrainzAlbumTrack {
  id: string;
  number: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
}

export interface MusicBrainzAlbumDetail {
  id: string;
  releaseId?: string;
  title: string;
  artist: string;
  year?: string;
  coverUrl?: string;
  tracks: MusicBrainzAlbumTrack[];
}

export interface SlskdGrabJob {
  id: string;
  type: 'album' | 'track' | 'playlist';
  label: string;
  artist: string;
  title: string;
  searchText: string;
  status: 'searching' | 'queued' | 'downloading' | 'completed' | 'failed';
  message: string;
  matchedPeer: string | null;
  matchedFormat: string | null;
  files: Array<{
    filename: string;
    size: number;
    username: string;
    completed: boolean;
  }>;
  createdAt: string;
  completedAt: string | null;
  error?: string;
}

export interface SlskdReadyNotification {
  id: string;
  jobId: string;
  label: string;
  message: string;
  completedAt: string;
}

