import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  Cloud,
  CloudDownload,
  CloudUpload,
  Database,
  Eye,
  EyeOff,
  HardDrive,
  Loader2,
  Lock,
  LogOut,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import type {
  BrokeifyCloudSettings,
  BrokeifyServerIntegrations,
  CloudSyncStatus,
  Playlist,
  ProviderConfig,
  ProviderType,
  Track,
} from '../types/music';
import { MusicProviderManager } from '../services/MusicProviderManager';
import { buildJellyfinDisplayPrefsUrl } from '../utils/musicLogic';
import {
  ARTWORK_CACHE_DB_NAME,
  clearArtworkCache,
  getArtworkCacheStats,
} from '../utils/artworkCache';
import { PWAInstallButton } from './PWAInstallButton';
import { SlidingToggle } from './SlidingToggle';
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
}

const RADIO_TAGS = [
  'rock',
  'synthwave',
  'electronic',
  'jazz',
  'metal',
  'ambient',
] as const;

export const SourcesHubView: React.FC<SourcesHubViewProps> = ({
  providers,
  onUpdateProviders,
  onMergeRemoteTracks,
  onMergeRemotePlaylists,
  storagePersistStatus,
  cloudSyncStatus,
  onPushCloudSettings,
  onPullCloudSettings,
  onApplyRestoredCloudSettings,
  onOpenOnboardingModal,
  onLogoutProvider,
  serverIntegrations,
  serverConfigPath = '/app/data/config.json',
  onUpdateServerIntegrations,
  onSaveServerConfigNow,
  onLockDeviceForLogin,
}) => {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [selectedRadioTag, setSelectedRadioTag] = useState<string>('rock');
  const [fetchingCloudSource, setFetchingCloudSource] = useState<string | null>(
    null
  );
  const [showAddSourcePicker, setShowAddSourcePicker] =
    useState<boolean>(false);
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>(
    {}
  );
  const [confirmingLogoutType, setConfirmingLogoutType] =
    useState<ProviderType | null>(null);
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

  const [isTestingJellyfin, setIsTestingJellyfin] = useState<boolean>(false);
  const [jellyfinTestStatus, setJellyfinTestStatus] = useState<{
    ok: boolean;
    message: string;
    hint?: string;
    serverName?: string;
    version?: string;
  } | null>(null);

  const [isTestingListenbrainz, setIsTestingListenbrainz] =
    useState<boolean>(false);
  const [listenbrainzTestStatus, setListenbrainzTestStatus] = useState<{
    ok: boolean;
    message: string;
    tokenValid?: boolean;
  } | null>(null);

  const [isTestingAll, setIsTestingAll] = useState<boolean>(false);
  const [allServicesResult, setAllServicesResult] = useState<{
    ok: boolean;
    services: {
      jellyfin: { ok: boolean; message: string; hint?: string };
      slskd: { ok: boolean; message: string; hint?: string };
      lidarr: { ok: boolean; message: string; hint?: string };
      listenbrainz: { ok: boolean; message: string };
      storage: { ok: boolean; message: string };
    };
  } | null>(null);

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

  const jellyfinProvider =
    providers.find((p) => p.type === 'jellyfin') || providers[0];

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

  const handleTestJellyfin = async (prov?: ProviderConfig) => {
    const targetProv = prov || jellyfinProvider;
    setIsTestingJellyfin(true);
    setJellyfinTestStatus(null);
    try {
      const resp = await fetch('/api/jellyfin/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverUrl: targetProv?.serverUrl,
          token: targetProv?.token,
          username: targetProv?.username,
          password: targetProv?.password,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        setJellyfinTestStatus({
          ok: true,
          message: data.message || 'Connected to Jellyfin!',
          serverName: data.serverName,
          version: data.serverVersion,
        });
      } else {
        setJellyfinTestStatus({
          ok: false,
          message: data.error || 'Connection failed to Jellyfin.',
          hint: data.hint,
        });
      }
    } catch {
      setJellyfinTestStatus({
        ok: false,
        message: 'Network error testing Jellyfin connection.',
        hint: 'Ensure port 8096 is reachable from this Docker container.',
      });
    } finally {
      setIsTestingJellyfin(false);
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
    setAllServicesResult(null);
    try {
      const resp = await fetch('/api/services/test-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jellyfin: {
            jellyfinUrl: jellyfinProvider?.serverUrl,
            jellyfinToken: jellyfinProvider?.token,
          },
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
        setAllServicesResult(data);
        if (data.services.jellyfin) {
          setJellyfinTestStatus(data.services.jellyfin);
        }
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
    } catch {
      // ignore
    } finally {
      setIsTestingAll(false);
    }
  };

  const jellyfinDisplayPrefsEndpoint = jellyfinProvider?.serverUrl?.trim()
    ? buildJellyfinDisplayPrefsUrl(
        jellyfinProvider.serverUrl,
        jellyfinProvider.userId || jellyfinProvider.username || 'admin',
        jellyfinProvider.token
      )
    : '/DisplayPreferences/brokeify?client=Brokeify';

  const handleFieldChange = (
    id: string,
    field: keyof ProviderConfig,
    value: string | boolean
  ) => {
    const next = providers.map((p) =>
      p.id === id ? { ...p, [field]: value } : p
    );
    onUpdateProviders(next);
  };

  const handleSecretChange = (prov: ProviderConfig, rawValue: string) => {
    const next = providers.map((p) => {
      if (p.id !== prov.id) return p;
      if (p.type === 'plex') {
        return { ...p, token: rawValue, password: rawValue };
      }
      return {
        ...p,
        password: rawValue,
        token: '',
        authMode: 'password' as const,
      };
    });
    onUpdateProviders(next);
  };

  const handleClearSecret = (prov: ProviderConfig) => {
    if (prov.type === 'jellyfin') {
      try {
        localStorage.removeItem('jellyfin_token');
        localStorage.removeItem('jellyfin_user_id');
      } catch {
        // ignore
      }
    }
    const next = providers.map((p) =>
      p.id === prov.id
        ? {
            ...p,
            password: '',
            token: '',
            userId: '',
            status: 'disconnected' as const,
            diagnosticLog: 'Cleared saved credentials from localStorage.',
            lastMessage: 'Cleared saved credentials.',
          }
        : p
    );
    onUpdateProviders(next);
  };

  const toggleSecretVisibility = (id: string) => {
    setVisibleSecrets((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleActivateHiddenSource = (provId: string) => {
    const next = providers.map((p) =>
      p.id === provId ? { ...p, enabled: true } : p
    );
    onUpdateProviders(next);
  };

  const handleTestAndSync = async (provider: ProviderConfig) => {
    setTestingId(provider.id);
    try {
      if (provider.type === 'jellyfin' || provider.type === 'emby') {
        const {
          updatedConfig,
          tracks,
          playlists: syncedPlaylists,
          restoredCloudSettings,
        } = await MusicProviderManager.fetchJellyfinMusic(provider);

        // Auto-turn OFF Built-In Demo Tracks once Jellyfin connects with real songs
        const shouldDisableDemo =
          provider.type === 'jellyfin' &&
          updatedConfig.status === 'connected' &&
          tracks.length > 0;

        const updatedList = providers.map((p) => {
          if (p.id === provider.id) return updatedConfig;
          if (shouldDisableDemo && p.type === 'built-in') {
            return {
              ...p,
              enabled: false,
              lastMessage:
                'Auto-disabled so only your real Jellyfin library & playlists appear.',
            };
          }
          return p;
        });

        onUpdateProviders(updatedList);
        if (tracks.length > 0) {
          onMergeRemoteTracks(tracks, provider.name);
        }
        if (syncedPlaylists.length > 0) {
          onMergeRemotePlaylists(syncedPlaylists);
        }

        if (
          provider.type === 'jellyfin' &&
          updatedConfig.status === 'connected'
        ) {
          if (restoredCloudSettings) {
            onApplyRestoredCloudSettings(restoredCloudSettings);
          } else {
            await onPullCloudSettings(updatedConfig);
          }
        }
      } else if (provider.type === 'navidrome') {
        const { updatedConfig, tracks } =
          await MusicProviderManager.connectNavidrome(provider);
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updatedConfig : p))
        );
        if (tracks.length > 0) {
          onMergeRemoteTracks(tracks, provider.name);
        }
      } else if (provider.type === 'plex') {
        const { updatedConfig, tracks } =
          await MusicProviderManager.connectPlex(provider);
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updatedConfig : p))
        );
        if (tracks.length > 0) {
          onMergeRemoteTracks(tracks, provider.name);
        }
      } else if (provider.type === 'radio-browser') {
        const tracks = await MusicProviderManager.fetchRadioBrowserStations(
          selectedRadioTag
        );
        const msg = `✅ Connected! Loaded ${tracks.length} live ${selectedRadioTag.toUpperCase()} stations`;
        const updated: ProviderConfig = {
          ...provider,
          enabled: true,
          status: 'connected',
          lastMessage: msg,
          diagnosticLog: msg,
          trackCount: tracks.length,
        };
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updated : p))
        );
        onMergeRemoteTracks(tracks, `Radio-Browser (${selectedRadioTag})`);
      } else if (provider.type === 'internet-archive') {
        const tracks =
          await MusicProviderManager.fetchInternetArchiveTracks();
        const msg = `✅ Connected! Loaded ${tracks.length} lossless/VBR live concert recordings`;
        const updated: ProviderConfig = {
          ...provider,
          enabled: true,
          status: 'connected',
          lastMessage: msg,
          diagnosticLog: msg,
          trackCount: tracks.length,
        };
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updated : p))
        );
        onMergeRemoteTracks(tracks, 'Internet Archive');
      } else {
        const {
          updatedConfig,
          tracks,
          playlists: syncedPlaylists,
        } = await MusicProviderManager.fetchLocalSqliteLibrary(provider);
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updatedConfig : p))
        );
        if (tracks.length > 0) {
          onMergeRemoteTracks(tracks, provider.name);
        }
        if (syncedPlaylists.length > 0) {
          onMergeRemotePlaylists(syncedPlaylists);
        }
        await refreshSqliteHealth();
      }
    } finally {
      setTestingId(null);
    }
  };

  const handleFetchRadioTag = async (tag: string) => {
    setSelectedRadioTag(tag);
    setFetchingCloudSource('radio');
    try {
      const tracks = await MusicProviderManager.fetchRadioBrowserStations(tag);
      onMergeRemoteTracks(tracks, `Radio-Browser (${tag})`);
    } finally {
      setFetchingCloudSource(null);
    }
  };

  const activeProviders = providers.filter((p) => p.enabled);
  const hiddenProviders = providers.filter((p) => !p.enabled);

  const renderConnectorCard = (prov: ProviderConfig) => {
    const isTesting = testingId === prov.id;
    const isJellyfinOrEmby = prov.type === 'jellyfin' || prov.type === 'emby';
    const isSelfHosted = ['jellyfin', 'emby', 'navidrome', 'plex'].includes(
      prov.type
    );
    const currentSecretValue =
      prov.type === 'plex' ? (prov.token ?? '') : (prov.password ?? '');
    const isShowingSecret = Boolean(visibleSecrets[prov.id]);
    const diagnosticText = prov.diagnosticLog || prov.lastMessage;
    const isConnectedSession =
      prov.status === 'connected' || Boolean(prov.token?.trim());

    return (
      <div
        key={prov.id}
        data-testid={`connector-card-${prov.type}`}
        className="rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-5 sm:p-6 flex flex-col justify-between gap-5 transition-colors"
      >
        <div className="space-y-4">
          {/* Card Header + Sliding Toggle Switch */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-zinc-800/90 flex items-center justify-center shrink-0">
                {prov.type === 'navidrome' ? (
                  <HardDrive className="w-5 h-5 text-emerald-400" />
                ) : prov.type === 'radio-browser' ? (
                  <Radio className="w-5 h-5 text-emerald-400" />
                ) : prov.type === 'internet-archive' ? (
                  <Cloud className="w-5 h-5 text-purple-400" />
                ) : prov.type === 'built-in' ? (
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                ) : (
                  <Server className="w-5 h-5 text-purple-400" />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white truncate">
                  {prov.name}
                </h3>
                <p className="text-xs text-zinc-400 font-mono truncate">
                  {isJellyfinOrEmby
                    ? 'Quick Connect or Username & Password'
                    : prov.type === 'navidrome'
                      ? 'Subsonic REST API v1.16.1'
                      : prov.type === 'plex'
                        ? 'Plex Music Server (X-Plex-Token)'
                        : prov.serverUrl}
                </p>
              </div>
            </div>

            <SlidingToggle
              checked={prov.enabled}
              onChange={(nextChecked) =>
                handleFieldChange(prov.id, 'enabled', nextChecked)
              }
              label={prov.enabled ? 'ON' : 'OFF'}
              ariaLabel={`Enable ${prov.name}`}
              testId={`toggle-provider-${prov.type}`}
            />
          </div>

          {/* Active Session Banner + Quick Connect / Log Out Bar for Jellyfin */}
          {prov.type === 'jellyfin' && (
            <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 text-xs">
                {isConnectedSession ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-zinc-200">
                      Signed in as{' '}
                      <strong className="text-emerald-400">
                        {prov.username || 'Jellyfin User'}
                      </strong>
                    </span>
                  </>
                ) : (
                  <span className="text-zinc-400">
                    Sign in with{' '}
                    <strong className="text-zinc-200">Quick Connect</strong> or
                    enter your Username &amp; Password below.
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {onOpenOnboardingModal && (
                  <button
                    type="button"
                    onClick={onOpenOnboardingModal}
                    data-testid="card-jellyfin-quickconnect-btn"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500 hover:text-zinc-950 border border-emerald-500/40 px-2.5 py-1 text-xs font-bold text-emerald-300 transition-colors"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Quick Connect</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Self-Hosted Server Configuration Fields */}
          {isSelfHosted && (
            <div className="space-y-3.5 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Server URL */}
                <div className="sm:col-span-2">
                  <label
                    htmlFor={`url-${prov.id}`}
                    className="block text-xs font-medium text-zinc-400 mb-1"
                  >
                    Server URL
                  </label>
                  <input
                    id={`url-${prov.id}`}
                    type="url"
                    value={prov.serverUrl ?? ''}
                    onChange={(e) =>
                      handleFieldChange(prov.id, 'serverUrl', e.target.value)
                    }
                    placeholder="https://jellyfin.yourdomain.com"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none font-mono"
                  />
                </div>

                {/* Username */}
                {prov.type !== 'plex' && (
                  <div>
                    <label
                      htmlFor={`user-${prov.id}`}
                      className="block text-xs font-medium text-zinc-400 mb-1"
                    >
                      Username
                    </label>
                    <input
                      id={`user-${prov.id}`}
                      type="text"
                      value={prov.username ?? ''}
                      onChange={(e) =>
                        handleFieldChange(prov.id, 'username', e.target.value)
                      }
                      placeholder="Enter username (e.g., admin)"
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                )}

                {/* Password with Clear (X) and Show/Hide (Eye) buttons */}
                <div className={prov.type === 'plex' ? 'sm:col-span-2' : ''}>
                  <label
                    htmlFor={`token-${prov.id}`}
                    className="block text-xs font-medium text-zinc-400 mb-1"
                  >
                    {prov.type === 'plex'
                      ? 'X-Plex-Token'
                      : 'Password'}
                  </label>
                  <div className="relative flex items-center">
                    <input
                      id={`token-${prov.id}`}
                      type={isShowingSecret ? 'text' : 'password'}
                      value={currentSecretValue}
                      onChange={(e) => handleSecretChange(prov, e.target.value)}
                      placeholder={
                        prov.type === 'plex'
                          ? 'Paste your X-Plex-Token...'
                          : isConnectedSession && !currentSecretValue
                            ? 'Authenticated via Session Token (or enter password)'
                            : 'Enter your password...'
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 pl-3.5 pr-20 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none font-mono"
                    />

                    <div className="absolute right-1.5 flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => handleClearSecret(prov)}
                        aria-label={`Clear saved password for ${prov.name}`}
                        title="Clear password"
                        data-testid={`clear-secret-${prov.type}`}
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-rose-400 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleSecretVisibility(prov.id)}
                        aria-label={
                          isShowingSecret
                            ? `Hide password for ${prov.name}`
                            : `Show password for ${prov.name}`
                        }
                        title={
                          isShowingSecret ? 'Hide password' : 'Show password'
                        }
                        data-testid={`toggle-show-secret-${prov.type}`}
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                      >
                        {isShowingSecret ? (
                          <EyeOff className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Radio-Browser Genre Tags */}
          {prov.type === 'radio-browser' && (
            <div className="pt-1">
              <p className="text-xs text-zinc-400 mb-2">
                Fetch live stations by genre tag:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {RADIO_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleFetchRadioTag(tag)}
                    disabled={fetchingCloudSource === 'radio'}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[36px] ${
                      selectedRadioTag === tag
                        ? 'bg-emerald-500 text-zinc-950 font-semibold'
                        : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-800 hover:text-white'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Row + Live Diagnostic Log */}
        <div className="space-y-3 pt-3 border-t border-zinc-800/60">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-mono text-zinc-400 tabular-nums">
              {prov.trackCount !== undefined && prov.trackCount > 0
                ? `${prov.trackCount} tracks${
                    prov.playlistCount
                      ? ` & ${prov.playlistCount} playlists`
                      : ''
                  } mounted`
                : `Status: ${prov.status.toUpperCase()}`}
            </span>

            <div className="flex flex-wrap items-center gap-2">
              {prov.type === 'jellyfin' && (
                <button
                  type="button"
                  disabled={isTestingJellyfin}
                  onClick={() => handleTestJellyfin(prov)}
                  data-testid="test-jellyfin-connection-btn"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/50 bg-emerald-500/15 hover:bg-emerald-500/25 px-3 py-2 text-xs font-mono font-bold text-[#00ff66] transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                >
                  {isTestingJellyfin ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>Test Connection</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleTestAndSync(prov)}
                disabled={isTesting}
                data-testid={`test-connection-${prov.type}`}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-bold text-zinc-950 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                {isTesting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>
                  {isConnectedSession && !currentSecretValue
                    ? 'Sync Library & Playlists'
                    : 'Connect & Save'}
                </span>
              </button>
            </div>
          </div>

          {/* LOUD JELLYFIN DISCONNECTED WARNING BANNER */}
          {prov.type === 'jellyfin' &&
            ((jellyfinTestStatus && !jellyfinTestStatus.ok) ||
              prov.status === 'error') && (
              <div
                role="alert"
                className="rounded-xl border-2 border-rose-500 bg-rose-950/90 p-4 space-y-2.5 animate-pulse shadow-lg"
              >
                <div className="flex items-center gap-2 text-rose-200 font-mono font-bold text-xs uppercase">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>🚨 JELLYFIN DISCONNECTED // SERVER UNREACHABLE!</span>
                </div>
                <p className="text-xs font-mono text-white leading-relaxed">
                  {jellyfinTestStatus?.message ||
                    diagnosticText ||
                    'Could not connect to Jellyfin.'}
                </p>
                <div className="rounded-lg bg-black/60 p-2.5 text-[11px] font-mono text-amber-300 border border-amber-500/30">
                  <strong>💡 HOMELAB DOCKER FIX:</strong> Inside Docker, router
                  NAT loopback prevents resolving external domain names (e.g.{' '}
                  <code>https://jellyfin.flockingreeds.farm</code>). Use your
                  local LAN IP <code>http://192.168.1.175:8096</code> directly!
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      handleFieldChange(
                        prov.id,
                        'serverUrl',
                        'http://192.168.1.175:8096'
                      );
                      handleTestJellyfin({
                        ...prov,
                        serverUrl: 'http://192.168.1.175:8096',
                      });
                    }}
                    className="rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-3 py-1.5 text-xs font-mono"
                  >
                    Switch URL to http://192.168.1.175:8096 &amp; Re-Test
                  </button>
                  <button
                    type="button"
                    disabled={isTestingJellyfin}
                    onClick={() => handleTestJellyfin(prov)}
                    className="rounded-lg border border-rose-500 bg-rose-900/40 text-rose-200 hover:text-white px-3 py-1.5 text-xs font-mono"
                  >
                    {isTestingJellyfin ? 'Testing...' : 'Re-Test Current URL'}
                  </button>
                </div>
              </div>
            )}

          {/* Live Diagnostic Log Box beneath Connect & Save */}
          <div
            data-testid={`diagnostic-log-${prov.type}`}
            className={`rounded-xl border px-3.5 py-2.5 text-xs font-mono leading-relaxed flex items-start gap-2 ${
              prov.status === 'error'
                ? 'border-rose-500/40 bg-rose-950/30 text-rose-300'
                : prov.status === 'connected'
                  ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-950/80 text-zinc-400'
            }`}
          >
            {prov.status === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            ) : prov.status === 'connected' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <Terminal className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
            )}
            <span className="break-words">{diagnosticText}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* GitHub Repository Version & Update Checker */}
      <VersionChecker />

      {/* Standalone SQLite Music Engine (/data/brokeify.db) + Chokidar /music Scanner + Android Auto REST API */}
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

      {/* Section 0: Persistent Docker Server Storage (/app/data/config.json) + slskd, Lidarr, YouTube Music & ListenBrainz Keys */}
      {serverIntegrations && onUpdateServerIntegrations && (
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
                          slskdUrl: 'http://192.168.1.175:5030',
                        })
                      }
                      className="text-[10px] font-mono text-[#00ff66] hover:underline"
                    >
                      Use Host LAN IP (192.168.1.175:5030)
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
                    placeholder="http://slskd:5030 or http://192.168.1.175:5030"
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
          </div>
        </section>
      )}

      {/* Section 1: Native Android App & Android Auto Camera QR Code Pairing */}
      <section
        aria-labelledby="android-qr-companion-heading"
        data-testid="android-qr-companion-section"
        className="rounded-2xl border border-[#00ff66]/40 bg-zinc-900/40 p-5 sm:p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <Smartphone className="w-5 h-5 text-[#00ff66] shrink-0" />
              <h2
                id="android-qr-companion-heading"
                className="text-lg font-bold text-white tracking-tight font-mono"
              >
                Native Android App &amp; Android Auto Camera QR Pairing
              </h2>
            </div>
            <p className="text-xs text-zinc-400">
              Click the button on the right to open the QR Code Popup. Scan it
              with the camera inside your custom Android app to pair your phone
              with this Docker container and stream music on the go.
            </p>
          </div>

          <div className="shrink-0">
            <PWAInstallButton />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-1.5">
            <span className="text-[#00ff66] font-bold block">
              1. Camera QR Scan Handshake
            </span>
            <p className="text-zinc-400 text-[11px] leading-relaxed">
              Your Android camera scans a single JSON payload containing{' '}
              <code className="text-white">url</code>,{' '}
              <code className="text-white">lanUrl</code>, and{' '}
              <code className="text-white">apiKey</code>, then calls{' '}
              <code className="text-[#00ff66]">POST /api/mobile/verify</code> to
              confirm pairing.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-1.5">
            <span className="text-purple-300 font-bold block">
              2. Library &amp; Playlist Sync API
            </span>
            <p className="text-zinc-400 text-[11px] leading-relaxed">
              Fetch indexed songs from{' '}
              <code className="text-white">GET /api/library/tracks</code>,
              albums from <code className="text-white">GET /api/library/albums</code>,
              and playlists from{' '}
              <code className="text-white">GET /api/playlists</code> (including{' '}
              <code className="text-[#00ff66]">loudnessLufs</code> for ExoPlayer
              volume leveling).
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-1.5">
            <span className="text-sky-300 font-bold block">
              3. HTTP 206 Range Audio &amp; Covers
            </span>
            <p className="text-zinc-400 text-[11px] leading-relaxed">
              Stream lossless FLAC/MP3 with instant seeking via{' '}
              <code className="text-white">GET /api/stream/:trackId</code> and
              cached album covers via{' '}
              <code className="text-white">GET /api/covers/:albumId</code>.
            </p>
          </div>
        </div>
      </section>

      {/* Section 2: Disk-Backed Artwork Cache & Browser Storage Persistence */}
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
    </div>
  );
};
