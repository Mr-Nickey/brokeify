import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import Database from 'better-sqlite3';
import chokidar, { type FSWatcher } from 'chokidar';
import { parseFile } from 'music-metadata';
import type { Request, Response } from 'express';

// ============================================================================
// 1. PERSISTENT PATHS (/data/brokeify.db, /data/covers, /music)
// ============================================================================

function resolveWritableDir(preferredPaths: string[]): string {
  for (const candidate of preferredPaths) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {
      // Try next candidate
    }
  }
  const fallback = path.resolve(process.cwd(), 'data');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

export const DATA_DIR = resolveWritableDir([
  process.env.BROKEIFY_DATA_DIR || '/data',
  '/app/data',
  path.resolve(process.cwd(), 'data'),
]);

export const COVERS_DIR = path.join(DATA_DIR, 'covers');
try {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
} catch {}

export const DB_PATH =
  process.env.BROKEIFY_DB_PATH || path.join(DATA_DIR, 'brokeify.db');

export let MUSIC_DIR = resolveWritableDir([
  process.env.BROKEIFY_MUSIC_DIR || '/music',
  '/app/downloads',
  path.resolve(process.cwd(), 'music'),
]);

export function getMusicDir(): string {
  return MUSIC_DIR;
}

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  '.flac',
  '.mp3',
  '.ogg',
  '.opus',
  '.m4a',
  '.wav',
  '.aac',
]);

const SUPPORTED_PLAYLIST_EXTENSIONS = new Set(['.m3u', '.m3u8']);

const COVER_FILENAMES = [
  'cover.jpg',
  'cover.jpeg',
  'cover.png',
  'cover.webp',
  'folder.jpg',
  'folder.jpeg',
  'folder.png',
  'front.jpg',
  'front.png',
  'album.jpg',
];

function sha1Id(prefix: string, input: string): string {
  const hash = crypto
    .createHash('sha1')
    .update(input.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
  return `${prefix}-${hash}`;
}

function toSortName(name: string): string {
  const trimmed = name.trim();
  if (/^the\s+/i.test(trimmed)) {
    return `${trimmed.slice(4)}, The`;
  }
  return trimmed;
}

// ============================================================================
// 2. EMBEDDED SQLITE DATABASE INITIALIZATION (better-sqlite3)
//    Runs on container-local Linux disk (/tmp/brokeify-runtime.db) with
//    mmap_size=0 and journal_mode=DELETE, syncing to /data/brokeify.db.
//    This prevents SIGSEGV (exit code 139) when /data is bind-mounted from
//    Windows NTFS (C:/...), WSL2 9P, or SMB/NFS network shares.
// ============================================================================

const RUNTIME_DB_PATH = path.join('/tmp', 'brokeify-runtime.db');

function initializeSafeSqliteDatabase(): Database.Database {
  // 1. Clean up any stale WAL/SHM files left by older crashes on Windows mounts
  for (const staleFile of [
    `${DB_PATH}-shm`,
    `${DB_PATH}-wal`,
    `${RUNTIME_DB_PATH}-shm`,
    `${RUNTIME_DB_PATH}-wal`,
  ]) {
    try {
      if (fs.existsSync(staleFile)) {
        fs.unlinkSync(staleFile);
      }
    } catch {}
  }

  // 2. If a persistent /data/brokeify.db already exists, copy it into /tmp/brokeify-runtime.db
  try {
    if (fs.existsSync(DB_PATH)) {
      const stat = fs.statSync(DB_PATH);
      if (stat.isFile() && stat.size > 0) {
        fs.copyFileSync(DB_PATH, RUNTIME_DB_PATH);
      }
    }
  } catch (err) {
    console.warn(
      '[Brokeify SQLite] Could not copy existing DB from /data, starting fresh runtime DB:',
      err
    );
  }

  // 3. Open SQLite on container-local /tmp (or in-memory fallback if /tmp fails)
  let instance: Database.Database;
  try {
    instance = new Database(RUNTIME_DB_PATH);
  } catch (err) {
    console.warn(
      '[Brokeify SQLite] Failed opening runtime DB file, falling back to in-memory SQLite:',
      err
    );
    instance = new Database(':memory:');
  }

  try {
    instance.pragma('mmap_size = 0');
    instance.pragma('journal_mode = DELETE');
    instance.pragma('synchronous = NORMAL');
    instance.pragma('foreign_keys = ON');
  } catch (err) {
    console.warn('[Brokeify SQLite] Pragma warning:', err);
  }

  return instance;
}

export const db = initializeSafeSqliteDatabase();

let syncDbTimer: ReturnType<typeof setTimeout> | null = null;

export function syncDatabaseToPersistentDisk(immediate = false): void {
  const performSync = () => {
    syncDbTimer = null;
    try {
      if (fs.existsSync(RUNTIME_DB_PATH)) {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
        const tempTarget = `${DB_PATH}.tmp`;
        fs.copyFileSync(RUNTIME_DB_PATH, tempTarget);
        fs.renameSync(tempTarget, DB_PATH);
      }
    } catch {
      try {
        if (fs.existsSync(RUNTIME_DB_PATH)) {
          fs.copyFileSync(RUNTIME_DB_PATH, DB_PATH);
        }
      } catch {}
    }
  };

  if (immediate) {
    if (syncDbTimer) clearTimeout(syncDbTimer);
    performSync();
    return;
  }

  if (!syncDbTimer) {
    syncDbTimer = setTimeout(performSync, 2500);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_name TEXT,
    musicbrainz_id TEXT,
    image_url TEXT
  );

  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    artist_id TEXT,
    title TEXT NOT NULL,
    year INTEGER,
    genre TEXT,
    cover_path TEXT,
    musicbrainz_id TEXT,
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    album_id TEXT,
    artist_id TEXT,
    title TEXT NOT NULL,
    track_number INTEGER,
    disc_number INTEGER,
    duration_ms INTEGER,
    file_path TEXT UNIQUE NOT NULL,
    format TEXT,
    bitrate INTEGER,
    sample_rate INTEGER,
    loudness_lufs REAL,
    replaygain_track_gain REAL,
    play_count INTEGER DEFAULT 0,
    last_played_at TEXT,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE SET NULL,
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    cover_path TEXT,
    is_smart INTEGER DEFAULT 0,
    smart_rules_json TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, position),
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS scrobbles (
    id TEXT PRIMARY KEY,
    track_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    synced_listenbrainz INTEGER DEFAULT 0,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);
  CREATE INDEX IF NOT EXISTS idx_artists_sort_name ON artists(sort_name);
  CREATE INDEX IF NOT EXISTS idx_albums_artist_id ON albums(artist_id);
  CREATE INDEX IF NOT EXISTS idx_albums_title ON albums(title);
  CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id);
  CREATE INDEX IF NOT EXISTS idx_tracks_artist_id ON tracks(artist_id);
  CREATE INDEX IF NOT EXISTS idx_tracks_file_path ON tracks(file_path);
  CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position);
  CREATE INDEX IF NOT EXISTS idx_scrobbles_track_id ON scrobbles(track_id);
  CREATE INDEX IF NOT EXISTS idx_scrobbles_timestamp ON scrobbles(timestamp);
