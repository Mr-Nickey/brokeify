import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  Check,
  CheckCircle2,
  CheckSquare,
  Clock,
  Disc,
  ExternalLink,
  Layers,
  Link2,
  ListPlus,
  Loader2,
  MoreVertical,
  Music,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Shuffle,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Playlist,
  PlaylistGhostTrack,
  SlskdGrabJob,
  Track,
} from '../types/music';
import { CachedArtworkImage } from '../utils/artworkCache';

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export type PlaylistFilterStatus = 'all' | 'ready' | 'downloading' | 'failed';

interface PlaylistDetailViewProps {
  playlist: Playlist;
  allTracks: Track[];
  slskdJobs: SlskdGrabJob[];
  currentTrackId?: string;
  isPlaying?: boolean;
  cachedTrackIds: Set<string>;
  onBack: () => void;
  onPlayTrack: (track: Track, contextTracks: Track[]) => void;
  onPlayPlaylistInOrder: (pl: Playlist) => void;
  onShufflePlayPlaylist: (pl: Playlist) => void;
  onOpenSpotifyImporter: (pl: Playlist) => void;
  onOpenMergePlaylists: (pl: Playlist) => void;
  onOpenAddToPlaylist: (tracks: Track[], label: string) => void;
  onOpenMetadataInspector: (track: Track) => void;
  onRemoveTracksFromPlaylist: (
    trackIds: string[],
    ghostIds?: string[]
  ) => Promise<void> | void;
  onDownloadMissingGhostTracks: (playlist: Playlist) => void;
  onRetryGhostTrackDownload: (ghost: PlaylistGhostTrack) => void;
  onSavePlaylistName: (playlist: Playlist, nextName: string) => void;
  onShowToast: (msg: string) => void;
}

export interface UnifiedPlaylistItem {
  key: string;
  isGhost: boolean;
  libraryTrack?: Track;
  ghostTrack?: PlaylistGhostTrack;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  status: 'ready' | 'downloading' | 'queued' | 'searching' | 'failed';
  statusLabel: string;
  sourceEngine?: string;
  job?: SlskdGrabJob;
}

