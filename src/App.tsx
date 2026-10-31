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
  Compass,
  Disc3,
  Gauge,
  ListMusic,
  ListPlus,
  Loader2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Server,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import { BrokeifyLogo } from './components/BrokeifyLogo';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SourcesHubView } from './components/SourcesHubView';
import { SpotifyImporterView } from './components/SpotifyImporterView';
import { AudioLabVaultView } from './components/AudioLabVaultView';
import { CarModeOverlay } from './components/CarModeOverlay';
import { NowPlayingDrawer } from './components/NowPlayingDrawer';
import { useAudioEngine } from './hooks/useAudioEngine';
import {
  BUILT_IN_TRACKS,
  MusicProviderManager,
} from './services/MusicProviderManager';
import type {
  Playlist,
  ProviderConfig,
  ProviderType,
  Track,
} from './types/music';
import { ROTATING_SPITE_TAGLINES } from './utils/musicLogic';
import { preloadTrackToVault } from './utils/offlineVault';

type ActiveTab = 'library' | 'sources' | 'spotify' | 'audiolab';

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('library');
  const [taglineIndex, setTaglineIndex] = useState<number>(0);
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
  const [sourceFilter, setSourceFilter] = useState<ProviderType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [offlineOnlyMode, setOfflineOnlyMode] = useState<boolean>(false);
  const [isCarModeOpen, setIsCarModeOpen] = useState<boolean>(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

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

  // Rotate Spite Taglines every 6 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setTaglineIndex((prev) => (prev + 1) % ROTATING_SPITE_TAGLINES.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  // Merge Built-In Tracks with any synced Remote Tracks from active providers
  const allTracks = useMemo(() => {
    const enabledTypes = new Set(
      providers.filter((p) => p.enabled).map((p) => p.type)
    );
    const combined = [...BUILT_IN_TRACKS, ...remoteTracks];
    const seen = new Set<string>();
    return combined.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return enabledTypes.has(t.source) || t.source === 'built-in';
    });
  }, [providers, remoteTracks]);

  const audio = useAudioEngine(BUILT_IN_TRACKS);

  // Fetch initial Radio-Browser & Internet Archive tracks in background on mount
  useEffect(() => {
    let mounted = true;
    const bootstrapPublicCloud = async () => {
      const existing = MusicProviderManager.loadCachedRemoteTracks();
      if (existing.length > 0) return;
      const [radioTracks, iaTracks] = await Promise.all([
        MusicProviderManager.fetchRadioBrowserStations('rock'),
        MusicProviderManager.fetchInternetArchiveTracks(),
      ]);
      if (!mounted) return;
      const merged = [...radioTracks.slice(0, 4), ...iaTracks.slice(0, 3)];
      setRemoteTracks(merged);
      MusicProviderManager.saveCachedRemoteTracks(merged);
    };
    bootstrapPublicCloud();
    return () => {
      mounted = false;
    };
  }, []);

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
  };

  const handleSaveResolvedPlaylist = (newPl: Playlist) => {
    setPlaylists((prev) => {
      const updated = [newPl, ...prev];
      MusicProviderManager.savePlaylists(updated);
      return updated;
    });
    setSelectedPlaylistId(newPl.id);
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
    setSelectedPlaylistId(pl.id);
  };

  // One-Tap Offline Playlist Downloader into IndexedDB (`brokeify-offline-vault`)
  const handleDownloadPlaylistOffline = async (playlist: Playlist) => {
    const playlistTracks = allTracks.filter((t) =>
      playlist.trackIds.includes(t.id)
    );
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
    } finally {
      setDownloadingPlaylistId(null);
      setDownloadProgress(null);
    }
  };

  // Filtered tracks for main Library view
  const displayedTracks = useMemo(() => {
    const activePlaylist = playlists.find((p) => p.id === selectedPlaylistId);
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
          t.sourceName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [
    allTracks,
    audio.cachedTrackIds,
    offlineOnlyMode,
    playlists,
    searchQuery,
    selectedPlaylistId,
    sourceFilter,
  ]);

  const activeAmbientColor = audio.currentTrack?.accentColor || '#10b981';

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col pb-40 relative overflow-x-hidden">
      {/* Dynamic Ambient Album-Art Glow Behind Workspace */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-96 opacity-25 transition-all duration-700"
        style={{
          background: `radial-gradient(circle at 50% 0%, ${activeAmbientColor} 0%, transparent 70%)`,
        }}
        aria-hidden="true"
      />

      {/* Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-[#09090b]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-4 sm:px-6 py-3">
          {/* Zone 1: Brand Title */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('library');
            }}
            className="flex items-center gap-3 text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            <BrokeifyLogo size={36} />
            <span>Brokeify</span>
          </a>

          {/* Zone 2: 4 Single-Line Navigation Links */}
          <nav
            aria-label="Primary Navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium"
          >
            <button
              type="button"
              onClick={() => setActiveTab('library')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === 'library'
                  ? 'border-emerald-400 text-white font-semibold'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              Library & Queue
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sources')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === 'sources'
                  ? 'border-emerald-400 text-white font-semibold'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              Sources Hub
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('spotify')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === 'spotify'
                  ? 'border-emerald-400 text-white font-semibold'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              Spotify Importer
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('audiolab')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === 'audiolab'
                  ? 'border-emerald-400 text-white font-semibold'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              Audio Lab & EQ
            </button>
          </nav>

          {/* Zone 3: Primary Car Mode Action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setIsCarModeOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-bold text-zinc-950 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <Car className="w-4 h-4" />
              <span>Car Mode</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-6 space-y-8">
        {/* Hero / Rotating Spite Tagline & Workspace Utility Bar */}
        <section
          aria-label="Brokeify Status and Rotating Tagline"
          className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
              <span className="font-semibold text-emerald-400">
                The All-In-One Free & Self-Hosted Music Aggregator
              </span>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() =>
                  setTaglineIndex(
                    (prev) => (prev + 1) % ROTATING_SPITE_TAGLINES.length
                  )
                }
                className="text-zinc-300 hover:text-white underline underline-offset-4 whitespace-nowrap shrink-0"
              >
                Next tagline
              </button>
            </div>
            <p
              className="text-base sm:text-lg font-bold text-white tracking-tight"
              data-testid="rotating-spite-tagline"
            >
              &ldquo;{ROTATING_SPITE_TAGLINES[taglineIndex]}&rdquo;
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Offline Only Mode Toggle */}
            <button
              type="button"
              role="switch"
              aria-checked={offlineOnlyMode}
              onClick={() => setOfflineOnlyMode(!offlineOnlyMode)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
                offlineOnlyMode
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                  : 'border-zinc-800 bg-zinc-900/90 text-zinc-300 hover:text-white'
              }`}
            >
              <WifiOff className="w-3.5 h-3.5" />
              <span>
                Offline Only Mode ({audio.cachedTrackIds.size} cached)
              </span>
            </button>

            {/* Quick Car Volume Leveler Toggle */}
            <button
              type="button"
              role="switch"
              aria-checked={audio.carVolumeLeveler}
              onClick={() =>
                audio.setCarVolumeLeveler(!audio.carVolumeLeveler)
              }
              className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
                audio.carVolumeLeveler
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-white'
              }`}
            >
              <Gauge className="w-3.5 h-3.5" />
              <span>
                Car Leveler: {audio.carVolumeLeveler ? 'ON' : 'OFF'}
              </span>
            </button>

            <PWAInstallButton />
          </div>
        </section>

        {/* Active View Switcher */}
        {activeTab === 'sources' && (
          <SourcesHubView
            providers={providers}
            onUpdateProviders={handleUpdateProviders}
            onMergeRemoteTracks={(tracks) => {
              handleMergeRemoteTracks(tracks);
            }}
          />
        )}

        {activeTab === 'spotify' && (
          <SpotifyImporterView
            catalog={allTracks}
            onPlayTrack={(track) => audio.playSpecificTrack(track, allTracks)}
            onSaveResolvedPlaylist={(pl) => {
              handleSaveResolvedPlaylist(pl);
              setActiveTab('library');
            }}
          />
        )}

        {activeTab === 'audiolab' && (
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
            onPlayTrack={(track) => audio.playSpecificTrack(track, allTracks)}
          />
        )}

        {activeTab === 'library' && (
          <div className="space-y-8">
            {/* Playlists Strip with One-Tap Offline Downloader */}
            <section aria-labelledby="playlists-heading" className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2
                    id="playlists-heading"
                    className="text-xl font-bold text-white tracking-tight"
                  >
                    Unified Playlists & One-Tap Offline Vault
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Download any playlist into IndexedDB (`brokeify-offline-vault`)
                    on Wi-Fi before driving through dead zones.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {selectedPlaylistId && (
                    <button
                      type="button"
                      onClick={() => setSelectedPlaylistId(null)}
                      className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 hover:text-white whitespace-nowrap shrink-0 min-h-[40px]"
                    >
                      Show All Tracks ({allTracks.length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowNewPlaylistForm(!showNewPlaylistForm)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 hover:border-emerald-500/50 px-3.5 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-400" />
                    <span>New Playlist</span>
                  </button>
                </div>
              </div>

              {showNewPlaylistForm && (
                <form
                  onSubmit={handleCreateCustomPlaylist}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col sm:flex-row items-center gap-3"
                >
                  <label htmlFor="new-playlist-name" className="sr-only">
                    Playlist Name
                  </label>
                  <input
                    id="new-playlist-name"
                    type="text"
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    placeholder="Enter custom multi-source playlist name..."
                    className="flex-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="w-full sm:w-auto rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-semibold text-zinc-950 whitespace-nowrap shrink-0 min-h-[40px]"
                  >
                    Create Playlist
                  </button>
                </form>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {playlists.map((pl) => {
                  const plTracks = allTracks.filter((t) =>
                    pl.trackIds.includes(t.id)
                  );
                  const allCached =
                    plTracks.length > 0 &&
                    plTracks.every((t) => audio.cachedTrackIds.has(t.id));
                  const isDownloading = downloadingPlaylistId === pl.id;
                  const isSelected = selectedPlaylistId === pl.id;

                  return (
                    <div
                      key={pl.id}
                      className={`rounded-2xl border p-5 flex flex-col justify-between gap-4 transition-colors ${
                        isSelected
                          ? 'border-emerald-500/70 bg-emerald-500/10'
                          : 'border-zinc-800/90 bg-zinc-900/40 hover:border-zinc-700'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedPlaylistId(isSelected ? null : pl.id)
                            }
                            className="text-left group"
                          >
                            <h3 className="text-base font-bold text-white group-hover:text-emerald-400 transition-colors">
                              {pl.name}
                            </h3>
                            <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">
                              {pl.description}
                            </p>
                          </button>

                          {/* Spotify-Style Downward Arrow Offline Download Button */}
                          <button
                            type="button"
                            onClick={() => handleDownloadPlaylistOffline(pl)}
                            disabled={isDownloading}
                            aria-label={`Download playlist ${pl.name} to Offline Vault`}
                            title="One-Tap Offline Playlist Downloader"
                            className={`min-h-[40px] min-w-[40px] px-2.5 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-mono transition-colors whitespace-nowrap shrink-0 ${
                              allCached
                                ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                                : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-emerald-500/50 hover:text-white'
                            }`}
                          >
                            {isDownloading ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                                <span className="tabular-nums">
                                  {downloadProgress?.done}/{downloadProgress?.total}
                                </span>
                              </>
                            ) : allCached ? (
                              <>
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                <span>Vaulted</span>
                              </>
                            ) : (
                              <>
                                <ArrowDownToLine className="w-4 h-4" />
                                <span>Offline</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-zinc-800/70 flex items-center justify-between gap-3">
                        <div className="text-xs text-zinc-400 font-mono tabular-nums whitespace-nowrap truncate">
                          <span>{plTracks.length} tracks</span>
                          <span aria-hidden="true"> · </span>
                          <span>{String(pl.source).toUpperCase()}</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (plTracks.length > 0) {
                              audio.playSpecificTrack(plTracks[0], plTracks);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3.5 py-2 text-xs font-bold text-zinc-950 transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Play Playlist</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Unified Multi-Source Track Catalog & Queue */}
            <section
              aria-labelledby="catalog-heading"
              className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
            >
              {/* Left 8 Columns: Search, Source Filter, Track Table */}
              <div className="lg:col-span-8 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-5 sm:p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
                  <div>
                    <h2
                      id="catalog-heading"
                      className="text-lg font-bold text-white tracking-tight"
                    >
                      {selectedPlaylistId
                        ? playlists.find((p) => p.id === selectedPlaylistId)
                            ?.name || 'Playlist Tracks'
                        : 'Aggregated Multi-Source Stream Catalog'}
                    </h2>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Showing {displayedTracks.length} of {allTracks.length} tracks
                      {offlineOnlyMode ? ' (Offline Only Mode active)' : ''}
                    </p>
                  </div>

                  {/* Search Input */}
                  <div className="relative w-full sm:w-64">
                    <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter title, artist, source..."
                      aria-label="Filter tracks by title, artist, or source"
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 pl-9 pr-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Interactive Source Filter Segmented Control */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {(
                    [
                      { id: 'all', label: 'All Sources' },
                      { id: 'built-in', label: 'Free Cloud' },
                      { id: 'radio-browser', label: 'Radio-Browser' },
                      { id: 'internet-archive', label: 'Internet Archive' },
                      { id: 'jellyfin', label: 'Jellyfin' },
                      { id: 'navidrome', label: 'Navidrome' },
                      { id: 'plex', label: 'Plex' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSourceFilter(tab.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[36px] ${
                        sourceFilter === tab.id
                          ? 'bg-emerald-500 text-zinc-950 font-semibold'
                          : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800/80'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Track List */}
                {displayedTracks.length === 0 ? (
                  <div className="py-12 text-center space-y-3">
                    <p className="text-sm text-zinc-400">
                      No tracks match your current filter.
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
                              className="w-11 h-11 rounded-xl border border-zinc-800 object-cover shrink-0"
                            />

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-sm font-semibold truncate ${
                                    isCurrent
                                      ? 'text-emerald-400'
                                      : 'text-white'
                                  }`}
                                >
                                  {track.title}
                                </span>
                              </div>

                              {/* Unboxed clean metadata with typographic separators */}
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
                                {track.normalizationGain !== undefined && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono tabular-nums text-zinc-400">
                                      LUFS {track.normalizationGain > 0 ? `+${track.normalizationGain}` : track.normalizationGain}dB
                                    </span>
                                  </>
                                )}
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
                                        Pre-loaded
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
                              onClick={() => audio.queueTrackNext(track)}
                              title="Queue to Play Next"
                              className="hidden sm:inline-flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-950 hover:border-purple-500/50 hover:text-purple-300 px-2.5 py-2 text-xs font-medium text-zinc-400 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
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
                              aria-label={
                                isCurrent && audio.isPlaying
                                  ? `Pause ${track.title}`
                                  : `Play ${track.title}`
                              }
                              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
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
              </div>

              {/* Right 4 Columns: Active Queue & 2-Song Lookahead Preloader Monitor */}
              <aside
                aria-labelledby="queue-sidebar-heading"
                className="lg:col-span-4 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-5 sm:p-6 space-y-4"
              >
                <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
                  <div>
                    <h3
                      id="queue-sidebar-heading"
                      className="text-base font-bold text-white"
                    >
                      Active Queue & Lookahead
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Auto-fetches Track N+1 & N+2 into IndexedDB
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={audio.toggleShuffle}
                      aria-label="Shuffle Queue"
                      title="True Fisher-Yates Shuffle"
                      className={`p-2 rounded-xl border transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center ${
                        audio.shuffleEnabled
                          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <Shuffle className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={audio.cycleRepeatMode}
                      aria-label={`Repeat mode: ${audio.repeatMode}`}
                      className={`p-2 rounded-xl border transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center ${
                        audio.repeatMode !== 'off'
                          ? 'border-purple-500/50 bg-purple-500/15 text-purple-300'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {audio.repeatMode === 'one' ? (
                        <Repeat1 className="w-4 h-4" />
                      ) : (
                        <Repeat className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-zinc-800/60 max-h-[420px] overflow-y-auto pr-1">
                  {audio.queue.slice(0, 12).map((qTrack, idx) => {
                    const isCurrent = idx === audio.currentIndex;
                    const isNextTwo =
                      idx === (audio.currentIndex + 1) % audio.queue.length ||
                      idx === (audio.currentIndex + 2) % audio.queue.length;
                    const isCached = audio.cachedTrackIds.has(qTrack.id);

                    return (
                      <div
                        key={`${qTrack.id}-q-${idx}`}
                        className={`py-2.5 flex items-center justify-between gap-2 ${
                          isCurrent ? 'text-emerald-400' : 'text-zinc-200'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate">
                            {idx === audio.currentIndex ? '▶ ' : ''}
                            {qTrack.title}
                          </div>
                          <div className="text-[11px] text-zinc-400 flex items-center gap-1.5 mt-0.5">
                            <span className="truncate">{qTrack.artist}</span>
                            <span aria-hidden="true">·</span>
                            {isCached ? (
                              <span className="text-emerald-400 font-mono font-semibold">
                                Pre-loaded
                              </span>
                            ) : isNextTwo ? (
                              <span className="text-amber-300 font-mono">
                                Lookahead
                              </span>
                            ) : (
                              <span className="font-mono">Queued</span>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => audio.playSpecificTrack(qTrack)}
                          className="rounded-lg bg-zinc-800/90 hover:bg-emerald-500 hover:text-zinc-950 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 transition-colors shrink-0 min-h-[34px]"
                        >
                          Play
                        </button>
                      </div>
                    );
                  })}
                </div>
              </aside>
            </section>
          </div>
        )}
      </main>

      {/* Persistent Now Playing Bar + Mobile Bottom Navigation */}
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-1.5 sm:py-2.5 flex items-center justify-between gap-4">
          {/* Current Track Info (Click to slide up Now Playing Drawer) */}
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
                        Pre-loaded
                      </span>
                    </>
                  )}
              </div>
            </div>
            <ChevronUp className="w-4 h-4 text-zinc-400 group-hover:text-white shrink-0" />
          </button>

          {/* Center Transport Controls */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            <button
              type="button"
              onClick={audio.playPrevious}
              aria-label="Previous track"
              className="p-2 rounded-xl text-zinc-300 hover:bg-zinc-900 hover:text-white min-h-[40px] min-w-[40px] flex items-center justify-center"
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
              className="p-2 rounded-xl text-zinc-300 hover:bg-zinc-900 hover:text-white min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>

          {/* Right Desktop Scrubber, EQ indicator, and Volume */}
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
                className="w-32 cursor-pointer"
              />
              <span>{formatDuration(audio.duration)}</span>
            </div>

            <button
              type="button"
              onClick={() => setIsDrawerOpen(true)}
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 hover:text-white whitespace-nowrap shrink-0 min-h-[40px]"
            >
              Queue & EQ ({audio.eqPreset})
            </button>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => audio.setIsMuted(!audio.isMuted)}
                aria-label={audio.isMuted ? 'Unmute audio' : 'Mute audio'}
                className="p-2 text-zinc-400 hover:text-white min-h-[40px] min-w-[40px] flex items-center justify-center"
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

        {/* Responsive Mobile Bottom Navigation Bar */}
        <nav
          aria-label="Mobile Bottom Navigation"
          className="md:hidden grid grid-cols-4 border-t border-zinc-800/80 bg-[#09090b] h-12"
        >
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className={`flex flex-col items-center justify-center min-h-[44px] ${
              activeTab === 'library' ? 'text-emerald-400' : 'text-zinc-400'
            }`}
          >
            <ListMusic className="w-4 h-4" />
            <span className="text-[10px] font-medium mt-0.5">Library</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sources')}
            className={`flex flex-col items-center justify-center min-h-[44px] ${
              activeTab === 'sources' ? 'text-emerald-400' : 'text-zinc-400'
            }`}
          >
            <Server className="w-4 h-4" />
            <span className="text-[10px] font-medium mt-0.5">Sources</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('spotify')}
            className={`flex flex-col items-center justify-center min-h-[44px] ${
              activeTab === 'spotify' ? 'text-emerald-400' : 'text-zinc-400'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span className="text-[10px] font-medium mt-0.5">Spotify</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('audiolab')}
            className={`flex flex-col items-center justify-center min-h-[44px] ${
              activeTab === 'audiolab' ? 'text-emerald-400' : 'text-zinc-400'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span className="text-[10px] font-medium mt-0.5">Audio Lab</span>
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
        onOpenCarMode={() => setIsCarModeOpen(true)}
        onOpenAudioLab={() => setActiveTab('audiolab')}
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
    </div>
  );
}
