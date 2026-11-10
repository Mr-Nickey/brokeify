import React, { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  Check,
  CheckCircle2,
  Database,
  Disc,
  ExternalLink,
  Link2,
  ListPlus,
  Loader2,
  Music,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  AutopilotScheduleInterval,
  Playlist,
  SlskdGrabJob,
  Track,
} from '../types/music';

// ============================================================================
// 1. UNIFIED SPOTIFY PLAYLIST IMPORTER & GHOST SONG AUTO-DOWNLOADER MODAL
// ============================================================================

interface SpotifyPlaylistImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPlaylist?: Playlist | null;
  initialSpotifyUrl?: string;
  initialSchedule?: AutopilotScheduleInterval;
  playlists: Playlist[];
  preferredDownloader: string;
  onImportedSuccess: (data: {
    playlist: Playlist;
    playlists: Playlist[];
    jobs: SlskdGrabJob[];
    message: string;
  }) => void;
  onShowToast: (msg: string) => void;
}

export const SpotifyPlaylistImporterModal: React.FC<
  SpotifyPlaylistImporterModalProps
> = ({
  isOpen,
  onClose,
  initialPlaylist,
  initialSpotifyUrl = '',
  initialSchedule = 'weekly',
  playlists,
  preferredDownloader,
  onImportedSuccess,
  onShowToast,
}) => {
  const [spotifyUrl, setSpotifyUrl] = useState(initialSpotifyUrl);
  const [targetPlaylistId, setTargetPlaylistId] = useState<string>(
    initialPlaylist?.id || '__new__'
  );
  const [customPlaylistName, setCustomPlaylistName] = useState<string>(
    initialPlaylist?.name || ''
  );
  const [sourceMode, setSourceMode] = useState<string>(
    preferredDownloader || 'auto'
  );
  const [autoDownloadMissing, setAutoDownloadMissing] = useState<boolean>(true);
  const [schedule, setSchedule] =
    useState<AutopilotScheduleInterval>(initialSchedule);
  const [rawTracklist, setRawTracklist] = useState<string>('');
  const [showManualFallback, setShowManualFallback] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSpotifyUrl(
        initialSpotifyUrl ||
          initialPlaylist?.linkedSpotifyUrl ||
          initialPlaylist?.autopilotSpotifyUrl ||
          ''
      );
      setTargetPlaylistId(initialPlaylist?.id || '__new__');
      setCustomPlaylistName(initialPlaylist?.name || '');
      setSourceMode(preferredDownloader || 'auto');
      setSchedule(initialSchedule || 'weekly');
      setErrorMsg(null);
    }
  }, [
    isOpen,
    initialPlaylist,
    initialSpotifyUrl,
    initialSchedule,
    preferredDownloader,
  ]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spotifyUrl.trim() && !rawTracklist.trim()) {
      setErrorMsg(
        'Paste a Spotify Playlist/Album link or enter "Artist - Title" lines.'
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const resp = await fetch('/api/playlists/import-spotify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spotifyUrl: spotifyUrl.trim(),
          rawTracklist: rawTracklist.trim(),
          playlistId: targetPlaylistId === '__new__' ? '' : targetPlaylistId,
          playlistName:
            targetPlaylistId === '__new__'
              ? customPlaylistName.trim()
              : playlists.find((p) => p.id === targetPlaylistId)?.name ||
                customPlaylistName.trim(),
          autoDownloadMissing,
          sourceMode,
          schedule,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        setErrorMsg(
          data.error ||
            'Could not import Spotify playlist. Make sure the playlist is public or paste the tracklist below.'
        );
        setShowManualFallback(true);
        return;
      }

      onImportedSuccess({
        playlist: data.playlist,
        playlists: Array.isArray(data.playlists) ? data.playlists : [],
        jobs: Array.isArray(data.jobs) ? data.jobs : [],
        message:
          data.message ||
          `Imported "${data.playlist?.name || 'Spotify Playlist'}"!`,
      });
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Network error importing Spotify playlist.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid="autopilot-link-modal"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-3xl border-2 border-[#00ff66]/60 bg-zinc-950 p-5 sm:p-6 space-y-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-base sm:text-lg font-bold text-white font-mono flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#00ff66] shrink-0" />
              <span>
                Import Spotify Playlist &amp; Auto-Download Missing Songs
              </span>
            </h3>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Every song from Spotify will populate inside your playlist right
              away: songs already in <code className="text-[#00ff66]">/music</code>{' '}
              appear as playable tracks, and missing songs appear as{' '}
              <strong className="text-purple-300">Ghost Songs</strong> with live
              real-time download status (<code className="text-zinc-200">slskd</code>,{' '}
              <code className="text-zinc-200">Lidarr</code>, or{' '}
              <code className="text-zinc-200">YouTube Music</code>) so you never
              have to guess what is missing or downloading.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-12">
              <label className="block text-xs font-mono font-bold text-zinc-200 mb-1">
                1. Spotify Playlist or Album Link
              </label>
              <input
                type="text"
                value={spotifyUrl}
                onChange={(e) => setSpotifyUrl(e.target.value)}
                placeholder="https://open.spotify.com/playlist/..."
                data-testid="modal-autopilot-spotify-url"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-xs font-mono text-white placeholder-zinc-500 focus:border-[#00ff66] focus:outline-none"
              />
            </div>

            <div className="sm:col-span-6">
              <label className="block text-xs font-mono font-bold text-zinc-200 mb-1">
                2. Target Playlist
              </label>
              <select
                value={targetPlaylistId}
                onChange={(e) => {
                  const val = e.target.value;
                  setTargetPlaylistId(val);
                  if (val !== '__new__') {
                    const found = playlists.find((p) => p.id === val);
                    if (found) setCustomPlaylistName(found.name);
                  } else {
                    setCustomPlaylistName('');
                  }
                }}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
              >
                <option value="__new__">
                  + Create New Playlist from Spotify
                </option>
                {playlists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    Add to: {pl.name} ({pl.trackIds.length} in library
                    {pl.ghostTracks?.length
                      ? ` / ${pl.ghostTracks.length} total`
                      : ''}
                    )
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-6">
              <label className="block text-xs font-mono font-bold text-zinc-200 mb-1">
                Playlist Name (Optional — auto-detected from Spotify)
              </label>
              <input
                type="text"
                value={customPlaylistName}
                onChange={(e) => setCustomPlaylistName(e.target.value)}
                placeholder="Leave blank to use Spotify's playlist title..."
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-xs font-mono text-white placeholder-zinc-500 focus:border-[#00ff66] focus:outline-none"
              />
            </div>

            <div className="sm:col-span-6">
              <label className="block text-xs font-mono font-bold text-zinc-200 mb-1">
                3. Download App for Missing Ghost Songs
              </label>
              <select
                value={sourceMode}
                onChange={(e) => setSourceMode(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-xs font-mono font-bold text-[#00ff66] focus:border-[#00ff66] focus:outline-none"
              >
                <option value="auto">
                  ⚡ Auto Chain (slskd → Lidarr → YouTube Music)
                </option>
                <option value="slskd">slskd Only (Soulseek P2P)</option>
                <option value="lidarr">Lidarr Only (Usenet / Torrents)</option>
                <option value="youtube">
                  YouTube Music Only (yt-dlp Audio)
                </option>
              </select>
            </div>

            <div className="sm:col-span-6">
              <label className="block text-xs font-mono font-bold text-zinc-200 mb-1">
                4. Keep Synced with Spotify (Autopilot)
              </label>
              <select
                value={schedule}
                onChange={(e) =>
                  setSchedule(e.target.value as AutopilotScheduleInterval)
                }
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-xs font-mono text-purple-300 font-bold focus:border-[#00ff66] focus:outline-none"
              >
                <option value="weekly">Weekly Auto-Sync</option>
                <option value="daily">Daily Auto-Sync</option>
                <option value="monthly">Monthly Auto-Sync</option>
                <option value="off">One-Time Import Only</option>
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3.5 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2.5 cursor-pointer text-xs font-mono text-zinc-200">
              <input
                type="checkbox"
                checked={autoDownloadMissing}
                onChange={(e) => setAutoDownloadMissing(e.target.checked)}
                className="w-4 h-4 accent-[#00ff66] rounded"
              />
              <span>
                <strong>Auto-download missing Ghost Songs immediately</strong>{' '}
                (shows live status per song inside the playlist)
              </span>
            </label>

            <button
              type="button"
              onClick={() => setShowManualFallback(!showManualFallback)}
              className="text-[11px] font-mono text-purple-300 hover:text-white underline"
            >
              {showManualFallback
                ? 'Hide manual song list'
                : 'Or paste song list manually'}
            </button>
          </div>

          {showManualFallback && (
            <div>
              <label className="block text-xs font-mono text-zinc-300 mb-1">
                Manual Song List (Optional — one &ldquo;Artist - Song Title&rdquo; per
                line)
              </label>
              <textarea
                rows={4}
                value={rawTracklist}
                onChange={(e) => setRawTracklist(e.target.value)}
                placeholder={'Daft Punk - Digital Love\nKavinsky - Nightcall'}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
              />
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl border border-rose-500/50 bg-rose-950/50 px-3.5 py-2.5 text-xs font-mono text-rose-200">
              ⚠️ {errorMsg}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-4 py-2.5 text-xs font-mono font-semibold text-zinc-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="modal-autopilot-save-btn"
              className="inline-flex items-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-50 px-5 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[40px]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Importing &amp; Matching Library...</span>
                </>
              ) : (
                <>
                  <ArrowDownToLine className="w-4 h-4" />
                  <span>
                    {autoDownloadMissing
                      ? 'Import Playlist & Auto-Download Missing'
                      : 'Import Playlist with Ghost Songs'}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// 2. ADD SELECTED SONGS / ALBUMS / ARTISTS TO PLAYLIST MODAL
// ============================================================================

interface AddToPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  tracksToAdd: Track[];
  sourceLabel: string;
  playlists: Playlist[];
  onAddTracksToPlaylist: (playlistId: string, tracks: Track[]) => void;
  onCreatePlaylistWithTracks: (playlistName: string, tracks: Track[]) => void;
}

export const AddToPlaylistModal: React.FC<AddToPlaylistModalProps> = ({
  isOpen,
  onClose,
  tracksToAdd,
  sourceLabel,
  playlists,
  onAddTracksToPlaylist,
  onCreatePlaylistWithTracks,
}) => {
  const [newPlaylistName, setNewPlaylistName] = useState('');

  if (!isOpen || tracksToAdd.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid="add-to-playlist-modal"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl border-2 border-[#00ff66]/60 bg-zinc-950 p-5 sm:p-6 space-y-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
              <ListPlus className="w-5 h-5 text-[#00ff66]" />
              <span>Add to Playlist</span>
            </h3>
            <p className="text-xs text-zinc-400 font-mono mt-1">
              Adding <strong className="text-[#00ff66]">{tracksToAdd.length}</strong>{' '}
              track(s) from <strong className="text-white">{sourceLabel}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Create New Playlist with these tracks */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newPlaylistName.trim()) return;
            onCreatePlaylistWithTracks(newPlaylistName.trim(), tracksToAdd);
            setNewPlaylistName('');
            onClose();
          }}
          className="flex items-center gap-2 pt-1"
        >
          <input
            type="text"
            value={newPlaylistName}
            onChange={(e) => setNewPlaylistName(e.target.value)}
            placeholder="Or create a new playlist name..."
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-mono text-white placeholder-zinc-500 focus:border-[#00ff66] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!newPlaylistName.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-40 px-3.5 py-2 text-xs font-mono font-bold text-zinc-950 shrink-0 min-h-[36px]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create &amp; Add</span>
          </button>
        </form>

        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
            Select an Existing Playlist ({playlists.length})
          </div>
          {playlists.length === 0 ? (
            <p className="text-xs text-zinc-500 font-mono py-4 text-center">
              No existing playlists yet. Type a name above to create one!
            </p>
          ) : (
            playlists.map((pl) => (
              <button
                key={pl.id}
                type="button"
                onClick={() => {
                  onAddTracksToPlaylist(pl.id, tracksToAdd);
                  onClose();
                }}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900/80 hover:border-[#00ff66] hover:bg-emerald-950/20 p-3 flex items-center justify-between gap-3 text-left transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-white truncate">
                    {pl.name}
                  </div>
                  <div className="text-[11px] font-mono text-zinc-400">
                    {pl.trackIds.length} tracks in library
                    {pl.ghostTracks?.length
                      ? ` · ${pl.ghostTracks.length} total songs`
                      : ''}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-lg bg-[#00ff66]/15 border border-[#00ff66]/40 px-2.5 py-1 text-[11px] font-mono font-bold text-[#00ff66] shrink-0">
                  <Plus className="w-3 h-3" />
                  Add Here
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 2B. LINK & MERGE PLAYLISTS MODAL
// ============================================================================

interface MergePlaylistsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPlaylists: Playlist[];
  allPlaylists: Playlist[];
  onMergeSuccess: (data: {
    playlist: Playlist;
    playlists: Playlist[];
    message: string;
  }) => void;
  onShowToast: (msg: string) => void;
}

export const MergePlaylistsModal: React.FC<MergePlaylistsModalProps> = ({
  isOpen,
  onClose,
  selectedPlaylists,
  allPlaylists,
  onMergeSuccess,
  onShowToast,
}) => {
  const [mergeTargetMode, setMergeTargetMode] = useState<'new' | 'existing'>('new');
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState(
    selectedPlaylists[0]?.id || ''
  );
  const [isMerging, setIsMerging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const defaultName = selectedPlaylists.map((p) => p.name).join(' + ');
      setNewPlaylistName(defaultName || 'Linked Playlists');
      setSelectedTargetId(selectedPlaylists[0]?.id || '');
      setErrorMsg(null);
    }
  }, [isOpen, selectedPlaylists]);

  if (!isOpen || selectedPlaylists.length === 0) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsMerging(true);
    setErrorMsg(null);

    try {
      const payload: any = {
        sourcePlaylistIds: selectedPlaylists.map((p) => p.id),
      };

      if (mergeTargetMode === 'new') {
        payload.newPlaylistName = newPlaylistName.trim() || 'Merged Playlist';
      } else {
        payload.targetPlaylistId = selectedTargetId;
      }

      const resp = await fetch('/api/playlists/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || 'Failed to merge playlists.');
      }

      onShowToast(data.message || 'Playlists successfully linked!');
      onMergeSuccess(data);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to merge.');
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid="merge-playlists-modal"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl border-2 border-purple-500/60 bg-zinc-950 p-5 sm:p-6 space-y-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
              <Link2 className="w-5 h-5 text-purple-400" />
              <span>Link &amp; Merge {selectedPlaylists.length} Playlists</span>
            </h3>
            <p className="text-xs text-zinc-400 font-mono mt-1">
              Combine songs and ghost tracks from multiple playlists into one
              unified playlist.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selected playlists chip list */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
          <div className="text-[11px] font-mono text-zinc-400">
            Playlists to combine:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedPlaylists.map((pl) => (
              <span
                key={pl.id}
                className="inline-flex items-center gap-1 rounded-lg border border-purple-500/40 bg-purple-950/40 px-2.5 py-1 text-xs font-mono text-purple-200"
              >
                <Music className="w-3 h-3 text-purple-400" />
                <span>{pl.name}</span>
                <span className="text-zinc-500 text-[10px]">
                  ({pl.trackIds.length}tr)
                </span>
              </span>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-mono text-zinc-300 block">
              Merge Destination
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMergeTargetMode('new')}
                className={`rounded-xl border px-3 py-2 text-xs font-mono font-bold transition-colors ${
                  mergeTargetMode === 'new'
                    ? 'border-[#00ff66] bg-emerald-500/20 text-[#00ff66]'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                }`}
              >
                Create New Playlist
              </button>
              <button
                type="button"
                onClick={() => setMergeTargetMode('existing')}
                className={`rounded-xl border px-3 py-2 text-xs font-mono font-bold transition-colors ${
                  mergeTargetMode === 'existing'
                    ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                }`}
              >
                Merge Into Existing
              </button>
            </div>
          </div>

          {mergeTargetMode === 'new' ? (
            <div>
              <label className="text-xs font-mono text-zinc-300 mb-1 block">
                New Merged Playlist Name
              </label>
              <input
                type="text"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                placeholder="e.g. Master Mix (Favorites + Driving)"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-xs font-mono text-white placeholder-zinc-500 focus:border-[#00ff66] focus:outline-none"
              />
            </div>
          ) : (
            <div>
              <label className="text-xs font-mono text-zinc-300 mb-1 block">
                Choose Target Playlist
              </label>
              <select
                value={selectedTargetId}
                onChange={(e) => setSelectedTargetId(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
              >
                {allPlaylists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.trackIds.length} tracks)
                  </option>
                ))}
              </select>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs font-mono text-rose-300">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-4 py-2 text-xs font-mono font-semibold text-zinc-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isMerging}
              className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-4 py-2 text-xs font-mono font-bold text-white transition-colors min-h-[38px]"
            >
              {isMerging ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Linking Playlists...</span>
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4" />
                  <span>Confirm Link &amp; Merge</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// 3. MUSICBRAINZ (MBID — THE IMDb OF MUSIC) METADATA INSPECTOR & MATCHER MODAL
// ============================================================================

export interface MetadataInspectorTarget {
  mode: 'track' | 'album' | 'artist' | 'bulk';
  label: string;
  tracks: Track[];
}

interface MusicBrainzSearchResult {
  recordingMbid: string;
  title: string;
  artist: string;
  artistMbid: string | null;
  album: string;
  releaseMbid: string | null;
  year: number | null;
  score: number;
  musicbrainzUrl: string | null;
  coverArtUrl: string | null;
}

interface MetadataInspectorModalProps {
  target: MetadataInspectorTarget | null;
  onClose: () => void;
  onMetadataUpdated: () => void;
  onShowToast: (msg: string) => void;
}

export const MetadataInspectorModal: React.FC<MetadataInspectorModalProps> = ({
  target,
  onClose,
  onMetadataUpdated,
  onShowToast,
}) => {
  const primaryTrack = target?.tracks[0] || null;
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [year, setYear] = useState('');
  const [genre, setGenre] = useState('');
  const [musicbrainzId, setMusicbrainzId] = useState('');
  const [albumMusicbrainzId, setAlbumMusicbrainzId] = useState('');
  const [artistMusicbrainzId, setArtistMusicbrainzId] = useState('');

  const [isSearchingMb, setIsSearchingMb] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [mbResults, setMbResults] = useState<MusicBrainzSearchResult[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (target && primaryTrack) {
      setTitle(primaryTrack.title || '');
      setArtist(primaryTrack.artist || '');
      setAlbum(primaryTrack.album || '');
      setYear(primaryTrack.year ? String(primaryTrack.year) : '');
      setGenre(primaryTrack.genre || 'Music');
      setMusicbrainzId(primaryTrack.musicbrainzId || '');
      setAlbumMusicbrainzId(primaryTrack.albumMusicbrainzId || '');
      setArtistMusicbrainzId(primaryTrack.artistMusicbrainzId || '');
      setMbResults([]);
      setStatusMsg(null);
    }
  }, [target, primaryTrack]);

  if (!target || !primaryTrack) return null;

  const isSingleTrack = target.tracks.length === 1;

  const handleSearchMusicBrainz = async () => {
    setIsSearchingMb(true);
    setStatusMsg(null);
    try {
      const params = new URLSearchParams();
      if (isSingleTrack && title.trim()) params.set('title', title.trim());
      if (artist.trim()) params.set('artist', artist.trim());
      if (album.trim() && album.trim() !== 'Singles') {
        params.set('album', album.trim());
      }
      if (!params.toString()) {
        params.set('q', `${artist} ${title}`.trim());
      }

      const resp = await fetch(
        `/api/metadata/musicbrainz-search?${params.toString()}`
      );
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && Array.isArray(data.results)) {
        setMbResults(data.results);
        if (data.results.length === 0) {
          setStatusMsg(
            'No exact MusicBrainz match found. Try adjusting Artist or Title and searching again.'
          );
        }
      } else {
        setStatusMsg(data.error || 'MusicBrainz search failed.');
      }
    } catch (err) {
      setStatusMsg(
        err instanceof Error ? err.message : 'MusicBrainz lookup error.'
      );
    } finally {
      setIsSearchingMb(false);
    }
  };

  const handleAutoRefreshMusicBrainz = async () => {
    setIsSaving(true);
    setStatusMsg('Querying MusicBrainz & Cover Art Archive...');
    try {
      const resp = await fetch('/api/metadata/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackIds: target.tracks.map((t) => t.id),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        onShowToast(
          `🔗 ${data.message || 'Refreshed metadata & MusicBrainz IDs!'}`
        );
        onMetadataUpdated();
        onClose();
      } else {
        setStatusMsg(data.error || data.message || 'Auto-match failed.');
      }
    } catch (err) {
      setStatusMsg(
        err instanceof Error ? err.message : 'Failed to auto-refresh metadata.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveManualOrSelectedMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setStatusMsg(null);
    try {
      const resp = await fetch('/api/metadata/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackIds: target.tracks.map((t) => t.id),
          manualOverride: {
            title: isSingleTrack ? title.trim() : undefined,
            artist: artist.trim() || undefined,
            album: album.trim() || undefined,
            year: year.trim() ? Number(year.trim()) : null,
            genre: genre.trim() || undefined,
            musicbrainzId: isSingleTrack ? musicbrainzId.trim() || null : undefined,
            albumMusicbrainzId: albumMusicbrainzId.trim() || null,
            artistMusicbrainzId: artistMusicbrainzId.trim() || null,
          },
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        onShowToast(
          `💾 Saved metadata & MusicBrainz IDs for ${target.tracks.length} track(s)!`
        );
        onMetadataUpdated();
        onClose();
      } else {
        setStatusMsg(data.error || 'Failed to save metadata.');
      }
    } catch (err) {
      setStatusMsg(
        err instanceof Error ? err.message : 'Failed to save metadata.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid="metadata-inspector-modal"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-3xl border-2 border-purple-500/60 bg-zinc-950 p-5 sm:p-6 space-y-4 shadow-2xl my-8"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-white font-mono flex items-center gap-2">
              <Database className="w-5 h-5 text-[#00ff66]" />
              <span>
                Metadata Inspector &amp; MusicBrainz ID Linker (The IMDb of
                Music)
              </span>
            </h3>
            <p className="text-xs text-zinc-300 mt-1">
              Inspecting{' '}
              <strong className="text-[#00ff66]">{target.label}</strong> (
              {target.tracks.length} track
              {target.tracks.length === 1 ? '' : 's'}). MusicBrainz IDs (
              <code className="text-purple-300">MBID</code>) work just like IMDb
              IDs for movies — linking exact songs, official albums, release
              years, and Cover Art Archive artwork!
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* File & Audio Technical Readout */}
        {isSingleTrack && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3 text-[11px] font-mono text-zinc-300 space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong className="text-zinc-400">Format:</strong>{' '}
                <span className="text-[#00ff66]">
                  {primaryTrack.format || 'MP3'}
                </span>{' '}
                · {primaryTrack.bitrateKbps || 320} kbps
              </span>
              <span>
                <strong className="text-zinc-400">LUFS Gain:</strong>{' '}
                {primaryTrack.normalizationGain ?? 0} dB
              </span>
            </div>
            {primaryTrack.filePath && (
              <div className="truncate text-zinc-400" title={primaryTrack.filePath}>
                <strong>Disk Path:</strong>{' '}
                <code className="text-zinc-200">{primaryTrack.filePath}</code>
              </div>
            )}
          </div>
        )}

        {/* Quick 1-Click MusicBrainz Lookup Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isSaving}
            onClick={handleAutoRefreshMusicBrainz}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-50 px-4 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[38px]"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>
              1-Click Auto-Match &amp; Pull Official Metadata (MusicBrainz)
            </span>
          </button>

          <button
            type="button"
            disabled={isSearchingMb}
            onClick={handleSearchMusicBrainz}
            className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/50 bg-purple-950/40 hover:bg-purple-900/50 px-3.5 py-2 text-xs font-mono font-bold text-purple-200 transition-colors min-h-[38px]"
          >
            {isSearchingMb ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
            <span>Search MusicBrainz Releases</span>
          </button>
        </div>

        {/* Live MusicBrainz Search Results Picker */}
        {mbResults.length > 0 && (
          <div className="rounded-2xl border border-purple-500/40 bg-zinc-900/90 p-3 space-y-2 max-h-56 overflow-y-auto">
            <div className="text-[11px] font-mono font-bold uppercase text-purple-300">
              Select a MusicBrainz Match to Populate Tags &amp; MBIDs:
            </div>
            {mbResults.map((r) => (
              <div
                key={`${r.recordingMbid}-${r.releaseMbid || 'rel'}`}
                className="rounded-xl border border-zinc-800 bg-zinc-950 p-2.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1 text-xs font-mono">
                  <div className="font-bold text-white truncate">
                    {r.title}{' '}
                    <span className="text-[#00ff66]">— {r.artist}</span>
                  </div>
                  <div className="text-[11px] text-zinc-400 truncate">
                    Album: <span className="text-zinc-200">{r.album}</span>
                    {r.year ? ` (${r.year})` : ''} · MBID:{' '}
                    <code className="text-purple-300">
                      {r.recordingMbid.slice(0, 8)}…
                    </code>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {r.musicbrainzUrl && (
                    <a
                      href={r.musicbrainzUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-300 hover:text-white"
                      title="Open on MusicBrainz.org"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (isSingleTrack) setTitle(r.title);
                      setArtist(r.artist);
                      setAlbum(r.album);
                      if (r.year) setYear(String(r.year));
                      if (isSingleTrack) setMusicbrainzId(r.recordingMbid);
                      if (r.releaseMbid) setAlbumMusicbrainzId(r.releaseMbid);
                      if (r.artistMbid) setArtistMusicbrainzId(r.artistMbid);
                      setStatusMsg(
                        `Loaded match "${r.artist} - ${r.title}" (${r.album}). Click Save below to apply!`
                      );
                    }}
                    className="rounded-lg bg-purple-600 hover:bg-purple-500 px-2.5 py-1.5 text-[11px] font-mono font-bold text-white"
                  >
                    Use Match
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Editable Metadata & MusicBrainz ID Form */}
        <form
          onSubmit={handleSaveManualOrSelectedMetadata}
          className="space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            {isSingleTrack && (
              <div className="sm:col-span-6">
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  Track Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                />
              </div>
            )}

            <div className={isSingleTrack ? 'sm:col-span-6' : 'sm:col-span-6'}>
              <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                Artist Name
              </label>
              <input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
              />
            </div>

            <div className="sm:col-span-6">
              <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                Album Title
              </label>
              <input
                type="text"
                value={album}
                onChange={(e) => setAlbum(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                Release Year
              </label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2024"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                Genre
              </label>
              <input
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
              />
            </div>

            {isSingleTrack && (
              <div className="sm:col-span-4">
                <label className="block text-[11px] font-mono text-purple-300 mb-1 flex items-center justify-between">
                  <span>Recording MBID (Song ID)</span>
                  {musicbrainzId && (
                    <a
                      href={`https://musicbrainz.org/recording/${encodeURIComponent(
                        musicbrainzId
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#00ff66] hover:underline inline-flex items-center gap-0.5"
                    >
                      <span>Open</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </label>
                <input
                  type="text"
                  value={musicbrainzId}
                  onChange={(e) => setMusicbrainzId(e.target.value)}
                  placeholder="e.g. 8f3471b5-..."
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-mono text-purple-200 focus:border-[#00ff66] focus:outline-none"
                />
              </div>
            )}

            <div className={isSingleTrack ? 'sm:col-span-4' : 'sm:col-span-6'}>
              <label className="block text-[11px] font-mono text-purple-300 mb-1 flex items-center justify-between">
                <span>Release MBID (Album Cover ID)</span>
                {albumMusicbrainzId && (
                  <a
                    href={`https://musicbrainz.org/release/${encodeURIComponent(
                      albumMusicbrainzId
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#00ff66] hover:underline inline-flex items-center gap-0.5"
                  >
                    <span>Open</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </label>
              <input
                type="text"
                value={albumMusicbrainzId}
                onChange={(e) => setAlbumMusicbrainzId(e.target.value)}
                placeholder="e.g. a1b2c3d4-..."
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-mono text-purple-200 focus:border-[#00ff66] focus:outline-none"
              />
            </div>

            <div className={isSingleTrack ? 'sm:col-span-4' : 'sm:col-span-6'}>
              <label className="block text-[11px] font-mono text-purple-300 mb-1 flex items-center justify-between">
                <span>Artist MBID</span>
                {artistMusicbrainzId && (
                  <a
                    href={`https://musicbrainz.org/artist/${encodeURIComponent(
                      artistMusicbrainzId
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#00ff66] hover:underline inline-flex items-center gap-0.5"
                  >
                    <span>Open</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </label>
              <input
                type="text"
                value={artistMusicbrainzId}
                onChange={(e) => setArtistMusicbrainzId(e.target.value)}
                placeholder="e.g. 056e4f3e-..."
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-mono text-purple-200 focus:border-[#00ff66] focus:outline-none"
              />
            </div>
          </div>

          {statusMsg && (
            <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-mono text-[#00ff66]">
              {statusMsg}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-4 py-2 text-xs font-mono font-semibold text-zinc-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-4 py-2 text-xs font-mono font-bold text-white transition-colors min-h-[38px]"
            >
              <Check className="w-4 h-4" />
              <span>Save Metadata &amp; MBIDs</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
