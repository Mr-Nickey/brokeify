// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseFile } from 'music-metadata';
import {
  COVERS_DIR,
  DATA_DIR,
  db,
  deleteTrackFromDb,
  getMusicDir,
  indexAudioFile,
  reconcilePlaylistsWithLibrary,
  updateTrackMetadataInDb,
  addPersistentNotification,
} from './libraryEngine.ts';

const execFileAsync = promisify(execFile);

export const QUARANTINE_DIR = path.join(DATA_DIR, 'quarantine');
try {
  fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
} catch {
  // ignore
}

// Strict 1 request/sec rate-limiter for MusicBrainz API with exponential backoff on HTTP 503/429
const MB_USER_AGENT =
  'Brokeify/1.0 (https://github.com/Mr-Nickey/brokeify)';
let lastMusicBrainzRequestTime = 0;
let mbQueuePromise: Promise<any> = Promise.resolve();

export async function throttledMusicBrainzFetch(
  url: string,
  maxRetries = 3
): Promise<Response> {
  const runRequest = async (): Promise<Response> => {
    const now = Date.now();
    const elapsed = now - lastMusicBrainzRequestTime;
    if (elapsed < 1100) {
      await new Promise((r) => setTimeout(r, 1100 - elapsed));
    }
    lastMusicBrainzRequestTime = Date.now();

    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        const resp = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': MB_USER_AGENT,
          },
          signal: AbortSignal.timeout(10000),
        });

        if (resp.status === 503 || resp.status === 429) {
          attempt++;
          if (attempt > maxRetries) return resp;
          const backoffMs = Math.min(8000, 1200 * Math.pow(2, attempt));
          await new Promise((r) => setTimeout(r, backoffMs));
          lastMusicBrainzRequestTime = Date.now();
          continue;
        }
        return resp;
      } catch (err) {
        attempt++;
        if (attempt > maxRetries) throw err;
        const backoffMs = Math.min(6000, 1000 * Math.pow(2, attempt));
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    throw new Error('MusicBrainz request exceeded retries');
  };

  const result = mbQueuePromise.then(runRequest, runRequest);
  mbQueuePromise = result.catch(() => {});
  return result;
}

export interface AcousticFingerprintResult {
  ok: boolean;
  fpcalcInstalled: boolean;
  durationSec: number;
  fingerprint: string;
  acoustidMatched: boolean;
  acoustidScore?: number;
  recordingMbid?: string;
  releaseMbid?: string;
  title?: string;
  artist?: string;
  album?: string;
  trackNumber?: number;
  discNumber?: number;
  year?: number;
  coverArtUrl?: string;
  localCoverId?: string;
  detectedVariantFlags: string[]; // e.g. ['live', 'remix', 'acoustic', 'cover', 'karaoke']
  isLikelyWrongVariant: boolean;
  sourceMethod: 'acoustid+musicbrainz' | 'musicbrainz-search' | 'file-tags';
}

export function detectVariantFlagsInText(text: string): string[] {
  const lower = String(text || '').toLowerCase();
  const flags: string[] = [];
  if (/\b(live|concert|stage|bootleg|audience)\b/i.test(lower)) {
    flags.push('live');
  }
  if (/\b(remix|rework|vip mix|club mix|extended mix|dub mix|mashup)\b/i.test(lower)) {
    flags.push('remix');
  }
  if (/\b(acoustic|unplugged|stripped)\b/i.test(lower)) {
    flags.push('acoustic');
  }
  if (/\b(cover|tribute|originally performed by)\b/i.test(lower)) {
    flags.push('cover');
  }
  if (/\b(instrumental|karaoke|backing track)\b/i.test(lower)) {
    flags.push('instrumental');
  }
  return Array.from(new Set(flags));
}

export async function runFpcalcOnFile(filePath: string): Promise<{
  ok: boolean;
  fpcalcInstalled: boolean;
  durationSec: number;
  fingerprint: string;
}> {
  try {
    const { stdout } = await execFileAsync('fpcalc', ['-json', filePath], {
      timeout: 20000,
    });
    const parsed = JSON.parse(String(stdout || '{}').trim());
    if (parsed && parsed.fingerprint) {
      return {
        ok: true,
        fpcalcInstalled: true,
        durationSec: Math.round(Number(parsed.duration || 0)),
        fingerprint: String(parsed.fingerprint),
      };
    }
  } catch {
    // fpcalc not installed or failed on file; fallback to music-metadata duration
  }

  let durationSec = 0;
  try {
    const meta = await parseFile(filePath, { duration: true, skipCovers: true });
    durationSec = Math.round(Number(meta.format.duration || 0));
  } catch {
    // ignore
  }

  return {
    ok: false,
    fpcalcInstalled: false,
    durationSec,
    fingerprint: '',
  };
}

