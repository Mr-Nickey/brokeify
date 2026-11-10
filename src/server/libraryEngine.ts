import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
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

function resolveMusicDir(preferredPaths: string[]): string {
  for (const candidate of preferredPaths) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        fs.accessSync(candidate, fs.constants.R_OK);
        return candidate;
      }
    } catch {
      // Try next candidate
    }
  }
  return resolveWritableDir(preferredPaths);
}

export let MUSIC_DIR = resolveMusicDir([
  process.env.BROKEIFY_MUSIC_DIR || '/music',
  '/music',
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
  '.wma',
]);

const SUPPORTED_PLAYLIST_EXTENSIONS = new Set(['.m3u', '.m3u8']);

export function isSupportedAudioFile(filePath: string): boolean {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return SUPPORTED_AUDIO_EXTENSIONS.has(ext);
}

export function isSupportedPlaylistFile(filePath: string): boolean {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return SUPPORTED_PLAYLIST_EXTENSIONS.has(ext);
}

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
// 2. PURE-TYPESCRIPT EMBEDDED INDEXED DATABASE ENGINE (/data/brokeify.db)
//    Zero native C++ addons (.node binaries), making SIGSEGV (exit code 139)
//    physically impossible across all Linux/Windows/WSL2/NAS Docker hosts.
// ============================================================================

export interface ArtistRow {
  id: string;
  name: string;
  sort_name: string;
  musicbrainz_id: string | null;
  image_url: string | null;
}

export interface AlbumRow {
  id: string;
  artist_id: string | null;
  title: string;
  year: number | null;
  genre: string | null;
  cover_path: string | null;
  musicbrainz_id: string | null;
}

export interface TrackRow {
  id: string;
  album_id: string | null;
  artist_id: string | null;
  title: string;
  track_number: number;
  disc_number: number;
  duration_ms: number;
  file_path: string;
  format: string;
  bitrate: number;
  sample_rate: number;
  loudness_lufs: number | null;
  replaygain_track_gain: number | null;
  play_count: number;
  last_played_at: string | null;
  musicbrainz_id?: string | null;
  file_mtime_ms?: number | null;
}

export interface PlaylistGhostItem {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  matchedTrackId?: string | null;
}

export interface PlaylistRow {
  id: string;
  name: string;
  description: string | null;
  cover_path: string | null;
  is_smart: number;
  smart_rules_json: string | null;
  ghost_tracks_json?: string | null;
  spotify_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScrobbleRow {
  id: string;
  track_id: string;
  timestamp: number;
  synced_listenbrainz: number;
}

interface PersistedDatabaseSchema {
  engine: 'brokeify-embedded-db-v2';
  savedAt: string;
  artists: ArtistRow[];
  albums: AlbumRow[];
  tracks: TrackRow[];
  playlists: PlaylistRow[];
  playlistTracks: Record<string, string[]>;
  scrobbles: ScrobbleRow[];
  likedTrackIds?: string[];
}

class BrokeifyEmbeddedDatabase {
  artists = new Map<string, ArtistRow>();
  albums = new Map<string, AlbumRow>();
  tracks = new Map<string, TrackRow>();
  tracksByPath = new Map<string, string>(); // resolved file_path -> track.id
  playlists = new Map<string, PlaylistRow>();
  playlistTracks = new Map<string, string[]>(); // playlist_id -> ordered track_id[]
  scrobbles: ScrobbleRow[] = [];
  likedTrackIds = new Set<string>();

  constructor() {
    this.loadFromDisk();
  }

  loadFromDisk(): void {
    // Clean up any legacy SQLite WAL/SHM files
    for (const ext of ['-shm', '-wal']) {
      try {
        if (fs.existsSync(`${DB_PATH}${ext}`)) {
          fs.unlinkSync(`${DB_PATH}${ext}`);
        }
      } catch {}
    }

    try {
      if (!fs.existsSync(DB_PATH)) return;
      const rawBuf = fs.readFileSync(DB_PATH);
      if (rawBuf.length === 0) return;

      // If an older binary SQLite file exists on disk, ignore it and replace on next sync
      const header = rawBuf.subarray(0, 16).toString('utf8');
      if (header.startsWith('SQLite format 3')) {
        console.log(
          '[Brokeify DB] Migrating legacy binary database to pure-TS embedded index...'
        );
        return;
      }

      const parsed = JSON.parse(rawBuf.toString('utf8')) as Partial<PersistedDatabaseSchema>;
      if (Array.isArray(parsed.artists)) {
        for (const a of parsed.artists) {
          if (a?.id) this.artists.set(a.id, a);
        }
      }
      if (Array.isArray(parsed.albums)) {
        for (const al of parsed.albums) {
          if (al?.id) this.albums.set(al.id, al);
        }
      }
      if (Array.isArray(parsed.tracks)) {
        for (const t of parsed.tracks) {
          if (t?.id && t?.file_path) {
            this.tracks.set(t.id, t);
            this.tracksByPath.set(path.resolve(t.file_path), t.id);
          }
        }
      }
      if (Array.isArray(parsed.playlists)) {
        for (const p of parsed.playlists) {
          if (p?.id) this.playlists.set(p.id, p);
        }
      }
      if (parsed.playlistTracks && typeof parsed.playlistTracks === 'object') {
        for (const [pid, tids] of Object.entries(parsed.playlistTracks)) {
          if (Array.isArray(tids)) {
            this.playlistTracks.set(pid, tids.map(String));
          }
        }
      }
      if (Array.isArray(parsed.scrobbles)) {
        this.scrobbles = parsed.scrobbles.slice(-2000);
      }
      if (Array.isArray(parsed.likedTrackIds)) {
        for (const tid of parsed.likedTrackIds) {
          if (tid) this.likedTrackIds.add(String(tid));
        }
      }
      console.log(
        `[Brokeify][DB][INFO] Restored persistent database from ${DB_PATH}: ${this.tracks.size} tracks, ${this.albums.size} albums, ${this.artists.size} artists, ${this.playlists.size} playlists intact.`
      );
    } catch (err) {
      console.warn('[Brokeify DB] Starting with fresh embedded database index:', err);
    }
  }

