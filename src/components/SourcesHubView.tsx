import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  Database,
  HardDrive,
  Loader2,
  Radio,
  RefreshCw,
  Save,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wand2,
  X,
} from 'lucide-react';
import type {
  BrokeifyCloudSettings,
  BrokeifyServerIntegrations,
  CloudSyncStatus,
  LibraryOrganizeJobState,
  Playlist,
  ProviderConfig,
  ProviderType,
  Track,
} from '../types/music';
import { MusicProviderManager } from '../services/MusicProviderManager';
import {
  ARTWORK_CACHE_DB_NAME,
  clearArtworkCache,
  getArtworkCacheStats,
} from '../utils/artworkCache';
import {
  ConnectAndroidAppSection,
  PWAInstallButton,
} from './PWAInstallButton';
import {
  SecurityAndUsersManagerSection,
  type AuthenticatedSessionUser,
} from './SecurityGateAndAccess';
import { VersionChecker } from './VersionChecker';

interface SourcesHubViewProps {
  providers: ProviderConfig[];
  onUpdateProviders: (next: ProviderConfig[]) => void;
  onMergeRemoteTracks: (newTracks: Track[], providerName: string) => void;
  onMergeRemotePlaylists: (newPlaylists: Playlist[]) => void;
  storagePersistStatus: { persisted: boolean; message: string };
  cloudSyncStatus: CloudSyncStatus;
  onPushCloudSettings: () => Promise<void>;
  onPullCloudSettings: (fromConfig?: ProviderConfig) => Promise<void>;
  onApplyRestoredCloudSettings: (settings: BrokeifyCloudSettings) => void;
  onOpenOnboardingModal?: () => void;
  onLogoutProvider?: (type: ProviderType) => Promise<void>;
  serverIntegrations?: BrokeifyServerIntegrations;
  serverConfigPath?: string;
  onUpdateServerIntegrations?: (next: BrokeifyServerIntegrations) => void;
  onSaveServerConfigNow?: () => Promise<void>;
  onLockDeviceForLogin?: () => void;
  currentUser?: AuthenticatedSessionUser | null;
  requireLogin?: boolean;
  onAuthConfigChanged?: (nextRequireLogin: boolean) => void;
  onLockAndSignOut?: () => void;
  onShowToast?: (msg: string) => void;
  sectionFilter?: 'all' | 'storage' | 'downloaders' | 'android' | 'security';
}

