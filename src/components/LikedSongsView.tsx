import React from 'react';
import {
  Heart,
  Play,
  Pause,
  Shuffle,
  Download,
  Radio,
} from 'lucide-react';
import { Track } from '../types/music';
import { CachedArtworkImage } from '../utils/artworkCache';

interface LikedSongsViewProps {
  likedTracks: Track[];
  filteredLikedTracks: Track[];
  likedGenres: string[];
  likedGenreFilter: string;
  onSetLikedGenreFilter: (genre: string) => void;
  currentTrackId: string | undefined;
  isPlaying: boolean;
  cachedTrackIds: Set<string>;
  onPlayAll: () => void;
  onShuffleAll: () => void;
  onSaveOffline: () => void;
  onBrowseAllSongs: () => void;
  onToggleLikeTrack: (track: Track) => void;
  onStartTrackRadio: (track: Track) => void;
  onPlayOrPauseTrack: (track: Track) => void;
  formatDuration: (seconds: number) => string;
}

export const LikedSongsView: React.FC<LikedSongsViewProps> = ({
  likedTracks,
  filteredLikedTracks,
  likedGenres,
  likedGenreFilter,
  onSetLikedGenreFilter,
  currentTrackId,
  isPlaying,
  cachedTrackIds,
  onPlayAll,
  onShuffleAll,
  onSaveOffline,
  onBrowseAllSongs,
  onToggleLikeTrack,
  onStartTrackRadio,
  onPlayOrPauseTrack,
  formatDuration,
}) => {
  return (
    <section
      aria-label="Liked Songs Collection"
      data-testid="liked-songs-section"
      className="winamp-bezel rounded-2xl border border-rose-500/40 overflow-hidden"
    >
      {/* Spotify-Style Gradient Banner Header */}
      <div className="bg-gradient-to-br from-rose-950/90 via-purple-950/75 to-zinc-950 p-5 sm:p-6 border-b border-rose-500/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-rose-500 via-pink-500 to-purple-600 flex items-center justify-center shadow-2xl border border-rose-300/40 shrink-0">
            <Heart className="w-8 h-8 sm:w-10 sm:h-10 text-white fill-white" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-widest text-rose-300 font-bold">
              COLLECTION // FAVORITES SYNCED TO SERVER
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white font-mono truncate mt-0.5">
              Liked Songs ❤️
            </h2>
            <p className="text-xs text-zinc-300 font-mono mt-1">
              {likedTracks.length} songs ·{' '}
              {formatDuration(
                likedTracks.reduce((acc, t) => acc + (t.duration || 0), 0)
              )}{' '}
              total · Tap ♥ on any track across Brokeify to save here
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={filteredLikedTracks.length === 0}
            onClick={onPlayAll}
            data-testid="liked-songs-play-all-btn"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-40 px-4 py-2 text-xs font-mono font-bold text-zinc-950 shadow-md transition-colors min-h-[38px]"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Play All ({filteredLikedTracks.length})</span>
          </button>

          <button
            type="button"
            disabled={filteredLikedTracks.length === 0}
            onClick={onShuffleAll}
            data-testid="liked-songs-shuffle-btn"
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-500 hover:bg-rose-400 disabled:opacity-40 px-3.5 py-2 text-xs font-mono font-bold text-white transition-colors min-h-[38px]"
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>Shuffle ❤️</span>
          </button>

          <button
            type="button"
            disabled={filteredLikedTracks.length === 0}
            onClick={onSaveOffline}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900/90 hover:text-[#00ff66] disabled:opacity-40 px-3 py-2 text-xs font-mono font-semibold text-zinc-200 transition-colors min-h-[38px]"
          >
            <Download className="w-3.5 h-3.5 text-[#00ff66]" />
            <span>Save Offline</span>
          </button>
        </div>
      </div>

      {/* Spotify-Style Genre & Mood Quick Filter Pills inside Liked Songs */}
      {likedGenres.length > 0 && (
        <div className="px-4 py-2.5 bg-zinc-950/80 border-b border-zinc-800/80 flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mr-1 shrink-0">
            Filter Mood/Genre:
          </span>
          <button
            type="button"
            onClick={() => onSetLikedGenreFilter('ALL')}
            className={`px-3 py-1 rounded-full text-xs font-mono font-semibold transition-colors whitespace-nowrap shrink-0 ${
              likedGenreFilter === 'ALL'
                ? 'bg-rose-500 text-white font-bold'
                : 'bg-zinc-900 text-zinc-300 hover:text-white border border-zinc-800'
            }`}
          >
            All ({likedTracks.length})
          </button>
          {likedGenres.map((genre) => (
            <button
              key={genre}
              type="button"
              onClick={() =>
                onSetLikedGenreFilter(likedGenreFilter === genre ? 'ALL' : genre)
              }
              className={`px-3 py-1 rounded-full text-xs font-mono font-semibold transition-colors whitespace-nowrap shrink-0 ${
                likedGenreFilter === genre
                  ? 'bg-rose-500 text-white font-bold'
                  : 'bg-zinc-900 text-zinc-300 hover:text-white border border-zinc-800'
              }`}
            >
              {genre}
            </button>
          ))}
        </div>
      )}

      <div className="p-4 sm:p-5">
        {filteredLikedTracks.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <Heart className="w-10 h-10 text-rose-400/60 mx-auto" />
            <p className="text-sm font-semibold text-zinc-200 font-mono">
              {likedTracks.length === 0
                ? 'No Liked Songs yet — tap the Heart (♥) on any song or in the player to build your favorites collection!'
                : `No Liked Songs match the "${likedGenreFilter}" filter.`}
            </p>
            <button
              type="button"
              onClick={onBrowseAllSongs}
              className="rounded-xl bg-rose-500 hover:bg-rose-400 px-4 py-2 text-xs font-mono font-bold text-white transition-colors"
            >
              Browse All Songs
            </button>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/70">
            {filteredLikedTracks.map((track, idx) => {
              const isCurrent = currentTrackId === track.id;
              const isCached = cachedTrackIds.has(track.id);
              return (
                <div
                  key={track.id}
                  data-testid={`liked-song-row-${track.id}`}
                  className={`py-2.5 px-2.5 rounded-xl flex items-center justify-between gap-3 transition-colors ${
                    isCurrent
                      ? 'bg-emerald-500/10 border border-emerald-500/30'
                      : 'hover:bg-zinc-950/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="w-6 text-xs font-mono text-zinc-500 tabular-nums text-right shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <CachedArtworkImage
                      src={track.artworkUrl}
                      alt={track.title}
                      fallbackTitle={track.title}
                      fallbackArtist={track.artist}
                      fallbackAccent={track.accentColor || '#f43f5e'}
                      className="w-10 h-10 rounded-lg border border-zinc-800 object-cover shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-semibold truncate ${
                            isCurrent ? 'text-[#00ff66]' : 'text-white'
                          }`}
                        >
                          {track.title}
                        </span>
                        {track.genre && (
                          <span className="hidden sm:inline-block rounded bg-zinc-800/90 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">
                            {track.genre}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-400 font-mono">
                        <span className="truncate">{track.artist}</span>
                        <span>·</span>
                        <span className="truncate text-zinc-300">
                          {track.album}
                        </span>
                        <span>·</span>
                        <span className="tabular-nums">
                          {formatDuration(track.duration)}
                        </span>
                        {isCached && (
                          <>
                            <span>·</span>
                            <span className="text-[#00ff66] font-semibold">
                              Vaulted
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleLikeTrack(track)}
                      title="Remove from Liked Songs"
                      aria-label={`Unlike ${track.title}`}
                      className="p-2 rounded-xl border border-rose-500/40 bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      <Heart className="w-4 h-4 fill-rose-500 text-rose-400" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onStartTrackRadio(track)}
                      title="Start Song Radio Station"
                      className="hidden sm:inline-flex items-center gap-1 rounded-xl border border-purple-500/40 bg-purple-950/30 hover:bg-purple-900/50 px-2.5 py-2 text-xs font-mono font-semibold text-purple-300 transition-colors min-h-[36px]"
                    >
                      <Radio className="w-3.5 h-3.5" />
                      <span>Radio</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onPlayOrPauseTrack(track)}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-mono font-bold transition-colors min-h-[36px] ${
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
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
