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
  isSafePathWithinAllowedRootsStrict,
  reconcilePlaylistsWithLibrary,
  updateTrackMetadataInDb,
  addPersistentNotification,
} from './libraryEngine.ts';

const execFileAsync = promisify(execFile);

export const QUARANTINE_DIR = path.join(DATA_DIR, 'quarantine');

export async function ensureQuarantineDir(): Promise<string> {
  await fs.promises.mkdir(QUARANTINE_DIR, { recursive: true });
  return QUARANTINE_DIR;
}

async function pathExistsAsync(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export class AsyncWorkerPool {
  private activeCount = 0;
  private waitQueue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => {
        this.waitQueue.push(resolve);
      });
    }
    this.activeCount += 1;
    try {
      return await task();
    } finally {
      this.activeCount = Math.max(0, this.activeCount - 1);
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }
}

export const fpcalcWorkerPool = new AsyncWorkerPool(2);
export const ffmpegTagWorkerPool = new AsyncWorkerPool(2);
export const ytDlpWorkerPool = new AsyncWorkerPool(2);

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
  const resolvedPath = path.resolve(String(filePath || ''));
  if (!(await isSafePathWithinAllowedRootsStrict(resolvedPath))) {
    return {
      ok: false,
      fpcalcInstalled: false,
      durationSec: 0,
      fingerprint: '',
    };
  }

  try {
    const { stdout } = await fpcalcWorkerPool.run(() =>
      execFileAsync('fpcalc', ['-json', resolvedPath], {
        timeout: 20000,
        shell: false,
        windowsHide: true,
      })
    );
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
    const meta = await parseFile(resolvedPath, { duration: true, skipCovers: true });
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
  const cleanMbid = String(releaseMbid || '').trim();
  if (!cleanMbid || !/^[0-9a-f-]{8,64}$/i.test(cleanMbid)) return {};
  const caaUrl = `https://coverartarchive.org/release/${encodeURIComponent(
    cleanMbid
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

    const coverId = `caa-${cleanMbid}.jpg`;
    const destPath = path.join(COVERS_DIR, coverId);
    await fs.promises.mkdir(COVERS_DIR, { recursive: true });
    await fs.promises.writeFile(destPath, buffer);
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

function sanitizeMetadataValue(val: unknown): string {
  return String(val ?? '')
    .replace(/[\x00\r\n]/g, ' ')
    .trim();
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
    artistMbid?: string;
    localCoverId?: string;
  },
  coverFilePathOverride?: string
): Promise<boolean> {
  const resolvedFilePath = path.resolve(String(filePath || ''));
  if (!(await isSafePathWithinAllowedRootsStrict(resolvedFilePath))) {
    return false;
  }
  if (!(await pathExistsAsync(resolvedFilePath))) return false;
  const ext = path.extname(resolvedFilePath).toLowerCase();
  const tempPath = path.join(
    path.dirname(resolvedFilePath),
    `.brokeify-tag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`
  );

  try {
    const args: string[] = ['-y', '-i', resolvedFilePath];
    let coverPath = '';
    if (coverFilePathOverride) {
      const candidateOverride = path.resolve(String(coverFilePathOverride));
      if (await isSafePathWithinAllowedRootsStrict(candidateOverride)) {
        coverPath = candidateOverride;
      }
    } else if (meta.localCoverId) {
      const safeCoverName = path.basename(String(meta.localCoverId));
      const candidateLocal = path.join(COVERS_DIR, safeCoverName);
      if (await isSafePathWithinAllowedRootsStrict(candidateLocal)) {
        coverPath = candidateLocal;
      }
    }

    const hasCoverFile =
      Boolean(coverPath) &&
      (await pathExistsAsync(coverPath)) &&
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

    if (meta.title) args.push('-metadata', `title=${sanitizeMetadataValue(meta.title)}`);
    if (meta.artist) args.push('-metadata', `artist=${sanitizeMetadataValue(meta.artist)}`);
    if (meta.album) args.push('-metadata', `album=${sanitizeMetadataValue(meta.album)}`);
    if (meta.trackNumber)
      args.push('-metadata', `track=${String(Math.max(1, Number(meta.trackNumber) || 1))}`);
    if (meta.discNumber)
      args.push('-metadata', `disc=${String(Math.max(1, Number(meta.discNumber) || 1))}`);
    if (meta.year) args.push('-metadata', `date=${String(Number(meta.year) || '')}`);
    if (meta.genre) args.push('-metadata', `genre=${sanitizeMetadataValue(meta.genre)}`);
    if (meta.recordingMbid)
      args.push('-metadata', `musicbrainz_trackid=${sanitizeMetadataValue(meta.recordingMbid)}`);
    if (meta.releaseMbid)
      args.push('-metadata', `musicbrainz_albumid=${sanitizeMetadataValue(meta.releaseMbid)}`);
    if (meta.artistMbid)
      args.push('-metadata', `musicbrainz_artistid=${sanitizeMetadataValue(meta.artistMbid)}`);

    args.push(tempPath);

    await ffmpegTagWorkerPool.run(() =>
      execFileAsync('ffmpeg', args, {
        timeout: 25000,
        shell: false,
        windowsHide: true,
      })
    );
    if (await pathExistsAsync(tempPath)) {
      const st = await fs.promises.stat(tempPath);
      if (st.size > 0) {
        await fs.promises.rename(tempPath, resolvedFilePath);
        return true;
      }
    }
  } catch {
    try {
      if (await pathExistsAsync(tempPath)) {
        await fs.promises.unlink(tempPath);
      }
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

export function sanitizeSingleSegmentName(rawName: string): {
  ok: boolean;
  name: string;
  error?: string;
} {
  const str = String(rawName || '');
  if (!str.trim()) {
    return { ok: false, name: '', error: 'Name is required.' };
  }
  if (
    str.includes('\0') ||
    str.includes('/') ||
    str.includes('\\') ||
    /%2e/i.test(str) ||
    /%2f/i.test(str) ||
    /%5c/i.test(str)
  ) {
    return {
      ok: false,
      name: '',
      error: 'Single file or folder name cannot contain path separators or traversal.',
    };
  }
  const cleaned = str
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return { ok: false, name: '', error: 'Invalid file or folder name.' };
  }
  return { ok: true, name: cleaned };
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

export async function cleanupEmptyParentDirs(
  startDir: string,
  stopAtRootDir: string
): Promise<void> {
  try {
    const resolvedRoot = path.resolve(stopAtRootDir);
    let current = path.resolve(startDir);
    while (
      current.startsWith(resolvedRoot + path.sep) &&
      current !== resolvedRoot &&
      path.basename(current) !== '_inbox'
    ) {
      if (!(await pathExistsAsync(current))) {
        current = path.dirname(current);
        continue;
      }
      const entries = await fs.promises.readdir(current);
      if (entries.length === 0) {
        await fs.promises.rmdir(current);
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
  const resolvedSource = path.resolve(String(sourceFilePath || ''));
  if (!(await isSafePathWithinAllowedRootsStrict(resolvedSource))) {
    throw new Error('Source audio path is outside allowed music/staging directories.');
  }

  const identified = await identifyAudioFileWithAcoustIdAndMusicBrainz(
    resolvedSource,
    {
      acoustidApiKey: options.acoustidApiKey,
      hintArtist: options.hintArtist,
      hintTitle: options.hintTitle,
      downloadArtwork: true,
    }
  );

  await embedMetadataAndArtworkIntoFile(resolvedSource, {
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

  let finalPath = resolvedSource;
  if (options.moveToLibraryRoot !== false) {
    const musicRoot = getMusicDir();
    const ext = path.extname(resolvedSource) || '.mp3';
    const destPath = buildOrganizedTrackDestination(musicRoot, {
      artist: identified.artist || options.hintArtist || 'Unknown Artist',
      album: identified.album || options.hintAlbum || 'Singles',
      year: identified.year,
      trackNumber: identified.trackNumber,
      title: identified.title || options.hintTitle || 'Unknown Track',
      ext,
    });

    const existingTrackId = db.tracksByPath.get(resolvedSource);

    if (path.resolve(destPath) !== resolvedSource) {
      const sourceDir = path.dirname(resolvedSource);
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      try {
        await fs.promises.rename(resolvedSource, destPath);
      } catch {
        await fs.promises.copyFile(resolvedSource, destPath);
        try {
          await fs.promises.unlink(resolvedSource);
        } catch {}
      }
      finalPath = destPath;
      await cleanupEmptyParentDirs(sourceDir, musicRoot);
    }

    let trackRow: any = null;
    if (existingTrackId && db.tracks.has(existingTrackId)) {
      // In-place path and metadata update so playlists, play counts, and favorites are preserved
      db.tracksByPath.delete(resolvedSource);
      const row = db.tracks.get(existingTrackId)!;
      row.file_path = finalPath;
      db.tracksByPath.set(path.resolve(finalPath), existingTrackId);
      await updateTrackMetadataInDb({
        trackId: existingTrackId,
        title: identified.title,
        artist: identified.artist,
        album: identified.album,
        year: identified.year,
        trackNumber: identified.trackNumber,
        discNumber: identified.discNumber,
        musicbrainzId: identified.recordingMbid,
      });
      trackRow = db.tracks.get(existingTrackId);
    } else {
      const indexedId = await indexAudioFile(finalPath);
      if (indexedId) {
        await updateTrackMetadataInDb({
          trackId: indexedId,
          title: identified.title,
          artist: identified.artist,
          album: identified.album,
          year: identified.year,
          trackNumber: identified.trackNumber,
          discNumber: identified.discNumber,
          musicbrainzId: identified.recordingMbid,
        });
        trackRow = db.tracks.get(indexedId);
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

// Strictly sandboxed path resolver inside /music (prevents ../ traversal, null bytes, encoded traversal & symlink escape)
export function resolveSandboxedMusicPath(relativePath = ''): {
  ok: boolean;
  fullPath: string;
  relativePath: string;
  error?: string;
} {
  const musicRoot = path.resolve(getMusicDir());
  const rawInput = String(relativePath || '');
  if (
    rawInput.includes('\0') ||
    /%2e/i.test(rawInput) ||
    /%2f/i.test(rawInput) ||
    /%5c/i.test(rawInput)
  ) {
    return {
      ok: false,
      fullPath: musicRoot,
      relativePath: '',
      error: 'Invalid or encoded traversal sequence in path.',
    };
  }

  const cleanRel = rawInput.replace(/\\/g, '/').replace(/^\/+/, '');
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

async function resolveRealPathWithTail(targetPath: string): Promise<string> {
  let cursor = path.resolve(targetPath);
  const missingTail: string[] = [];
  while (true) {
    try {
      const realBase = await fs.promises.realpath(cursor);
      return missingTail.length > 0
        ? path.resolve(realBase, ...missingTail.reverse())
        : realBase;
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) return path.resolve(targetPath);
      missingTail.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

export async function resolveSandboxedMusicPathStrict(
  relativePath = '',
  options: { requireInbox?: boolean } = {}
): Promise<{
  ok: boolean;
  fullPath: string;
  relativePath: string;
  error?: string;
}> {
  const lexical = resolveSandboxedMusicPath(relativePath);
  if (!lexical.ok) return lexical;

  const musicRoot = path.resolve(getMusicDir());
  const realRoot = await resolveRealPathWithTail(musicRoot);
  const realCandidate = await resolveRealPathWithTail(lexical.fullPath);

  if (
    realCandidate !== realRoot &&
    !realCandidate.startsWith(realRoot + path.sep)
  ) {
    return {
      ok: false,
      fullPath: musicRoot,
      relativePath: '',
      error: 'Symlink escape outside /music is forbidden.',
    };
  }

  if (options.requireInbox) {
    const inboxRoot = path.resolve(musicRoot, '_inbox');
    if (
      lexical.fullPath !== inboxRoot &&
      !lexical.fullPath.startsWith(inboxRoot + path.sep)
    ) {
      return {
        ok: false,
        fullPath: musicRoot,
        relativePath: '',
        error: 'Operation restricted to /music/_inbox staging folder.',
      };
    }
  }

  return lexical;
}

export async function resolveSandboxedStagingDir(
  rawStagingDir?: string
): Promise<string> {
  const musicRoot = path.resolve(getMusicDir());
  const defaultInbox = path.join(musicRoot, '_inbox');
  const raw = String(rawStagingDir || '').trim();
  if (!raw) return defaultInbox;
  if (raw.includes('\0') || /%2e/i.test(raw)) return defaultInbox;

  const allowedBases = [musicRoot, path.resolve('/downloads')];
  const candidate = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(musicRoot, raw);

  const realCandidate = await resolveRealPathWithTail(candidate);
  for (const base of allowedBases) {
    const realBase = await resolveRealPathWithTail(base);
    if (
      (candidate === base || candidate.startsWith(base + path.sep)) &&
      (realCandidate === realBase || realCandidate.startsWith(realBase + path.sep))
    ) {
      return candidate;
    }
  }
  return defaultInbox;
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

async function collectAudioFilesRecursive(
  dir: string,
  options: { recursive?: boolean; includeInbox?: boolean } = {},
  acc: string[] = []
): Promise<string[]> {
  if (!(await pathExistsAsync(dir))) return acc;
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (!options.includeInbox && entry.name === '_inbox') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (options.recursive !== false) {
          await collectAudioFilesRecursive(full, options, acc);
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
  const resolved = await resolveSandboxedMusicPathStrict(targetRel);
  if (!resolved.ok) {
    throw new Error(resolved.error || 'Target path outside /music is forbidden.');
  }
  const scanDir = (await pathExistsAsync(resolved.fullPath))
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
      const audioFiles = await collectAudioFilesRecursive(scanDir, {
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

        const resolvedSrc = await resolveSandboxedMusicPathStrict(
          item.beforePath
        );
        if (!resolvedSrc.ok || !(await pathExistsAsync(resolvedSrc.fullPath))) {
          activeOrganizeJob.processedFiles++;
          continue;
        }
        const fullSrc = resolvedSrc.fullPath;

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