`);

syncDatabaseToPersistentDisk(true);

// ============================================================================
// 3. EBU R128 LUFS BACKGROUND NORMALIZATION ENGINE (ffmpeg)
// ============================================================================

interface LufsJob {
  trackId: string;
  filePath: string;
}

const lufsQueue: LufsJob[] = [];
const queuedTrackIds = new Set<string>();
let isProcessingLufs = false;

export const scannerState = {
  isScanning: false,
  lastScanAt: null as string | null,
  scannedFilesCount: 0,
  lufsQueueLength: 0,
  currentLufsTrack: null as string | null,
};

export function enqueueTrackForLufsAnalysis(trackId: string, filePath: string) {
  if (queuedTrackIds.has(trackId)) return;
  queuedTrackIds.add(trackId);
  lufsQueue.push({ trackId, filePath });
  scannerState.lufsQueueLength = lufsQueue.length;
  processNextLufsJob();
}

function analyzeFileEbuR128(
  filePath: string
): Promise<{ loudnessLufs: number; replaygainDb: number } | null> {
  return new Promise((resolve) => {
    execFile(
      'ffmpeg',
      ['-nostats', '-i', filePath, '-af', 'ebur128=framelog=verbose', '-f', 'null', '-'],
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
      (_err, stdout, stderr) => {
        const combined = `${stdout || ''}\n${stderr || ''}`;
        // Match the final Summary "I:         -14.2 LUFS"
        const matches = [...combined.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/gi)];
        if (matches.length === 0) {
          resolve(null);
          return;
        }
        const lastMatch = matches[matches.length - 1];
        const lufs = parseFloat(lastMatch[1]);
        if (!Number.isFinite(lufs) || lufs < -70 || lufs > 5) {
          resolve(null);
          return;
        }
        // Standard target is -14.0 LUFS
        const rawGain = -14.0 - lufs;
        const clampedGain = Math.max(-15, Math.min(12, Number(rawGain.toFixed(2))));
        resolve({
          loudnessLufs: Number(lufs.toFixed(2)),
          replaygainDb: clampedGain,
        });
      }
    );
  });
}

async function processNextLufsJob() {
  if (isProcessingLufs || lufsQueue.length === 0) return;
  isProcessingLufs = true;

  while (lufsQueue.length > 0) {
    const job = lufsQueue.shift()!;
    queuedTrackIds.delete(job.trackId);
    scannerState.lufsQueueLength = lufsQueue.length;
    scannerState.currentLufsTrack = path.basename(job.filePath);

    try {
      if (fs.existsSync(job.filePath)) {
        const result = await analyzeFileEbuR128(job.filePath);
        if (result) {
          db.prepare(
            `UPDATE tracks SET loudness_lufs = ?, replaygain_track_gain = ? WHERE id = ?`
          ).run(result.loudnessLufs, result.replaygainDb, job.trackId);
        }
      }
    } catch {
      // Non-fatal if ffmpeg is unavailable or file is unreadable
    }
  }

  scannerState.currentLufsTrack = null;
  scannerState.lufsQueueLength = 0;
  isProcessingLufs = false;
}

// ============================================================================
// 4. MUSIC SCANNER, TAG PARSER & AUTOMATIC M3U PLAYLIST IMPORTER
// ============================================================================

function parseFallbackFromFilePath(filePath: string): {
  artist: string;
  album: string;
  title: string;
  trackNumber: number;
  year: number | null;
} {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext).trim();
  const parentDir = path.basename(path.dirname(filePath)).trim();
  const grandParentDir = path.basename(path.dirname(path.dirname(filePath))).trim();

  let title = base;
  let artist = 'Unknown Artist';
  let album =
    parentDir && parentDir !== 'music' && parentDir !== 'downloads'
      ? parentDir
      : 'Singles';
  let trackNumber = 1;
  let year: number | null = null;

  const yearMatch = album.match(/\((\d{4})\)/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
    album = album.replace(/\s*\(\d{4}\)\s*/, '').trim() || album;
  }

  if (
    grandParentDir &&
    grandParentDir !== 'music' &&
    grandParentDir !== 'downloads' &&
    grandParentDir !== '/' &&
    grandParentDir !== '.'
  ) {
    artist = grandParentDir;
  }

  // Check if filename starts with track number e.g. "01 - Title" or "01. Title"
  const numPrefix = base.match(/^(\d{1,3})\s*[-._]\s*(.+)$/);
  if (numPrefix) {
    trackNumber = parseInt(numPrefix[1], 10);
    title = numPrefix[2].trim();
  }

  // Check if title has "Artist - Title"
  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    if (parts.length >= 2) {
      if (artist === 'Unknown Artist') {
        artist = parts[0].trim();
      }
      title = parts.slice(1).join(' - ').trim();
    }
  }

  return { artist, album, title, trackNumber, year };
}

export async function indexAudioFile(filePath: string): Promise<string | null> {
  try {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) return null;

    const ext = path.extname(resolvedPath).toLowerCase();
    if (!SUPPORTED_AUDIO_EXTENSIONS.has(ext)) return null;

    const fallback = parseFallbackFromFilePath(resolvedPath);

    let title = fallback.title;
    let artist = fallback.artist;
    let album = fallback.album;
    let year: number | null = fallback.year;
    let genre = 'Music';
    let trackNumber = fallback.trackNumber;
    let discNumber = 1;
    let durationMs = 180000;
    let format = ext.replace('.', '').toUpperCase();
    let bitrate = 320;
    let sampleRate = 44100;
    let replayGainDb: number | null = null;
    let embeddedPicture: { data: Uint8Array; format?: string } | null = null;
    let mbTrackId: string | null = null;
    let mbAlbumId: string | null = null;
    let mbArtistId: string | null = null;

    try {
      const metadata = await parseFile(resolvedPath, { duration: true });
      const c = metadata.common;
      const f = metadata.format;

      if (c.title?.trim()) title = c.title.trim();
      if (c.artist?.trim() || c.albumartist?.trim()) {
        artist = (c.artist || c.albumartist || fallback.artist).trim();
      }
      if (c.album?.trim()) album = c.album.trim();
      if (c.year) year = c.year;
      if (Array.isArray(c.genre) && c.genre[0]?.trim()) {
        genre = c.genre[0].trim();
      }
      if (c.track?.no) trackNumber = Number(c.track.no) || trackNumber;
      if (c.disk?.no) discNumber = Number(c.disk.no) || 1;
      if (f.duration && f.duration > 0) {
        durationMs = Math.round(f.duration * 1000);
      }
      if (f.bitrate && f.bitrate > 0) {
        bitrate = Math.round(f.bitrate / 1000);
      }
      if (f.sampleRate && f.sampleRate > 0) {
        sampleRate = f.sampleRate;
      }
      if (f.codec) {
        const upperCodec = f.codec.toUpperCase();
        if (upperCodec.includes('FLAC')) {
          const bits = f.bitsPerSample || 16;
          const khz = Math.round(sampleRate / 1000);
          format = `FLAC ${khz}/${bits}`;
        } else if (upperCodec.includes('MP3') || upperCodec.includes('MPEG')) {
          format = 'MP3';
        } else if (upperCodec.includes('OPUS')) {
          format = 'OPUS';
        } else if (upperCodec.includes('VORBIS')) {
          format = 'OGG';
        } else if (upperCodec.includes('AAC') || upperCodec.includes('ALAC')) {
          format = upperCodec.includes('ALAC') ? 'ALAC' : 'AAC';
        } else if (upperCodec.includes('PCM') || ext === '.wav') {
          format = 'WAV';
        }
      }
      if (typeof c.replaygain_track_gain?.dB === 'number') {
        replayGainDb = Number(c.replaygain_track_gain.dB.toFixed(2));
      }
      if (c.picture && c.picture.length > 0 && c.picture[0].data) {
        embeddedPicture = {
          data: c.picture[0].data,
          format: c.picture[0].format,
        };
      }
      if (c.musicbrainz_recordingid) mbTrackId = c.musicbrainz_recordingid;
      if (c.musicbrainz_albumid) mbAlbumId = c.musicbrainz_albumid;
      if (Array.isArray(c.musicbrainz_artistid) && c.musicbrainz_artistid[0]) {
        mbArtistId = c.musicbrainz_artistid[0];
      }
    } catch {
      // Fallback metadata from path already populated
    }

    const artistId = sha1Id('art', artist);
    const albumId = sha1Id('alb', `${artist}::${album}`);
    const trackId = sha1Id('trk', resolvedPath);

    // Extract or locate cover art -> /data/covers/{album_id}.jpg
    const targetCoverPath = path.join(COVERS_DIR, `${albumId}.jpg`);
    let finalCoverPath: string | null = fs.existsSync(targetCoverPath)
      ? targetCoverPath
      : null;

    if (!finalCoverPath && embeddedPicture && embeddedPicture.data.length > 32) {
      try {
        fs.writeFileSync(targetCoverPath, Buffer.from(embeddedPicture.data));
        finalCoverPath = targetCoverPath;
      } catch {}
    }

    if (!finalCoverPath) {
      // Check directory for cover.jpg / folder.jpg
      const trackDir = path.dirname(resolvedPath);
      for (const candidateName of COVER_FILENAMES) {
        const candidateFile = path.join(trackDir, candidateName);
        if (fs.existsSync(candidateFile)) {
          try {
            fs.copyFileSync(candidateFile, targetCoverPath);
            finalCoverPath = targetCoverPath;
            break;
          } catch {}
        }
      }
    }

    // Upsert Artist
    db.prepare(
      `INSERT INTO artists (id, name, sort_name, musicbrainz_id, image_url)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         sort_name = excluded.sort_name,
         musicbrainz_id = COALESCE(excluded.musicbrainz_id, artists.musicbrainz_id),
         image_url = COALESCE(excluded.image_url, artists.image_url)`
    ).run(
      artistId,
      artist,
      toSortName(artist),
      mbArtistId,
      `/api/cover/artist/${artistId}`
    );

    // Upsert Album
    db.prepare(
      `INSERT INTO albums (id, artist_id, title, year, genre, cover_path, musicbrainz_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         artist_id = excluded.artist_id,
         title = excluded.title,
         year = COALESCE(excluded.year, albums.year),
         genre = COALESCE(excluded.genre, albums.genre),
         cover_path = COALESCE(excluded.cover_path, albums.cover_path),
         musicbrainz_id = COALESCE(excluded.musicbrainz_id, albums.musicbrainz_id)`
    ).run(albumId, artistId, album, year, genre, finalCoverPath, mbAlbumId);

    // Check existing track for LUFS / play_count preservation
    const existingTrack = db
      .prepare(
        `SELECT id, loudness_lufs, replaygain_track_gain, play_count, last_played_at FROM tracks WHERE file_path = ?`
      )
      .get(resolvedPath) as
      | {
          id: string;
          loudness_lufs: number | null;
          replaygain_track_gain: number | null;
          play_count: number;
          last_played_at: string | null;
        }
      | undefined;

    const preservedLufs = existingTrack?.loudness_lufs ?? null;
    const preservedGain =
      existingTrack?.replaygain_track_gain ?? replayGainDb ?? null;

    db.prepare(
      `INSERT INTO tracks (
         id, album_id, artist_id, title, track_number, disc_number,
         duration_ms, file_path, format, bitrate, sample_rate,
         loudness_lufs, replaygain_track_gain, play_count, last_played_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         album_id = excluded.album_id,
         artist_id = excluded.artist_id,
         title = excluded.title,
         track_number = excluded.track_number,
         disc_number = excluded.disc_number,
         duration_ms = excluded.duration_ms,
         format = excluded.format,
         bitrate = excluded.bitrate,
         sample_rate = excluded.sample_rate,
         loudness_lufs = COALESCE(tracks.loudness_lufs, excluded.loudness_lufs),
         replaygain_track_gain = COALESCE(tracks.replaygain_track_gain, excluded.replaygain_track_gain)`
    ).run(
      trackId,
      albumId,
      artistId,
      title,
      trackNumber,
      discNumber,
      durationMs,
      resolvedPath,
      format,
      bitrate,
      sampleRate,
      preservedLufs,
      preservedGain,
      existingTrack?.play_count ?? 0,
      existingTrack?.last_played_at ?? null
    );

    if (preservedLufs === null) {
      enqueueTrackForLufsAnalysis(trackId, resolvedPath);
    }

    return trackId;
  } catch (err) {
    console.warn('[Brokeify Scanner] Failed to index file:', filePath, err);
    return null;
  }
}

export function removeAudioFileFromIndex(filePath: string) {
  try {
    const resolvedPath = path.resolve(filePath);
    db.prepare(`DELETE FROM tracks WHERE file_path = ?`).run(resolvedPath);
    // Clean up empty albums and artists
    db.prepare(
      `DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks WHERE album_id IS NOT NULL)`
    ).run();
    db.prepare(
      `DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM tracks WHERE artist_id IS NOT NULL)`
    ).run();
  } catch {}
}

/**
 * Automatic .m3u / .m3u8 Playlist Importer
 * Resolves internal track paths against the SQLite tracks table and populates playlists + playlist_tracks.
 */
export function importM3uPlaylistFile(m3uFilePath: string): string | null {
  try {
    const resolvedM3u = path.resolve(m3uFilePath);
    if (!fs.existsSync(resolvedM3u)) return null;

    const rawContent = fs.readFileSync(resolvedM3u, 'utf-8');
    const m3uDir = path.dirname(resolvedM3u);
    const playlistName = path
      .basename(resolvedM3u, path.extname(resolvedM3u))
      .replace(/[_-]+/g, ' ')
      .trim();

    const playlistId = sha1Id('pl-m3u', resolvedM3u);
    const lines = rawContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));

    const allDbTracks = db
      .prepare(`SELECT id, file_path, title FROM tracks`)
      .all() as Array<{ id: string; file_path: string; title: string }>;

    const byExactPath = new Map<string, string>();
    const byLowerBasename = new Map<string, string>();
    for (const row of allDbTracks) {
      byExactPath.set(path.resolve(row.file_path), row.id);
      byLowerBasename.set(path.basename(row.file_path).toLowerCase(), row.id);
    }

    const matchedTrackIds: string[] = [];
    for (const line of lines) {
      const normalizedLine = line.replace(/\\/g, '/');
      const candidateRel = path.resolve(m3uDir, normalizedLine);
      const candidateMusic = path.resolve(
        MUSIC_DIR,
        normalizedLine.replace(/^\/+/, '')
      );
      const baseName = path.basename(normalizedLine).toLowerCase();

      const matchedId =
        byExactPath.get(candidateRel) ||
        byExactPath.get(candidateMusic) ||
        byLowerBasename.get(baseName);

      if (matchedId) {
        matchedTrackIds.push(matchedId);
      }
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO playlists (id, name, description, cover_path, is_smart, smart_rules_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         updated_at = excluded.updated_at`
    ).run(
      playlistId,
      playlistName || 'Imported M3U Playlist',
      `Auto-imported from ${path.basename(resolvedM3u)} (${matchedTrackIds.length} tracks)`,
      null,
      now,
      now
    );

    const tx = db.transaction((ids: string[]) => {
      db.prepare(`DELETE FROM playlist_tracks WHERE playlist_id = ?`).run(
        playlistId
      );
      const insertStmt = db.prepare(
        `INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`
      );
      ids.forEach((tid, idx) => {
        insertStmt.run(playlistId, tid, idx);
      });
    });
    tx(matchedTrackIds);

    return playlistId;
  } catch (err) {
    console.warn('[Brokeify M3U Importer] Failed to import:', m3uFilePath, err);
    return null;
  }
}

