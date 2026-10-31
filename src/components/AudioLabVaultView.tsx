import React, { useState } from 'react';
import {
  CheckCircle2,
  Database,
  Download,
  Gauge,
  Sliders,
  Trash2,
  Volume2,
} from 'lucide-react';
import type { EQPresetName, Track } from '../types/music';
import {
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

interface AudioLabVaultViewProps {
  currentTrack: Track | null;
  allTracks: Track[];
  carVolumeLeveler: boolean;
  onToggleCarVolumeLeveler: (next: boolean) => void;
  lufsNormalizationEnabled: boolean;
  onToggleLufsNormalization: (next: boolean) => void;
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
  lufsNormalizationEnabled,
  onToggleLufsNormalization,
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
  const cachedTracksList = allTracks.filter((t) => cachedTrackIds.has(t.id));

  return (
    <div className="space-y-10">
      {/* Row 1: Car Audio Leveler + 5-Band Graphic EQ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: DynamicsCompressor & LUFS Leveler */}
        <section
          aria-labelledby="leveler-heading"
          className="lg:col-span-5 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6 space-y-5"
        >
          <div className="flex items-center gap-3 border-b border-zinc-800/80 pb-4">
            <Gauge className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <h2
                id="leveler-heading"
                className="text-lg font-bold text-white tracking-tight"
              >
                Car Mode Volume Leveler & LUFS
              </h2>
              <p className="text-xs text-zinc-400">
                Web Audio API DynamicsCompressorNode + GainNode
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {/* Toggle 1: DynamicsCompressorNode */}
            <div className="flex items-start justify-between gap-4 rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-white">
                  Car Mode Volume Leveler
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Engages a Web Audio `DynamicsCompressorNode` (`threshold: -24dB,
                  knee: 30dB, ratio: 12:1`) so quiet acoustic intros and loud
                  synth drops stay at the same comfortable highway volume.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={carVolumeLeveler}
                onClick={() => onToggleCarVolumeLeveler(!carVolumeLeveler)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
                  carVolumeLeveler
                    ? 'bg-emerald-500 text-zinc-950'
                    : 'bg-zinc-800 text-zinc-300 hover:text-white'
                }`}
              >
                {carVolumeLeveler ? 'Active (-24dB / 12:1)' : 'Bypassed'}
              </button>
            </div>

            {/* Toggle 2: ReplayGain / LUFS NormalizationGain */}
            <div className="flex items-start justify-between gap-4 rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-white">
                  Jellyfin / Subsonic LUFS GainNode
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Applies per-track `NormalizationGain` metadata before the EQ
                  stage. Current track:{' '}
                  <span className="font-mono text-emerald-400 tabular-nums">
                    {currentTrack?.normalizationGain !== undefined
                      ? `${currentTrack.normalizationGain > 0 ? '+' : ''}${currentTrack.normalizationGain} dB (${currentLufsGain}x)`
                      : '0.0 dB (1.0x)'}
                  </span>
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={lufsNormalizationEnabled}
                onClick={() =>
                  onToggleLufsNormalization(!lufsNormalizationEnabled)
                }
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
                  lufsNormalizationEnabled
                    ? 'bg-purple-500 text-white'
                    : 'bg-zinc-800 text-zinc-300 hover:text-white'
                }`}
              >
                {lufsNormalizationEnabled ? 'LUFS On' : 'LUFS Off'}
              </button>
            </div>
          </div>
        </section>

        {/* Right: 5-Band Graphic EQ */}
        <section
          aria-labelledby="eq-heading"
          className="lg:col-span-7 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
            <div className="flex items-center gap-2.5">
              <Sliders className="w-5 h-5 text-purple-400 shrink-0" />
              <div>
                <h2
                  id="eq-heading"
                  className="text-lg font-bold text-white tracking-tight"
                >
                  5-Band Graphic Equalizer
                </h2>
                <p className="text-xs text-zinc-400">
                  60Hz Low-Shelf · 230Hz · 910Hz · 3.6kHz · 14kHz High-Shelf
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {PRESET_NAMES.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onApplyPreset(preset)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[36px] ${
                    eqPreset === preset
                      ? 'bg-emerald-500 text-zinc-950 font-semibold'
                      : 'bg-zinc-800/90 text-zinc-300 hover:bg-zinc-800 hover:text-white'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 pt-2">
            {EQ_FREQUENCIES.map((freq, idx) => {
              const gain = eqGains[idx] ?? 0;
              const label = EQ_LABELS[freq];
              return (
                <div
                  key={freq}
                  className="rounded-xl border border-zinc-800/70 bg-zinc-950/60 p-3.5 flex flex-col justify-between gap-3"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-zinc-200 font-mono whitespace-nowrap">
                      {label}
                    </span>
                    <span className="text-xs font-mono tabular-nums text-emerald-400 whitespace-nowrap">
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
        </section>
      </div>

      {/* Row 2: IndexedDB Offline Audio Vault */}
      <section
        aria-labelledby="vault-heading"
        className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <h2
                id="vault-heading"
                className="text-lg font-bold text-white tracking-tight"
              >
                IndexedDB Offline Vault (`brokeify-offline-vault`)
              </h2>
              <p className="text-xs text-zinc-400">
                2-Song Lookahead Preloader caches full audio Blobs automatically
                so dead zones never interrupt playback.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-mono text-zinc-300 tabular-nums">
              {cachedTrackIds.size} tracks cached ·{' '}
              {(vaultTotalBytes / (1024 * 1024)).toFixed(2)} MB stored
            </span>

            <button
              type="button"
              onClick={handleCacheAllTracks}
              disabled={cachingAll}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                {cachingAll ? 'Caching Library...' : 'Cache Entire Library'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleClearVault}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950 hover:border-rose-500/50 hover:text-rose-300 px-3 py-2 text-xs font-medium text-zinc-400 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Purge Vault</span>
            </button>
          </div>
        </div>

        {cachedTracksList.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-400">
            No tracks cached in IndexedDB yet. Play any song to trigger the 2-song
            lookahead preloader or click &ldquo;Cache Entire Library&rdquo;.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/70">
            {cachedTracksList.map((track) => (
              <div
                key={track.id}
                className="py-3 flex items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-white truncate">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="truncate">{track.title}</span>
                    <span className="text-zinc-500">·</span>
                    <span className="text-xs text-zinc-400 truncate">
                      {track.artist}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-400 font-mono">
                    {track.sourceName} · Pre-loaded in IndexedDB Blob URL ready
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onPlayTrack(track)}
                    className="rounded-xl bg-zinc-800 hover:bg-emerald-500 hover:text-zinc-950 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
                  >
                    Play Blob
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveSingle(track.id)}
                    aria-label={`Remove ${track.title} from offline vault`}
                    className="rounded-xl border border-zinc-800 p-2 text-zinc-400 hover:text-rose-400 transition-colors min-h-[38px]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
