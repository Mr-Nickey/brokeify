import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Gauge,
  Database,
  CheckCircle2,
  Loader2,
  Sparkles,
  Car,
  Sliders,
  ListMusic,
  Download,
  Heart,
  Radio,
  Mic2,
  Moon,
} from 'lucide-react';
import { Track, EQPresetName, StabilizerStrength } from '../types/music';
import { computeTrackStabilizationGain } from '../utils/musicLogic';
import { preloadTrackToVault } from '../utils/offlineVault';
import { WinampVisualizer } from './WinampVisualizer';
import { createAlbumArtworkDataUri } from '../utils/artworkGenerator';

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

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
  repeatMode: 'off' | 'all' | 'one';
  carVolumeLeveler: boolean;
  stabilizerStrength?: StabilizerStrength;
  crossfadeSeconds: number;
  onChangeCrossfadeSeconds?: (seconds: number) => void;
  isCrossfading: boolean;
  offlinePreloadCount?: number;
  onChangeOfflinePreloadCount?: (count: number) => void;
  eqPreset?: EQPresetName;
  onApplyEqPreset?: (preset: EQPresetName) => void;
  onRefreshVaultState?: () => Promise<void>;
  cachedTrackIds: Set<string>;
  preloadingTrackIds: Set<string>;
  frequencyData: number[];
  waveformData: number[];
  onTogglePlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (val: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleCarVolumeLeveler: () => void;
  onPlaySpecificTrack: (track: Track) => void;
  onOpenCarMode: () => void;
  onOpenAudioLab: () => void;
  likedTrackIds?: Set<string>;
  onToggleLikeTrack?: (track: Track) => void;
  onStartTrackRadio?: (track: Track) => void;
  sleepTimerMinutes?: number | null;
  sleepTimerRemainingSec?: number | null;
  onSetSleepTimerMinutes?: (minutes: number | null) => void;
}

interface ParsedLyricLine {
  timeSec: number;
  text: string;
}

function parseLrcLyrics(lrc: string): ParsedLyricLine[] {
  const lines = String(lrc || '').split(/\r?\n/);
  const parsed: ParsedLyricLine[] = [];
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const rawLine of lines) {
    const matches = [...rawLine.matchAll(timeRegex)];
    if (matches.length === 0) continue;
    const text = rawLine.replace(timeRegex, '').trim();
    for (const m of matches) {
      const mins = parseInt(m[1], 10) || 0;
      const secs = parseInt(m[2], 10) || 0;
      const fracRaw = m[3] || '0';
      const frac =
        parseInt(fracRaw, 10) / Math.pow(10, Math.max(1, fracRaw.length));
      parsed.push({
        timeSec: mins * 60 + secs + frac,
        text: text || '♪',
      });
    }
  }

  return parsed.sort((a, b) => a.timeSec - b.timeSec);
}

const MOBILE_EQ_PRESETS: EQPresetName[] = [
  'Car Stereo',
  'Bass Boost',
  'Rock',
  'Vocal',
  'Late Night',
  'Flat',
];

