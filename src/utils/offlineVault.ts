import type { Track } from '../types/music';
import { buildJellyfinStreamCandidates } from './musicLogic';
import { synthesizeWavBlob } from './synthWavGenerator';

const DB_NAME = 'brokeify-offline-vault';
const DB_VERSION = 1;
const STORE_NAME = 'tracks';

export interface VaultEntry {
  trackId: string;
  blob: Blob;
  title: string;
  artist: string;
  sizeBytes: number;
  cachedAt: number;
}

const fallbackMemoryVault = new Map<string, VaultEntry>();

function isValidAudioBlob(blob: Blob | null | undefined): blob is Blob {
  if (!blob || !(blob instanceof Blob) || blob.size < 8192) {
    return false;
  }
  const mime = (blob.type || '').toLowerCase();
  if (
    mime.includes('text/html') ||
    mime.includes('application/json') ||
    mime.includes('mpegurl') ||
    mime.includes('text/plain') ||
    mime.includes('xml')
  ) {
    return false;
  }
  return true;
}

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'trackId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getCachedTrackBlob(trackId: string): Promise<Blob | null> {
  const mem = fallbackMemoryVault.get(trackId);
  if (mem) {
    if (isValidAudioBlob(mem.blob)) {
      return mem.blob;
    }
    fallbackMemoryVault.delete(trackId);
  }

  const db = await openVaultDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(trackId);
      req.onsuccess = () => {
        const entry = req.result as VaultEntry | undefined;
        if (entry?.blob && isValidAudioBlob(entry.blob)) {
          fallbackMemoryVault.set(trackId, entry);
          resolve(entry.blob);
        } else {
          if (entry) {
            removeTrackFromVault(trackId).catch(() => {});
          }
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveTrackBlobToVault(
  track: Track,
  blob: Blob
): Promise<VaultEntry> {
  const entry: VaultEntry = {
    trackId: track.id,
    blob,
    title: track.title,
    artist: track.artist,
    sizeBytes: blob.size,
    cachedAt: Date.now(),
  };

  fallbackMemoryVault.set(track.id, entry);

  const db = await openVaultDb();
  if (!db) return entry;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(entry);
      tx.oncomplete = () => resolve(entry);
      tx.onerror = () => resolve(entry);
    } catch {
      resolve(entry);
    }
  });
}

export async function getAllVaultEntries(): Promise<VaultEntry[]> {
  const db = await openVaultDb();
  if (!db) {
    return Array.from(fallbackMemoryVault.values()).filter((e) =>
      isValidAudioBlob(e.blob)
    );
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = ((req.result as VaultEntry[]) || []).filter((e) =>
          isValidAudioBlob(e.blob)
        );
        for (const item of list) {
          fallbackMemoryVault.set(item.trackId, item);
        }
        resolve(list);
      };
      req.onerror = () =>
        resolve(
          Array.from(fallbackMemoryVault.values()).filter((e) =>
            isValidAudioBlob(e.blob)
          )
        );
    } catch {
      resolve(
        Array.from(fallbackMemoryVault.values()).filter((e) =>
          isValidAudioBlob(e.blob)
        )
      );
    }
  });
}

export async function removeTrackFromVault(trackId: string): Promise<void> {
  fallbackMemoryVault.delete(trackId);
  const db = await openVaultDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(trackId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearOfflineVault(): Promise<void> {
  fallbackMemoryVault.clear();
  const db = await openVaultDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Fetches the full audio Blob for a track and stores it in `brokeify-offline-vault`.
 * Validates that responses are genuine audio streams and never caches HTML/JSON/HLS manifests.
 */
export async function preloadTrackToVault(track: Track): Promise<Blob | null> {
  const existing = await getCachedTrackBlob(track.id);
  if (existing) return existing;

  const defaultRecipe = track.synthRecipe || {
    bpm: 118,
    rootHz: 110,
    scaleRatios: [1, 1.2, 1.33, 1.5, 1.6],
    progression: [1, 0.8, 0.9, 1.125],
    bassPattern: [1, 1, 1.5, 1],
    padWave: 'sawtooth' as const,
    leadWave: 'triangle' as const,
    driveAmount: 1.2,
  };

  if (track.streamUrl.startsWith('synth://')) {
    const blob = synthesizeWavBlob(track.id, defaultRecipe, 24);
    await saveTrackBlobToVault(track, blob);
    return blob;
  }

  let savedToken = '';
  let savedUserId = '';
  try {
    savedToken = (localStorage.getItem('jellyfin_token') ?? '').trim();
    savedUserId = (localStorage.getItem('jellyfin_user_id') ?? '').trim();
  } catch {
    // ignore
  }

  const candidateUrls = buildJellyfinStreamCandidates(
    track,
    savedToken,
    savedUserId
  );

  for (const url of candidateUrls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, {
        signal: controller.signal,
        mode: 'cors',
      });
      clearTimeout(timer);
      if (response.ok) {
        const contentType = (
          response.headers.get('content-type') || ''
        ).toLowerCase();
        if (
          contentType.includes('text/html') ||
          contentType.includes('application/json') ||
          contentType.includes('mpegurl')
        ) {
          continue;
        }
        const blob = await response.blob();
        if (isValidAudioBlob(blob)) {
          await saveTrackBlobToVault(track, blob);
          return blob;
        }
      }
    } catch {
      // Try next candidate URL
    }
  }

  return null;
}
