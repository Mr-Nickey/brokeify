import React from 'react';
import {
  Car,
  CheckCircle2,
  ChevronDown,
  Database,
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
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  EQPresetName,
  RepeatMode,
  StabilizerStrength,
  Track,
} from '../types/music';
import { createAlbumArtworkDataUri } from '../utils/artworkGenerator';
import { WinampVisualizer } from './WinampVisualizer';

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
  stabilizerStrength: StabilizerStrength;
  crossfadeSeconds: number;
  onChangeCrossfadeSeconds: (sec: number) => void;
  isCrossfading?: boolean;
  offlinePreloadCount: number;
  onChangeOfflinePreloadCount: (count: number) => void;
  eqPreset: EQPresetName;
  cachedTrackIds: Set<string>;
  preloadingTrackIds: Set<string>;
  frequencyData: number[];
  waveformData: number[];
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
  stabilizerStrength,
  crossfadeSeconds,
  onChangeCrossfadeSeconds,
  isCrossfading = false,
  offlinePreloadCount,
  onChangeOfflinePreloadCount,
  eqPreset,
  cachedTrackIds,
  preloadingTrackIds,
  frequencyData,
  waveformData,
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

  const isCurrentCached = cachedTrackIds.has(currentTrack.id);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/85 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded Now Playing Drawer and Up Next Queue"
    >
      <div
        className="relative w-full max-h-[94vh] rounded-t-3xl border-t border-zinc-700 bg-[#070a0f] overflow-y-auto shadow-2xl"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 10%, ${currentTrack.accentColor}22 0%, transparent 55%)`,
        }}
      >
        {/* Classic 90s/2000s Metallic Window Header */}
        <div className="winamp-titlebar px-5 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-700/80 sticky top-0 z-10">
          <div className="min-w-0 flex items-center gap-2.5">
            <span className="text-xs font-mono font-bold text-[#00ff66] uppercase tracking-wider truncate">
              STEREO DECK // {currentTrack.sourceName}
            </span>
            {isCurrentCached && (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66]">
                <CheckCircle2 className="w-3 h-3" />
                VAULTED
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenCarMode();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#00ff66] hover:bg-emerald-400 px-3 py-1.5 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[36px]"
            >
              <Car className="w-3.5 h-3.5" />
              <span>Car Mode 🚗</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Collapse Now Playing Drawer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-mono font-semibold text-zinc-200 hover:text-white min-h-[36px]"
            >
              <ChevronDown className="w-4 h-4" />
              <span>Minimize</span>
            </button>
          </div>
        </div>

        {/* Main 2-Column Content: Artwork + Winamp Visualizer + Controls on Left, Up Next Queue on Right */}
        <div className="p-5 sm:p-7 grid grid-cols-1 lg:grid-cols-12 gap-7">
          {/* Left: Artwork, 90s/2000s Winamp Visualizer, Transport */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-5">
            <div className="winamp-lcd rounded-2xl border border-zinc-800 p-4 flex flex-col sm:flex-row items-center gap-5">
              <img
                src={currentTrack.artworkUrl}
                alt={currentTrack.title}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = createAlbumArtworkDataUri(
                    currentTrack.title,
                    currentTrack.artist,
                    currentTrack.accentColor || '#10b981',
                    '#09090b'
                  );
                }}
                className="w-28 h-28 sm:w-32 sm:h-32 rounded-xl border border-zinc-700 object-cover shadow-xl shrink-0"
              />
              <div className="space-y-1.5 text-center sm:text-left min-w-0 flex-1">
                <h3 className="text-xl sm:text-2xl font-bold text-white truncate">
                  {currentTrack.title}
                </h3>
                <p className="text-sm sm:text-base text-[#00ff66] font-mono font-semibold truncate">
                  {currentTrack.artist}
                </p>
                <p className="text-xs text-zinc-400 truncate">
                  {currentTrack.album}
                </p>
              </div>
            </div>

            {/* 90s / Early 2000s Winamp + MilkDrop Wavy Oscilloscope & Spectrum Visualizer */}
            <WinampVisualizer
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              frequencyData={frequencyData}
              waveformData={waveformData}
              crossfadeSeconds={crossfadeSeconds}
              isCrossfading={isCrossfading}
              stabilizerStrength={stabilizerStrength}
              carVolumeLeveler={carVolumeLeveler}
              compact
            />

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
              <div className="flex justify-between text-xs font-mono tabular-nums text-[#00ff66]">
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
                    ? 'border-[#00ff66] bg-emerald-500/15 text-[#00ff66]'
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
                  className="p-3.5 rounded-2xl border border-zinc-700 bg-zinc-900 text-white hover:bg-zinc-800 min-h-[48px] min-w-[48px] flex items-center justify-center"
                >
                  <SkipBack className="w-6 h-6" />
                </button>

                <button
                  type="button"
                  onClick={onTogglePlayPause}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  className="w-16 h-16 rounded-2xl bg-[#00ff66] hover:bg-emerald-400 text-zinc-950 flex items-center justify-center shadow-lg transition-transform active:scale-95"
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
                  className="p-3.5 rounded-2xl border border-zinc-700 bg-zinc-900 text-white hover:bg-zinc-800 min-h-[48px] min-w-[48px] flex items-center justify-center"
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
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-zinc-800/80">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleCarVolumeLeveler}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-mono font-bold transition-colors min-h-[38px] ${
                    carVolumeLeveler
                      ? 'bg-emerald-500/20 text-[#00ff66] border border-emerald-500/50'
                      : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                  }`}
                >
                  <Gauge className="w-3.5 h-3.5" />
                  <span>
                    FLAC/MP3 Stabilizer: {carVolumeLeveler ? 'ON' : 'OFF'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAudioLab();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono font-medium text-zinc-300 hover:text-white min-h-[38px]"
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

          {/* Right: Up Next Queue + Crossfade Slider + Offline Lookahead Slider (2 to 12 Tracks) */}
          <div className="lg:col-span-5 winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden flex flex-col">
            <div className="winamp-titlebar px-4 py-2.5 flex items-center justify-between border-b border-zinc-700/80">
              <div className="flex items-center gap-2">
                <ListMusic className="w-4 h-4 text-[#00ff66]" />
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
                  QUEUE EDITOR // UP NEXT ({queue.length})
                </h3>
              </div>
              <span className="text-[11px] font-mono text-[#00ff66] tabular-nums">
                {offlinePreloadCount}-TRACK VAULT
              </span>
            </div>

            <div className="p-4 space-y-4 flex-1 flex flex-col">
              {/* Quick Sliders for Crossfade (0-12s) & Offline Queue Lookahead (2-12 tracks) */}
              <div className="winamp-lcd rounded-xl border border-zinc-800/90 p-3 space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-zinc-300 inline-flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-purple-400" />
                      Crossfade Transition:
                    </span>
                    <span className="text-[#00ff66] font-bold tabular-nums">
                      {crossfadeSeconds === 0 ? 'OFF' : `${crossfadeSeconds}s`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={12}
                    step={1}
                    value={crossfadeSeconds}
                    aria-label="Drawer Crossfade Duration in Seconds"
                    onChange={(e) =>
                      onChangeCrossfadeSeconds(parseInt(e.target.value, 10))
                    }
                    className="w-full cursor-pointer"
                  />
                </div>

                <div className="space-y-1 pt-1 border-t border-zinc-800/80">
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-zinc-300 inline-flex items-center gap-1">
                      <Database className="w-3 h-3 text-[#00ff66]" />
                      Offline Queue Preloader:
                    </span>
                    <span className="text-[#00ff66] font-bold tabular-nums">
                      {offlinePreloadCount} Tracks Ahead
                    </span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={12}
                    step={1}
                    value={offlinePreloadCount}
                    aria-label="Drawer Offline Queue Lookahead Count"
                    onChange={(e) =>
                      onChangeOfflinePreloadCount(parseInt(e.target.value, 10))
                    }
                    className="w-full cursor-pointer"
                  />
                </div>
              </div>

              <div className="divide-y divide-zinc-800/60 max-h-72 overflow-y-auto pr-1 flex-1">
                {queue.map((track, idx) => {
                  const isCurrent = idx === currentIndex;
                  const isCached = cachedTrackIds.has(track.id);
                  const isPreloading = preloadingTrackIds.has(track.id);
                  return (
                    <div
                      key={`${track.id}-${idx}`}
                      className={`py-2 px-2 rounded-lg flex items-center justify-between gap-2.5 ${
                        isCurrent ? 'bg-emerald-500/15' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs font-mono font-medium text-white truncate">
                          <span className="text-zinc-500 tabular-nums">
                            {String(idx + 1).padStart(2, '0')}.
                          </span>
                          <span
                            className={`truncate ${
                              isCurrent ? 'text-[#00ff66] font-bold' : ''
                            }`}
                          >
                            {track.title}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
                          <span className="truncate">{track.artist}</span>
                          <span aria-hidden="true">·</span>
                          {isPreloading ? (
                            <span className="text-amber-300 inline-flex items-center gap-1 font-mono">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Pre-loading...
                            </span>
                          ) : isCached ? (
                            <span className="text-[#00ff66] inline-flex items-center gap-1 font-mono font-semibold">
                              <CheckCircle2 className="w-3 h-3" />
                              Ready Offline
                            </span>
                          ) : (
                            <span className="font-mono">{track.sourceName}</span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onPlaySpecificTrack(track)}
                        className="rounded-lg bg-zinc-800 hover:bg-[#00ff66] hover:text-zinc-950 px-2.5 py-1 text-xs font-mono font-bold text-zinc-200 transition-colors shrink-0 min-h-[32px]"
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
    </div>
  );
};