  saveToDisk(): void {
    try {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      const payload: PersistedDatabaseSchema = {
        engine: 'brokeify-embedded-db-v2',
        savedAt: new Date().toISOString(),
        artists: Array.from(this.artists.values()),
        albums: Array.from(this.albums.values()),
        tracks: Array.from(this.tracks.values()),
        playlists: Array.from(this.playlists.values()),
        playlistTracks: Object.fromEntries(this.playlistTracks.entries()),
        scrobbles: this.scrobbles.slice(-2000),
        likedTrackIds: Array.from(this.likedTrackIds),
      };
      const json = JSON.stringify(payload);
      const tmpPath = `${DB_PATH}.tmp`;
      fs.writeFileSync(tmpPath, json, 'utf-8');
      fs.renameSync(tmpPath, DB_PATH);
    } catch {
      try {
        const payload: PersistedDatabaseSchema = {
          engine: 'brokeify-embedded-db-v2',
          savedAt: new Date().toISOString(),
          artists: Array.from(this.artists.values()),
          albums: Array.from(this.albums.values()),
          tracks: Array.from(this.tracks.values()),
          playlists: Array.from(this.playlists.values()),
          playlistTracks: Object.fromEntries(this.playlistTracks.entries()),
          scrobbles: this.scrobbles.slice(-2000),
          likedTrackIds: Array.from(this.likedTrackIds),
        };
        fs.writeFileSync(DB_PATH, JSON.stringify(payload), 'utf-8');
      } catch {}
    }
  }

  pragma(_statement: string): void {
    // No-op compatibility method
  }

  exec(_sql: string): void {
    // No-op compatibility method
  }

  transaction<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: any[]) => {
      const result = fn(...args);
      syncDatabaseToPersistentDisk();
      return result;
    }) as T;
  }

  prepare(sql: string) {
    const norm = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    return {
      get: (...params: any[]): any => {
        if (norm.startsWith('select count(*) as c from tracks')) {
          return { c: this.tracks.size };
        }
        if (norm.startsWith('select count(*) as c from albums')) {
          return { c: this.albums.size };
        }
        if (norm.startsWith('select count(*) as c from artists')) {
          return { c: this.artists.size };
        }
        if (norm.startsWith('select count(*) as c from playlists')) {
          return { c: this.playlists.size };
        }
        if (norm.startsWith('select count(*) as c from scrobbles')) {
          return { c: this.scrobbles.length };
        }
        if (norm.includes('from playlists where id = ?')) {
          return this.playlists.get(String(params[0]));
        }
        if (norm.includes('select 1 from tracks where id = ?')) {
          return this.tracks.has(String(params[0])) ? { 1: 1 } : undefined;
        }
        if (norm.includes('from tracks where id = ?')) {
          return this.tracks.get(String(params[0]));
        }
        if (norm.includes('from tracks where file_path = ?')) {
          const tid = this.tracksByPath.get(path.resolve(String(params[0])));
          return tid ? this.tracks.get(tid) : undefined;
        }
        return undefined;
      },
      all: (...params: any[]): any[] => {
        if (norm.includes('from playlist_tracks where playlist_id = ?')) {
          const list = this.playlistTracks.get(String(params[0])) || [];
          return list.map((track_id) => ({ track_id }));
        }
        if (norm.includes('from tracks')) {
          return Array.from(this.tracks.values());
        }
        return [];
      },
      run: (...params: any[]) => {
        if (norm.startsWith('delete from playlist_tracks where playlist_id = ?')) {
          this.playlistTracks.set(String(params[0]), []);
          syncDatabaseToPersistentDisk();
          return { changes: 1 };
        }
        if (norm.startsWith('delete from playlists where id = ?')) {
          const id = String(params[0]);
          this.playlists.delete(id);
          this.playlistTracks.delete(id);
          syncDatabaseToPersistentDisk();
          return { changes: 1 };
        }
        if (norm.startsWith('delete from tracks where id = ?')) {
          deleteTrackFromDb(String(params[0]));
          return { changes: 1 };
        }
        if (norm.includes('insert') && norm.includes('into playlist_tracks')) {
          const [pid, tid] = [String(params[0]), String(params[1])];
          const curr = this.playlistTracks.get(pid) || [];
          if (!curr.includes(tid)) {
            curr.push(tid);
            this.playlistTracks.set(pid, curr);
          }
          return { changes: 1 };
        }
        if (norm.startsWith('update tracks set play_count')) {
          const [nowIso, id] = [String(params[0]), String(params[1])];
          incrementTrackPlayCount(id, nowIso);
          return { changes: 1 };
        }
        syncDatabaseToPersistentDisk();
        return { changes: 1 };
      },
    };
  }
}

export const db = new BrokeifyEmbeddedDatabase();

let syncDbTimer: ReturnType<typeof setTimeout> | null = null;

export function syncDatabaseToPersistentDisk(immediate = false): void {
  if (immediate) {
    if (syncDbTimer) {
      clearTimeout(syncDbTimer);
      syncDbTimer = null;
    }
    db.saveToDisk();
    return;
  }
  if (!syncDbTimer) {
    syncDbTimer = setTimeout(() => {
      syncDbTimer = null;
      db.saveToDisk();
    }, 1500);
  }
}

export function getLibraryCounts() {
  return {
    totalTracks: db.tracks.size,
    totalAlbums: db.albums.size,
    totalArtists: db.artists.size,
    totalPlaylists: db.playlists.size,
    totalScrobbles: db.scrobbles.length,
  };
}

export function pruneOrphanedAlbumsAndArtists(): void {
  const activeAlbumIds = new Set<string>();
  const activeArtistIds = new Set<string>();

  for (const track of db.tracks.values()) {
    if (track.album_id) activeAlbumIds.add(track.album_id);
    if (track.artist_id) activeArtistIds.add(track.artist_id);
  }

  for (const albumId of db.albums.keys()) {
    if (!activeAlbumIds.has(albumId)) {
      db.albums.delete(albumId);
    }
  }

  for (const artistId of db.artists.keys()) {
    if (!activeArtistIds.has(artistId)) {
      db.artists.delete(artistId);
    }
  }
}

