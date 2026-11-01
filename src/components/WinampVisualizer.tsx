import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Sparkles, Waves } from 'lucide-react';
import type { StabilizerStrength, Track } from '../types/music';

export type WinampVisMode =
  | 'wavy-hybrid'
  | 'milkdrop-plasma'
  | 'oscilloscope'
  | 'spectrum-led';

interface WinampVisualizerProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  frequencyData: number[];
  waveformData: number[];
  crossfadeSeconds: number;
  isCrossfading?: boolean;
  stabilizerStrength: StabilizerStrength;
  carVolumeLeveler: boolean;
  compact?: boolean;
}

const VIS_MODES: Array<{ id: WinampVisMode; label: string }> = [
  { id: 'wavy-hybrid', label: 'Wavy + Peaks' },
  { id: 'milkdrop-plasma', label: 'Plasma Waves' },
  { id: 'oscilloscope', label: 'Dual Scope' },
  { id: 'spectrum-led', label: 'Classic LED' },
];

export const WinampVisualizer: React.FC<WinampVisualizerProps> = ({
  currentTrack,
  isPlaying,
  frequencyData,
  waveformData,
  crossfadeSeconds,
  isCrossfading = false,
  stabilizerStrength,
  carVolumeLeveler,
  compact = false,
}) => {
  const [visMode, setVisMode] = useState<WinampVisMode>(() => {
    try {
      const saved = localStorage.getItem('brokeify_winamp_vismode');
      if (
        saved === 'wavy-hybrid' ||
        saved === 'milkdrop-plasma' ||
        saved === 'oscilloscope' ||
        saved === 'spectrum-led'
      ) {
        return saved;
      }
    } catch {}
    return 'wavy-hybrid';
  });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const freqRef = useRef<number[]>(frequencyData);
  const waveRef = useRef<number[]>(waveformData);
  const peakCapsRef = useRef<number[]>(new Array(32).fill(10));
  const peakVelRef = useRef<number[]>(new Array(32).fill(0));
  const phaseRef = useRef<number>(0);

  useEffect(() => {
    freqRef.current = frequencyData;
  }, [frequencyData]);

  useEffect(() => {
    waveRef.current = waveformData;
  }, [waveformData]);

  const handleSelectMode = (mode: WinampVisMode) => {
    setVisMode(mode);
    try {
      localStorage.setItem('brokeify_winamp_vismode', mode);
    } catch {}
  };

  const handleCycleMode = () => {
    const idx = VIS_MODES.findIndex((m) => m.id === visMode);
    const next = VIS_MODES[(idx + 1) % VIS_MODES.length];
    handleSelectMode(next.id);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const freqs = freqRef.current;
      const wave = waveRef.current;

      // Calculate bass & mid energy for reactive wave amplitude
      const bassEnergy =
        freqs.slice(0, 6).reduce((acc, v) => acc + v, 0) /
        Math.max(1, freqs.slice(0, 6).length * 100);
      const midEnergy =
        freqs.slice(6, 16).reduce((acc, v) => acc + v, 0) /
        Math.max(1, freqs.slice(6, 16).length * 100);

      if (isPlaying) {
        phaseRef.current += 0.048 + bassEnergy * 0.045;
      } else {
        phaseRef.current += 0.008;
      }
      const phase = phaseRef.current;

      // Phosphor persistence trail background
      ctx.fillStyle =
        visMode === 'milkdrop-plasma'
          ? 'rgba(5, 8, 16, 0.24)'
          : 'rgba(6, 10, 14, 0.38)';
      ctx.fillRect(0, 0, width, height);

      // Classic Winamp / Oscilloscope CRT subtle dot/line matrix grid
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.08)';
      ctx.lineWidth = 1;
      const gridStepX = Math.max(24, Math.floor(width / 16));
      const gridStepY = Math.max(18, Math.floor(height / 6));
      ctx.beginPath();
      for (let gx = gridStepX; gx < width; gx += gridStepX) {
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, height);
      }
      for (let gy = gridStepY; gy < height; gy += gridStepY) {
        ctx.moveTo(0, gy);
        ctx.lineTo(width, gy);
      }
      ctx.stroke();

      // Draw Spectrum Bars + Falling Peak-Hold Caps (in 'wavy-hybrid' or 'spectrum-led' mode)
      if (visMode === 'wavy-hybrid' || visMode === 'spectrum-led') {
        const numBars = 24;
        const padX = 10;
        const usableW = width - padX * 2;
        const slotW = usableW / numBars;
        const barW = Math.max(4, slotW - 3);
        const maxBarH =
          visMode === 'wavy-hybrid' ? height * 0.56 : height * 0.82;

        for (let i = 0; i < numBars; i++) {
          const rawVal = isPlaying ? freqs[i % freqs.length] ?? 15 : 8;
          const norm = Math.max(0.05, Math.min(1, rawVal / 100));
          const targetH = norm * maxBarH;

          // Update falling peak-hold cap with classic Winamp gravity
          if (targetH >= peakCapsRef.current[i]) {
            peakCapsRef.current[i] = targetH;
            peakVelRef.current[i] = 0;
          } else {
            peakVelRef.current[i] += 0.16;
            peakCapsRef.current[i] = Math.max(
              4,
              peakCapsRef.current[i] - peakVelRef.current[i]
            );
          }

          const x = padX + i * slotW;
          const segHeight = 4;
          const segGap = 1.5;
          const totalSegs = Math.max(
            1,
            Math.floor(targetH / (segHeight + segGap))
          );
          const maxPossibleSegs = Math.max(
            1,
            Math.floor(maxBarH / (segHeight + segGap))
          );

          for (let s = 0; s < totalSegs; s++) {
            const ratio = s / maxPossibleSegs;
            // Classic Winamp 2.x color gradient: Emerald Green -> Cyber Lime -> Amber -> Red Peak
            if (ratio > 0.82) {
              ctx.fillStyle = '#f43f5e';
            } else if (ratio > 0.6) {
              ctx.fillStyle = '#f59e0b';
            } else if (ratio > 0.35) {
              ctx.fillStyle = '#22c55e';
            } else {
              ctx.fillStyle =
                visMode === 'wavy-hybrid'
                  ? 'rgba(16, 185, 129, 0.68)'
                  : '#10b981';
            }

            const y = height - 6 - (s + 1) * (segHeight + segGap);
            ctx.fillRect(x, y, barW, segHeight);
          }

          // Draw floating white/cyan Winamp peak-hold cap
          const capY = height - 8 - peakCapsRef.current[i];
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(x, Math.max(4, capY), barW, 2.5);
        }
      }

      // Draw Dancing Wavy Lines (in 'wavy-hybrid', 'oscilloscope', or 'milkdrop-plasma' mode)
      if (
        visMode === 'wavy-hybrid' ||
        visMode === 'oscilloscope' ||
        visMode === 'milkdrop-plasma'
      ) {
        const centerY =
          visMode === 'wavy-hybrid' ? height * 0.42 : height * 0.5;
        const ampScale = isPlaying
          ? (0.28 + bassEnergy * 0.42) * height
          : height * 0.08;

        // Wave Layer 1: Secondary XP Electric Cyan / Purple Harmonic Ribbon
        ctx.save();
        ctx.beginPath();
        ctx.lineWidth = visMode === 'milkdrop-plasma' ? 2.8 : 2.0;
        ctx.strokeStyle =
          visMode === 'milkdrop-plasma' ? '#a855f7' : '#38bdf8';
        ctx.shadowColor =
          visMode === 'milkdrop-plasma' ? '#a855f7' : '#38bdf8';
        ctx.shadowBlur = 10;

        const points = 64;
        for (let i = 0; i < points; i++) {
          const t = i / (points - 1);
          const x = t * width;
          const sample = wave[i % wave.length] || 0;
          const windowEnv = Math.sin(t * Math.PI);
          const harmonic =
            Math.sin(t * Math.PI * 5 - phase * 1.4) *
              Math.cos(t * Math.PI * 2 + phase * 0.9) *
              (0.45 + midEnergy * 0.6) +
            sample * 0.65;
          const y = centerY + harmonic * ampScale * windowEnv;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        // Wave Layer 2: Primary Winamp Phosphor Green / Neon Emerald Dancing Wave
        ctx.save();
        ctx.beginPath();
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = '#00ff66';
        ctx.shadowColor = '#10b981';
        ctx.shadowBlur = 12;

        for (let i = 0; i < points; i++) {
          const t = i / (points - 1);
          const x = t * width;
          const sample = wave[i % wave.length] || 0;
          const windowEnv = Math.sin(t * Math.PI);
          const waveOffset =
            sample * 0.9 +
            Math.sin(t * Math.PI * 3 + phase * 1.8) *
              (0.35 + bassEnergy * 0.55) +
            Math.cos(t * Math.PI * 7 - phase * 2.5) * (0.2 + midEnergy * 0.35);
          const y = centerY + waveOffset * ampScale * windowEnv;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        // Wave Layer 3: MilkDrop / Geiss Counter-Phase Amber / Cyan Plasma Ribbon
        if (visMode === 'milkdrop-plasma' || visMode === 'oscilloscope') {
          ctx.save();
          ctx.beginPath();
          ctx.lineWidth = 1.8;
          ctx.strokeStyle =
            visMode === 'milkdrop-plasma' ? '#38bdf8' : '#fbbf24';
          ctx.shadowColor =
            visMode === 'milkdrop-plasma' ? '#38bdf8' : '#f59e0b';
          ctx.shadowBlur = 9;

          for (let i = 0; i < points; i++) {
            const t = i / (points - 1);
            const x = t * width;
            const sample = wave[(points - 1 - i) % wave.length] || 0;
            const windowEnv = Math.sin(t * Math.PI);
            const lissajous =
              Math.sin(t * Math.PI * 4 - phase * 2.2) *
                Math.sin(phase * 0.7 + t * 6) *
                (0.5 + bassEnergy * 0.6) -
              sample * 0.5;
            const y = centerY + lissajous * ampScale * windowEnv;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.restore();
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, visMode]);

  const formatUpper = (currentTrack?.format || 'FLAC').toUpperCase();
  const bitrate =
    currentTrack?.bitrateKbps ||
    (formatUpper.includes('FLAC') ? 1411 : 240);
  const stabilizerBadge = !carVolumeLeveler || stabilizerStrength === 'off'
    ? 'BYPASS'
    : stabilizerStrength === 'aggressive'
    ? 'AGGRESSIVE (FLAC/MP3 LEVELER)'
    : 'STANDARD AGC';

  return (
    <div
      className={`${
        isFullscreen
          ? 'fixed inset-0 z-50 bg-[#05080c] p-4 sm:p-6 flex flex-col justify-between'
          : 'w-full'
      }`}
    >
      <div className="winamp-bezel rounded-xl overflow-hidden border border-zinc-700/90 bg-[#070b10] shadow-inner flex flex-col flex-1">
        {/* Classic 90s/2000s Metallic Stereo Deck Titlebar */}
        <div className="winamp-titlebar px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-700/80 select-none">
          <div className="flex items-center gap-2 min-w-0">
            <Waves className="w-3.5 h-3.5 text-[#00ff66] shrink-0" />
            <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-zinc-100 truncate">
              RETRO DECK // SPECTRUM &amp; SCOPE
            </span>
            {isCrossfading && (
              <span className="rounded bg-amber-500/20 border border-amber-400/50 px-1.5 py-0.5 text-[10px] font-mono font-bold text-amber-300 animate-pulse">
                CROSSFADING ({crossfadeSeconds}S)
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {VIS_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelectMode(m.id)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${
                  visMode === m.id
                    ? 'bg-[#00ff66] text-zinc-950 shadow-sm'
                    : 'bg-zinc-900/90 text-zinc-300 hover:text-white border border-zinc-700/70'
                }`}
              >
                {m.label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setIsFullscreen((prev) => !prev)}
              aria-label={
                isFullscreen
                  ? 'Exit Fullscreen Visualizer'
                  : 'Expand Fullscreen Visualizer'
              }
              title={
                isFullscreen
                  ? 'Exit Fullscreen Visualizer'
                  : 'Expand Fullscreen 90s Visualizer'
              }
              className="ml-1 p-1 rounded bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 hover:text-[#00ff66] border border-zinc-700/70 transition-colors"
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Digital Phosphor LCD Telemetry Readout Bar */}
        <div className="bg-[#04070a] border-b border-zinc-800/90 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/40 px-1.5 py-0.5 text-[#00ff66] font-bold">
              {formatUpper} · {bitrate} KBPS
            </span>
            <span className="text-sky-400 font-semibold">44.1 KHZ STEREO</span>
            <span className="text-zinc-600">|</span>
            <span className="text-amber-300">
              STABILIZER: {stabilizerBadge}
            </span>
          </div>

          <div className="flex items-center gap-2 text-zinc-400">
            <Sparkles className="w-3 h-3 text-purple-400" />
            <span>
              XFADE:{' '}
              <strong className="text-emerald-400">
                {crossfadeSeconds > 0 ? `${crossfadeSeconds}s` : 'OFF'}
              </strong>
            </span>
          </div>
        </div>

        {/* Interactive Dancing Waveform & Spectrum Canvas */}
        <div
          onClick={handleCycleMode}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCycleMode();
            }
          }}
          title="Click visualizer to cycle 90s/2000s waveform & spectrum modes"
          className="relative w-full flex-1 cursor-pointer group bg-[#04070b]"
        >
          <canvas
            ref={canvasRef}
            width={isFullscreen ? 960 : 560}
            height={isFullscreen ? 420 : compact ? 110 : 168}
            className={`w-full block ${
              isFullscreen
                ? 'h-[calc(100vh-140px)]'
                : compact
                ? 'h-28'
                : 'h-40 sm:h-44'
            }`}
          />
          <div className="pointer-events-none absolute bottom-1.5 right-2.5 rounded bg-black/70 border border-zinc-800 px-2 py-0.5 text-[10px] font-mono text-zinc-400 opacity-80 group-hover:opacity-100 group-hover:text-[#00ff66] transition-opacity">
            Click scope to switch mode ({VIS_MODES.find((m) => m.id === visMode)?.label})
          </div>
        </div>
      </div>
    </div>
  );
};
