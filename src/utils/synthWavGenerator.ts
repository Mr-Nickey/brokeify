import type { SynthRecipe } from '../types/music';

const blobMemoryCache = new Map<string, Blob>();

/**
 * Synthesizes a rich stereo 16-bit PCM WAV Blob from a SynthRecipe.
 * Used for Built-In Free Cloud / Demo tracks so they play 100% reliably
 * through HTML5 <audio>, Web Audio API EQ/Compressor, and IndexedDB Offline Vault.
 */
export function synthesizeWavBlob(
  trackId: string,
  recipe: SynthRecipe,
  durationSec = 24
): Blob {
  const cached = blobMemoryCache.get(trackId);
  if (cached) return cached;

  const sampleRate = 22050;
  const numChannels = 2;
  const numSamples = sampleRate * durationSec;
  const bytesPerSample = 2;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF WAV Header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true); // 16-bit
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const beatDur = 60 / recipe.bpm;
  const stepDur = beatDur / 4; // 16th note
  const barDur = beatDur * 4;

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const barIndex = Math.floor(t / barDur);
    const beatInBar = (t % barDur) / beatDur;
    const stepIndex = Math.floor(t / stepDur);
    const stepPhase = (t % stepDur) / stepDur;

    const chordShift =
      recipe.progression[barIndex % recipe.progression.length] || 1;
    const bassRatio =
      recipe.bassPattern[stepIndex % recipe.bassPattern.length] || 1;
    const arpRatio =
      recipe.scaleRatios[(stepIndex * 2 + barIndex) % recipe.scaleRatios.length] ||
      1;

    // 1. Sub & Punchy Bassline
    const bassFreq = recipe.rootHz * 0.5 * chordShift * bassRatio;
    const bassEnv = Math.exp(-stepPhase * 4.5);
    const bassRaw =
      Math.sin(2 * Math.PI * bassFreq * t) +
      0.5 * Math.tanh(3 * Math.sin(2 * Math.PI * bassFreq * 2 * t));
    const bassSig = bassRaw * bassEnv * 0.35;

    // 2. Lush Stereo Pad Chord
    const padFreq1 = recipe.rootHz * chordShift;
    const padFreq2 = padFreq1 * (recipe.scaleRatios[2] || 1.25);
    const padFreq3 = padFreq1 * 1.5;
    const padL =
      (Math.sin(2 * Math.PI * padFreq1 * t) +
        Math.sin(2 * Math.PI * padFreq2 * 1.003 * t) +
        Math.sin(2 * Math.PI * padFreq3 * t)) *
      0.11;
    const padR =
      (Math.sin(2 * Math.PI * padFreq1 * 0.998 * t) +
        Math.sin(2 * Math.PI * padFreq2 * t) +
        Math.sin(2 * Math.PI * padFreq3 * 1.004 * t)) *
      0.11;

    // 3. Lead Arpeggio
    const arpFreq = recipe.rootHz * 2 * chordShift * arpRatio;
    const arpEnv = Math.exp(-stepPhase * 6.5);
    const arpWave =
      recipe.leadWave === 'square'
        ? Math.sign(Math.sin(2 * Math.PI * arpFreq * t))
        : Math.sin(2 * Math.PI * arpFreq * t + Math.sin(2 * Math.PI * arpFreq * 2 * t) * 0.6);
    const arpSig = arpWave * arpEnv * 0.16;

    // 4. Kick & Snare Drum Synthesis
    const beatPhase = beatInBar % 1;
    const isKick = Math.floor(beatInBar) === 0 || Math.floor(beatInBar) === 2;
    const isSnare = Math.floor(beatInBar) === 1 || Math.floor(beatInBar) === 3;

    let drumSig = 0;
    if (isKick && beatPhase < 0.25) {
      const kEnv = Math.exp(-beatPhase * 18);
      const kFreq = 52 + 110 * Math.exp(-beatPhase * 32);
      drumSig += Math.sin(2 * Math.PI * kFreq * t) * kEnv * 0.45;
    }
    if (isSnare && beatPhase < 0.2) {
      const sEnv = Math.exp(-beatPhase * 22);
      const pseudoNoise = Math.sin(i * 12.9898) * 43758.5453;
      const noise = pseudoNoise - Math.floor(pseudoNoise) - 0.5;
      drumSig += (noise * 0.7 + Math.sin(2 * Math.PI * 180 * t) * 0.3) * sEnv * 0.28;
    }

    // Stereo Panning & Soft Clipping
    const pan = Math.sin(2 * Math.PI * 0.5 * t) * 0.35;
    const leftMix = Math.tanh(
      (bassSig + padL + arpSig * (0.7 + pan) + drumSig) * recipe.driveAmount
    );
    const rightMix = Math.tanh(
      (bassSig + padR + arpSig * (0.7 - pan) + drumSig) * recipe.driveAmount
    );

    const sampleL = Math.max(-1, Math.min(1, leftMix));
    const sampleR = Math.max(-1, Math.min(1, rightMix));

    view.setInt16(offset, sampleL * 32767, true);
    view.setInt16(offset + 2, sampleR * 32767, true);
    offset += 4;
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  blobMemoryCache.set(trackId, blob);
  return blob;
}
