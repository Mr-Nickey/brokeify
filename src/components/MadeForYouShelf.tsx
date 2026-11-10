import React from 'react';
import {
  Heart,
  Flame,
  Zap,
  Clock,
  Sparkles,
  Shuffle,
} from 'lucide-react';
import { Track } from '../types/music';

interface MadeForYouShelfProps {
  likedTracks: Track[];
  onRepeatTracks: Track[];
  dailyMixTracks: Track[];
  timeCapsuleTracks: Track[];
  onOpenLikedSongs: () => void;
  onShuffleLikedSongs: () => void;
  onPlayOnRepeat: () => void;
  onPlayDailyMix: () => void;
  onPlayTimeCapsule: () => void;
}

export const MadeForYouShelf: React.FC<MadeForYouShelfProps> = ({
  likedTracks,
  onRepeatTracks,
  dailyMixTracks,
  timeCapsuleTracks,
  onOpenLikedSongs,
  onShuffleLikedSongs,
  onPlayOnRepeat,
  onPlayDailyMix,
  onPlayTimeCapsule,
}) => {
  return (
    <div
      data-testid="made-for-you-shelf"
      className="winamp-bezel rounded-2xl border border-zinc-700/80 p-4 sm:p-5 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#00ff66]" />
          <h2 className="text-xs sm:text-sm font-mono font-bold uppercase tracking-wider text-white">
            MADE FOR YOU // LIKED SONGS &amp; SMART DAILY MIXES
          </h2>
        </div>
        <span className="text-[11px] font-mono text-zinc-400">
          Auto-curated from your Favorites, Play History &amp; Library
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {/* Card 1: Liked Songs ❤️ */}
        <div
          data-testid="made-for-you-liked-card"
          className="rounded-2xl border border-rose-500/40 bg-gradient-to-br from-rose-950/80 via-zinc-950 to-purple-950/60 p-4 flex flex-col justify-between gap-3 hover:border-rose-400/70 transition-all shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shrink-0">
              <Heart className="w-6 h-6 text-white fill-white" />
            </div>
            <span className="rounded-full bg-rose-500/20 border border-rose-500/40 px-2.5 py-0.5 text-[10px] font-mono font-bold text-rose-300">
              {likedTracks.length} Tracks
            </span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-white font-mono">
              Liked Songs ❤️
            </h3>
            <p className="text-[11px] text-zinc-300 mt-0.5 line-clamp-2">
              Every song you tap the heart on across your library, playlists, or
              player.
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onOpenLikedSongs}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-500 hover:bg-rose-400 px-3 py-2 text-xs font-mono font-bold text-white transition-colors"
            >
              <Heart className="w-3.5 h-3.5 fill-current" />
              <span>Open Collection</span>
            </button>
            {likedTracks.length > 0 && (
              <button
                type="button"
                onClick={onShuffleLikedSongs}
                title="Shuffle Liked Songs"
                className="rounded-xl border border-rose-500/50 bg-zinc-900/90 hover:bg-zinc-800 px-2.5 py-2 text-xs font-mono font-bold text-rose-300"
              >
                <Shuffle className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Card 2: On Repeat 🔥 */}
        <div
          data-testid="made-for-you-onrepeat-card"
          className="rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-950/70 via-zinc-950 to-orange-950/50 p-4 flex flex-col justify-between gap-3 hover:border-amber-400/70 transition-all shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-lg shrink-0">
              <Flame className="w-6 h-6 text-zinc-950 fill-zinc-950" />
            </div>
            <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2.5 py-0.5 text-[10px] font-mono font-bold text-amber-300">
              {onRepeatTracks.length} Heavy Rotation
            </span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-white font-mono">
              On Repeat 🔥
            </h3>
            <p className="text-[11px] text-zinc-300 mt-0.5 line-clamp-2">
              Songs you&apos;ve been playing the most recently, ranked by play
              count &amp; favorites.
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={onRepeatTracks.length === 0}
              onClick={onPlayOnRepeat}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-40 px-3 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors"
            >
              <Flame className="w-3.5 h-3.5" />
              <span>Play On Repeat</span>
            </button>
          </div>
        </div>

        {/* Card 3: Daily Mix 1 ⚡ */}
        <div
          data-testid="made-for-you-dailymix-card"
          className="rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/70 via-zinc-950 to-teal-950/50 p-4 flex flex-col justify-between gap-3 hover:border-emerald-400/70 transition-all shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#00ff66] to-emerald-600 flex items-center justify-center shadow-lg shrink-0">
              <Zap className="w-6 h-6 text-zinc-950 fill-zinc-950" />
            </div>
            <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 text-[10px] font-mono font-bold text-[#00ff66]">
              {dailyMixTracks.length} Blended
            </span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-white font-mono">
              Daily Mix 1 ⚡
            </h3>
            <p className="text-[11px] text-zinc-300 mt-0.5 line-clamp-2">
              Your favorite artists &amp; liked tracks blended with matching
              genre &amp; BPM cuts.
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={dailyMixTracks.length === 0}
              onClick={onPlayDailyMix}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-40 px-3 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Play Daily Mix</span>
            </button>
          </div>
        </div>

        {/* Card 4: Time Capsule / Deep Cuts 🕰️ */}
        <div
          data-testid="made-for-you-timecapsule-card"
          className="rounded-2xl border border-purple-500/40 bg-gradient-to-br from-purple-950/70 via-zinc-950 to-indigo-950/60 p-4 flex flex-col justify-between gap-3 hover:border-purple-400/70 transition-all shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shrink-0">
              <Clock className="w-6 h-6 text-white" />
            </div>
            <span className="rounded-full bg-purple-500/20 border border-purple-500/40 px-2.5 py-0.5 text-[10px] font-mono font-bold text-purple-300">
              {timeCapsuleTracks.length} Deep Cuts
            </span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-white font-mono">
              Time Capsule 🕰️
            </h3>
            <p className="text-[11px] text-zinc-300 mt-0.5 line-clamp-2">
              Rediscover classic &amp; unplayed gems from your vault that
              haven&apos;t spun lately.
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={timeCapsuleTracks.length === 0}
              onClick={onPlayTimeCapsule}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-purple-500 hover:bg-purple-400 disabled:opacity-40 px-3 py-2 text-xs font-mono font-bold text-white transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Spin Time Capsule</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