// ============================================================================
// 5. ZERO BUILT-IN DEMO TRACKS: PURGE ANY LEGACY GENERATED FILES & INSPECT DRIVE
// ============================================================================

const LEGACY_SAMPLE_FOLDERS = [
  'Chrome Tape Syndicate',
  'The Self-Hosted Collective',
];

const LEGACY_SAMPLE_FILES = ['Night Drive Synthwave.m3u8'];

export function purgeLegacySampleFiles(baseDir: string = MUSIC_DIR) {
  try {
    for (const folder of LEGACY_SAMPLE_FOLDERS) {
      const target = path.join(baseDir, folder);
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
      }
    }
    for (const file of LEGACY_SAMPLE_FILES) {
      const targetFile = path.join(baseDir, file);
      if (fs.existsSync(targetFile)) {
        fs.rmSync(targetFile, { force: true });
      }
    }
    // Also remove any SQLite rows referencing those legacy sample artists/playlists
    db.prepare(
      `DELETE FROM tracks WHERE file_path LIKE '%Chrome Tape Syndicate%' OR file_path LIKE '%The Self-Hosted Collective%'`
    ).run();
    db.prepare(
      `DELETE FROM playlists WHERE name = 'Night Drive Synthwave' OR id = 'pl-all-local-tracks'`
    ).run();
    db.prepare(
      `DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks WHERE album_id IS NOT NULL)`
    ).run();
    db.prepare(
      `DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM tracks WHERE artist_id IS NOT NULL)`
    ).run();
  } catch {
    // ignore cleanup errors
  }
}

