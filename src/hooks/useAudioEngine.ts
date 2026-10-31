import { useCallback, useEffect, useRef, useState } from 'react';
import type { EQPresetName, RepeatMode, Track } from '../types/music';
import {
  EQ_FREQUENCIES,
  EQ_PRESETS,
  fisherYatesShuffle,
  lufsToLinearGain,
} from '../utils/musicLogic';
import {
  getAllVaultEntries,
  getCachedTrackBlob,
  preloadTrackToVault,
} from '../utils/offlineVault';
import { synthesizeWavBlob } from '../utils/synthWavGenerator';

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

  // Web Audio DSP State (persisted in localStorage & synced via Jellyfin /DisplayPreferences/brokeify)
  const [carVolumeLeveler, setCarVolumeLeveler] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('brokeify_audio_prefs_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.carVolumeLeveler === 'boolean') return parsed.carVolumeLeveler;
      }
    } catch {}
    return true;
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

  // IndexedDB Offline Vault & 2-Song Lookahead Preloader State
  const [cachedTrackIds, setCachedTrackIds] = useState<Set<string>>(new Set());
  const [preloadingTrackIds, setPreloadingTrackIds] = useState<Set<string>>(
    new Set()
  );
  const [vaultTotalBytes, setVaultTotalBytes] = useState<number>(0);
  const [frequencyData, setFrequencyData] = useState<number[]>(
    new Array(16).fill(12)
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const lufsGainNodeRef = useRef<GainNode | null>(null);
  const masterGainNodeRef = useRef<GainNode | null>(null);
  const eqNodesRef = useRef<BiquadFilterNode[]>([]);
  const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);

  const currentTrack: Track | null = queue[currentIndex] || queue[0] || null;

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

  // Initialize HTML5 <audio crossOrigin="anonymous">
  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
    };
    const handleLoadedMetadata = () => {
      if (audio.duration && Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
      }
    };
  }, []);

  // Initialize Web Audio API Graph lazily on user gesture / play
  const ensureAudioGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audioCtxRef.current) {
      if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaElementSource(audio);

      // 1. LUFS Normalization GainNode
      const lufsGain = ctx.createGain();
      lufsGain.gain.value = 1.0;

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

      // 3. Car Mode Volume Leveler (DynamicsCompressorNode: threshold -24, knee 30, ratio 12)
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 30;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      // 4. Master Volume GainNode & AnalyserNode
      const masterGain = ctx.createGain();
      masterGain.gain.value = isMuted ? 0 : volume;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;

      // Connect chain: source -> lufsGain -> EQ[0..4] -> compressor -> masterGain -> analyser -> destination
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
  }, [eqGains, isMuted, volume]);

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

  // Sync Car Mode Volume Leveler DynamicsCompressorNode
  useEffect(() => {
    const comp = compressorNodeRef.current;
    const ctx = audioCtxRef.current;
    if (!comp || !ctx) return;
    if (carVolumeLeveler) {
      comp.threshold.setTargetAtTime(-24, ctx.currentTime, 0.02);
      comp.knee.setTargetAtTime(30, ctx.currentTime, 0.02);
      comp.ratio.setTargetAtTime(12, ctx.currentTime, 0.02);
    } else {
      // Effectively transparent compressor when disabled
      comp.threshold.setTargetAtTime(0, ctx.currentTime, 0.02);
      comp.knee.setTargetAtTime(0, ctx.currentTime, 0.02);
      comp.ratio.setTargetAtTime(1, ctx.currentTime, 0.02);
    }
  }, [carVolumeLeveler]);

  // Sync LUFS NormalizationGain + Car Leveler makeup gain
  useEffect(() => {
    const lufsNode = lufsGainNodeRef.current;
    const ctx = audioCtxRef.current;
    if (!lufsNode || !ctx) return;
    const baseGain = lufsNormalizationEnabled
      ? lufsToLinearGain(currentTrack?.normalizationGain)
      : 1.0;
    const levelerBoost = carVolumeLeveler ? 1.22 : 1.0;
    lufsNode.gain.setTargetAtTime(
      baseGain * levelerBoost,
      ctx.currentTime,
      0.02
    );
  }, [currentTrack, lufsNormalizationEnabled, carVolumeLeveler]);

  // Sync Master Volume
  useEffect(() => {
    const audio = audioRef.current;
    const masterNode = masterGainNodeRef.current;
    const ctx = audioCtxRef.current;
    const effectiveVol = isMuted ? 0 : volume;
    if (masterNode && ctx) {
      masterNode.gain.setTargetAtTime(effectiveVol, ctx.currentTime, 0.015);
    } else if (audio) {
      audio.volume = effectiveVol;
    }
  }, [volume, isMuted]);

  // 2-Song Lookahead Preloader (Dead-Zone Proof)
  useEffect(() => {
    if (!currentTrack || queue.length === 0) return;

    let cancelled = false;
    const lookaheadTracks: Track[] = [];
    // Also ensure current track is cached in vault, plus Track N+1 and Track N+2
    lookaheadTracks.push(currentTrack);
    if (queue.length > 1) {
      lookaheadTracks.push(queue[(currentIndex + 1) % queue.length]);
    }
    if (queue.length > 2) {
      lookaheadTracks.push(queue[(currentIndex + 2) % queue.length]);
    }

    const runPreloader = async () => {
      for (const tr of lookaheadTracks) {
        if (cancelled) break;
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
      }
    };

    runPreloader();
    return () => {
      cancelled = true;
    };
  }, [currentTrack, currentIndex, queue, refreshVaultState]);

  // Load and play track from Offline Vault Blob or Stream URL
  const loadAndPlayTrack = useCallback(
    async (track: Track, autoPlay: boolean) => {
      const audio = audioRef.current;
      if (!audio) return;

      setDuration(track.duration || 180);
      setCurrentTime(0);

      // 1. Check IndexedDB Offline Vault first
      let blob = await getCachedTrackBlob(track.id);
      if (!blob && track.streamUrl.startsWith('synth://')) {
        blob = await preloadTrackToVault(track);
        await refreshVaultState();
      }

      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }

      if (blob) {
        const objUrl = URL.createObjectURL(blob);
        activeObjectUrlRef.current = objUrl;
        audio.crossOrigin = 'anonymous';
        audio.src = objUrl;
      } else {
        audio.crossOrigin = 'anonymous';
        audio.src = track.streamUrl;
      }

      if (autoPlay) {
        ensureAudioGraph();
        try {
          await audio.play();
          setIsPlaying(true);
        } catch {
          // Graceful CORS / stream fallback: synthesize local WAV proxy if remote stream fails
          const fallbackBlob = synthesizeWavBlob(
            track.id,
            track.synthRecipe || {
              bpm: 120,
              rootHz: 110,
              scaleRatios: [1, 1.2, 1.33, 1.5, 1.6],
              progression: [1, 0.8, 0.9, 1.125],
              bassPattern: [1, 1, 1.5, 1],
              padWave: 'sawtooth',
              leadWave: 'triangle',
              driveAmount: 1.25,
            },
            24
          );
          const fallbackUrl = URL.createObjectURL(fallbackBlob);
          activeObjectUrlRef.current = fallbackUrl;
          audio.src = fallbackUrl;
          try {
            await audio.play();
            setIsPlaying(true);
          } catch {
            setIsPlaying(false);
          }
        }
      }
    },
    [ensureAudioGraph, refreshVaultState]
  );

  // Trigger track load when currentIndex or currentTrack.id changes
  const lastLoadedTrackIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentTrack) return;
    if (lastLoadedTrackIdRef.current !== currentTrack.id) {
      lastLoadedTrackIdRef.current = currentTrack.id;
      loadAndPlayTrack(currentTrack, isPlaying);
    }
  }, [currentTrack, isPlaying, loadAndPlayTrack]);

  const togglePlayPause = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    ensureAudioGraph();
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      if (!audio.src) {
        await loadAndPlayTrack(currentTrack, true);
      } else {
        try {
          await audio.play();
          setIsPlaying(true);
        } catch {
          await loadAndPlayTrack(currentTrack, true);
        }
      }
    }
  }, [currentTrack, ensureAudioGraph, isPlaying, loadAndPlayTrack]);

  const playNext = useCallback(() => {
    if (queue.length === 0) return;
    const nextIdx = (currentIndex + 1) % queue.length;
    lastLoadedTrackIdRef.current = null;
    setCurrentIndex(nextIdx);
    setIsPlaying(true);
  }, [currentIndex, queue.length]);

  const playPrevious = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    if (queue.length === 0) return;
    const prevIdx = (currentIndex - 1 + queue.length) % queue.length;
    lastLoadedTrackIdRef.current = null;
    setCurrentIndex(prevIdx);
    setIsPlaying(true);
  }, [currentIndex, queue.length]);

  // Handle track ended event
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else if (repeatMode === 'all' || currentIndex < queue.length - 1) {
        playNext();
      } else {
        setIsPlaying(false);
      }
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [currentIndex, playNext, queue.length, repeatMode]);

  const seekTo = useCallback((timeSec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(audio.duration || 180, timeSec));
    audio.currentTime = clamped;
    setCurrentTime(clamped);
  }, []);

  const playSpecificTrack = useCallback(
    (track: Track, newQueue?: Track[]) => {
      const targetQueue = newQueue && newQueue.length > 0 ? newQueue : queue;
      if (newQueue && newQueue.length > 0) {
        setQueue(newQueue);
      }
      const idx = targetQueue.findIndex((t) => t.id === track.id);
      lastLoadedTrackIdRef.current = track.id;
      if (idx >= 0) {
        setCurrentIndex(idx);
      } else {
        const updated = [track, ...targetQueue];
        setQueue(updated);
        setCurrentIndex(0);
      }
      setIsPlaying(true);
      loadAndPlayTrack(track, true);
    },
    [loadAndPlayTrack, queue]
  );

  const queueTrackNext = useCallback(
    (track: Track) => {
      setQueue((prev) => {
        const copy = [...prev];
        const insertAt = Math.min(prev.length, currentIndex + 1);
        copy.splice(insertAt, 0, track);
        return copy;
      });
    },
    [currentIndex]
  );

  const toggleShuffle = useCallback(() => {
    setShuffleEnabled((prev) => {
      const nextState = !prev;
      if (nextState && queue.length > 1 && currentTrack) {
        const others = queue.filter((t) => t.id !== currentTrack.id);
        const shuffled = fisherYatesShuffle(others);
        setQueue([currentTrack, ...shuffled]);
        setCurrentIndex(0);
      }
      return nextState;
    });
  }, [currentTrack, queue]);

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((prev) =>
      prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'
    );
  }, []);

  const applyEqPreset = useCallback((preset: Exclude<EQPresetName, 'Custom'>) => {
    setEqPreset(preset);
    setEqGains([...EQ_PRESETS[preset]]);
  }, []);

  const updateEqBand = useCallback((bandIndex: number, gainDb: number) => {
    setEqPreset('Custom');
    setEqGains((prev) => {
      const copy = [...prev];
      copy[bandIndex] = Math.max(-12, Math.min(12, gainDb));
      return copy;
    });
  }, []);

  // Persist audio preferences to localStorage whenever EQ or Car Mode preferences change
  useEffect(() => {
    try {
      localStorage.setItem(
        'brokeify_audio_prefs_v1',
        JSON.stringify({
          eqPreset,
          eqGains,
          carVolumeLeveler,
          lufsNormalizationEnabled,
          shuffleEnabled,
          repeatMode,
        })
      );
    } catch {}
  }, [
    eqPreset,
    eqGains,
    carVolumeLeveler,
    lufsNormalizationEnabled,
    shuffleEnabled,
    repeatMode,
  ]);

  // Restore audio preferences pulled from Jellyfin Cloud Settings Sync (/DisplayPreferences/brokeify)
  const restoreAudioPreferences = useCallback(
    (prefs: {
      eqPreset: EQPresetName;
      eqGains: number[];
      carVolumeLeveler: boolean;
      lufsNormalizationEnabled: boolean;
      shuffleEnabled?: boolean;
      repeatMode?: RepeatMode;
    }) => {
      setEqPreset(prefs.eqPreset || 'Car Stereo');
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
    },
    []
  );

  // Bluetooth & Car Steering Wheel Controls via navigator.mediaSession
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !currentTrack) {
      return;
    }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: `${currentTrack.artist} • [${currentTrack.sourceName}]`,
        album: currentTrack.album,
        artwork: [
          {
            src: currentTrack.artworkUrl,
            sizes: '512x512',
            type: 'image/svg+xml',
          },
        ],
      });

      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

      navigator.mediaSession.setActionHandler('play', () => {
        if (!isPlaying) togglePlayPause();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (isPlaying) togglePlayPause();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        playPrevious();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        playNext();
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') {
          seekTo(details.seekTime);
        }
      });
    } catch {
      // Ignore unsupported MediaSession actions
    }
  }, [
    currentTrack,
    isPlaying,
    playNext,
    playPrevious,
    seekTo,
    togglePlayPause,
  ]);

  // Sample frequency spectrum when playing
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      const analyser = analyserNodeRef.current;
      if (analyser) {
        const buffer = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(buffer);
        const bars = Array.from({ length: 16 }, (_, i) => {
          const val = buffer[i] || 0;
          return Math.max(10, Math.round((val / 255) * 100));
        });
        setFrequencyData(bars);
      } else {
        setFrequencyData((prev) =>
          prev.map((_, i) => 20 + Math.round(Math.abs(Math.sin(Date.now() / 200 + i)) * 65))
        );
      }
    }, 150);
    return () => clearInterval(interval);
  }, [isPlaying]);

  return {
    queue,
    setQueue,
    currentIndex,
    currentTrack,
    isPlaying,
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
    lufsNormalizationEnabled,
    setLufsNormalizationEnabled,
    eqPreset,
    eqGains,
    applyEqPreset,
    updateEqBand,
    restoreAudioPreferences,
    cachedTrackIds,
    preloadingTrackIds,
    vaultTotalBytes,
    refreshVaultState,
    frequencyData,
    togglePlayPause,
    playNext,
    playPrevious,
    seekTo,
    playSpecificTrack,
    queueTrackNext,
  };
}