export const PlaylistDetailView: React.FC<PlaylistDetailViewProps> = ({
  playlist,
  allTracks,
  slskdJobs,
  currentTrackId,
  isPlaying,
  cachedTrackIds,
  onBack,
  onPlayTrack,
  onPlayPlaylistInOrder,
  onShufflePlayPlaylist,
  onOpenSpotifyImporter,
  onOpenMergePlaylists,
  onOpenAddToPlaylist,
  onOpenMetadataInspector,
  onRemoveTracksFromPlaylist,
  onDownloadMissingGhostTracks,
  onRetryGhostTrackDownload,
  onSavePlaylistName,
  onShowToast,
}) => {
  // Inline rename state
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(playlist.name);

  // In-playlist search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] =
    useState<PlaylistFilterStatus>('all');

  // Multi-selection state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedItemKeys, setSelectedItemKeys] = useState<Set<string>>(
    new Set()
  );
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  // Track menu state
  const [openMenuTrackKey, setOpenMenuTrackKey] = useState<string | null>(null);

  // Delete confirmation
  const [isConfirmingBulkRemove, setIsConfirmingBulkRemove] = useState(false);

  // Library tracks in this playlist
  const trackIdMap = useMemo(() => {
    const map = new Map<string, Track>();
    for (const t of allTracks) {
      map.set(t.id, t);
    }
    return map;
  }, [allTracks]);

  // Combine Library Tracks + Ghost Songs into unified list with live job statuses
  const unifiedItems: UnifiedPlaylistItem[] = useMemo(() => {
    const items: UnifiedPlaylistItem[] = [];
    const seenLibraryIds = new Set<string>();

    // 1. Existing Library Tracks
    for (const tid of playlist.trackIds || []) {
      const track = trackIdMap.get(tid);
      if (track) {
        seenLibraryIds.add(track.id);
        items.push({
          key: `ready-${track.id}`,
          isGhost: false,
          libraryTrack: track,
          title: track.title,
          artist: track.artist,
          album: track.album,
          durationSec: track.duration,
          status: 'ready',
          statusLabel: 'Ready in Library',
          sourceEngine: track.sourceName || 'Local Library',
        });
      }
    }

    // 2. Ghost Tracks (Spotify / external tracks queued or downloading)
    const ghostTracks = playlist.ghostTracks || [];
    for (const ghost of ghostTracks) {
      if (ghost.matchedTrackId && seenLibraryIds.has(ghost.matchedTrackId)) {
        continue;
      }

      // Find matching live download job
      const job = slskdJobs.find((j) => {
        if (j.ghostTrackId && j.ghostTrackId === ghost.id) return true;
        if (j.playlistId === playlist.id) {
          const normJ = `${j.artist || ''} ${j.title || ''}`.toLowerCase();
          const normG = `${ghost.artist || ''} ${ghost.title || ''}`.toLowerCase();
          return normJ.includes(ghost.title.toLowerCase()) || normG.includes(j.title.toLowerCase());
        }
        return false;
      });

      let status: UnifiedPlaylistItem['status'] = 'searching';
      let statusLabel = 'Searching download sources...';
      const engine = job?.sourceEngine || 'Auto Engine';

      if (job) {
        if (job.status === 'downloading') {
          status = 'downloading';
          statusLabel = `Downloading via ${engine.toUpperCase()}${
            job.matchedFormat ? ` (${job.matchedFormat})` : ''
          }`;
        } else if (job.status === 'queued') {
          status = 'queued';
          statusLabel = `Queued in ${engine.toUpperCase()}${
            job.queuePosition ? ` (#${job.queuePosition})` : ''
          }`;
        } else if (job.status === 'completed') {
          status = 'ready';
          statusLabel = 'Just Downloaded · Indexing';
        } else if (job.status === 'failed' || job.status === 'not_found') {
          status = 'failed';
          statusLabel = `${engine.toUpperCase()} not found · Click Retry`;
        } else {
          status = 'searching';
          statusLabel = `Searching in ${engine.toUpperCase()}...`;
        }
      }

      items.push({
        key: `ghost-${ghost.id}`,
        isGhost: true,
        ghostTrack: ghost,
        title: ghost.title,
        artist: ghost.artist,
        album: ghost.album || 'Unknown Album',
        durationSec: ghost.durationSec || 0,
        status,
        statusLabel,
        sourceEngine: engine,
        job,
      });
    }

    return items;
  }, [playlist, trackIdMap, slskdJobs]);

  // Filtered Items based on Status Filter & Search Query
  const displayedItems = useMemo(() => {
    let list = unifiedItems;

    if (statusFilter === 'ready') {
      list = list.filter((i) => i.status === 'ready');
    } else if (statusFilter === 'downloading') {
      list = list.filter(
        (i) => i.status === 'downloading' || i.status === 'queued' || i.status === 'searching'
      );
    } else if (statusFilter === 'failed') {
      list = list.filter((i) => i.status === 'failed');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.artist.toLowerCase().includes(q) ||
          i.album.toLowerCase().includes(q)
      );
    }

    return list;
  }, [unifiedItems, statusFilter, searchQuery]);

  // Counts for status filters
  const counts = useMemo(() => {
    let ready = 0;
    let downloading = 0;
    let failed = 0;
    for (const item of unifiedItems) {
      if (item.status === 'ready') ready++;
      else if (
        item.status === 'downloading' ||
        item.status === 'queued' ||
        item.status === 'searching'
      )
        downloading++;
      else if (item.status === 'failed') failed++;
    }
    return {
      all: unifiedItems.length,
      ready,
      downloading,
      failed,
    };
  }, [unifiedItems]);

  const readyTracks = useMemo(() => {
    return unifiedItems
      .filter((i) => !i.isGhost && i.libraryTrack)
      .map((i) => i.libraryTrack as Track);
  }, [unifiedItems]);

  // Shift-click range selection handler
  const handleItemSelect = (
    itemKey: string,
    index: number,
    isShiftKey: boolean
  ) => {
    setSelectedItemKeys((prev) => {
      const next = new Set(prev);

      if (isShiftKey && lastClickedIndex !== null) {
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        for (let i = start; i <= end; i++) {
          const key = displayedItems[i]?.key;
          if (key) next.add(key);
        }
      } else {
        if (next.has(itemKey)) {
          next.delete(itemKey);
        } else {
          next.add(itemKey);
        }
      }

      return next;
    });
    setLastClickedIndex(index);
  };

  const handleSelectAll = () => {
    const allKeys = new Set(displayedItems.map((i) => i.key));
    setSelectedItemKeys(allKeys);
  };

  const handleClearSelection = () => {
    setSelectedItemKeys(new Set());
    setLastClickedIndex(null);
  };

  const handleConfirmBulkRemove = async () => {
    const trackIdsToRemove: string[] = [];
    const ghostIdsToRemove: string[] = [];

    for (const key of selectedItemKeys) {
      const item = unifiedItems.find((i) => i.key === key);
      if (item) {
        if (item.isGhost && item.ghostTrack) {
          ghostIdsToRemove.push(item.ghostTrack.id);
        } else if (item.libraryTrack) {
          trackIdsToRemove.push(item.libraryTrack.id);
        }
      }
    }

    await onRemoveTracksFromPlaylist(trackIdsToRemove, ghostIdsToRemove);
    setSelectedItemKeys(new Set());
    setIsConfirmingBulkRemove(false);
  };

  const realPlaylistName = playlist.originalName || playlist.name;
  const hasCustomName = realPlaylistName !== playlist.name;

  return (
    <div
      data-testid="playlist-detail-view"
      className="winamp-bezel rounded-3xl border border-zinc-700/80 overflow-hidden space-y-0"
    >
      {/* 1. TOP HEADER WITH BACK BUTTON, TITLE, METADATA & QUICK ACTIONS */}
      <div className="winamp-titlebar p-4 sm:p-5 border-b border-zinc-700/80 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Back button */}
          <button
            type="button"
            onClick={onBack}
            data-testid="playlist-back-btn"
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-[#00ff66] hover:text-[#00ff66] px-3.5 py-2 text-xs font-mono font-bold text-zinc-200 transition-colors shrink-0 min-h-[38px]"
          >
            <ArrowLeft className="w-4 h-4 text-[#00ff66]" />
            <span>All Playlists</span>
          </button>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onPlayPlaylistInOrder(playlist)}
              disabled={readyTracks.length === 0}
              data-testid="playlist-detail-play-btn"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-40 px-4 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[38px]"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Play ({readyTracks.length})</span>
            </button>

            <button
              type="button"
              onClick={() => onShufflePlayPlaylist(playlist)}
              disabled={readyTracks.length === 0}
              data-testid="playlist-detail-shuffle-btn"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#a855f7] hover:bg-purple-400 disabled:opacity-40 px-3.5 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[38px]"
            >
              <Shuffle className="w-4 h-4" />
              <span>Shuffle 🔀</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenSpotifyImporter(playlist)}
              data-testid="playlist-detail-spotify-import-btn"
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/50 bg-emerald-950/40 hover:bg-emerald-900/60 px-3.5 py-2 text-xs font-mono font-bold text-[#00ff66] transition-colors min-h-[38px]"
            >
              <Sparkles className="w-4 h-4" />
              <span>Import / Sync Spotify</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenMergePlaylists(playlist)}
              data-testid="playlist-detail-link-btn"
              className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/50 bg-purple-950/40 hover:bg-purple-900/60 px-3.5 py-2 text-xs font-mono font-bold text-purple-300 transition-colors min-h-[38px]"
            >
              <Link2 className="w-4 h-4" />
              <span>Link with Playlist</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsSelectMode(!isSelectMode);
                handleClearSelection();
              }}
              data-testid="playlist-detail-select-toggle"
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-mono font-semibold transition-colors min-h-[38px] ${
                isSelectMode
                  ? 'border-[#00ff66] bg-emerald-500/20 text-[#00ff66]'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white'
              }`}
            >
              <CheckSquare className="w-4 h-4" />
              <span>{isSelectMode ? 'Done Selecting' : 'Select'}</span>
            </button>
          </div>
        </div>

        {/* Playlist Name & Badges */}
        <div className="space-y-1.5 pt-1">
          {isEditingName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (nameInput.trim()) {
                  onSavePlaylistName(playlist, nameInput.trim());
                  setIsEditingName(false);
                }
              }}
              className="flex items-center gap-2 max-w-lg"
            >
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                autoFocus
                className="flex-1 rounded-xl border border-emerald-500 bg-zinc-900 px-3.5 py-1.5 text-base font-bold text-white focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3 py-1.5 text-xs font-mono font-bold text-zinc-950 min-h-[36px]"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setNameInput(playlist.name);
                  setIsEditingName(false);
                }}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-400 hover:text-white min-h-[36px]"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <h2
                data-testid="playlist-detail-title"
                className="text-xl sm:text-2xl font-bold text-white tracking-wide"
              >
                {playlist.name}
              </h2>
              <button
                type="button"
                onClick={() => setIsEditingName(true)}
                title="Rename Playlist"
                className="rounded-lg p-1.5 text-zinc-400 hover:text-[#00ff66] hover:bg-zinc-900"
              >
                <Pencil className="w-4 h-4" />
              </button>

              {hasCustomName && (
                <span className="rounded bg-purple-500/20 border border-purple-500/40 px-2 py-0.5 text-[10px] font-mono font-bold uppercase text-purple-300">
                  Real: {realPlaylistName}
                </span>
              )}
              {playlist.linkedSpotifyUrl && (
                <a
                  href={playlist.linkedSpotifyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66] inline-flex items-center gap-1 hover:underline"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Linked Spotify Playlist</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
              {playlist.autopilotInterval && (
                <span className="rounded bg-sky-500/20 border border-sky-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-sky-300">
                  🤖 Autopilot: {playlist.autopilotInterval}
                </span>
              )}
            </div>
          )}

          <p className="text-xs text-zinc-400 font-mono">
            {playlist.description || 'Custom playlist stored in SQLite /data/brokeify.db.'}
          </p>

          <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-zinc-400 pt-1">
            <span className="text-[#00ff66] font-bold">
              {counts.ready} in Library
            </span>
            <span>·</span>
            <span className="text-amber-400 font-bold">
              {counts.downloading} Downloading / Queued
            </span>
            {counts.failed > 0 && (
              <>
                <span>·</span>
                <span className="text-rose-400 font-bold">
                  {counts.failed} Missing / Not Found
                </span>
              </>
            )}
            <span>·</span>
            <span>{counts.all} Total Songs</span>
            {(counts.downloading > 0 || counts.failed > 0) && (
              <button
                type="button"
                onClick={() => onDownloadMissingGhostTracks(playlist)}
                data-testid="download-missing-ghosts-btn"
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-amber-500/60 bg-amber-500/15 hover:bg-amber-500/25 px-2.5 py-1 text-xs font-mono font-bold text-amber-300 transition-colors"
              >
                <ArrowDownToLine className="w-3.5 h-3.5 animate-bounce" />
                <span>
                  Grab All Missing ({counts.downloading + counts.failed})
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. DEDICATED IN-PLAYLIST STATUS FILTER BAR & SEARCH */}
      <div className="px-4 py-3 bg-zinc-950/70 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
        {/* Status Filter Tabs */}
        <div
          role="tablist"
          aria-label="Filter playlist songs"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-colors min-h-[34px] ${
              statusFilter === 'all'
                ? 'bg-[#00ff66] text-zinc-950 font-bold'
                : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            All Songs ({counts.all})
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'ready'}
            onClick={() => setStatusFilter('ready')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-colors min-h-[34px] ${
              statusFilter === 'ready'
                ? 'bg-[#00ff66] text-zinc-950 font-bold'
                : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            In Library ({counts.ready})
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'downloading'}
            onClick={() => setStatusFilter('downloading')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-colors min-h-[34px] ${
              statusFilter === 'downloading'
                ? 'bg-amber-400 text-zinc-950 font-bold'
                : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            Downloading / Queued ({counts.downloading})
          </button>

          {counts.failed > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === 'failed'}
              onClick={() => setStatusFilter('failed')}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-colors min-h-[34px] ${
                statusFilter === 'failed'
                  ? 'bg-rose-500 text-white font-bold'
                  : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              Missing / Not Found ({counts.failed})
            </button>
          )}
        </div>

        {/* Search within playlist */}
        <div className="relative flex-1 sm:w-64 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search inside this playlist..."
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900 pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-[#00ff66] focus:outline-none min-h-[36px]"
          />
        </div>
      </div>

      {/* 3. MULTI-SELECT ACTION BAR */}
      {isSelectMode && selectedItemKeys.size > 0 && (
        <div
          data-testid="playlist-multi-select-bar"
          className="px-4 py-2.5 bg-emerald-950/40 border-b border-emerald-500/40 flex flex-wrap items-center justify-between gap-3 text-xs font-mono"
        >
          <div className="flex items-center gap-2">
            <span className="text-[#00ff66] font-bold">
              {selectedItemKeys.size} of {displayedItems.length} songs selected
            </span>
            <span className="text-zinc-500 text-[11px]">
              (Hold Shift to select range)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAll}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-200 hover:text-white"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={handleClearSelection}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-zinc-400 hover:text-white"
            >
              Clear
            </button>

            {/* Add selected tracks to another playlist */}
            <button
              type="button"
              onClick={() => {
                const tracks = selectedItemKeys
                  ? Array.from(selectedItemKeys)
                      .map((k) => unifiedItems.find((i) => i.key === k)?.libraryTrack)
                      .filter(Boolean) as Track[]
                  : [];
                if (tracks.length > 0) {
                  onOpenAddToPlaylist(
                    tracks,
                    `${tracks.length} tracks from ${playlist.name}`
                  );
                } else {
                  onShowToast('Only ready library tracks can be added to other playlists.');
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/60 bg-purple-950/50 hover:bg-purple-900/60 px-3 py-1.5 text-xs font-mono font-bold text-purple-200"
            >
              <ListPlus className="w-3.5 h-3.5 text-purple-300" />
              <span>Add Selected to Another Playlist</span>
            </button>

            {/* Remove from this playlist */}
            <button
              type="button"
              onClick={() => setIsConfirmingBulkRemove(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-500 hover:bg-rose-400 px-3 py-1.5 text-xs font-mono font-bold text-white"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Remove from Playlist</span>
            </button>
          </div>
        </div>
      )}

      {/* Confirmation modal for removal from playlist */}
      {isConfirmingBulkRemove && (
        <div className="p-4 bg-rose-950/40 border-b border-rose-500/50 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2 text-rose-200">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>
              Remove <strong>{selectedItemKeys.size}</strong> song(s) from &ldquo;{playlist.name}&rdquo;? (Audio files will NOT be deleted from disk).
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsConfirmingBulkRemove(false)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmBulkRemove}
              className="rounded-lg bg-rose-500 hover:bg-rose-400 px-3 py-1.5 font-bold text-white"
            >
              Yes, Remove Songs
            </button>
          </div>
        </div>
      )}

      {/* 4. MAIN SONGS LIST (LIBRARY TRACKS + GHOST SONGS) */}
      <div className="p-4 sm:p-5">
        {displayedItems.length === 0 ? (
          <div className="py-12 px-4 text-center max-w-md mx-auto space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500">
              <Music className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white font-mono">
              No songs match filter
            </h3>
            <p className="text-xs text-zinc-400 font-mono">
              {statusFilter !== 'all'
                ? `No songs in "${playlist.name}" have status "${statusFilter}".`
                : 'This playlist currently has no songs.'}
            </p>
            {statusFilter !== 'all' && (
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-1.5 text-xs font-mono text-[#00ff66]"
              >
                Show All ({counts.all})
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/70">
            {displayedItems.map((item, idx) => {
              const isSelected = selectedItemKeys.has(item.key);
              const isCurrent =
                !item.isGhost &&
                item.libraryTrack &&
                currentTrackId === item.libraryTrack.id;
              const isMenuOpen = openMenuTrackKey === item.key;
              const isCached =
                !item.isGhost &&
                item.libraryTrack &&
                cachedTrackIds.has(item.libraryTrack.id);

              return (
                <div
                  key={item.key}
                  data-testid={`playlist-item-${item.key}`}
                  className={`py-2.5 px-3 rounded-2xl flex items-center justify-between gap-3 transition-colors relative ${
                    isSelected
                      ? 'bg-emerald-500/15 border border-emerald-500/40'
                      : isCurrent
                        ? 'bg-emerald-500/10'
                        : item.isGhost
                          ? 'bg-zinc-950/40 hover:bg-zinc-900/40'
                          : 'hover:bg-zinc-950/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Checkbox for Select Mode */}
                    {isSelectMode && (
                      <button
                        type="button"
                        onClick={(e) =>
                          handleItemSelect(item.key, idx, e.shiftKey)
                        }
                        className="text-zinc-400 hover:text-[#00ff66] shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-[#00ff66]" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    )}

                    {/* Track Number or Ghost Status Icon */}
                    <span className="w-6 text-xs font-mono text-zinc-500 tabular-nums text-right shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>

                    {/* Artwork / Icon */}
                    {item.isGhost ? (
                      <div
                        className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                          item.status === 'downloading'
                            ? 'border-emerald-500/60 bg-emerald-950/50 text-[#00ff66]'
                            : item.status === 'queued'
                              ? 'border-sky-500/60 bg-sky-950/50 text-sky-400'
                              : item.status === 'failed'
                                ? 'border-rose-500/60 bg-rose-950/50 text-rose-400'
                                : 'border-amber-500/60 bg-amber-950/50 text-amber-400'
                        }`}
                      >
                        {item.status === 'downloading' ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : item.status === 'failed' ? (
                          <AlertTriangle className="w-5 h-5" />
                        ) : item.status === 'queued' ? (
                          <Clock className="w-5 h-5" />
                        ) : (
                          <Radio className="w-5 h-5 animate-pulse" />
                        )}
                      </div>
                    ) : item.libraryTrack ? (
                      <CachedArtworkImage
                        src={item.libraryTrack.artworkUrl}
                        alt={item.title}
                        fallbackTitle={item.title}
                        fallbackArtist={item.artist}
                        fallbackAccent={item.libraryTrack.accentColor || '#10b981'}
                        className="w-10 h-10 rounded-xl border border-zinc-800 object-cover shrink-0"
                      />
                    ) : null}

                    {/* Title, Artist, & Status Details */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-sm font-semibold truncate ${
                            isCurrent
                              ? 'text-[#00ff66]'
                              : item.isGhost
                                ? 'text-zinc-200'
                                : 'text-white'
                          }`}
                        >
                          {item.title}
                        </span>

                        {/* Distinctive Status Badges */}
                        {item.isGhost ? (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase shrink-0 ${
                              item.status === 'downloading'
                                ? 'bg-emerald-500/20 border border-emerald-500/40 text-[#00ff66]'
                                : item.status === 'queued'
                                  ? 'bg-sky-500/20 border border-sky-500/40 text-sky-300'
                                  : item.status === 'failed'
                                    ? 'bg-rose-500/20 border border-rose-500/40 text-rose-300'
                                    : 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                            }`}
                          >
                            {item.statusLabel}
                          </span>
                        ) : (
                          item.libraryTrack?.format && (
                            <span className="rounded bg-zinc-800/90 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300 uppercase shrink-0">
                              {item.libraryTrack.format}
                            </span>
                          )
                        )}
                      </div>

                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-400 font-mono">
                        <span className="truncate">{item.artist}</span>
                        {item.album && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate text-zinc-500">
                              {item.album}
                            </span>
                          </>
                        )}
                        {item.durationSec > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">
                              {formatDuration(item.durationSec)}
                            </span>
                          </>
                        )}
                        {isCached && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#00ff66] font-semibold inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Ready Offline
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Actions: Play / Retry & 3-dots Menu */}
                  <div className="flex items-center gap-2 shrink-0">
                    {item.isGhost ? (
                      item.status === 'failed' ? (
                        <button
                          type="button"
                          onClick={() =>
                            item.ghostTrack &&
                            onRetryGhostTrackDownload(item.ghostTrack)
                          }
                          data-testid={`retry-download-${item.key}`}
                          className="inline-flex items-center gap-1 rounded-xl bg-amber-500/20 border border-amber-500/40 hover:bg-amber-500/30 px-3 py-1.5 text-xs font-mono font-bold text-amber-300 transition-colors"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Retry</span>
                        </button>
                      ) : (
                        <div className="text-[11px] font-mono text-zinc-500 hidden sm:block">
                          {item.sourceEngine || 'Downloader'}
                        </div>
                      )
                    ) : item.libraryTrack ? (
                      <button
                        type="button"
                        onClick={() =>
                          onPlayTrack(item.libraryTrack as Track, readyTracks)
                        }
                        className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-mono font-bold transition-colors min-h-[34px] ${
                          isCurrent && isPlaying
                            ? 'bg-[#00ff66] text-zinc-950'
                            : 'bg-zinc-800 hover:bg-[#00ff66] hover:text-zinc-950 text-white'
                        }`}
                      >
                        {isCurrent && isPlaying ? (
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
                    ) : null}

                    {/* Three Dots (⋯) Menu Trigger */}
                    <div className="relative">
                      <button
                        type="button"
                        data-menu-trigger="true"
                        onClick={() =>
                          setOpenMenuTrackKey(isMenuOpen ? null : item.key)
                        }
                        className="rounded-xl border border-zinc-800 bg-zinc-950 hover:text-white p-2 text-zinc-400 min-h-[34px] min-w-[34px] flex items-center justify-center"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {/* Dropdown Menu */}
                      {isMenuOpen && (
                        <div
                          data-dropdown-menu="true"
                          className="absolute right-0 top-10 z-40 w-60 rounded-2xl border border-zinc-700 bg-zinc-950/95 p-1.5 shadow-2xl backdrop-blur-md space-y-1 text-xs font-mono"
                        >
                          {!item.isGhost && item.libraryTrack && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  onOpenMetadataInspector(
                                    item.libraryTrack as Track
                                  );
                                  setOpenMenuTrackKey(null);
                                }}
                                className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-zinc-200 hover:bg-zinc-900 hover:text-purple-300"
                              >
                                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                                <span>Check Metadata (MusicBrainz MBID)</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  onOpenAddToPlaylist(
                                    [item.libraryTrack as Track],
                                    `"${item.title}"`
                                  );
                                  setOpenMenuTrackKey(null);
                                }}
                                className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-zinc-200 hover:bg-zinc-900 hover:text-[#00ff66]"
                              >
                                <ListPlus className="w-3.5 h-3.5 text-[#00ff66]" />
                                <span>Add to Another Playlist</span>
                              </button>

                              <div className="border-t border-zinc-800 my-1" />
                            </>
                          )}

                          {item.isGhost && (
                            <button
                              type="button"
                              onClick={() => {
                                if (item.ghostTrack) {
                                  onRetryGhostTrackDownload(item.ghostTrack);
                                }
                                setOpenMenuTrackKey(null);
                              }}
                              className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-amber-300 hover:bg-amber-950/50"
                            >
                              <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                              <span>Search &amp; Retry Download</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={async () => {
                              if (item.isGhost && item.ghostTrack) {
                                await onRemoveTracksFromPlaylist([], [item.ghostTrack.id]);
                              } else if (item.libraryTrack) {
                                await onRemoveTracksFromPlaylist([item.libraryTrack.id]);
                              }
                              setOpenMenuTrackKey(null);
                            }}
                            className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-rose-300 hover:bg-rose-950/50"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                            <span>Remove from this Playlist</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
