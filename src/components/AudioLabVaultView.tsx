import React, { useState } from 'react';
import {
  CheckCircle2,
  Database,
  Download,
  Gauge,
  Sliders,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  EQPresetName,
  StabilizerStrength,
  Track,
} from '../types/music';
import {
  computeTrackStabilizationGain,
  EQ_FREQUENCIES,
  EQ_LABELS,
  EQ_PRESETS,
  lufsToLinearGain,
} from '../utils/musicLogic';
import {
  clearOfflineVault,
  preloadTrackToVault,
  removeTrackFromVault,
} from '../utils/offlineVault';
import { SlidingToggle } from './SlidingToggle';

interface AudioLabVaultViewProps {
  currentTrack: Track | null;
  allTracks: Track[];
  carVolumeLeveler: boolean;
  onToggleCarVolumeLeveler: (next: boolean) => void;
  stabilizerStrength: StabilizerStrength;
  onChangeStabilizerStrength: (strength: StabilizerStrength) => void;
  lufsNormalizationEnabled: boolean;
  onToggleLufsNormalization: (next: boolean) => void;
  crossfadeSeconds: number;
  onChangeCrossfadeSeconds: (sec: number) => void;
  offlinePreloadCount: number;
  onChangeOfflinePreloadCount: (count: number) => void;
  eqPreset: EQPresetName;
  eqGains: number[];
  onApplyPreset: (preset: Exclude<EQPresetName, 'Custom'>) => void;
  onUpdateBand: (index: number, gainDb: number) => void;
  cachedTrackIds: Set<string>;
  vaultTotalBytes: number;
  onRefreshVault: () => Promise<void>;
  onPlayTrack: (track: Track) => void;
}

const PRESET_NAMES = Object.keys(EQ_PRESETS) as Array<
  Exclude<EQPresetName, 'Custom'>
>;

