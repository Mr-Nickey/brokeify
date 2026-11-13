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
  playCount?: number;
  lastPlayedAt?: string;
  dateAdded?: string;
  fileSizeBytes?: number;
  year?: number | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  filePath?: string;
  musicbrainzId?: string | null;
  artistMusicbrainzId?: string | null;
  albumMusicbrainzId?: string | null;
}

export type AutopilotSyncSchedule = 'off' | 'daily' | 'weekly' | 'monthly';
export type AutopilotScheduleInterval = 'off' | 'daily' | 'weekly' | 'monthly';

export interface PlaylistGhostTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  matchedTrackId?: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  originalName?: string;
  description: string;
  source: ProviderType | 'mixed' | 'spotify-resolved';
  trackIds: string[];
  ghostTracks?: PlaylistGhostTrack[];
  createdAt: string;
  coverAccent: string;
  coverUrl?: string;
  linkedSpotifyUrl?: string;
  autopilotSpotifyUrl?: string;
  autopilotSchedule?: AutopilotSyncSchedule;
  autopilotInterval?: AutopilotScheduleInterval;
  autopilotAutoDownload?: boolean;
  lastAutopilotSyncAt?: string;
}

export interface AutopilotPlaylistRule {
  id: string;
  playlistId: string;
  playlistName: string;
  sourceUrl?: string;
  spotifyUrl: string;
  schedule?: 'daily' | 'weekly' | 'monthly';
  interval: AutopilotScheduleInterval;
  autoDownloadMissing: boolean;
  preferredDownloader?: DownloaderSourceMode;
  organizeWithPicard?: boolean;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastAddedCount: number;
  lastMissingQueuedCount: number;
  statusMessage?: string;
  lastRunMessage?: string;
}

export interface PicardOrganizerConfig {
  enabled: boolean;
  folderTemplate: string;
  useAiMetadataCleanup: boolean;
  useMusicBrainzPicard?: boolean;
  targetMusicRoot?: string;
  embedId3Tags?: boolean;
}

