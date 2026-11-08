import React from 'react';
import {
  Car,
  CheckCircle2,
  Gauge,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import type { EQPresetName, RepeatMode, Track } from '../types/music';

interface CarModeOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onTogglePlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (time: number) => void;
  repeatMode: RepeatMode;
  onCycleRepeat: () => void;
  carVolumeLeveler: boolean;
  onToggleCarVolumeLeveler: (next: boolean) => void;
  crossfadeSeconds: number;
  onChangeCrossfadeSeconds: (sec: number) => void;
  shuffleEnabled: boolean;
  onToggleShuffle: () => void;
  eqPreset: EQPresetName;
  onApplyPreset: (preset: Exclude<EQPresetName, 'Custom'>) => void;
  isCurrentTrackCached: boolean;
}

function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

const CAR_PRESETS: Array<Exclude<EQPresetName, 'Custom'>> = [
  'Car Stereo',
  'Bass Boost',
  'Rock',
  'Late Night',
];

export const CarModeOverlay: React.FC<CarModeOverlayProps> = ({
  isOpen,
  onClose,
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  onTogglePlayPause,
  onNext,
  onPrevious,
  onSeek,
  repeatMode,
  onCycleRepeat,
  carVolumeLeveler,
  onToggleCarVolumeLeveler,
  crossfadeSeconds,
  onChangeCrossfadeSeconds,
  shuffleEnabled,
  onToggleShuffle,
  eqPreset,
  onApplyPreset,
  isCurrentTrackCached,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#06090e] text-white flex flex-col justify-between p-5 sm:p-8 select-none overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Car Mode High-Contrast Driving Interface"
    >
      {/* Top Bar: Giant Exit & Android Auto Status */}
      <div className="winamp-titlebar rounded-2xl px-4 py-3 flex items-center justify-between gap-4 border border-zinc-700/80">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
            <Car className="w-6 h-6 text-[#00ff66]" />
          </div>
          <div>
            <div className="text-base sm:text-lg font-mono font-bold tracking-wider text-white">
              BROKEIFY CAR DECK // ANDROID AUTO READY
            </div>
            <div className="text-xs text-zinc-300 font-mono flex flex-wrap items-center gap-2">
              <span>Skip Song &amp; Repeat Active</span>
              <span aria-hidden="true">·</span>
              {isCurrentTrackCached ? (
                <span className="text-[#00ff66] font-semibold inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Cached in Vault
                </span>
              ) : (
                <span>Direct Stream</span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-2 rounded-xl border-2 border-zinc-600 bg-zinc-900 hover:bg-zinc-800 px-5 py-3 text-sm sm:text-base font-bold text-white transition-colors min-h-[52px]"
        >
          <X className="w-5 h-5" />
          <span>Exit Car Mode</span>
        </button>
      </div>

      {/* Center: Giant High-Contrast Track Metadata & Progress */}
      <div className="my-auto py-5 space-y-6 max-w-4xl mx-auto w-full">
        <div className="winamp-lcd rounded-3xl border border-zinc-800 p-5 flex flex-col sm:flex-row items-center gap-6">
          {currentTrack && (
            <img
              src={currentTrack.artworkUrl}
              alt={currentTrack.title}
              referrerPolicy="no-referrer"
              className="w-24 h-24 sm:w-32 sm:h-32 rounded-2xl border border-zinc-700 object-cover shrink-0 shadow-2xl"
            />
          )}
          <div className="text-center sm:text-left min-w-0 flex-1 space-y-1.5">
            <div className="text-xs sm:text-sm font-mono uppercase tracking-wider text-[#00ff66]">
              {(currentTrack?.format || 'AUDIO').toUpperCase()} · XFADE{' '}
              {crossfadeSeconds > 0 ? `${crossfadeSeconds}S` : 'OFF'}
            </div>
            <h2 className="text-2xl sm:text-4xl font-bold text-white truncate">
              {currentTrack?.title || 'Ready to Roll'}
            </h2>
            <p className="text-lg sm:text-2xl text-zinc-300 font-medium truncate">
              {currentTrack?.artist || 'Select a track'}
            </p>
          </div>
        </div>

        {/* Scrubber */}
        <div className="space-y-2">
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            value={currentTime}
            aria-label="Seek audio position in Car Mode"
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="w-full h-4 cursor-pointer"
          />
          <div className="flex justify-between text-base sm:text-lg font-mono tabular-nums text-[#00ff66]">
            <span>{formatSec(currentTime)}</span>
            <span>{formatSec(duration)}</span>
          </div>
        </div>

        {/* Simple Giant 4-Button Car Transport: PREVIOUS SONG | PLAY/PAUSE | SKIP SONG | SHUFFLE */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
          <button
            type="button"
            onClick={onPrevious}
            aria-label="Previous or Restart Song"
            className="h-24 sm:h-28 rounded-3xl border-2 border-zinc-700 bg-zinc-900 hover:bg-zinc-800 active:scale-[0.98] flex flex-col items-center justify-center gap-1.5 text-white transition-transform"
          >
            <SkipBack className="w-8 h-8" />
            <span className="text-xs sm:text-sm font-mono font-bold">
              PREV SONG
            </span>
          </button>

          <button
            type="button"
            onClick={onTogglePlayPause}
            aria-label={isPlaying ? 'Pause Song' : 'Play Song'}
            className="h-24 sm:h-28 rounded-3xl bg-[#00ff66] hover:bg-emerald-400 active:scale-[0.98] flex flex-col items-center justify-center gap-1.5 text-zinc-950 shadow-xl transition-transform"
          >
            {isPlaying ? (
              <>
                <Pause className="w-10 h-10 fill-current" />
                <span className="text-xs sm:text-sm font-mono font-extrabold">
                  PAUSE
                </span>
              </>
            ) : (
              <>
                <Play className="w-10 h-10 fill-current" />
                <span className="text-xs sm:text-sm font-mono font-extrabold">
                  PLAY
                </span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onNext}
            aria-label="Skip Song"
            data-testid="carmode-skip-song-btn"
            className="h-24 sm:h-28 rounded-3xl border-2 border-emerald-500/60 bg-zinc-900 hover:bg-zinc-800 active:scale-[0.98] flex flex-col items-center justify-center gap-1.5 text-white transition-transform"
          >
            <SkipForward className="w-8 h-8 text-[#00ff66]" />
            <span className="text-xs sm:text-sm font-mono font-bold">
              SKIP SONG
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleShuffle}
            aria-label="Shuffle Queue"
            data-testid="carmode-shuffle-btn"
            className={`h-24 sm:h-28 rounded-3xl border-2 active:scale-[0.98] flex flex-col items-center justify-center gap-1.5 transition-transform ${
              shuffleEnabled
                ? 'border-purple-400 bg-purple-500/25 text-purple-200'
                : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            <Shuffle className="w-8 h-8 text-purple-400" />
            <span className="text-xs sm:text-sm font-mono font-bold uppercase">
              {shuffleEnabled ? 'SHUFFLE ON' : 'SHUFFLE'}
            </span>
          </button>
        </div>
      </div>

      {/* Bottom Strip: Giant 1-Tap Car Audio Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 border-t border-zinc-800 pt-4">
        <button
          type="button"
          onClick={() => onToggleCarVolumeLeveler(!carVolumeLeveler)}
          className={`min-h-[60px] rounded-2xl border-2 px-4 py-2.5 flex items-center justify-between text-left transition-colors ${
            carVolumeLeveler
              ? 'border-[#00ff66] bg-emerald-500/15 text-white'
              : 'border-zinc-800 bg-zinc-900 text-zinc-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Gauge className="w-5 h-5 text-[#00ff66] shrink-0" />
            <div>
              <div className="text-xs font-bold">FLAC/MP3 Stabilizer</div>
              <div className="text-[11px] text-zinc-400 font-mono">
                Hardware Leveler
              </div>
            </div>
          </div>
          <span className="text-xs font-mono font-bold text-[#00ff66]">
            {carVolumeLeveler ? 'ON' : 'OFF'}
          </span>
        </button>

        <button
          type="button"
          onClick={() =>
            onChangeCrossfadeSeconds(crossfadeSeconds > 0 ? 0 : 4)
          }
          className={`min-h-[60px] rounded-2xl border-2 px-4 py-2.5 flex items-center justify-between text-left transition-colors ${
            crossfadeSeconds > 0
              ? 'border-sky-400 bg-sky-500/15 text-white'
              : 'border-zinc-800 bg-zinc-900 text-zinc-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-sky-400 shrink-0" />
            <div>
              <div className="text-xs font-bold">Seamless Crossfade</div>
              <div className="text-[11px] text-zinc-400 font-mono">
                Smooth transitions
              </div>
            </div>
          </div>
          <span className="text-xs font-mono font-bold text-sky-400">
            {crossfadeSeconds > 0 ? `${crossfadeSeconds}S` : 'OFF'}
          </span>
        </button>

        <button
          type="button"
          onClick={onCycleRepeat}
          data-testid="carmode-repeat-song-btn"
          className={`min-h-[60px] rounded-2xl border-2 px-4 py-2.5 flex items-center justify-between text-left transition-colors ${
            repeatMode !== 'off'
              ? 'border-amber-400 bg-amber-500/15 text-white'
              : 'border-zinc-800 bg-zinc-900 text-zinc-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {repeatMode === 'one' ? (
              <Repeat1 className="w-5 h-5 text-amber-400 shrink-0" />
            ) : (
              <Repeat className="w-5 h-5 text-amber-400 shrink-0" />
            )}
            <div>
              <div className="text-xs font-bold">Repeat Mode</div>
              <div className="text-[11px] text-zinc-400 font-mono">
                Loop song or queue
              </div>
            </div>
          </div>
          <span className="text-xs font-mono font-bold text-amber-400 uppercase">
            {repeatMode}
          </span>
        </button>

        <div className="min-h-[60px] rounded-2xl border-2 border-zinc-800 bg-zinc-900 px-3 py-2 flex items-center justify-between gap-1.5">
          <Sliders className="w-4 h-4 text-[#00ff66] shrink-0" />
          <div className="flex items-center gap-1 overflow-x-auto">
            {CAR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onApplyPreset(preset)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold whitespace-nowrap shrink-0 min-h-[38px] ${
                  eqPreset === preset
                    ? 'bg-[#00ff66] text-zinc-950'
                    : 'bg-zinc-800 text-zinc-300'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
