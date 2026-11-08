import React, { useEffect, useState } from 'react';
import { createAlbumArtworkDataUri } from './artworkGenerator';

export const ARTWORK_CACHE_DB_NAME = 'brokeify-artwork-cache';
export const ARTWORK_CACHE_STORE_NAME = 'artwork';
export const ARTWORK_CACHE_DB_VERSION = 1;

export interface ArtworkCacheEntry {
  url: string;
  blob: Blob;
  sizeBytes: number;
  cachedAt: number;
  mimeType: string;
}

// In-memory instant lookup for sub-millisecond synchronous rendering during fast scroll
const memoryObjectUrlMap = new Map<string, string>();
const inFlightRequests = new Map<string, Promise<string | null>>();

function isValidImageBlob(blob: Blob | null | undefined): blob is Blob {
  if (!blob || !(blob instanceof Blob) || blob.size < 64) {
    return false;
  }
  const type = (blob.type || '').toLowerCase();
  // Ensure not HTML or error JSON
  if (
    type.includes('text/html') ||
    type.includes('application/json') ||
    type.includes('text/plain')
  ) {
    return false;
  }
  return true;
}

/**
 * Opens or initializes the 'brokeify-artwork-cache' IndexedDB store.
 */
export function openArtworkCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(ARTWORK_CACHE_DB_NAME, ARTWORK_CACHE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ARTWORK_CACHE_STORE_NAME)) {
          db.createObjectStore(ARTWORK_CACHE_STORE_NAME, { keyPath: 'url' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Retrieves a cached artwork Object URL from memory or 'brokeify-artwork-cache' IndexedDB store.
 */
export async function getCachedArtworkUrl(url: string): Promise<string | null> {
  const trimmed = String(url || '').trim();
  if (!trimmed) return null;

  // If already a data URI or local blob, no caching needed
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  // 1. Instant in-memory check
  const memUrl = memoryObjectUrlMap.get(trimmed);
  if (memUrl) return memUrl;

  // 2. Query IndexedDB 'brokeify-artwork-cache'
  const db = await openArtworkCacheDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ARTWORK_CACHE_STORE_NAME, 'readonly');
      const store = tx.objectStore(ARTWORK_CACHE_STORE_NAME);
      const req = store.get(trimmed);

      req.onsuccess = () => {
        const entry = req.result as ArtworkCacheEntry | undefined;
        if (entry?.blob && isValidImageBlob(entry.blob)) {
          try {
            const objectUrl = URL.createObjectURL(entry.blob);
            memoryObjectUrlMap.set(trimmed, objectUrl);
            resolve(objectUrl);
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };

      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Stores an artwork Blob in the 'brokeify-artwork-cache' IndexedDB store.
 */
export async function saveArtworkBlobToCache(
  url: string,
  blob: Blob
): Promise<string | null> {
  const trimmed = String(url || '').trim();
  if (!trimmed || !isValidImageBlob(blob)) return null;

  let objectUrl: string | null = null;
  try {
    objectUrl = URL.createObjectURL(blob);
    memoryObjectUrlMap.set(trimmed, objectUrl);
  } catch {
    // ignore object url creation failure
  }

  const db = await openArtworkCacheDb();
  if (!db) return objectUrl;

  const entry: ArtworkCacheEntry = {
    url: trimmed,
    blob,
    sizeBytes: blob.size,
    cachedAt: Date.now(),
    mimeType: blob.type || 'image/jpeg',
  };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ARTWORK_CACHE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(ARTWORK_CACHE_STORE_NAME);
      const req = store.put(entry);

      req.onsuccess = () => resolve(objectUrl);
      req.onerror = () => resolve(objectUrl);
    } catch {
      resolve(objectUrl);
    }
  });
}

/**
 * Fetches an image from network, caches it in 'brokeify-artwork-cache' IndexedDB, and returns a local object URL.
 * Deduplicates concurrent requests for the exact same artwork URL.
 */
export async function fetchAndCacheArtwork(url: string): Promise<string | null> {
  const trimmed = String(url || '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  // Check if already in cache
  const existing = await getCachedArtworkUrl(trimmed);
  if (existing) return existing;

  // Deduplicate in-flight network requests
  const inflight = inFlightRequests.get(trimmed);
  if (inflight) return inflight;

  const fetchPromise = (async () => {
    try {
      const resp = await fetch(trimmed, {
        mode: 'cors',
        credentials: 'omit',
        signal: AbortSignal.timeout(9000),
      });

      if (!resp.ok) return null;
      const blob = await resp.blob();
      if (!isValidImageBlob(blob)) return null;

      return await saveArtworkBlobToCache(trimmed, blob);
    } catch {
      return null;
    } finally {
      inFlightRequests.delete(trimmed);
    }
  })();

  inFlightRequests.set(trimmed, fetchPromise);
  return fetchPromise;
}

/**
 * Background preloader for a batch of artwork URLs to accelerate library scrolling.
 */
export async function preloadArtworkBatch(
  urls: readonly (string | undefined)[],
  maxConcurrent = 6
): Promise<void> {
  const validUrls = Array.from(
    new Set(
      urls
        .map((u) => String(u || '').trim())
        .filter((u) => Boolean(u) && /^https?:\/\//i.test(u))
    )
  );

  for (let i = 0; i < validUrls.length; i += maxConcurrent) {
    const chunk = validUrls.slice(i, i + maxConcurrent);
    await Promise.allSettled(chunk.map((u) => fetchAndCacheArtwork(u)));
  }
}

/**
 * Returns disk usage statistics for the 'brokeify-artwork-cache' IndexedDB store.
 */
export async function getArtworkCacheStats(): Promise<{
  count: number;
  totalSizeBytes: number;
}> {
  const db = await openArtworkCacheDb();
  if (!db) {
    return { count: memoryObjectUrlMap.size, totalSizeBytes: 0 };
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ARTWORK_CACHE_STORE_NAME, 'readonly');
      const store = tx.objectStore(ARTWORK_CACHE_STORE_NAME);
      const req = store.openCursor();
      let count = 0;
      let totalSizeBytes = 0;

      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          count++;
          const entry = cursor.value as ArtworkCacheEntry;
          totalSizeBytes += entry?.sizeBytes || 0;
          cursor.continue();
        } else {
          resolve({ count, totalSizeBytes });
        }
      };

      req.onerror = () => resolve({ count: 0, totalSizeBytes: 0 });
    } catch {
      resolve({ count: 0, totalSizeBytes: 0 });
    }
  });
}

