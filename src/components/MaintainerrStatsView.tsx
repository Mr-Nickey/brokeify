import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckSquare,
  Clock,
  Copy,
  Flame,
  HardDrive,
  Loader2,
  Play,
  Square,
  Trash2,
  VolumeX,
} from 'lucide-react';
import type { Track, TrackPlayStatRecord } from '../types/music';
import {
  createAlbumArtworkDataUri,
  formatDuration,
  getCanonicalSongSignature,
} from '../utils/musicLogic';

interface MaintainerrStatsViewProps {
  allTracks: Track[];
  playStats: Record<string, TrackPlayStatRecord>;
  currentTrackId?: string;
  onPlayTrack: (track: Track, contextTracks?: Track[]) => void;
  onBulkDeleteTracksFromJellyfin: (tracks: Track[]) => Promise<void>;
}

type StatsFilterMode =
  | 'on_repeat'
  | 'recent'
  | 'never_played'
  | 'stale_year'
  | 'duplicates';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '~8.5 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

export const MaintainerrStatsView: React.FC<MaintainerrStatsViewProps> = ({
  allTracks,
  playStats,
  currentTrackId,
  onPlayTrack,
  onBulkDeleteTracksFromJellyfin,
}) => {
  const [filterMode, setFilterMode] = useState<StatsFilterMode>('on_repeat');
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(
    new Set()
  );
  const [showConfirmBulkDelete, setShowConfirmBulkDelete] =
    useState<boolean>(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState<boolean>(false);

  const enrichedTracks = useMemo(() => {
    const nowMs = Date.now();
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;

    // Group by canonical song signature to detect duplicate copies on disk
    const sigCounts = new Map<string, Track[]>();
    for (const t of allTracks) {
      const sig = getCanonicalSongSignature(t);
      const list = sigCounts.get(sig) || [];
      list.push(t);
      sigCounts.set(sig, list);
    }

    return allTracks.map((t) => {
      const localStat = playStats[t.id];
      const mergedPlayCount = Math.max(
        t.playCount || 0,
        localStat?.playCount || 0
      );
      const lastPlayedIso = localStat?.lastPlayedAt || t.lastPlayedAt || undefined;
      const lastPlayedMs = lastPlayedIso ? Date.parse(lastPlayedIso) : 0;
      const daysSincePlayed =
        lastPlayedMs > 0
          ? Math.floor((nowMs - lastPlayedMs) / (24 * 60 * 60 * 1000))
          : null;

      const notListenedAllYear =
        mergedPlayCount === 0 ||
        (lastPlayedMs > 0 && nowMs - lastPlayedMs >= oneYearMs);

      const sig = getCanonicalSongSignature(t);
      const dupGroup = sigCounts.get(sig) || [t];
      const isDuplicateCopy =
        dupGroup.length > 1 && dupGroup[0].id !== t.id;

      const estimatedBytes =
        t.fileSizeBytes && t.fileSizeBytes > 0
          ? t.fileSizeBytes
          : t.format === 'FLAC'
            ? 26 * 1024 * 1024
            : 8.5 * 1024 * 1024;

      return {
        track: t,
        playCount: mergedPlayCount,
        lastPlayedIso,
        lastPlayedMs,
        daysSincePlayed,
        notListenedAllYear,
        isDuplicateCopy,
        duplicateCount: dupGroup.length,
        estimatedBytes,
      };
    });
  }, [allTracks, playStats]);

  const onRepeatTracks = useMemo(
    () =>
      [...enrichedTracks]
        .filter((x) => x.playCount > 0)
        .sort((a, b) => b.playCount - a.playCount),
    [enrichedTracks]
  );

  const recentPlayedTracks = useMemo(
    () =>
      [...enrichedTracks]
        .filter((x) => x.lastPlayedMs > 0)
        .sort((a, b) => b.lastPlayedMs - a.lastPlayedMs),
    [enrichedTracks]
  );

  const neverPlayedTracks = useMemo(
    () => enrichedTracks.filter((x) => x.playCount === 0),
    [enrichedTracks]
  );

  const staleYearTracks = useMemo(
    () => enrichedTracks.filter((x) => x.notListenedAllYear),
    [enrichedTracks]
  );

  const duplicateTracks = useMemo(
    () => enrichedTracks.filter((x) => x.isDuplicateCopy),
    [enrichedTracks]
  );

  const activeList = useMemo(() => {
    switch (filterMode) {
      case 'on_repeat':
        return onRepeatTracks;
      case 'recent':
        return recentPlayedTracks;
      case 'never_played':
        return neverPlayedTracks;
      case 'stale_year':
        return staleYearTracks;
      case 'duplicates':
        return duplicateTracks;
      default:
        return onRepeatTracks;
    }
  }, [
    filterMode,
    onRepeatTracks,
    recentPlayedTracks,
    neverPlayedTracks,
    staleYearTracks,
    duplicateTracks,
  ]);

  const totalLibraryBytes = useMemo(
    () => enrichedTracks.reduce((acc, x) => acc + x.estimatedBytes, 0),
    [enrichedTracks]
  );

  const reclaimableBytes = useMemo(
    () =>
      enrichedTracks
        .filter((x) => x.playCount === 0 || x.isDuplicateCopy)
        .reduce((acc, x) => acc + x.estimatedBytes, 0),
    [enrichedTracks]
  );

  const toggleSelectTrack = (id: string) => {
    setSelectedTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedTrackIds(new Set(activeList.map((x) => x.track.id)));
  };

  const clearSelection = () => {
    setSelectedTrackIds(new Set());
    setShowConfirmBulkDelete(false);
  };

  const selectedTrackObjects = useMemo(() => {
    return allTracks.filter((t) => selectedTrackIds.has(t.id));
  }, [allTracks, selectedTrackIds]);

  const selectedTotalBytes = useMemo(() => {
    return enrichedTracks
      .filter((x) => selectedTrackIds.has(x.track.id))
      .reduce((acc, x) => acc + x.estimatedBytes, 0);
  }, [enrichedTracks, selectedTrackIds]);

  return (
    <section
      aria-label="Library Statistics and Maintainerr Disk Cleanup"
      data-testid="maintainerr-stats-view"
      className="space-y-6"
    >
      {/* Top Overview Banner */}
      <div className="winamp-bezel rounded-2xl border border-zinc-700/80 p-5 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-white font-mono flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#00ff66] shrink-0" />
              <span>
                Library Statistics &amp; Maintainerr Disk Space Janitor
              </span>
            </h2>
            <p className="text-xs text-zinc-300 max-w-3xl leading-relaxed">
              See which songs you play on repeat, which songs have{' '}
              <strong className="text-amber-300">never been played</strong>,
              which songs you{' '}
              <strong className="text-rose-300">
                haven&apos;t listened to all year
              </strong>
              , and which{' '}
              <strong className="text-purple-300">duplicate copies</strong> are
              wasting hard drive space on your server. Select any unwanted songs
              to clean them up in bulk!
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 px-3.5 py-2 text-xs font-mono">
              <span className="text-zinc-400">Est. Library Size: </span>
              <strong className="text-[#00ff66]">
                {formatBytes(totalLibraryBytes)}
              </strong>
            </div>
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 px-3.5 py-2 text-xs font-mono">
              <span className="text-amber-200">Reclaimable Space: </span>
              <strong className="text-amber-400">
                {formatBytes(reclaimableBytes)}
              </strong>
            </div>
          </div>
        </div>

        {/* 5 Interactive Stat Filter Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <button
            type="button"
            onClick={() => setFilterMode('on_repeat')}
            data-testid="stats-card-on-repeat"
            className={`rounded-2xl border p-4 text-left transition-all ${
              filterMode === 'on_repeat'
                ? 'border-[#00ff66] bg-emerald-500/15 ring-1 ring-[#00ff66]/50'
                : 'border-zinc-800 bg-zinc-950/80 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-mono text-[#00ff66]">
              <span>ON REPEAT</span>
              <Flame className="w-4 h-4" />
            </div>
            <div className="text-2xl font-extrabold text-white font-mono mt-1">
              {onRepeatTracks.length}
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              Most played favorites
            </p>
          </button>

          <button
            type="button"
            onClick={() => setFilterMode('recent')}
            data-testid="stats-card-recent"
            className={`rounded-2xl border p-4 text-left transition-all ${
              filterMode === 'recent'
                ? 'border-[#00ff66] bg-emerald-500/15 ring-1 ring-[#00ff66]/50'
                : 'border-zinc-800 bg-zinc-950/80 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-mono text-sky-400">
              <span>RECENTLY PLAYED</span>
              <Clock className="w-4 h-4" />
            </div>
            <div className="text-2xl font-extrabold text-white font-mono mt-1">
              {recentPlayedTracks.length}
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              Tracks with play history
            </p>
          </button>

          <button
            type="button"
            onClick={() => setFilterMode('never_played')}
            data-testid="stats-card-never-played"
            className={`rounded-2xl border p-4 text-left transition-all ${
              filterMode === 'never_played'
                ? 'border-amber-400 bg-amber-500/15 ring-1 ring-amber-400/50'
                : 'border-zinc-800 bg-zinc-950/80 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-mono text-amber-300">
              <span>NEVER PLAYED</span>
              <VolumeX className="w-4 h-4" />
            </div>
            <div className="text-2xl font-extrabold text-white font-mono mt-1">
              {neverPlayedTracks.length}
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              0 plays in Jellyfin &amp; Brokeify
            </p>
          </button>

          <button
            type="button"
            onClick={() => setFilterMode('stale_year')}
            data-testid="stats-card-stale-year"
            className={`rounded-2xl border p-4 text-left transition-all ${
              filterMode === 'stale_year'
                ? 'border-rose-400 bg-rose-500/15 ring-1 ring-rose-400/50'
                : 'border-zinc-800 bg-zinc-950/80 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-mono text-rose-300">
              <span>UNPLAYED ALL YEAR</span>
              <HardDrive className="w-4 h-4" />
            </div>
            <div className="text-2xl font-extrabold text-white font-mono mt-1">
              {staleYearTracks.length}
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              Not listened to in 365+ days
            </p>
          </button>

          <button
            type="button"
            onClick={() => setFilterMode('duplicates')}
            data-testid="stats-card-duplicates"
            className={`rounded-2xl border p-4 text-left transition-all ${
              filterMode === 'duplicates'
                ? 'border-purple-400 bg-purple-500/15 ring-1 ring-purple-400/50'
                : 'border-zinc-800 bg-zinc-950/80 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-mono text-purple-300">
              <span>DUPLICATE FILES</span>
              <Copy className="w-4 h-4" />
            </div>
            <div className="text-2xl font-extrabold text-white font-mono mt-1">
              {duplicateTracks.length}
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              Extra copies of same song
            </p>
          </button>
        </div>
      </div>

      {/* Maintainerr Bulk Cleanup Action Bar */}
      <div className="winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden">
        <div className="winamp-titlebar px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-700/80">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={selectAllVisible}
              data-testid="stats-select-all-btn"
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-[#00ff66]/50 px-3 py-1.5 text-xs font-mono font-semibold text-zinc-200 hover:text-white min-h-[34px]"
            >
              <CheckSquare className="w-3.5 h-3.5 text-[#00ff66]" />
              <span>Select All Shown ({activeList.length})</span>
            </button>

            {selectedTrackIds.size > 0 && (
              <button
                type="button"
                onClick={clearSelection}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-300 hover:text-white min-h-[34px]"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Clear Selection ({selectedTrackIds.size})</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedTrackIds.size > 0 && (
              <button
                type="button"
                onClick={() => setShowConfirmBulkDelete(true)}
                data-testid="stats-bulk-delete-btn"
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-500 hover:bg-rose-400 px-3.5 py-1.5 text-xs font-mono font-bold text-white transition-colors min-h-[34px]"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  Delete {selectedTrackIds.size} Selected from Server Disk (
                  {formatBytes(selectedTotalBytes)})
                </span>
              </button>
            )}
          </div>
        </div>

        {/* 2-Step Safe Bulk Delete Warning Banner */}
        {showConfirmBulkDelete && selectedTrackObjects.length > 0 && (
          <div
            data-testid="stats-bulk-delete-confirm-banner"
            className="border-b border-rose-500/50 bg-rose-950/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <div className="font-bold text-white font-mono">
                  ⚠️ Maintainerr Disk Cleanup: Permanently delete{' '}
                  {selectedTrackObjects.length} audio file(s) from your Jellyfin
                  hard drive?
                </div>
                <p className="text-rose-200">
                  Unlike deleting a playlist (which never touches your files),
                  this action calls{' '}
                  <code className="text-white">DELETE /Items/:id</code> on your
                  Jellyfin server to free up approximately{' '}
                  <strong>{formatBytes(selectedTotalBytes)}</strong> of storage.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isDeletingBulk}
                onClick={async () => {
                  setIsDeletingBulk(true);
                  try {
                    await onBulkDeleteTracksFromJellyfin(selectedTrackObjects);
                    clearSelection();
                  } finally {
                    setIsDeletingBulk(false);
                  }
                }}
                data-testid="confirm-stats-bulk-delete-btn"
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-500 hover:bg-rose-400 px-4 py-2 text-xs font-mono font-bold text-white"
              >
                {isDeletingBulk ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                <span>Yes, Delete Files from Disk</span>
              </button>
              <button
                type="button"
                onClick={() => setShowConfirmBulkDelete(false)}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-200 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Tracks List */}
        <div className="p-4 sm:p-5">
          {activeList.length === 0 ? (
            <div className="py-10 text-center text-xs font-mono text-zinc-400">
              No tracks in this category right now.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/70 max-h-[560px] overflow-y-auto pr-1">
              {activeList.map((item) => {
                const { track, playCount, daysSincePlayed, isDuplicateCopy, estimatedBytes } =
                  item;
                const isSelected = selectedTrackIds.has(track.id);
                const isPlayingNow = currentTrackId === track.id;

                return (
                  <div
                    key={track.id}
                    className={`py-2.5 px-2 rounded-xl flex items-center justify-between gap-3 transition-colors ${
                      isSelected
                        ? 'bg-rose-500/10'
                        : isPlayingNow
                          ? 'bg-emerald-500/15'
                          : 'hover:bg-zinc-950/60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => toggleSelectTrack(track.id)}
                        aria-label={`Select ${track.title}`}
                        className="text-zinc-400 hover:text-[#00ff66] shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-[#00ff66]" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>

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
                        className="w-10 h-10 rounded-lg border border-zinc-800 object-cover shrink-0"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-white truncate">
                            {track.title}
                          </span>
                          <span className="rounded bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66]">
                            {playCount} {playCount === 1 ? 'Play' : 'Plays'}
                          </span>
                          {isDuplicateCopy && (
                            <span className="rounded bg-purple-500/20 border border-purple-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-purple-300">
                              Duplicate Copy
                            </span>
                          )}
                        </div>

                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400 font-mono">
                          <span className="truncate">{track.artist}</span>
                          <span>·</span>
                          <span>{formatDuration(track.duration)}</span>
                          <span>·</span>
                          <span>{formatBytes(estimatedBytes)}</span>
                          <span>·</span>
                          <span>
                            {daysSincePlayed === null
                              ? 'Never played'
                              : daysSincePlayed === 0
                                ? 'Played today'
                                : `Played ${daysSincePlayed}d ago`}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          onPlayTrack(
                            track,
                            activeList.map((x) => x.track)
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-800 hover:bg-[#00ff66] hover:text-zinc-950 px-3 py-1.5 text-xs font-mono font-bold text-white transition-colors min-h-[34px]"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Play</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