export function upsertPlaylistWithTracks(params: {
  id: string;
  name: string;
  description?: string;
  isSmart?: boolean;
  smartRulesJson?: string | null;
  ghostTracks?: PlaylistGhostItem[] | null;
  spotifyUrl?: string | null;
  trackIds?: string[];
  createdAt?: string;
}): void {
  const now = new Date().toISOString();
  const existing = db.playlists.get(params.id);

  let ghostTracksJson = existing?.ghost_tracks_json ?? null;
  if (params.ghostTracks !== undefined) {
    ghostTracksJson =
      Array.isArray(params.ghostTracks) && params.ghostTracks.length > 0
        ? JSON.stringify(params.ghostTracks)
        : null;
  }

  db.playlists.set(params.id, {
    id: params.id,
    name: params.name,
    description: params.description ?? existing?.description ?? '',
    cover_path: existing?.cover_path ?? null,
    is_smart: params.isSmart !== undefined ? (params.isSmart ? 1 : 0) : existing?.is_smart ?? 0,
    smart_rules_json:
      params.smartRulesJson !== undefined
        ? params.smartRulesJson
        : existing?.smart_rules_json ?? null,
    ghost_tracks_json: ghostTracksJson,
    spotify_url:
      params.spotifyUrl !== undefined ? params.spotifyUrl : existing?.spotify_url ?? null,
    created_at: params.createdAt || existing?.created_at || now,
    updated_at: now,
  });

  if (Array.isArray(params.trackIds)) {
    const validIds: string[] = [];
    const seen = new Set<string>();
    for (const rawTid of params.trackIds) {
      const tid = String(rawTid).trim();
      if (tid && !seen.has(tid) && db.tracks.has(tid)) {
        seen.add(tid);
        validIds.push(tid);
      }
    }
    db.playlistTracks.set(params.id, validIds);
  } else if (!db.playlistTracks.has(params.id)) {
    db.playlistTracks.set(params.id, []);
  }

  syncDatabaseToPersistentDisk();
}

export function deletePlaylistById(playlistId: string): boolean {
  const existed = db.playlists.delete(playlistId);
  db.playlistTracks.delete(playlistId);
  syncDatabaseToPersistentDisk();
  return existed;
}

export function getPlaylistTrackIds(playlistId: string): string[] {
  return [...(db.playlistTracks.get(playlistId) || [])];
}

export function setPlaylistTrackIds(playlistId: string, trackIds: string[]): void {
  const valid: string[] = [];
  const seen = new Set<string>();
  for (const rawId of trackIds) {
    const tid = String(rawId).trim();
    if (tid && !seen.has(tid) && db.tracks.has(tid)) {
      seen.add(tid);
      valid.push(tid);
    }
  }
  db.playlistTracks.set(playlistId, valid);
  const pl = db.playlists.get(playlistId);
  if (pl) {
    pl.updated_at = new Date().toISOString();
  }
  syncDatabaseToPersistentDisk();
}

export function deleteTrackFromDb(trackId: string): TrackRow | null {
  const row = db.tracks.get(trackId);
  if (!row) return null;

  db.tracks.delete(trackId);
  db.tracksByPath.delete(path.resolve(row.file_path));

  for (const [pid, tids] of db.playlistTracks.entries()) {
    if (tids.includes(trackId)) {
      db.playlistTracks.set(
        pid,
        tids.filter((id) => id !== trackId)
      );
    }
  }

  pruneOrphanedAlbumsAndArtists();
  syncDatabaseToPersistentDisk();
  return row;
}

export function incrementTrackPlayCount(
  trackId: string,
  playedAtIso = new Date().toISOString()
): TrackRow | null {
  const row = db.tracks.get(trackId);
  if (!row) return null;
  row.play_count = (row.play_count || 0) + 1;
  row.last_played_at = playedAtIso;
  syncDatabaseToPersistentDisk();
  return row;
}