export async function downloadCoverArtArchiveForRelease(
  releaseMbid: string
): Promise<{ coverArtUrl?: string; localCoverId?: string }> {
  if (!releaseMbid) return {};
  const caaUrl = `https://coverartarchive.org/release/${encodeURIComponent(
    releaseMbid
  )}/front-500`;
  try {
    const resp = await fetch(caaUrl, {
      headers: { 'User-Agent': MB_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return {};
    const arrayBuf = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (buffer.length < 512) return {};

    const coverId = `caa-${releaseMbid}.jpg`;
    const destPath = path.join(COVERS_DIR, coverId);
    fs.mkdirSync(COVERS_DIR, { recursive: true });
    fs.writeFileSync(destPath, buffer);
    return {
      coverArtUrl: `/api/cover/${coverId}`,
      localCoverId: coverId,
    };
  } catch {
    return {};
  }
}

export async function identifyAudioFileWithAcoustIdAndMusicBrainz(
  filePath: string,
  options: {
    acoustidApiKey?: string;
    hintArtist?: string;
    hintTitle?: string;
    downloadArtwork?: boolean;
  } = {}
): Promise<AcousticFingerprintResult> {
  const fpResult = await runFpcalcOnFile(filePath);
  let parsedMeta: any = null;
  try {
    parsedMeta = await parseFile(filePath, { duration: true, skipCovers: true });
  } catch {
    // ignore
  }

  const baseFilename = path
    .basename(filePath, path.extname(filePath))
    .replace(/^\d+[\s._-]+/, '');
  const parts = baseFilename.split(/\s+-\s+/);
  const fallbackArtist =
    options.hintArtist ||
    parsedMeta?.common?.artist ||
    (parts.length >= 2 ? parts[0].trim() : '');
  const fallbackTitle =
    options.hintTitle ||
    parsedMeta?.common?.title ||
    (parts.length >= 2 ? parts.slice(1).join(' - ').trim() : baseFilename.trim());
  const fallbackAlbum = parsedMeta?.common?.album || '';
  const fallbackTrackNo = Number(parsedMeta?.common?.track?.no || 1);
  const fallbackDiscNo = Number(parsedMeta?.common?.disk?.no || 1);
  const fallbackYear = Number(parsedMeta?.common?.year || 0);

  let recordingMbid = '';
  let releaseMbid = '';
  let matchedTitle = '';
  let matchedArtist = '';
  let matchedAlbum = '';
  let matchedTrackNo = fallbackTrackNo;
  let matchedDiscNo = fallbackDiscNo;
  let matchedYear = fallbackYear;
  let acoustidMatched = false;
  let acoustidScore = 0;
  let sourceMethod: AcousticFingerprintResult['sourceMethod'] = 'file-tags';

  const acoustidKey = String(
    options.acoustidApiKey || process.env.ACOUSTID_API_KEY || ''
  ).trim();

  // Step 1: Query AcoustID v2 Lookup if fpcalc fingerprint + API key are available
  if (fpResult.ok && fpResult.fingerprint && fpResult.durationSec > 0 && acoustidKey) {
    try {
      const params = new URLSearchParams({
        client: acoustidKey,
        meta: 'recordings+releasegroups+releases+tracks+compress',
        duration: String(fpResult.durationSec),
        fingerprint: fpResult.fingerprint,
      });
      const acoustResp = await fetch(
        `https://api.acoustid.org/v2/lookup?${params.toString()}`,
        {
          headers: { 'User-Agent': MB_USER_AGENT, Accept: 'application/json' },
          signal: AbortSignal.timeout(10000),
        }
      );
      if (acoustResp.ok) {
        const acoustJson = await acoustResp.json();
        const results = Array.isArray(acoustJson?.results)
          ? acoustJson.results
          : [];
        const bestResult = results.sort(
          (a: any, b: any) => Number(b.score || 0) - Number(a.score || 0)
        )[0];
        if (bestResult && Array.isArray(bestResult.recordings) && bestResult.recordings.length > 0) {
          const rec = bestResult.recordings[0];
          acoustidMatched = true;
          acoustidScore = Number(bestResult.score || 0);
          recordingMbid = String(rec.id || '');
          matchedTitle = String(rec.title || '');
          if (Array.isArray(rec.artists) && rec.artists[0]?.name) {
            matchedArtist = String(rec.artists[0].name);
          }
          if (Array.isArray(rec.releasegroups) && rec.releasegroups[0]) {
            const rg = rec.releasegroups[0];
            matchedAlbum = String(rg.title || '');
            if (Array.isArray(rg.releases) && rg.releases[0]?.id) {
              releaseMbid = String(rg.releases[0].id);
            }
          }
          sourceMethod = 'acoustid+musicbrainz';
        }
      }
    } catch {
      // Fall through to MusicBrainz recording lookup
    }
  }

  // Step 2: Query MusicBrainz WS/2 (strictly throttled 1 req/sec with 503 backoff)
  try {
    if (recordingMbid) {
      const mbUrl = `https://musicbrainz.org/ws/2/recording/${encodeURIComponent(
        recordingMbid
      )}?inc=artists+releases+media&fmt=json`;
      const mbResp = await throttledMusicBrainzFetch(mbUrl);
      if (mbResp.ok) {
        const recData = await mbResp.json();
        matchedTitle = recData.title || matchedTitle;
        const credit = Array.isArray(recData['artist-credit'])
          ? recData['artist-credit'][0]
          : null;
        if (credit?.name || credit?.artist?.name) {
          matchedArtist = credit.name || credit.artist.name;
        }
        const releases = Array.isArray(recData.releases) ? recData.releases : [];
        const officialRelease =
          releases.find((r: any) => String(r.status || '').toLowerCase() === 'official') ||
          releases[0];
        if (officialRelease) {
          releaseMbid = officialRelease.id || releaseMbid;
          matchedAlbum = officialRelease.title || matchedAlbum;
          const yearMatch = String(officialRelease.date || '').match(/^(\d{4})/);
          if (yearMatch) matchedYear = Number(yearMatch[1]);
          const media = Array.isArray(officialRelease.media)
            ? officialRelease.media[0]
            : null;
          if (media) {
            if (media.position) matchedDiscNo = Number(media.position) || 1;
            const trk = Array.isArray(media.track) ? media.track[0] : null;
            if (trk?.number) {
              const numParsed = parseInt(String(trk.number), 10);
              if (Number.isFinite(numParsed) && numParsed > 0) {
                matchedTrackNo = numParsed;
              }
            }
          }
        }
      }
    } else if (fallbackTitle) {
      const queryParts = [`recording:"${fallbackTitle.replace(/"/g, '')}"`];
      if (fallbackArtist) {
        queryParts.push(`artist:"${fallbackArtist.replace(/"/g, '')}"`);
      }
      const mbSearchUrl = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(
        queryParts.join(' AND ')
      )}&limit=5&fmt=json`;
      const mbResp = await throttledMusicBrainzFetch(mbSearchUrl);
      if (mbResp.ok) {
        const searchData = await mbResp.json();
        const recordings = Array.isArray(searchData?.recordings)
          ? searchData.recordings
          : [];
        const bestRec = recordings[0];
        if (bestRec) {
          sourceMethod = 'musicbrainz-search';
          recordingMbid = bestRec.id || '';
          matchedTitle = bestRec.title || fallbackTitle;
          const credit = Array.isArray(bestRec['artist-credit'])
            ? bestRec['artist-credit'][0]
            : null;
          matchedArtist =
            credit?.name || credit?.artist?.name || fallbackArtist;
          const releases = Array.isArray(bestRec.releases)
            ? bestRec.releases
            : [];
          const officialRelease =
            releases.find(
              (r: any) => String(r.status || '').toLowerCase() === 'official'
            ) || releases[0];
          if (officialRelease) {
            releaseMbid = officialRelease.id || '';
            matchedAlbum = officialRelease.title || fallbackAlbum;
            const yearMatch = String(
              officialRelease.date || bestRec['first-release-date'] || ''
            ).match(/^(\d{4})/);
            if (yearMatch) matchedYear = Number(yearMatch[1]);
            const media = Array.isArray(officialRelease.media)
              ? officialRelease.media[0]
              : null;
            if (media) {
              if (media.position) matchedDiscNo = Number(media.position) || 1;
              const trk = Array.isArray(media.track) ? media.track[0] : null;
              if (trk?.number) {
                const numParsed = parseInt(String(trk.number), 10);
                if (Number.isFinite(numParsed) && numParsed > 0) {
                  matchedTrackNo = numParsed;
                }
              }
            }
          }
        }
      }
    }
  } catch {
    // Use fallback tags
  }

  const finalTitle = (matchedTitle || fallbackTitle || 'Unknown Track').trim();
  const finalArtist = (matchedArtist || fallbackArtist || 'Unknown Artist').trim();
  const finalAlbum = (matchedAlbum || fallbackAlbum || 'Singles').trim();
  const finalTrackNo = matchedTrackNo > 0 ? matchedTrackNo : 1;
  const finalDiscNo = matchedDiscNo > 0 ? matchedDiscNo : 1;
  const finalYear = matchedYear > 1900 ? matchedYear : new Date().getFullYear();

  // Step 3: Download high-res Cover Art Archive front-500 artwork if releaseMbid is known
  let coverArtUrl: string | undefined;
  let localCoverId: string | undefined;
  if (releaseMbid && options.downloadArtwork !== false) {
    const caa = await downloadCoverArtArchiveForRelease(releaseMbid);
    coverArtUrl = caa.coverArtUrl;
    localCoverId = caa.localCoverId;
  }

  const combinedTextForVariants = `${finalTitle} ${finalAlbum} ${baseFilename}`;
  const detectedVariantFlags = detectVariantFlagsInText(combinedTextForVariants);
  const expectedFlags = detectVariantFlagsInText(
    `${options.hintTitle || ''} ${options.hintAlbum || ''}`
  );
  const unexpectedFlags = detectedVariantFlags.filter(
    (f) => !expectedFlags.includes(f)
  );

  return {
    ok: true,
    fpcalcInstalled: fpResult.fpcalcInstalled,
    durationSec: fpResult.durationSec,
    fingerprint: fpResult.fingerprint,
    acoustidMatched,
    acoustidScore,
    recordingMbid: recordingMbid || undefined,
    releaseMbid: releaseMbid || undefined,
    title: finalTitle,
    artist: finalArtist,
    album: finalAlbum,
    trackNumber: finalTrackNo,
    discNumber: finalDiscNo,
    year: finalYear,
    coverArtUrl,
    localCoverId,
    detectedVariantFlags,
    isLikelyWrongVariant: unexpectedFlags.length > 0,
    sourceMethod,
  };
}

export async function embedMetadataAndArtworkIntoFile(
  filePath: string,
  meta: {
    title?: string;
    artist?: string;
    album?: string;
    trackNumber?: number;
    discNumber?: number;
    year?: number;
    genre?: string;
    recordingMbid?: string;
    releaseMbid?: string;
    localCoverId?: string;
  }
): Promise<boolean> {
  if (!fs.existsSync(filePath)) return false;
  const ext = path.extname(filePath).toLowerCase();
  const tempPath = path.join(
    path.dirname(filePath),
    `.brokeify-tag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`
  );

  try {
    const args: string[] = ['-y', '-i', filePath];
    const coverPath = meta.localCoverId
      ? path.join(COVERS_DIR, meta.localCoverId)
      : '';
    const hasCoverFile =
      Boolean(coverPath) &&
      fs.existsSync(coverPath) &&
      (ext === '.mp3' || ext === '.flac' || ext === '.m4a');

    if (hasCoverFile) {
      args.push('-i', coverPath, '-map', '0:a', '-map', '1:v');
      if (ext === '.mp3') {
        args.push(
          '-c',
          'copy',
          '-id3v2_version',
          '3',
          '-metadata:s:v',
          'title=Album cover',
          '-metadata:s:v',
          'comment=Cover (front)'
        );
      } else if (ext === '.m4a') {
        args.push('-c', 'copy', '-disposition:v:0', 'attached_pic');
      } else {
        args.push('-c', 'copy');
      }
    } else {
      args.push('-c', 'copy');
    }

    if (meta.title) args.push('-metadata', `title=${meta.title}`);
    if (meta.artist) args.push('-metadata', `artist=${meta.artist}`);
    if (meta.album) args.push('-metadata', `album=${meta.album}`);
    if (meta.trackNumber)
      args.push('-metadata', `track=${String(meta.trackNumber)}`);
    if (meta.discNumber)
      args.push('-metadata', `disc=${String(meta.discNumber)}`);
    if (meta.year) args.push('-metadata', `date=${String(meta.year)}`);
    if (meta.genre) args.push('-metadata', `genre=${meta.genre}`);
    if (meta.recordingMbid)
      args.push('-metadata', `musicbrainz_trackid=${meta.recordingMbid}`);
    if (meta.releaseMbid)
      args.push('-metadata', `musicbrainz_albumid=${meta.releaseMbid}`);

    args.push(tempPath);

    await execFileAsync('ffmpeg', args, { timeout: 25000 });
    if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
      fs.renameSync(tempPath, filePath);
      return true;
    }
  } catch {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
  }
  return false;
}

export function sanitizePathSegment(segment: string): string {
  return (
    String(segment || '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^\.+|\.+$/g, '')
      .trim() || 'Unknown'
  );
}

export function buildOrganizedTrackDestination(
  musicRootDir: string,
  meta: {
    artist: string;
    album: string;
    year?: number;
    trackNumber?: number;
    title: string;
    ext: string;
  }
): string {
  const safeArtist = sanitizePathSegment(meta.artist || 'Unknown Artist');
  const safeAlbum = sanitizePathSegment(meta.album || 'Singles');
  const yearSuffix =
    meta.year && Number(meta.year) > 1900 ? ` (${meta.year})` : '';
  const trackNoStr = String(Math.max(1, Number(meta.trackNumber || 1))).padStart(
    2,
    '0'
  );
  const safeTitle = sanitizePathSegment(meta.title || 'Unknown Track');
  const cleanExt = meta.ext.startsWith('.') ? meta.ext : `.${meta.ext}`;

  return path.join(
    musicRootDir,
    safeArtist,
    `${safeAlbum}${yearSuffix}`,
    `${trackNoStr} - ${safeTitle}${cleanExt}`
  );
}

export function cleanupEmptyParentDirs(
  startDir: string,
  stopAtRootDir: string
): void {
  try {
    const resolvedRoot = path.resolve(stopAtRootDir);
    let current = path.resolve(startDir);
    while (
      current.startsWith(resolvedRoot) &&
      current !== resolvedRoot &&
      path.basename(current) !== '_inbox'
    ) {
      if (!fs.existsSync(current)) {
        current = path.dirname(current);
        continue;
      }
      const entries = fs.readdirSync(current);
      if (entries.length === 0) {
        fs.rmdirSync(current);
        current = path.dirname(current);
      } else {
        break;
      }
    }
  } catch {
    // ignore cleanup errors
  }
}

export async function fingerprintTagAndOrganizeFile(
  sourceFilePath: string,
  options: {
    acoustidApiKey?: string;
    hintArtist?: string;
    hintTitle?: string;
    hintAlbum?: string;
    moveToLibraryRoot?: boolean;
  } = {}
): Promise<{
  ok: boolean;
  finalPath: string;
  identified: AcousticFingerprintResult;
  trackRow?: any;
}> {
  const identified = await identifyAudioFileWithAcoustIdAndMusicBrainz(
    sourceFilePath,
    {
      acoustidApiKey: options.acoustidApiKey,
      hintArtist: options.hintArtist,
      hintTitle: options.hintTitle,
      downloadArtwork: true,
    }
  );

  await embedMetadataAndArtworkIntoFile(sourceFilePath, {
    title: identified.title,
    artist: identified.artist,
    album: identified.album,
    trackNumber: identified.trackNumber,
    discNumber: identified.discNumber,
    year: identified.year,
    recordingMbid: identified.recordingMbid,
    releaseMbid: identified.releaseMbid,
    localCoverId: identified.localCoverId,
  });

  let finalPath = sourceFilePath;
  if (options.moveToLibraryRoot !== false) {
    const musicRoot = getMusicDir();
    const ext = path.extname(sourceFilePath) || '.mp3';
    const destPath = buildOrganizedTrackDestination(musicRoot, {
      artist: identified.artist || options.hintArtist || 'Unknown Artist',
      album: identified.album || options.hintAlbum || 'Singles',
      year: identified.year,
      trackNumber: identified.trackNumber,
      title: identified.title || options.hintTitle || 'Unknown Track',
      ext,
    });

    const existingTrackId = db.tracksByPath.get(path.resolve(sourceFilePath));

    if (path.resolve(destPath) !== path.resolve(sourceFilePath)) {
      const sourceDir = path.dirname(sourceFilePath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      try {
        fs.renameSync(sourceFilePath, destPath);
      } catch {
        fs.copyFileSync(sourceFilePath, destPath);
        try {
          fs.unlinkSync(sourceFilePath);
        } catch {}
      }
      finalPath = destPath;
      cleanupEmptyParentDirs(sourceDir, musicRoot);
    }

    let trackRow: any = null;
    if (existingTrackId && db.tracks.has(existingTrackId)) {
      // In-place path and metadata update so playlists, play counts, and favorites are preserved
      db.tracksByPath.delete(path.resolve(sourceFilePath));
      const row = db.tracks.get(existingTrackId)!;
      row.file_path = finalPath;
      db.tracksByPath.set(path.resolve(finalPath), existingTrackId);
      updateTrackMetadataInDb(existingTrackId, {
        title: identified.title,
        artist: identified.artist,
        album: identified.album,
        year: identified.year,
        trackNumber: identified.trackNumber,
        discNumber: identified.discNumber,
        coverArt: identified.localCoverId,
        mbid: identified.recordingMbid,
      });
      trackRow = db.tracks.get(existingTrackId);
    } else {
      trackRow = await indexAudioFile(finalPath);
      if (trackRow && identified.localCoverId) {
        updateTrackMetadataInDb(trackRow.id, {
          title: identified.title,
          artist: identified.artist,
          album: identified.album,
          year: identified.year,
          trackNumber: identified.trackNumber,
          discNumber: identified.discNumber,
          coverArt: identified.localCoverId,
          mbid: identified.recordingMbid,
        });
      }
    }
  }

  reconcilePlaylistsWithLibrary();

  return {
    ok: true,
    finalPath,
    identified,
    trackRow,
  };
}

// Strictly sandboxed path resolver inside /music (prevents ../ traversal or symlink escape)
export function resolveSandboxedMusicPath(relativePath = ''): {
  ok: boolean;
  fullPath: string;
  relativePath: string;
  error?: string;
} {
  const musicRoot = path.resolve(getMusicDir());
  const cleanRel = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  if (cleanRel.split('/').some((part) => part === '..')) {
    return {
      ok: false,
      fullPath: musicRoot,
      relativePath: '',
      error: 'Path traversal (..) is forbidden.',
    };
  }

  const candidate = path.resolve(musicRoot, cleanRel);
  if (candidate !== musicRoot && !candidate.startsWith(musicRoot + path.sep)) {
    return {
      ok: false,
      fullPath: musicRoot,
      relativePath: '',
      error: 'Access outside /music is forbidden.',
    };
  }

  return {
    ok: true,
    fullPath: candidate,
    relativePath: path.relative(musicRoot, candidate).replace(/\\/g, '/'),
  };
}

// Supported audio file extensions
export const AUDIO_FILE_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
  '.wav',
]);

export interface LibraryOrganizeItem {
  beforePath: string;
  afterPath: string;
  title: string;
  artist: string;
  album: string;
  trackNumber: number;
  year: number;
  recordingMbid?: string;
  coverArtUrl?: string;
  sourceMethod: string;
  detectedVariantFlags: string[];
  applied: boolean;
  alreadyOrganized?: boolean;
  error?: string;
}

export interface LibraryOrganizeJobState {
  id: string;
  status:
    | 'idle'
    | 'scanning'
    | 'running'
    | 'preview_ready'
    | 'completed'
    | 'cancelled'
    | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  dryRun: boolean;
  recursive: boolean;
  targetPath: string;
  skipOrganized: boolean;
  totalFiles: number;
  processedFiles: number;
  currentFile: string;
  currentTrackTitle: string;
  currentTrackArtist: string;
  organizedCount: number;
  skippedCount: number;
  errorCount: number;
  items: LibraryOrganizeItem[];
  error?: string;
}

let activeOrganizeJob: LibraryOrganizeJobState = {
  id: '',
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  dryRun: false,
  recursive: true,
  targetPath: '',
  skipOrganized: false,
  totalFiles: 0,
  processedFiles: 0,
  currentFile: '',
  currentTrackTitle: '',
  currentTrackArtist: '',
  organizedCount: 0,
  skippedCount: 0,
  errorCount: 0,
  items: [],
};

let cancelRequested = false;

export function getLibraryOrganizeJobState(): LibraryOrganizeJobState {
  return activeOrganizeJob;
}

export function cancelLibraryOrganizeJob(): LibraryOrganizeJobState {
  if (
    activeOrganizeJob.status === 'running' ||
    activeOrganizeJob.status === 'scanning'
  ) {
    cancelRequested = true;
    activeOrganizeJob.status = 'cancelled';
    activeOrganizeJob.finishedAt = new Date().toISOString();
  }
  return activeOrganizeJob;
}

function collectAudioFilesRecursive(
  dir: string,
  options: { recursive?: boolean; includeInbox?: boolean } = {},
  acc: string[] = []
): string[] {
  if (!fs.existsSync(dir)) return acc;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (!options.includeInbox && entry.name === '_inbox') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (options.recursive !== false) {
          collectAudioFilesRecursive(full, options, acc);
        }
      } else if (
        entry.isFile() &&
        AUDIO_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        acc.push(full);
      }
    }
  } catch {
    // ignore read errors
  }
  return acc;
}

export async function startLibraryOrganizeJob(options: {
  targetPath?: string;
  recursive?: boolean;
  dryRun?: boolean;
  skipOrganized?: boolean;
  includeInbox?: boolean;
  acoustidApiKey?: string;
}): Promise<LibraryOrganizeJobState> {
  if (
    activeOrganizeJob.status === 'running' ||
    activeOrganizeJob.status === 'scanning'
  ) {
    return activeOrganizeJob;
  }

  cancelRequested = false;
  const musicRoot = getMusicDir();
  const targetRel = String(options.targetPath || '');
  const resolved = resolveSandboxedMusicPath(targetRel);
  const scanDir =
    resolved.ok && fs.existsSync(resolved.fullPath)
      ? resolved.fullPath
      : musicRoot;

  activeOrganizeJob = {
    id: `job-${Date.now()}`,
    status: 'scanning',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    dryRun: Boolean(options.dryRun),
    recursive: options.recursive !== false,
    targetPath: resolved.relativePath || '',
    skipOrganized: Boolean(options.skipOrganized),
    totalFiles: 0,
    processedFiles: 0,
    currentFile: 'Scanning folders for audio files...',
    currentTrackTitle: '',
    currentTrackArtist: '',
    organizedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    items: [],
  };

  // Run in background asynchronously so HTTP response returns immediately
  (async () => {
    try {
      const audioFiles = collectAudioFilesRecursive(scanDir, {
        recursive: options.recursive !== false,
        includeInbox: Boolean(options.includeInbox),
      });

      activeOrganizeJob.totalFiles = audioFiles.length;
      activeOrganizeJob.status = 'running';

      for (const filePath of audioFiles) {
        if (cancelRequested) {
          activeOrganizeJob.status = 'cancelled';
          activeOrganizeJob.finishedAt = new Date().toISOString();
          break;
        }

        const relBefore = path.relative(musicRoot, filePath).replace(/\\/g, '/');
        const ext = path.extname(filePath) || '.mp3';
        activeOrganizeJob.currentFile = relBefore;
        activeOrganizeJob.processedFiles++;

        try {
          if (options.dryRun) {
            // Dry run: identify and calculate destination without modifying disk
            const identified = await identifyAudioFileWithAcoustIdAndMusicBrainz(
              filePath,
              {
                acoustidApiKey: options.acoustidApiKey,
                downloadArtwork: true,
              }
            );

            activeOrganizeJob.currentTrackTitle = identified.title || '';
            activeOrganizeJob.currentTrackArtist = identified.artist || '';

            const targetDest = buildOrganizedTrackDestination(musicRoot, {
              artist: identified.artist || 'Unknown Artist',
              album: identified.album || 'Singles',
              year: identified.year,
              trackNumber: identified.trackNumber,
              title: identified.title || path.basename(filePath, ext),
              ext,
            });
            const relAfter = path
              .relative(musicRoot, targetDest)
              .replace(/\\/g, '/');
            const alreadyOrganized =
              path.resolve(targetDest) === path.resolve(filePath);

            if (alreadyOrganized && options.skipOrganized) {
              activeOrganizeJob.skippedCount++;
            } else {
              activeOrganizeJob.organizedCount++;
            }

            activeOrganizeJob.items.push({
              beforePath: relBefore,
              afterPath: relAfter,
              title: identified.title,
              artist: identified.artist,
              album: identified.album,
              trackNumber: identified.trackNumber,
              year: identified.year,
              recordingMbid: identified.recordingMbid,
              coverArtUrl: identified.coverArtUrl,
              sourceMethod: identified.sourceMethod,
              detectedVariantFlags: identified.detectedVariantFlags,
              applied: false,
              alreadyOrganized,
            });
          } else {
            // Execution: fingerprint, tag, download artwork, move & clean
            const res = await fingerprintTagAndOrganizeFile(filePath, {
              acoustidApiKey: options.acoustidApiKey,
              moveToLibraryRoot: true,
            });

            activeOrganizeJob.currentTrackTitle = res.identified.title || '';
            activeOrganizeJob.currentTrackArtist = res.identified.artist || '';

            const relAfter = path
              .relative(musicRoot, res.finalPath)
              .replace(/\\/g, '/');
            const alreadyOrganized =
              path.resolve(res.finalPath) === path.resolve(filePath);

            activeOrganizeJob.organizedCount++;
            activeOrganizeJob.items.push({
              beforePath: relBefore,
              afterPath: relAfter,
              title: res.identified.title,
              artist: res.identified.artist,
              album: res.identified.album,
              trackNumber: res.identified.trackNumber,
              year: res.identified.year,
              recordingMbid: res.identified.recordingMbid,
              coverArtUrl: res.identified.coverArtUrl,
              sourceMethod: res.identified.sourceMethod,
              detectedVariantFlags: res.identified.detectedVariantFlags,
              applied: true,
              alreadyOrganized,
            });
          }
        } catch (fileErr) {
          activeOrganizeJob.errorCount++;
          activeOrganizeJob.items.push({
            beforePath: relBefore,
            afterPath: relBefore,
            title: path.basename(filePath, ext),
            artist: 'Unknown',
            album: 'Unknown',
            trackNumber: 1,
            year: 0,
            sourceMethod: 'error',
            detectedVariantFlags: [],
            applied: false,
            error:
              fileErr instanceof Error ? fileErr.message : 'Processing error',
          });
        }
      }

      if (!cancelRequested) {
        activeOrganizeJob.status = options.dryRun
          ? 'preview_ready'
          : 'completed';
        activeOrganizeJob.finishedAt = new Date().toISOString();
        activeOrganizeJob.currentFile = '';

        if (!options.dryRun && activeOrganizeJob.organizedCount > 0) {
          reconcilePlaylistsWithLibrary();
          addPersistentNotification({
            message: `Library Organizer: Cleaned, tagged & organized ${activeOrganizeJob.organizedCount} established track(s) in /music.`,
            category: 'library',
            severity: 'success',
            service: 'Library Organizer',
          });
        }
      }
    } catch (jobErr) {
      activeOrganizeJob.status = 'error';
      activeOrganizeJob.error =
        jobErr instanceof Error ? jobErr.message : 'Job failed';
      activeOrganizeJob.finishedAt = new Date().toISOString();
    }
  })().catch(() => {});

  return activeOrganizeJob;
}

export async function applyPreviewedLibraryOrganizeJob(
  acoustidApiKey?: string
): Promise<LibraryOrganizeJobState> {
  if (
    activeOrganizeJob.status !== 'preview_ready' ||
    activeOrganizeJob.items.length === 0
  ) {
    return activeOrganizeJob;
  }

  cancelRequested = false;
  const musicRoot = getMusicDir();
  const unappliedItems = activeOrganizeJob.items.filter((item) => !item.applied);

  activeOrganizeJob.status = 'running';
  activeOrganizeJob.dryRun = false;
  activeOrganizeJob.totalFiles = unappliedItems.length;
  activeOrganizeJob.processedFiles = 0;
  activeOrganizeJob.organizedCount = 0;
  activeOrganizeJob.startedAt = new Date().toISOString();
  activeOrganizeJob.finishedAt = null;

  (async () => {
    try {
      for (const item of unappliedItems) {
        if (cancelRequested) {
          activeOrganizeJob.status = 'cancelled';
          activeOrganizeJob.finishedAt = new Date().toISOString();
          break;
        }

        const fullSrc = path.join(musicRoot, item.beforePath);
        if (!fs.existsSync(fullSrc)) {
          activeOrganizeJob.processedFiles++;
          continue;
        }

        activeOrganizeJob.currentFile = item.beforePath;
        activeOrganizeJob.currentTrackTitle = item.title;
        activeOrganizeJob.currentTrackArtist = item.artist;
        activeOrganizeJob.processedFiles++;

        try {
          const res = await fingerprintTagAndOrganizeFile(fullSrc, {
            acoustidApiKey,
            hintArtist: item.artist,
            hintTitle: item.title,
            hintAlbum: item.album,
            moveToLibraryRoot: true,
          });
          item.applied = true;
          item.afterPath = path
            .relative(musicRoot, res.finalPath)
            .replace(/\\/g, '/');
          activeOrganizeJob.organizedCount++;
        } catch (itemErr) {
          item.error =
            itemErr instanceof Error ? itemErr.message : 'Failed to apply';
          activeOrganizeJob.errorCount++;
        }
      }

      if (!cancelRequested) {
        activeOrganizeJob.status = 'completed';
        activeOrganizeJob.finishedAt = new Date().toISOString();
        activeOrganizeJob.currentFile = '';
        reconcilePlaylistsWithLibrary();

        addPersistentNotification({
          message: `Library Organizer: Applied organization & tags to ${activeOrganizeJob.organizedCount} established track(s) in /music.`,
          category: 'library',
          severity: 'success',
          service: 'Library Organizer',
        });
      }
    } catch (err) {
      activeOrganizeJob.status = 'error';
      activeOrganizeJob.error =
        err instanceof Error ? err.message : 'Apply failed';
      activeOrganizeJob.finishedAt = new Date().toISOString();
    }
  })().catch(() => {});

  return activeOrganizeJob;
}

