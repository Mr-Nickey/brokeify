/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  Car,
  CheckCircle2,
  ChevronUp,
  Coffee,
  Disc,
  Gauge,
  History,
  ListMusic,
  ListPlus,
  Loader2,
  LogOut,
  Music,
  Pause,
  Play,
  Plus,
  Radio,
  Repeat,
  Repeat1,
  Search,
  Server,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  Star,
  Users,
  Volume2,
  VolumeX,
  Wand2,
} from 'lucide-react';
import { BrokeifyLogo } from './components/BrokeifyLogo';
import { BuyMeACoffeeModal } from './components/BuyMeACoffeeModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SlidingToggle } from './components/SlidingToggle';
import { SourcesHubView } from './components/SourcesHubView';
import { SpotifyImporterView } from './components/SpotifyImporterView';
import { AudioLabVaultView } from './components/AudioLabVaultView';
import { CarModeOverlay } from './components/CarModeOverlay';
import { NowPlayingDrawer } from './components/NowPlayingDrawer';
import { BrokeifyOnboardingModal } from './components/BrokeifyOnboardingModal';
import { useAudioEngine } from './hooks/useAudioEngine';
import {
  BUILT_IN_TRACKS,
  MusicProviderManager,
} from './services/MusicProviderManager';
import type {
  BrokeifyCloudSettings,
  CloudSyncStatus,
  Playlist,
  ProviderConfig,
  ProviderType,
  Track,
} from './types/music';
import {
  fisherYatesShuffle,
  mergeProvidersPreservingAuth,
} from './utils/musicLogic';
import { preloadTrackToVault } from './utils/offlineVault';
import { createAlbumArtworkDataUri } from './utils/artworkGenerator';

