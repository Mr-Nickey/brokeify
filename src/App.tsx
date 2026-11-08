/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Car,
  Check,
  CheckCircle2,
  ChevronUp,
  Coffee,
  Compass,
  Database,
  Disc,
  Gauge,
  History,
  ListMusic,
  ListPlus,
  Loader2,
  Moon,
  Music,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  Repeat,
  Repeat1,
  RotateCcw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { BrokeifyLogo } from './components/BrokeifyLogo';
import { BuyMeACoffeeModal } from './components/BuyMeACoffeeModal';
import { SlidingToggle } from './components/SlidingToggle';
import { SourcesHubView } from './components/SourcesHubView';
import { SpotifyImporterView } from './components/SpotifyImporterView';
import { AudioLabVaultView } from './components/AudioLabVaultView';
import { RequestDiscoverView } from './components/RequestDiscoverView';
import { CarModeOverlay } from './components/CarModeOverlay';
import { NowPlayingDrawer } from './components/NowPlayingDrawer';
import { BrokeifyOnboardingModal } from './components/BrokeifyOnboardingModal';
import { WinampVisualizer } from './components/WinampVisualizer';
import { useAudioEngine } from './hooks/useAudioEngine';
import { MusicProviderManager } from './services/MusicProviderManager';
import type {
  BrokeifyCloudSettings,
  BrokeifyServerIntegrations,
  CloudSyncStatus,
  Playlist,
  ProviderConfig,
  ProviderType,
  SlskdGrabJob,
  SlskdReadyNotification,
  Track,
} from './types/music';
import {
  dedupeAndSpreadTracks,
  mergePlaylistsPreservingCustomNames,
  mergeProvidersPreservingAuth,
  smartAntiRepeatShuffle,
  VISUAL_THEMES,
} from './utils/musicLogic';
import { preloadTrackToVault } from './utils/offlineVault';
import { createAlbumArtworkDataUri } from './utils/artworkGenerator';

type CoreTab = 'library' | 'discover' | 'nowplaying' | 'settings';
type LibrarySubTab = 'playlists' | 'songs' | 'albums' | 'artists';
type SettingsSectionTab = 'sources' | 'audiolab' | 'spotify';

const PINNED_PLAYLIST_STORAGE_KEY = 'brokeify_pinned_playlist_id_v1';
const RECENT_TRACKS_STORAGE_KEY = 'brokeify_recent_track_ids_v1';

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

