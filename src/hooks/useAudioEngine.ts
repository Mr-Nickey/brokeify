import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  EQPresetName,
  RepeatMode,
  StabilizerStrength,
  Track,
  VisualThemeId,
} from '../types/music';
import {
  areTracksSameSong,
  buildJellyfinStreamCandidates,
  computeBufferedAheadSeconds,
  computeTrackStabilizationGain,
  dedupeAndSpreadTracks,
  EQ_FREQUENCIES,
  EQ_PRESETS,
  fisherYatesShuffle,
  isValidVisualTheme,
  smartAntiRepeatShuffle,
} from '../utils/musicLogic';
import {
  getAllVaultEntries,
  getCachedTrackBlob,
  preloadTrackToVault,
  removeTrackFromVault,
} from '../utils/offlineVault';

function getBufferedRangesFromAudio(
  audio: HTMLAudioElement
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  try {
    if (audio.buffered && audio.buffered.length > 0) {
      for (let i = 0; i < audio.buffered.length; i++) {
        ranges.push({
          start: audio.buffered.start(i),
          end: audio.buffered.end(i),
        });
      }
    }
  } catch {}
  return ranges;
}

export function useAudioEngine(initialQueue: Track[]) {
  const [queue, setQueue] = useState<Track[]>(initialQueue);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(180);
  const [volume, setVolume] = useState<number>(0.85);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [shuffleEnabled, setShuffleEnabled] = useState<boolean>(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('all');

  // Web Audio DSP & Driving Preferences (persisted in localStorage & synced via Jellyfin /DisplayPreferences/brokeify)
  const [carVolumeLeveler, setCarVolumeLeveler] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('brokeify_audio_prefs_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.carVolumeLeveler === 'boolean') {
          return parsed.carVolumeLeveler;
        }
      }
    } catch {}
    return true;
  });

  const [stabilizerStrength, setStabilizerStrength] =
    useState<StabilizerStrength>(() => {
      try {
        const saved = localStorage.getItem('brokeify_audio_prefs_v1');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (
            parsed.stabilizerStrength === 'off' ||
            parsed.stabilizerStrength === 'normal' ||
            parsed.stabilizerStrength === 'aggressive'
          ) {
            return parsed.stabilizerStrength;
          }
        }
      } catch {}
      return 'aggressive';
    });

  const [lufsNormalizationEnabled, setLufsNormalizationEnabled] =
    useState<boolean>(() => {
      try {
        const saved = localStorage.getItem('brokeify_audio_prefs_v1');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed.lufsNormalizationEnabled === 'boolean') {
            return parsed.lufsNormalizationEnabled;
          }
        }
      } catch {}
      return true;
    });

  const [crossfadeSeconds, setCrossfadeSeconds] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('brokeify_audio_prefs_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.crossfadeSeconds === 'number') {
          return Math.max(0, Math.min(12, parsed.crossfadeSeconds));
        }
      }
    } catch {}
    return 4;
  });

  const [offlinePreloadCount, setOfflinePreloadCount] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('brokeify_audio_prefs_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.offlinePreloadCount === 'number') {
          return Math.max(2, Math.min(12, Math.round(parsed.offlinePreloadCount)));
        }
      }
    } catch {}
    return 4;
  });

  const [eqPreset, setEqPreset] = useState<EQPresetName>(() => {
    try {
      const saved = localStorage.getItem('brokeify_audio_prefs_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.eqPreset) return parsed.eqPreset;
      }
    } catch {}
    return 'Car Stereo';
  });

  const [eqGains, setEqGains] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem('brokeify_audio_prefs_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.eqGains) && parsed.eqGains.length === 5) {
          return parsed.eqGains;
        }
      }
    } catch {}
    return [...EQ_PRESETS['Car Stereo']];
  });

  const [visualTheme, setVisualTheme] = useState<VisualThemeId>(() => {
    try {
      const saved = localStorage.getItem('brokeify_audio_prefs_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isValidVisualTheme(parsed.visualTheme)) {
          return parsed.visualTheme;
        }
      }
    } catch {}
    return 'cyber-deck';
  });

  // Pre-Play & Mid-Song Anti-Skip Stream Buffer (0s to 15s, default 6s) for variable mobile networks
  const [streamBufferSeconds, setStreamBufferSeconds] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('brokeify_audio_prefs_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          typeof parsed.streamBufferSeconds === 'number' &&
          parsed.streamBufferUpgradedV2 === true
        ) {
          return Math.max(
            0,
            Math.min(15, Math.round(parsed.streamBufferSeconds))
          );
        }
      }
    } catch {}
    return 6;
  });
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [bufferedAheadSeconds, setBufferedAheadSeconds] = useState<number>(0);

  // Smart Anti-Repeat & Duplicate Song Guard (default ON so duplicate downloads never play back-to-back)
  const [smartAntiRepeatEnabled, setSmartAntiRepeatEnabled] = useState<boolean>(
    () => {
      try {
        const saved = localStorage.getItem('brokeify_audio_prefs_v1');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed.smartAntiRepeatEnabled === 'boolean') {
            return parsed.smartAntiRepeatEnabled;
          }
        }
      } catch {}
      return true;
    }
  );

  // IndexedDB Offline Vault & Lookahead Preloader State
  const [cachedTrackIds, setCachedTrackIds] = useState<Set<string>>(new Set());
  const [preloadingTrackIds, setPreloadingTrackIds] = useState<Set<string>>(
    new Set()
  );
  const [vaultTotalBytes, setVaultTotalBytes] = useState<number>(0);
  const [frequencyData, setFrequencyData] = useState<number[]>(
    new Array(24).fill(14)
  );
  const [waveformData, setWaveformData] = useState<number[]>(
    new Array(64).fill(0)
  );
  const [isCrossfading, setIsCrossfading] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unbindAudioEventsRef = useRef<(() => void) | null>(null);
  const fadeInIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const crossfadeTriggeredForTrackRef = useRef<string | null>(null);
  const isCrossfadeTransitionRef = useRef<boolean>(false);
  const isRebufferingRef = useRef<boolean>(false);
  const streamBufferSecondsRef = useRef<number>(streamBufferSeconds);
  const nextTrackWarmupAudioRef = useRef<HTMLAudioElement | null>(null);
  const warmedNextTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    streamBufferSecondsRef.current = streamBufferSeconds;
  }, [streamBufferSeconds]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const lufsGainNodeRef = useRef<GainNode | null>(null);
  const masterGainNodeRef = useRef<GainNode | null>(null);
  const eqNodesRef = useRef<BiquadFilterNode[]>([]);
  const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);
  const onEndedCallbackRef = useRef<() => void>(() => {});

  // Keep queue synchronized when initialQueue updates (and deduplicate when Smart Anti-Repeat is active)
  useEffect(() => {
    setQueue((prevQueue) => {
      const cleanedPrev = prevQueue.filter(
        (t) =>
          t && t.source !== 'built-in' && !t.streamUrl.startsWith('synth://')
      );
      if (initialQueue.length === 0) {
        return smartAntiRepeatEnabled
          ? dedupeAndSpreadTracks(cleanedPrev, true)
          : cleanedPrev;
      }
      if (cleanedPrev.length === 0) {
        return smartAntiRepeatEnabled
          ? dedupeAndSpreadTracks(initialQueue, true)
          : initialQueue;
      }
      const byId = new Map(initialQueue.map((t) => [t.id, t]));
      const mapped = cleanedPrev.map((t) => byId.get(t.id) || t);
      return smartAntiRepeatEnabled
        ? dedupeAndSpreadTracks(mapped, true)
        : mapped;
    });
  }, [initialQueue, smartAntiRepeatEnabled]);

  const currentTrack: Track | null = queue[currentIndex] || queue[0] || null;

  // Compute current track stabilization profile (FLAC vs 240kbps MP3 leveler)
  const stabilizationProfile = computeTrackStabilizationGain(currentTrack, {
    carVolumeLeveler,
    lufsNormalizationEnabled,
    stabilizerStrength,
  });

  const getEffectiveHtmlVolume = useCallback(
    (targetTrack: Track | null = currentTrack): number => {
      if (isMuted) return 0;
      const baseVol = Math.max(0, Math.min(1, volume));
      // When routed through Web Audio DSP (blob:), HTML5 audio stays at 1.0 and masterGainNode + lufsGainNode control level
      if (sourceNodeRef.current) {
        return baseVol;
      }
      const stab = computeTrackStabilizationGain(targetTrack, {
        carVolumeLeveler,
        lufsNormalizationEnabled,
        stabilizerStrength,
      });
      return Math.max(0, Math.min(1, baseVol * stab.htmlElementScale));
    },
    [
      carVolumeLeveler,
      currentTrack,
      isMuted,
      lufsNormalizationEnabled,
      stabilizerStrength,
      volume,
    ]
  );

  const refreshVaultState = useCallback(async () => {
    const entries = await getAllVaultEntries();
    const ids = new Set<string>();
    let total = 0;
    for (const e of entries) {
      ids.add(e.trackId);
      total += e.sizeBytes || 0;
    }
    setCachedTrackIds(ids);
    setVaultTotalBytes(total);
  }, []);

  useEffect(() => {
    refreshVaultState();
  }, [refreshVaultState]);

  const bindAudioEvents = useCallback((audio: HTMLAudioElement) => {
    const syncBufferedAhead = () => {
      const ahead = computeBufferedAheadSeconds(
        getBufferedRangesFromAudio(audio),
        audio.currentTime || 0
      );
      setBufferedAheadSeconds(ahead);
      return ahead;
    };

    const handleTimeUpdate = () => {
      const nowTime = audio.currentTime || 0;
      setCurrentTime(nowTime);
      syncBufferedAhead();
    };
    const handleProgress = () => {
      syncBufferedAhead();
    };
    const handleLoadedMetadata = () => {
      if (
        audio.duration &&
        Number.isFinite(audio.duration) &&
        audio.duration > 0
      ) {
        setDuration(audio.duration);
      }
      syncBufferedAhead();
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePlaying = () => {
      isRebufferingRef.current = false;
      setIsBuffering(false);
      setIsPlaying(true);
      syncBufferedAhead();
    };
    const handlePause = () => {
      // Do not flip isPlaying to false if we paused momentarily for proactive anti-skip rebuffering
      if (!audio.ended && !isRebufferingRef.current) {
        setIsPlaying(false);
      }
    };
    const handleWaitingOrStalled = () => {
      if (
        !audio.ended &&
        audio.src &&
        !audio.src.startsWith('blob:') &&
        streamBufferSecondsRef.current > 0
      ) {
        setIsBuffering(true);
      }
    };
    const handleCanPlayThrough = () => {
      if (!isRebufferingRef.current) {
        setIsBuffering(false);
      }
      syncBufferedAhead();
    };
    const handleEnded = () => {
      isRebufferingRef.current = false;
      setIsBuffering(false);
      onEndedCallbackRef.current();
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('progress', handleProgress);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('waiting', handleWaitingOrStalled);
    audio.addEventListener('stalled', handleWaitingOrStalled);
    audio.addEventListener('canplaythrough', handleCanPlayThrough);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('progress', handleProgress);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('waiting', handleWaitingOrStalled);
      audio.removeEventListener('stalled', handleWaitingOrStalled);
      audio.removeEventListener('canplaythrough', handleCanPlayThrough);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  // Initialize HTML5 <audio> WITHOUT crossOrigin="anonymous" so remote Jellyfin streams are never blocked by CORS preflight
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;
    const unbind = bindAudioEvents(audio);
    unbindAudioEventsRef.current = unbind;

    return () => {
      if (fadeInIntervalRef.current) {
        clearInterval(fadeInIntervalRef.current);
      }
      if (nextTrackWarmupAudioRef.current) {
        try {
          nextTrackWarmupAudioRef.current.pause();
          nextTrackWarmupAudioRef.current.removeAttribute('src');
        } catch {}
      }
      audio.pause();
      unbind();
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
      }
    };
  }, [bindAudioEvents]);

  /**
   * Detaches the currently playing `<audio>` element and smoothly fades its volume down to 0
   * over `fadeSeconds` while the next track starts playing on a fresh `<audio>` deck.
   */
  const detachAndFadeOutCurrentAudio = useCallback(
    (fadeSeconds: number) => {
      const outgoing = audioRef.current;
      const outgoingBlobUrl = activeObjectUrlRef.current;
      if (!outgoing || outgoing.paused || fadeSeconds <= 0) {
        return;
      }

      if (unbindAudioEventsRef.current) {
        unbindAudioEventsRef.current();
        unbindAudioEventsRef.current = null;
      }
      audioRef.current = null;
      sourceNodeRef.current = null;
      activeObjectUrlRef.current = null;

      const startVol = outgoing.volume;
      const steps = Math.max(8, Math.round((fadeSeconds * 1000) / 60));
      let currentStep = 0;
      setIsCrossfading(true);

      const fadeTimer = setInterval(() => {
        currentStep += 1;
        const ratio = Math.max(0, 1 - currentStep / steps);
        try {
          outgoing.volume = Math.max(0, Math.min(1, startVol * ratio));
        } catch {}

        if (currentStep >= steps) {
          clearInterval(fadeTimer);
          setIsCrossfading(false);
          try {
            outgoing.pause();
            outgoing.removeAttribute('src');
            outgoing.load();
          } catch {}
          if (outgoingBlobUrl) {
            URL.revokeObjectURL(outgoingBlobUrl);
          }
        }
      }, 60);
    },
    []
  );

  /**
   * Ensures we have a clean, untainted HTMLAudioElement when streaming directly from a remote server URL.
   */
  const ensureUntaintedAudioElement = useCallback((): HTMLAudioElement => {
    const current = audioRef.current;
    if (current && !sourceNodeRef.current) {
      current.removeAttribute('crossOrigin');
      return current;
    }

    if (current) {
      if (unbindAudioEventsRef.current) {
        unbindAudioEventsRef.current();
        unbindAudioEventsRef.current = null;
      }
      try {
        current.pause();
        current.removeAttribute('src');
        current.load();
      } catch {}
    }

    sourceNodeRef.current = null;
    const freshAudio = new Audio();
    freshAudio.preload = 'auto';
    freshAudio.volume = getEffectiveHtmlVolume();
    const unbind = bindAudioEvents(freshAudio);
    unbindAudioEventsRef.current = unbind;
    audioRef.current = freshAudio;
    return freshAudio;
  }, [bindAudioEvents, getEffectiveHtmlVolume]);

  // Initialize Web Audio API Graph lazily ONLY when playing local blob:// URLs that are guaranteed same-origin
  const ensureAudioGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.src && !audio.src.startsWith('blob:')) {
      return;
    }

    if (audioCtxRef.current && sourceNodeRef.current) {
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = audioCtxRef.current || new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const source = ctx.createMediaElementSource(audio);

      // 1. Multi-Stage Loudness Stabilizer + LUFS Preamp GainNode
      const lufsGain = ctx.createGain();
      lufsGain.gain.value = stabilizationProfile.webAudioGain;

      // 2. 5-Band Graphic EQ (60Hz, 230Hz, 910Hz, 3.6kHz, 14kHz)
      const filters: BiquadFilterNode[] = EQ_FREQUENCIES.map((freq, idx) => {
        const filter = ctx.createBiquadFilter();
        if (idx === 0) {
          filter.type = 'lowshelf';
        } else if (idx === EQ_FREQUENCIES.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.value = 1.1;
        }
        filter.frequency.value = freq;
        filter.gain.value = eqGains[idx] || 0;
        return filter;
      });

      // 3. Aggressive Car Mode Volume Leveler & Brickwall Limiter (DynamicsCompressorNode)
      const compressor = ctx.createDynamicsCompressor();
      const isAggressive =
        carVolumeLeveler && stabilizerStrength === 'aggressive';
      compressor.threshold.value = carVolumeLeveler
        ? isAggressive
          ? -34
          : -24
        : 0;
      compressor.knee.value = carVolumeLeveler ? (isAggressive ? 18 : 30) : 0;
      compressor.ratio.value = carVolumeLeveler ? (isAggressive ? 16 : 12) : 1;
      compressor.attack.value = isAggressive ? 0.002 : 0.003;
      compressor.release.value = isAggressive ? 0.18 : 0.25;

      // 4. Master Volume GainNode & AnalyserNode (fftSize 128 -> 64 bins for Winamp oscilloscope + spectrum)
      const masterGain = ctx.createGain();
      masterGain.gain.value = isMuted ? 0 : volume;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.78;

      source.connect(lufsGain);
      let prevNode: AudioNode = lufsGain;
      for (const f of filters) {
        prevNode.connect(f);
        prevNode = f;
      }
      prevNode.connect(compressor);
      compressor.connect(masterGain);
      masterGain.connect(analyser);
      analyser.connect(ctx.destination);

      audioCtxRef.current = ctx;
      sourceNodeRef.current = source;
      lufsGainNodeRef.current = lufsGain;
      eqNodesRef.current = filters;
      compressorNodeRef.current = compressor;
      masterGainNodeRef.current = masterGain;
      analyserNodeRef.current = analyser;
    } catch {
      // Fallback: direct HTML5 audio playback if Web Audio API fails
    }
  }, [
    carVolumeLeveler,
    eqGains,
    isMuted,
    stabilizationProfile.webAudioGain,
    stabilizerStrength,
    volume,
  ]);

  // Sync 5-Band EQ gains to Web Audio BiquadFilterNodes
  useEffect(() => {
    const nodes = eqNodesRef.current;
    const ctx = audioCtxRef.current;
    if (!nodes.length || !ctx) return;
    nodes.forEach((node, idx) => {
      const targetGain = eqGains[idx] ?? 0;
      node.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.015);
    });
  }, [eqGains]);

  // Sync Car Mode Volume Leveler & Stabilizer Strength to DynamicsCompressorNode
  useEffect(() => {
    const comp = compressorNodeRef.current;
    const ctx = audioCtxRef.current;
    if (!comp || !ctx) return;
    if (carVolumeLeveler && stabilizerStrength !== 'off') {
      const isAggressive = stabilizerStrength === 'aggressive';
      comp.threshold.setTargetAtTime(isAggressive ? -34 : -24, ctx.currentTime, 0.02);
      comp.knee.setTargetAtTime(isAggressive ? 18 : 30, ctx.currentTime, 0.02);
      comp.ratio.setTargetAtTime(isAggressive ? 16 : 12, ctx.currentTime, 0.02);
      comp.attack.setTargetAtTime(isAggressive ? 0.002 : 0.003, ctx.currentTime, 0.01);
      comp.release.setTargetAtTime(isAggressive ? 0.18 : 0.25, ctx.currentTime, 0.02);
    } else {
      comp.threshold.setTargetAtTime(0, ctx.currentTime, 0.02);
      comp.knee.setTargetAtTime(0, ctx.currentTime, 0.02);
      comp.ratio.setTargetAtTime(1, ctx.currentTime, 0.02);
    }
  }, [carVolumeLeveler, stabilizerStrength]);

  // Sync LUFS NormalizationGain + FLAC/MP3 Stabilizer Preamp Gain
  useEffect(() => {
    const lufsNode = lufsGainNodeRef.current;
    const ctx = audioCtxRef.current;
    if (lufsNode && ctx) {
      lufsNode.gain.setTargetAtTime(
        stabilizationProfile.webAudioGain,
        ctx.currentTime,
        0.025
      );
    }
    // Also update direct HTML5 <audio> volume when not crossfading
    const audio = audioRef.current;
    if (audio && !fadeInIntervalRef.current) {
      audio.volume = getEffectiveHtmlVolume(currentTrack);
    }
  }, [
    currentTrack,
    getEffectiveHtmlVolume,
    stabilizationProfile.webAudioGain,
  ]);

  // Sync Master Volume (applies to both Web Audio graph and direct HTML5 <audio>)
  useEffect(() => {
    const audio = audioRef.current;
    const masterNode = masterGainNodeRef.current;
    const ctx = audioCtxRef.current;
    if (audio && !fadeInIntervalRef.current) {
      audio.volume = getEffectiveHtmlVolume(currentTrack);
    }
    if (masterNode && ctx && sourceNodeRef.current) {
      const effectiveVol = isMuted ? 0 : Math.max(0, Math.min(1, volume));
      masterNode.gain.setTargetAtTime(effectiveVol, ctx.currentTime, 0.015);
    }
  }, [volume, isMuted, currentTrack, getEffectiveHtmlVolume]);

  // Configurable Lookahead Preloader (2 to 12 tracks ahead) for heavy dead-zone offline areas
  // Waits 15 seconds after playback stabilizes and pauses 1.5s between downloads so it NEVER steals cellular bandwidth from the active song!
  useEffect(() => {
    if (!currentTrack || queue.length === 0 || !isPlaying) return;

    let cancelled = false;
    const maxLookahead = Math.max(2, Math.min(12, offlinePreloadCount));
    const lookaheadTracks: Track[] = [];

    // Queue up to `maxLookahead` upcoming tracks first (do not re-download the currently streaming song simultaneously)
    const countToQueue = Math.min(maxLookahead, Math.max(0, queue.length - 1));
    for (let offset = 1; offset <= countToQueue; offset++) {
      const candidate = queue[(currentIndex + offset) % queue.length];
      if (
        candidate &&
        !lookaheadTracks.some((existing) => existing.id === candidate.id)
      ) {
        lookaheadTracks.push(candidate);
      }
    }
    lookaheadTracks.push(currentTrack);

    const startTimer = setTimeout(async () => {
      for (const tr of lookaheadTracks) {
        if (cancelled || !tr) break;
        const alreadyCached = await getCachedTrackBlob(tr.id);
        if (alreadyCached) continue;

        setPreloadingTrackIds((prev) => {
          const next = new Set(prev);
          next.add(tr.id);
          return next;
        });

        try {
          await preloadTrackToVault(tr);
        } finally {
          if (!cancelled) {
            setPreloadingTrackIds((prev) => {
              const next = new Set(prev);
              next.delete(tr.id);
              return next;
            });
            await refreshVaultState();
          }
        }

        // Give the live audio stream a 1.5-second breather between background track downloads
        await new Promise((r) => setTimeout(r, 1500));
      }
    }, 15000);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
    };
  }, [
    currentTrack,
    currentIndex,
    isPlaying,
    offlinePreloadCount,
    queue,
    refreshVaultState,
  ]);

  const loadRequestIdRef = useRef<number>(0);

  /**
   * Proactive Pre-Play & Mid-Song Anti-Skip Buffer:
   * Waits until the browser has buffered `targetBufferSec` seconds of continuous audio ahead of `currentTime`
   * (or fires `canplaythrough` with a safe cushion) before starting or resuming playback on variable mobile networks.
   */
  const waitForStreamPreBuffer = useCallback(
    (audio: HTMLAudioElement, targetBufferSec: number): Promise<void> => {
      if (targetBufferSec <= 0) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearInterval(checkTimer);
          clearTimeout(maxWaitTimer);
          audio.removeEventListener('canplaythrough', handleCanPlayThrough);
          audio.removeEventListener('error', finish);
          resolve();
        };

        const hasEnoughBuffer = () => {
          const ahead = computeBufferedAheadSeconds(
            getBufferedRangesFromAudio(audio),
            audio.currentTime || 0
          );
          setBufferedAheadSeconds(ahead);
          if (ahead >= targetBufferSec) {
            return true;
          }
          // If browser signals readyState HAVE_ENOUGH_DATA (4) and at least half of target cushion is buffered
          if (
            audio.readyState >= 4 &&
            ahead >= Math.min(2.5, targetBufferSec * 0.5)
          ) {
            return true;
          }
          return false;
        };

        const handleCanPlayThrough = () => {
          if (hasEnoughBuffer() || audio.readyState >= 4) {
            finish();
          }
        };

        if (hasEnoughBuffer()) {
          resolve();
          return;
        }

        audio.addEventListener('canplaythrough', handleCanPlayThrough);
        audio.addEventListener('error', finish, { once: true });

        const checkTimer = setInterval(() => {
          if (hasEnoughBuffer()) {
            finish();
          }
        }, 80);

        // Allow up to 5.5s on variable mobile networks to build the target 6s anti-skip cushion
        const maxWaitMs = Math.min(5500, Math.max(1500, targetBufferSec * 850));
        const maxWaitTimer = setTimeout(finish, maxWaitMs);
      });
    },
    []
  );

  // Smoothly ramps in the newly started audio element when transitioning via Crossfade
  const startIncomingVolumeRamp = useCallback(
    (audio: HTMLAudioElement, targetTrack: Track, fadeSec: number) => {
      if (fadeInIntervalRef.current) {
        clearInterval(fadeInIntervalRef.current);
        fadeInIntervalRef.current = null;
      }
      const targetVol = getEffectiveHtmlVolume(targetTrack);
      if (fadeSec <= 0 || isMuted) {
        audio.volume = targetVol;
        return;
      }

      audio.volume = Math.min(targetVol, targetVol * 0.08);
      const steps = Math.max(8, Math.round((fadeSec * 1000) / 60));
      let step = 0;

      fadeInIntervalRef.current = setInterval(() => {
        step += 1;
        const ratio = Math.min(1, step / steps);
        const latestTarget = getEffectiveHtmlVolume(targetTrack);
        try {
          audio.volume = Math.max(0, Math.min(1, latestTarget * ratio));
        } catch {}
        if (step >= steps && fadeInIntervalRef.current) {
          clearInterval(fadeInIntervalRef.current);
          fadeInIntervalRef.current = null;
        }
      }, 60);
    },
    [getEffectiveHtmlVolume, isMuted]
  );

  // Load and play track from Offline Vault Blob or Multi-Candidate Progressive HTTP Stream URL
  const pendingRemoteSeekSecRef = useRef<number>(0);

  const loadAndPlayTrack = useCallback(
    async (track: Track, autoPlay: boolean, initialSeekSec = 0) => {
      const requestId = ++loadRequestIdRef.current;
      isRebufferingRef.current = false;
      const targetSeek = Math.max(
        0,
        initialSeekSec || pendingRemoteSeekSecRef.current || 0
      );
      if (autoPlay) {
        pendingRemoteSeekSecRef.current = 0;
      }

      const useCrossfade =
        autoPlay &&
        targetSeek === 0 &&
        isCrossfadeTransitionRef.current &&
        crossfadeSeconds > 0;
      isCrossfadeTransitionRef.current = false;

      if (useCrossfade) {
        detachAndFadeOutCurrentAudio(crossfadeSeconds);
      } else if (fadeInIntervalRef.current) {
        clearInterval(fadeInIntervalRef.current);
        fadeInIntervalRef.current = null;
      }

      crossfadeTriggeredForTrackRef.current = null;
      setDuration(track.duration || 180);
      setCurrentTime(targetSeek);
      setBufferedAheadSeconds(0);

      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }

      // 1. Check IndexedDB Offline Vault first
      // Uses pure hardware <audio> decoding (ensureUntaintedAudioElement) so cached tracks NEVER pass through
      // heavy Web Audio brickwall compression ("FM radio" distortion) or stutter when Google Maps is active!
      const cachedBlob = await getCachedTrackBlob(track.id);
      if (requestId !== loadRequestIdRef.current) return;

      if (cachedBlob) {
        const audio = ensureUntaintedAudioElement();
        const objUrl = URL.createObjectURL(cachedBlob);
        activeObjectUrlRef.current = objUrl;
        audio.src = objUrl;

        if (autoPlay) {
          setIsBuffering(false);
          startIncomingVolumeRamp(
            audio,
            track,
            useCrossfade ? crossfadeSeconds : 0
          );
          try {
            if (targetSeek > 0) {
              try {
                audio.currentTime = targetSeek;
              } catch {}
            }
            await audio.play();
            if (targetSeek > 0 && Math.abs((audio.currentTime || 0) - targetSeek) > 2) {
              try {
                audio.currentTime = targetSeek;
              } catch {}
            }
            setIsPlaying(true);
            return;
          } catch {
            // Cached blob was unreadable by browser decoder; purge it and fall through to direct HTTP streaming
            await removeTrackFromVault(track.id);
            await refreshVaultState();
            if (activeObjectUrlRef.current) {
              URL.revokeObjectURL(activeObjectUrlRef.current);
              activeObjectUrlRef.current = null;
            }
          }
        } else {
          audio.volume = getEffectiveHtmlVolume(track);
          if (targetSeek > 0) {
            try {
              audio.currentTime = targetSeek;
            } catch {}
          }
          return;
        }
      }

      // 2. Direct HTTP Progressive Streaming (with Proactive Pre-Play Anti-Skip Buffer & 4-stage fallback for Jellyfin/Emby)
      const audio = ensureUntaintedAudioElement();
      audio.removeAttribute('crossOrigin');

      let latestToken = '';
      let latestUserId = '';
      try {
        latestToken = localStorage.getItem('jellyfin_token') || '';
        latestUserId = localStorage.getItem('jellyfin_user_id') || '';
      } catch {}

      const candidates = buildJellyfinStreamCandidates(
        track,
        latestToken,
        latestUserId
      );

      if (candidates.length === 0) {
        setIsBuffering(false);
        setIsPlaying(false);
        return;
      }

      if (!autoPlay) {
        audio.src = candidates[0];
        audio.volume = getEffectiveHtmlVolume(track);
        return;
      }

      for (const candidateUrl of candidates) {
        if (requestId !== loadRequestIdRef.current) return;
        try {
          if (streamBufferSeconds > 0) {
            setIsBuffering(true);
          }
          audio.pause();
          audio.removeAttribute('crossOrigin');
          audio.src = candidateUrl;
          audio.load();

          // Wait for Proactive Pre-Play Anti-Skip Buffer (default 6 seconds buffered) before starting playback
          await waitForStreamPreBuffer(audio, streamBufferSeconds);
          if (requestId !== loadRequestIdRef.current) return;

          if (targetSeek > 0) {
            try {
              audio.currentTime = targetSeek;
              setCurrentTime(targetSeek);
            } catch {}
          }

          startIncomingVolumeRamp(
            audio,
            track,
            useCrossfade ? crossfadeSeconds : 0
          );
          await audio.play();
          if (targetSeek > 0 && Math.abs((audio.currentTime || 0) - targetSeek) > 2) {
            try {
              audio.currentTime = targetSeek;
            } catch {}
          }
          if (requestId === loadRequestIdRef.current) {
            setIsBuffering(false);
            setIsPlaying(true);
          }
          return;
        } catch {
          // Try next candidate stream endpoint
        }
      }

      if (requestId === loadRequestIdRef.current) {
        setIsBuffering(false);
        setIsPlaying(false);
      }
    },
    [
      crossfadeSeconds,
      detachAndFadeOutCurrentAudio,
      ensureUntaintedAudioElement,
      getEffectiveHtmlVolume,
      refreshVaultState,
      startIncomingVolumeRamp,
      streamBufferSeconds,
      waitForStreamPreBuffer,
    ]
  );

  // Proactive Mid-Song Buffer Health Monitor & Next-Track HTTP Stream Pre-Warmer:
  // 1. Monitors `bufferedAheadSeconds` every 500ms while playing over a mobile network.
  //    If the buffer cushion drops critically low (< 1.1s ahead) mid-song, proactively pauses into
  //    clean re-buffering mode until a safe cushion (up to 6s) refills, preventing rapid skipping/crackling!
  // 2. Once the current track has >= 8s buffered ahead (or is within 35s of finishing), pre-warms
  //    the next track's HTTP stream in a background `<audio preload="auto">` element.
  useEffect(() => {
    if (!isPlaying || !currentTrack) return;

    const monitorInterval = setInterval(async () => {
      const audio = audioRef.current;
      if (!audio || !audio.src || audio.ended) return;

      const isLocalBlob = audio.src.startsWith('blob:');
      const ahead = computeBufferedAheadSeconds(
        getBufferedRangesFromAudio(audio),
        audio.currentTime || 0
      );
      setBufferedAheadSeconds(ahead);

      const remaining = (audio.duration || duration) - (audio.currentTime || 0);

      // 1. Proactive Mid-Song Anti-Skip Rebuffer Check on variable cellular connections
      if (
        !isLocalBlob &&
        streamBufferSeconds > 0 &&
        !isRebufferingRef.current &&
        !isCrossfading &&
        audio.currentTime > 1.5 &&
        remaining > 4.5 &&
        (ahead < 1.1 || audio.readyState < 3)
      ) {
        isRebufferingRef.current = true;
        setIsBuffering(true);
        const activeReqId = loadRequestIdRef.current;
        try {
          audio.pause();
          const refillTarget = Math.max(
            3,
            Math.min(6, streamBufferSeconds || 6)
          );
          await waitForStreamPreBuffer(audio, refillTarget);
          if (
            activeReqId === loadRequestIdRef.current &&
            isRebufferingRef.current &&
            audioRef.current === audio
          ) {
            await audio.play();
          }
        } catch {
          // Ignore transient resume error
        } finally {
          if (activeReqId === loadRequestIdRef.current) {
            isRebufferingRef.current = false;
            setIsBuffering(false);
          }
        }
        return;
      }

      // 2. Proactive Next-Track HTTP Stream Pre-Warming
      if (
        queue.length > 1 &&
        (isLocalBlob ||
          ahead >= Math.max(8, streamBufferSeconds) ||
          remaining <= 35)
      ) {
        const nextIdx = (currentIndex + 1) % queue.length;
        const nextTrack = queue[nextIdx];
        if (
          nextTrack &&
          nextTrack.id !== currentTrack.id &&
          warmedNextTrackIdRef.current !== nextTrack.id &&
          !cachedTrackIds.has(nextTrack.id)
        ) {
          warmedNextTrackIdRef.current = nextTrack.id;
          let latestToken = '';
          let latestUserId = '';
          try {
            latestToken = localStorage.getItem('jellyfin_token') || '';
            latestUserId = localStorage.getItem('jellyfin_user_id') || '';
          } catch {}
          const nextCandidates = buildJellyfinStreamCandidates(
            nextTrack,
            latestToken,
            latestUserId
          );
          if (nextCandidates.length > 0) {
            try {
              const warmupAudio =
                nextTrackWarmupAudioRef.current || new Audio();
              warmupAudio.preload = 'auto';
              warmupAudio.muted = true;
              warmupAudio.removeAttribute('crossOrigin');
              warmupAudio.src = nextCandidates[0];
              warmupAudio.load();
              nextTrackWarmupAudioRef.current = warmupAudio;
            } catch {}
          }
        }
      }
    }, 500);

    return () => clearInterval(monitorInterval);
  }, [
    cachedTrackIds,
    currentIndex,
    currentTrack,
    duration,
    isCrossfading,
    isPlaying,
    queue,
    streamBufferSeconds,
    waitForStreamPreBuffer,
  ]);

  // Trigger Seamless Crossfade when approaching the end of a track
  useEffect(() => {
    if (
      !isPlaying ||
      !currentTrack ||
      crossfadeSeconds <= 0 ||
      duration <= crossfadeSeconds * 2 + 2
    ) {
      return;
    }

    const remaining = duration - currentTime;
    if (
      remaining <= crossfadeSeconds &&
      remaining > 0.35 &&
      crossfadeTriggeredForTrackRef.current !== currentTrack.id
    ) {
      crossfadeTriggeredForTrackRef.current = currentTrack.id;
      isCrossfadeTransitionRef.current = true;
      onEndedCallbackRef.current();
    }
  }, [currentTime, duration, isPlaying, currentTrack, crossfadeSeconds]);

  // Controls
  const togglePlayPause = useCallback(async () => {
    if (!currentTrack) return;

    const audio = audioRef.current;
    if (isPlaying) {
      isRebufferingRef.current = false;
      setIsBuffering(false);
      audio?.pause();
      setIsPlaying(false);
      return;
    }

    if (audio && audio.src && audio.currentTime > 0 && !audio.ended) {
      try {
        await audio.play();
        setIsPlaying(true);
        return;
      } catch {
        // Fall through to full reload
      }
    }

    await loadAndPlayTrack(currentTrack, true);
  }, [currentTrack, isPlaying, loadAndPlayTrack]);

  const playNext = useCallback(() => {
    if (queue.length === 0) return;

    const current = queue[currentIndex];
    if (repeatMode === 'one') {
      if (current) {
        loadAndPlayTrack(current, true);
      }
      return;
    }

    let step = 1;
    // When Smart Anti-Repeat is active, never allow a duplicate downloaded copy of the current song to play back-to-back
    if (smartAntiRepeatEnabled && current && queue.length > 1) {
      while (step < queue.length) {
        const candidateIdx = currentIndex + step;
        if (candidateIdx >= queue.length && repeatMode === 'off') {
          break;
        }
        const candidate = queue[candidateIdx % queue.length];
        if (!areTracksSameSong(current, candidate)) {
          break;
        }
        step += 1;
      }
    }

    const nextIdx = currentIndex + step;
    if (nextIdx >= queue.length && repeatMode === 'off') {
      setIsPlaying(false);
      return;
    }

    const resolvedIdx = nextIdx % queue.length;
    setCurrentIndex(resolvedIdx);
    const nextTrack = queue[resolvedIdx];
    if (nextTrack) {
      loadAndPlayTrack(nextTrack, true);
    }
  }, [
    currentIndex,
    loadAndPlayTrack,
    queue,
    repeatMode,
    smartAntiRepeatEnabled,
  ]);

  useEffect(() => {
    onEndedCallbackRef.current = playNext;
  }, [playNext]);

  const playPrevious = useCallback(() => {
    if (queue.length === 0) return;
    if (currentTime > 4) {
      const audio = audioRef.current;
      if (audio) audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const prevIdx = (currentIndex - 1 + queue.length) % queue.length;
    setCurrentIndex(prevIdx);
    const prevTrack = queue[prevIdx];
    if (prevTrack) {
      loadAndPlayTrack(prevTrack, true);
    }
  }, [currentIndex, currentTime, loadAndPlayTrack, queue]);

  const seekTo = useCallback(
    (seconds: number) => {
      const clamped = Math.max(0, Math.min(duration, seconds));
      setCurrentTime(clamped);
      if (audioRef.current) {
        try {
          audioRef.current.currentTime = clamped;
        } catch {}
      }
    },
    [duration]
  );

  const playSpecificTrack = useCallback(
    (track: Track, customQueue?: Track[]) => {
      const rawList =
        customQueue && customQueue.length > 0 ? customQueue : queue;
      // If Smart Anti-Repeat is enabled, collapse duplicate copies while ensuring the clicked `track` is preserved
      let activeList = rawList;
      if (smartAntiRepeatEnabled && rawList.length > 1) {
        const deduped = dedupeAndSpreadTracks(rawList, true);
        // Replace any canonical twin of `track` with the exact `track` the user clicked
        const twinIdx = deduped.findIndex((t) => areTracksSameSong(t, track));
        if (twinIdx >= 0) {
          deduped[twinIdx] = track;
        } else {
          deduped.unshift(track);
        }
        activeList = deduped;
      }

      if (customQueue && customQueue.length > 0) {
        setQueue(activeList);
      } else if (activeList !== queue) {
        setQueue(activeList);
      }

      const idx = activeList.findIndex((t) => t.id === track.id);
      if (idx >= 0) {
        setCurrentIndex(idx);
      } else {
        setQueue([track, ...activeList]);
        setCurrentIndex(0);
      }
      loadAndPlayTrack(track, true);
    },
    [loadAndPlayTrack, queue, smartAntiRepeatEnabled]
  );

  const queueTrackNext = useCallback(
    (track: Track) => {
      setQueue((prev) => {
        const next = [...prev];
        next.splice(currentIndex + 1, 0, track);
        return next;
      });
    },
    [currentIndex]
  );

  const toggleShuffle = useCallback(() => {
    setShuffleEnabled((prev) => {
      const nextState = !prev;
      if (nextState && queue.length > 1) {
        const current = queue[currentIndex];
        const remaining = queue.filter(
          (t, idx) =>
            idx !== currentIndex &&
            (!smartAntiRepeatEnabled || !areTracksSameSong(current, t))
        );
        const shuffled = smartAntiRepeatShuffle(
          remaining,
          smartAntiRepeatEnabled
        );
        setQueue(current ? [current, ...shuffled] : shuffled);
        setCurrentIndex(0);
      }
      return nextState;
    });
  }, [currentIndex, queue, smartAntiRepeatEnabled]);

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((prev) => {
      if (prev === 'off') return 'all';
      if (prev === 'all') return 'one';
      return 'off';
    });
  }, []);

  const applyEqPreset = useCallback((preset: Exclude<EQPresetName, 'Custom'>) => {
    setEqPreset(preset);
    setEqGains([...EQ_PRESETS[preset]]);
  }, []);

  const updateEqBand = useCallback((bandIndex: number, gainDb: number) => {
    const clamped = Math.max(-12, Math.min(12, gainDb));
    setEqPreset('Custom');
    setEqGains((prev) => {
      const next = [...prev];
      next[bandIndex] = clamped;
      return next;
    });
  }, []);

  // Persist audio preferences in localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem(
        'brokeify_audio_prefs_v1',
        JSON.stringify({
          eqPreset,
          eqGains,
          carVolumeLeveler,
          stabilizerStrength,
          lufsNormalizationEnabled,
          crossfadeSeconds,
          offlinePreloadCount,
          streamBufferSeconds,
          streamBufferUpgradedV2: true,
          smartAntiRepeatEnabled,
          shuffleEnabled,
          repeatMode,
          visualTheme,
        })
      );
    } catch {}
  }, [
    eqPreset,
    eqGains,
    carVolumeLeveler,
    stabilizerStrength,
    lufsNormalizationEnabled,
    crossfadeSeconds,
    offlinePreloadCount,
    streamBufferSeconds,
    smartAntiRepeatEnabled,
    shuffleEnabled,
    repeatMode,
    visualTheme,
  ]);

  // Restore audio preferences from Jellyfin Cloud Sync (/DisplayPreferences/brokeify)
  const restoreAudioPreferences = useCallback(
    (prefs: {
      eqPreset: EQPresetName;
      eqGains: number[];
      carVolumeLeveler: boolean;
      lufsNormalizationEnabled: boolean;
      shuffleEnabled?: boolean;
      repeatMode?: RepeatMode;
      crossfadeSeconds?: number;
      offlinePreloadCount?: number;
      stabilizerStrength?: StabilizerStrength;
      visualTheme?: VisualThemeId;
      streamBufferSeconds?: number;
      smartAntiRepeatEnabled?: boolean;
    }) => {
      if (prefs.eqPreset) setEqPreset(prefs.eqPreset);
      if (Array.isArray(prefs.eqGains) && prefs.eqGains.length === 5) {
        setEqGains([...prefs.eqGains]);
      }
      setCarVolumeLeveler(Boolean(prefs.carVolumeLeveler));
      setLufsNormalizationEnabled(Boolean(prefs.lufsNormalizationEnabled));
      if (typeof prefs.shuffleEnabled === 'boolean') {
        setShuffleEnabled(prefs.shuffleEnabled);
      }
      if (prefs.repeatMode) {
        setRepeatMode(prefs.repeatMode);
      }
      if (typeof prefs.crossfadeSeconds === 'number') {
        setCrossfadeSeconds(Math.max(0, Math.min(12, prefs.crossfadeSeconds)));
      }
      if (typeof prefs.offlinePreloadCount === 'number') {
        setOfflinePreloadCount(
          Math.max(2, Math.min(12, Math.round(prefs.offlinePreloadCount)))
        );
      }
      if (typeof prefs.streamBufferSeconds === 'number') {
        setStreamBufferSeconds(
          Math.max(0, Math.min(15, Math.round(prefs.streamBufferSeconds)))
        );
      }
      if (typeof prefs.smartAntiRepeatEnabled === 'boolean') {
        setSmartAntiRepeatEnabled(prefs.smartAntiRepeatEnabled);
      }
      if (
        prefs.stabilizerStrength === 'off' ||
        prefs.stabilizerStrength === 'normal' ||
        prefs.stabilizerStrength === 'aggressive'
      ) {
        setStabilizerStrength(prefs.stabilizerStrength);
      }
      if (isValidVisualTheme(prefs.visualTheme)) {
        setVisualTheme(prefs.visualTheme);
      }
    },
    []
  );

  // Stable refs for MediaSession action handlers so Android Auto's bottom split-screen bar (under Google Maps)
  // NEVER loses or resets its Skip Song (nexttrack) button during timeupdate ticks!
  const togglePlayPauseRef = useRef(togglePlayPause);
  const playNextRef = useRef(playNext);
  const playPreviousRef = useRef(playPrevious);
  useEffect(() => {
    togglePlayPauseRef.current = togglePlayPause;
    playNextRef.current = playNext;
    playPreviousRef.current = playPrevious;
  }, [togglePlayPause, playNext, playPrevious]);

  // 1. Register Android Auto MediaSession Transport Action Handlers ONCE (Zero thrashing!)
  // Explicitly registers nexttrack (Skip Song) and previoustrack, and clears seekforward/seekbackward/seekto
  // so Android Auto's compact bar below Google Maps ALWAYS displays Play/Pause + Skip Song (⏭)!
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    const registerHandlers = () => {
      try {
        navigator.mediaSession.setActionHandler('play', () => {
          togglePlayPauseRef.current();
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          togglePlayPauseRef.current();
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          playNextRef.current();
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          playPreviousRef.current();
        });
        // Clear all seek/scrub handlers so Android Auto's compact split-screen bar below Google Maps
        // dedicates its action slots strictly to Play/Pause and Skip Song (nexttrack)!
        try {
          navigator.mediaSession.setActionHandler('seekbackward', null);
          navigator.mediaSession.setActionHandler('seekforward', null);
          navigator.mediaSession.setActionHandler('seekto', null);
        } catch {}
      } catch {}
    };

    registerHandlers();
  }, [currentTrack?.id, isPlaying]);

  // 2. Update Android Auto MediaMetadata ONLY when the track changes (NOT 4x/sec on currentTime!)
  // Uses bitmap PNG icons so Android's native MediaNotification decoder never stalls on SVG data URIs.
  useEffect(() => {
    if (
      typeof navigator === 'undefined' ||
      !('mediaSession' in navigator) ||
      !currentTrack
    ) {
      return;
    }
    try {
      const hasHttpArtwork =
        Boolean(currentTrack.artworkUrl) &&
        /^https?:\/\//i.test(currentTrack.artworkUrl);

      const artworkList: MediaImage[] = hasHttpArtwork
        ? [
            {
              src: currentTrack.artworkUrl,
              sizes: '512x512',
              type: 'image/jpeg',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
          ]
        : [
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
          ];

      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentTrack.album,
        artwork: artworkList,
      });
    } catch {}
  }, [
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.artist,
    currentTrack?.album,
    currentTrack?.artworkUrl,
  ]);

  // 3. Update Android Auto PlaybackState ONLY when play/pause toggles
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch {}
  }, [isPlaying]);

  // Sample 24-band frequency spectrum + 64-point oscilloscope waveform for 90s/2000s visualizer
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      const analyser = analyserNodeRef.current;
      if (analyser && sourceNodeRef.current) {
        const freqBuf = new Uint8Array(analyser.frequencyBinCount);
        const timeBuf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freqBuf);
        analyser.getByteTimeDomainData(timeBuf);

        // Check if analyser has real non-zero signal
        const hasSignal = freqBuf.some((v) => v > 2);
        if (hasSignal) {
          const bars = Array.from({ length: 24 }, (_, i) => {
            const val = freqBuf[i] || 0;
            return Math.max(8, Math.round((val / 255) * 100));
          });
          const wave = Array.from({ length: 64 }, (_, i) => {
            const raw = timeBuf[i % timeBuf.length] ?? 128;
            return Number(((raw - 128) / 128).toFixed(3));
          });
          setFrequencyData(bars);
          setWaveformData(wave);
          return;
        }
      }

      // Direct HTTP stream harmonic synthesizer for visualizer when using pure hardware <audio> decoding
      const t = Date.now() / 1000;
      const bpmFactor = ((currentTrack?.bpm || 120) / 120) * 2.4;
      const bars = Array.from({ length: 24 }, (_, i) => {
        const bassPulse =
          i < 5 ? Math.pow(Math.sin(t * Math.PI * bpmFactor), 2) * 42 : 0;
        const midWave =
          Math.abs(Math.sin(t * 3.8 + i * 0.45) * Math.cos(t * 2.1 - i * 0.2)) *
          54;
        const highShimmer = i > 15 ? Math.abs(Math.sin(t * 9.5 + i)) * 28 : 10;
        return Math.max(
          10,
          Math.min(98, Math.round(14 + bassPulse + midWave + highShimmer))
        );
      });
      const wave = Array.from({ length: 64 }, (_, i) => {
        const x = (i / 64) * Math.PI * 2;
        const env = Math.sin((i / 63) * Math.PI);
        const w1 = Math.sin(x * 2 + t * 6.5) * 0.48;
        const w2 = Math.cos(x * 5 - t * 9.2) * 0.28;
        const w3 = Math.sin(x * 9 + t * 14.0) * 0.16;
        return Number(((w1 + w2 + w3) * env).toFixed(3));
      });
      setFrequencyData(bars);
      setWaveformData(wave);
    }, 65);
    return () => clearInterval(interval);
  }, [isPlaying, currentTrack?.bpm]);

  const pausePlayback = useCallback(() => {
    isRebufferingRef.current = false;
    setIsBuffering(false);
    audioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  /**
   * Cross-Device Playback Handoff:
   * Cues (or immediately plays) the track, queue, and exact timestamp (`positionSec`) from another device
   * so pressing Pause on your Phone and pressing Play on your Chromecast / TV / PC continues seamlessly!
   */
  const cueRemoteSession = useCallback(
    async (
      track: Track,
      customQueue?: Track[],
      positionSec = 0,
      autoPlay = false
    ) => {
      const nextQueue =
        customQueue && customQueue.length > 0
          ? customQueue
          : queue.length > 0
          ? queue
          : [track];

      setQueue(nextQueue);
      const idx = nextQueue.findIndex((t) => t.id === track.id);
      if (idx >= 0) {
        setCurrentIndex(idx);
      } else {
        setQueue([track, ...nextQueue]);
        setCurrentIndex(0);
      }

      const safePos = Math.max(0, Number(positionSec) || 0);
      setDuration(track.duration || 180);
      setCurrentTime(safePos);
      pendingRemoteSeekSecRef.current = safePos;

      if (autoPlay) {
        await loadAndPlayTrack(track, true, safePos);
      } else if (audioRef.current && audioRef.current.src) {
        try {
          audioRef.current.currentTime = safePos;
        } catch {}
      }
    },
    [loadAndPlayTrack, queue]
  );

  return {
    queue,
    setQueue,
    currentIndex,
    currentTrack,
    isPlaying,
    isBuffering,
    bufferedAheadSeconds,
    currentTime,
    duration,
    volume,
    setVolume,
    isMuted,
    setIsMuted,
    shuffleEnabled,
    toggleShuffle,
    repeatMode,
    cycleRepeatMode,
    carVolumeLeveler,
    setCarVolumeLeveler,
    stabilizerStrength,
    setStabilizerStrength,
    stabilizationProfile,
    lufsNormalizationEnabled,
    setLufsNormalizationEnabled,
    crossfadeSeconds,
    setCrossfadeSeconds,
    isCrossfading,
    offlinePreloadCount,
    setOfflinePreloadCount,
    streamBufferSeconds,
    setStreamBufferSeconds,
    smartAntiRepeatEnabled,
    setSmartAntiRepeatEnabled,
    eqPreset,
    eqGains,
    applyEqPreset,
    updateEqBand,
    visualTheme,
    setVisualTheme,
    restoreAudioPreferences,
    cachedTrackIds,
    preloadingTrackIds,
    vaultTotalBytes,
    refreshVaultState,
    frequencyData,
    waveformData,
    togglePlayPause,
    pausePlayback,
    cueRemoteSession,
    playNext,
    playPrevious,
    seekTo,
    playSpecificTrack,
    queueTrackNext,
  };
}