type CoreTab = 'library' | 'nowplaying' | 'settings';
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

  // Instant Mix Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isGeneratingMix, setIsGeneratingMix] = useState<boolean>(false);

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

  // Call navigator.storage.persist() on app startup and auto-sync Jellyfin if credentials exist
  useEffect(() => {
    let mounted = true;
    MusicProviderManager.ensurePersistentStorage().then((res) => {
      if (mounted) {
        setStoragePersistStatus(res);
      }
    });

    const initialProviders = MusicProviderManager.loadProviders();
    const jfProv = initialProviders.find((p) => p.type === 'jellyfin');
    if (
      jfProv &&
      jfProv.enabled &&
      jfProv.serverUrl?.trim() &&
      (jfProv.token?.trim() || jfProv.password?.trim())
    ) {
      MusicProviderManager.fetchJellyfinMusic(jfProv).then(
        ({ updatedConfig, tracks, playlists: syncedPlaylists }) => {
          if (!mounted) return;
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
                const byId = new Map<string, Playlist>();
                for (const pl of prev) byId.set(pl.id, pl);
                for (const pl of syncedPlaylists) byId.set(pl.id, pl);
                const updated = Array.from(byId.values());
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
    }

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
        pl.source !== 'spotify-import' &&
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

  // Play playlist in order (1 click)
  const handlePlayPlaylistInOrder = (pl: Playlist) => {
    const plTracks = getTracksForPlaylist(pl);
    if (plTracks.length === 0) return;
    audio.playSpecificTrack(plTracks[0], plTracks);
  };

  // Shuffle & Play playlist immediately (1 click)
  const handleShufflePlayPlaylist = (pl: Playlist) => {
    const plTracks = getTracksForPlaylist(pl);
    if (plTracks.length === 0) return;
    const shuffled = fisherYatesShuffle(plTracks);
    audio.playSpecificTrack(shuffled[0], shuffled);
    setToastMessage(`🔀 Shuffling "${pl.name}" (${shuffled.length} tracks)`);
  };

  // "Play More Like This 🪄" Smart AI Instant Mix Engine
  const handleMoreLikeThis = async (seedTrack: Track) => {
    if (isGeneratingMix) return;
    setIsGeneratingMix(true);
    try {
      const jfConfig = providers.find((p) => p.type === 'jellyfin');
      const catalog = allTracks.length > 0 ? allTracks : BUILT_IN_TRACKS;
      const { mixTracks, playlist } =
        await MusicProviderManager.generateInstantMix(
          seedTrack,
          catalog,
          jfConfig
        );

      setPlaylists((prev) => {
        const filtered = prev.filter((p) => p.name !== playlist.name);
        const updated = [playlist, ...filtered];
        MusicProviderManager.savePlaylists(updated);
        return updated;
      });

      if (mixTracks.length > 0) {
        audio.playSpecificTrack(mixTracks[0], mixTracks);
      }
      setToastMessage(`🪄 Created Instant Mix based on ${seedTrack.title}!`);
    } finally {
      setIsGeneratingMix(false);
    }
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
        const byId = new Map<string, Playlist>();
        for (const p of prev) {
          if (p.source !== 'built-in') byId.set(p.id, p);
        }
        for (const p of restored.playlists) {
          if (
            p.source !== 'built-in' &&
            p.id !== 'pl-night-drive' &&
            p.id !== 'pl-spite-anthem'
          ) {
            byId.set(p.id, p);
          }
        }
        const mergedPl = Array.from(byId.values());
        MusicProviderManager.savePlaylists(mergedPl);
        return mergedPl;
      });
    }
    setCloudSyncStatus({
      state: 'restored',
      lastSyncedAt: restored.updatedAt,
      message: `Restored EQ (${restored.audioPrefs.eqPreset}), Car Leveler (${restored.audioPrefs.carVolumeLeveler ? 'ON' : 'OFF'}), servers & playlists from Jellyfin`,
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
        lufsNormalizationEnabled: audio.lufsNormalizationEnabled,
        shuffleEnabled: audio.shuffleEnabled,
        repeatMode: audio.repeatMode,
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

  // Auto-push settings to Jellyfin /DisplayPreferences/brokeify whenever EQ, Car Mode, or Playlists change while Jellyfin is connected
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
        lufsNormalizationEnabled: audio.lufsNormalizationEnabled,
        shuffleEnabled: audio.shuffleEnabled,
        repeatMode: audio.repeatMode,
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
    audio.lufsNormalizationEnabled,
    audio.shuffleEnabled,
    audio.repeatMode,
    providers,
    playlists,
  ]);

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
      audio.setQueue(newTracks);
    }
  };

  const handleMergeRemotePlaylists = (newPlaylists: Playlist[]) => {
    if (newPlaylists.length === 0) return;
    setPlaylists((prev) => {
      const byId = new Map<string, Playlist>();
      for (const pl of prev) byId.set(pl.id, pl);
      for (const pl of newPlaylists) byId.set(pl.id, pl);
      const updated = Array.from(byId.values());
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
      const updated = [newPl, ...prev];
      MusicProviderManager.savePlaylists(updated);
      return updated;
    });
    setSelectedPlaylistId(newPl.id);
    setLibrarySubTab('songs');
  };

  const handleCreateCustomPlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    const pl: Playlist = {
      id: `pl-custom-${Date.now()}`,
      name: newPlaylistName.trim(),
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
      let count = 0;
      for (const track of playlistTracks) {
        await preloadTrackToVault(track);
        count++;
        setDownloadProgress({ done: count, total: playlistTracks.length });
      }
      await audio.refreshVaultState();
      setToastMessage(`Vaulted "${playlist.name}" (${count} tracks) for offline playback!`);
    } finally {
      setDownloadingPlaylistId(null);
      setDownloadProgress(null);
    }
  };

  // Filtered tracks for Songs sub-tab
  const displayedTracks = useMemo(() => {
    const activePlaylist = visiblePlaylists.find(
      (p) => p.id === selectedPlaylistId
    );
    const playlistTrackSet = activePlaylist
      ? new Set(activePlaylist.trackIds)
      : null;

    return allTracks.filter((t) => {
      if (playlistTrackSet && !playlistTrackSet.has(t.id)) {
        return false;
      }
      if (sourceFilter !== 'all' && t.source !== sourceFilter) {
        return false;
      }
      if (offlineOnlyMode && !audio.cachedTrackIds.has(t.id)) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q) ||
          t.sourceName.toLowerCase().includes(q) ||
          (t.genre && t.genre.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [
    allTracks,
    audio.cachedTrackIds,
    offlineOnlyMode,
    searchQuery,
    selectedPlaylistId,
    sourceFilter,
    visiblePlaylists,
  ]);

  // Recently Played tracks resolved
  const recentlyPlayedTracks = useMemo(() => {
    const byId = new Map(allTracks.map((t) => [t.id, t]));
    const list: Track[] = [];
    for (const id of recentTrackIds) {
      const found = byId.get(id);
      if (found) list.push(found);
    }
    return list.length > 0 ? list : allTracks.slice(0, 4);
  }, [allTracks, recentTrackIds]);

  // Grouped Albums for Albums sub-tab
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

  // Grouped Artists for Artists sub-tab
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

  // Dynamic Source Filter Pills: ONLY show sources that are currently toggled ON
  const activeFilterTabs = useMemo(() => {
    const enabledList = providers.filter((p) => p.enabled);
    return [
      { id: 'all' as const, label: 'All Active Sources' },
      ...enabledList.map((p) => ({
        id: p.type,
        label: SOURCE_LABELS[p.type] || p.name,
      })),
    ];
  }, [providers]);

  const activeAmbientColor = audio.currentTrack?.accentColor || '#10b981';

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col pb-40 relative overflow-x-hidden">
      {/* Dynamic Ambient Album-Art Glow Behind Workspace */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-80 opacity-20 transition-all duration-700"
        style={{
          background: `radial-gradient(circle at 50% 0%, ${activeAmbientColor} 0%, transparent 70%)`,
        }}
        aria-hidden="true"
      />

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          data-testid="instant-mix-toast"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 rounded-2xl border border-purple-500/50 bg-zinc-950/95 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-2xl shadow-purple-500/20 flex items-center gap-2.5 backdrop-blur-md"
        >
          <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 1. ULTRA-CLEAN TOP HEADER BAR (No Banner Fluff, 1-Tap Pinned Playlist Shuffle Launcher) */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-[#09090b]/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5">
          {/* Left: BrokeifyLogo size={28} + Brokeify text + Desktop 3-Tab Switcher */}
          <div className="flex items-center gap-5 shrink-0">
            <a
              href="#top"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('library');
              }}
              className="flex items-center gap-2.5 text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
            >
              <BrokeifyLogo size={28} />
              <span>Brokeify</span>
            </a>

            {/* Desktop 3 Core Tabs */}
            <nav
              aria-label="Primary Navigation"
              className="hidden md:flex items-center gap-1 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-1 text-xs font-semibold"
            >
              <button
                type="button"
                onClick={() => setActiveTab('library')}
                data-testid="tab-library"
                className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === 'library'
                    ? 'bg-emerald-500 text-zinc-950 font-bold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Library
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('nowplaying')}
                data-testid="tab-nowplaying"
                className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === 'nowplaying'
                    ? 'bg-emerald-500 text-zinc-950 font-bold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Now Playing &amp; Queue
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                data-testid="tab-settings"
                className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === 'settings'
                    ? 'bg-emerald-500 text-zinc-950 font-bold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Settings
              </button>
            </nav>
          </div>

          {/* Right: Car Mode 🚗 and Settings ⚙️ on the far right (No Shuffle or Coffee buttons in top navbar) */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsCarModeOpen(true)}
              data-testid="navbar-carmode-btn"
              title="Launch 1-Tap Car Driving Mode"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 text-xs font-bold text-zinc-950 transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
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
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors min-h-[36px] ${
                activeTab === 'settings'
                  ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:border-zinc-700'
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
        {/* =====================================================================
            TAB 1: LIBRARY (DEFAULT SCREEN)
           ===================================================================== */}
        {activeTab === 'library' && (
          <div className="space-y-6">
            {/* Hero Quick-Row: Horizontal scrolling cards for "Recently Played" & "Favorite Playlists" */}
            <section
              aria-label="Quick Launch Recently Played and Favorite Playlists"
              className="space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-xs font-mono uppercase tracking-wider text-zinc-400">
                    Quick Launch · Recently Played &amp; Pinned Favorites
                  </h2>
                </div>
                {audio.currentTrack && (
                  <button
                    type="button"
                    onClick={() => handleMoreLikeThis(audio.currentTrack!)}
                    disabled={isGeneratingMix}
                    data-testid="library-hero-more-like-this-btn"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/15 hover:bg-purple-500 hover:text-white px-3 py-1 text-xs font-bold text-purple-300 transition-colors"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>More Like &ldquo;{audio.currentTrack.title}&rdquo; 🪄</span>
                  </button>
                )}
              </div>

              <div className="flex items-stretch gap-3 overflow-x-auto pb-2">
                {/* Pinned Favorite Playlist Quick Card */}
                {pinnedFavoritePlaylist && (
                  <div className="min-w-[260px] sm:min-w-[280px] rounded-2xl border border-purple-500/40 bg-gradient-to-br from-purple-950/40 via-zinc-900/80 to-zinc-950 p-3.5 flex flex-col justify-between gap-3 shrink-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-purple-300">
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                          Favorite Playlist
                        </span>
                        <h3 className="text-sm font-bold text-white truncate mt-0.5">
                          {pinnedFavoritePlaylist.name}
                        </h3>
                      </div>
                      <span className="text-[11px] font-mono text-zinc-400 shrink-0">
                        {getTracksForPlaylist(pinnedFavoritePlaylist).length} tracks
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handlePlayPlaylistInOrder(pinnedFavoritePlaylist)
                        }
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 py-1.5 px-3 text-xs font-bold text-zinc-950 transition-colors min-h-[34px]"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Play</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleShufflePlayPlaylist(pinnedFavoritePlaylist)
                        }
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 py-1.5 px-3 text-xs font-bold text-white transition-colors min-h-[34px]"
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                        <span>Shuffle 🔀</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Recently Played Track Cards */}
                {recentlyPlayedTracks.slice(0, 5).map((track) => {
                  const isCurrent = audio.currentTrack?.id === track.id;
                  return (
                    <div
                      key={`recent-${track.id}`}
                      className={`min-w-[230px] rounded-2xl border p-3 flex items-center justify-between gap-3 shrink-0 transition-colors ${
                        isCurrent
                          ? 'border-emerald-500/60 bg-emerald-500/10'
                          : 'border-zinc-800/90 bg-zinc-900/50 hover:border-zinc-700'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          audio.playSpecificTrack(track, allTracks)
                        }
                        className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
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
                          className="w-11 h-11 rounded-xl border border-zinc-800 object-cover shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-mono uppercase text-emerald-400">
                            Recently Played
                          </div>
                          <div className="text-xs font-bold text-white truncate">
                            {track.title}
                          </div>
                          <div className="text-[11px] text-zinc-400 truncate">
                            {track.artist}
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMoreLikeThis(track)}
                        title={`Play More Like ${track.title} 🪄`}
                        aria-label={`Play More Like ${track.title}`}
                        className="rounded-xl border border-purple-500/40 bg-purple-500/15 hover:bg-purple-500 hover:text-white p-2 text-xs text-purple-300 transition-colors shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Sub-Tabs Segmented Control + Search Filter Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
              <div
                role="tablist"
                aria-label="Library View Mode"
                data-testid="library-subtabs"
                className="inline-flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/80 p-1 self-start"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={librarySubTab === 'playlists'}
                  onClick={() => setLibrarySubTab('playlists')}
                  data-testid="subtab-playlists"
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors min-h-[34px] ${
                    librarySubTab === 'playlists'
                      ? 'bg-emerald-500 text-zinc-950'
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
                      ? 'bg-emerald-500 text-zinc-950'
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
                      ? 'bg-emerald-500 text-zinc-950'
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
                      ? 'bg-emerald-500 text-zinc-950'
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
                      if (librarySubTab === 'playlists' && e.target.value.trim()) {
                        setLibrarySubTab('songs');
                      }
                    }}
                    placeholder="Search songs, artists, genres..."
                    aria-label="Search library"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none min-h-[36px]"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setShowNewPlaylistForm(!showNewPlaylistForm)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 hover:border-emerald-500/50 px-3 py-1.5 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-400" />
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
                  className="flex-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="w-full sm:w-auto rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-bold text-zinc-950 whitespace-nowrap shrink-0 min-h-[38px]"
                >
                  Create Playlist
                </button>
              </form>
            )}

            {/* SUB-TAB 1: UNIFIED PLAYLISTS GRID (with 1-Click Play ▶, 1-Click Purple Shuffle 🔀, and Star/Pin ⭐) */}
            {librarySubTab === 'playlists' && (
              <section aria-label="Unified Playlists Grid" className="space-y-4">
                {visiblePlaylists.length === 0 ? (
                  <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-8 text-center space-y-3">
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
                        className="text-emerald-400 underline font-semibold"
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

                      return (
                        <div
                          key={pl.id}
                          data-testid={`playlist-card-${pl.id}`}
                          className={`group rounded-2xl border p-4 flex flex-col justify-between gap-4 transition-all ${
                            isPinned
                              ? 'border-purple-500/60 bg-zinc-900/70 shadow-lg shadow-purple-950/20'
                              : 'border-zinc-800/90 bg-zinc-900/40 hover:border-zinc-700'
                          }`}
                        >
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPlaylistId(pl.id);
                                  setLibrarySubTab('songs');
                                }}
                                className="text-left min-w-0 flex-1"
                              >
                                <div className="flex items-center gap-1.5">
                                  <h3 className="text-base font-bold text-white group-hover:text-emerald-400 transition-colors truncate">
                                    {pl.name}
                                  </h3>
                                </div>
                                <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
                                  {pl.description}
                                </p>
                              </button>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {/* Star / Pin Favorite Playlist Button */}
                                <button
                                  type="button"
                                  onClick={() => handleTogglePinPlaylist(pl.id)}
                                  data-testid={`pin-playlist-${pl.id}`}
                                  aria-label={
                                    isPinned
                                      ? `Unpin ${pl.name} from header`
                                      : `Pin ${pl.name} to top header bar`
                                  }
                                  title={
                                    isPinned
                                      ? 'Pinned to Header Bar (1-Tap Shuffle)'
                                      : 'Pin as Favorite Playlist in Top Bar'
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
                                  onClick={() => handleDownloadPlaylistOffline(pl)}
                                  disabled={isDownloading}
                                  aria-label={`Download playlist ${pl.name} to Offline Vault`}
                                  title="Save playlist to IndexedDB Offline Vault"
                                  className={`min-h-[34px] px-2.5 rounded-xl border flex items-center justify-center gap-1 text-xs font-mono transition-colors ${
                                    allCached
                                      ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                                      : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white'
                                  }`}
                                >
                                  {isDownloading ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                                      <span className="tabular-nums">
                                        {downloadProgress?.done}/
                                        {downloadProgress?.total}
                                      </span>
                                    </>
                                  ) : allCached ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <ArrowDownToLine className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>

                            <div className="text-[11px] font-mono text-zinc-400 flex items-center gap-2">
                              <span>{plTracks.length} tracks</span>
                              <span aria-hidden="true">·</span>
                              <span className="uppercase">{pl.source}</span>
                              {isPinned && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-amber-400 font-semibold">
                                    ★ Pinned in Header
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Direct 1-Tap Action Buttons: Green Play (▶) + High-Visibility Purple Shuffle (🔀) */}
                          <div className="pt-3 border-t border-zinc-800/70 flex items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => handlePlayPlaylistInOrder(pl)}
                              data-testid={`play-playlist-${pl.id}`}
                              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3 py-2 text-xs font-bold text-zinc-950 transition-colors min-h-[38px]"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>Play</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleShufflePlayPlaylist(pl)}
                              data-testid={`shuffle-playlist-${pl.id}`}
                              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#a855f7] hover:bg-purple-400 px-3 py-2 text-xs font-bold text-zinc-950 transition-colors min-h-[38px]"
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

            {/* SUB-TAB 2: SONGS LIST (with Source Filters + "More Like This 🪄" per track) */}
            {librarySubTab === 'songs' && (
              <section
                aria-label="Songs Catalog"
                className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-4 sm:p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div
                    className="flex items-center gap-1.5 overflow-x-auto pb-1"
                    data-testid="active-source-filters"
                  >
                    {activeFilterTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setSourceFilter(tab.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                          sourceFilter === tab.id
                            ? 'bg-emerald-500 text-zinc-950 font-bold'
                            : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800/80'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedPlaylistId && (
                      <button
                        type="button"
                        onClick={() => setSelectedPlaylistId(null)}
                        className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:text-white min-h-[34px]"
                      >
                        Clear Playlist Filter (Show All {allTracks.length})
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        if (displayedTracks.length > 0) {
                          const shuffled = fisherYatesShuffle(displayedTracks);
                          audio.playSpecificTrack(shuffled[0], shuffled);
                          setToastMessage(
                            `🔀 Shuffling ${shuffled.length} songs`
                          );
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#a855f7] hover:bg-purple-400 px-3 py-1.5 text-xs font-bold text-zinc-950 transition-colors min-h-[34px]"
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                      <span>Shuffle All 🔀</span>
                    </button>
                  </div>
                </div>

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
                          className={`py-3 px-2 rounded-xl flex items-center justify-between gap-3 transition-colors ${
                            isCurrent
                              ? 'bg-emerald-500/10'
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
                                e.currentTarget.src = createAlbumArtworkDataUri(
                                  track.title,
                                  track.artist,
                                  track.accentColor || '#10b981',
                                  '#09090b'
                                );
                              }}
                              className="w-11 h-11 rounded-xl border border-zinc-800 object-cover shrink-0"
                            />

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-sm font-semibold truncate ${
                                    isCurrent ? 'text-emerald-400' : 'text-white'
                                  }`}
                                >
                                  {track.title}
                                </span>
                                {track.genre && (
                                  <span className="hidden sm:inline-block rounded-md bg-zinc-800/90 px-2 py-0.5 text-[10px] font-mono text-zinc-300">
                                    {track.genre}
                                  </span>
                                )}
                              </div>

                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-400">
                                <span className="truncate">{track.artist}</span>
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
                                        className="text-emerald-400 font-mono font-semibold inline-flex items-center gap-1"
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
                            <button
                              type="button"
                              onClick={() => handleMoreLikeThis(track)}
                              data-testid={`more-like-this-${track.id}`}
                              title={`Play More Like "${track.title}" 🪄`}
                              className="inline-flex items-center gap-1 rounded-xl border border-purple-500/40 bg-purple-500/15 hover:bg-purple-500 hover:text-white px-2.5 py-2 text-xs font-semibold text-purple-300 transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
                            >
                              <Wand2 className="w-3.5 h-3.5" />
                              <span className="hidden md:inline">
                                More Like This 🪄
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => audio.queueTrackNext(track)}
                              title="Queue to Play Next"
                              className="hidden sm:inline-flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-950 hover:border-emerald-500/50 hover:text-emerald-300 px-2.5 py-2 text-xs font-medium text-zinc-400 transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
                            >
                              <ListPlus className="w-3.5 h-3.5" />
                              <span>Play Next</span>
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
                              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                                isCurrent && audio.isPlaying
                                  ? 'bg-emerald-500 text-zinc-950'
                                  : 'bg-zinc-800 hover:bg-emerald-500 hover:text-zinc-950 text-white'
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
                    className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-4 flex flex-col justify-between gap-4"
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
                        <p className="text-[11px] font-mono text-emerald-400 mt-1">
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
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 py-2 px-3 text-xs font-bold text-zinc-950 transition-colors min-h-[36px]"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Play Album</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const shuffled = fisherYatesShuffle(group.tracks);
                          audio.playSpecificTrack(shuffled[0], shuffled);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#a855f7] hover:bg-purple-400 py-2 px-3 text-xs font-bold text-zinc-950 transition-colors min-h-[36px]"
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
                    className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-4 flex flex-col justify-between gap-4"
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
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 py-2 px-3 text-xs font-bold text-zinc-950 transition-colors min-h-[36px]"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Play</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoreLikeThis(group.tracks[0])}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/15 hover:bg-purple-500 hover:text-white py-2 px-3 text-xs font-bold text-purple-300 transition-colors min-h-[36px]"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>Instant Mix 🪄</span>
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

        {/* =====================================================================
            TAB 2: NOW PLAYING & QUEUE (FULLSCREEN-STYLE DEDICATED DECK)
           ===================================================================== */}
        {activeTab === 'nowplaying' && (
          <section
            aria-label="Now Playing and Active Queue"
            className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
          >
            {/* Left 7 Columns: Fullscreen-Style Album Art, Scrubber, Volume, & Instant Mix */}
            <div className="lg:col-span-7 rounded-3xl border border-zinc-800 bg-zinc-900/50 p-6 sm:p-8 space-y-6">
              {audio.currentTrack ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-mono uppercase tracking-wider text-emerald-400">
                        {audio.currentTrack.sourceName}
                      </span>
                      {audio.cachedTrackIds.has(audio.currentTrack.id) && (
                        <span
                          data-testid="nowplaying-preloaded-badge"
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2.5 py-0.5 text-[11px] font-mono font-semibold text-emerald-300"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Pre-Loaded &amp; Ready
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleMoreLikeThis(audio.currentTrack!)}
                        disabled={isGeneratingMix}
                        data-testid="nowplaying-more-like-this-btn"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-purple-500/20 transition-colors min-h-[38px]"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>More Like This 🪄</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsCarModeOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3.5 py-2 text-xs font-bold text-zinc-950 transition-colors min-h-[38px]"
                      >
                        <Car className="w-4 h-4" />
                        <span>Car Mode 🚗</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-6">
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
                      className="w-48 h-48 sm:w-56 sm:h-56 rounded-2xl border border-zinc-800 object-cover shadow-2xl shrink-0"
                    />

                    <div className="space-y-3 text-center sm:text-left min-w-0 flex-1">
                      <h2 className="text-2xl sm:text-3xl font-bold text-white truncate">
                        {audio.currentTrack.title}
                      </h2>
                      <p className="text-base sm:text-lg text-zinc-300 font-medium truncate">
                        {audio.currentTrack.artist}
                      </p>
                      <p className="text-xs text-zinc-400 truncate">
                        {audio.currentTrack.album}
                      </p>

                      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs font-mono text-zinc-400">
                        <span>{audio.currentTrack.format || 'FLAC'}</span>
                        <span>·</span>
                        <span>{audio.currentTrack.bitrateKbps || 320} kbps</span>
                        <span>·</span>
                        <span>
                          LUFS {audio.currentTrack.normalizationGain ?? 0} dB
                        </span>
                      </div>

                      {/* Live Web Audio Spectrum Bars */}
                      <div
                        className="flex items-end justify-center sm:justify-start gap-1.5 h-12 pt-2"
                        aria-hidden="true"
                      >
                        {audio.frequencyData.map((val, idx) => (
                          <div
                            key={idx}
                            className="w-2.5 rounded-t bg-emerald-400/80 transition-all duration-150"
                            style={{
                              height: `${
                                audio.isPlaying ? Math.max(15, val) : 15
                              }%`,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Live Scrubber */}
                  <div className="space-y-1.5">
                    <input
                      type="range"
                      min={0}
                      max={Math.max(1, audio.duration)}
                      value={audio.currentTime}
                      aria-label="Track playback position"
                      onChange={(e) => audio.seekTo(parseFloat(e.target.value))}
                      className="w-full cursor-pointer"
                    />
                    <div className="flex justify-between text-xs font-mono tabular-nums text-zinc-400">
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
                          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
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
                        className="p-3.5 rounded-2xl border border-zinc-800 bg-zinc-950 text-white hover:bg-zinc-800 min-h-[48px] min-w-[48px] flex items-center justify-center"
                      >
                        <SkipBack className="w-6 h-6" />
                      </button>

                      <button
                        type="button"
                        onClick={audio.togglePlayPause}
                        aria-label={audio.isPlaying ? 'Pause' : 'Play'}
                        className="w-16 h-16 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 flex items-center justify-center shadow-lg"
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
                        className="p-3.5 rounded-2xl border border-zinc-800 bg-zinc-950 text-white hover:bg-zinc-800 min-h-[48px] min-w-[48px] flex items-center justify-center"
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

                  {/* Volume Slider & Quick EQ Link */}
                  <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-zinc-800/80">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          audio.setCarVolumeLeveler(!audio.carVolumeLeveler)
                        }
                        className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors min-h-[38px] ${
                          audio.carVolumeLeveler
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-zinc-950 text-zinc-400 border border-zinc-800'
                        }`}
                      >
                        <Gauge className="w-3.5 h-3.5" />
                        <span>
                          Car Leveler: {audio.carVolumeLeveler ? 'ON' : 'OFF'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('settings');
                          setSettingsSubTab('audiolab');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-300 hover:text-white min-h-[38px]"
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
                <div className="py-12 text-center text-sm text-zinc-400">
                  Select any playlist or song to start playback.
                </div>
              )}
            </div>

            {/* Right 5 Columns: Active Queue & 2-Song Lookahead Badges */}
            <aside className="lg:col-span-5 rounded-3xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
                <div>
                  <h3 className="text-base font-bold text-white">
                    Up Next Queue ({audio.queue.length})
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Zero-Buffer 2-Song Lookahead Pre-Cacher
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (audio.queue.length > 0) {
                      const shuffled = fisherYatesShuffle(audio.queue);
                      audio.playSpecificTrack(shuffled[0], shuffled);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#a855f7] hover:bg-purple-400 px-3 py-1.5 text-xs font-bold text-zinc-950 transition-colors min-h-[34px]"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  <span>Shuffle</span>
                </button>
              </div>

              <div className="divide-y divide-zinc-800/60 max-h-[460px] overflow-y-auto pr-1">
                {audio.queue.map((qTrack, idx) => {
                  const isCurrent = idx === audio.currentIndex;
                  const isCached = audio.cachedTrackIds.has(qTrack.id);
                  const isPreloading = audio.preloadingTrackIds.has(qTrack.id);

                  return (
                    <div
                      key={`${qTrack.id}-np-${idx}`}
                      className={`py-2.5 px-2 rounded-xl flex items-center justify-between gap-2 ${
                        isCurrent ? 'bg-emerald-500/10' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-white truncate">
                          {isCurrent ? '▶ ' : `${String(idx + 1).padStart(2, '0')}. `}
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
                            <span className="text-emerald-400 font-mono font-semibold">
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
                          onClick={() => handleMoreLikeThis(qTrack)}
                          title={`Play More Like ${qTrack.title} 🪄`}
                          className="rounded-lg border border-purple-500/40 bg-purple-500/15 hover:bg-purple-500 hover:text-white px-2 py-1 text-xs text-purple-300 transition-colors min-h-[32px]"
                        >
                          🪄
                        </button>
                        <button
                          type="button"
                          onClick={() => audio.playSpecificTrack(qTrack)}
                          className="rounded-lg bg-zinc-800 hover:bg-emerald-500 hover:text-zinc-950 px-2.5 py-1 text-xs font-semibold text-zinc-200 transition-colors min-h-[32px]"
                        >
                          Play
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>
          </section>
        )}

        {/* =====================================================================
            TAB 3: SETTINGS & TOOLS (TUCKED OUT OF SIGHT)
           ===================================================================== */}
        {activeTab === 'settings' && (
          <section aria-label="Settings and Tools" className="space-y-6">
            {/* Settings Sub-Navigation Header */}
            <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-lg font-bold text-white">
                  Settings
                </h1>
                <p className="text-xs text-zinc-400">
                  Manage your Jellyfin/Navidrome servers, 5-Band EQ, Offline Vault, and Spotify Importer.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsOnboardingOpen(true)}
                  data-testid="settings-manage-providers-btn"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 px-3.5 py-2 text-xs font-bold text-white shadow-sm shadow-purple-500/20 transition-colors min-h-[38px]"
                >
                  <Server className="w-3.5 h-3.5" />
                  <span>Manage Providers</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSettingsSubTab('sources')}
                  data-testid="settings-subtab-sources"
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors min-h-[38px] ${
                    settingsSubTab === 'sources'
                      ? 'bg-emerald-500 text-zinc-950'
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
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors min-h-[38px] ${
                    settingsSubTab === 'audiolab'
                      ? 'bg-emerald-500 text-zinc-950'
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
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors min-h-[38px] ${
                    settingsSubTab === 'spotify'
                      ? 'bg-emerald-500 text-zinc-950'
                      : 'bg-zinc-950 text-zinc-300 hover:text-white border border-zinc-800'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Spotify Importer</span>
                </button>
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
              />
            )}

            {settingsSubTab === 'audiolab' && (
              <div className="space-y-6">
                {/* Offline Only Mode & PWA Install Tucked Cleanly Into Audio Lab & Vault Settings */}
                <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-4 flex flex-wrap items-center justify-between gap-4">
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
                  <PWAInstallButton />
                </div>

                <AudioLabVaultView
                  currentTrack={audio.currentTrack}
                  allTracks={allTracks}
                  carVolumeLeveler={audio.carVolumeLeveler}
                  onToggleCarVolumeLeveler={audio.setCarVolumeLeveler}
                  lufsNormalizationEnabled={audio.lufsNormalizationEnabled}
                  onToggleLufsNormalization={audio.setLufsNormalizationEnabled}
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
            <footer className="rounded-2xl border border-amber-500/25 bg-zinc-900/40 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <Coffee className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Enjoying Brokeify in your car or home lab?</span>
                </div>
                <p className="text-xs text-zinc-400">
                  100% free, zero ads, zero paywalls, and zero subscriptions forever.
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

      {/* Persistent Bottom Player Bar + Mobile 3-Tab Bottom Navigation */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-zinc-800 bg-[#09090b]/95 backdrop-blur-lg">
        {/* Thin Progress Line */}
        <div className="w-full h-0.5 bg-zinc-900">
          <div
            className="h-full bg-emerald-500 transition-all duration-150"
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
            className="flex items-center gap-3 min-w-0 flex-1 sm:flex-initial sm:w-72 text-left group"
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
                className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl border border-zinc-800 object-cover shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs sm:text-sm font-bold text-white group-hover:text-emerald-400 transition-colors truncate">
                {audio.currentTrack?.title || 'Select a track'}
              </div>
              <div className="text-[11px] sm:text-xs text-zinc-400 truncate flex items-center gap-1.5">
                <span className="truncate">{audio.currentTrack?.artist}</span>
                {audio.currentTrack &&
                  audio.cachedTrackIds.has(audio.currentTrack.id) && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-emerald-400 font-mono whitespace-nowrap">
                        Pre-Loaded &amp; Ready
                      </span>
                    </>
                  )}
              </div>
            </div>
            <ChevronUp className="w-4 h-4 text-zinc-400 group-hover:text-white shrink-0" />
          </button>

          {/* Center Transport Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2.5">
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
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 flex items-center justify-center shadow-md"
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
              aria-label="Next track"
              className="p-2 rounded-xl text-zinc-300 hover:bg-zinc-900 hover:text-white min-h-[38px] min-w-[38px] flex items-center justify-center"
            >
              <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            {audio.currentTrack && (
              <button
                type="button"
                onClick={() => handleMoreLikeThis(audio.currentTrack!)}
                disabled={isGeneratingMix}
                data-testid="playerbar-more-like-this-btn"
                title="Play More Like This (Instant Mix) 🪄"
                className="inline-flex items-center gap-1 rounded-xl border border-purple-500/40 bg-purple-500/15 hover:bg-purple-500 hover:text-white px-2.5 py-2 text-xs font-bold text-purple-300 transition-colors min-h-[38px]"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span className="hidden md:inline">More Like This 🪄</span>
              </button>
            )}
          </div>

          {/* Right Desktop Scrubber & Volume */}
          <div className="hidden lg:flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-zinc-400">
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

        {/* Responsive Mobile 3-Tab Bottom Navigation Bar */}
        <nav
          aria-label="Mobile Bottom Navigation"
          className="md:hidden grid grid-cols-3 border-t border-zinc-800/80 bg-[#09090b] h-12"
        >
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className={`flex flex-col items-center justify-center min-h-[44px] ${
              activeTab === 'library' ? 'text-emerald-400' : 'text-zinc-400'
            }`}
          >
            <ListMusic className="w-4 h-4" />
            <span className="text-[10px] font-semibold mt-0.5">Library</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('nowplaying')}
            className={`flex flex-col items-center justify-center min-h-[44px] ${
              activeTab === 'nowplaying' ? 'text-emerald-400' : 'text-zinc-400'
            }`}
          >
            <Radio className="w-4 h-4" />
            <span className="text-[10px] font-semibold mt-0.5">
              Now Playing
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center justify-center min-h-[44px] ${
              activeTab === 'settings' ? 'text-emerald-400' : 'text-zinc-400'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span className="text-[10px] font-semibold mt-0.5">Settings</span>
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
        eqPreset={audio.eqPreset}
        cachedTrackIds={audio.cachedTrackIds}
        preloadingTrackIds={audio.preloadingTrackIds}
        frequencyData={audio.frequencyData}
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
        onMoreLikeThis={(track) => handleMoreLikeThis(track)}
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
        carVolumeLeveler={audio.carVolumeLeveler}
        onToggleCarVolumeLeveler={audio.setCarVolumeLeveler}
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
