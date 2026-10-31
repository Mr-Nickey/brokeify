import React from 'react';
import {
  Car,
  CheckCircle2,
  ChevronDown,
  Gauge,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { EQPresetName, RepeatMode, Track } from '../types/music';

interface NowPlayingDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentTrack: Track | null;
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  carVolumeLeveler: boolean;
  eqPreset: EQPresetName;
  cachedTrackIds: Set<string>;
  preloadingTrackIds: Set<string>;
  frequencyData: number[];
  onTogglePlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleCarVolumeLeveler: () => void;
  onPlaySpecificTrack: (track: Track) => void;
  onOpenCarMode: () => void;
  onOpenAudioLab: () => void;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export const NowPlayingDrawer: React.FC<NowPlayingDrawerProps> = ({
  isOpen,
  onClose,
  currentTrack,
  queue,
  currentIndex,
  isPlaying,
  currentTime,
  duration,
  volume,
  isMuted,
  shuffleEnabled,
  repeatMode,
  carVolumeLeveler,
  eqPreset,
  cachedTrackIds,
  preloadingTrackIds,
  frequencyData,
  onTogglePlayPause,
  onNext,
  onPrevious,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleShuffle,
  onCycleRepeat,
  onToggleCarVolumeLeveler,
  onPlaySpecificTrack,
  onOpenCarMode,
  onOpenAudioLab,
}) => {
  if (!isOpen || !currentTrack) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/80 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded Now Playing Drawer and Up Next Queue"
    >
      <div
        className="relative w-full max-h-[92vh] rounded-t-3xl border-t border-zinc-800 bg-[#09090b] p-6 sm:p-8 overflow-y-auto shadow-2xl"
        style={{
          backgroundImage: `radial-gradient(circle at 25% 15%, ${currentTrack.accentColor}22 0%, transparent 55%)`,
        }}
      >
        {/* Drag Handle & Header */}
        <div className="w-12 h-1.5 bg-zinc-700 rounded-full mx-auto mb-5" />
        <div className="flex items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
          <div>
            <span className="text-xs font-mono text-emerald-400 uppercase tracking-wider">
              Now Playing · {currentTrack.sourceName}
            </span>
            <h2 className="text-lg font-bold text-white">
              {currentTrack.album}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenCarMode();
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500 hover:text-zinc-950 transition-colors min-h-[40px]"
            >
              <Car className="w-4 h-4" />
              <span>Car Mode</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Collapse Now Playing Drawer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 hover:text-white min-h-[40px]"
            >
              <ChevronDown className="w-4 h-4" />
              <span>Collapse</span>
            </button>
          </div>
        </div>

        {/* Main 2-Column Content: Artwork + Controls on Left, Up Next Queue on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-6">
          {/* Left: Artwork, Visualizer, Transport */}
          <div className="lg:col-span-6 flex flex-col justify-between space-y-6">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <img
                src={currentTrack.artworkUrl}
                alt={currentTrack.title}
                referrerPolicy="no-referrer"
                className="w-40 h-40 sm:w-48 sm:h-48 rounded-2xl border border-zinc-800 object-cover shadow-2xl shrink-0"
              />
              <div className="space-y-3 text-center sm:text-left min-w-0 flex-1">
                <h3 className="text-2xl font-bold text-white truncate">
                  {currentTrack.title}
                </h3>
                <p className="text-base text-zinc-300 font-medium truncate">
                  {currentTrack.artist}
                </p>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-zinc-400 font-mono tabular-nums">
                  <span>{currentTrack.format || 'STREAM'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{currentTrack.bitrateKbps || 320} kbps</span>
                  <span aria-hidden="true">·</span>
                  <span>LUFS {currentTrack.normalizationGain ?? 0} dB</span>
                </div>

                {/* Live Web Audio Spectrum Bars */}
                <div
                  className="flex items-end justify-center sm:justify-start gap-1 h-10 pt-2"
                  aria-hidden="true"
                >
                  {frequencyData.map((val, idx) => (
                    <div
                      key={idx}
                      className="w-2 rounded-t bg-emerald-400/80 transition-all duration-150"
                      style={{ height: `${ isPlaying ? Math.max(15, val) : 15 }%` }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Scrubber */}
            <div className="space-y-1.5">
              <input
                type="range"
                min={0}
                max={Math.max(1, duration)}
                value={currentTime}
                aria-label="Track playback position"
                onChange={(e) => onSeek(parseFloat(e.target.value))}
                className="w-full cursor-pointer"
              />
              <div className="flex justify-between text-xs font-mono tabular-nums text-zinc-400">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Primary Transport */}
            <div className="flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={onToggleShuffle}
                aria-label="Toggle Fisher-Yates Shuffle"
                className={`p-3 rounded-xl border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
                  shuffleEnabled
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                }`}
              >
                <Shuffle className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={onPrevious}
                  aria-label="Previous Track"
                  className="p-3.5 rounded-2xl border border-zinc-800 bg-zinc-900 text-white hover:bg-zinc-800 min-h-[48px] min-w-[48px] flex items-center justify-center"
                >
                  <SkipBack className="w-6 h-6" />
                </button>

                <button
                  type="button"
                  onClick={onTogglePlayPause}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  className="w-16 h-16 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 flex items-center justify-center shadow-lg transition-transform active:scale-95"
                >
                  {isPlaying ? (
                    <Pause className="w-7 h-7 fill-current" />
                  ) : (
                    <Play className="w-7 h-7 fill-current" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={onNext}
                  aria-label="Next Track"
                  className="p-3.5 rounded-2xl border border-zinc-800 bg-zinc-900 text-white hover:bg-zinc-800 min-h-[48px] min-w-[48px] flex items-center justify-center"
                >
                  <SkipForward className="w-6 h-6" />
                </button>
              </div>

              <button
                type="button"
                onClick={onCycleRepeat}
                aria-label={`Repeat mode: ${repeatMode}`}
                className={`p-3 rounded-xl border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
                  repeatMode !== 'off'
                    ? 'border-purple-500/50 bg-purple-500/15 text-purple-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                }`}
              >
                {repeatMode === 'one' ? (
                  <Repeat1 className="w-5 h-5" />
                ) : (
                  <Repeat className="w-5 h-5" />
                )}
              </button>
            </div>

            {/* DSP Quick Strip & Volume */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-zinc-800/80">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleCarVolumeLeveler}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors min-h-[40px] ${
                    carVolumeLeveler
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                  }`}
                >
                  <Gauge className="w-3.5 h-3.5" />
                  <span>Leveler: {carVolumeLeveler ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAudioLab();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 hover:text-white min-h-[40px]"
                >
                  <Sliders className="w-3.5 h-3.5 text-purple-400" />
                  <span>EQ: {eqPreset}</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  className="p-2 text-zinc-400 hover:text-white"
                >
                  {isMuted ? (
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
                  value={isMuted ? 0 : volume}
                  aria-label="Master Volume"
                  onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                  className="w-24 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Right: Up Next Queue with 2-Song Lookahead Preload Status */}
          <div className="lg:col-span-6 rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <div className="flex items-center gap-2">
                <ListMusic className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">
                  Up Next Queue (2-Song Lookahead Active)
                </h3>
              </div>
              <span className="text-xs font-mono text-zinc-400 tabular-nums">
                {queue.length} tracks
              </span>
            </div>

            <div className="divide-y divide-zinc-800/60 max-h-72 overflow-y-auto pr-1">
              {queue.map((track, idx) => {
                const isCurrent = idx === currentIndex;
                const isCached = cachedTrackIds.has(track.id);
                const isPreloading = preloadingTrackIds.has(track.id);
                return (
                  <div
                    key={`${track.id}-${idx}`}
                    className={`py-2.5 px-2 rounded-xl flex items-center justify-between gap-3 ${
                      isCurrent ? 'bg-emerald-500/10' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-white truncate">
                        <span className="text-xs font-mono text-zinc-500 tabular-nums">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span
                          className={`truncate ${
                            isCurrent ? 'text-emerald-400 font-semibold' : ''
                          }`}
                        >
                          {track.title}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-400">
                        <span className="truncate">{track.artist}</span>
                        <span aria-hidden="true">·</span>
                        {isPreloading ? (
                          <span className="text-amber-300 inline-flex items-center gap-1 font-mono">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Pre-loading...
                          </span>
                        ) : isCached ? (
                          <span className="text-emerald-400 inline-flex items-center gap-1 font-mono font-semibold">
                            <CheckCircle2 className="w-3 h-3" />
                            Pre-loaded
                          </span>
                        ) : (
                          <span className="font-mono">{track.sourceName}</span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onPlaySpecificTrack(track)}
                      className="rounded-lg bg-zinc-800 hover:bg-emerald-500 hover:text-zinc-950 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors shrink-0 min-h-[36px]"
                    >
                      {isCurrent && isPlaying ? 'Playing' : 'Play'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