/**
 * Clears the 'brokeify-artwork-cache' IndexedDB store and revokes all active memory Object URLs.
 */
export async function clearArtworkCache(): Promise<boolean> {
  // Revoke memory URLs to free browser memory
  for (const objUrl of memoryObjectUrlMap.values()) {
    try {
      URL.revokeObjectURL(objUrl);
    } catch {
      // ignore
    }
  }
  memoryObjectUrlMap.clear();

  const db = await openArtworkCacheDb();
  if (!db) return true;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ARTWORK_CACHE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(ARTWORK_CACHE_STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * React Hook that manages cached artwork URL from 'brokeify-artwork-cache'.
 */
export function useCachedArtwork(
  rawUrl?: string,
  options?: {
    fallbackTitle?: string;
    fallbackArtist?: string;
    fallbackAccent?: string;
  }
): {
  artworkSrc: string;
  isCached: boolean;
  isLoading: boolean;
} {
  const trimmed = String(rawUrl || '').trim();
  const fallback =
    trimmed ||
    createAlbumArtworkDataUri(
      options?.fallbackTitle || 'Unknown Track',
      options?.fallbackArtist || 'Brokeify',
      options?.fallbackAccent || '#10b981',
      '#09090b'
    );

  const [artworkSrc, setArtworkSrc] = useState<string>(() => {
    if (!trimmed) return fallback;
    const mem = memoryObjectUrlMap.get(trimmed);
    return mem || trimmed;
  });
  const [isCached, setIsCached] = useState<boolean>(() =>
    Boolean(trimmed && memoryObjectUrlMap.has(trimmed))
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
      setArtworkSrc(trimmed || fallback);
      setIsCached(false);
      return;
    }

    const mem = memoryObjectUrlMap.get(trimmed);
    if (mem) {
      setArtworkSrc(mem);
      setIsCached(true);
      return;
    }

    let active = true;
    setIsLoading(true);

    getCachedArtworkUrl(trimmed).then((cached) => {
      if (!active) return;
      if (cached) {
        setArtworkSrc(cached);
        setIsCached(true);
        setIsLoading(false);
      } else {
        // Asynchronously fetch and cache into IndexedDB in background
        fetchAndCacheArtwork(trimmed)
          .then((newlyCached) => {
            if (!active) return;
            if (newlyCached) {
              setArtworkSrc(newlyCached);
              setIsCached(true);
            } else {
              setArtworkSrc(trimmed);
            }
          })
          .catch(() => {
            if (active) setArtworkSrc(trimmed);
          })
          .finally(() => {
            if (active) setIsLoading(false);
          });
      }
    });

    return () => {
      active = false;
    };
  }, [trimmed]);

  return { artworkSrc, isCached, isLoading };
}

export interface CachedArtworkImageProps
  extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string;
  fallbackTitle?: string;
  fallbackArtist?: string;
  fallbackAccent?: string;
}

/**
 * Drop-in <CachedArtworkImage /> component that uses 'brokeify-artwork-cache' IndexedDB store.
 * Automatically serves cached blobs and falls back smoothly to SVG generator on network errors.
 */
export const CachedArtworkImage: React.FC<CachedArtworkImageProps> = ({
  src,
  alt = 'Album Artwork',
  fallbackTitle = 'Brokeify Track',
  fallbackArtist = 'Music',
  fallbackAccent = '#10b981',
  className = 'w-10 h-10 rounded-lg object-cover',
  ...props
}) => {
  const { artworkSrc } = useCachedArtwork(src, {
    fallbackTitle,
    fallbackArtist,
    fallbackAccent,
  });

  const generateFallback = () =>
    createAlbumArtworkDataUri(
      fallbackTitle,
      fallbackArtist,
      fallbackAccent,
      '#09090b'
    );

  return (
    <img
      src={artworkSrc || generateFallback()}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={(e) => {
        e.currentTarget.onerror = null;
        e.currentTarget.src = generateFallback();
      }}
      className={className}
      {...props}
    />
  );
};