export function recordScrobbleInDb(
  trackId: string,
  timestampUnix: number,
  syncedListenBrainz: boolean
): void {
  if (!db.tracks.has(trackId)) return;
  db.scrobbles.push({
    id: `scr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    track_id: trackId,
    timestamp: timestampUnix,
    synced_listenbrainz: syncedListenBrainz ? 1 : 0,
  });
  if (db.scrobbles.length > 2000) {
    db.scrobbles.splice(0, db.scrobbles.length - 2000);
  }
  syncDatabaseToPersistentDisk();
}

export function getTrackWithArtistAlbum(trackId: string) {
  const t = db.tracks.get(trackId);
  if (!t) return null;
  const ar = t.artist_id ? db.artists.get(t.artist_id) : undefined;
  const al = t.album_id ? db.albums.get(t.album_id) : undefined;
  return {
    id: t.id,
    title: t.title,
    duration_ms: t.duration_ms,
    artist: ar?.name || 'Unknown Artist',
    album: al?.title || 'Singles',
  };
}

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
          const track = db.tracks.get(job.trackId);
          if (track) {
            track.loudness_lufs = result.loudnessLufs;
            track.replaygain_track_gain = result.replaygainDb;
            syncDatabaseToPersistentDisk();
          }
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
  discNumber: number;
  year: number | null;
} {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext).trim();

  // Compute path segments relative to MUSIC_DIR for deep nested folders (e.g. /music/Artist/Album/Disc 1/01.flac)
  const rel = path.relative(MUSIC_DIR, filePath);
  const rawSegments = rel
    .split(/[/\\]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..');
  // Remove the filename itself from folder segments
  const folderSegments = rawSegments.slice(0, -1);

  let title = base;
  let artist = 'Unknown Artist';
  let album = 'Singles';
  let trackNumber = 1;
  let discNumber = 1;
  let year: number | null = null;

  if (folderSegments.length >= 1) {
    const lastFolder = folderSegments[folderSegments.length - 1];
    // Check if the immediate parent folder is a Disc folder (e.g., "CD1", "Disc 1", "Disk 2")
    const discMatch = lastFolder.match(/^(?:cd|disc|disk)\s*(\d{1,2})$/i);
    if (discMatch && folderSegments.length >= 2) {
      discNumber = parseInt(discMatch[1], 10) || 1;
      album = folderSegments[folderSegments.length - 2];
      if (folderSegments.length >= 3) {
        artist = folderSegments[folderSegments.length - 3];
      }
    } else if (folderSegments.length === 1) {
      // /music/Artist/01 - Track.flac OR /music/Album/01 - Track.flac
      artist = folderSegments[0];
      album = folderSegments[0];
    } else {
      // /music/Artist/Album/01.flac or /music/Genre/Artist/Album/01.flac
      album = lastFolder;
      artist = folderSegments[folderSegments.length - 2];
    }
  }

  const yearMatch = album.match(/\((\d{4})\)|\[(\d{4})\]/);
  if (yearMatch) {
    year = parseInt(yearMatch[1] || yearMatch[2], 10);
    album =
      album.replace(/\s*(?:\(\d{4}\)|\[\d{4}\])\s*/, '').trim() || album;
  }

  const numPrefix = base.match(/^(\d{1,3})\s*[-._\s]\s*(.+)$/);
  if (numPrefix) {
    trackNumber = parseInt(numPrefix[1], 10);
    title = numPrefix[2].trim();
  }

  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    if (parts.length >= 2) {
      if (artist === 'Unknown Artist') {
        artist = parts[0].trim();
      }
      title = parts.slice(1).join(' - ').trim();
    }
  }

  return { artist, album, title, trackNumber, discNumber, year };
}

export async function indexAudioFile(
  filePath: string,
  options?: { forceReparse?: boolean }
): Promise<string | null> {
  try {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) return null;

    if (!isSupportedAudioFile(resolvedPath)) return null;
    const ext = path.extname(resolvedPath).toLowerCase();

    let fileMtimeMs: number | null = null;
    try {
      const st = fs.statSync(resolvedPath);
      fileMtimeMs = Math.round(st.mtimeMs);
    } catch {}

    const existingTrackId = db.tracksByPath.get(resolvedPath);
    const existingTrack = existingTrackId
      ? db.tracks.get(existingTrackId)
      : undefined;

    // Fast path: if track already exists in /data/brokeify.db and file mtime hasn't changed, keep existing DB entry intact
    if (
      !options?.forceReparse &&
      existingTrack &&
      existingTrack.album_id &&
      existingTrack.artist_id &&
      db.albums.has(existingTrack.album_id) &&
      db.artists.has(existingTrack.artist_id) &&
      (!existingTrack.file_mtime_ms ||
        !fileMtimeMs ||
        existingTrack.file_mtime_ms === fileMtimeMs)
    ) {
      if (!existingTrack.file_mtime_ms && fileMtimeMs) {
        existingTrack.file_mtime_ms = fileMtimeMs;
      }
      return existingTrack.id;
    }

    const fallback = parseFallbackFromFilePath(resolvedPath);

    let title = fallback.title;
    let artist = fallback.artist;
    let album = fallback.album;
    let year: number | null = fallback.year;
    let genre = 'Music';
    let trackNumber = fallback.trackNumber;
    let discNumber = fallback.discNumber;
    let durationMs = 180000;
    let format = ext.replace('.', '').toUpperCase();
    let bitrate = 320;
    let sampleRate = 44100;
    let replayGainDb: number | null = null;
    let embeddedPicture: { data: Uint8Array; format?: string } | null = null;
    let mbAlbumId: string | null = null;
    let mbArtistId: string | null = null;
    let mbRecordingId: string | null = null;

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
      if (c.disk?.no) discNumber = Number(c.disk.no) || discNumber;
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
        } else if (upperCodec.includes('WMA')) {
          format = 'WMA';
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
      if (c.musicbrainz_albumid) mbAlbumId = c.musicbrainz_albumid;
      if (Array.isArray(c.musicbrainz_artistid) && c.musicbrainz_artistid[0]) {
        mbArtistId = c.musicbrainz_artistid[0];
      }
      if (c.musicbrainz_recordingid) mbRecordingId = c.musicbrainz_recordingid;
    } catch {
      // Fallback metadata from path already populated
    }

    const artistId = sha1Id('art', artist);
    const albumId = sha1Id('alb', `${artist}::${album}`);
    const trackId = sha1Id('trk', resolvedPath);

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
      const trackDir = path.dirname(resolvedPath);
      try {
        const dirFiles = fs.readdirSync(trackDir);
        const lowerSet = new Map(dirFiles.map((f) => [f.toLowerCase(), f]));
        for (const candidateName of COVER_FILENAMES) {
          const actualName = lowerSet.get(candidateName.toLowerCase());
          if (actualName) {
            const candidateFile = path.join(trackDir, actualName);
            fs.copyFileSync(candidateFile, targetCoverPath);
            finalCoverPath = targetCoverPath;
            break;
          }
        }
      } catch {}
    }

    const existingArtist = db.artists.get(artistId);
    db.artists.set(artistId, {
      id: artistId,
      name: artist,
      sort_name: toSortName(artist),
      musicbrainz_id: mbArtistId || existingArtist?.musicbrainz_id || null,
      image_url: `/api/cover/artist/${artistId}`,
    });

    const existingAlbum = db.albums.get(albumId);
    db.albums.set(albumId, {
      id: albumId,
      artist_id: artistId,
      title: album,
      year: year ?? existingAlbum?.year ?? null,
      genre: genre || existingAlbum?.genre || 'Music',
      cover_path: finalCoverPath || existingAlbum?.cover_path || null,
      musicbrainz_id: mbAlbumId || existingAlbum?.musicbrainz_id || null,
    });

    const resolvedExistingTrack = existingTrack || db.tracks.get(trackId);
    const preservedLufs = resolvedExistingTrack?.loudness_lufs ?? null;
    const preservedGain =
      resolvedExistingTrack?.replaygain_track_gain ?? replayGainDb ?? null;

    db.tracks.set(trackId, {
      id: trackId,
      album_id: albumId,
      artist_id: artistId,
      title,
      track_number: trackNumber,
      disc_number: discNumber,
      duration_ms: durationMs,
      file_path: resolvedPath,
      format,
      bitrate,
      sample_rate: sampleRate,
      loudness_lufs: preservedLufs,
      replaygain_track_gain: preservedGain,
      play_count: resolvedExistingTrack?.play_count ?? 0,
      last_played_at: resolvedExistingTrack?.last_played_at ?? null,
      musicbrainz_id:
        mbRecordingId || resolvedExistingTrack?.musicbrainz_id || null,
      file_mtime_ms: fileMtimeMs,
    });
    db.tracksByPath.set(resolvedPath, trackId);

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
    const trackId = db.tracksByPath.get(resolvedPath);
    if (trackId) {
      deleteTrackFromDb(trackId);
    }
  } catch {}
}

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

    const byExactPath = new Map<string, string>();
    const byLowerBasename = new Map<string, string>();
    for (const row of db.tracks.values()) {
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

    upsertPlaylistWithTracks({
      id: playlistId,
      name: playlistName || 'Imported M3U Playlist',
      description: `Auto-imported from ${path.basename(resolvedM3u)} (${matchedTrackIds.length} tracks)`,
      isSmart: false,
      trackIds: matchedTrackIds,
    });

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

    for (const track of Array.from(db.tracks.values())) {
      if (
        track.file_path.includes('Chrome Tape Syndicate') ||
        track.file_path.includes('The Self-Hosted Collective')
      ) {
        deleteTrackFromDb(track.id);
      }
    }

    for (const pl of Array.from(db.playlists.values())) {
      if (pl.name === 'Night Drive Synthwave' || pl.id === 'pl-all-local-tracks') {
        deletePlaylistById(pl.id);
      }
    }

    pruneOrphanedAlbumsAndArtists();
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
        const names = fs.readdirSync(dirToCheck);
        for (const name of names) {
          if (
            name.startsWith('.') ||
            name === '$RECYCLE.BIN' ||
            name === 'System Volume Information'
          ) {
            continue;
          }
          try {
            const fullSubPath = path.join(dirToCheck, name);
            if (fs.statSync(fullSubPath).isDirectory()) {
              subfolders.push(name);
            }
          } catch {
            // ignore unreadable entry
          }
        }
      } catch {
        // ignore
      }
    }
  }

  const walked =
    exists && readable
      ? walkMusicDirectory(dirToCheck, { logDiscovery: false })
      : { audioFiles: [], m3uFiles: [], directoriesScanned: 0 };
  const indexedTrackCount = db.tracks.size;

  const audioFileCount = walked.audioFiles.length;
  const playlistFileCount = walked.m3uFiles.length;
  const driveConnected = exists && readable && audioFileCount > 0;

  let statusMessage = '';
  if (!exists) {
    statusMessage = `Directory "${dirToCheck}" does not exist inside the container/host. Mount your hard drive or NAS share to "${dirToCheck}" in docker-compose.yml or enter a valid mounted path.`;
  } else if (!readable) {
    statusMessage = `Directory "${dirToCheck}" exists but Brokeify does not have read permission. Check PUID/PGID or folder permissions.`;
  } else if (audioFileCount === 0) {
    statusMessage = `No audio files (.flac, .mp3, .m4a, .ogg, .opus, .wav, .aac, .wma) found inside "${dirToCheck}" (scanned ${walked.directoriesScanned} directories). Mount your local music drive or NAS share to /music in Docker Compose, or point Brokeify to a folder containing your music files.`;
  } else {
    statusMessage = `Connected to "${dirToCheck}" — ${audioFileCount} audio file(s) across ${walked.directoriesScanned} scanned folder(s) (${playlistFileCount} .m3u/.m3u8 playlist files).`;
  }

  return {
    musicDir: dirToCheck,
    exists,
    readable,
    writable,
    subfolders: subfolders.slice(0, 50),
    audioFileCount,
    playlistFileCount,
    indexedTrackCount,
    driveConnected,
    statusMessage,
  };
}

/**
 * Recursively traverses `/music/**` across all nested Artist / Album / Disc subfolders.
 * Uses `fs.statSync(fullPath)` rather than relying on `Dirent.isDirectory()` so Windows
 * NTFS bind mounts (`D:/...:/music`), WSL2 9P, SMB/CIFS, NFS, and symlinks are always
 * traversed deeply without stopping at the root folder.
 */
export function walkMusicDirectory(
  dir: string,
  options?: { logDiscovery?: boolean }
): {
  audioFiles: string[];
  m3uFiles: string[];
  directoriesScanned: number;
} {
  const audioFiles: string[] = [];
  const m3uFiles: string[] = [];
  const visitedDirs = new Set<string>();
  let directoriesScanned = 0;
  const shouldLog = options?.logDiscovery !== false;

  function walk(currentDir: string) {
    let resolvedCurrent: string;
    try {
      resolvedCurrent = fs.realpathSync(currentDir);
    } catch {
      resolvedCurrent = path.resolve(currentDir);
    }

    if (visitedDirs.has(resolvedCurrent)) return;
    visitedDirs.add(resolvedCurrent);
    directoriesScanned += 1;

    let itemNames: string[] = [];
    try {
      itemNames = fs.readdirSync(currentDir);
    } catch (err) {
      if (shouldLog) {
        console.warn(`[Scanner] Could not read directory ${currentDir}:`, err);
      }
      return;
    }

    for (const name of itemNames) {
      if (
        name === '.' ||
        name === '..' ||
        name.startsWith('.') ||
        name === '$RECYCLE.BIN' ||
        name === 'System Volume Information'
      ) {
        continue;
      }

      const fullPath = path.join(currentDir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        if (isSupportedAudioFile(fullPath)) {
          audioFiles.push(fullPath);
          if (shouldLog) {
            console.log(`[Scanner] Found track: ${fullPath}`);
          }
        } else if (isSupportedPlaylistFile(fullPath)) {
          m3uFiles.push(fullPath);
          if (shouldLog) {
            console.log(`[Scanner] Found playlist: ${fullPath}`);
          }
        }
      }
    }
  }

  if (fs.existsSync(dir)) {
    walk(dir);
  }

  if (shouldLog) {
    console.log(
      `[Scanner] Scanned ${directoriesScanned} directory(s) in ${dir} — discovered ${audioFiles.length} audio file(s) and ${m3uFiles.length} playlist(s)`
    );
  }

  return { audioFiles, m3uFiles, directoriesScanned };
}

export async function runFullLibraryScan(): Promise<{
  indexedTracks: number;
  importedPlaylists: number;
  directoriesScanned?: number;
}> {
  if (scannerState.isScanning) {
    return {
      indexedTracks: db.tracks.size,
      importedPlaylists: db.playlists.size,
    };
  }

  scannerState.isScanning = true;
  try {
    console.log(`[Scanner] Starting recursive scan of ${MUSIC_DIR}/** ...`);
    purgeLegacySampleFiles(MUSIC_DIR);
    const { audioFiles, m3uFiles, directoriesScanned } = walkMusicDirectory(
      MUSIC_DIR,
      { logDiscovery: true }
    );

    // Prune deleted files from DB first
    const diskSet = new Set(audioFiles.map((f) => path.resolve(f)));
    for (const row of Array.from(db.tracks.values())) {
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
    syncDatabaseToPersistentDisk(true);
    console.log(
      `[Scanner] Finished indexing ${indexedCount} track(s) across ${directoriesScanned} directory(s) (${db.artists.size} artists, ${db.albums.size} albums, ${m3uCount} M3U playlists).`
    );
    return {
      indexedTracks: indexedCount,
      importedPlaylists: m3uCount,
      directoriesScanned,
    };
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
        followSymlinks: true,
        usePolling: process.env.CHOKIDAR_USEPOLLING === 'true',
        awaitWriteFinish: {
          stabilityThreshold: 1500,
          pollInterval: 250,
        },
      });

      activeWatcher
        .on('add', async (filePath) => {
          if (isSupportedAudioFile(filePath)) {
            console.log(`[Scanner] Found track: ${filePath}`);
            await indexAudioFile(filePath);
            syncDatabaseToPersistentDisk();
          } else if (isSupportedPlaylistFile(filePath)) {
            console.log(`[Scanner] Found playlist: ${filePath}`);
            importM3uPlaylistFile(filePath);
            syncDatabaseToPersistentDisk();
          }
        })
        .on('change', async (filePath) => {
          if (isSupportedAudioFile(filePath)) {
            await indexAudioFile(filePath);
            syncDatabaseToPersistentDisk();
          } else if (isSupportedPlaylistFile(filePath)) {
            importM3uPlaylistFile(filePath);
            syncDatabaseToPersistentDisk();
          }
        })
        .on('unlink', (filePath) => {
          if (isSupportedAudioFile(filePath)) {
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
  musicbrainzId?: string | null;
  artistMusicbrainzId?: string | null;
  albumMusicbrainzId?: string | null;
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
  const searchLower = filters?.search?.trim().toLowerCase() || '';

  const matched = Array.from(db.tracks.values()).filter((t) => {
    if (filters?.albumId && t.album_id !== filters.albumId) return false;
    if (filters?.artistId && t.artist_id !== filters.artistId) return false;
    if (searchLower) {
      const ar = t.artist_id ? db.artists.get(t.artist_id) : undefined;
      const al = t.album_id ? db.albums.get(t.album_id) : undefined;
      const hay = `${t.title} ${ar?.name || ''} ${al?.title || ''} ${al?.genre || ''}`.toLowerCase();
      if (!hay.includes(searchLower)) return false;
    }
    return true;
  });

  matched.sort((a, b) => {
    const arA = (a.artist_id ? db.artists.get(a.artist_id)?.sort_name : '') || '';
    const arB = (b.artist_id ? db.artists.get(b.artist_id)?.sort_name : '') || '';
    const cmpAr = arA.localeCompare(arB, undefined, { sensitivity: 'base' });
    if (cmpAr !== 0) return cmpAr;

    const alA = (a.album_id ? db.albums.get(a.album_id)?.title : '') || '';
    const alB = (b.album_id ? db.albums.get(b.album_id)?.title : '') || '';
    const cmpAl = alA.localeCompare(alB, undefined, { sensitivity: 'base' });
    if (cmpAl !== 0) return cmpAl;

    if ((a.disc_number || 1) !== (b.disc_number || 1)) {
      return (a.disc_number || 1) - (b.disc_number || 1);
    }
    if ((a.track_number || 1) !== (b.track_number || 1)) {
      return (a.track_number || 1) - (b.track_number || 1);
    }
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  });

  const sliced =
    filters?.limit && filters.limit > 0
      ? matched.slice(0, Number(filters.limit))
      : matched;

  return sliced.map((r) => {
    const ar = r.artist_id ? db.artists.get(r.artist_id) : undefined;
    const al = r.album_id ? db.albums.get(r.album_id) : undefined;
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
      artist: String(ar?.name || 'Unknown Artist'),
      album: String(al?.title || 'Singles'),
      year: al?.year ? Number(al.year) : null,
      genre: String(al?.genre || 'Music'),
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
      musicbrainzId: r.musicbrainz_id || null,
      artistMusicbrainzId: ar?.musicbrainz_id || null,
      albumMusicbrainzId: al?.musicbrainz_id || null,
      source: 'built-in',
      sourceName: 'Brokeify Native Engine',
      streamUrl: `/api/stream/${encodeURIComponent(String(r.id))}`,
      artworkUrl: `/api/cover/album/${encodeURIComponent(String(coverTargetId))}`,
      accentColor: pickAccentColor(String(r.id)),
    };
  });
}

export function queryArtists(search?: string) {
  const searchLower = search?.trim().toLowerCase() || '';
  const albumCounts = new Map<string, number>();
  const trackCounts = new Map<string, number>();

  for (const al of db.albums.values()) {
    if (al.artist_id) {
      albumCounts.set(al.artist_id, (albumCounts.get(al.artist_id) || 0) + 1);
    }
  }
  for (const tr of db.tracks.values()) {
    if (tr.artist_id) {
      trackCounts.set(tr.artist_id, (trackCounts.get(tr.artist_id) || 0) + 1);
    }
  }

  const list = Array.from(db.artists.values()).filter((ar) => {
    if (searchLower && !ar.name.toLowerCase().includes(searchLower)) {
      return false;
    }
    return true;
  });

  list.sort((a, b) =>
    (a.sort_name || a.name).localeCompare(b.sort_name || b.name, undefined, {
      sensitivity: 'base',
    })
  );

  return list.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    sortName: String(r.sort_name || r.name),
    musicbrainzId: r.musicbrainz_id || null,
    imageUrl: `/api/cover/artist/${encodeURIComponent(String(r.id))}`,
    albumCount: albumCounts.get(r.id) || 0,
    trackCount: trackCounts.get(r.id) || 0,
  }));
}

export function queryAlbums(filters?: { artistId?: string; search?: string }) {
  const searchLower = filters?.search?.trim().toLowerCase() || '';
  const trackCounts = new Map<string, number>();
  for (const tr of db.tracks.values()) {
    if (tr.album_id) {
      trackCounts.set(tr.album_id, (trackCounts.get(tr.album_id) || 0) + 1);
    }
  }

  const list = Array.from(db.albums.values()).filter((al) => {
    if (filters?.artistId && al.artist_id !== filters.artistId) return false;
    if (searchLower) {
      const arName = (al.artist_id ? db.artists.get(al.artist_id)?.name : '') || '';
      if (
        !al.title.toLowerCase().includes(searchLower) &&
        !arName.toLowerCase().includes(searchLower)
      ) {
        return false;
      }
    }
    return true;
  });

  list.sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  );

  return list.map((r) => {
    const ar = r.artist_id ? db.artists.get(r.artist_id) : undefined;
    return {
      id: String(r.id),
      artistId: r.artist_id ? String(r.artist_id) : null,
      artistName: String(ar?.name || 'Unknown Artist'),
      title: String(r.title),
      year: r.year ? Number(r.year) : null,
      genre: r.genre ? String(r.genre) : 'Music',
      coverUrl: `/api/cover/album/${encodeURIComponent(String(r.id))}`,
      musicbrainzId: r.musicbrainz_id || null,
      trackCount: trackCounts.get(r.id) || 0,
    };
  });
}

function normalizeMatchToken(str = ''): string {
  return String(str)
    .toLowerCase()
    .replace(
      /\((feat|ft|featuring|radio|explicit|clean|remaster|version|edit|bonus|deluxe|single)[^)]*\)/gi,
      ' '
    )
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function reconcilePlaylistsWithLibrary(): void {
  if (db.playlists.size === 0 || db.tracks.size === 0) return;

  const indexedCatalog: Array<{
    id: string;
    normTitle: string;
    normArtist: string;
  }> = [];

  for (const t of db.tracks.values()) {
    const ar = t.artist_id ? db.artists.get(t.artist_id) : undefined;
    const normTitle = normalizeMatchToken(t.title);
    const normArtist = normalizeMatchToken(ar?.name || '');
    if (normTitle) {
      indexedCatalog.push({ id: t.id, normTitle, normArtist });
    }
  }

  let anyModified = false;

  for (const p of db.playlists.values()) {
    if (!p.ghost_tracks_json) continue;
    let ghosts: PlaylistGhostItem[] = [];
    try {
      const parsed = JSON.parse(p.ghost_tracks_json);
      if (Array.isArray(parsed)) ghosts = parsed;
    } catch {
      continue;
    }
    if (ghosts.length === 0) continue;

    const currentTrackIds = [...(db.playlistTracks.get(p.id) || [])].filter(
      (tid) => db.tracks.has(tid)
    );
    const trackIdSet = new Set(currentTrackIds);
    let playlistChanged = false;

    const updatedGhosts = ghosts.map((g) => {
      if (g.matchedTrackId && db.tracks.has(g.matchedTrackId)) {
        if (!trackIdSet.has(g.matchedTrackId)) {
          trackIdSet.add(g.matchedTrackId);
          currentTrackIds.push(g.matchedTrackId);
          playlistChanged = true;
        }
        return g;
      }

      const gTitle = normalizeMatchToken(g.title);
      const gArtist = normalizeMatchToken(g.artist);
      const primaryArtist = normalizeMatchToken(
        String(g.artist || '').split(/[,&/;]|\bfeat\.?\b|\bft\.?\b/i)[0] || ''
      );

      const match = indexedCatalog.find((loc) => {
        if (!loc.normTitle || !gTitle) return false;
        const titleMatches =
          loc.normTitle === gTitle ||
          (gTitle.length >= 4 && loc.normTitle.includes(gTitle)) ||
          (loc.normTitle.length >= 4 && gTitle.includes(loc.normTitle));
        if (!titleMatches) return false;

        if (!gArtist || !loc.normArtist || loc.normArtist === 'unknown artist') {
          return loc.normTitle === gTitle;
        }
        return (
          loc.normArtist === gArtist ||
          loc.normArtist.includes(gArtist) ||
          gArtist.includes(loc.normArtist) ||
          (primaryArtist.length >= 3 && loc.normArtist.includes(primaryArtist))
        );
      });

      if (match) {
        if (!trackIdSet.has(match.id)) {
          trackIdSet.add(match.id);
          currentTrackIds.push(match.id);
        }
        playlistChanged = true;
        return {
          ...g,
          matchedTrackId: match.id,
        };
      }

      if (g.matchedTrackId) {
        playlistChanged = true;
        return { ...g, matchedTrackId: null };
      }
      return g;
    });

    if (playlistChanged) {
      p.ghost_tracks_json = JSON.stringify(updatedGhosts);
      db.playlistTracks.set(p.id, currentTrackIds);
      anyModified = true;
    }
  }

  if (anyModified) {
    syncDatabaseToPersistentDisk();
  }
}

export function queryPlaylists() {
  reconcilePlaylistsWithLibrary();

  const pls = Array.from(db.playlists.values()).sort((a, b) => {
    const cmpDate = String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    if (cmpDate !== 0) return cmpDate;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return pls.map((p) => {
    const pid = String(p.id);
    const trackIds = (db.playlistTracks.get(pid) || []).filter((tid) =>
      db.tracks.has(tid)
    );
    let ghostTracks: PlaylistGhostItem[] = [];
    if (p.ghost_tracks_json) {
      try {
        const parsed = JSON.parse(p.ghost_tracks_json);
        if (Array.isArray(parsed)) ghostTracks = parsed;
      } catch {}
    }

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
      ghostTracks,
      linkedSpotifyUrl: p.spotify_url || undefined,
      autopilotSpotifyUrl: p.spotify_url || undefined,
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
  '.wma': 'audio/x-ms-wma',
};

export function handleStreamTrack(req: Request, res: Response) {
  const trackId = String(req.params.trackId || '').trim();
  if (!trackId) {
    return res.status(400).json({ error: 'Missing trackId' });
  }

  const row = db.tracks.get(trackId);
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
    const alb = db.albums.get(id);
    if (alb) {
      title = alb.title;
      const ar = alb.artist_id ? db.artists.get(alb.artist_id) : undefined;
      subtitle = ar?.name || 'Artist';
      coverPath = alb.cover_path;
    }
    const diskCandidate = path.join(COVERS_DIR, `${id}.jpg`);
    if (!coverPath && fs.existsSync(diskCandidate)) {
      coverPath = diskCandidate;
    }
  } else if (type === 'artist') {
    const art = db.artists.get(id);
    if (art) {
      title = art.name;
      subtitle = 'Artist';
    }
    for (const al of db.albums.values()) {
      if (al.artist_id === id && al.cover_path) {
        coverPath = al.cover_path;
        break;
      }
    }
  } else if (type === 'playlist') {
    const pl = db.playlists.get(id);
    if (pl) {
      title = pl.name;
      subtitle = 'Playlist';
      coverPath = pl.cover_path;
    }
    if (!coverPath) {
      const tids = db.playlistTracks.get(id) || [];
      for (const tid of tids) {
        const tr = db.tracks.get(tid);
        const al = tr?.album_id ? db.albums.get(tr.album_id) : undefined;
        if (al?.cover_path) {
          coverPath = al.cover_path;
          break;
        }
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
  const trackRow = db.tracks.get(trackId);
  if (!trackRow) {
    return { ok: false, message: 'Track not found in database.' };
  }

  const artistRow = trackRow.artist_id
    ? db.artists.get(trackRow.artist_id)
    : undefined;
  const albumRow = trackRow.album_id
    ? db.albums.get(trackRow.album_id)
    : undefined;
  const artistName = artistRow?.name || '';
  const albumTitle = albumRow?.title || '';

  const query = `recording:"${trackRow.title}"${
    artistName && artistName !== 'Unknown Artist'
      ? ` AND artist:"${artistName}"`
      : ''
  }`;
  const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(
    query
  )}&limit=3&fmt=json`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent':
        'BrokeifyStandaloneServer/0.1.2-beta ( https://github.com/Mr-Nickey/brokeify )',
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

  const canonicalTitle = String(rec.title || trackRow.title);
  const artistCredit = rec['artist-credit']?.[0];
  const canonicalArtist = String(
    artistCredit?.name || artistCredit?.artist?.name || artistName
  );
  const artistMbid = artistCredit?.artist?.id || null;

  const officialRelease =
    (rec.releases || []).find((r: any) => r.status === 'Official') ||
    rec.releases?.[0];
  const canonicalAlbum = String(officialRelease?.title || albumTitle || 'Singles');
  const releaseMbid = officialRelease?.id || null;
  const releaseYear = officialRelease?.date
    ? parseInt(String(officialRelease.date).slice(0, 4), 10)
    : null;

  if (artistRow) {
    artistRow.name = canonicalArtist;
    artistRow.sort_name = toSortName(canonicalArtist);
    if (artistMbid) artistRow.musicbrainz_id = artistMbid;
  }

  if (albumRow) {
    albumRow.title = canonicalAlbum;
    if (releaseYear) albumRow.year = releaseYear;
    if (releaseMbid) albumRow.musicbrainz_id = releaseMbid;

    if (releaseMbid) {
      try {
        const coverResp = await fetch(
          `https://coverartarchive.org/release/${encodeURIComponent(releaseMbid)}/front-500`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (coverResp.ok) {
          const arrBuf = await coverResp.arrayBuffer();
          const targetCover = path.join(COVERS_DIR, `${albumRow.id}.jpg`);
          fs.writeFileSync(targetCover, Buffer.from(arrBuf));
          albumRow.cover_path = targetCover;
        }
      } catch {
        // Cover Art Archive optional
      }
    }
  }

  trackRow.title = canonicalTitle;
  if (rec.id) {
    trackRow.musicbrainz_id = String(rec.id);
  }
  syncDatabaseToPersistentDisk();
  reconcilePlaylistsWithLibrary();

  const updated = queryTracks().find((t) => t.id === trackRow.id);
  return {
    ok: true,
    message: `Matched "${canonicalArtist} - ${canonicalTitle}" (${canonicalAlbum}) via MusicBrainz`,
    track: updated,
  };
}

export async function updateTrackMetadataInDb(params: {
  trackId: string;
  title?: string;
  artist?: string;
  album?: string;
  year?: number | null;
  genre?: string;
  musicbrainzId?: string | null;
  artistMusicbrainzId?: string | null;
  albumMusicbrainzId?: string | null;
}): Promise<FormattedTrackPayload | null> {
  const trackRow = db.tracks.get(params.trackId);
  if (!trackRow) return null;

  if (params.title && params.title.trim()) {
    trackRow.title = params.title.trim();
  }
  if (params.musicbrainzId !== undefined) {
    trackRow.musicbrainz_id = params.musicbrainzId
      ? String(params.musicbrainzId).trim()
      : null;
  }

  const artistRow = trackRow.artist_id
    ? db.artists.get(trackRow.artist_id)
    : undefined;
  if (artistRow) {
    if (params.artist && params.artist.trim()) {
      artistRow.name = params.artist.trim();
      artistRow.sort_name = toSortName(artistRow.name);
    }
    if (params.artistMusicbrainzId !== undefined) {
      artistRow.musicbrainz_id = params.artistMusicbrainzId
        ? String(params.artistMusicbrainzId).trim()
        : null;
    }
  }

  const albumRow = trackRow.album_id
    ? db.albums.get(trackRow.album_id)
    : undefined;
  if (albumRow) {
    if (params.album && params.album.trim()) {
      albumRow.title = params.album.trim();
    }
    if (params.year !== undefined) {
      albumRow.year = params.year ? Number(params.year) : null;
    }
    if (params.genre && params.genre.trim()) {
      albumRow.genre = params.genre.trim();
    }
    if (params.albumMusicbrainzId !== undefined) {
      const relMbid = params.albumMusicbrainzId
        ? String(params.albumMusicbrainzId).trim()
        : null;
      albumRow.musicbrainz_id = relMbid;
      if (relMbid) {
        try {
          const coverResp = await fetch(
            `https://coverartarchive.org/release/${encodeURIComponent(relMbid)}/front-500`,
            { signal: AbortSignal.timeout(8000) }
          );
          if (coverResp.ok) {
            const arrBuf = await coverResp.arrayBuffer();
            const targetCover = path.join(COVERS_DIR, `${albumRow.id}.jpg`);
            fs.writeFileSync(targetCover, Buffer.from(arrBuf));
            albumRow.cover_path = targetCover;
          }
        } catch {
          // Cover Art Archive optional
        }
      }
    }
  }

  syncDatabaseToPersistentDisk();
  reconcilePlaylistsWithLibrary();
  return queryTracks().find((t) => t.id === trackRow.id) || null;
}

export function getLikedTrackIds(): string[] {
  return Array.from(db.likedTrackIds);
}

export function toggleLikedTrack(
  trackId: string,
  liked?: boolean
): { liked: boolean; likedTrackIds: string[] } {
  const id = String(trackId || '').trim();
  if (!id) {
    return { liked: false, likedTrackIds: Array.from(db.likedTrackIds) };
  }
  const shouldLike =
    typeof liked === 'boolean' ? liked : !db.likedTrackIds.has(id);
  if (shouldLike) {
    db.likedTrackIds.add(id);
  } else {
    db.likedTrackIds.delete(id);
  }
  syncDatabaseToPersistentDisk();
  return {
    liked: shouldLike,
    likedTrackIds: Array.from(db.likedTrackIds),
  };
}