export interface MusicDriveStatus {
  musicDir: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  subfolders: string[];
  audioFileCount: number;
  playlistFileCount: number;
  indexedTrackCount: number;
  driveConnected: boolean;
  statusMessage: string;
}

export function inspectMusicDrive(targetDir?: string): MusicDriveStatus {
  const dirToCheck = (targetDir || MUSIC_DIR).trim() || '/music';
  let exists = false;
  let readable = false;
  let writable = false;
  const subfolders: string[] = [];

  try {
    exists = fs.existsSync(dirToCheck) && fs.statSync(dirToCheck).isDirectory();
  } catch {
    exists = false;
  }

  if (exists) {
    try {
      fs.accessSync(dirToCheck, fs.constants.R_OK);
      readable = true;
    } catch {
      readable = false;
    }
    try {
      fs.accessSync(dirToCheck, fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
    if (readable) {
      try {
        const entries = fs.readdirSync(dirToCheck, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.name.startsWith('.') && entry.isDirectory()) {
            subfolders.push(entry.name);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  const walked =
    exists && readable
      ? walkMusicDirectory(dirToCheck)
      : { audioFiles: [], m3uFiles: [] };
  const indexedTrackCount = (
    db.prepare(`SELECT COUNT(*) as c FROM tracks`).get() as { c: number }
  ).c;

  const audioFileCount = walked.audioFiles.length;
  const playlistFileCount = walked.m3uFiles.length;
  const driveConnected = exists && readable && audioFileCount > 0;

  let statusMessage = '';
  if (!exists) {
    statusMessage = `Directory "${dirToCheck}" does not exist inside the container/host. Mount your hard drive or NAS share to "${dirToCheck}" in docker-compose.yml or enter a valid mounted path.`;
  } else if (!readable) {
    statusMessage = `Directory "${dirToCheck}" exists but Brokeify does not have read permission. Check PUID/PGID or folder permissions.`;
  } else if (audioFileCount === 0) {
    statusMessage = `No audio files (.flac, .mp3, .m4a, .ogg, .opus, .wav, .aac) found inside "${dirToCheck}". Mount your local music drive or NAS share to /music in Docker Compose, or point Brokeify to a folder containing your music files.`;
  } else {
    statusMessage = `Connected to "${dirToCheck}" — ${audioFileCount} audio file(s) across ${subfolders.length} top-level folder(s) (${playlistFileCount} .m3u/.m3u8 playlist files).`;
  }

  return {
    musicDir: dirToCheck,
    exists,
    readable,
    writable,
    subfolders: subfolders.slice(0, 25),
    audioFileCount,
    playlistFileCount,
    indexedTrackCount,
    driveConnected,
    statusMessage,
  };
}

function walkMusicDirectory(dir: string): {
  audioFiles: string[];
  m3uFiles: string[];
} {
  const audioFiles: string[] = [];
  const m3uFiles: string[] = [];

  function walk(current: string, depth = 0) {
    if (depth > 12) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === '$RECYCLE.BIN' || entry.name === 'System Volume Information') {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
          audioFiles.push(fullPath);
        } else if (SUPPORTED_PLAYLIST_EXTENSIONS.has(ext)) {
          m3uFiles.push(fullPath);
        }
      }
    }
  }

  walk(dir, 0);
  return { audioFiles, m3uFiles };
}

export async function runFullLibraryScan(): Promise<{
  indexedTracks: number;
  importedPlaylists: number;
}> {
  if (scannerState.isScanning) {
    const total = (
      db.prepare(`SELECT COUNT(*) as c FROM tracks`).get() as { c: number }
    ).c;
    const pls = (
      db.prepare(`SELECT COUNT(*) as c FROM playlists`).get() as { c: number }
    ).c;
    return { indexedTracks: total, importedPlaylists: pls };
  }

  scannerState.isScanning = true;
  try {
    purgeLegacySampleFiles(MUSIC_DIR);
    const { audioFiles, m3uFiles } = walkMusicDirectory(MUSIC_DIR);

    // Prune deleted files from DB first
    const existingRows = db
      .prepare(`SELECT file_path FROM tracks`)
      .all() as Array<{ file_path: string }>;
    const diskSet = new Set(audioFiles.map((f) => path.resolve(f)));
    for (const row of existingRows) {
      if (!diskSet.has(path.resolve(row.file_path))) {
        removeAudioFileFromIndex(row.file_path);
      }
    }

    let indexedCount = 0;
    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      const id = await indexAudioFile(file);
      if (id) indexedCount++;
      scannerState.scannedFilesCount = indexedCount;
      // Yield to the Node.js event loop every 8 files so HTTP requests stay fast
      if (i % 8 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    let m3uCount = 0;
    for (const m3u of m3uFiles) {
      const pid = importM3uPlaylistFile(m3u);
      if (pid) m3uCount++;
    }

    scannerState.lastScanAt = new Date().toISOString();
    syncDatabaseToPersistentDisk();
    return { indexedTracks: indexedCount, importedPlaylists: m3uCount };
  } finally {
    scannerState.isScanning = false;
  }
}

let activeWatcher: FSWatcher | null = null;

export async function setMusicDirectory(newDir: string): Promise<MusicDriveStatus> {
  const cleaned = String(newDir || '').trim();
  if (!cleaned) {
    return inspectMusicDrive(MUSIC_DIR);
  }
  MUSIC_DIR = cleaned;
  if (activeWatcher) {
    try {
      await activeWatcher.close();
    } catch {}
    activeWatcher = null;
  }
  startChokidarMusicWatcher();
  await runFullLibraryScan();
  return inspectMusicDrive(MUSIC_DIR);
}

export function startChokidarMusicWatcher() {
  if (activeWatcher) return activeWatcher;

  purgeLegacySampleFiles(MUSIC_DIR);

  // Run initial scan asynchronously so server startup is never blocked
  setTimeout(() => {
    runFullLibraryScan().catch((err) =>
      console.error('[Brokeify Scanner] Initial scan error:', err)
    );
  }, 300);

  try {
    if (fs.existsSync(MUSIC_DIR)) {
      activeWatcher = chokidar.watch(MUSIC_DIR, {
        ignored: /(^|[/\\])(\..|\$RECYCLE\.BIN|System Volume Information)/,
        persistent: true,
        ignoreInitial: true,
        ignorePermissionErrors: true,
        awaitWriteFinish: {
          stabilityThreshold: 1500,
          pollInterval: 250,
        },
      });

      activeWatcher
        .on('add', async (filePath) => {
          const ext = path.extname(filePath).toLowerCase();
          if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
            await indexAudioFile(filePath);
            syncDatabaseToPersistentDisk();
          } else if (SUPPORTED_PLAYLIST_EXTENSIONS.has(ext)) {
            importM3uPlaylistFile(filePath);
            syncDatabaseToPersistentDisk();
          }
        })
        .on('change', async (filePath) => {
          const ext = path.extname(filePath).toLowerCase();
          if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
            await indexAudioFile(filePath);
            syncDatabaseToPersistentDisk();
          } else if (SUPPORTED_PLAYLIST_EXTENSIONS.has(ext)) {
            importM3uPlaylistFile(filePath);
            syncDatabaseToPersistentDisk();
          }
        })
        .on('unlink', (filePath) => {
          const ext = path.extname(filePath).toLowerCase();
          if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
            removeAudioFileFromIndex(filePath);
            syncDatabaseToPersistentDisk();
          }
        })
        .on('error', (err) => {
          console.warn('[Brokeify Watcher] Non-fatal watcher warning:', err);
        });
    }
  } catch (err) {
    console.warn('[Brokeify Watcher] Failed to start chokidar watcher:', err);
  }

  return activeWatcher;
}

// ============================================================================
// 6. FORMATTERS FOR WEB PLAYER & ANDROID / ANDROID AUTO REST API
// ============================================================================

const ACCENT_PALETTE = [
  '#10b981',
  '#06b6d4',
  '#a855f7',
  '#f59e0b',
  '#ec4899',
  '#3b82f6',
];

function pickAccentColor(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) {
    sum += id.charCodeAt(i);
  }
  return ACCENT_PALETTE[sum % ACCENT_PALETTE.length];
}