const SOURCE_LABELS: Record<ProviderType, string> = {
  jellyfin: 'Jellyfin',
  emby: 'Emby',
  navidrome: 'Navidrome',
  plex: 'Plex',
  'built-in': 'Built-In Demo Tracks',
  'radio-browser': 'Radio-Browser',
  'internet-archive': 'Internet Archive',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<CoreTab>('library');
  const [librarySubTab, setLibrarySubTab] = useState<LibrarySubTab>('playlists');
  const [settingsSubTab, setSettingsSubTab] =
    useState<SettingsSectionTab>('sources');

  const [providers, setProviders] = useState<ProviderConfig[]>(() =>
    MusicProviderManager.loadProviders()
  );
  const [playlists, setPlaylists] = useState<Playlist[]>(() =>
    MusicProviderManager.loadPlaylists()
  );
  const [remoteTracks, setRemoteTracks] = useState<Track[]>(() =>
    MusicProviderManager.loadCachedRemoteTracks()
  );
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    null
  );
  const [pinnedPlaylistId, setPinnedPlaylistId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(PINNED_PLAYLIST_STORAGE_KEY);
      if (
        saved &&
        saved !== 'pl-night-drive' &&
        saved !== 'pl-spite-anthem'
      ) {
        return saved;
      }
      return null;
    } catch {
      return null;
    }
  });
  const [recentTrackIds, setRecentTrackIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_TRACKS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (id) => typeof id === 'string' && !id.startsWith('builtin-')
          );
        }
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [sourceFilter, setSourceFilter] = useState<ProviderType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [offlineOnlyMode, setOfflineOnlyMode] = useState<boolean>(false);
  const [isCarModeOpen, setIsCarModeOpen] = useState<boolean>(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [isBmcModalOpen, setIsBmcModalOpen] = useState<boolean>(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(() =>
    !MusicProviderManager.hasCompletedOnboarding(
      MusicProviderManager.loadProviders()
    )
  );

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Zero-Logout Persistent Storage & Jellyfin Cloud Sync State
  const [storagePersistStatus, setStoragePersistStatus] = useState<{
    persisted: boolean;
    message: string;
  }>({
    persisted: false,
    message: 'Requesting navigator.storage.persist()...',
  });
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>({
    state: 'idle',
    lastSyncedAt: null,
    message: 'Ready to sync with /DisplayPreferences/brokeify?client=Brokeify',
  });

  // One-Tap Offline Playlist Downloader progress state
  const [downloadingPlaylistId, setDownloadingPlaylistId] = useState<
    string | null
  >(null);
  const [downloadProgress, setDownloadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // New Custom Playlist Modal State
  const [showNewPlaylistForm, setShowNewPlaylistForm] = useState<boolean>(false);
  const [newPlaylistName, setNewPlaylistName] = useState<string>('');

  // Playlist Rename State (Custom Display Name + Real Server Name preserved)
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(
    null
  );
  const [editingPlaylistNameInput, setEditingPlaylistNameInput] =
    useState<string>('');

  // Server-Side Persistent Storage (/app/data/config.json) & slskd / ListenBrainz State
  const [serverConfigPath, setServerConfigPath] = useState<string>(
    '/app/data/config.json'
  );
  const [serverIntegrations, setServerIntegrations] =
    useState<BrokeifyServerIntegrations>({
      jellyfinUrl: '',
      jellyfinToken: '',
      jellyfinUserId: '',
      jellyfinUsername: '',
      slskdUrl: 'http://slskd:5030',
      slskdApiKey: '',
      listenbrainzUsername: '',
      listenbrainzToken: '',
    });
  const [slskdJobs, setSlskdJobs] = useState<SlskdGrabJob[]>([]);
  const [readyNotifications, setReadyNotifications] = useState<
    SlskdReadyNotification[]
  >([]);
  const [confirmDeleteTrackId, setConfirmDeleteTrackId] = useState<
    string | null
  >(null);
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null);
  const hasLoadedServerConfigRef = useRef<boolean>(false);
  const scrobbledTrackIdsRef = useRef<Set<string>>(new Set());

  // Sync Jellyfin library helper
  const syncJellyfinProvider = (jfProv: ProviderConfig) => {
    if (
      !jfProv ||
      !jfProv.enabled ||
      !jfProv.serverUrl?.trim() ||
      (!jfProv.token?.trim() && !jfProv.password?.trim())
    ) {
      return;
    }
    MusicProviderManager.fetchJellyfinMusic(jfProv).then(
      ({ updatedConfig, tracks, playlists: syncedPlaylists }) => {
        if (updatedConfig.status === 'connected') {
          setProviders((prev) => {
            const next = prev.map((p) => {
              if (p.id === updatedConfig.id) return updatedConfig;
              if (tracks.length > 0 && p.type === 'built-in') {
                return { ...p, enabled: false };
              }
              return p;
            });
            MusicProviderManager.saveProviders(next);
            return next;
          });
          if (tracks.length > 0) {
            setRemoteTracks((prev) => {
              const map = new Map<string, Track>();
              for (const t of prev) map.set(t.id, t);
              for (const t of tracks) map.set(t.id, t);
              const updated = Array.from(map.values());
              MusicProviderManager.saveCachedRemoteTracks(updated);
              return updated;
            });
          }
          if (syncedPlaylists.length > 0) {
            setPlaylists((prev) => {
              const customNames =
                MusicProviderManager.loadCustomPlaylistNames();
              const updated = mergePlaylistsPreservingCustomNames(
                prev,
                syncedPlaylists,
                customNames
              );
              MusicProviderManager.savePlaylists(updated);
              return updated;
            });
            setPinnedPlaylistId((prevPin) => {
              if (
                !prevPin ||
                prevPin === 'pl-night-drive' ||
                prevPin === 'pl-spite-anthem'
              ) {
                const nextPin = syncedPlaylists[0].id;
                try {
                  localStorage.setItem(PINNED_PLAYLIST_STORAGE_KEY, nextPin);
                } catch {
                  // ignore
                }
                return nextPin;
              }
              return prevPin;
            });
          }
        }
      }
    );
  };

  // Call navigator.storage.persist() on app startup, load /api/config from server, and auto-sync Jellyfin
  useEffect(() => {
    let mounted = true;
    MusicProviderManager.ensurePersistentStorage().then((res) => {
      if (mounted) {
        setStoragePersistStatus(res);
      }
    });

    // 1. Load persistent server-side /api/config (/app/data/config.json) so any device opening Brokeify is logged in immediately
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!mounted || !data?.ok || !data.config) {
          hasLoadedServerConfigRef.current = true;
          const localProvs = MusicProviderManager.loadProviders();
          const jfLocal = localProvs.find((p) => p.type === 'jellyfin');
          if (jfLocal) syncJellyfinProvider(jfLocal);
          return;
        }

        if (data.configPath) {
          setServerConfigPath(data.configPath);
        }
        const srv = data.config;
        if (srv.integrations) {
          setServerIntegrations((prev) => ({
            ...prev,
            ...srv.integrations,
            listenbrainzUsername:
              srv.integrations.listenbrainzUsername || '',
          }));
        }
        if (srv.customPlaylistNames) {
          MusicProviderManager.saveCustomPlaylistNames(srv.customPlaylistNames);
        }
        if (srv.audioPrefs) {
          audio.restoreAudioPreferences(srv.audioPrefs);
        }

        let activeProvs = MusicProviderManager.loadProviders();
        if (Array.isArray(srv.providers) && srv.providers.length > 0) {
          activeProvs = mergeProvidersPreservingAuth(
            activeProvs,
            srv.providers
          );
        }
        // Also hydrate Jellyfin provider from srv.integrations if token is stored there
        if (srv.integrations?.jellyfinUrl && srv.integrations?.jellyfinToken) {
          activeProvs = activeProvs.map((p) =>
            p.type === 'jellyfin'
              ? {
                  ...p,
                  enabled: true,
                  serverUrl: srv.integrations.jellyfinUrl || p.serverUrl,
                  token: srv.integrations.jellyfinToken || p.token,
                  userId: srv.integrations.jellyfinUserId || p.userId,
                  username: srv.integrations.jellyfinUsername || p.username,
                  status: 'connected' as const,
                }
              : p
          );
          setIsOnboardingOpen(false);
        }
        setProviders(activeProvs);
        MusicProviderManager.saveProviders(activeProvs);
        if (MusicProviderManager.hasCompletedOnboarding(activeProvs)) {
          setIsOnboardingOpen(false);
        }

        if (Array.isArray(srv.playlists) && srv.playlists.length > 0) {
          setPlaylists((prev) => {
            const customNames = MusicProviderManager.loadCustomPlaylistNames();
            const merged = mergePlaylistsPreservingCustomNames(
              prev,
              srv.playlists,
              customNames
            );
            MusicProviderManager.savePlaylists(merged);
            return merged;
          });
        }

        hasLoadedServerConfigRef.current = true;
        const jfProv = activeProvs.find((p) => p.type === 'jellyfin');
        if (jfProv) {
          syncJellyfinProvider(jfProv);
        }
      })
      .catch(() => {
        hasLoadedServerConfigRef.current = true;
        const initialProviders = MusicProviderManager.loadProviders();
        const jfProv = initialProviders.find((p) => p.type === 'jellyfin');
        if (jfProv) syncJellyfinProvider(jfProv);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Auto-dismiss toast after 4.5s
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 4500);
    return () => clearTimeout(t);
  }, [toastMessage]);

  // Enabled provider types
  const enabledProviderTypes = useMemo(() => {
    return new Set<ProviderType>(
      providers.filter((p) => p.enabled).map((p) => p.type)
    );
  }, [providers]);

  useEffect(() => {
    if (sourceFilter !== 'all' && !enabledProviderTypes.has(sourceFilter)) {
      setSourceFilter('all');
    }
  }, [enabledProviderTypes, sourceFilter]);

  // Strictly show tracks from enabled sources only (Zero demo tracks)
  const allTracks = useMemo(() => {
    const seen = new Set<string>();
    return remoteTracks.filter((t) => {
      if (!t || t.source === 'built-in' || t.streamUrl.startsWith('synth://')) {
        return false;
      }
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return enabledProviderTypes.has(t.source);
    });
  }, [enabledProviderTypes, remoteTracks]);

  // Filter playlists so only playlists from enabled sources appear
  const visiblePlaylists = useMemo(() => {
    return playlists.filter((pl) => {
      if (
        pl.source === 'built-in' ||
        pl.id === 'pl-night-drive' ||
        pl.id === 'pl-spite-anthem'
      ) {
        return false;
      }
      if (
        pl.source !== 'mixed' &&
        pl.source !== 'spotify-resolved' &&
        !enabledProviderTypes.has(pl.source as ProviderType)
      ) {
        return false;
      }
      return true;
    });
  }, [enabledProviderTypes, playlists]);

  const audio = useAudioEngine(allTracks);

  // Track Recently Played whenever currentTrack changes
  useEffect(() => {
    const currentId = audio.currentTrack?.id;
    if (!currentId) return;
    setRecentTrackIds((prev) => {
      const next = [currentId, ...prev.filter((id) => id !== currentId)].slice(
        0,
        8
      );
      try {
        localStorage.setItem(RECENT_TRACKS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [audio.currentTrack?.id]);

  // Resolved Pinned Favorite Playlist
  const pinnedFavoritePlaylist = useMemo(() => {
    if (!pinnedPlaylistId) return visiblePlaylists[0] || null;
    return (
      visiblePlaylists.find((p) => p.id === pinnedPlaylistId) ||
      visiblePlaylists[0] ||
      null
    );
  }, [pinnedPlaylistId, visiblePlaylists]);

  const handleTogglePinPlaylist = (playlistId: string) => {
    const next = pinnedPlaylistId === playlistId ? '' : playlistId;
    setPinnedPlaylistId(next || null);
    try {
      localStorage.setItem(PINNED_PLAYLIST_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  // Helper to resolve tracks for a playlist
  const getTracksForPlaylist = (pl: Playlist): Track[] => {
    const idSet = new Set(pl.trackIds);
    const matched = allTracks.filter((t) => idSet.has(t.id));
    return matched.length > 0 ? matched : allTracks.slice(0, 6);
  };

  // Start renaming a playlist
  const handleStartRenamePlaylist = (pl: Playlist) => {
    setEditingPlaylistId(pl.id);
    setEditingPlaylistNameInput(pl.name);
  };

  // Save custom playlist name while keeping real originalName intact
  const handleSavePlaylistName = (pl: Playlist) => {
    const trimmed = editingPlaylistNameInput.trim();
    if (!trimmed) return;
    const realName = pl.originalName || pl.name;
    const customNames = MusicProviderManager.loadCustomPlaylistNames();
    if (trimmed === realName) {
      delete customNames[pl.id];
    } else {
      customNames[pl.id] = trimmed;
    }
    MusicProviderManager.saveCustomPlaylistNames(customNames);

    setPlaylists((prev) => {
      const updated = prev.map((item) =>
        item.id === pl.id
          ? {
              ...item,
              name: trimmed,
              originalName: realName,
            }
          : item
      );
      MusicProviderManager.savePlaylists(updated);
      return updated;
    });
    setEditingPlaylistId(null);
    setEditingPlaylistNameInput('');
    setToastMessage(
      trimmed === realName
        ? `Restored playlist real name: "${realName}"`
        : `Renamed playlist to "${trimmed}" (Real name: "${realName}")`
    );
  };

  // Reset playlist back to its real server name
  const handleResetPlaylistName = (pl: Playlist) => {
    const realName = pl.originalName || pl.name;
    const customNames = MusicProviderManager.loadCustomPlaylistNames();
    delete customNames[pl.id];
    MusicProviderManager.saveCustomPlaylistNames(customNames);

    setPlaylists((prev) => {
      const updated = prev.map((item) =>
        item.id === pl.id
          ? {
              ...item,
              name: realName,
              originalName: realName,
            }
          : item
      );
      MusicProviderManager.savePlaylists(updated);
      return updated;
    });
    setEditingPlaylistId(null);
    setEditingPlaylistNameInput('');
    setToastMessage(`Restored real playlist name: "${realName}"`);
  };

  // Play playlist in order (1 click, with duplicate-song collapse when Smart Anti-Repeat is active)
  const handlePlayPlaylistInOrder = (pl: Playlist) => {
    const rawTracks = getTracksForPlaylist(pl);
    if (rawTracks.length === 0) return;
    const plTracks = audio.smartAntiRepeatEnabled
      ? dedupeAndSpreadTracks(rawTracks, true)
      : rawTracks;
    audio.playSpecificTrack(plTracks[0], plTracks);
  };

  // Shuffle & Play playlist immediately (1 click, using Smart Anti-Repeat so duplicate songs never play back-to-back)
  const handleShufflePlayPlaylist = (pl: Playlist) => {
    const plTracks = getTracksForPlaylist(pl);
    if (plTracks.length === 0) return;
    const shuffled = smartAntiRepeatShuffle(
      plTracks,
      audio.smartAntiRepeatEnabled
    );
    const removedCount = Math.max(0, plTracks.length - shuffled.length);
    audio.playSpecificTrack(shuffled[0], shuffled);
    setToastMessage(
      removedCount > 0
        ? `🔀 Shuffling "${pl.name}" (${shuffled.length} tracks · ${removedCount} duplicate copies skipped)`
        : `🔀 Shuffling "${pl.name}" (${shuffled.length} tracks)`
    );
  };

  const handleApplyRestoredCloudSettings = (
    restored: BrokeifyCloudSettings
  ) => {
    if (restored.audioPrefs) {
      audio.restoreAudioPreferences(restored.audioPrefs);
    }
    if (Array.isArray(restored.providers) && restored.providers.length > 0) {
      setProviders((prev) => {
        const merged = mergeProvidersPreservingAuth(
          prev,
          restored.providers.filter((p) => p.type !== 'built-in')
        ).filter((p) => p.type !== 'built-in');
        MusicProviderManager.saveProviders(merged);
        return merged;
      });
    }
    if (Array.isArray(restored.playlists) && restored.playlists.length > 0) {
      setPlaylists((prev) => {
        const filteredIncoming = restored.playlists.filter(
          (p) =>
            p.source !== 'built-in' &&
            p.id !== 'pl-night-drive' &&
            p.id !== 'pl-spite-anthem'
        );
        const customNames = MusicProviderManager.loadCustomPlaylistNames();
        const mergedPl = mergePlaylistsPreservingCustomNames(
          prev.filter((p) => p.source !== 'built-in'),
          filteredIncoming,
          customNames
        );
        MusicProviderManager.savePlaylists(mergedPl);
        return mergedPl;
      });
    }
    setCloudSyncStatus({
      state: 'restored',
      lastSyncedAt: restored.updatedAt,
      message: `Restored EQ (${restored.audioPrefs.eqPreset}), Stabilizer (${restored.audioPrefs.carVolumeLeveler ? 'ON' : 'OFF'}), servers & playlists from Jellyfin`,
    });
  };

  const handlePullCloudSettings = async (overrideConfig?: ProviderConfig) => {
    const jfConfig =
      overrideConfig ||
      providers.find((p) => p.type === 'jellyfin') ||
      providers[0];
    if (!jfConfig) return;

    setCloudSyncStatus((prev) => ({
      ...prev,
      state: 'syncing',
      message: 'Pulling from GET /DisplayPreferences/brokeify...',
    }));

    const { settings } =
      await MusicProviderManager.pullCloudSettingsFromJellyfin(jfConfig);
    if (settings) {
      handleApplyRestoredCloudSettings(settings);
    } else {
      await handlePushCloudSettings(jfConfig);
    }
  };

  const handlePushCloudSettings = async (overrideConfig?: ProviderConfig) => {
    const jfConfig =
      overrideConfig ||
      providers.find((p) => p.type === 'jellyfin') ||
      providers[0];
    if (!jfConfig) return;

    const snapshot: BrokeifyCloudSettings = {
      version: 1,
      updatedAt: new Date().toISOString(),
      audioPrefs: {
        eqPreset: audio.eqPreset,
        eqGains: audio.eqGains,
        carVolumeLeveler: audio.carVolumeLeveler,
        stabilizerStrength: audio.stabilizerStrength,
        lufsNormalizationEnabled: audio.lufsNormalizationEnabled,
        crossfadeSeconds: audio.crossfadeSeconds,
        offlinePreloadCount: audio.offlinePreloadCount,
        streamBufferSeconds: audio.streamBufferSeconds,
        shuffleEnabled: audio.shuffleEnabled,
        smartAntiRepeatEnabled: audio.smartAntiRepeatEnabled,
        repeatMode: audio.repeatMode,
        visualTheme: audio.visualTheme,
      },
      providers,
      playlists,
    };

    const res = await MusicProviderManager.pushCloudSettingsToJellyfin(
      jfConfig,
      snapshot
    );
    setCloudSyncStatus({
      state: 'pushed',
      lastSyncedAt: snapshot.updatedAt,
      message: res.message,
    });
  };

  // Auto-push settings to Jellyfin /DisplayPreferences/brokeify whenever EQ, Crossfade, Preload, Buffer, Visual Theme, or Playlists change
  useEffect(() => {
    const jfConfig = providers.find(
      (p) => p.type === 'jellyfin' && p.enabled && p.token && p.userId
    );
    if (!jfConfig) return;

    const snapshot: BrokeifyCloudSettings = {
      version: 1,
      updatedAt: new Date().toISOString(),
      audioPrefs: {
        eqPreset: audio.eqPreset,
        eqGains: audio.eqGains,
        carVolumeLeveler: audio.carVolumeLeveler,
        stabilizerStrength: audio.stabilizerStrength,
        lufsNormalizationEnabled: audio.lufsNormalizationEnabled,
        crossfadeSeconds: audio.crossfadeSeconds,
        offlinePreloadCount: audio.offlinePreloadCount,
        streamBufferSeconds: audio.streamBufferSeconds,
        shuffleEnabled: audio.shuffleEnabled,
        smartAntiRepeatEnabled: audio.smartAntiRepeatEnabled,
        repeatMode: audio.repeatMode,
        visualTheme: audio.visualTheme,
      },
      providers,
      playlists,
    };
    MusicProviderManager.pushCloudSettingsToJellyfin(jfConfig, snapshot).then(
      (res) => {
        setCloudSyncStatus({
          state: 'pushed',
          lastSyncedAt: snapshot.updatedAt,
          message: res.message,
        });
      }
    );
  }, [
    audio.eqPreset,
    audio.eqGains,
    audio.carVolumeLeveler,
    audio.stabilizerStrength,
    audio.lufsNormalizationEnabled,
    audio.crossfadeSeconds,
    audio.offlinePreloadCount,
    audio.streamBufferSeconds,
    audio.shuffleEnabled,
    audio.smartAntiRepeatEnabled,
    audio.repeatMode,
    audio.visualTheme,
    providers,
    playlists,
  ]);

  // Persist configuration to /api/config (/app/data/config.json) on the backend server
  const saveConfigToServer = async (
    overrideIntegrations?: BrokeifyServerIntegrations
  ) => {
    const jfProv = providers.find((p) => p.type === 'jellyfin');
    const activeIntegrations: BrokeifyServerIntegrations = {
      ...(overrideIntegrations || serverIntegrations),
      jellyfinUrl:
        jfProv?.serverUrl ||
        (overrideIntegrations || serverIntegrations).jellyfinUrl,
      jellyfinToken:
        jfProv?.token ||
        (overrideIntegrations || serverIntegrations).jellyfinToken,
      jellyfinUserId:
        jfProv?.userId ||
        (overrideIntegrations || serverIntegrations).jellyfinUserId,
      jellyfinUsername:
        jfProv?.username ||
        (overrideIntegrations || serverIntegrations).jellyfinUsername,
    };

    try {
      const resp = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            version: 2,
            integrations: activeIntegrations,
            audioPrefs: {
              eqPreset: audio.eqPreset,
              eqGains: audio.eqGains,
              carVolumeLeveler: audio.carVolumeLeveler,
              stabilizerStrength: audio.stabilizerStrength,
              lufsNormalizationEnabled: audio.lufsNormalizationEnabled,
              smartAntiRepeatEnabled: audio.smartAntiRepeatEnabled,
              crossfadeSeconds: audio.crossfadeSeconds,
              offlinePreloadCount: audio.offlinePreloadCount,
              streamBufferSeconds: audio.streamBufferSeconds,
              shuffleEnabled: audio.shuffleEnabled,
              repeatMode: audio.repeatMode,
              visualTheme: audio.visualTheme,
            },
            providers,
            playlists,
            customPlaylistNames:
              MusicProviderManager.loadCustomPlaylistNames(),
            pinnedPlaylistId,
          },
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.configPath) setServerConfigPath(data.configPath);
      }
    } catch {
      // ignore offline error
    }
  };

  useEffect(() => {
    if (!hasLoadedServerConfigRef.current) return;
    const t = setTimeout(() => {
      saveConfigToServer();
    }, 600);
    return () => clearTimeout(t);
  }, [
    providers,
    playlists,
    pinnedPlaylistId,
    serverIntegrations,
    audio.eqPreset,
    audio.eqGains,
    audio.carVolumeLeveler,
    audio.stabilizerStrength,
    audio.lufsNormalizationEnabled,
    audio.smartAntiRepeatEnabled,
    audio.crossfadeSeconds,
    audio.offlinePreloadCount,
    audio.streamBufferSeconds,
    audio.shuffleEnabled,
    audio.repeatMode,
    audio.visualTheme,
  ]);

  // Poll /api/slskd/status every 6 seconds to update transfer progress & display "is ready to play!" banners
  const fetchSlskdStatus = async () => {
    try {
      const resp = await fetch('/api/slskd/status');
      if (!resp.ok) return;
      const data = await resp.json();
      if (Array.isArray(data.jobs)) {
        setSlskdJobs(data.jobs);
      }
      if (Array.isArray(data.notifications)) {
        setReadyNotifications((prev) => {
          if (
            data.notifications.length > prev.length &&
            data.notifications[0]
          ) {
            // Auto-sync Jellyfin when a new download completes!
            const jfProv = providers.find((p) => p.type === 'jellyfin');
            if (jfProv) syncJellyfinProvider(jfProv);
          }
          return data.notifications;
        });
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchSlskdStatus();
    const interval = setInterval(fetchSlskdStatus, 6000);
    return () => clearInterval(interval);
  }, []);

  // Automatic ListenBrainz Scrobbling (playing_now on track start + single listen at 50% or 240s)
  useEffect(() => {
    const tr = audio.currentTrack;
    if (!tr || !audio.isPlaying || !serverIntegrations.listenbrainzToken) {
      return;
    }
    fetch('/api/listenbrainz/scrobble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listenType: 'playing_now',
        track: {
          title: tr.title,
          artist: tr.artist,
          album: tr.album,
          duration: tr.duration,
        },
      }),
    }).catch(() => {});
  }, [
    audio.currentTrack?.id,
    audio.isPlaying,
    serverIntegrations.listenbrainzToken,
  ]);

  useEffect(() => {
    const tr = audio.currentTrack;
    if (!tr || !audio.isPlaying || !serverIntegrations.listenbrainzToken) {
      return;
    }
    const threshold = Math.min(240, Math.max(30, (tr.duration || 180) * 0.5));
    if (
      audio.currentTime >= threshold &&
      !scrobbledTrackIdsRef.current.has(tr.id)
    ) {
      scrobbledTrackIdsRef.current.add(tr.id);
      fetch('/api/listenbrainz/scrobble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listenType: 'single',
          track: {
            title: tr.title,
            artist: tr.artist,
            album: tr.album,
            duration: tr.duration,
          },
        }),
      }).catch(() => {});
    }
  }, [
    audio.currentTime,
    audio.currentTrack,
    audio.isPlaying,
    serverIntegrations.listenbrainzToken,
  ]);

  // Permanently delete a duplicate track from the Jellyfin server's hard drive via DELETE /api/jellyfin/items/:id
  const handleDeleteTrackFromJellyfin = async (track: Track) => {
    setDeletingTrackId(track.id);
    try {
      const jfProv = providers.find((p) => p.type === 'jellyfin');
      const resp = await fetch(
        `/api/jellyfin/items/${encodeURIComponent(track.id)}`,
        {
          method: 'DELETE',
          headers: {
            'x-jellyfin-url': jfProv?.serverUrl || '',
            'x-jellyfin-token': jfProv?.token || '',
          },
        }
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        setToastMessage(
          `⚠️ ${data.error || `Failed to delete "${track.title}" from Jellyfin`}`
        );
      } else {
        setRemoteTracks((prev) => {
          const remaining = prev.filter((t) => t.id !== track.id);
          MusicProviderManager.saveCachedRemoteTracks(remaining);
          return remaining;
        });
        audio.setQueue(audio.queue.filter((t) => t.id !== track.id));
        setToastMessage(
          `🗑️ Permanently deleted "${track.title}" from Jellyfin server!`
        );
      }
    } catch (err) {
      setToastMessage(
        `⚠️ ${err instanceof Error ? err.message : 'Delete request failed'}`
      );
    } finally {
      setDeletingTrackId(null);
      setConfirmDeleteTrackId(null);
    }
  };

  const handleUpdateProviders = (next: ProviderConfig[]) => {
    setProviders(next);
    MusicProviderManager.saveProviders(next);
  };

  const handleMergeRemoteTracks = (newTracks: Track[]) => {
    setRemoteTracks((prev) => {
      const map = new Map<string, Track>();
      for (const t of prev) map.set(t.id, t);
      for (const t of newTracks) map.set(t.id, t);
      const updated = Array.from(map.values());
      MusicProviderManager.saveCachedRemoteTracks(updated);
      return updated;
    });
    if (newTracks.length > 0) {
      audio.setQueue(
        audio.smartAntiRepeatEnabled
          ? dedupeAndSpreadTracks(newTracks, true)
          : newTracks
      );
    }
  };

  const handleMergeRemotePlaylists = (newPlaylists: Playlist[]) => {
    if (newPlaylists.length === 0) return;
    setPlaylists((prev) => {
      const customNames = MusicProviderManager.loadCustomPlaylistNames();
      const updated = mergePlaylistsPreservingCustomNames(
        prev,
        newPlaylists,
        customNames
      );
      MusicProviderManager.savePlaylists(updated);
      return updated;
    });
    setPinnedPlaylistId((prevPin) => {
      if (
        !prevPin ||
        prevPin === 'pl-night-drive' ||
        prevPin === 'pl-spite-anthem'
      ) {
        const nextPin = newPlaylists[0].id;
        try {
          localStorage.setItem(PINNED_PLAYLIST_STORAGE_KEY, nextPin);
        } catch {
          // ignore
        }
        return nextPin;
      }
      return prevPin;
    });
  };

  const handleLogoutProvider = async (type: ProviderType) => {
    const { updatedProviders, remainingTracks, remainingPlaylists } =
      await MusicProviderManager.logoutProvider(type, providers);
    setProviders(updatedProviders);
    setRemoteTracks(remainingTracks);
    setPlaylists(remainingPlaylists);
    setSelectedPlaylistId(null);
    setToastMessage(
      `Logged out of ${SOURCE_LABELS[type] || type}. Ready to sign back in.`
    );
    setIsOnboardingOpen(true);
  };

  const handleSaveResolvedPlaylist = (newPl: Playlist) => {
    setPlaylists((prev) => {
      const updated = [{ ...newPl, originalName: newPl.originalName || newPl.name }, ...prev];
      MusicProviderManager.savePlaylists(updated);
      return updated;
    });
    setSelectedPlaylistId(newPl.id);
    setLibrarySubTab('songs');
  };

  const handleCreateCustomPlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    const trimmed = newPlaylistName.trim();
    const pl: Playlist = {
      id: `pl-custom-${Date.now()}`,
      name: trimmed,
      originalName: trimmed,
      description: 'Unified multi-source playlist created in Brokeify.',
      source: 'mixed',
      trackIds: allTracks.slice(0, 4).map((t) => t.id),
      createdAt: new Date().toISOString().slice(0, 10),
      coverAccent: '#10b981',
    };
    setPlaylists((prev) => {
      const updated = [pl, ...prev];
      MusicProviderManager.savePlaylists(updated);
      return updated;
    });
    setNewPlaylistName('');
    setShowNewPlaylistForm(false);
  };

  // One-Tap Offline Playlist Downloader into IndexedDB (`brokeify-offline-vault`)
  const handleDownloadPlaylistOffline = async (playlist: Playlist) => {
    const playlistTracks = getTracksForPlaylist(playlist);
    if (playlistTracks.length === 0) return;

    setDownloadingPlaylistId(playlist.id);
    setDownloadProgress({ done: 0, total: playlistTracks.length });

    try {
      let done = 0;
      for (const tr of playlistTracks) {
        await preloadTrackToVault(tr);
        done += 1;
        setDownloadProgress({ done, total: playlistTracks.length });
        await audio.refreshVaultState();
      }
    } finally {
      setDownloadingPlaylistId(null);
      setDownloadProgress(null);
    }
  };

  // Filtered tracks for Songs sub-tab
  const displayedTracks = useMemo(() => {
    let list = allTracks;

    if (selectedPlaylistId) {
      const pl = visiblePlaylists.find((p) => p.id === selectedPlaylistId);
      if (pl) {
        const idSet = new Set(pl.trackIds);
        list = list.filter((t) => idSet.has(t.id));
      }
    }

    if (sourceFilter !== 'all') {
      list = list.filter((t) => t.source === sourceFilter);
    }

    if (offlineOnlyMode) {
      list = list.filter((t) => audio.cachedTrackIds.has(t.id));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q) ||
          t.sourceName.toLowerCase().includes(q) ||
          (t.genre && t.genre.toLowerCase().includes(q))
      );
    }

    return list;
  }, [
    allTracks,
    selectedPlaylistId,
    visiblePlaylists,
    sourceFilter,
    offlineOnlyMode,
    audio.cachedTrackIds,
    searchQuery,
  ]);

  // Recently played tracks resolved to Track objects
  const recentlyPlayedTracks = useMemo(() => {
    const byId = new Map(allTracks.map((t) => [t.id, t]));
    const resolved = recentTrackIds
      .map((id) => byId.get(id))
      .filter((t): t is Track => Boolean(t));
    return resolved.length > 0 ? resolved : allTracks.slice(0, 4);
  }, [allTracks, recentTrackIds]);

  // Grouped Albums for Library -> Albums sub-tab
  const albumGroups = useMemo(() => {
    const map = new Map<
      string,
      { album: string; artist: string; artworkUrl: string; tracks: Track[] }
    >();
    for (const t of allTracks) {
      const key = t.album || 'Singles';
      const existing = map.get(key);
      if (existing) {
        existing.tracks.push(t);
      } else {
        map.set(key, {
          album: key,
          artist: t.artist,
          artworkUrl: t.artworkUrl,
          tracks: [t],
        });
      }
    }
    return Array.from(map.values());
  }, [allTracks]);

  // Grouped Artists for Library -> Artists sub-tab
  const artistGroups = useMemo(() => {
    const map = new Map<
      string,
      { artist: string; artworkUrl: string; tracks: Track[] }
    >();
    for (const t of allTracks) {
      const key = t.artist || 'Unknown Artist';
      const existing = map.get(key);
      if (existing) {
        existing.tracks.push(t);
      } else {
        map.set(key, {
          artist: key,
          artworkUrl: t.artworkUrl,
          tracks: [t],
        });
      }
    }
    return Array.from(map.values());
  }, [allTracks]);

  // Dynamic source filter tabs
  const activeFilterTabs = useMemo(() => {
    const tabs: Array<{ id: ProviderType | 'all'; label: string }> = [
      { id: 'all', label: `All Sources (${allTracks.length})` },
    ];
    for (const p of providers) {
      if (p.enabled && p.type !== 'built-in') {
        const count = allTracks.filter((t) => t.source === p.type).length;
        tabs.push({
          id: p.type,
          label: `${SOURCE_LABELS[p.type] || p.name} (${count})`,
        });
      }
    }
    return tabs;
  }, [allTracks, providers]);

  const ambientAccent = audio.currentTrack?.accentColor || '#10b981';
  const activeVisualSkin =
    VISUAL_THEMES.find((t) => t.id === audio.visualTheme) || VISUAL_THEMES[0];

  return (
    <div
      data-visual-theme={audio.visualTheme}
      className="min-h-screen bg-[#070a0f] text-zinc-100 flex flex-col relative pb-36 transition-colors duration-300"
    >
      {/* Dynamic Ambient Glow Behind Player */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-[360px] opacity-20 blur-3xl transition-colors duration-700 z-0"
        style={{
          background: `radial-gradient(circle at 25% 15%, ${ambientAccent}, transparent 60%), radial-gradient(circle at 80% 10%, #00ff66, transparent 65%)`,
        }}
      />

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          data-testid="instant-mix-toast"
          className="fixed top-16 right-4 z-50 rounded-xl border border-[#00ff66]/50 bg-zinc-950/95 px-4 py-2.5 text-xs font-mono font-bold text-[#00ff66] shadow-2xl flex items-center gap-2 backdrop-blur-md"
        >
          <Sparkles className="w-4 h-4 text-[#00ff66] shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Ultra-Clean Retro Stereo Metallic Top Header Bar */}
      <header className="sticky top-0 z-30 winamp-titlebar border-b border-zinc-700/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          {/* Left: Brokeify Logo + Core Navigation Tabs */}
          <div className="flex items-center gap-4 min-w-0">
            <button
              type="button"
              onClick={() => setActiveTab('library')}
              className="flex items-center gap-2.5 text-left shrink-0 group"
            >
              <BrokeifyLogo size={28} />
              <div className="leading-none">
                <span className="text-base font-extrabold tracking-tight text-white font-display group-hover:text-[#00ff66] transition-colors block">
                  BROKEIFY
                </span>
                <span className="text-[9px] font-mono text-[#00ff66] tracking-widest uppercase hidden sm:block">
                  &apos;99 RETRO DECK // {activeVisualSkin.name.toUpperCase()}
                </span>
              </div>
            </button>

            {/* Desktop Core 4-Tab Navigation (Library, Request / Discover, Now Playing, Settings) */}
            <nav
              aria-label="Primary Navigation"
              className="hidden md:flex items-center gap-1 rounded-xl border border-zinc-700/80 bg-zinc-950/80 p-1 text-xs font-mono font-semibold"
            >
              <button
                type="button"
                onClick={() => setActiveTab('library')}
                data-testid="tab-library"
                className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === 'library'
                    ? 'bg-[#00ff66] text-zinc-950 font-bold'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Library
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('discover')}
                data-testid="tab-discover"
                className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
                  activeTab === 'discover'
                    ? 'bg-[#00ff66] text-zinc-950 font-bold'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Request / Discover</span>
                {slskdJobs.some(
                  (j) => j.status === 'searching' || j.status === 'downloading'
                ) && (
                  <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('nowplaying')}
                data-testid="tab-nowplaying"
                className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === 'nowplaying'
                    ? 'bg-[#00ff66] text-zinc-950 font-bold'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Now Playing ({audio.queue.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                data-testid="tab-settings"
                className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === 'settings'
                    ? 'bg-[#00ff66] text-zinc-950 font-bold'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Settings
              </button>
            </nav>
          </div>

          {/* Right: Car Mode 🚗 and Settings ⚙️ on the far right */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsCarModeOpen(true)}
              data-testid="navbar-carmode-btn"
              title="Launch 1-Tap Car Driving Mode"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3 py-1.5 text-xs font-mono font-bold text-zinc-950 transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
            >
              <Car className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Car Mode</span>
              <span aria-hidden="true">🚗</span>
            </button>

            <button
              type="button"
              onClick={() =>
                setActiveTab(activeTab === 'settings' ? 'library' : 'settings')
              }
              data-testid="navbar-settings-btn"
              aria-label="Settings"
              title="Settings"
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-mono font-semibold transition-colors min-h-[36px] ${
                activeTab === 'settings'
                  ? 'border-[#00ff66] bg-emerald-500/20 text-[#00ff66]'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white hover:border-zinc-600'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-5 space-y-6">
        {/* Celebratory slskd Download Completed & Jellyfin Refreshed Notification Banner */}
        {readyNotifications.length > 0 && (
          <div
            role="status"
            data-testid="slskd-ready-banner"
            className="winamp-bezel rounded-2xl border border-[#00ff66] bg-emerald-950/50 px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-lg"
          >
            <div className="flex items-center gap-2.5 text-xs sm:text-sm font-mono font-bold text-[#00ff66]">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>{readyNotifications[0].message}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const jfProv = providers.find((p) => p.type === 'jellyfin');
                  if (jfProv) syncJellyfinProvider(jfProv);
                  setActiveTab('library');
                  setLibrarySubTab('songs');
                }}
                className="rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3.5 py-1.5 text-xs font-mono font-bold text-zinc-950"
              >
                Sync &amp; Play Now ▶
              </button>
              <button
                type="button"
                onClick={() => {
                  fetch('/api/slskd/notifications/dismiss', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: readyNotifications[0].id }),
                  }).catch(() => {});
                  setReadyNotifications((prev) => prev.slice(1));
                }}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-mono text-zinc-300 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* =====================================================================
            TAB 1: LIBRARY (DEFAULT SCREEN)
           ===================================================================== */}
        {activeTab === 'library' && (
          <div className="space-y-6">
            {/* Hero Quick-Row: Compact Fixed-Width Boxes with Text Cutoff so Long Track/Playlist Names Never Stretch Cards */}
            {(pinnedFavoritePlaylist || recentlyPlayedTracks.length > 0) && (
              <section
                aria-label="Quick Launch Recently Played and Favorite Playlists"
                className="winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden"
              >
                <div className="winamp-titlebar px-4 py-2 flex items-center justify-between gap-2 border-b border-zinc-700/80">
                  <div className="flex items-center gap-2 min-w-0">
                    <History className="w-3.5 h-3.5 text-[#00ff66] shrink-0" />
                    <h2 className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-200 truncate">
                      QUICK LAUNCH // RECENTLY PLAYED &amp; PINNED FAVORITES
                    </h2>
                  </div>
                  <div className="hidden sm:flex items-center gap-3 text-[10px] font-mono text-zinc-400 shrink-0">
                    <span>
                      XFADE:{' '}
                      <strong className="text-[#00ff66]">
                        {audio.crossfadeSeconds > 0
                          ? `${audio.crossfadeSeconds}S`
                          : 'OFF'}
                      </strong>
                    </span>
                    <span>·</span>
                    <span>
                      OFFLINE QUEUE:{' '}
                      <strong className="text-[#00ff66]">
                        {audio.offlinePreloadCount} TRACKS
                      </strong>
                    </span>
                  </div>
                </div>

                <div className="p-3.5 flex items-stretch gap-3 overflow-x-auto">
                  {/* Pinned Favorite Playlist Quick Card (Strict Fixed Width w-[235px] max-w-[235px] with Truncate Cutoff) */}
                  {pinnedFavoritePlaylist && (
                    <div
                      data-testid="quicklaunch-pinned-playlist-card"
                      className="w-[235px] max-w-[235px] rounded-xl border border-purple-500/40 bg-gradient-to-br from-purple-950/40 via-zinc-900/90 to-zinc-950 p-3 flex flex-col justify-between gap-2.5 shrink-0 overflow-hidden"
                    >
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-purple-300">
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />
                            <span className="truncate">Pinned Playlist</span>
                          </span>
                          <h3
                            title={pinnedFavoritePlaylist.name}
                            className="text-xs font-bold text-white truncate block max-w-full mt-0.5"
                          >
                            {pinnedFavoritePlaylist.name}
                          </h3>
                          {pinnedFavoritePlaylist.originalName &&
                            pinnedFavoritePlaylist.originalName !==
                              pinnedFavoritePlaylist.name && (
                              <div
                                title={`Real Name: ${pinnedFavoritePlaylist.originalName}`}
                                className="text-[10px] font-mono text-zinc-400 truncate block max-w-full"
                              >
                                Real: {pinnedFavoritePlaylist.originalName}
                              </div>
                            )}
                        </div>
                        <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                          {getTracksForPlaylist(pinnedFavoritePlaylist).length}tr
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handlePlayPlaylistInOrder(pinnedFavoritePlaylist)
                          }
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-[#00ff66] hover:bg-emerald-400 py-1.5 px-2.5 text-[11px] font-mono font-bold text-zinc-950 transition-colors min-h-[32px]"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Play</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleShufflePlayPlaylist(pinnedFavoritePlaylist)
                          }
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-purple-600 hover:bg-purple-500 py-1.5 px-2.5 text-[11px] font-mono font-bold text-white transition-colors min-h-[32px]"
                        >
                          <Shuffle className="w-3 h-3" />
                          <span>Shuffle</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Recently Played Track Cards (Strict w-[200px] max-w-[200px] Cutoff so Long Track Titles Never Stretch Boxes) */}
                  {recentlyPlayedTracks.slice(0, 6).map((track) => {
                    const isCurrent = audio.currentTrack?.id === track.id;
                    return (
                      <button
                        key={`recent-${track.id}`}
                        type="button"
                        onClick={() =>
                          audio.playSpecificTrack(track, allTracks)
                        }
                        title={`${track.title} — ${track.artist}`}
                        data-testid={`quicklaunch-track-card-${track.id}`}
                        className={`w-[200px] max-w-[200px] rounded-xl border p-2.5 flex items-center gap-2.5 shrink-0 overflow-hidden text-left transition-colors ${
                          isCurrent
                            ? 'border-[#00ff66]/70 bg-emerald-500/15'
                            : 'border-zinc-800 bg-zinc-900/70 hover:border-zinc-700'
                        }`}
                      >
                        <img
                          src={track.artworkUrl}
                          alt={track.title}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.onerror = null;
                            e.currentTarget.src = createAlbumArtworkDataUri(
                              track.title,
                              track.artist,
                              track.accentColor || '#10b981',
                              '#09090b'
                            );
                          }}
                          className="w-10 h-10 rounded-lg border border-zinc-700 object-cover shrink-0"
                        />
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <div className="text-[9px] font-mono uppercase text-[#00ff66] truncate">
                            {isCurrent ? '▶ Playing' : 'Recent Track'}
                          </div>
                          <div className="text-xs font-bold text-white truncate block max-w-full">
                            {track.title}
                          </div>
                          <div className="text-[11px] text-zinc-400 truncate block max-w-full">
                            {track.artist}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Sub-Tabs Segmented Control + Search Filter Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
              <div
                role="tablist"
                aria-label="Library View Mode"
                data-testid="library-subtabs"
                className="inline-flex items-center gap-1 rounded-xl border border-zinc-700/80 bg-zinc-900/90 p-1 self-start font-mono"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={librarySubTab === 'playlists'}
                  onClick={() => setLibrarySubTab('playlists')}
                  data-testid="subtab-playlists"
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors min-h-[34px] ${
                    librarySubTab === 'playlists'
                      ? 'bg-[#00ff66] text-zinc-950'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <ListMusic className="w-3.5 h-3.5" />
                  <span>Playlists ({visiblePlaylists.length})</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={librarySubTab === 'songs'}
                  onClick={() => setLibrarySubTab('songs')}
                  data-testid="subtab-songs"
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors min-h-[34px] ${
                    librarySubTab === 'songs'
                      ? 'bg-[#00ff66] text-zinc-950'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Music className="w-3.5 h-3.5" />
                  <span>Songs ({allTracks.length})</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={librarySubTab === 'albums'}
                  onClick={() => setLibrarySubTab('albums')}
                  data-testid="subtab-albums"
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors min-h-[34px] ${
                    librarySubTab === 'albums'
                      ? 'bg-[#00ff66] text-zinc-950'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Disc className="w-3.5 h-3.5" />
                  <span>Albums ({albumGroups.length})</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={librarySubTab === 'artists'}
                  onClick={() => setLibrarySubTab('artists')}
                  data-testid="subtab-artists"
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors min-h-[34px] ${
                    librarySubTab === 'artists'
                      ? 'bg-[#00ff66] text-zinc-950'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Artists ({artistGroups.length})</span>
                </button>
              </div>

              {/* Search & New Playlist Controls */}
              <div className="flex items-center gap-2">
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (
                        librarySubTab === 'playlists' &&
                        e.target.value.trim()
                      ) {
                        setLibrarySubTab('songs');
                      }
                    }}
                    placeholder="Search songs, artists, genres..."
                    aria-label="Search library"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-[#00ff66] focus:outline-none min-h-[36px]"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setShowNewPlaylistForm(!showNewPlaylistForm)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-[#00ff66]/50 px-3 py-1.5 text-xs font-mono font-semibold text-white transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
                >
                  <Plus className="w-3.5 h-3.5 text-[#00ff66]" />
                  <span>New Playlist</span>
                </button>
              </div>
            </div>

            {showNewPlaylistForm && (
              <form
                onSubmit={handleCreateCustomPlaylist}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3.5 flex flex-col sm:flex-row items-center gap-3"
              >
                <label htmlFor="new-playlist-name" className="sr-only">
                  Playlist Name
                </label>
                <input
                  id="new-playlist-name"
                  type="text"
                  value={newPlaylistName ?? ''}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  placeholder="Enter custom multi-source playlist name..."
                  className="flex-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-500 focus:border-[#00ff66] focus:outline-none"
                />
                <button
                  type="submit"
                  className="w-full sm:w-auto rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2 text-xs font-mono font-bold text-zinc-950 whitespace-nowrap shrink-0 min-h-[38px]"
                >
                  Create Playlist
                </button>
              </form>
            )}

            {/* SUB-TAB 1: UNIFIED PLAYLISTS GRID */}
            {librarySubTab === 'playlists' && (
              <section aria-label="Unified Playlists Grid" className="space-y-4">
                {visiblePlaylists.length === 0 ? (
                  <div className="winamp-bezel rounded-2xl border border-zinc-800/90 p-8 text-center space-y-3">
                    <p className="text-sm font-semibold text-zinc-200">
                      No playlists loaded yet.
                    </p>
                    <p className="text-xs text-zinc-400 max-w-md mx-auto">
                      Open{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('settings');
                          setSettingsSubTab('sources');
                        }}
                        className="text-[#00ff66] underline font-semibold"
                      >
                        Settings → Sources Hub
                      </button>{' '}
                      to connect or sync your music server.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {visiblePlaylists.map((pl) => {
                      const plTracks = getTracksForPlaylist(pl);
                      const allCached =
                        plTracks.length > 0 &&
                        plTracks.every((t) => audio.cachedTrackIds.has(t.id));
                      const isDownloading = downloadingPlaylistId === pl.id;
                      const isPinned = pinnedFavoritePlaylist?.id === pl.id;
                      const realPlaylistName = pl.originalName || pl.name;
                      const hasCustomName = realPlaylistName !== pl.name;
                      const isEditingThis = editingPlaylistId === pl.id;

                      return (
                        <div
                          key={pl.id}
                          data-testid={`playlist-card-${pl.id}`}
                          className={`group winamp-bezel rounded-2xl border p-4 flex flex-col justify-between gap-4 transition-all ${
                            isPinned
                              ? 'border-purple-500/60 shadow-lg shadow-purple-950/20'
                              : 'border-zinc-800/90 hover:border-zinc-700'
                          }`}
                        >
                          <div className="space-y-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPlaylistId(pl.id);
                                  setLibrarySubTab('songs');
                                }}
                                className="text-left min-w-0 flex-1 overflow-hidden"
                              >
                                <div className="flex items-center gap-1.5">
                                  <h3
                                    data-testid={`playlist-display-name-${pl.id}`}
                                    className="text-base font-bold text-white group-hover:text-[#00ff66] transition-colors truncate"
                                  >
                                    {pl.name}
                                  </h3>
                                  {hasCustomName && (
                                    <span className="rounded bg-purple-500/20 border border-purple-500/40 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase text-purple-300 shrink-0">
                                      Renamed
                                    </span>
                                  )}
                                </div>

                                {/* Always display the Real / Original Server Name alongside the custom Playlist Name */}
                                <div
                                  data-testid={`playlist-real-name-${pl.id}`}
                                  className="mt-1 rounded-lg border border-zinc-800/90 bg-zinc-950/80 px-2 py-1 text-[11px] font-mono text-zinc-300 flex items-center gap-1.5 truncate"
                                  title={`Real Server Playlist Name: ${realPlaylistName}`}
                                >
                                  <span className="text-zinc-500 shrink-0">
                                    Real Name:
                                  </span>
                                  <span className="text-[#00ff66] font-semibold truncate">
                                    {realPlaylistName}
                                  </span>
                                </div>

                                <p className="text-xs text-zinc-400 mt-1.5 line-clamp-2">
                                  {pl.description}
                                </p>
                              </button>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {/* Rename Playlist Button */}
                                <button
                                  type="button"
                                  onClick={() =>
                                    isEditingThis
                                      ? setEditingPlaylistId(null)
                                      : handleStartRenamePlaylist(pl)
                                  }
                                  data-testid={`rename-playlist-btn-${pl.id}`}
                                  aria-label={`Rename playlist ${pl.name}`}
                                  title="Rename Playlist (keeps Real Name visible)"
                                  className={`min-h-[34px] min-w-[34px] rounded-xl border flex items-center justify-center transition-colors ${
                                    isEditingThis
                                      ? 'border-[#00ff66] bg-emerald-500/20 text-[#00ff66]'
                                      : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white'
                                  }`}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>

                                {/* Star / Pin Favorite Playlist Button */}
                                <button
                                  type="button"
                                  onClick={() => handleTogglePinPlaylist(pl.id)}
                                  data-testid={`pin-playlist-${pl.id}`}
                                  aria-label={
                                    isPinned
                                      ? `Unpin ${pl.name} from Quick Launch`
                                      : `Pin ${pl.name} to Quick Launch`
                                  }
                                  title={
                                    isPinned
                                      ? 'Pinned in Quick Launch'
                                      : 'Pin as Favorite Playlist in Quick Launch'
                                  }
                                  className={`min-h-[34px] min-w-[34px] rounded-xl border flex items-center justify-center transition-colors ${
                                    isPinned
                                      ? 'border-amber-500/50 bg-amber-500/15 text-amber-400'
                                      : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-amber-300'
                                  }`}
                                >
                                  <Star
                                    className={`w-4 h-4 ${
                                      isPinned ? 'fill-amber-400' : ''
                                    }`}
                                  />
                                </button>

                                {/* Offline Vault Downloader Button */}
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDownloadPlaylistOffline(pl)
                                  }
                                  disabled={isDownloading}
                                  aria-label={`Download playlist ${pl.name} to Offline Vault`}
                                  title="Save playlist to IndexedDB Offline Vault"
                                  className={`min-h-[34px] px-2.5 rounded-xl border flex items-center justify-center gap-1 text-xs font-mono transition-colors ${
                                    allCached
                                      ? 'border-emerald-500/50 bg-emerald-500/20 text-[#00ff66]'
                                      : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white'
                                  }`}
                                >
                                  {isDownloading ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00ff66]" />
                                      <span className="tabular-nums">
                                        {downloadProgress?.done}/
                                        {downloadProgress?.total}
                                      </span>
                                    </>
                                  ) : allCached ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-[#00ff66]" />
                                  ) : (
                                    <ArrowDownToLine className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>

                            {/* Inline Rename Editor */}
                            {isEditingThis && (
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  handleSavePlaylistName(pl);
                                }}
                                data-testid={`rename-playlist-form-${pl.id}`}
                                className="rounded-xl border border-emerald-500/40 bg-zinc-950/95 p-2.5 space-y-2"
                              >
                                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                                  <span>Custom Display Name:</span>
                                  <span className="text-zinc-500 truncate max-w-[180px]">
                                    Real: {realPlaylistName}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={editingPlaylistNameInput}
                                    onChange={(e) =>
                                      setEditingPlaylistNameInput(
                                        e.target.value
                                      )
                                    }
                                    placeholder="Enter custom playlist name..."
                                    aria-label="Custom playlist name"
                                    data-testid={`rename-playlist-input-${pl.id}`}
                                    className="flex-1 min-w-0 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-white focus:border-[#00ff66] focus:outline-none"
                                  />
                                  <button
                                    type="submit"
                                    data-testid={`save-playlist-name-${pl.id}`}
                                    title="Save Custom Name"
                                    className="rounded-lg bg-[#00ff66] hover:bg-emerald-400 px-2.5 py-1.5 text-xs font-mono font-bold text-zinc-950 inline-flex items-center gap-1 shrink-0 min-h-[32px]"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Save</span>
                                  </button>
                                  {hasCustomName && (
                                    <button
                                      type="button"
                                      onClick={() => handleResetPlaylistName(pl)}
                                      data-testid={`reset-playlist-name-${pl.id}`}
                                      title={`Reset to real name (${realPlaylistName})`}
                                      className="rounded-lg border border-zinc-700 bg-zinc-900 hover:text-amber-300 px-2 py-1.5 text-xs font-mono text-zinc-300 inline-flex items-center gap-1 shrink-0 min-h-[32px]"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setEditingPlaylistId(null)}
                                    title="Cancel"
                                    className="rounded-lg border border-zinc-800 bg-zinc-900 hover:text-white p-1.5 text-zinc-400 shrink-0 min-h-[32px]"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </form>
                            )}

                            <div className="text-[11px] font-mono text-zinc-400 flex items-center gap-2">
                              <span>{plTracks.length} tracks</span>
                              <span aria-hidden="true">·</span>
                              <span className="uppercase">{pl.source}</span>
                              {isPinned && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-amber-400 font-semibold">
                                    ★ Pinned
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Direct 1-Tap Action Buttons: Green Play (▶) + Purple Shuffle (🔀) */}
                          <div className="pt-3 border-t border-zinc-800/70 flex items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => handlePlayPlaylistInOrder(pl)}
                              data-testid={`play-playlist-${pl.id}`}
                              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[38px]"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>Play</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleShufflePlayPlaylist(pl)}
                              data-testid={`shuffle-playlist-${pl.id}`}
                              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#a855f7] hover:bg-purple-400 px-3 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[38px]"
                            >
                              <Shuffle className="w-3.5 h-3.5" />
                              <span>Shuffle 🔀</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* SUB-TAB 2: SONGS LIST (Clean rows without "More Like This" clutter) */}
            {librarySubTab === 'songs' && (
              <section
                aria-label="Songs Catalog"
                className="winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden"
              >
                <div className="winamp-titlebar px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-700/80">
                  <div
                    className="flex items-center gap-1.5 overflow-x-auto"
                    data-testid="active-source-filters"
                  >
                    {activeFilterTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setSourceFilter(tab.id)}
                        className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[32px] ${
                          sourceFilter === tab.id
                            ? 'bg-[#00ff66] text-zinc-950 font-bold'
                            : 'bg-zinc-950 text-zinc-300 hover:text-white border border-zinc-800'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {selectedPlaylistId && (() => {
                      const activePl = visiblePlaylists.find(
                        (p) => p.id === selectedPlaylistId
                      );
                      const realPlName =
                        activePl?.originalName || activePl?.name || '';
                      return (
                        <div className="flex items-center gap-2">
                          {activePl && (
                            <span className="rounded-lg border border-purple-500/40 bg-purple-950/30 px-2.5 py-1 text-xs font-mono text-purple-200">
                              Playlist: <strong>{activePl.name}</strong>
                              {realPlName && realPlName !== activePl.name
                                ? ` (Real: ${realPlName})`
                                : ''}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedPlaylistId(null)}
                            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-mono font-semibold text-[#00ff66] hover:text-white min-h-[32px]"
                          >
                            Clear Playlist Filter (Show All {allTracks.length})
                          </button>
                        </div>
                      );
                    })()}

                    <button
                      type="button"
                      onClick={() => {
                        if (displayedTracks.length > 0) {
                          const shuffled = smartAntiRepeatShuffle(
                            displayedTracks,
                            audio.smartAntiRepeatEnabled
                          );
                          audio.playSpecificTrack(shuffled[0], shuffled);
                          setToastMessage(
                            `🔀 Shuffling ${shuffled.length} songs`
                          );
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#a855f7] hover:bg-purple-400 px-3 py-1 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[32px]"
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                      <span>Shuffle All 🔀</span>
                    </button>
                  </div>
                </div>

                <div className="p-4 sm:p-5">
                  {displayedTracks.length === 0 ? (
                    <div className="py-10 text-center space-y-2">
                      <p className="text-sm font-semibold text-zinc-300">
                        No songs match your current filter.
                      </p>
                      {offlineOnlyMode && (
                        <button
                          type="button"
                          onClick={() => setOfflineOnlyMode(false)}
                          className="rounded-xl bg-zinc-800 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-700"
                        >
                          Disable Offline Only Mode
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-800/70">
                      {displayedTracks.map((track, idx) => {
                        const isCurrent = audio.currentTrack?.id === track.id;
                        const isCached = audio.cachedTrackIds.has(track.id);
                        const isPreloading = audio.preloadingTrackIds.has(
                          track.id
                        );

                        return (
                          <div
                            key={track.id}
                            className={`py-2.5 px-2 rounded-xl flex items-center justify-between gap-3 transition-colors ${
                              isCurrent
                                ? 'bg-emerald-500/15'
                                : 'hover:bg-zinc-950/60'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <span className="w-6 text-xs font-mono text-zinc-500 tabular-nums text-right shrink-0">
                                {String(idx + 1).padStart(2, '0')}
                              </span>

                              <img
                                src={track.artworkUrl}
                                alt={track.title}
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  e.currentTarget.onerror = null;
                                  e.currentTarget.src =
                                    createAlbumArtworkDataUri(
                                      track.title,
                                      track.artist,
                                      track.accentColor || '#10b981',
                                      '#09090b'
                                    );
                                }}
                                className="w-10 h-10 rounded-lg border border-zinc-800 object-cover shrink-0"
                              />

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`text-sm font-semibold truncate ${
                                      isCurrent
                                        ? 'text-[#00ff66]'
                                        : 'text-white'
                                    }`}
                                  >
                                    {track.title}
                                  </span>
                                  {track.format && (
                                    <span className="hidden sm:inline-block rounded bg-zinc-800/90 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300 uppercase">
                                      {track.format}
                                    </span>
                                  )}
                                </div>

                                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-400">
                                  <span className="truncate">
                                    {track.artist}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono text-zinc-300">
                                    {track.sourceName}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">
                                    {formatDuration(track.duration)}
                                  </span>
                                  {isPreloading ? (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-amber-300 font-mono inline-flex items-center gap-1">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Pre-loading
                                      </span>
                                    </>
                                  ) : (
                                    isCached && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span
                                          className="text-[#00ff66] font-mono font-semibold inline-flex items-center gap-1"
                                          data-testid="preloaded-indicator"
                                        >
                                          <CheckCircle2 className="w-3 h-3" />
                                          Pre-Loaded &amp; Ready
                                        </span>
                                      </>
                                    )
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {/* Delete Duplicate Track from Jellyfin Server Hard Drive (2-step confirmation) */}
                              {track.source === 'jellyfin' && (
                                <>
                                  {confirmDeleteTrackId === track.id ? (
                                    <div className="inline-flex items-center gap-1 rounded-xl border border-rose-500/60 bg-rose-950/60 px-2 py-1">
                                      <button
                                        type="button"
                                        disabled={deletingTrackId === track.id}
                                        onClick={() =>
                                          handleDeleteTrackFromJellyfin(track)
                                        }
                                        data-testid={`confirm-delete-track-${track.id}`}
                                        className="rounded-lg bg-rose-500 hover:bg-rose-400 px-2 py-1 text-[11px] font-mono font-bold text-white"
                                      >
                                        {deletingTrackId === track.id
                                          ? 'Deleting...'
                                          : 'Delete File'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setConfirmDeleteTrackId(null)
                                        }
                                        className="rounded-lg bg-zinc-800 px-1.5 py-1 text-[11px] font-mono text-zinc-300 hover:text-white"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmDeleteTrackId(track.id)
                                      }
                                      data-testid={`delete-jellyfin-track-${track.id}`}
                                      title="Permanently delete duplicate track from Jellyfin server hard drive (DELETE /api/jellyfin/items/:id)"
                                      className="inline-flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 hover:border-rose-500/50 hover:text-rose-400 p-2 text-zinc-500 transition-colors min-h-[36px] min-w-[36px]"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </>
                              )}

                              <button
                                type="button"
                                onClick={() => audio.queueTrackNext(track)}
                                title="Queue to Play Next"
                                className="hidden sm:inline-flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-950 hover:border-[#00ff66]/50 hover:text-[#00ff66] px-2.5 py-2 text-xs font-mono font-medium text-zinc-400 transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
                              >
                                <ListPlus className="w-3.5 h-3.5" />
                                <span>Queue Next</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  if (isCurrent) {
                                    audio.togglePlayPause();
                                  } else {
                                    audio.playSpecificTrack(
                                      track,
                                      displayedTracks
                                    );
                                  }
                                }}
                                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-mono font-bold transition-colors whitespace-nowrap shrink-0 min-h-[36px] ${
                                  isCurrent && audio.isPlaying
                                    ? 'bg-[#00ff66] text-zinc-950'
                                    : 'bg-zinc-800 hover:bg-[#00ff66] hover:text-zinc-950 text-white'
                                }`}
                              >
                                {isCurrent && audio.isPlaying ? (
                                  <>
                                    <Pause className="w-3.5 h-3.5 fill-current" />
                                    <span>Pause</span>
                                  </>
                                ) : (
                                  <>
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                    <span>Play</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* SUB-TAB 3: ALBUMS GRID */}
            {librarySubTab === 'albums' && (
              <section
                aria-label="Albums Grid"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {albumGroups.map((group) => (
                  <div
                    key={group.album}
                    className="winamp-bezel rounded-2xl border border-zinc-800/90 p-4 flex flex-col justify-between gap-4"
                  >
                    <div className="flex items-center gap-3.5">
                      <img
                        src={group.artworkUrl}
                        alt={group.album}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = createAlbumArtworkDataUri(
                            group.album,
                            group.artist,
                            '#10b981',
                            '#09090b'
                          );
                        }}
                        className="w-16 h-16 rounded-xl border border-zinc-800 object-cover shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold text-white truncate">
                          {group.album}
                        </h3>
                        <p className="text-xs text-zinc-400 truncate mt-0.5">
                          {group.artist}
                        </p>
                        <p className="text-[11px] font-mono text-[#00ff66] mt-1">
                          {group.tracks.length} tracks
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/70">
                      <button
                        type="button"
                        onClick={() =>
                          audio.playSpecificTrack(group.tracks[0], group.tracks)
                        }
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 py-2 px-3 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[36px]"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Play Album</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const shuffled = smartAntiRepeatShuffle(
                            group.tracks,
                            audio.smartAntiRepeatEnabled
                          );
                          audio.playSpecificTrack(shuffled[0], shuffled);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#a855f7] hover:bg-purple-400 py-2 px-3 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[36px]"
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                        <span>Shuffle 🔀</span>
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* SUB-TAB 4: ARTISTS GRID */}
            {librarySubTab === 'artists' && (
              <section
                aria-label="Artists Grid"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {artistGroups.map((group) => (
                  <div
                    key={group.artist}
                    className="winamp-bezel rounded-2xl border border-zinc-800/90 p-4 flex flex-col justify-between gap-4"
                  >
                    <div className="flex items-center gap-3.5">
                      <img
                        src={group.artworkUrl}
                        alt={group.artist}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = createAlbumArtworkDataUri(
                            group.artist,
                            'Artist',
                            '#a855f7',
                            '#09090b'
                          );
                        }}
                        className="w-14 h-14 rounded-full border border-zinc-800 object-cover shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold text-white truncate">
                          {group.artist}
                        </h3>
                        <p className="text-[11px] font-mono text-zinc-400 mt-1">
                          {group.tracks.length} tracks in library
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/70">
                      <button
                        type="button"
                        onClick={() =>
                          audio.playSpecificTrack(group.tracks[0], group.tracks)
                        }
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 py-2 px-3 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[36px]"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Play</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const shuffled = smartAntiRepeatShuffle(
                            group.tracks,
                            audio.smartAntiRepeatEnabled
                          );
                          audio.playSpecificTrack(shuffled[0], shuffled);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#a855f7] hover:bg-purple-400 py-2 px-3 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[36px]"
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                        <span>Shuffle 🔀</span>
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

        {/* =====================================================================
            TAB 1B: REQUEST MUSIC / DISCOVER (EXPLO REPLACEMENT: MUSICBRAINZ + LISTENBRAINZ + SLSKD)
           ===================================================================== */}
        {activeTab === 'discover' && (
          <RequestDiscoverView
            catalog={allTracks}
            integrations={serverIntegrations}
            jobs={slskdJobs}
            onPlayTrack={(track) => audio.playSpecificTrack(track, allTracks)}
            onRefreshStatus={fetchSlskdStatus}
            onOpenSettingsSources={() => {
              setActiveTab('settings');
              setSettingsSubTab('sources');
            }}
            onShowToast={(msg) => setToastMessage(msg)}
          />
        )}

        {/* =====================================================================
            TAB 2: NOW PLAYING & QUEUE ('99 RETRO STEREO DECK)
           ===================================================================== */}
        {activeTab === 'nowplaying' && (
          <section
            aria-label="Now Playing and Active Queue"
            className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
          >
            {/* Left 7 Columns: Main Stereo Deck + Dancing Wavy Visualizer + Scrubber + Transport */}
            <div className="lg:col-span-7 winamp-bezel rounded-3xl border border-zinc-700/80 overflow-hidden">
              <div className="winamp-titlebar px-5 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-700/80">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-[#00ff66]" />
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-white">
                    STEREO MAIN DECK //{' '}
                    {audio.currentTrack?.sourceName || 'READY'}
                  </span>
                  {audio.currentTrack &&
                    audio.cachedTrackIds.has(audio.currentTrack.id) && (
                      <span
                        data-testid="nowplaying-preloaded-badge"
                        className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66]"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Pre-Loaded &amp; Ready
                      </span>
                    )}
                </div>

                <button
                  type="button"
                  onClick={() => setIsCarModeOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3.5 py-1.5 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[34px]"
                >
                  <Car className="w-4 h-4" />
                  <span>Car Mode 🚗</span>
                </button>
              </div>

              <div className="p-5 sm:p-7 space-y-5">
                {audio.currentTrack ? (
                  <>
                    {/* Track Metadata LCD Banner */}
                    <div className="winamp-lcd rounded-2xl border border-zinc-800 p-4 flex flex-col sm:flex-row items-center gap-5">
                      <img
                        src={audio.currentTrack.artworkUrl}
                        alt={audio.currentTrack.title}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = createAlbumArtworkDataUri(
                            audio.currentTrack?.title || 'Brokeify',
                            audio.currentTrack?.artist || 'Artist',
                            audio.currentTrack?.accentColor || '#10b981',
                            '#09090b'
                          );
                        }}
                        className="w-28 h-28 sm:w-32 sm:h-32 rounded-xl border border-zinc-700 object-cover shadow-2xl shrink-0"
                      />

                      <div className="space-y-1.5 text-center sm:text-left min-w-0 flex-1">
                        <h2 className="text-xl sm:text-2xl font-bold text-white truncate">
                          {audio.currentTrack.title}
                        </h2>
                        <p className="text-sm sm:text-base text-[#00ff66] font-mono font-semibold truncate">
                          {audio.currentTrack.artist}
                        </p>
                        <p className="text-xs text-zinc-400 truncate">
                          {audio.currentTrack.album}
                        </p>
                        <div className="pt-1 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-[11px] font-mono text-zinc-300">
                          <span className="rounded bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[#00ff66]">
                            {audio.stabilizationProfile.profileLabel}
                          </span>
                          <span className="rounded bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-sky-400">
                            Crossfade:{' '}
                            {audio.crossfadeSeconds > 0
                              ? `${audio.crossfadeSeconds}s`
                              : 'OFF'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 90s / Early 2000s Winamp + MilkDrop Wavy Oscilloscope & Spectrum Visualizer */}
                    <WinampVisualizer
                      currentTrack={audio.currentTrack}
                      isPlaying={audio.isPlaying}
                      frequencyData={audio.frequencyData}
                      waveformData={audio.waveformData}
                      crossfadeSeconds={audio.crossfadeSeconds}
                      isCrossfading={audio.isCrossfading}
                      stabilizerStrength={audio.stabilizerStrength}
                      carVolumeLeveler={audio.carVolumeLeveler}
                    />

                    {/* Live Scrubber */}
                    <div className="space-y-1.5">
                      <input
                        type="range"
                        min={0}
                        max={Math.max(1, audio.duration)}
                        value={audio.currentTime}
                        aria-label="Track playback position"
                        onChange={(e) =>
                          audio.seekTo(parseFloat(e.target.value))
                        }
                        className="w-full cursor-pointer"
                      />
                      <div className="flex justify-between text-xs font-mono tabular-nums text-[#00ff66]">
                        <span>{formatDuration(audio.currentTime)}</span>
                        <span>{formatDuration(audio.duration)}</span>
                      </div>
                    </div>

                    {/* Primary Transport Controls */}
                    <div className="flex items-center justify-between gap-4">
                      <button
                        type="button"
                        onClick={audio.toggleShuffle}
                        aria-label="Toggle Shuffle"
                        className={`p-3 rounded-xl border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
                          audio.shuffleEnabled
                            ? 'border-[#00ff66] bg-emerald-500/15 text-[#00ff66]'
                            : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white'
                        }`}
                      >
                        <Shuffle className="w-5 h-5" />
                      </button>

                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={audio.playPrevious}
                          aria-label="Previous Track"
                          className="p-3.5 rounded-2xl border border-zinc-700 bg-zinc-900 text-white hover:bg-zinc-800 min-h-[48px] min-w-[48px] flex items-center justify-center"
                        >
                          <SkipBack className="w-6 h-6" />
                        </button>

                        <button
                          type="button"
                          onClick={audio.togglePlayPause}
                          aria-label={audio.isPlaying ? 'Pause' : 'Play'}
                          className="w-16 h-16 rounded-2xl bg-[#00ff66] hover:bg-emerald-400 text-zinc-950 flex items-center justify-center shadow-lg"
                        >
                          {audio.isPlaying ? (
                            <Pause className="w-7 h-7 fill-current" />
                          ) : (
                            <Play className="w-7 h-7 fill-current" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={audio.playNext}
                          aria-label="Next Track"
                          className="p-3.5 rounded-2xl border border-zinc-700 bg-zinc-900 text-white hover:bg-zinc-800 min-h-[48px] min-w-[48px] flex items-center justify-center"
                        >
                          <SkipForward className="w-6 h-6" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={audio.cycleRepeatMode}
                        aria-label={`Repeat mode: ${audio.repeatMode}`}
                        className={`p-3 rounded-xl border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
                          audio.repeatMode !== 'off'
                            ? 'border-purple-500/50 bg-purple-500/15 text-purple-300'
                            : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white'
                        }`}
                      >
                        {audio.repeatMode === 'one' ? (
                          <Repeat1 className="w-5 h-5" />
                        ) : (
                          <Repeat className="w-5 h-5" />
                        )}
                      </button>
                    </div>

                    {/* Volume Slider & Quick Stabilizer / EQ Strip */}
                    <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-zinc-800/80">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (!audio.carVolumeLeveler) {
                              audio.setCarVolumeLeveler(true);
                              audio.setStabilizerStrength('aggressive');
                            } else if (
                              audio.stabilizerStrength === 'aggressive'
                            ) {
                              audio.setStabilizerStrength('normal');
                            } else {
                              audio.setCarVolumeLeveler(false);
                              audio.setStabilizerStrength('off');
                            }
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-mono font-bold transition-colors min-h-[38px] ${
                            audio.carVolumeLeveler
                              ? 'bg-emerald-500/20 text-[#00ff66] border border-emerald-500/40'
                              : 'bg-zinc-950 text-zinc-400 border border-zinc-800'
                          }`}
                        >
                          <Gauge className="w-3.5 h-3.5" />
                          <span>
                            Stabilizer:{' '}
                            {!audio.carVolumeLeveler
                              ? 'OFF'
                              : audio.stabilizerStrength === 'aggressive'
                              ? 'AGGRESSIVE (FLAC/MP3)'
                              : 'STANDARD'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('settings');
                            setSettingsSubTab('audiolab');
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono font-medium text-zinc-300 hover:text-white min-h-[38px]"
                        >
                          <Sliders className="w-3.5 h-3.5 text-purple-400" />
                          <span>EQ: {audio.eqPreset}</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => audio.setIsMuted(!audio.isMuted)}
                          aria-label={audio.isMuted ? 'Unmute' : 'Mute'}
                          className="p-2 text-zinc-400 hover:text-white"
                        >
                          {audio.isMuted ? (
                            <VolumeX className="w-4 h-4 text-rose-400" />
                          ) : (
                            <Volume2 className="w-4 h-4" />
                          )}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.02}
                          value={audio.isMuted ? 0 : audio.volume}
                          aria-label="Master Volume"
                          onChange={(e) =>
                            audio.setVolume(parseFloat(e.target.value))
                          }
                          className="w-28 cursor-pointer"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-12 text-center text-sm font-mono text-zinc-400">
                    Select any playlist or song to start playback.
                  </div>
                )}
              </div>
            </div>

            {/* Right 5 Columns: Up Next Queue + Crossfade Slider + Offline Queue Slider (2 to 12 Tracks) */}
            <aside className="lg:col-span-5 winamp-bezel rounded-3xl border border-zinc-700/80 overflow-hidden">
              <div className="winamp-titlebar px-5 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-700/80">
                <div>
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
                    UP NEXT QUEUE ({audio.queue.length})
                  </h3>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const nextVal = !audio.smartAntiRepeatEnabled;
                      audio.setSmartAntiRepeatEnabled(nextVal);
                      if (nextVal && audio.queue.length > 1) {
                        const deduped = dedupeAndSpreadTracks(
                          audio.queue,
                          true
                        );
                        audio.setQueue(deduped);
                      }
                      setToastMessage(
                        nextVal
                          ? '🛡️ Smart Anti-Repeat ON: Duplicate song copies blocked from playing back-to-back'
                          : 'Smart Anti-Repeat Off'
                      );
                    }}
                    data-testid="nowplaying-antirepeat-btn"
                    title="Smart Anti-Repeat & Duplicate Song Guard: Never play duplicate downloads of the same song back-to-back"
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-mono font-bold transition-colors min-h-[32px] ${
                      audio.smartAntiRepeatEnabled
                        ? 'border-emerald-500/60 bg-emerald-500/15 text-[#00ff66]'
                        : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>
                      No Back-to-Back:{' '}
                      {audio.smartAntiRepeatEnabled ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (audio.queue.length > 0) {
                        const shuffled = smartAntiRepeatShuffle(
                          audio.queue,
                          audio.smartAntiRepeatEnabled
                        );
                        audio.playSpecificTrack(shuffled[0], shuffled);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#a855f7] hover:bg-purple-400 px-3 py-1 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[32px]"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                    <span>Shuffle</span>
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-4">
                {/* Interactive Sliders for Seamless Crossfade (0-12s) & Offline Queue Preloader (2-12 Tracks) */}
                <div className="winamp-lcd rounded-2xl border border-zinc-800 p-3.5 space-y-3">
                  {/* Slider 1: Seamless Crossfade */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-zinc-300 inline-flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        <span>Seamless Crossfade:</span>
                      </span>
                      <span
                        data-testid="nowplaying-crossfade-label"
                        className="text-[#00ff66] font-bold tabular-nums"
                      >
                        {audio.crossfadeSeconds === 0
                          ? 'OFF (0s)'
                          : `${audio.crossfadeSeconds}s`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={12}
                      step={1}
                      value={audio.crossfadeSeconds}
                      aria-label="Now Playing Crossfade Duration in Seconds"
                      data-testid="nowplaying-crossfade-slider"
                      onChange={(e) =>
                        audio.setCrossfadeSeconds(parseInt(e.target.value, 10))
                      }
                      className="w-full cursor-pointer"
                    />
                  </div>

                  {/* Slider 2: Offline Queue Lookahead Preloader (2 to 12 Tracks) */}
                  <div className="space-y-1 pt-2 border-t border-zinc-800/80">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-zinc-300 inline-flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-[#00ff66]" />
                        <span>Offline Queue Preloader:</span>
                      </span>
                      <span
                        data-testid="nowplaying-preload-label"
                        className="text-[#00ff66] font-bold tabular-nums"
                      >
                        {audio.offlinePreloadCount} Tracks
                      </span>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={12}
                      step={1}
                      value={audio.offlinePreloadCount}
                      aria-label="Offline Queue Lookahead Track Count (2 to 12)"
                      data-testid="nowplaying-preload-slider"
                      onChange={(e) =>
                        audio.setOfflinePreloadCount(
                          parseInt(e.target.value, 10)
                        )
                      }
                      className="w-full cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                      <span>2 tracks</span>
                      <span>6 tracks</span>
                      <span>12 tracks (Dead-Zone)</span>
                    </div>
                  </div>
                </div>

                {/* Queue List (Clean, zero "More Like This" clutter) */}
                <div className="divide-y divide-zinc-800/60 max-h-[420px] overflow-y-auto pr-1">
                  {audio.queue.map((qTrack, idx) => {
                    const isCurrent = idx === audio.currentIndex;
                    const isCached = audio.cachedTrackIds.has(qTrack.id);
                    const isPreloading = audio.preloadingTrackIds.has(
                      qTrack.id
                    );

                    return (
                      <div
                        key={`${qTrack.id}-np-${idx}`}
                        className={`py-2.5 px-2 rounded-xl flex items-center justify-between gap-2 ${
                          isCurrent ? 'bg-emerald-500/15' : ''
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-mono font-semibold text-white truncate">
                            {isCurrent
                              ? '▶ '
                              : `${String(idx + 1).padStart(2, '0')}. `}
                            {qTrack.title}
                          </div>
                          <div className="text-[11px] text-zinc-400 flex items-center gap-1.5 mt-0.5">
                            <span className="truncate">{qTrack.artist}</span>
                            <span>·</span>
                            {isPreloading ? (
                              <span className="text-amber-300 font-mono">
                                Pre-loading...
                              </span>
                            ) : isCached ? (
                              <span className="text-[#00ff66] font-mono font-semibold">
                                Pre-Loaded &amp; Ready
                              </span>
                            ) : (
                              <span className="font-mono">
                                {qTrack.sourceName}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => audio.playSpecificTrack(qTrack)}
                            className="rounded-lg bg-zinc-800 hover:bg-[#00ff66] hover:text-zinc-950 px-2.5 py-1 text-xs font-mono font-semibold text-zinc-200 transition-colors min-h-[32px]"
                          >
                            Play
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </aside>
          </section>
        )}

        {/* =====================================================================
            TAB 3: SETTINGS & TOOLS
           ===================================================================== */}
        {activeTab === 'settings' && (
          <section aria-label="Settings and Tools" className="space-y-6">
            {/* Settings Sub-Navigation Header */}
            <div className="winamp-bezel rounded-2xl border border-zinc-700/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-lg font-bold text-white font-mono">
                  Settings
                </h1>
                <p className="text-xs text-zinc-400">
                  Manage your Jellyfin/Navidrome servers, FLAC/MP3 Stabilizer,
                  Crossfade, Offline Queue Vault, and Spotify Importer.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsOnboardingOpen(true)}
                  data-testid="settings-manage-providers-btn"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 px-3.5 py-2 text-xs font-mono font-bold text-white shadow-sm shadow-purple-500/20 transition-colors min-h-[38px]"
                >
                  <Server className="w-3.5 h-3.5" />
                  <span>Manage Providers</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSettingsSubTab('sources')}
                  data-testid="settings-subtab-sources"
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-mono font-bold transition-colors min-h-[38px] ${
                    settingsSubTab === 'sources'
                      ? 'bg-[#00ff66] text-zinc-950'
                      : 'bg-zinc-950 text-zinc-300 hover:text-white border border-zinc-800'
                  }`}
                >
                  <Server className="w-3.5 h-3.5" />
                  <span>Sources Hub</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSettingsSubTab('audiolab')}
                  data-testid="settings-subtab-audiolab"
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-mono font-bold transition-colors min-h-[38px] ${
                    settingsSubTab === 'audiolab'
                      ? 'bg-[#00ff66] text-zinc-950'
                      : 'bg-zinc-950 text-zinc-300 hover:text-white border border-zinc-800'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Audio Lab, EQ &amp; Offline Vault</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSettingsSubTab('spotify')}
                  data-testid="settings-subtab-spotify"
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-mono font-bold transition-colors min-h-[38px] ${
                    settingsSubTab === 'spotify'
                      ? 'bg-[#00ff66] text-zinc-950'
                      : 'bg-zinc-950 text-zinc-300 hover:text-white border border-zinc-800'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Spotify Importer</span>
                </button>
              </div>
            </div>

            {/* Visual Theme & Classic Skin Selector (Dark & Light Skins with CSS Filter Overlays) */}
            <div
              data-testid="visual-theme-selector-section"
              className="winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden"
            >
              <div className="winamp-titlebar px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-700/80">
                <div className="flex items-center gap-2">
                  <Palette className="w-4 h-4 text-[#00ff66] shrink-0" />
                  <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
                    VISUAL THEME // DARK &amp; LIGHT RETRO SKINS
                  </h2>
                </div>
                <span className="text-[11px] font-mono text-[#00ff66]">
                  Active Skin: {activeVisualSkin.name} ({activeVisualSkin.mode.toUpperCase()})
                </span>
              </div>

              <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {VISUAL_THEMES.map((skin) => {
                  const isSelected = audio.visualTheme === skin.id;
                  return (
                    <button
                      key={skin.id}
                      type="button"
                      onClick={() => {
                        audio.setVisualTheme(skin.id);
                        setToastMessage(
                          `🎨 Applied "${skin.name}" (${skin.mode === 'light' ? 'Light Skin' : 'Dark Skin'})`
                        );
                      }}
                      data-testid={`visual-theme-option-${skin.id}`}
                      className={`rounded-xl border p-3.5 text-left transition-all flex flex-col justify-between gap-2.5 ${
                        isSelected
                          ? 'border-[#00ff66] bg-emerald-500/15 ring-1 ring-[#00ff66]/50 shadow-md'
                          : 'border-zinc-800 bg-zinc-950/80 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {skin.mode === 'light' ? (
                              <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            ) : (
                              <Moon className="w-3.5 h-3.5 text-[#00ff66] shrink-0" />
                            )}
                            <span className="text-sm font-bold text-white truncate">
                              {skin.name}
                            </span>
                          </div>
                          <span className="inline-block mt-1 rounded bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-[9px] font-mono font-bold text-zinc-300 uppercase">
                            {skin.badge}
                          </span>
                        </div>

                        {/* Swatch Preview Dots */}
                        <div className="flex items-center gap-1 shrink-0">
                          {skin.swatches.map((hex, i) => (
                            <span
                              key={`${skin.id}-swatch-${i}`}
                              className="w-4 h-4 rounded-full border border-zinc-600 shadow-inner"
                              style={{ backgroundColor: hex }}
                            />
                          ))}
                        </div>
                      </div>

                      <p className="text-xs text-zinc-400 leading-relaxed">
                        {skin.description}
                      </p>

                      <div className="pt-1.5 border-t border-zinc-800/80 flex items-center justify-between text-[10px] font-mono">
                        <span className="text-zinc-500 truncate">
                          Filter: {skin.cssFilter === 'none' ? 'Native Deck' : skin.cssFilter}
                        </span>
                        <span
                          className={`font-bold shrink-0 ${
                            isSelected ? 'text-[#00ff66]' : 'text-zinc-400'
                          }`}
                        >
                          {isSelected ? '● ACTIVE' : 'Select'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {settingsSubTab === 'sources' && (
              <SourcesHubView
                providers={providers}
                onUpdateProviders={handleUpdateProviders}
                onMergeRemoteTracks={handleMergeRemoteTracks}
                onMergeRemotePlaylists={handleMergeRemotePlaylists}
                storagePersistStatus={storagePersistStatus}
                cloudSyncStatus={cloudSyncStatus}
                onPushCloudSettings={() => handlePushCloudSettings()}
                onPullCloudSettings={(cfg) => handlePullCloudSettings(cfg)}
                onApplyRestoredCloudSettings={handleApplyRestoredCloudSettings}
                onOpenOnboardingModal={() => setIsOnboardingOpen(true)}
                onLogoutProvider={handleLogoutProvider}
                serverIntegrations={serverIntegrations}
                serverConfigPath={serverConfigPath}
                onUpdateServerIntegrations={(next) => {
                  setServerIntegrations(next);
                }}
                onSaveServerConfigNow={async () => {
                  await saveConfigToServer(serverIntegrations);
                  setToastMessage(
                    `💾 Saved configuration & keys to ${serverConfigPath}`
                  );
                }}
              />
            )}

            {settingsSubTab === 'audiolab' && (
              <div className="space-y-6">
                <div className="winamp-bezel rounded-2xl border border-zinc-700/80 p-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3.5 py-2 flex items-center">
                      <SlidingToggle
                        checked={offlineOnlyMode}
                        onChange={setOfflineOnlyMode}
                        label={`Offline Only Mode (${audio.cachedTrackIds.size} cached)`}
                        ariaLabel="Toggle Offline Only Mode"
                        size="sm"
                        testId="settings-toggle-offline-mode"
                      />
                    </div>
                  </div>
                </div>

                <AudioLabVaultView
                  currentTrack={audio.currentTrack}
                  allTracks={allTracks}
                  carVolumeLeveler={audio.carVolumeLeveler}
                  onToggleCarVolumeLeveler={audio.setCarVolumeLeveler}
                  stabilizerStrength={audio.stabilizerStrength}
                  onChangeStabilizerStrength={audio.setStabilizerStrength}
                  lufsNormalizationEnabled={audio.lufsNormalizationEnabled}
                  onToggleLufsNormalization={audio.setLufsNormalizationEnabled}
                  smartAntiRepeatEnabled={audio.smartAntiRepeatEnabled}
                  onToggleSmartAntiRepeat={audio.setSmartAntiRepeatEnabled}
                  crossfadeSeconds={audio.crossfadeSeconds}
                  onChangeCrossfadeSeconds={audio.setCrossfadeSeconds}
                  offlinePreloadCount={audio.offlinePreloadCount}
                  onChangeOfflinePreloadCount={audio.setOfflinePreloadCount}
                  streamBufferSeconds={audio.streamBufferSeconds}
                  onChangeStreamBufferSeconds={audio.setStreamBufferSeconds}
                  bufferedAheadSeconds={audio.bufferedAheadSeconds}
                  eqPreset={audio.eqPreset}
                  eqGains={audio.eqGains}
                  onApplyPreset={audio.applyEqPreset}
                  onUpdateBand={audio.updateEqBand}
                  cachedTrackIds={audio.cachedTrackIds}
                  vaultTotalBytes={audio.vaultTotalBytes}
                  onRefreshVault={audio.refreshVaultState}
                  onPlayTrack={(track) =>
                    audio.playSpecificTrack(track, allTracks)
                  }
                />
              </div>
            )}

            {settingsSubTab === 'spotify' && (
              <SpotifyImporterView
                catalog={allTracks}
                onPlayTrack={(track) =>
                  audio.playSpecificTrack(track, allTracks)
                }
                onSaveResolvedPlaylist={(pl) => {
                  handleSaveResolvedPlaylist(pl);
                  setActiveTab('library');
                }}
              />
            )}

            {/* Single Buy Me a Coffee Footer at the Bottom of the Settings Page */}
            <footer className="winamp-bezel rounded-2xl border border-amber-500/30 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <Coffee className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Enjoying Brokeify in your car or home lab?</span>
                </div>
                <p className="text-xs text-zinc-400">
                  100% free, zero ads, zero paywalls, and zero subscriptions
                  forever.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsBmcModalOpen(true)}
                data-testid="footer-bmc-btn"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#f59e0b] hover:bg-amber-400 px-5 py-2.5 text-xs font-bold text-zinc-950 shadow-md shadow-amber-500/15 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                <Coffee className="w-4 h-4" />
                <span>Buy Me a Coffee</span>
              </button>
            </footer>
          </section>
        )}
      </main>

      {/* Persistent Winamp-Styled Bottom Player Bar + Mobile 3-Tab Bottom Navigation */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-zinc-700/80 winamp-titlebar backdrop-blur-lg">
        {/* Thin Progress Line */}
        <div className="w-full h-0.5 bg-zinc-950">
          <div
            className="h-full bg-[#00ff66] transition-all duration-150"
            style={{
              width: `${Math.min(
                100,
                (audio.currentTime / Math.max(1, audio.duration)) * 100
              )}%`,
            }}
          />
        </div>

        {/* Player Deck Row */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-1.5 sm:py-2.5 flex items-center justify-between gap-3">
          {/* Current Track Info (Click to open Now Playing Drawer) */}
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            className="flex items-center gap-3 min-w-0 flex-1 sm:flex-initial sm:w-80 text-left group"
          >
            {audio.currentTrack && (
              <img
                src={audio.currentTrack.artworkUrl}
                alt={audio.currentTrack.title}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = createAlbumArtworkDataUri(
                    audio.currentTrack?.title || 'Brokeify',
                    audio.currentTrack?.artist || 'Jellyfin',
                    '#10b981',
                    '#09090b'
                  );
                }}
                className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl border border-zinc-700 object-cover shrink-0"
              />
            )}
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="text-xs sm:text-sm font-bold text-white group-hover:text-[#00ff66] transition-colors truncate">
                {audio.currentTrack?.title || 'Select a track'}
              </div>
              <div className="text-[11px] sm:text-xs text-zinc-400 truncate flex items-center gap-1.5">
                <span className="truncate">{audio.currentTrack?.artist}</span>
                {audio.isBuffering ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-300 font-mono font-semibold inline-flex items-center gap-1 whitespace-nowrap">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Buffering {audio.streamBufferSeconds}s...
                    </span>
                  </>
                ) : (
                  audio.currentTrack &&
                  audio.cachedTrackIds.has(audio.currentTrack.id) && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-[#00ff66] font-mono whitespace-nowrap">
                        Vaulted
                      </span>
                    </>
                  )
                )}
              </div>
            </div>
            <ChevronUp className="w-4 h-4 text-zinc-400 group-hover:text-white shrink-0" />
          </button>

          {/* Center Transport Controls: Prev, Play/Pause, Prominent Skip Song, and Shuffle */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={audio.playPrevious}
              aria-label="Previous track"
              className="p-2 rounded-xl text-zinc-300 hover:bg-zinc-900 hover:text-white min-h-[38px] min-w-[38px] flex items-center justify-center"
            >
              <SkipBack className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <button
              type="button"
              onClick={audio.togglePlayPause}
              aria-label={audio.isPlaying ? 'Pause' : 'Play'}
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#00ff66] hover:bg-emerald-400 text-zinc-950 flex items-center justify-center shadow-md"
            >
              {audio.isPlaying ? (
                <Pause className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
              ) : (
                <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
              )}
            </button>

            <button
              type="button"
              onClick={audio.playNext}
              aria-label="Skip Song"
              title="Skip Song"
              data-testid="bottombar-skip-song-btn"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-500/50 bg-zinc-900/90 hover:bg-zinc-800 text-[#00ff66] font-mono text-xs font-bold min-h-[38px]"
            >
              <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden xs:inline sm:inline">Skip</span>
            </button>

            <button
              type="button"
              onClick={() => {
                audio.toggleShuffle();
                setToastMessage(
                  !audio.shuffleEnabled
                    ? '🔀 Queue Shuffle Enabled'
                    : 'Queue Shuffle Off'
                );
              }}
              aria-label="Toggle Shuffle Queue"
              title="Mix / Shuffle Queue"
              data-testid="bottombar-shuffle-btn"
              className={`inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border font-mono text-xs font-bold min-h-[38px] transition-colors ${
                audio.shuffleEnabled
                  ? 'border-purple-500/70 bg-purple-500/20 text-purple-300'
                  : 'border-zinc-800 bg-zinc-900/80 text-zinc-300 hover:text-white'
              }`}
            >
              <Shuffle className="w-4 h-4" />
              <span className="hidden sm:inline">Shuffle</span>
            </button>

            <button
              type="button"
              onClick={audio.cycleRepeatMode}
              aria-label={`Repeat mode: ${audio.repeatMode}`}
              title={`Repeat: ${audio.repeatMode.toUpperCase()}`}
              className={`hidden sm:flex p-2 rounded-xl min-h-[38px] min-w-[38px] items-center justify-center transition-colors ${
                audio.repeatMode !== 'off'
                  ? 'text-[#00ff66] bg-emerald-500/15'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {audio.repeatMode === 'one' ? (
                <Repeat1 className="w-4 h-4 sm:w-5 sm:h-5" />
              ) : (
                <Repeat className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </button>
          </div>

          {/* Right Desktop Scrubber & Volume */}
          <div className="hidden lg:flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-[#00ff66]">
              <span>{formatDuration(audio.currentTime)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, audio.duration)}
                value={audio.currentTime}
                aria-label="Seek track position"
                onChange={(e) => audio.seekTo(parseFloat(e.target.value))}
                className="w-28 cursor-pointer"
              />
              <span>{formatDuration(audio.duration)}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => audio.setIsMuted(!audio.isMuted)}
                aria-label={audio.isMuted ? 'Unmute audio' : 'Mute audio'}
                className="p-2 text-zinc-400 hover:text-white min-h-[38px] min-w-[38px] flex items-center justify-center"
              >
                {audio.isMuted ? (
                  <VolumeX className="w-4 h-4 text-rose-400" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={audio.isMuted ? 0 : audio.volume}
                aria-label="Audio Volume"
                onChange={(e) => audio.setVolume(parseFloat(e.target.value))}
                className="w-20 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Responsive Mobile 4-Tab Bottom Navigation Bar */}
        <nav
          aria-label="Mobile Bottom Navigation"
          className="md:hidden grid grid-cols-4 border-t border-zinc-800/80 bg-[#070a0f] h-12"
        >
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className={`flex flex-col items-center justify-center min-h-[44px] ${
              activeTab === 'library' ? 'text-[#00ff66]' : 'text-zinc-400'
            }`}
          >
            <ListMusic className="w-4 h-4" />
            <span className="text-[10px] font-mono font-semibold mt-0.5">
              Library
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('discover')}
            className={`flex flex-col items-center justify-center min-h-[44px] ${
              activeTab === 'discover' ? 'text-[#00ff66]' : 'text-zinc-400'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span className="text-[10px] font-mono font-semibold mt-0.5">
              Discover
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('nowplaying')}
            className={`flex flex-col items-center justify-center min-h-[44px] ${
              activeTab === 'nowplaying' ? 'text-[#00ff66]' : 'text-zinc-400'
            }`}
          >
            <Radio className="w-4 h-4" />
            <span className="text-[10px] font-mono font-semibold mt-0.5">
              Playing
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center justify-center min-h-[44px] ${
              activeTab === 'settings' ? 'text-[#00ff66]' : 'text-zinc-400'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span className="text-[10px] font-mono font-semibold mt-0.5">
              Settings
            </span>
          </button>
        </nav>
      </div>

      {/* Slide-Up Now Playing Drawer */}
      <NowPlayingDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        currentTrack={audio.currentTrack}
        queue={audio.queue}
        currentIndex={audio.currentIndex}
        isPlaying={audio.isPlaying}
        currentTime={audio.currentTime}
        duration={audio.duration}
        volume={audio.volume}
        isMuted={audio.isMuted}
        shuffleEnabled={audio.shuffleEnabled}
        repeatMode={audio.repeatMode}
        carVolumeLeveler={audio.carVolumeLeveler}
        stabilizerStrength={audio.stabilizerStrength}
        crossfadeSeconds={audio.crossfadeSeconds}
        onChangeCrossfadeSeconds={audio.setCrossfadeSeconds}
        isCrossfading={audio.isCrossfading}
        offlinePreloadCount={audio.offlinePreloadCount}
        onChangeOfflinePreloadCount={audio.setOfflinePreloadCount}
        eqPreset={audio.eqPreset}
        cachedTrackIds={audio.cachedTrackIds}
        preloadingTrackIds={audio.preloadingTrackIds}
        frequencyData={audio.frequencyData}
        waveformData={audio.waveformData}
        onTogglePlayPause={audio.togglePlayPause}
        onNext={audio.playNext}
        onPrevious={audio.playPrevious}
        onSeek={audio.seekTo}
        onVolumeChange={audio.setVolume}
        onToggleMute={() => audio.setIsMuted(!audio.isMuted)}
        onToggleShuffle={audio.toggleShuffle}
        onCycleRepeat={audio.cycleRepeatMode}
        onToggleCarVolumeLeveler={() =>
          audio.setCarVolumeLeveler(!audio.carVolumeLeveler)
        }
        onPlaySpecificTrack={(track) => audio.playSpecificTrack(track)}
        onOpenCarMode={() => setIsCarModeOpen(true)}
        onOpenAudioLab={() => {
          setActiveTab('settings');
          setSettingsSubTab('audiolab');
        }}
      />

      {/* 1-Tap Giant High-Contrast Car Mode Overlay */}
      <CarModeOverlay
        isOpen={isCarModeOpen}
        onClose={() => setIsCarModeOpen(false)}
        currentTrack={audio.currentTrack}
        isPlaying={audio.isPlaying}
        currentTime={audio.currentTime}
        duration={audio.duration}
        onTogglePlayPause={audio.togglePlayPause}
        onNext={audio.playNext}
        onPrevious={audio.playPrevious}
        onSeek={audio.seekTo}
        repeatMode={audio.repeatMode}
        onCycleRepeat={audio.cycleRepeatMode}
        carVolumeLeveler={audio.carVolumeLeveler}
        onToggleCarVolumeLeveler={audio.setCarVolumeLeveler}
        crossfadeSeconds={audio.crossfadeSeconds}
        onChangeCrossfadeSeconds={audio.setCrossfadeSeconds}
        shuffleEnabled={audio.shuffleEnabled}
        onToggleShuffle={audio.toggleShuffle}
        eqPreset={audio.eqPreset}
        onApplyPreset={audio.applyEqPreset}
        isCurrentTrackCached={
          audio.currentTrack
            ? audio.cachedTrackIds.has(audio.currentTrack.id)
            : false
        }
      />

      {/* Play Store Compliant "Support Indie Development ☕" Modal */}
      <BuyMeACoffeeModal
        isOpen={isBmcModalOpen}
        onClose={() => setIsBmcModalOpen(false)}
      />

      {/* Brokeify First-Run Setup & Jellyfin Quick Connect Modal */}
      <BrokeifyOnboardingModal
        isOpen={isOnboardingOpen}
        canClose={MusicProviderManager.hasCompletedOnboarding(providers)}
        providers={providers}
        onUpdateProviders={handleUpdateProviders}
        onMergeRemoteTracks={handleMergeRemoteTracks}
        onMergeRemotePlaylists={handleMergeRemotePlaylists}
        onApplyRestoredCloudSettings={handleApplyRestoredCloudSettings}
        onShowToast={(msg) => setToastMessage(msg)}
        onCompleteAndLaunchLibrary={() => {
          setIsOnboardingOpen(false);
          setActiveTab('library');
        }}
        onClose={() => setIsOnboardingOpen(false)}
        onLogoutProvider={handleLogoutProvider}
      />
    </div>
  );
}