export interface TrackPlayStatRecord {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  playCount: number;
  lastPlayedAt: string | null;
  totalListenSeconds: number;
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

export interface CrossDevicePlaybackSession {
  updatedAt: string;
  deviceId: string;
  deviceName: string;
  isPlaying: boolean;
  trackId: string;
  track: Track;
  positionSec: number;
  durationSec: number;
  playlistId: string | null;
  playlistName: string | null;
  queueTrackIds: string[];
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
}

export interface BrokeifyCloudSettings {
  version: number;
  updatedAt: string;
  audioPrefs: BrokeifyAudioPreferences;
  providers: ProviderConfig[];
  playlists: Playlist[];
  integrations?: Partial<BrokeifyServerIntegrations>;
  customTheme?: CustomThemeConfig;
  discoveryFilters?: DiscoveryFilterConfig;
  picardConfig?: PicardOrganizerConfig;
  autopilotRules?: AutopilotPlaylistRule[];
  customPlaylistNames?: Record<string, string>;
  pinnedPlaylistId?: string | null;
  playbackSession?: CrossDevicePlaybackSession | null;
}

export interface CloudSyncStatus {
  state: 'idle' | 'syncing' | 'restored' | 'pushed' | 'cached-fallback';
  lastSyncedAt: string | null;
  message: string;
}

export type DownloaderSourceMode =
  | 'auto'
  | 'slskd'
  | 'lidarr'
  | 'youtube'
  | 'archive';

export interface DiscoveryFilterConfig {
  excludeLive: boolean;
  excludeRemix: boolean;
  excludeAcoustic: boolean;
  excludeInstrumental: boolean;
  excludeSpedUpSlowed: boolean;
  excludeCommentary: boolean;
  customExcludedWords: string[];
  minDurationSec: number;
  maxDurationSec: number;
  customScriptEnabled: boolean;
  customScriptCode: string;
}

export interface CustomThemeConfig {
  enabled: boolean;
  customAppName: string;
  customTagline: string;
  primaryAccent: string;
  secondaryAccent: string;
  customCss: string;
}

export interface BrokeifyServerIntegrations {
  jellyfinUrl: string;
  jellyfinToken: string;
  jellyfinUserId: string;
  jellyfinUsername?: string;
  requireDeviceLogin?: boolean;
  slskdUrl: string;
  slskdApiKey: string;
  lidarrUrl?: string;
  lidarrApiKey?: string;
  lidarrRootFolderPath?: string;
  lidarrQualityProfileId?: number;
  lidarrMetadataProfileId?: number;
  listenbrainzUsername: string;
  listenbrainzToken: string;
  acoustidApiKey?: string;
  stagingDir?: string;
  autoOrganizeDownloads?: boolean;
  preferredDownloader?: DownloaderSourceMode;
  downloadDir?: string;
  youtubeAudioFormat?: 'mp3' | 'flac' | 'm4a';
  githubRepo?: string;
  githubBranch?: string;
}

export interface BrokeifyServerConfig {
  version: number;
  updatedAt: string;
  integrations: BrokeifyServerIntegrations;
  audioPrefs: BrokeifyAudioPreferences;
  discoveryFilters?: DiscoveryFilterConfig;
  customTheme?: CustomThemeConfig;
  picardConfig?: PicardOrganizerConfig;
  autopilotRules?: AutopilotPlaylistRule[];
  playStats?: Record<string, TrackPlayStatRecord>;
  providers: ProviderConfig[];
  playlists: Playlist[];
  customPlaylistNames?: Record<string, string>;
  pinnedPlaylistId?: string | null;
  playbackSession?: CrossDevicePlaybackSession | null;
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
  sourceEngine?: 'slskd' | 'lidarr' | 'youtube' | 'archive';
  playlistId?: string | null;
  ghostTrackId?: string | null;
  queuePosition?: number;
  label: string;
  artist: string;
  title: string;
  searchText: string;
  status:
    | 'searching'
    | 'queued'
    | 'downloading'
    | 'completed'
    | 'failed'
    | 'not_found'
    | 'filtered';
  message: string;
  matchedPeer: string | null;
  matchedFormat: string | null;
  organizedPath?: string | null;
  streamUrl?: string;
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

export type DebugLogLevel = 'error' | 'warn' | 'info' | 'success';

export type DebugLogCategory =
  | 'jellyfin'
  | 'slskd'
  | 'lidarr'
  | 'listenbrainz'
  | 'spotify'
  | 'youtube'
  | 'audio'
  | 'playback-sync'
  | 'autopilot'
  | 'system'
  | 'client';

export interface BrokeifyDebugLogEntry {
  id: string;
  timestamp: string;
  level: DebugLogLevel;
  category: DebugLogCategory;
  source: 'server' | 'client';
  message: string;
  details?: string;
  endpoint?: string;
  statusCode?: number;
  hint?: string;
}

export interface HomelabDiagnosticCheck {
  id: string;
  name: string;
  category: DebugLogCategory;
  status: 'ok' | 'warn' | 'error';
  latencyMs?: number;
  summary: string;
  details?: string;
  hint?: string;
}

export interface BrokeifyVersionStatus {
  localVersion: string;
  localDisplayVersion: string;
  localChannel: string;
  localCommitSha: string | null;
  localBuildTime: string | null;
  remoteVersion: string | null;
  remoteDisplayVersion: string | null;
  remoteCommitSha: string | null;
  remoteCommitMessage: string | null;
  remoteCommitDate: string | null;
  remoteCommitUrl: string | null;
  repository: string;
  branch: string;
  updateAvailable: boolean;
  statusSummary: string;
  checkedAt: string;
  changelog: string[];
  error?: string;
}

export interface LibraryOrganizeItem {
  beforePath: string;
  afterPath: string;
  title: string;
  artist: string;
  album: string;
  trackNumber: number;
  year: number;
  recordingMbid?: string;
  coverArtUrl?: string;
  sourceMethod: string;
  detectedVariantFlags: string[];
  applied: boolean;
  alreadyOrganized?: boolean;
  error?: string;
}

export interface LibraryOrganizeJobState {
  id: string;
  status:
    | 'idle'
    | 'scanning'
    | 'running'
    | 'preview_ready'
    | 'completed'
    | 'cancelled'
    | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  dryRun: boolean;
  recursive: boolean;
  targetPath: string;
  skipOrganized: boolean;
  totalFiles: number;
  processedFiles: number;
  currentFile: string;
  currentTrackTitle: string;
  currentTrackArtist: string;
  organizedCount: number;
  skippedCount: number;
  errorCount: number;
  items: LibraryOrganizeItem[];
  error?: string;
}