export interface FormattedTrackPayload {
  id: string;
  albumId: string | null;
  artistId: string | null;
  title: string;
  artist: string;
  album: string;
  year: number | null;
  genre: string;
  trackNumber: number;
  discNumber: number;
  duration: number;
  durationMs: number;
  filePath: string;
  format: string;
  bitrate: number;
  bitrateKbps: number;
  sampleRate: number;
  loudnessLufs: number | null;
  replaygainTrackGain: number | null;
  normalizationGain: number;
  playCount: number;
  lastPlayedAt: string | null;
  source: 'built-in';
  sourceName: string;
  streamUrl: string;
  artworkUrl: string;
  accentColor: string;
}

export function queryTracks(filters?: {
  albumId?: string;
  artistId?: string;
  search?: string;
  limit?: number;
}): FormattedTrackPayload[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.albumId) {
    conditions.push('t.album_id = ?');
    params.push(filters.albumId);
  }
  if (filters?.artistId) {
    conditions.push('t.artist_id = ?');
    params.push(filters.artistId);
  }
  if (filters?.search?.trim()) {
    const like = `%${filters.search.trim()}%`;
    conditions.push(
      '(t.title LIKE ? OR ar.name LIKE ? OR al.title LIKE ? OR al.genre LIKE ?)'
    );
    params.push(like, like, like, like);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = filters?.limit ? `LIMIT ${Number(filters.limit)}` : '';

  const rows = db
    .prepare(
      `SELECT
         t.id,
         t.album_id,
         t.artist_id,
         t.title,
         t.track_number,
         t.disc_number,
         t.duration_ms,
         t.file_path,
         t.format,
         t.bitrate,
         t.sample_rate,
         t.loudness_lufs,
         t.replaygain_track_gain,
         t.play_count,
         t.last_played_at,
         COALESCE(ar.name, 'Unknown Artist') AS artist_name,
         COALESCE(al.title, 'Singles') AS album_title,
         al.year AS album_year,
         COALESCE(al.genre, 'Music') AS album_genre
       FROM tracks t
       LEFT JOIN artists ar ON t.artist_id = ar.id
       LEFT JOIN albums al ON t.album_id = al.id
       ${whereClause}
       ORDER BY ar.sort_name COLLATE NOCASE ASC, al.title COLLATE NOCASE ASC, t.disc_number ASC, t.track_number ASC, t.title COLLATE NOCASE ASC
       ${limitClause}`
    )
    .all(...params) as Array<Record<string, any>>;

  return rows.map((r) => {
    const durationMs = Number(r.duration_ms || 180000);
    const durationSec = Math.max(1, Math.round(durationMs / 1000));
    const normGain =
      typeof r.replaygain_track_gain === 'number'
        ? Number(r.replaygain_track_gain)
        : 0;
    const coverTargetId = r.album_id || r.id;

    return {
      id: String(r.id),
      albumId: r.album_id ? String(r.album_id) : null,
      artistId: r.artist_id ? String(r.artist_id) : null,
      title: String(r.title || 'Untitled'),
      artist: String(r.artist_name || 'Unknown Artist'),
      album: String(r.album_title || 'Singles'),
      year: r.album_year ? Number(r.album_year) : null,
      genre: String(r.album_genre || 'Music'),
      trackNumber: Number(r.track_number || 1),
      discNumber: Number(r.disc_number || 1),
      duration: durationSec,
      durationMs,
      filePath: String(r.file_path),
      format: String(r.format || 'MP3'),
      bitrate: Number(r.bitrate || 320),
      bitrateKbps: Number(r.bitrate || 320),
      sampleRate: Number(r.sample_rate || 44100),
      loudnessLufs:
        typeof r.loudness_lufs === 'number' ? Number(r.loudness_lufs) : null,
      replaygainTrackGain:
        typeof r.replaygain_track_gain === 'number'
          ? Number(r.replaygain_track_gain)
          : null,
      normalizationGain: normGain,
      playCount: Number(r.play_count || 0),
      lastPlayedAt: r.last_played_at ? String(r.last_played_at) : null,
      source: 'built-in',
      sourceName: 'Brokeify Native Engine',
      streamUrl: `/api/stream/${encodeURIComponent(String(r.id))}`,
      artworkUrl: `/api/cover/album/${encodeURIComponent(String(coverTargetId))}`,
      accentColor: pickAccentColor(String(r.id)),
    };
  });
}