const SLEEP_TIMER_OPTIONS: Array<{ label: string; minutes: number | null }> = [
  { label: 'Off', minutes: null },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '45m', minutes: 45 },
  { label: '60m', minutes: 60 },
];

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
  stabilizerStrength = 'aggressive',
  crossfadeSeconds,
  onChangeCrossfadeSeconds,
  isCrossfading,
  offlinePreloadCount = 5,
  onChangeOfflinePreloadCount,
  eqPreset = 'Car Stereo',
  onApplyEqPreset,
  onRefreshVaultState,
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
  likedTrackIds,
  onToggleLikeTrack,
  onStartTrackRadio,
  sleepTimerMinutes = null,
  sleepTimerRemainingSec = null,
  onSetSleepTimerMinutes,
}) => {
  const [mobileSection, setMobileSection] = useState<
    'player' | 'lyrics' | 'queue' | 'dsp'
  >('player');
  const [isCachingCurrent, setIsCachingCurrent] = useState(false);

  // Lyrics state
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [syncedLyricsRaw, setSyncedLyricsRaw] = useState<string | null>(null);
  const [plainLyricsRaw, setPlainLyricsRaw] = useState<string | null>(null);
  const [lyricsInstrumental, setLyricsInstrumental] = useState(false);
  const activeLyricRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!currentTrack || !isOpen) return;
    let cancelled = false;
    setLyricsLoading(true);
    setSyncedLyricsRaw(null);
    setPlainLyricsRaw(null);
    setLyricsInstrumental(false);

    const params = new URLSearchParams({
      title: currentTrack.title || '',
      artist: currentTrack.artist || '',
      album: currentTrack.album || '',
      duration: String(Math.round(currentTrack.duration || 0)),
    });

    fetch(`/api/lyrics?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setSyncedLyricsRaw(data.syncedLyrics || null);
        setPlainLyricsRaw(data.plainLyrics || null);
        setLyricsInstrumental(Boolean(data.instrumental));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLyricsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id, isOpen]);

  const parsedSyncedLines = useMemo(
    () => (syncedLyricsRaw ? parseLrcLyrics(syncedLyricsRaw) : []),
    [syncedLyricsRaw]
  );

  const activeLyricIndex = useMemo(() => {
    if (parsedSyncedLines.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < parsedSyncedLines.length; i++) {
      if (currentTime + 0.25 >= parsedSyncedLines[i].timeSec) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [parsedSyncedLines, currentTime]);

  useEffect(() => {
    if (mobileSection === 'lyrics' && activeLyricRef.current) {
      activeLyricRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeLyricIndex, mobileSection]);

  if (!isOpen || !currentTrack) return null;

  const isCurrentCached = cachedTrackIds.has(currentTrack.id);
  const isCurrentPreloading = preloadingTrackIds.has(currentTrack.id);
  const isCurrentLiked = likedTrackIds?.has(currentTrack.id) ?? false;
  const profile = computeTrackStabilizationGain(currentTrack, {
    carVolumeLeveler,
    lufsNormalizationEnabled: true,
    stabilizerStrength: carVolumeLeveler ? stabilizerStrength : 'off',
  });

  const handleSaveCurrentOffline = async () => {
    if (isCurrentCached || isCachingCurrent) return;
    setIsCachingCurrent(true);
    try {
      await preloadTrackToVault(currentTrack);
      if (onRefreshVaultState) {
        await onRefreshVaultState();
      }
    } finally {
      setIsCachingCurrent(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing Expanded Deck"
      data-testid="now-playing-drawer"
      className="fixed inset-0 z-50 bg-[#090d14]/98 backdrop-blur-2xl flex flex-col overflow-hidden animate-in fade-in duration-200"
    >
      {/* Top Bar */}
      <div className="winamp-titlebar flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3 border-b border-zinc-700/80 shrink-0">
        <button
          type="button"
          onClick={onClose}
          data-testid="close-drawer-btn"
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-xs font-mono font-bold text-zinc-200 hover:text-[#00ff66] transition-colors min-h-[40px]"
        >
          <ChevronDown className="w-4 h-4 text-[#00ff66]" />
          <span>Minimize</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono uppercase tracking-widest text-[#00ff66] font-bold hidden sm:inline">
            WINAMP MOBILE &amp; DOCKER DECK //
          </span>
          <span className="rounded-lg bg-emerald-500/15 border border-emerald-500/40 px-2.5 py-1 text-[11px] font-mono font-bold text-[#00ff66] truncate max-w-[140px] sm:max-w-none">
            {currentTrack.sourceName}
          </span>
          {sleepTimerMinutes !== null && (
            <span className="rounded-lg bg-indigo-500/20 border border-indigo-400/50 px-2 py-1 text-[10px] font-mono font-bold text-indigo-300 inline-flex items-center gap-1">
              <Moon className="w-3 h-3" />
              {sleepTimerRemainingSec !== null
                ? `${Math.ceil(sleepTimerRemainingSec / 60)}m`
                : `${sleepTimerMinutes}m`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {onToggleLikeTrack && (
            <button
              type="button"
              onClick={() => onToggleLikeTrack(currentTrack)}
              data-testid="drawer-like-track-btn"
              aria-label={isCurrentLiked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
              title={isCurrentLiked ? 'Liked — tap to remove' : 'Save to Liked Songs'}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-mono font-bold transition-colors min-h-[40px] ${
                isCurrentLiked
                  ? 'border-rose-500/60 bg-rose-500/20 text-rose-400'
                  : 'border-zinc-700 bg-zinc-900/90 text-zinc-300 hover:text-rose-400'
              }`}
            >
              <Heart
                className={`w-4 h-4 ${
                  isCurrentLiked ? 'fill-rose-500 text-rose-400' : ''
                }`}
              />
              <span className="hidden sm:inline">
                {isCurrentLiked ? 'Liked' : 'Like'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenCarMode();
            }}
            data-testid="drawer-car-mode-btn"
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 px-3 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[40px]"
          >
            <Car className="w-4 h-4" />
            <span>Car Mode</span>
          </button>
        </div>
      </div>

      {/* Mobile Segmented Switcher (Player / Lyrics / Up Next Queue / Sound & EQ) */}
      <div className="lg:hidden grid grid-cols-4 gap-1 p-2 bg-zinc-950/90 border-b border-zinc-800 shrink-0">
        <button
          type="button"
          onClick={() => setMobileSection('player')}
          data-testid="drawer-tab-player"
          className={`flex items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-mono font-bold transition-colors min-h-[38px] ${
            mobileSection === 'player'
              ? 'bg-[#00ff66] text-zinc-950'
              : 'bg-zinc-900 text-zinc-300 hover:text-white'
          }`}
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Player</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileSection('lyrics')}
          data-testid="drawer-tab-lyrics"
          className={`flex items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-mono font-bold transition-colors min-h-[38px] ${
            mobileSection === 'lyrics'
              ? 'bg-[#00ff66] text-zinc-950'
              : 'bg-zinc-900 text-zinc-300 hover:text-white'
          }`}
        >
          <Mic2 className="w-3.5 h-3.5" />
          <span>Lyrics</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileSection('queue')}
          data-testid="drawer-tab-queue"
          className={`flex items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-mono font-bold transition-colors min-h-[38px] ${
            mobileSection === 'queue'
              ? 'bg-[#00ff66] text-zinc-950'
              : 'bg-zinc-900 text-zinc-300 hover:text-white'
          }`}
        >
          <ListMusic className="w-3.5 h-3.5" />
          <span>Queue ({queue.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileSection('dsp')}
          data-testid="drawer-tab-dsp"
          className={`flex items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-mono font-bold transition-colors min-h-[38px] ${
            mobileSection === 'dsp'
              ? 'bg-[#00ff66] text-zinc-950'
              : 'bg-zinc-900 text-zinc-300 hover:text-white'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Sound &amp; EQ</span>
        </button>
      </div>

      {/* Main Content Grid */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 xl:px-10 py-4 sm:py-6 max-w-[1800px] w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: Artwork, Track Info, Visualizer, Scrubber, Transport */}
        <div
          className={`lg:col-span-7 space-y-4 sm:space-y-5 ${
            mobileSection !== 'player' ? 'hidden lg:block' : 'block'
          }`}
        >
          <div className="winamp-bezel rounded-3xl p-4 sm:p-6 border border-zinc-700/80 space-y-4 sm:space-y-5">
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5">
              <div className="relative group shrink-0">
                <img
                  src={currentTrack.artworkUrl}
                  alt={currentTrack.title}
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = createAlbumArtworkDataUri(
                      currentTrack.title,
                      currentTrack.artist,
                      currentTrack.accentColor || '#10b981',
                      '#09090b'
                    );
                  }}
                  className="w-36 h-36 sm:w-44 sm:h-44 rounded-2xl object-cover shadow-2xl border-2 border-zinc-700"
                />
                <div className="absolute -bottom-2 right-2 rounded-lg bg-zinc-950/90 border border-zinc-700 px-2.5 py-0.5 text-[10px] font-mono text-[#00ff66] uppercase">
                  {currentTrack.format || 'FLAC'} ·{' '}
                  {currentTrack.bitrateKbps || 960}kbps
                </div>
              </div>

              <div className="text-center sm:text-left space-y-1.5 min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5">
                  {isCurrentPreloading ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 border border-amber-500/40 px-2 py-0.5 text-[11px] font-mono text-amber-300">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Pre-loading into Offline Vault...
                    </span>
                  ) : isCurrentCached ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[11px] font-mono text-[#00ff66]">
                      <CheckCircle2 className="w-3 h-3" />
                      Pre-Loaded in Offline Vault
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSaveCurrentOffline}
                      disabled={isCachingCurrent}
                      className="inline-flex items-center gap-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 px-2.5 py-1 text-[11px] font-mono text-zinc-200 hover:text-[#00ff66] transition-colors"
                    >
                      <Download className="w-3 h-3 text-[#00ff66]" />
                      <span>
                        {isCachingCurrent
                          ? 'Saving to Phone...'
                          : 'Save Track Offline'}
                      </span>
                    </button>
                  )}
                  <span className="rounded-md bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[11px] font-mono text-zinc-300">
                    {profile.profileLabel}
                  </span>
                </div>

                <h2 className="text-xl sm:text-3xl font-bold text-white tracking-tight truncate">
                  {currentTrack.title}
                </h2>
                <p className="text-sm sm:text-base font-medium text-[#00ff66] font-mono truncate">
                  {currentTrack.artist}
                </p>
                <p className="text-xs text-zinc-400 truncate">
                  {currentTrack.album}
                </p>

                {/* Quick Spotify-style Action Pills: Like, Song Radio, Lyrics */}
                <div className="pt-2 flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  {onToggleLikeTrack && (
                    <button
                      type="button"
                      onClick={() => onToggleLikeTrack(currentTrack)}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-mono font-bold transition-colors ${
                        isCurrentLiked
                          ? 'border-rose-500/60 bg-rose-500/20 text-rose-300'
                          : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-rose-300'
                      }`}
                    >
                      <Heart
                        className={`w-3.5 h-3.5 ${
                          isCurrentLiked ? 'fill-rose-500 text-rose-400' : ''
                        }`}
                      />
                      <span>{isCurrentLiked ? 'Liked Song' : 'Like Song'}</span>
                    </button>
                  )}

                  {onStartTrackRadio && (
                    <button
                      type="button"
                      onClick={() => onStartTrackRadio(currentTrack)}
                      data-testid="drawer-start-radio-btn"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-950/30 hover:bg-purple-900/50 px-3 py-1.5 text-xs font-mono font-bold text-purple-300 transition-colors"
                    >
                      <Radio className="w-3.5 h-3.5" />
                      <span>Start Song Radio</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setMobileSection('lyrics')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-900/40 px-3 py-1.5 text-xs font-mono font-bold text-[#00ff66] transition-colors"
                  >
                    <Mic2 className="w-3.5 h-3.5" />
                    <span>Sing-Along Lyrics</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Real-Time Spectrum & Oscilloscope */}
            <WinampVisualizer
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              frequencyData={frequencyData}
              waveformData={waveformData}
              crossfadeSeconds={crossfadeSeconds}
              isCrossfading={isCrossfading}
              stabilizerStrength={stabilizerStrength}
              carVolumeLeveler={carVolumeLeveler}
            />

            {/* Scrubber */}
            <div className="space-y-1.5">
              <input
                type="range"
                min={0}
                max={Math.max(1, duration)}
                value={currentTime}
                aria-label="Seek audio position"
                onChange={(e) => onSeek(parseFloat(e.target.value))}
                className="w-full h-2 accent-[#00ff66] cursor-pointer"
              />
              <div className="flex justify-between text-xs font-mono text-[#00ff66] tabular-nums">
                <span>{formatDuration(currentTime)}</span>
                <span className="text-zinc-400">
                  -{formatDuration(Math.max(0, duration - currentTime))} left
                </span>
                <span>{formatDuration(duration)}</span>
              </div>
            </div>

            {/* Primary Transport Controls + Mobile +/-10s Quick Seek */}
            <div className="flex items-center justify-between gap-2 sm:gap-4 pt-1">
              <button
                type="button"
                onClick={onToggleShuffle}
                aria-label="Toggle Shuffle"
                className={`p-3 rounded-2xl border transition-colors min-h-[46px] min-w-[46px] flex items-center justify-center ${
                  shuffleEnabled
                    ? 'border-[#00ff66] bg-emerald-500/15 text-[#00ff66]'
                    : 'border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:text-white'
                }`}
              >
                <Shuffle className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={onPrevious}
                  aria-label="Previous Track"
                  className="p-3 sm:p-3.5 rounded-2xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-white transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
                >
                  <SkipBack className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>

                <button
                  type="button"
                  onClick={() => onSeek(Math.max(0, currentTime - 10))}
                  aria-label="Rewind 10 seconds"
                  title="Rewind 10 seconds"
                  className="px-2.5 py-2 rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-300 hover:text-white font-mono text-xs font-bold min-h-[44px]"
                >
                  -10s
                </button>

                <button
                  type="button"
                  onClick={onTogglePlayPause}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  className="w-15 h-15 sm:w-16 sm:h-16 rounded-2xl bg-[#00ff66] hover:bg-emerald-400 text-zinc-950 flex items-center justify-center shadow-lg transition-transform active:scale-95"
                >
                  {isPlaying ? (
                    <Pause className="w-7 h-7 fill-current" />
                  ) : (
                    <Play className="w-7 h-7 fill-current ml-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onSeek(Math.min(Math.max(1, duration), currentTime + 10))
                  }
                  aria-label="Fast-forward 10 seconds"
                  title="Fast-forward 10 seconds"
                  className="px-2.5 py-2 rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-300 hover:text-white font-mono text-xs font-bold min-h-[44px]"
                >
                  +10s
                </button>

                <button
                  type="button"
                  onClick={onNext}
                  aria-label="Next Track"
                  className="p-3 sm:p-3.5 rounded-2xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-white transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
                >
                  <SkipForward className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              </div>

              <button
                type="button"
                onClick={onCycleRepeat}
                aria-label={`Repeat mode: ${repeatMode}`}
                className={`p-3 rounded-2xl border transition-colors min-h-[46px] min-w-[46px] flex items-center justify-center ${
                  repeatMode !== 'off'
                    ? 'border-purple-500/60 bg-purple-500/15 text-purple-300'
                    : 'border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:text-white'
                }`}
              >
                {repeatMode === 'one' ? (
                  <Repeat1 className="w-5 h-5" />
                ) : (
                  <Repeat className="w-5 h-5" />
                )}
              </button>
            </div>

            {/* Volume + Stabilizer Quick Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-zinc-800">
              <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                <button
                  type="button"
                  onClick={onToggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white min-h-[38px] min-w-[38px] flex items-center justify-center"
                >
                  {isMuted ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-[#00ff66]" />
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
                  className="w-full max-w-[180px] cursor-pointer"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleCarVolumeLeveler}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-mono font-bold transition-colors min-h-[38px] ${
                    carVolumeLeveler
                      ? 'bg-emerald-500/15 border border-emerald-500/50 text-[#00ff66]'
                      : 'bg-zinc-900 border border-zinc-800 text-zinc-400'
                  }`}
                >
                  <Gauge className="w-3.5 h-3.5" />
                  <span>
                    Leveler: {carVolumeLeveler ? 'ON (-14 LUFS)' : 'OFF'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAudioLab();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 px-3 py-2 text-xs font-mono font-semibold text-zinc-200 transition-colors min-h-[38px]"
                >
                  <Sliders className="w-3.5 h-3.5 text-purple-400" />
                  <span>Full Audio Lab</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right 5 Columns: Synchronized Lyrics, Mobile Sound & EQ Controls, Sleep Timer & Up Next Queue */}
        <div
          className={`lg:col-span-5 space-y-4 ${
            mobileSection === 'player' ? 'hidden lg:block' : 'block'
          }`}
        >
          {/* Synchronized Sing-Along Lyrics Card */}
          <div
            data-testid="drawer-lyrics-card"
            className={`winamp-bezel rounded-3xl border border-zinc-700/80 overflow-hidden flex flex-col ${
              mobileSection === 'lyrics'
                ? 'block'
                : mobileSection === 'queue' || mobileSection === 'dsp'
                  ? 'hidden lg:flex'
                  : 'flex'
            }`}
          >
            <div className="winamp-titlebar px-4 py-3 border-b border-zinc-700/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mic2 className="w-4 h-4 text-[#00ff66]" />
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
                  SING-ALONG LYRICS // LRCLIB SYNC
                </h3>
              </div>
              <span className="text-[10px] font-mono text-zinc-400">
                {parsedSyncedLines.length > 0
                  ? 'Time-Synced (Tap any line to jump)'
                  : plainLyricsRaw
                    ? 'Plain Lyrics'
                    : 'Auto-Lookup'}
              </span>
            </div>

            <div className="p-4 max-h-[280px] overflow-y-auto space-y-2 winamp-lcd">
              {lyricsLoading ? (
                <div className="py-10 flex flex-col items-center justify-center gap-2 text-xs font-mono text-zinc-400">
                  <Loader2 className="w-5 h-5 animate-spin text-[#00ff66]" />
                  <span>Fetching synchronized lyrics for {currentTrack.title}...</span>
                </div>
              ) : lyricsInstrumental ? (
                <div className="py-10 text-center text-xs font-mono text-zinc-400">
                  🎵 Instrumental track — enjoy the visualizer &amp; groove!
                </div>
              ) : parsedSyncedLines.length > 0 ? (
                parsedSyncedLines.map((line, idx) => {
                  const isActive = idx === activeLyricIndex;
                  return (
                    <button
                      key={`${line.timeSec}-${idx}`}
                      ref={isActive ? activeLyricRef : null}
                      type="button"
                      onClick={() => onSeek(line.timeSec)}
                      className={`w-full text-left px-3 py-1.5 rounded-xl font-mono transition-all ${
                        isActive
                          ? 'bg-emerald-500/20 border border-emerald-500/40 text-[#00ff66] text-sm sm:text-base font-bold scale-[1.01]'
                          : 'text-zinc-400 hover:text-zinc-200 text-xs sm:text-sm'
                      }`}
                    >
                      <span className="text-[10px] text-zinc-500 mr-2 tabular-nums">
                        {formatDuration(line.timeSec)}
                      </span>
                      <span>{line.text}</span>
                    </button>
                  );
                })
              ) : plainLyricsRaw ? (
                <pre className="whitespace-pre-wrap text-xs sm:text-sm font-mono text-zinc-200 leading-relaxed">
                  {plainLyricsRaw}
                </pre>
              ) : (
                <div className="py-8 text-center space-y-1.5 text-xs font-mono text-zinc-400">
                  <p className="text-zinc-300 font-semibold">
                    No external lyrics found for &ldquo;{currentTrack.title}&rdquo;
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Lyrics are automatically queried via LRCLIB using track title &amp; artist tags.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Mobile & Quick Sound / EQ / Crossfade / Sleep Timer Card */}
          <div
            className={`winamp-bezel rounded-3xl border border-zinc-700/80 p-4 space-y-4 ${
              mobileSection === 'queue' || mobileSection === 'lyrics'
                ? 'hidden lg:block'
                : 'block'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-xs font-mono font-bold uppercase tracking-wider text-[#00ff66] flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" />
                <span>Quick Sound, EQ &amp; Sleep Timer</span>
              </div>
              <span className="text-[11px] font-mono text-zinc-400">
                Active: <strong className="text-white">{eqPreset}</strong>
              </span>
            </div>

            {onApplyEqPreset && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {MOBILE_EQ_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onApplyEqPreset(preset)}
                    className={`px-2.5 py-2 rounded-xl text-[11px] font-mono font-semibold text-left truncate border transition-colors min-h-[36px] ${
                      eqPreset === preset
                        ? 'border-[#00ff66] bg-emerald-500/15 text-[#00ff66] font-bold'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:text-white'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            )}

            {/* Sleep Timer Selector */}
            {onSetSleepTimerMinutes && (
              <div className="pt-2 border-t border-zinc-800/80 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-300 inline-flex items-center gap-1.5">
                    <Moon className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Sleep Timer (Auto-Pause):</span>
                  </span>
                  <span className="text-indigo-300 font-bold">
                    {sleepTimerMinutes === null
                      ? 'OFF'
                      : sleepTimerRemainingSec !== null
                        ? `${Math.floor(sleepTimerRemainingSec / 60)}m ${sleepTimerRemainingSec % 60}s left`
                        : `${sleepTimerMinutes} min`}
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {SLEEP_TIMER_OPTIONS.map((opt) => {
                    const active = sleepTimerMinutes === opt.minutes;
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => onSetSleepTimerMinutes(opt.minutes)}
                        data-testid={`sleep-timer-btn-${opt.label.toLowerCase()}`}
                        className={`py-1.5 rounded-xl text-xs font-mono font-bold border transition-colors ${
                          active
                            ? 'border-indigo-400 bg-indigo-500/25 text-indigo-200'
                            : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-800/80">
              {onChangeCrossfadeSeconds && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-zinc-300 inline-flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                      <span>Crossfade:</span>
                    </span>
                    <span className="text-[#00ff66] font-bold">
                      {crossfadeSeconds === 0 ? 'OFF' : `${crossfadeSeconds}s`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={12}
                    step={1}
                    value={crossfadeSeconds}
                    aria-label="Drawer Crossfade Seconds"
                    onChange={(e) =>
                      onChangeCrossfadeSeconds(parseInt(e.target.value, 10))
                    }
                    className="w-full cursor-pointer"
                  />
                </div>
              )}

              {onChangeOfflinePreloadCount && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-zinc-300 inline-flex items-center gap-1">
                      <Database className="w-3.5 h-3.5 text-[#00ff66]" />
                      <span>Auto-Cache Ahead:</span>
                    </span>
                    <span className="text-[#00ff66] font-bold">
                      {offlinePreloadCount} songs
                    </span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={12}
                    step={1}
                    value={offlinePreloadCount}
                    aria-label="Drawer Offline Preload Count"
                    onChange={(e) =>
                      onChangeOfflinePreloadCount(parseInt(e.target.value, 10))
                    }
                    className="w-full cursor-pointer"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Up Next Queue */}
          <div
            className={`winamp-bezel rounded-3xl border border-zinc-700/80 flex flex-col max-h-[480px] overflow-hidden ${
              mobileSection === 'dsp' || mobileSection === 'lyrics'
                ? 'hidden lg:flex'
                : 'flex'
            }`}
          >
            <div className="winamp-titlebar px-4 py-3 border-b border-zinc-700/80 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
                  UP NEXT QUEUE ({queue.length} TRACKS)
                </h3>
                <p className="text-[11px] text-zinc-400 font-mono">
                  Next {offlinePreloadCount} tracks auto-cached for dead-zones
                </p>
              </div>
              <Database className="w-4 h-4 text-[#00ff66]" />
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/70 p-2.5">
              {queue.map((track, idx) => {
                const isCurrent = idx === currentIndex;
                const isCached = cachedTrackIds.has(track.id);
                const isPreloading = preloadingTrackIds.has(track.id);
                const isLiked = likedTrackIds?.has(track.id) ?? false;
                const isUpcomingLookahead =
                  idx > currentIndex &&
                  idx <= currentIndex + offlinePreloadCount;

                return (
                  <div
                    key={`${track.id}-${idx}`}
                    className={`w-full text-left p-2.5 rounded-xl flex items-center justify-between gap-2.5 transition-colors ${
                      isCurrent
                        ? 'bg-emerald-500/15 border border-emerald-500/40'
                        : 'hover:bg-zinc-900/80'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (isCurrent) {
                          onTogglePlayPause();
                        } else {
                          onPlaySpecificTrack(track);
                        }
                      }}
                      className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                    >
                      <span className="w-5 text-xs font-mono text-zinc-500 tabular-nums">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <img
                        src={track.artworkUrl}
                        alt={track.title}
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = createAlbumArtworkDataUri(
                            track.title,
                            track.artist,
                            track.accentColor || '#10b981',
                            '#09090b'
                          );
                        }}
                        className="w-10 h-10 rounded-lg object-cover border border-zinc-700 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-xs font-semibold truncate ${
                            isCurrent ? 'text-[#00ff66]' : 'text-white'
                          }`}
                        >
                          {track.title}
                        </div>
                        <div className="text-[11px] text-zinc-400 truncate flex items-center gap-1.5">
                          <span className="truncate">{track.artist}</span>
                          {isUpcomingLookahead && (
                            <span className="text-[10px] font-mono text-sky-400">
                              · Lookahead
                            </span>
                          )}
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isPreloading ? (
                        <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                      ) : isCached ? (
                        <span
                          title="Cached in Offline Vault"
                          className="text-[10px] font-mono text-[#00ff66] bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded hidden sm:inline"
                        >
                          VAULT
                        </span>
                      ) : null}

                      {onToggleLikeTrack && (
                        <button
                          type="button"
                          onClick={() => onToggleLikeTrack(track)}
                          aria-label={isLiked ? 'Unlike song' : 'Like song'}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isLiked
                              ? 'text-rose-400'
                              : 'text-zinc-500 hover:text-rose-400'
                          }`}
                        >
                          <Heart
                            className={`w-3.5 h-3.5 ${
                              isLiked ? 'fill-rose-500 text-rose-400' : ''
                            }`}
                          />
                        </button>
                      )}

                      {isCurrent ? (
                        <button
                          type="button"
                          onClick={onTogglePlayPause}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/60 bg-emerald-500/20 px-2 py-1 text-[11px] font-mono font-bold text-[#00ff66]"
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full bg-[#00ff66] ${
                              isPlaying ? 'animate-pulse' : ''
                            }`}
                          />
                          <span>{isPlaying ? 'Now Playing' : 'Paused'}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onPlaySpecificTrack(track)}
                          className="rounded-lg bg-zinc-800 hover:bg-[#00ff66] hover:text-zinc-950 px-2.5 py-1 text-[11px] font-mono font-semibold text-zinc-200 transition-colors"
                        >
                          Play
                        </button>
                      )}
                    </div>
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