export const SourcesHubView: React.FC<SourcesHubViewProps> = ({
  providers,
  onUpdateProviders,
  onMergeRemoteTracks,
  onMergeRemotePlaylists,
  storagePersistStatus,
  onOpenOnboardingModal,
  serverIntegrations,
  serverConfigPath = '/app/data/config.json',
  onUpdateServerIntegrations,
  onSaveServerConfigNow,
  currentUser = null,
  requireLogin = false,
  onAuthConfigChanged,
  onLockAndSignOut,
  onShowToast,
  sectionFilter = 'all',
}) => {
  const [isSavingConfigFile, setIsSavingConfigFile] = useState<boolean>(false);
  const [isTestingLidarr, setIsTestingLidarr] = useState<boolean>(false);
  const [lidarrTestStatus, setLidarrTestStatus] = useState<{
    ok: boolean;
    message: string;
    hint?: string;
  } | null>(null);

  const [isTestingSlskd, setIsTestingSlskd] = useState<boolean>(false);
  const [slskdTestStatus, setSlskdTestStatus] = useState<{
    ok: boolean;
    message: string;
    hint?: string;
  } | null>(null);

  const [isTestingListenbrainz, setIsTestingListenbrainz] =
    useState<boolean>(false);
  const [listenbrainzTestStatus, setListenbrainzTestStatus] = useState<{
    ok: boolean;
    message: string;
    tokenValid?: boolean;
  } | null>(null);

  const [isTestingAll, setIsTestingAll] = useState<boolean>(false);

  const [savedCardFeedback, setSavedCardFeedback] = useState<
    Record<string, string>
  >({});
  const [artworkStats, setArtworkStats] = useState<{
    count: number;
    totalSizeBytes: number;
  }>({ count: 0, totalSizeBytes: 0 });
  const [isClearingArtwork, setIsClearingArtwork] = useState<boolean>(false);

  const [sqliteHealth, setSqliteHealth] = useState<{
    totalTracks: number;
    totalAlbums: number;
    totalArtists: number;
    totalPlaylists: number;
    musicDir: string;
    dbPath: string;
    lufsAnalyzedCount?: number;
    lufsQueueCount?: number;
    driveConnected?: boolean;
    audioFileCount?: number;
    topLevelFolders?: string[];
  } | null>(null);
  const [isRescanningLibrary, setIsRescanningLibrary] =
    useState<boolean>(false);
  const [drivePathInput, setDrivePathInput] = useState<string>('/music');
  const [isTestingDrivePath, setIsTestingDrivePath] = useState<boolean>(false);
  const [driveTestFeedback, setDriveTestFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Background Full Established Library Organizer state
  const [organizeJob, setOrganizeJob] =
    useState<LibraryOrganizeJobState | null>(null);
  const [organizeRecursive, setOrganizeRecursive] = useState<boolean>(true);
  const [organizeSkipOrganized, setOrganizeSkipOrganized] =
    useState<boolean>(false);

  const fetchOrganizeJobStatus = async () => {
    try {
      const resp = await fetch('/api/library/organize/status');
      const data = await resp.json();
      if (resp.ok && data?.ok && data.job) {
        setOrganizeJob(data.job);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchOrganizeJobStatus();
  }, []);

  useEffect(() => {
    if (
      organizeJob &&
      (organizeJob.status === 'running' || organizeJob.status === 'scanning')
    ) {
      const timer = setInterval(() => {
        fetchOrganizeJobStatus();
      }, 1500);
      return () => clearInterval(timer);
    }
  }, [organizeJob]);

  const handleStartLibraryOrganize = async (dryRun: boolean) => {
    try {
      const resp = await fetch('/api/library/organize/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPath: '',
          recursive: organizeRecursive,
          dryRun,
          skipOrganized: organizeSkipOrganized,
        }),
      });
      const data = await resp.json();
      if (resp.ok && data?.ok && data.job) {
        setOrganizeJob(data.job);
        showSavedCard(
          'acoustid',
          dryRun
            ? 'Started Dry-Run Preview for Entire /music Library'
            : 'Started Full Cleanup & Organization for Entire /music Library'
        );
      }
    } catch {
      // ignore
    }
  };

  const handleApplyLibraryOrganize = async () => {
    try {
      const resp = await fetch('/api/library/organize/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await resp.json();
      if (resp.ok && data?.ok && data.job) {
        setOrganizeJob(data.job);
        showSavedCard(
          'acoustid',
          `Applying tags, artwork & organizing ${data.job.totalFiles} tracks...`
        );
      }
    } catch {
      // ignore
    }
  };

  const handleCancelLibraryOrganize = async () => {
    try {
      const resp = await fetch('/api/library/organize/cancel', {
        method: 'POST',
      });
      const data = await resp.json();
      if (resp.ok && data?.ok && data.job) {
        setOrganizeJob(data.job);
        showSavedCard('acoustid', 'Library organizer cancelled.');
      }
    } catch {
      // ignore
    }
  };

  const refreshSqliteHealth = async () => {
    try {
      const r = await fetch('/api/health');
      if (r.ok) {
        const d = await r.json();
        const mDir = String(d.musicDir || '/music');
        setSqliteHealth({
          totalTracks: Number(d.totalTracks || 0),
          totalAlbums: Number(d.totalAlbums || 0),
          totalArtists: Number(d.totalArtists || 0),
          totalPlaylists: Number(d.totalPlaylists || 0),
          musicDir: mDir,
          dbPath: String(d.dbPath || '/data/brokeify.db'),
          lufsAnalyzedCount: d.scanner?.lufsAnalyzedCount,
          lufsQueueCount: d.scanner?.lufsQueueCount,
          driveConnected: d.driveStatus?.driveConnected,
          audioFileCount: d.driveStatus?.audioFileCount,
          topLevelFolders: d.driveStatus?.topLevelFolders,
        });
        setDrivePathInput(mDir);
      }
    } catch {
      // ignore
    }
  };

  const handleTestDriveInSettings = async () => {
    setIsTestingDrivePath(true);
    setDriveTestFeedback(null);
    try {
      const resp = await fetch('/api/storage/test-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: drivePathInput.trim() || '/music' }),
      });
      const data = await resp.json().catch(() => ({}));
      const ds = data.driveStatus;
      if (ds && ds.exists && ds.readable) {
        setDriveTestFeedback({
          ok: ds.audioFileCount > 0,
          message:
            ds.audioFileCount > 0
              ? `✅ Folder "${ds.musicDir}" is readable (${ds.audioFileCount} audio files, ${ds.playlistFileCount} playlists found).`
              : `⚠️ Folder "${ds.musicDir}" exists and is readable, but contains 0 audio files. Check your Docker Compose volume mount!`,
        });
      } else {
        setDriveTestFeedback({
          ok: false,
          message:
            data.message ||
            `🚨 Folder "${drivePathInput}" does not exist or is not readable inside the container.`,
        });
      }
    } catch {
      setDriveTestFeedback({
        ok: false,
        message: 'Network error testing music drive path.',
      });
    } finally {
      setIsTestingDrivePath(false);
    }
  };

  const handleRescanMusicFolder = async () => {
    setIsRescanningLibrary(true);
    setDriveTestFeedback(null);
    try {
      const resp = await fetch('/api/storage/connect-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: drivePathInput.trim() || '/music' }),
      });
      const data = await resp.json().catch(() => ({}));
      await refreshSqliteHealth();
      const { updatedConfig, tracks, playlists } =
        await MusicProviderManager.fetchLocalSqliteLibrary(providers[0]);
      onUpdateProviders(
        providers.map((p) =>
          p.id === updatedConfig.id || p.type === 'built-in' ? updatedConfig : p
        )
      );
      if (tracks.length > 0) {
        onMergeRemoteTracks(tracks, updatedConfig.name);
      }
      if (playlists.length > 0) {
        onMergeRemotePlaylists(playlists);
      }
      const feedbackMsg =
        data?.message ||
        `Scanned ${drivePathInput}: ${tracks.length} tracks & ${playlists.length} playlists indexed!`;
      setDriveTestFeedback({
        ok: tracks.length > 0,
        message: feedbackMsg,
      });
      showSavedCard('top', feedbackMsg);
    } finally {
      setIsRescanningLibrary(false);
    }
  };

  const refreshArtworkStats = async () => {
    try {
      const stats = await getArtworkCacheStats();
      setArtworkStats(stats);
    } catch {
      // ignore
    }
  };

  React.useEffect(() => {
    refreshArtworkStats();
    refreshSqliteHealth();
  }, []);

  const showSavedCard = (cardKey: string, msg = 'Saved to config.json!') => {
    setSavedCardFeedback((prev) => ({ ...prev, [cardKey]: msg }));
    setTimeout(() => {
      setSavedCardFeedback((prev) => {
        const next = { ...prev };
        delete next[cardKey];
        return next;
      });
    }, 4000);
  };

  const handleSaveCard = async (cardKey: string) => {
    if (onSaveServerConfigNow) {
      setIsSavingConfigFile(true);
      try {
        await onSaveServerConfigNow();
        showSavedCard(cardKey);
      } finally {
        setIsSavingConfigFile(false);
      }
    }
  };

  const handleTestSlskd = async () => {
    setIsTestingSlskd(true);
    setSlskdTestStatus(null);
    try {
      const resp = await fetch('/api/slskd/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slskdUrl: serverIntegrations?.slskdUrl,
          slskdApiKey: serverIntegrations?.slskdApiKey,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        setSlskdTestStatus({
          ok: true,
          message: data.message || 'Connected to slskd!',
        });
      } else {
        setSlskdTestStatus({
          ok: false,
          message: data.error || 'Could not connect to slskd.',
          hint: data.hint,
        });
      }
    } catch {
      setSlskdTestStatus({
        ok: false,
        message: 'Network error calling Brokeify server.',
        hint: 'Check if Brokeify backend is running on port 3487.',
      });
    } finally {
      setIsTestingSlskd(false);
    }
  };

  const handleTestListenbrainz = async () => {
    setIsTestingListenbrainz(true);
    setListenbrainzTestStatus(null);
    try {
      const resp = await fetch('/api/listenbrainz/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: serverIntegrations?.listenbrainzUsername,
          token: serverIntegrations?.listenbrainzToken,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        setListenbrainzTestStatus({
          ok: true,
          message: data.message || 'Connected to ListenBrainz!',
          tokenValid: data.tokenValid,
        });
      } else {
        setListenbrainzTestStatus({
          ok: false,
          message: data.error || 'Could not verify ListenBrainz account.',
        });
      }
    } catch {
      setListenbrainzTestStatus({
        ok: false,
        message: 'Network error testing ListenBrainz.',
      });
    } finally {
      setIsTestingListenbrainz(false);
    }
  };

  const handleTestAllServices = async () => {
    setIsTestingAll(true);
    try {
      const resp = await fetch('/api/services/test-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slskd: {
            slskdUrl: serverIntegrations?.slskdUrl,
            slskdApiKey: serverIntegrations?.slskdApiKey,
          },
          lidarr: {
            lidarrUrl: serverIntegrations?.lidarrUrl,
            lidarrApiKey: serverIntegrations?.lidarrApiKey,
          },
          listenbrainz: {
            username: serverIntegrations?.listenbrainzUsername,
            token: serverIntegrations?.listenbrainzToken,
          },
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.services) {
        if (data.services.slskd) {
          setSlskdTestStatus(data.services.slskd);
        }
        if (data.services.lidarr) {
          setLidarrTestStatus(data.services.lidarr);
        }
        if (data.services.listenbrainz) {
          setListenbrainzTestStatus(data.services.listenbrainz);
        }
      }
      await refreshSqliteHealth();
    } catch {
      // ignore
    } finally {
      setIsTestingAll(false);
    }
  };

  const showStorage = sectionFilter === 'all' || sectionFilter === 'storage';
  const showDownloaders =
    sectionFilter === 'all' || sectionFilter === 'downloaders';
  const showAndroid = sectionFilter === 'all' || sectionFilter === 'android';
  const showSecurity = sectionFilter === 'all' || sectionFilter === 'security';

  return (
    <div className="space-y-8">
      {/* GitHub Repository Version & Update Checker */}
      {showStorage && <VersionChecker />}

      {/* Standalone SQLite Music Engine (/data/brokeify.db) + Chokidar /music Scanner + Android Auto REST API */}
      {showStorage && (
        <section
          aria-label="Brokeify Standalone SQLite Engine & Android Auto REST API"
          data-testid="standalone-sqlite-engine-section"
          className="rounded-2xl border border-[#00ff66]/50 bg-zinc-900/70 p-5 sm:p-6 space-y-5"
        >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <HardDrive className="w-5 h-5 text-[#00ff66] shrink-0" />
              <h2 className="text-lg font-bold text-white tracking-tight font-mono">
                Brokeify Native SQLite Engine ({sqliteHealth?.dbPath || '/data/brokeify.db'}) &amp; Chokidar{' '}
                <code className="text-[#00ff66]">{sqliteHealth?.musicDir || '/music'}</code> Watcher
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed max-w-3xl">
              Brokeify runs as a completely standalone, all-in-one self-hosted
              music server with <strong>zero built-in demo tracks</strong>. It
              watches your mounted drive or NAS folder in real time for FLAC,
              MP3, OGG, OPUS, M4A, WAV, AAC, and{' '}
              <code className="text-white">.m3u/.m3u8</code> playlists, caches
              embedded artwork to <code className="text-white">/data/covers/</code>,
              calculates EBU R128 <code className="text-[#00ff66]">-14 LUFS</code>{' '}
              car-stereo normalization via <code className="text-white">ffmpeg</code>,
              and serves both this web player and your custom Android app over
              HTTP 206 Range streams.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <PWAInstallButton />

            {onOpenOnboardingModal && (
              <button
                type="button"
                onClick={onOpenOnboardingModal}
                data-testid="open-drive-setup-guide-btn"
                className="inline-flex items-center gap-2 rounded-xl border border-amber-500/50 bg-amber-500/15 hover:bg-amber-500/25 px-3.5 py-2 text-xs font-mono font-bold text-amber-300 transition-colors whitespace-nowrap min-h-[40px]"
              >
                <Terminal className="w-4 h-4" />
                <span>Docker Compose &amp; NAS Guide</span>
              </button>
            )}

            <button
              type="button"
              disabled={isRescanningLibrary}
              onClick={handleRescanMusicFolder}
              data-testid="rescan-music-folder-btn"
              className="inline-flex items-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors whitespace-nowrap min-h-[40px]"
            >
              {isRescanningLibrary ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>Rescan Music Drive Now</span>
            </button>
          </div>
        </div>

        {/* Live Music Drive / NAS Folder Path Configuration & Tester */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="settings-music-drive-input"
              className="text-xs font-mono font-bold uppercase text-[#00ff66] flex items-center gap-2"
            >
              <HardDrive className="w-4 h-4" />
              <span>Mounted Music Drive / Local or NAS Folder Path</span>
            </label>
            <span className="text-[11px] font-mono text-zinc-400">
              {sqliteHealth?.driveConnected
                ? `✅ Connected (${sqliteHealth.audioFileCount ?? sqliteHealth.totalTracks} audio files)`
                : '🚨 No audio files detected in current folder'}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <input
              id="settings-music-drive-input"
              type="text"
              value={drivePathInput}
              onChange={(e) => setDrivePathInput(e.target.value)}
              placeholder="/music or /mnt/nas/music"
              data-testid="settings-music-drive-input"
              className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs sm:text-sm font-mono text-white focus:border-[#00ff66] focus:outline-none"
            />

            <button
              type="button"
              onClick={handleTestDriveInSettings}
              disabled={isTestingDrivePath}
              data-testid="settings-test-drive-btn"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#00ff66]/50 bg-[#00ff66]/15 hover:bg-[#00ff66]/25 px-3.5 py-2 text-xs font-mono font-bold text-[#00ff66] transition-colors whitespace-nowrap min-h-[38px]"
            >
              {isTestingDrivePath ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>Test Drive Path</span>
            </button>

            <button
              type="button"
              onClick={handleRescanMusicFolder}
              disabled={isRescanningLibrary}
              data-testid="settings-connect-drive-btn"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors whitespace-nowrap min-h-[38px]"
            >
              {isRescanningLibrary ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Save &amp; Scan Drive</span>
            </button>
          </div>

          {driveTestFeedback && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs font-mono flex items-center gap-2 ${
                driveTestFeedback.ok
                  ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                  : 'border-rose-500/40 bg-rose-950/30 text-rose-300'
              }`}
            >
              {driveTestFeedback.ok ? (
                <CheckCircle2 className="w-4 h-4 text-[#00ff66] shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{driveTestFeedback.message}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 font-mono text-xs">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
            <span className="text-[10px] uppercase text-zinc-400 block">
              SQLite Tracks
            </span>
            <strong className="text-base text-[#00ff66]">
              {sqliteHealth?.totalTracks ?? 0}
            </strong>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
            <span className="text-[10px] uppercase text-zinc-400 block">
              Albums Indexed
            </span>
            <strong className="text-base text-white">
              {sqliteHealth?.totalAlbums ?? 0}
            </strong>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
            <span className="text-[10px] uppercase text-zinc-400 block">
              Artists Indexed
            </span>
            <strong className="text-base text-white">
              {sqliteHealth?.totalArtists ?? 0}
            </strong>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
            <span className="text-[10px] uppercase text-zinc-400 block">
              SQLite Playlists
            </span>
            <strong className="text-base text-purple-300">
              {sqliteHealth?.totalPlaylists ?? 0}
            </strong>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
            <span className="text-[10px] uppercase text-zinc-400 block">
              EBU R128 (-14 LUFS)
            </span>
            <strong className="text-xs text-emerald-300">
              {sqliteHealth?.lufsAnalyzedCount ?? 0} analyzed
              {sqliteHealth?.lufsQueueCount
                ? ` (${sqliteHealth.lufsQueueCount} queued)`
                : ''}
            </strong>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
            <span className="text-[10px] uppercase text-zinc-400 block">
              Android QR API
            </span>
            <strong className="text-xs text-cyan-300">
              HTTP 206 Range Ready
            </strong>
          </div>
        </div>
      </section>
      )}

      {/* Section 0: Persistent Docker Server Storage (/app/data/config.json) + slskd, Lidarr, YouTube Music & ListenBrainz Keys */}
      {showDownloaders && serverIntegrations && onUpdateServerIntegrations && (
        <section
          aria-labelledby="docker-config-heading"
          data-testid="docker-persistent-config-section"
          className="rounded-2xl border border-emerald-500/40 bg-zinc-900/60 p-5 sm:p-6 space-y-5"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <Database className="w-5 h-5 text-[#00ff66] shrink-0" />
                <h2
                  id="docker-config-heading"
                  className="text-lg font-bold text-white tracking-tight font-mono"
                >
                  Persistent Server Storage ({serverConfigPath}) &amp; Auto-Downloader Setup
                </h2>
              </div>
              <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed max-w-3xl">
                <strong className="text-[#00ff66]">Plain-English Summary:</strong>{' '}
                Your <code className="text-white">slskd</code>,{' '}
                <code className="text-white">Lidarr</code>,{' '}
                <code className="text-white">ListenBrainz</code>, custom themes,
                playlists, and live playback position are saved persistently on
                your Docker server in{' '}
                <code className="text-[#00ff66]">{serverConfigPath}</code> and{' '}
                <code className="text-[#00ff66]">/data/brokeify.db</code> (port{' '}
                <code className="text-[#00ff66]">3487</code>).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                disabled={isTestingAll}
                onClick={handleTestAllServices}
                data-testid="test-all-services-btn"
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/50 bg-cyan-500/15 hover:bg-cyan-500/25 px-4 py-2 text-xs font-mono font-bold text-cyan-300 transition-colors whitespace-nowrap min-h-[40px]"
              >
                {isTestingAll ? (
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-300" />
                ) : (
                  <RefreshCw className="w-4 h-4 text-cyan-300" />
                )}
                <span>Test All Homelab Services</span>
              </button>

              <a
                href="/api/config/backup"
                download="config.json"
                data-testid="download-config-backup-btn"
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/50 bg-emerald-500/15 hover:bg-emerald-500/25 px-4 py-2 text-xs font-mono font-bold text-[#00ff66] transition-colors whitespace-nowrap min-h-[40px]"
              >
                <ArrowDownToLine className="w-4 h-4" />
                <span>Backup config.json</span>
              </a>

              {onSaveServerConfigNow && (
                <button
                  type="button"
                  disabled={isSavingConfigFile}
                  onClick={async () => {
                    await handleSaveCard('top');
                  }}
                  data-testid="save-server-config-btn"
                  className="inline-flex items-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors whitespace-nowrap min-h-[40px]"
                >
                  {isSavingConfigFile ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>Save All Settings Now</span>
                </button>
              )}
            </div>
          </div>

          {/* Homelab Live Health Matrix (Music Drive, slskd, Lidarr, ListenBrainz, Storage) */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                <Server className="w-4 h-4 text-[#00ff66]" />
                Live Homelab Service Diagnostics &amp; Health Checks
              </span>
              {savedCardFeedback['top'] && (
                <span className="text-xs font-mono font-bold text-[#00ff66] flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  {savedCardFeedback['top']}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              {/* Music Drive status */}
              <div
                className={`p-3 rounded-xl border flex flex-col justify-between gap-1.5 ${
                  (sqliteHealth?.totalTracks ?? 0) > 0
                    ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
                    : 'border-rose-500/60 bg-rose-950/30 text-rose-300'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-mono font-bold uppercase text-zinc-300">
                    Music Drive ({sqliteHealth?.musicDir || '/music'})
                  </span>
                  {(sqliteHealth?.totalTracks ?? 0) > 0 ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                  )}
                </div>
                <p className="text-[11px] font-mono truncate">
                  {(sqliteHealth?.totalTracks ?? 0) > 0
                    ? `${sqliteHealth?.totalTracks} tracks indexed`
                    : '0 audio files found'}
                </p>
                <button
                  type="button"
                  disabled={isTestingDrivePath}
                  onClick={handleTestDriveInSettings}
                  data-testid="matrix-test-drive-btn"
                  className="mt-1 text-[10px] font-mono font-bold text-[#00ff66] hover:underline text-left"
                >
                  {isTestingDrivePath ? 'Testing...' : 'Test Drive Path →'}
                </button>
              </div>

              {/* slskd status */}
              <div
                className={`p-3 rounded-xl border flex flex-col justify-between gap-1.5 ${
                  slskdTestStatus?.ok
                    ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
                    : slskdTestStatus && !slskdTestStatus.ok
                      ? 'border-rose-500/60 bg-rose-950/30 text-rose-300'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-300'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-mono font-bold uppercase text-zinc-300">
                    slskd P2P
                  </span>
                  {slskdTestStatus?.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : slskdTestStatus && !slskdTestStatus.ok ? (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                  ) : (
                    <Radio className="w-3.5 h-3.5 text-zinc-500" />
                  )}
                </div>
                <p className="text-[11px] font-mono truncate">
                  {slskdTestStatus?.message ||
                    (serverIntegrations.slskdUrl ? 'Untested' : 'Not Configured')}
                </p>
                <button
                  type="button"
                  disabled={isTestingSlskd}
                  onClick={handleTestSlskd}
                  data-testid="matrix-test-slskd-btn"
                  className="mt-1 text-[10px] font-mono font-bold text-[#00ff66] hover:underline text-left"
                >
                  {isTestingSlskd ? 'Testing...' : 'Test slskd →'}
                </button>
              </div>

              {/* Lidarr status */}
              <div
                className={`p-3 rounded-xl border flex flex-col justify-between gap-1.5 ${
                  lidarrTestStatus?.ok
                    ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
                    : lidarrTestStatus && !lidarrTestStatus.ok
                      ? 'border-rose-500/60 bg-rose-950/30 text-rose-300'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-300'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-mono font-bold uppercase text-zinc-300">
                    Lidarr Arr Stack
                  </span>
                  {lidarrTestStatus?.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : lidarrTestStatus && !lidarrTestStatus.ok ? (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                  ) : (
                    <Radio className="w-3.5 h-3.5 text-zinc-500" />
                  )}
                </div>
                <p className="text-[11px] font-mono truncate">
                  {lidarrTestStatus?.message ||
                    (serverIntegrations.lidarrApiKey ? 'Untested' : 'Optional')}
                </p>
                <button
                  type="button"
                  disabled={isTestingLidarr}
                  onClick={async () => {
                    setIsTestingLidarr(true);
                    try {
                      const resp = await fetch('/api/lidarr/test', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          lidarrUrl: serverIntegrations.lidarrUrl,
                          lidarrApiKey: serverIntegrations.lidarrApiKey,
                        }),
                      });
                      const data = await resp.json().catch(() => ({}));
                      setLidarrTestStatus({
                        ok: resp.ok && data.ok,
                        message: data.message || data.error || 'Result received',
                        hint: data.hint,
                      });
                    } catch {
                      setLidarrTestStatus({
                        ok: false,
                        message: 'Network error',
                      });
                    } finally {
                      setIsTestingLidarr(false);
                    }
                  }}
                  data-testid="matrix-test-lidarr-btn"
                  className="mt-1 text-[10px] font-mono font-bold text-amber-300 hover:underline text-left"
                >
                  {isTestingLidarr ? 'Testing...' : 'Test Lidarr →'}
                </button>
              </div>

              {/* ListenBrainz status */}
              <div
                className={`p-3 rounded-xl border flex flex-col justify-between gap-1.5 ${
                  listenbrainzTestStatus?.ok
                    ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
                    : listenbrainzTestStatus && !listenbrainzTestStatus.ok
                      ? 'border-rose-500/60 bg-rose-950/30 text-rose-300'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-300'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-mono font-bold uppercase text-zinc-300">
                    ListenBrainz
                  </span>
                  {listenbrainzTestStatus?.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : listenbrainzTestStatus && !listenbrainzTestStatus.ok ? (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                  ) : (
                    <Radio className="w-3.5 h-3.5 text-zinc-500" />
                  )}
                </div>
                <p className="text-[11px] font-mono truncate">
                  {listenbrainzTestStatus?.message ||
                    (serverIntegrations.listenbrainzUsername
                      ? 'Untested'
                      : 'Not configured')}
                </p>
                <button
                  type="button"
                  disabled={isTestingListenbrainz}
                  onClick={handleTestListenbrainz}
                  data-testid="matrix-test-listenbrainz-btn"
                  className="mt-1 text-[10px] font-mono font-bold text-purple-300 hover:underline text-left"
                >
                  {isTestingListenbrainz ? 'Testing...' : 'Test ListenBrainz →'}
                </button>
              </div>

              {/* Storage write check */}
              <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-950/15 text-emerald-300 flex flex-col justify-between gap-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-mono font-bold uppercase text-zinc-300">
                    Server Storage
                  </span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <p className="text-[11px] font-mono truncate">
                  {serverConfigPath} (Persistent)
                </p>
                <span className="mt-1 text-[10px] font-mono text-zinc-400">
                  Port 3487 active
                </span>
              </div>
            </div>

            {/* LOUD WARNING BANNER IF SLSKD FAILED */}
            {slskdTestStatus && !slskdTestStatus.ok && (
              <div
                role="alert"
                className="rounded-xl border-2 border-rose-500 bg-rose-950/90 p-4 space-y-2.5 animate-pulse shadow-xl"
              >
                <div className="flex items-center gap-2.5 text-rose-200 font-mono font-bold text-sm uppercase">
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                  <span>🚨 CONNECTION ALERT: SLSKD UNREACHABLE!</span>
                </div>
                <div className="text-xs font-mono text-white space-y-1.5">
                  <div>
                    <p>
                      • <strong className="text-rose-300">slskd Soulseek Engine:</strong>{' '}
                      {slskdTestStatus.message}
                    </p>
                    {slskdTestStatus.hint && (
                      <p className="text-amber-300 font-semibold bg-black/50 p-2 rounded border border-amber-500/30 mt-1">
                        💡 {slskdTestStatus.hint}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. slskd Configuration Card */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <span className="text-xs font-mono font-bold uppercase text-[#00ff66] block">
                    1. slskd Downloader (Soulseek P2P FLAC / 320k MP3)
                  </span>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Connects Brokeify to your <code className="text-white">slskd</code>{' '}
                    container so clicking &ldquo;Grab Album&rdquo; or &ldquo;Grab
                    Missing&rdquo; downloads high-bitrate audio straight to your
                    server.
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={isTestingSlskd}
                    onClick={handleTestSlskd}
                    data-testid="test-slskd-btn"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-2.5 py-1.5 text-[11px] font-mono font-bold text-[#00ff66] transition-colors shrink-0"
                  >
                    {isTestingSlskd ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>Test slskd</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSavingConfigFile}
                    onClick={() => handleSaveCard('slskd')}
                    data-testid="save-slskd-btn"
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 px-2.5 py-1.5 text-[11px] font-mono font-bold text-zinc-950 transition-colors shrink-0"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs text-zinc-300">
                      slskd Internal Docker / LAN URL
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateServerIntegrations({
                          ...serverIntegrations,
                          slskdUrl: 'http://slskd:5030',
                        })
                      }
                      className="text-[10px] font-mono text-[#00ff66] hover:underline"
                    >
                      Use Docker Service URL (http://slskd:5030)
                    </button>
                  </div>
                  <input
                    type="text"
                    value={serverIntegrations.slskdUrl ?? ''}
                    onChange={(e) =>
                      onUpdateServerIntegrations({
                        ...serverIntegrations,
                        slskdUrl: e.target.value,
                      })
                    }
                    placeholder="http://slskd:5030 or http://192.168.1.100:5030"
                    data-testid="input-slskd-url"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-zinc-300 mb-1">
                    slskd API Key (X-API-Key)
                  </label>
                  <input
                    type="password"
                    value={serverIntegrations.slskdApiKey ?? ''}
                    onChange={(e) =>
                      onUpdateServerIntegrations({
                        ...serverIntegrations,
                        slskdApiKey: e.target.value,
                      })
                    }
                    placeholder="Enter slskd API key..."
                    data-testid="input-slskd-apikey"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                  />
                </div>
              </div>

              {savedCardFeedback['slskd'] && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-2.5 py-1.5 text-[11px] font-mono text-emerald-300 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>{savedCardFeedback['slskd']}</span>
                </div>
              )}

              {slskdTestStatus && (
                <div
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-mono space-y-1 ${
                    slskdTestStatus.ok
                      ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                      : 'border-rose-500/50 bg-rose-950/40 text-rose-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    {slskdTestStatus.ok ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    )}
                    <span>{slskdTestStatus.message}</span>
                  </div>
                  {slskdTestStatus.hint && (
                    <p className="text-[10px] text-amber-300 leading-normal bg-black/40 p-1.5 rounded">
                      💡 {slskdTestStatus.hint}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 2. Lidarr Automated Music Manager Card */}
            <div
              data-testid="lidarr-config-card"
              className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <span className="text-xs font-mono font-bold uppercase text-amber-300 block">
                    2. Lidarr Automated Music Manager (Arr Stack)
                  </span>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Connects to <code className="text-white">Lidarr</code> so
                    Brokeify can add monitored artists/albums and trigger
                    indexer searches directly in your Arr stack.
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={isTestingLidarr}
                    onClick={async () => {
                      setIsTestingLidarr(true);
                      setLidarrTestStatus(null);
                      try {
                        const resp = await fetch('/api/lidarr/test', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            lidarrUrl: serverIntegrations.lidarrUrl,
                            lidarrApiKey: serverIntegrations.lidarrApiKey,
                          }),
                        });
                        const data = await resp.json();
                        if (resp.ok && data.ok) {
                          setLidarrTestStatus({
                            ok: true,
                            message: data.message || 'Connected to Lidarr!',
                            hint: data.hint,
                          });
                          if (data.rootFolderPath) {
                            onUpdateServerIntegrations({
                              ...serverIntegrations,
                              lidarrRootFolderPath: data.rootFolderPath,
                              lidarrQualityProfileId:
                                data.qualityProfileId ||
                                serverIntegrations.lidarrQualityProfileId ||
                                1,
                              lidarrMetadataProfileId:
                                data.metadataProfileId ||
                                serverIntegrations.lidarrMetadataProfileId ||
                                1,
                            });
                          }
                        } else {
                          setLidarrTestStatus({
                            ok: false,
                            message:
                              data.error || 'Could not connect to Lidarr.',
                            hint: data.hint,
                          });
                        }
                      } catch {
                        setLidarrTestStatus({
                          ok: false,
                          message: 'Network error testing Lidarr.',
                        });
                      } finally {
                        setIsTestingLidarr(false);
                      }
                    }}
                    data-testid="test-lidarr-btn"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 px-2.5 py-1.5 text-[11px] font-mono font-bold text-amber-300 transition-colors shrink-0"
                  >
                    {isTestingLidarr ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>Test Lidarr</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSavingConfigFile}
                    onClick={() => handleSaveCard('lidarr')}
                    data-testid="save-lidarr-btn"
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-500 hover:bg-amber-400 px-2.5 py-1.5 text-[11px] font-mono font-bold text-zinc-950 transition-colors shrink-0"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">
                    Lidarr Internal Docker / LAN URL
                  </label>
                  <input
                    type="text"
                    value={serverIntegrations.lidarrUrl ?? 'http://lidarr:8686'}
                    onChange={(e) =>
                      onUpdateServerIntegrations({
                        ...serverIntegrations,
                        lidarrUrl: e.target.value,
                      })
                    }
                    placeholder="http://lidarr:8686 or http://192.168.1.x:8686"
                    data-testid="input-lidarr-url"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-zinc-300 mb-1">
                    Lidarr Root Folder Path
                  </label>
                  <input
                    type="text"
                    value={serverIntegrations.lidarrRootFolderPath ?? '/music'}
                    onChange={(e) =>
                      onUpdateServerIntegrations({
                        ...serverIntegrations,
                        lidarrRootFolderPath: e.target.value,
                      })
                    }
                    placeholder="/music"
                    data-testid="input-lidarr-root-folder"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs text-zinc-300 mb-1">
                    Lidarr API Key (Settings &rarr; General &rarr; Security)
                  </label>
                  <input
                    type="password"
                    value={serverIntegrations.lidarrApiKey ?? ''}
                    onChange={(e) =>
                      onUpdateServerIntegrations({
                        ...serverIntegrations,
                        lidarrApiKey: e.target.value,
                      })
                    }
                    placeholder="Enter 32-character Lidarr API key..."
                    data-testid="input-lidarr-apikey"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                  />
                </div>
              </div>

              {savedCardFeedback['lidarr'] && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-2.5 py-1.5 text-[11px] font-mono text-amber-300 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>{savedCardFeedback['lidarr']}</span>
                </div>
              )}

              {lidarrTestStatus && (
                <div
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-mono ${
                    lidarrTestStatus.ok
                      ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                      : 'border-rose-500/40 bg-rose-950/30 text-rose-300'
                  }`}
                >
                  {lidarrTestStatus.message}
                </div>
              )}
            </div>

            {/* 3. YouTube Music & Multi-Source Downloader Card */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <span className="text-xs font-mono font-bold uppercase text-rose-300 block">
                    3. YouTube Music &amp; Multi-Downloader Priority
                  </span>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Choose which download engine Brokeify uses by default: Auto
                    waterfall (<code className="text-white">slskd</code> &rarr;{' '}
                    <code className="text-white">Lidarr</code> &rarr;{' '}
                    <code className="text-white">YouTube Music</code>) or a
                    specific engine.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isSavingConfigFile}
                  onClick={() => handleSaveCard('youtube')}
                  data-testid="save-downloader-priority-btn"
                  className="inline-flex items-center gap-1 rounded-lg bg-rose-500 hover:bg-rose-400 px-2.5 py-1.5 text-[11px] font-mono font-bold text-zinc-950 transition-colors shrink-0"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save</span>
                </button>
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">
                    Default Downloader Mode
                  </label>
                  <select
                    value={serverIntegrations.preferredDownloader || 'auto'}
                    onChange={(e) =>
                      onUpdateServerIntegrations({
                        ...serverIntegrations,
                        preferredDownloader: e.target.value as
                          | 'auto'
                          | 'slskd'
                          | 'lidarr'
                          | 'youtube'
                          | 'archive',
                      })
                    }
                    data-testid="settings-preferred-downloader"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                  >
                    <option value="auto">
                      Auto Waterfall (slskd → Lidarr → YouTube Music)
                    </option>
                    <option value="slskd">slskd Only (Soulseek P2P)</option>
                    <option value="lidarr">
                      Lidarr Only (Automated Indexers)
                    </option>
                    <option value="youtube">YouTube Music Only (yt-dlp)</option>
                    <option value="archive">Internet Archive Only</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-zinc-300 mb-1">
                    Server Music Download Folder
                  </label>
                  <input
                    type="text"
                    value={
                      serverIntegrations.downloadDir || '/app/downloads'
                    }
                    onChange={(e) =>
                      onUpdateServerIntegrations({
                        ...serverIntegrations,
                        downloadDir: e.target.value,
                      })
                    }
                    placeholder="/app/downloads"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                  />
                </div>
              </div>

              {savedCardFeedback['youtube'] && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-2.5 py-1.5 text-[11px] font-mono text-rose-300 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>{savedCardFeedback['youtube']}</span>
                </div>
              )}
            </div>

            {/* 4. ListenBrainz Configuration Card */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <span className="text-xs font-mono font-bold uppercase text-purple-300 block">
                    4. ListenBrainz Mixes &amp; Auto-Scrobbler
                  </span>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Pulls your personal Weekly Exploration &amp; Weekly Jams
                    playlists and records every song you listen to so your
                    recommendations keep getting better.
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={isTestingListenbrainz}
                    onClick={handleTestListenbrainz}
                    data-testid="test-listenbrainz-btn"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/15 hover:bg-purple-500/25 px-2.5 py-1.5 text-[11px] font-mono font-bold text-purple-300 transition-colors shrink-0"
                  >
                    {isTestingListenbrainz ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>Test ListenBrainz</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSavingConfigFile}
                    onClick={() => handleSaveCard('listenbrainz')}
                    data-testid="save-listenbrainz-btn"
                    className="inline-flex items-center gap-1 rounded-lg bg-purple-600 hover:bg-purple-500 px-2.5 py-1.5 text-[11px] font-mono font-bold text-white transition-colors shrink-0"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">
                    ListenBrainz Username
                  </label>
                  <input
                    type="text"
                    value={serverIntegrations.listenbrainzUsername ?? ''}
                    onChange={(e) =>
                      onUpdateServerIntegrations({
                        ...serverIntegrations,
                        listenbrainzUsername: e.target.value,
                      })
                    }
                    placeholder="your-listenbrainz-username"
                    data-testid="input-listenbrainz-username"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-zinc-300 mb-1">
                    ListenBrainz User Token (for Scrobbling)
                  </label>
                  <input
                    type="password"
                    value={serverIntegrations.listenbrainzToken ?? ''}
                    onChange={(e) =>
                      onUpdateServerIntegrations({
                        ...serverIntegrations,
                        listenbrainzToken: e.target.value,
                      })
                    }
                    placeholder="Enter ListenBrainz User Token..."
                    data-testid="input-listenbrainz-token"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                  />
                </div>
              </div>

              {savedCardFeedback['listenbrainz'] && (
                <div className="rounded-lg border border-purple-500/40 bg-purple-950/30 px-2.5 py-1.5 text-[11px] font-mono text-purple-300 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>{savedCardFeedback['listenbrainz']}</span>
                </div>
              )}

              {listenbrainzTestStatus && (
                <div
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-mono ${
                    listenbrainzTestStatus.ok
                      ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                      : 'border-rose-500/40 bg-rose-950/30 text-rose-300'
                  }`}
                >
                  {listenbrainzTestStatus.message}
                </div>
              )}
            </div>

            {/* 5. Acoustic Fingerprinting (AcoustID + MusicBrainz + Cover Art Archive) & Automated Staging Inbox Organizer */}
            <div
              data-testid="acoustid-staging-organizer-card"
              className="lg:col-span-2 rounded-2xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-zinc-950 to-indigo-950/30 p-4 sm:p-5 space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-mono font-bold text-[#00ff66] uppercase tracking-wider flex items-center gap-2">
                    <span>
                      5. Acoustic Fingerprinting (fpcalc + AcoustID + MusicBrainz) &amp; Staging Inbox Auto-Organizer
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 max-w-3xl">
                    Automatically fingerprints incoming downloads from{' '}
                    <code>slskd</code> and <code>yt-dlp</code> using{' '}
                    <code>fpcalc</code> + AcoustID, queries MusicBrainz (strictly
                    throttled to 1 req/sec) + Cover Art Archive for high-res
                    front-500 artwork, and moves clean files from your Staging
                    Inbox into{' '}
                    <code className="text-[#00ff66]">
                      /music/&#123;Artist&#125;/&#123;Album&#125; (&#123;Year&#125;)/&#123;TrackNumber&#125; - &#123;Title&#125;.&#123;ext&#125;
                    </code>
                    .
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const resp = await fetch('/api/staging/scan', {
                          method: 'POST',
                        });
                        const data = await resp.json();
                        if (resp.ok && data?.ok) {
                          showSavedCard(
                            'acoustid',
                            `Scanned Staging Inbox: organized ${data.organizedCount || 0} track(s)`
                          );
                        }
                      } catch {
                        // ignore
                      }
                    }}
                    data-testid="btn-scan-staging-inbox-now"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-3 py-1.5 text-[11px] font-mono font-bold text-[#00ff66] transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Scan &amp; Organize Inbox Now</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSavingConfigFile}
                    onClick={() => handleSaveCard('acoustid')}
                    data-testid="save-acoustid-staging-btn"
                    className="inline-flex items-center gap-1 rounded-lg bg-[#00ff66] hover:bg-emerald-400 px-3 py-1.5 text-[11px] font-mono font-bold text-zinc-950 transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                {/* AcoustID API Key */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs text-zinc-300">
                      AcoustID API Key (<code>ACOUSTID_API_KEY</code>)
                    </label>
                    <a
                      href="https://acoustid.org/new-application"
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="link-register-acoustid-key"
                      className="text-[11px] font-mono text-[#00ff66] hover:underline"
                    >
                      Get Free Key at acoustid.org ↗
                    </a>
                  </div>
                  <input
                    type="password"
                    value={serverIntegrations.acoustidApiKey ?? ''}
                    onChange={(e) =>
                      onUpdateServerIntegrations({
                        ...serverIntegrations,
                        acoustidApiKey: e.target.value,
                      })
                    }
                    placeholder="Optional free key from acoustid.org..."
                    data-testid="input-acoustid-api-key"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                  />
                  <p className="text-[10px] font-mono text-zinc-500">
                    Identifies real audio waveforms via <code>fpcalc</code> even
                    when filenames are wrong or missing tags.
                  </p>
                </div>

                {/* Staging / Inbox Folder Path */}
                <div className="space-y-1">
                  <label className="block text-xs text-zinc-300">
                    Staging / Inbox Folder Path
                  </label>
                  <input
                    type="text"
                    value={serverIntegrations.stagingDir ?? '/music/_inbox'}
                    onChange={(e) =>
                      onUpdateServerIntegrations({
                        ...serverIntegrations,
                        stagingDir: e.target.value,
                      })
                    }
                    placeholder="/music/_inbox or /downloads"
                    data-testid="input-staging-dir"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                  />
                  <p className="text-[10px] font-mono text-zinc-500">
                    Incoming downloads land here first before being tagged &amp;
                    moved into <code>/music</code>.
                  </p>
                </div>

                {/* Auto-Organize Incoming Downloads Toggle */}
                <div className="space-y-1 flex flex-col justify-between">
                  <label className="block text-xs text-zinc-300">
                    Auto-Organize Incoming Downloads
                  </label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={
                      serverIntegrations.autoOrganizeDownloads !== false
                    }
                    data-testid="toggle-auto-organize-downloads"
                    onClick={() =>
                      onUpdateServerIntegrations({
                        ...serverIntegrations,
                        autoOrganizeDownloads:
                          serverIntegrations.autoOrganizeDownloads === false,
                      })
                    }
                    className={`w-full rounded-xl border px-3 py-2 text-xs font-mono font-bold flex items-center justify-between transition-colors ${
                      serverIntegrations.autoOrganizeDownloads !== false
                        ? 'border-[#00ff66]/60 bg-[#00ff66]/15 text-[#00ff66]'
                        : 'border-zinc-700 bg-zinc-900 text-zinc-400'
                    }`}
                  >
                    <span>
                      {serverIntegrations.autoOrganizeDownloads !== false
                        ? 'ON — Fingerprint, Tag & Move to /music'
                        : 'OFF — Keep in Raw Download Folder'}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] ${
                        serverIntegrations.autoOrganizeDownloads !== false
                          ? 'bg-[#00ff66] text-zinc-950'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {serverIntegrations.autoOrganizeDownloads !== false
                        ? 'ENABLED'
                        : 'DISABLED'}
                    </span>
                  </button>
                  <p className="text-[10px] font-mono text-zinc-500">
                    Cleans up empty leftover folders automatically after moving.
                  </p>
                </div>
              </div>

              {/* Established Library Full Organizer & Tag Cleaner Sub-Panel */}
              <div
                data-testid="established-library-organizer-panel"
                className="pt-4 border-t border-emerald-500/30 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-mono font-bold text-white flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-[#00ff66]" />
                      <span>Clean Up Established &amp; Disorganized Library (/music)</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 max-w-2xl">
                      Already have an established or disorganized music collection?
                      Fingerprints every audio file via <code>fpcalc</code> + AcoustID, queries MusicBrainz for official Title, Artist, Album, Year, and MBID, downloads high-res artwork from Cover Art Archive, embeds clean ID3/FLAC tags via <code>ffmpeg</code>, and relocates tracks into standard <code>/music/&#123;Artist&#125;/&#123;Album&#125; (&#123;Year&#125;)/&#123;TrackNumber&#125; - &#123;Title&#125;.&#123;ext&#125;</code> while pruning empty leftover folders.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={
                        organizeJob?.status === 'running' ||
                        organizeJob?.status === 'scanning'
                      }
                      onClick={() => handleStartLibraryOrganize(true)}
                      data-testid="btn-preview-library-organize"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 px-3 py-1.5 text-xs font-mono font-bold text-zinc-200 transition-colors"
                    >
                      <Search className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Dry-Run Preview</span>
                    </button>

                    <button
                      type="button"
                      disabled={
                        organizeJob?.status === 'running' ||
                        organizeJob?.status === 'scanning'
                      }
                      onClick={() => handleStartLibraryOrganize(false)}
                      data-testid="btn-start-library-organize-now"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-50 px-3.5 py-1.5 text-xs font-mono font-bold text-zinc-950 transition-colors shadow-md"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      <span>Clean Up Entire Library Now</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-zinc-300">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={organizeRecursive}
                      onChange={(e) => setOrganizeRecursive(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-900 text-[#00ff66] focus:ring-0"
                    />
                    <span>Include all subfolders recursively</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={organizeSkipOrganized}
                      onChange={(e) => setOrganizeSkipOrganized(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-900 text-[#00ff66] focus:ring-0"
                    />
                    <span>Skip files already in Artist/Album format</span>
                  </label>
                </div>

                {/* Live Progress Card in Settings */}
                {organizeJob &&
                  (organizeJob.status === 'running' ||
                    organizeJob.status === 'scanning') && (
                    <div
                      data-testid="settings-organize-progress"
                      className="p-3.5 rounded-xl border border-[#00ff66]/50 bg-black/60 space-y-2.5"
                    >
                      <div className="flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 text-[#00ff66] animate-spin" />
                          <span className="font-bold text-white">
                            {organizeJob.dryRun
                              ? 'Previewing Library Organization...'
                              : 'Cleaning & Organizing Library...'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[#00ff66] font-bold">
                            {organizeJob.processedFiles} / {organizeJob.totalFiles} tracks (
                            {organizeJob.totalFiles > 0
                              ? Math.round(
                                  (organizeJob.processedFiles /
                                    organizeJob.totalFiles) *
                                    100
                                )
                              : 0}
                            %)
                          </span>
                          <button
                            type="button"
                            onClick={handleCancelLibraryOrganize}
                            className="px-2 py-0.5 rounded border border-rose-500/40 bg-rose-950/40 text-rose-300 text-[10px] font-bold"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>

                      <div className="w-full bg-zinc-900 rounded-full h-2 overflow-hidden border border-zinc-800">
                        <div
                          className="bg-gradient-to-r from-[#00ff66] to-emerald-400 h-2 rounded-full transition-all duration-300"
                          style={{
                            width: `${
                              organizeJob.totalFiles > 0
                                ? Math.min(
                                    100,
                                    Math.round(
                                      (organizeJob.processedFiles /
                                        organizeJob.totalFiles) *
                                        100
                                    )
                                  )
                                : 5
                            }%`,
                          }}
                        />
                      </div>

                      <div className="text-[11px] font-mono text-zinc-400 truncate">
                        {organizeJob.currentTrackTitle ? (
                          <span>
                            Processing:{' '}
                            <strong className="text-zinc-200">
                              {organizeJob.currentTrackTitle}
                            </strong>{' '}
                            — {organizeJob.currentTrackArtist}
                          </span>
                        ) : (
                          <span>{organizeJob.currentFile || 'Scanning...'}</span>
                        )}
                      </div>
                    </div>
                  )}

                {/* Preview Ready in Settings */}
                {organizeJob &&
                  organizeJob.status === 'preview_ready' &&
                  organizeJob.items.length > 0 && (
                    <div
                      data-testid="settings-organize-preview-ready"
                      className="p-3.5 rounded-xl border border-purple-500/50 bg-purple-950/20 flex flex-wrap items-center justify-between gap-3 text-xs font-mono"
                    >
                      <div className="flex items-center gap-2 text-purple-200">
                        <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
                        <span>
                          Preview ready: <strong>{organizeJob.items.length}</strong>{' '}
                          tracks fingerprinted &amp; mapped to standard /music paths.
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleApplyLibraryOrganize}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#00ff66] hover:bg-emerald-400 px-3 py-1 text-xs font-bold text-zinc-950 shadow-md"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Apply to Library Disk</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setOrganizeJob(null)}
                          className="px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
              </div>

              {savedCardFeedback['acoustid'] && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-2.5 py-1.5 text-[11px] font-mono text-[#00ff66] flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>{savedCardFeedback['acoustid']}</span>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Section 1: Connect Android App (6-Digit Quick Connect, High-Contrast QR Code, Auto-Detected Browser URL) */}
      {showAndroid && <ConnectAndroidAppSection />}

      {/* Section 1B: Public Domain Security Gate, Friends & Family Accounts & Anti-Bot Shield */}
      {showSecurity && (
        <SecurityAndUsersManagerSection
          currentUser={currentUser || null}
          requireLogin={Boolean(requireLogin)}
          onAuthConfigChanged={(next) => {
            if (onAuthConfigChanged) onAuthConfigChanged(next);
          }}
          onLockAndSignOut={() => {
            if (onLockAndSignOut) onLockAndSignOut();
          }}
          onShowToast={(msg) => {
            if (onShowToast) onShowToast(msg);
            else showSavedCard('top', msg);
          }}
        />
      )}

      {/* Section 2: Disk-Backed Artwork Cache & Browser Storage Persistence */}
      {showStorage && (
      <section
        aria-labelledby="artwork-cache-heading"
        className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-5 sm:p-6 space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 space-y-1">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Persistent Browser Storage Lock</span>
            </div>
            <p
              className="text-zinc-400 font-mono"
              data-testid="storage-persist-status"
            >
              {storagePersistStatus.message}
            </p>
          </div>

          <div
            data-testid="artwork-cache-status-card"
            className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 space-y-2 flex flex-col justify-between"
          >
            <div className="space-y-1">
              <div className="font-semibold text-white flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-[#00ff66] shrink-0" />
                  <span>Disk-Backed Artwork Cache</span>
                </div>
                <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-500/30">
                  IndexedDB
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-tight">
                Stored in <code className="text-[#00ff66]">{ARTWORK_CACHE_DB_NAME}</code> for instant scrolling without repeated network queries.
              </p>
              <div className="text-xs font-mono text-[#00ff66] pt-1">
                {artworkStats.count} covers cached ({artworkStats.totalSizeBytes > 0 ? (artworkStats.totalSizeBytes / (1024 * 1024)).toFixed(1) + ' MB' : '0 KB'})
              </div>
            </div>

            <button
              type="button"
              disabled={isClearingArtwork || artworkStats.count === 0}
              onClick={async () => {
                setIsClearingArtwork(true);
                try {
                  await clearArtworkCache();
                  await refreshArtworkStats();
                  showSavedCard('top', 'Artwork cache purged successfully!');
                } finally {
                  setIsClearingArtwork(false);
                }
              }}
              data-testid="clear-artwork-cache-btn"
              className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-40 px-3 py-1.5 text-[11px] font-mono font-semibold text-zinc-300 transition-colors w-full"
            >
              {isClearingArtwork ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>Purge Artwork Cache</span>
            </button>
          </div>
        </div>
      </section>
      )}
    </div>
  );
};