export function queryArtists(search?: string) {
  const params: any[] = [];
  let where = '';
  if (search?.trim()) {
    where = 'WHERE ar.name LIKE ?';
    params.push(`%${search.trim()}%`);
  }

  const rows = db
    .prepare(
      `SELECT
         ar.id,
         ar.name,
         ar.sort_name,
         ar.musicbrainz_id,
         ar.image_url,
         COUNT(DISTINCT al.id) AS album_count,
         COUNT(DISTINCT t.id) AS track_count
       FROM artists ar
       LEFT JOIN albums al ON al.artist_id = ar.id
       LEFT JOIN tracks t ON t.artist_id = ar.id
       ${where}
       GROUP BY ar.id
       ORDER BY ar.sort_name COLLATE NOCASE ASC`
    )
    .all(...params) as Array<Record<string, any>>;

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    sortName: String(r.sort_name || r.name),
    musicbrainzId: r.musicbrainz_id || null,
    imageUrl: `/api/cover/artist/${encodeURIComponent(String(r.id))}`,
    albumCount: Number(r.album_count || 0),
    trackCount: Number(r.track_count || 0),
  }));
}

export function queryAlbums(filters?: { artistId?: string; search?: string }) {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.artistId) {
    conditions.push('al.artist_id = ?');
    params.push(filters.artistId);
  }
  if (filters?.search?.trim()) {
    const like = `%${filters.search.trim()}%`;
    conditions.push('(al.title LIKE ? OR ar.name LIKE ?)');
    params.push(like, like);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT
         al.id,
         al.artist_id,
         al.title,
         al.year,
         al.genre,
         al.cover_path,
         al.musicbrainz_id,
         COALESCE(ar.name, 'Unknown Artist') AS artist_name,
         COUNT(t.id) AS track_count
       FROM albums al
       LEFT JOIN artists ar ON al.artist_id = ar.id
       LEFT JOIN tracks t ON t.album_id = al.id
       ${where}
       GROUP BY al.id
       ORDER BY al.title COLLATE NOCASE ASC`
    )
    .all(...params) as Array<Record<string, any>>;

  return rows.map((r) => ({
    id: String(r.id),
    artistId: r.artist_id ? String(r.artist_id) : null,
    artistName: String(r.artist_name || 'Unknown Artist'),
    title: String(r.title),
    year: r.year ? Number(r.year) : null,
    genre: r.genre ? String(r.genre) : 'Music',
    coverUrl: `/api/cover/album/${encodeURIComponent(String(r.id))}`,
    musicbrainzId: r.musicbrainz_id || null,
    trackCount: Number(r.track_count || 0),
  }));
}

export function queryPlaylists() {
  const pls = db
    .prepare(
      `SELECT id, name, description, cover_path, is_smart, smart_rules_json, created_at, updated_at
       FROM playlists
       ORDER BY updated_at DESC, name COLLATE NOCASE ASC`
    )
    .all() as Array<Record<string, any>>;

  const trackRowsStmt = db.prepare(
    `SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC`
  );

  return pls.map((p) => {
    const pid = String(p.id);
    const tRows = trackRowsStmt.all(pid) as Array<{ track_id: string }>;
    const trackIds = tRows.map((tr) => String(tr.track_id));

    return {
      id: pid,
      name: String(p.name),
      originalName: String(p.name),
      description: String(p.description || ''),
      coverUrl: `/api/cover/playlist/${encodeURIComponent(pid)}`,
      coverAccent: pickAccentColor(pid),
      isSmart: Boolean(p.is_smart),
      smartRules: p.smart_rules_json ? JSON.parse(p.smart_rules_json) : null,
      trackCount: trackIds.length,
      trackIds,
      source: 'built-in' as const,
      createdAt: String(p.created_at || new Date().toISOString().slice(0, 10)),
      updatedAt: String(p.updated_at || new Date().toISOString()),
    };
  });
}

// ============================================================================
// 7. HTTP 206 RANGE AUDIO STREAMING & CACHED COVER ART DELIVERY
// ============================================================================

const MIME_BY_EXT: Record<string, string> = {
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
};

export function handleStreamTrack(req: Request, res: Response) {
  const trackId = String(req.params.trackId || '').trim();
  if (!trackId) {
    return res.status(400).json({ error: 'Missing trackId' });
  }

  const row = db
    .prepare(`SELECT id, file_path, format FROM tracks WHERE id = ?`)
    .get(trackId) as { id: string; file_path: string; format: string } | undefined;

  if (!row || !row.file_path || !fs.existsSync(row.file_path)) {
    return res.status(404).json({ error: 'Track audio file not found on disk' });
  }

  const filePath = row.file_path;
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start >= fileSize ||
      end >= fileSize ||
      start > end
    ) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
    return stream.pipe(res);
  }

  res.writeHead(200, {
    'Content-Length': fileSize,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
  });
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end();
  });
  return stream.pipe(res);
}

function generateCoverSvg(title: string, subtitle: string, accent: string): string {
  const safeTitle = (title || 'Brokeify')
    .replace(/[&<>'"]/g, '')
    .slice(0, 26);
  const safeSub = (subtitle || 'Native Engine')
    .replace(/[&<>'"]/g, '')
    .slice(0, 30);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#09090b" />
        <stop offset="60%" stop-color="#18181b" />
        <stop offset="100%" stop-color="${accent}" stop-opacity="0.45" />
      </linearGradient>
    </defs>
    <rect width="400" height="400" fill="url(#bg)" />
    <circle cx="200" cy="175" r="88" fill="none" stroke="${accent}" stroke-width="4" stroke-opacity="0.55" />
    <circle cx="200" cy="175" r="24" fill="${accent}" fill-opacity="0.25" stroke="${accent}" stroke-width="3" />
    <text x="200" y="315" text-anchor="middle" fill="#ffffff" font-family="monospace, sans-serif" font-weight="bold" font-size="22">${safeTitle}</text>
    <text x="200" y="346" text-anchor="middle" fill="${accent}" font-family="monospace, sans-serif" font-size="15">${safeSub}</text>
  </svg>`;
}