export const AudioLabVaultView: React.FC<AudioLabVaultViewProps> = ({
  currentTrack,
  allTracks,
  carVolumeLeveler,
  onToggleCarVolumeLeveler,
  stabilizerStrength,
  onChangeStabilizerStrength,
  lufsNormalizationEnabled,
  onToggleLufsNormalization,
  crossfadeSeconds,
  onChangeCrossfadeSeconds,
  offlinePreloadCount,
  onChangeOfflinePreloadCount,
  eqPreset,
  eqGains,
  onApplyPreset,
  onUpdateBand,
  cachedTrackIds,
  vaultTotalBytes,
  onRefreshVault,
  onPlayTrack,
}) => {
  const [cachingAll, setCachingAll] = useState(false);

  const handleCacheAllTracks = async () => {
    setCachingAll(true);
    try {
      for (const track of allTracks) {
        if (!cachedTrackIds.has(track.id)) {
          await preloadTrackToVault(track);
        }
      }
      await onRefreshVault();
    } finally {
      setCachingAll(false);
    }
  };

  const handleClearVault = async () => {
    await clearOfflineVault();
    await onRefreshVault();
  };

  const handleRemoveSingle = async (trackId: string) => {
    await removeTrackFromVault(trackId);
    await onRefreshVault();
  };

  const currentLufsGain = lufsToLinearGain(currentTrack?.normalizationGain);
  const currentStab = computeTrackStabilizationGain(currentTrack, {
    carVolumeLeveler,
    lufsNormalizationEnabled,
    stabilizerStrength,
  });
  const cachedTracksList = allTracks.filter((t) => cachedTrackIds.has(t.id));

  return (
    <div className="space-y-8">
      {/* Row 1: Aggressive FLAC/MP3 Stabilizer + Crossfade + 5-Band Winamp Graphic EQ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 5 Columns: Aggressive FLAC/MP3 Audio Stabilizer & Seamless Crossfade */}
        <section
          aria-labelledby="leveler-heading"
          className="lg:col-span-5 winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden flex flex-col"
        >
          <div className="winamp-titlebar px-4 py-2.5 flex items-center justify-between border-b border-zinc-700/80">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-[#00ff66] shrink-0" />
              <h2
                id="leveler-heading"
                className="text-xs font-mono font-bold uppercase tracking-wider text-white"
              >
                AUDIO LAB DSP // FLAC &amp; MP3 STABILIZER + CROSSFADE
              </h2>
            </div>
            <span className="text-[10px] font-mono text-[#00ff66]">
              AGC v2.4
            </span>
          </div>

          <div className="p-5 space-y-4 flex-1">
            {/* Toggle 1: Master Audio Stabilizer */}
            <div className="flex items-start justify-between gap-4 rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-4">
              <div className="space-y-1">
                <div className="text-sm font-bold text-white">
                  FLAC &amp; MP3 Loudness Stabilizer
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Matches loud brickwalled FLAC files with quiet 240kbps MP3s
                  using codec headroom calibration + a `-34dB / 16:1` brickwall
                  compressor.
                </p>
              </div>
              <SlidingToggle
                checked={carVolumeLeveler}
                onChange={onToggleCarVolumeLeveler}
                label={carVolumeLeveler ? 'ON' : 'OFF'}
                ariaLabel="Toggle Car Mode Volume Leveler"
                testId="audiolab-toggle-car-leveler"
              />
            </div>

            {/* Stabilizer Strength Selector (Aggressive FLAC/MP3 Leveler vs Normal vs Off) */}
            <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-200">
                  Stabilization Intensity (Mixed MP3 / FLAC Library)
                </span>
                <span className="text-[11px] font-mono text-[#00ff66]">
                  {currentStab.profileLabel}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      id: 'aggressive',
                      label: 'Aggressive (FLAC/MP3)',
                      sub: '-4.8dB FLAC / +5.5dB MP3',
                    },
                    {
                      id: 'normal',
                      label: 'Standard AGC',
                      sub: '-2.5dB / +2.5dB',
                    },
                    {
                      id: 'off',
                      label: 'Bypass',
                      sub: 'Raw Source Volume',
                    },
                  ] as const
                ).map((mode) => {
                  const active =
                    carVolumeLeveler && stabilizerStrength === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        if (mode.id === 'off') {
                          onToggleCarVolumeLeveler(false);
                          onChangeStabilizerStrength('off');
                        } else {
                          onToggleCarVolumeLeveler(true);
                          onChangeStabilizerStrength(mode.id);
                        }
                      }}
                      data-testid={`stabilizer-mode-${mode.id}`}
                      className={`rounded-xl border p-2.5 text-left transition-all ${
                        active
                          ? 'border-[#00ff66] bg-emerald-500/15 text-white shadow-sm'
                          : 'border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <div className="text-xs font-bold truncate">
                        {mode.label}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-400 truncate mt-0.5">
                        {mode.sub}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="winamp-lcd rounded-lg px-3 py-2 text-[11px] font-mono text-zinc-300 flex flex-wrap items-center justify-between gap-2">
                <span>
                  DSP Preamp:{' '}
                  <strong className="text-[#00ff66]">
                    {currentStab.webAudioGain}x
                  </strong>
                </span>
                <span>
                  Stream Ceiling:{' '}
                  <strong className="text-sky-400">
                    {Math.round(currentStab.htmlElementScale * 100)}%
                  </strong>
                </span>
              </div>
            </div>

            {/* Seamless Driving Crossfade Slider (0s to 12s) */}
            <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-xs font-bold text-white">
                    Seamless Driving Crossfade
                  </span>
                </div>
                <span
                  data-testid="crossfade-value-label"
                  className="text-xs font-mono font-bold text-[#00ff66] tabular-nums"
                >
                  {crossfadeSeconds === 0
                    ? 'OFF (0s)'
                    : `${crossfadeSeconds} Seconds`}
                </span>
              </div>

              <input
                type="range"
                min={0}
                max={12}
                step={1}
                value={crossfadeSeconds}
                aria-label="Seamless Crossfade Duration in Seconds"
                data-testid="audiolab-crossfade-slider"
                onChange={(e) =>
                  onChangeCrossfadeSeconds(parseInt(e.target.value, 10))
                }
                className="w-full cursor-pointer"
              />

              <div className="flex justify-between text-[10px] font-mono text-zinc-500 tabular-nums">
                <span>0s (Off)</span>
                <span>4s (Highway)</span>
                <span>8s (Club)</span>
                <span>12s (Max)</span>
              </div>
            </div>

            {/* Toggle 2: ReplayGain / LUFS NormalizationGain */}
            <div className="flex items-start justify-between gap-4 rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-4">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-white">
                  Jellyfin / Subsonic LUFS GainNode
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Applies per-track `NormalizationGain` tags. Current:{' '}
                  <span className="font-mono text-[#00ff66] tabular-nums">
                    {currentTrack?.normalizationGain !== undefined
                      ? `${currentTrack.normalizationGain > 0 ? '+' : ''}${currentTrack.normalizationGain} dB (${currentLufsGain}x)`
                      : '0.0 dB (Auto Codec Leveling)'}
                  </span>
                </p>
              </div>
              <SlidingToggle
                checked={lufsNormalizationEnabled}
                onChange={onToggleLufsNormalization}
                label={lufsNormalizationEnabled ? 'ON' : 'OFF'}
                ariaLabel="Toggle Jellyfin Subsonic LUFS GainNode"
                testId="audiolab-toggle-lufs"
              />
            </div>
          </div>
        </section>

        {/* Right 7 Columns: Winamp 5-Band Graphic Equalizer */}
        <section
          aria-labelledby="eq-heading"
          className="lg:col-span-7 winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden flex flex-col"
        >
          <div className="winamp-titlebar px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-700/80">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#00ff66] shrink-0" />
              <h2
                id="eq-heading"
                className="text-xs font-mono font-bold uppercase tracking-wider text-white"
              >
                GRAPHIC EQUALIZER // 5-BAND DSP
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {PRESET_NAMES.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onApplyPreset(preset)}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold transition-colors whitespace-nowrap shrink-0 ${
                    eqPreset === preset
                      ? 'bg-[#00ff66] text-zinc-950'
                      : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white border border-zinc-700/70'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="p-6 flex-1 flex flex-col justify-between space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
              {EQ_FREQUENCIES.map((freq, idx) => {
                const gain = eqGains[idx] ?? 0;
                const label = EQ_LABELS[freq];
                return (
                  <div
                    key={freq}
                    className="winamp-lcd rounded-xl border border-zinc-800/90 p-3.5 flex flex-col justify-between gap-3"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-zinc-200 font-mono whitespace-nowrap">
                        {label}
                      </span>
                      <span className="text-xs font-mono tabular-nums text-[#00ff66] font-bold whitespace-nowrap">
                        {gain > 0 ? `+${gain}` : gain}dB
                      </span>
                    </div>

                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={0.5}
                      value={gain}
                      aria-label={`${label} EQ Band Gain`}
                      onChange={(e) =>
                        onUpdateBand(idx, parseFloat(e.target.value))
                      }
                      className="w-full cursor-pointer"
                    />

                    <div className="flex justify-between text-[10px] font-mono text-zinc-500 tabular-nums">
                      <span>-12dB</span>
                      <span>0dB</span>
                      <span>+12dB</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Offline Queue Preloader Lookahead Slider (2 to 12 Tracks) */}
            <div className="rounded-xl border border-emerald-500/30 bg-zinc-950/80 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    <Database className="w-4 h-4 text-[#00ff66]" />
                    <span>
                      Dead-Zone Offline Queue Preloader (2 to 12 Tracks)
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Automatically downloads and caches upcoming songs in your
                    queue into IndexedDB so driving through zero-signal areas
                    never stops playback.
                  </p>
                </div>

                <span
                  data-testid="offline-preload-count-badge"
                  className="rounded-lg bg-emerald-500/15 border border-emerald-500/40 px-3 py-1 text-xs font-mono font-bold text-[#00ff66] tabular-nums"
                >
                  Queueing {offlinePreloadCount} Tracks Ahead
                </span>
              </div>

              <input
                type="range"
                min={2}
                max={12}
                step={1}
                value={offlinePreloadCount}
                aria-label="Offline Queue Preloader Lookahead Track Count"
                data-testid="audiolab-offline-preload-slider"
                onChange={(e) =>
                  onChangeOfflinePreloadCount(parseInt(e.target.value, 10))
                }
                className="w-full cursor-pointer"
              />

              <div className="flex justify-between text-[10px] font-mono text-zinc-400 tabular-nums">
                <span>2 Tracks (Light)</span>
                <span>4 Tracks</span>
                <span>8 Tracks (Highway)</span>
                <span>12 Tracks (Heavy Dead-Zone)</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Row 2: IndexedDB Offline Audio Vault */}
      <section
        aria-labelledby="vault-heading"
        className="winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden"
      >
        <div className="winamp-titlebar px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-700/80">
          <div className="flex items-center gap-2.5">
            <Database className="w-4 h-4 text-[#00ff66] shrink-0" />
            <div>
              <h2
                id="vault-heading"
                className="text-xs font-mono font-bold uppercase tracking-wider text-white"
              >
                INDEXEDDB OFFLINE VAULT // {offlinePreloadCount}-TRACK LOOKAHEAD
                ACTIVE
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-mono text-[#00ff66] tabular-nums">
              {cachedTrackIds.size} tracks cached ·{' '}
              {(vaultTotalBytes / (1024 * 1024)).toFixed(2)} MB stored
            </span>

            <button
              type="button"
              onClick={handleCacheAllTracks}
              disabled={cachingAll}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#00ff66] hover:bg-emerald-400 px-3 py-1.5 text-xs font-mono font-bold text-zinc-950 transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                {cachingAll ? 'Caching Library...' : 'Cache Entire Library'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleClearVault}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 hover:border-rose-500/50 hover:text-rose-300 px-3 py-1.5 text-xs font-mono text-zinc-300 transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Purge Vault</span>
            </button>
          </div>
        </div>

        <div className="p-5">
          {cachedTracksList.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-400 font-mono">
              No tracks cached in IndexedDB yet. Play any song to trigger the{' '}
              {offlinePreloadCount}-track lookahead preloader or click
              &ldquo;Cache Entire Library&rdquo;.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/70 max-h-80 overflow-y-auto pr-1">
              {cachedTracksList.map((track) => (
                <div
                  key={track.id}
                  className="py-2.5 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-white truncate">
                      <CheckCircle2 className="w-4 h-4 text-[#00ff66] shrink-0" />
                      <span className="truncate">{track.title}</span>
                      <span className="text-zinc-500">·</span>
                      <span className="text-xs text-zinc-400 truncate">
                        {track.artist}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-400 font-mono">
                      {track.sourceName} · IndexedDB Vault Blob (Full Web Audio
                      EQ + Stabilizer Ready)
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onPlayTrack(track)}
                      className="rounded-lg bg-zinc-800 hover:bg-[#00ff66] hover:text-zinc-950 px-3 py-1.5 text-xs font-mono font-bold text-zinc-200 transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
                    >
                      Play Blob
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveSingle(track.id)}
                      aria-label={`Remove ${track.title} from offline vault`}
                      className="rounded-lg border border-zinc-800 p-2 text-zinc-400 hover:text-rose-400 transition-colors min-h-[34px]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
