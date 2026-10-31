import React from 'react';
import {
  Car,
  CheckCircle2,
  Gauge,
  Pause,
  Play,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  X,
} from 'lucide-react';
import type { EQPresetName, Track } from '../types/music';
import { EQ_PRESETS } from '../utils/musicLogic';

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
  carVolumeLeveler: boolean;
  onToggleCarVolumeLeveler: (next: boolean) => void;
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
  carVolumeLeveler,
  onToggleCarVolumeLeveler,
  shuffleEnabled,
  onToggleShuffle,
  eqPreset,
  onApplyPreset,
  isCurrentTrackCached,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#09090b] text-white flex flex-col justify-between p-5 sm:p-8 select-none overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Car Mode High-Contrast Driving Interface"
    >
      {/* Top Bar: Giant Exit & Status */}
      <div className="flex items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
            <Car className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <div className="text-lg sm:text-xl font-bold tracking-tight text-white">
              BROKEIFY CAR HUD
            </div>
            <div className="text-xs sm:text-sm text-zinc-400 flex items-center gap-2">
              <span>Bluetooth MediaSession Active</span>
              <span aria-hidden="true">·</span>
              {isCurrentTrackCached ? (
                <span className="text-emerald-400 font-semibold inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Pre-loaded in Vault
                </span>
              ) : (
                <span>Live Stream</span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-2 rounded-2xl border-2 border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-6 py-3.5 text-base font-bold text-white transition-colors min-h-[56px]"
        >
          <X className="w-5 h-5" />
          <span>Exit Car Mode</span>
        </button>
      </div>

      {/* Center: Giant High-Contrast Track Metadata & Progress */}
      <div className="my-auto py-6 space-y-6 max-w-4xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          {currentTrack && (
            <img
              src={currentTrack.artworkUrl}
              alt={currentTrack.title}
              referrerPolicy="no-referrer"
              className="w-28 h-28 sm:w-36 sm:h-36 rounded-3xl border border-zinc-800 object-cover shrink-0 shadow-2xl"
            />
          )}
          <div className="text-center sm:text-left min-w-0 flex-1 space-y-2">
            <div className="text-xs sm:text-sm font-mono uppercase tracking-wider text-emerald-400">
              {currentTrack?.sourceName || 'Free Cloud'} · LUFS{' '}
              {currentTrack?.normalizationGain ?? 0} dB
            </div>
            <h2 className="text-2xl sm:text-4xl font-bold text-white truncate">
              {currentTrack?.title || 'Ready to Roll'}
            </h2>
            <p className="text-lg sm:text-2xl text-zinc-300 font-medium truncate">
              {currentTrack?.artist || 'Select a track'} ·{' '}
              <span className="text-zinc-400">{currentTrack?.album}</span>
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
          <div className="flex justify-between text-base sm:text-lg font-mono tabular-nums text-zinc-300">
            <span>{formatSec(currentTime)}</span>
            <span>{formatSec(duration)}</span>
          </div>
        </div>

        {/* Giant Transport Buttons */}
        <div className="grid grid-cols-3 gap-4 sm:gap-6 pt-2">
          <button
            type="button"
            onClick={onPrevious}
            aria-label="Previous Track"
            className="h-24 sm:h-28 rounded-3xl border-2 border-zinc-800 bg-zinc-900 hover:bg-zinc-800 active:scale-[0.98] flex flex-col items-center justify-center gap-1.5 text-white transition-transform"
          >
            <SkipBack className="w-9 h-9" />
            <span className="text-xs sm:text-sm font-bold">PREVIOUS</span>
          </button>

          <button
            type="button"
            onClick={onTogglePlayPause}
            aria-label={isPlaying ? 'Pause Track' : 'Play Track'}
            className="h-24 sm:h-28 rounded-3xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] flex flex-col items-center justify-center gap-1.5 text-zinc-950 shadow-xl transition-transform"
          >
            {isPlaying ? (
              <>
                <Pause className="w-11 h-11 fill-current" />
                <span className="text-xs sm:text-sm font-extrabold">PAUSE</span>
              </>
            ) : (
              <>
                <Play className="w-11 h-11 fill-current" />
                <span className="text-xs sm:text-sm font-extrabold">PLAY</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onNext}
            aria-label="Next Track"
            className="h-24 sm:h-28 rounded-3xl border-2 border-zinc-800 bg-zinc-900 hover:bg-zinc-800 active:scale-[0.98] flex flex-col items-center justify-center gap-1.5 text-white transition-transform"
          >
            <SkipForward className="w-9 h-9" />
            <span className="text-xs sm:text-sm font-bold">NEXT</span>
          </button>
        </div>
      </div>

      {/* Bottom Strip: Giant 1-Tap Car Audio Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 border-t border-zinc-800 pt-5">
        <button
          type="button"
          onClick={() => onToggleCarVolumeLeveler(!carVolumeLeveler)}
          className={`min-h-[64px] rounded-2xl border-2 px-5 py-3 flex items-center justify-between text-left transition-colors ${
            carVolumeLeveler
              ? 'border-emerald-500 bg-emerald-500/15 text-white'
              : 'border-zinc-800 bg-zinc-900 text-zinc-300'
          }`}
        >
          <div className="flex items-center gap-3">
            <Gauge className="w-6 h-6 text-emerald-400 shrink-0" />
            <div>
              <div className="text-sm font-bold">Car Volume Leveler</div>
              <div className="text-xs text-zinc-400">
                Compressor -24dB / 12:1
              </div>
            </div>
          </div>
          <span className="text-sm font-mono font-bold text-emerald-400">
            {carVolumeLeveler ? 'ON' : 'OFF'}
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleShuffle}
          className={`min-h-[64px] rounded-2xl border-2 px-5 py-3 flex items-center justify-between text-left transition-colors ${
            shuffleEnabled
              ? 'border-purple-500 bg-purple-500/15 text-white'
              : 'border-zinc-800 bg-zinc-900 text-zinc-300'
          }`}
        >
          <div className="flex items-center gap-3">
            <Shuffle className="w-6 h-6 text-purple-400 shrink-0" />
            <div>
              <div className="text-sm font-bold">Fisher-Yates Shuffle</div>
              <div className="text-xs text-zinc-400">True unbiased queue</div>
            </div>
          </div>
          <span className="text-sm font-mono font-bold text-purple-400">
            {shuffleEnabled ? 'ON' : 'OFF'}
          </span>
        </button>

        <div className="sm:col-span-2 lg:col-span-1 min-h-[64px] rounded-2xl border-2 border-zinc-800 bg-zinc-900 px-4 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <Sliders className="w-5 h-5 text-emerald-400" />
            <span className="text-xs font-bold text-zinc-300">EQ:</span>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {CAR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onApplyPreset(preset)}
                className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 min-h-[44px] ${
                  eqPreset === preset
                    ? 'bg-emerald-500 text-zinc-950'
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