export function handleServeCover(req: Request, res: Response) {
  const type = String(req.params.type || 'album').toLowerCase();
  const id = String(req.params.id || '').trim();

  let coverPath: string | null = null;
  let title = 'Brokeify';
  let subtitle = 'Music Library';

  if (type === 'album') {
    const alb = db
      .prepare(
        `SELECT al.title, al.cover_path, COALESCE(ar.name, 'Artist') AS artist_name
         FROM albums al LEFT JOIN artists ar ON al.artist_id = ar.id WHERE al.id = ?`
      )
      .get(id) as
      | { title: string; cover_path: string | null; artist_name: string }
      | undefined;
    if (alb) {
      title = alb.title;
      subtitle = alb.artist_name;
      coverPath = alb.cover_path;
    }
    const diskCandidate = path.join(COVERS_DIR, `${id}.jpg`);
    if (!coverPath && fs.existsSync(diskCandidate)) {
      coverPath = diskCandidate;
    }
  } else if (type === 'artist') {
    const art = db
      .prepare(`SELECT name FROM artists WHERE id = ?`)
      .get(id) as { name: string } | undefined;
    if (art) {
      title = art.name;
      subtitle = 'Artist';
    }
    const albCover = db
      .prepare(
        `SELECT cover_path FROM albums WHERE artist_id = ? AND cover_path IS NOT NULL LIMIT 1`
      )
      .get(id) as { cover_path: string | null } | undefined;
    if (albCover?.cover_path) {
      coverPath = albCover.cover_path;
    }
  } else if (type === 'playlist') {
    const pl = db
      .prepare(`SELECT name, cover_path FROM playlists WHERE id = ?`)
      .get(id) as { name: string; cover_path: string | null } | undefined;
    if (pl) {
      title = pl.name;
      subtitle = 'Playlist';
      coverPath = pl.cover_path;
    }
    if (!coverPath) {
      const firstTrackAlbum = db
        .prepare(
          `SELECT al.cover_path FROM playlist_tracks pt
           JOIN tracks t ON pt.track_id = t.id
           JOIN albums al ON t.album_id = al.id
           WHERE pt.playlist_id = ? AND al.cover_path IS NOT NULL
           ORDER BY pt.position ASC LIMIT 1`
        )
        .get(id) as { cover_path: string | null } | undefined;
      if (firstTrackAlbum?.cover_path) {
        coverPath = firstTrackAlbum.cover_path;
      }
    }
  }

  if (coverPath && fs.existsSync(coverPath)) {
    const ext = path.extname(coverPath).toLowerCase();
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return fs.createReadStream(coverPath).pipe(res);
  }

  const svg = generateCoverSvg(title, subtitle, pickAccentColor(id || title));
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.send(svg);
}

// ============================================================================
// 8. MUSICBRAINZ AUTO-TAGGER & COVER ART ARCHIVE FETCHER
// ============================================================================

export async function enrichTrackFromMusicBrainz(trackId: string): Promise<{
  ok: boolean;
  message: string;
  track?: FormattedTrackPayload;
}> {
  const row = db
    .prepare(
      `SELECT t.id, t.title, t.album_id, t.artist_id, COALESCE(ar.name, '') AS artist_name, COALESCE(al.title, '') AS album_title
       FROM tracks t
       LEFT JOIN artists ar ON t.artist_id = ar.id
       LEFT JOIN albums al ON t.album_id = al.id
       WHERE t.id = ?`
    )
    .get(trackId) as
    | {
        id: string;
        title: string;
        album_id: string;
        artist_id: string;
        artist_name: string;
        album_title: string;
      }
    | undefined;

  if (!row) {
    return { ok: false, message: 'Track not found in SQLite database.' };
  }

  const query = `recording:"${row.title}"${
    row.artist_name && row.artist_name !== 'Unknown Artist'
      ? ` AND artist:"${row.artist_name}"`
      : ''
  }`;
  const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(
    query
  )}&limit=3&fmt=json`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'BrokeifyStandaloneServer/1.0.0 ( https://github.com/Mr-Nickey/brokeify )',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!resp.ok) {
    return {
      ok: false,
      message: `MusicBrainz API returned HTTP ${resp.status}`,
    };
  }

  const data = (await resp.json()) as any;
  const rec = data?.recordings?.[0];
  if (!rec) {
    return { ok: false, message: 'No matching recording found on MusicBrainz.' };
  }

  const canonicalTitle = String(rec.title || row.title);
  const artistCredit = rec['artist-credit']?.[0];
  const canonicalArtist = String(
    artistCredit?.name || artistCredit?.artist?.name || row.artist_name
  );
  const artistMbid = artistCredit?.artist?.id || null;

  const officialRelease =
    (rec.releases || []).find((r: any) => r.status === 'Official') ||
    rec.releases?.[0];
  const canonicalAlbum = String(officialRelease?.title || row.album_title || 'Singles');
  const releaseMbid = officialRelease?.id || null;
  const releaseYear = officialRelease?.date
    ? parseInt(String(officialRelease.date).slice(0, 4), 10)
    : null;

  // Update Artist & Album in SQLite
  if (row.artist_id) {
    db.prepare(
      `UPDATE artists SET name = ?, sort_name = ?, musicbrainz_id = COALESCE(?, musicbrainz_id) WHERE id = ?`
    ).run(canonicalArtist, toSortName(canonicalArtist), artistMbid, row.artist_id);
  }

  if (row.album_id) {
    db.prepare(
      `UPDATE albums SET title = ?, year = COALESCE(?, year), musicbrainz_id = COALESCE(?, musicbrainz_id) WHERE id = ?`
    ).run(canonicalAlbum, releaseYear, releaseMbid, row.album_id);

    // Pull high-res cover art from Cover Art Archive if releaseMbid is available
    if (releaseMbid) {
      try {
        const coverResp = await fetch(
          `https://coverartarchive.org/release/${encodeURIComponent(releaseMbid)}/front-500`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (coverResp.ok) {
          const arrBuf = await coverResp.arrayBuffer();
          const targetCover = path.join(COVERS_DIR, `${row.album_id}.jpg`);
          fs.writeFileSync(targetCover, Buffer.from(arrBuf));
          db.prepare(`UPDATE albums SET cover_path = ? WHERE id = ?`).run(
            targetCover,
            row.album_id
          );
        }
      } catch {
        // Cover Art Archive optional
      }
    }
  }

  db.prepare(`UPDATE tracks SET title = ? WHERE id = ?`).run(
    canonicalTitle,
    row.id
  );

  const updated = queryTracks().find((t) => t.id === row.id);
  return {
    ok: true,
    message: `Matched "${canonicalArtist} - ${canonicalTitle}" (${canonicalAlbum}) via MusicBrainz`,
    track: updated,
  };
}
