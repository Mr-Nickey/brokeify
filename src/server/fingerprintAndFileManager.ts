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
  cleanArtistName,
  cleanTrackNumberPrefixFromFilename,
  splitArtistAndTitleFromStem,
  setOrganizerActiveState,
  pruneOrphanedAlbumsAndArtists,
  syncDatabaseToPersistentDisk,
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

const mbSearchCache = new Map<
  string,
  {
    recordingMbid: string;
    releaseMbid: string;
    title: string;
    artist: string;
    album: string;
    trackNo: number;
    discNo: number;
    year: number;
  }
>();

export async function identifyAudioFileWithAcoustIdAndMusicBrainz(
  filePath: string,
  options: {
    acoustidApiKey?: string;
    hintArtist?: string;
    hintTitle?: string;
    hintAlbum?: string;
    downloadArtwork?: boolean;
    skipExternalLookupIfTagged?: boolean;
  } = {}
): Promise<AcousticFingerprintResult> {
  const acoustidKey = String(
    options.acoustidApiKey || process.env.ACOUSTID_API_KEY || ''
  ).trim();

  let parsedMeta: any = null;
  try {
    parsedMeta = await parseFile(filePath, { duration: true, skipCovers: true });
  } catch {
    // ignore
  }

  const rawStem = path.basename(filePath, path.extname(filePath)).trim();
  const strippedPrefix = cleanTrackNumberPrefixFromFilename(rawStem, 1);
  const baseFilename = strippedPrefix.stem;
  const splitPair = splitArtistAndTitleFromStem(baseFilename);

  const rawFallbackArtist =
    options.hintArtist ||
    parsedMeta?.common?.artist ||
    parsedMeta?.common?.albumartist ||
    (splitPair ? splitPair.artist : '');
  const fallbackArtist = rawFallbackArtist
    ? cleanArtistName(rawFallbackArtist)
    : '';
  const fallbackTitle = (
    options.hintTitle ||
    parsedMeta?.common?.title ||
    (splitPair ? splitPair.title : baseFilename)
  ).trim();
  const fallbackAlbum = (
    options.hintAlbum ||
    parsedMeta?.common?.album ||
    ''
  ).trim();
  const fallbackTrackNo = Number(
    parsedMeta?.common?.track?.no || strippedPrefix.trackNumber || 1
  );
  const fallbackDiscNo = Number(parsedMeta?.common?.disk?.no || 1);
  const fallbackYear = Number(parsedMeta?.common?.year || 0);

  const hasCompleteLocalTags =
    Boolean(parsedMeta?.common?.title?.trim()) &&
    Boolean(
      parsedMeta?.common?.artist?.trim() ||
        parsedMeta?.common?.albumartist?.trim()
    ) &&
    Boolean(parsedMeta?.common?.album?.trim()) &&
    fallbackArtist !== 'Unknown Artist';

  // Only run fpcalc if an AcoustID API key is actually configured or local tags are missing
  const fpResult =
    acoustidKey || !hasCompleteLocalTags
      ? await runFpcalcOnFile(filePath)
      : {
          ok: false,
          fpcalcInstalled: false,
          durationSec: Math.round(Number(parsedMeta?.format?.duration || 0)),
          fingerprint: '',
        };

  let recordingMbid = String(parsedMeta?.common?.musicbrainz_recordingid || '');
  let releaseMbid = String(parsedMeta?.common?.musicbrainz_albumid || '');
  let matchedTitle = '';
  let matchedArtist = '';
  let matchedAlbum = '';
  let matchedTrackNo = fallbackTrackNo;
  let matchedDiscNo = fallbackDiscNo;
  let matchedYear = fallbackYear;
  let acoustidMatched = false;
  let acoustidScore = 0;
  let sourceMethod: AcousticFingerprintResult['sourceMethod'] = 'file-tags';

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
            matchedArtist = cleanArtistName(String(rec.artists[0].name));
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

  const shouldQueryMusicBrainz = !(
    options.skipExternalLookupIfTagged &&
    hasCompleteLocalTags &&
    fallbackYear > 1900
  );

  // Step 2: Query MusicBrainz WS/2 (strictly throttled 1 req/sec with 503 backoff + in-memory cache)
  if (shouldQueryMusicBrainz) {
    try {
      const cacheKey = `${fallbackArtist.toLowerCase()}::${fallbackTitle.toLowerCase()}`;
      const cachedMb = !recordingMbid ? mbSearchCache.get(cacheKey) : undefined;

      if (cachedMb) {
        sourceMethod = 'musicbrainz-search';
        recordingMbid = cachedMb.recordingMbid;
        releaseMbid = cachedMb.releaseMbid;
        matchedTitle = cachedMb.title || fallbackTitle;
        matchedArtist = cleanArtistName(cachedMb.artist || fallbackArtist);
        matchedAlbum = cachedMb.album || fallbackAlbum;
        matchedTrackNo = cachedMb.trackNo || fallbackTrackNo;
        matchedDiscNo = cachedMb.discNo || fallbackDiscNo;
        matchedYear = cachedMb.year || fallbackYear;
      } else if (recordingMbid) {
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
            matchedArtist = cleanArtistName(credit.name || credit.artist.name);
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
        if (fallbackArtist && fallbackArtist !== 'Unknown Artist') {
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
            matchedArtist = cleanArtistName(
              credit?.name || credit?.artist?.name || fallbackArtist
            );
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
            if (mbSearchCache.size > 2000) {
              mbSearchCache.clear();
            }
            mbSearchCache.set(cacheKey, {
              recordingMbid,
              releaseMbid,
              title: matchedTitle,
              artist: matchedArtist,
              album: matchedAlbum,
              trackNo: matchedTrackNo,
              discNo: matchedDiscNo,
              year: matchedYear,
            });
          }
        }
      }
    } catch {
      // Use fallback tags
    }
  }

  const finalTitle = (matchedTitle || fallbackTitle || 'Unknown Track').trim();
  const finalArtist = cleanArtistName(
    matchedArtist || fallbackArtist || 'Unknown Artist'
  );
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

/**
 * Robustly moves a file across folders on local, NAS, or Docker-to-Windows external drives.
 * Retries transient EBUSY/EPERM locks, falls back to copyFile + verified unlink, and rolls back
 * destination if the source file cannot be unlinked so duplicates are never silently left behind.
 */
export async function moveFileCleanlyWithVerify(
  sourcePath: string,
  destPath: string
): Promise<{
  moved: boolean;
  method: 'rename' | 'copy+unlink' | 'noop';
  sourceRemoved: boolean;
}> {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedDest = path.resolve(destPath);
  if (resolvedSource === resolvedDest) {
    return { moved: false, method: 'noop', sourceRemoved: true };
  }

  await fs.promises.mkdir(path.dirname(resolvedDest), { recursive: true });

  // Attempt 1: Native atomic rename with short retry for transient Windows/SMB handle locks
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.promises.rename(resolvedSource, resolvedDest);
      if (
        (await pathExistsAsync(resolvedDest)) &&
        !(await pathExistsAsync(resolvedSource))
      ) {
        return { moved: true, method: 'rename', sourceRemoved: true };
      }
      // If rename succeeded on POSIX/NTFS but source still appears due to mount caching, unlink source
      if (await pathExistsAsync(resolvedSource)) {
        try {
          await fs.promises.unlink(resolvedSource);
        } catch {}
      }
      if (!(await pathExistsAsync(resolvedSource))) {
        return { moved: true, method: 'rename', sourceRemoved: true };
      }
    } catch (err: any) {
      if (err?.code === 'EXDEV') break;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
      }
    }
  }

  // Attempt 2: Cross-mount or locked fallback: copy to temp in destination dir, rename to dest, then verified unlink of source
  const destExistedBefore = await pathExistsAsync(resolvedDest);
  const ext = path.extname(resolvedDest);
  const tempDest = path.join(
    path.dirname(resolvedDest),
    `.brokeify-move-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`
  );

  await fs.promises.copyFile(resolvedSource, tempDest);
  const tempStat = await fs.promises.stat(tempDest);
  if (tempStat.size === 0) {
    try {
      await fs.promises.unlink(tempDest);
    } catch {}
    throw new Error(`Destination copy produced 0-byte file at ${resolvedDest}`);
  }

  try {
    await fs.promises.rename(tempDest, resolvedDest);
  } catch {
    await fs.promises.copyFile(tempDest, resolvedDest);
    try {
      await fs.promises.unlink(tempDest);
    } catch {}
  }

  // Now delete the original source file with retries + chmod 0o666 for Windows read-only bits
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!(await pathExistsAsync(resolvedSource))) break;
    try {
      if (attempt > 0) {
        try {
          await fs.promises.chmod(resolvedSource, 0o666);
        } catch {}
      }
      await fs.promises.unlink(resolvedSource);
      break;
    } catch {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      }
    }
  }

  const sourceStillExists = await pathExistsAsync(resolvedSource);
  if (sourceStillExists) {
    // Roll back destination if it didn't exist before so we never leave a duplicate behind
    if (!destExistedBefore) {
      try {
        await fs.promises.unlink(resolvedDest);
      } catch {}
    }
    throw new Error(
      `Source file could not be removed after copy (${resolvedSource}). Rolled back move to prevent duplicate files — check Docker-to-Windows volume write/delete permissions.`
    );
  }

  return { moved: true, method: 'copy+unlink', sourceRemoved: true };
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

    const cleanedArtist = meta.artist
      ? cleanArtistName(meta.artist)
      : undefined;

    if (meta.title) args.push('-metadata', `title=${sanitizeMetadataValue(meta.title)}`);
    if (cleanedArtist)
      args.push('-metadata', `artist=${sanitizeMetadataValue(cleanedArtist)}`);
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
        await moveFileCleanlyWithVerify(tempPath, resolvedFilePath);
        return true;
      }
    }
  } catch {
    // Non-fatal if ffmpeg fails or file is read-only; clean up temp file
  } finally {
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
  // Always strip leading track/compilation numbers (e.g. "128. Darius Rucker" -> "Darius Rucker")
  const strippedArtist = cleanArtistName(meta.artist || 'Unknown Artist');
  const safeArtist = sanitizePathSegment(strippedArtist);
  const safeAlbum = sanitizePathSegment(meta.album || 'Singles');
  const yearSuffix =
    meta.year && Number(meta.year) > 1900 ? ` (${meta.year})` : '';
  const trackNoStr = String(Math.max(1, Number(meta.trackNumber || 1))).padStart(
    2,
    '0'
  );
  // Strip any leading track number or duplicate "Artist - " prefix from the track title
  let cleanedTitle = cleanTrackNumberPrefixFromFilename(
    meta.title || 'Unknown Track',
    Number(meta.trackNumber || 1)
  ).stem;
  const maybeSplit = splitArtistAndTitleFromStem(cleanedTitle);
  if (
    maybeSplit &&
    maybeSplit.artist.toLowerCase() === strippedArtist.toLowerCase()
  ) {
    cleanedTitle = maybeSplit.title;
  }
  const safeTitle = sanitizePathSegment(cleanedTitle || 'Unknown Track');
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
      // Ignore hidden OS metadata files (.DS_Store, Thumbs.db, desktop.ini) when checking if folder is empty
      const meaningfulEntries = entries.filter(
        (name) =>
          name !== '.DS_Store' &&
          name.toLowerCase() !== 'thumbs.db' &&
          name.toLowerCase() !== 'desktop.ini'
      );
      if (meaningfulEntries.length === 0) {
        for (const junk of entries) {
          try {
            await fs.promises.unlink(path.join(current, junk));
          } catch {}
        }
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
    skipExternalLookupIfTagged?: boolean;
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
      hintAlbum: options.hintAlbum,
      downloadArtwork: true,
      skipExternalLookupIfTagged: options.skipExternalLookupIfTagged,
    }
  );

  identified.artist = cleanArtistName(
    identified.artist || options.hintArtist || 'Unknown Artist'
  );

  let finalPath = resolvedSource;
  if (options.moveToLibraryRoot !== false) {
    const musicRoot = getMusicDir();
    const ext = path.extname(resolvedSource) || '.mp3';
    const destPath = buildOrganizedTrackDestination(musicRoot, {
      artist: identified.artist,
      album: identified.album || options.hintAlbum || 'Singles',
      year: identified.year,
      trackNumber: identified.trackNumber,
      title: identified.title || options.hintTitle || 'Unknown Track',
      ext,
    });

    const existingTrackId = db.tracksByPath.get(resolvedSource);

    if (path.resolve(destPath) !== resolvedSource) {
      const sourceDir = path.dirname(resolvedSource);
      // Move the file first, then embed metadata on the destination file so we don't write twice on the source directory
      await moveFileCleanlyWithVerify(resolvedSource, destPath);
      finalPath = destPath;
      await cleanupEmptyParentDirs(sourceDir, musicRoot);
    }

    await embedMetadataAndArtworkIntoFile(finalPath, {
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

    const resolvedFinal = path.resolve(finalPath);
    const conflictingDestTrackId = db.tracksByPath.get(resolvedFinal);

    let trackRow: any = null;
    if (existingTrackId && db.tracks.has(existingTrackId)) {
      // If another duplicate track entry already pointed to resolvedFinal, remove the stale duplicate entry
      if (
        conflictingDestTrackId &&
        conflictingDestTrackId !== existingTrackId
      ) {
        deleteTrackFromDb(conflictingDestTrackId);
      }
      // In-place path and metadata update so playlists, play counts, and favorites are preserved
      db.tracksByPath.delete(resolvedSource);
      const row = db.tracks.get(existingTrackId)!;
      row.file_path = resolvedFinal;
      db.tracksByPath.set(resolvedFinal, existingTrackId);
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
      db.tracksByPath.delete(resolvedSource);
      const indexedId = await indexAudioFile(resolvedFinal, {
        forceReparse: true,
      });
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

    reconcilePlaylistsWithLibrary();

    return {
      ok: true,
      finalPath: resolvedFinal,
      identified,
      trackRow,
    };
  }

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

  reconcilePlaylistsWithLibrary();

  return {
    ok: true,
    finalPath,
    identified,
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
    setOrganizerActiveState(false);
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

function isFileAlreadyCleanlyOrganized(
  musicRoot: string,
  filePath: string
): boolean {
  const rel = path.relative(musicRoot, filePath).replace(/\\/g, '/');
  const parts = rel.split('/').filter(Boolean);
  if (parts.length !== 3) return false;
  const [artistFolder, _albumFolder, fileName] = parts;
  if (cleanArtistName(artistFolder) !== artistFolder) return false;
  return /^\d{2,3}\s+-\s+.+\.[a-z0-9]{2,4}$/i.test(fileName);
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

  // Suppress Chokidar per-file watcher & background ffmpeg LUFS locking while Organizer is active
  setOrganizerActiveState(true);

  // Run in background asynchronously so HTTP response returns immediately
  (async () => {
    try {
      const audioFiles = await collectAudioFilesRecursive(scanDir, {
        recursive: options.recursive !== false,
        includeInbox: Boolean(options.includeInbox),
      });

      activeOrganizeJob.totalFiles = audioFiles.length;
      activeOrganizeJob.status = 'running';
      console.log(
        `[Organizer] Starting ${options.dryRun ? 'Dry-Run Preview' : 'Live Organization'} for ${audioFiles.length} audio file(s) in ${scanDir} (skipOrganized=${Boolean(options.skipOrganized)})...`
      );

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

        // Fast skip if skipOrganized is enabled and file is already in clean Artist/Album/NN - Title.ext layout
        if (
          options.skipOrganized &&
          isFileAlreadyCleanlyOrganized(musicRoot, filePath)
        ) {
          activeOrganizeJob.skippedCount++;
          const segments = relBefore.split('/');
          activeOrganizeJob.items.push({
            beforePath: relBefore,
            afterPath: relBefore,
            title: path.basename(filePath, ext).replace(/^\d+\s*-\s*/, ''),
            artist: segments[0] || 'Unknown Artist',
            album: segments[1] || 'Singles',
            trackNumber: 1,
            year: 0,
            sourceMethod: 'already-organized',
            detectedVariantFlags: [],
            applied: !options.dryRun,
            alreadyOrganized: true,
          });
          continue;
        }

        try {
          if (options.dryRun) {
            // Dry run: identify and calculate destination without modifying disk
            const identified = await identifyAudioFileWithAcoustIdAndMusicBrainz(
              filePath,
              {
                acoustidApiKey: options.acoustidApiKey,
                downloadArtwork: true,
                skipExternalLookupIfTagged: true,
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
              skipExternalLookupIfTagged: true,
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

        pruneOrphanedAlbumsAndArtists();
        reconcilePlaylistsWithLibrary();
        syncDatabaseToPersistentDisk(true);

        console.log(
          `[Organizer] Finished (${activeOrganizeJob.status}): organized=${activeOrganizeJob.organizedCount}, skipped=${activeOrganizeJob.skippedCount}, errors=${activeOrganizeJob.errorCount}`
        );

        // Emit ONE single summary notification when the Organize job completes
        if (!options.dryRun && activeOrganizeJob.organizedCount > 0) {
          addPersistentNotification({
            message: `Library Organizer: Cleaned, tagged & organized ${activeOrganizeJob.organizedCount} track(s) in /music (${activeOrganizeJob.skippedCount} skipped, ${activeOrganizeJob.errorCount} errors).`,
            category: 'library',
            severity: 'success',
            service: 'Library Organizer',
            dedupKey: `organizer:completed:${activeOrganizeJob.id}`,
          });
        }
      }
    } catch (jobErr) {
      activeOrganizeJob.status = 'error';
      activeOrganizeJob.error =
        jobErr instanceof Error ? jobErr.message : 'Job failed';
      activeOrganizeJob.finishedAt = new Date().toISOString();
    } finally {
      setOrganizerActiveState(false);
    }
  })().catch(() => {
    setOrganizerActiveState(false);
  });

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
  const unappliedItems = activeOrganizeJob.items.filter(
    (item) => !item.applied && !(activeOrganizeJob.skipOrganized && item.alreadyOrganized)
  );

  activeOrganizeJob.status = 'running';
  activeOrganizeJob.dryRun = false;
  activeOrganizeJob.totalFiles = unappliedItems.length;
  activeOrganizeJob.processedFiles = 0;
  activeOrganizeJob.organizedCount = 0;
  activeOrganizeJob.startedAt = new Date().toISOString();
  activeOrganizeJob.finishedAt = null;

  setOrganizerActiveState(true);

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
        activeOrganizeJob.currentTrackArtist = cleanArtistName(item.artist);
        activeOrganizeJob.processedFiles++;

        try {
          const res = await fingerprintTagAndOrganizeFile(fullSrc, {
            acoustidApiKey,
            hintArtist: cleanArtistName(item.artist),
            hintTitle: item.title,
            hintAlbum: item.album,
            moveToLibraryRoot: true,
            skipExternalLookupIfTagged: true,
          });
          item.applied = true;
          item.artist = res.identified.artist;
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
        pruneOrphanedAlbumsAndArtists();
        reconcilePlaylistsWithLibrary();
        syncDatabaseToPersistentDisk(true);

        addPersistentNotification({
          message: `Library Organizer: Applied organization & tags to ${activeOrganizeJob.organizedCount} established track(s) in /music.`,
          category: 'library',
          severity: 'success',
          service: 'Library Organizer',
          dedupKey: `organizer:applied:${activeOrganizeJob.id}`,
        });
      }
    } catch (err) {
      activeOrganizeJob.status = 'error';
      activeOrganizeJob.error =
        err instanceof Error ? err.message : 'Apply failed';
      activeOrganizeJob.finishedAt = new Date().toISOString();
    } finally {
      setOrganizerActiveState(false);
    }
  })().catch(() => {
    setOrganizerActiveState(false);
  });

  return activeOrganizeJob;
}

// ============================================================================
// 5-SONG DRY-RUN / READ-WRITE PERMISSION & PERSISTENCE DIAGNOSTIC TEST
// ============================================================================

export interface FiveSongTestStepResult {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
  durationMs: number;
}

export interface FiveSongSampleTrackResult {
  slot: number;
  sourceFile: string;
  isSyntheticSample: boolean;
  rawArtistInput: string;
  cleanedArtistFolder: string;
  targetRelativePath: string;
  readOk: boolean;
  folderCreateOk: boolean;
  writeCopyOk: boolean;
  renameTrackOk: boolean;
  artworkRenameOk: boolean;
  crossFolderMoveOk: boolean;
  sourceDeletedCleanly: boolean;
  persistedOnDisk: boolean;
  passed: boolean;
  error?: string;
}

export interface FiveSongTestReport {
  ok: boolean;
  passed: boolean;
  testedAt: string;
  durationMs: number;
  musicDir: string;
  realTracksTested: number;
  syntheticTracksTested: number;
  summary: string;
  steps: FiveSongTestStepResult[];
  songResults: FiveSongSampleTrackResult[];
}

export async function runFiveSongReadWriteTest(options?: {
  targetDir?: string;
}): Promise<FiveSongTestReport> {
  const startedAt = Date.now();
  const musicRoot = path.resolve(
    String(options?.targetDir || getMusicDir() || '/music').trim()
  );
  const steps: FiveSongTestStepResult[] = [];
  const songResults: FiveSongSampleTrackResult[] = [];

  setOrganizerActiveState(true);
  const testWorkspaceName = `.brokeify-5song-test-${Date.now()}`;
  const testWorkspaceDir = path.join(musicRoot, testWorkspaceName);
  const stagingSubDir = path.join(testWorkspaceDir, '_staging');

  try {
    // Step 1: Verify /music exists, is readable, and is writable
    const tStep1 = Date.now();
    let mountExists = false;
    let mountReadable = false;
    let mountWritable = false;
    let step1Err = '';

    try {
      const st = await fs.promises.stat(musicRoot);
      mountExists = st.isDirectory();
    } catch (err: any) {
      step1Err = err?.message || 'Directory does not exist';
    }

    if (mountExists) {
      try {
        await fs.promises.access(musicRoot, fs.constants.R_OK);
        mountReadable = true;
      } catch (err: any) {
        step1Err = err?.message || 'Read permission denied (R_OK)';
      }
      try {
        await fs.promises.access(musicRoot, fs.constants.W_OK);
        mountWritable = true;
      } catch (err: any) {
        step1Err = err?.message || 'Write permission denied (W_OK)';
      }
    }

    steps.push({
      id: 'mount-permissions',
      name: '1. Mounted Drive Read/Write Access',
      status: mountExists && mountReadable && mountWritable ? 'pass' : 'fail',
      detail:
        mountExists && mountReadable && mountWritable
          ? `Mounted directory "${musicRoot}" is online with R/W access.`
          : `Failed on "${musicRoot}": ${step1Err || 'Check Docker volume mount & PUID/PGID permissions (ensure :ro is not set).'}`,
      durationMs: Math.max(1, Date.now() - tStep1),
    });

    if (!mountExists || !mountReadable || !mountWritable) {
      return {
        ok: true,
        passed: false,
        testedAt: new Date().toISOString(),
        durationMs: Math.max(1, Date.now() - startedAt),
        musicDir: musicRoot,
        realTracksTested: 0,
        syntheticTracksTested: 0,
        summary: `FAIL — "${musicRoot}" is not writable (${step1Err || 'permission denied'}).`,
        steps,
        songResults,
      };
    }

    // Step 2: Artist Folder Number-Stripping & Nested Folder Creation Test
    const tStep2 = Date.now();
    const compilationSamples = [
      { raw: '128. Darius Rucker', expected: 'Darius Rucker' },
      { raw: '010.John Denver', expected: 'John Denver' },
      { raw: '029 Darius Rucker', expected: 'Darius Rucker' },
      { raw: '{1-035} Trisha Yearwood', expected: 'Trisha Yearwood' },
      { raw: '13_87 - Brantley Gilbert', expected: 'Brantley Gilbert' },
      { raw: '38 Special', expected: '38 Special' },
    ];
    const parseFailures = compilationSamples.filter(
      (s) => cleanArtistName(s.raw) !== s.expected
    );

    await fs.promises.mkdir(stagingSubDir, { recursive: true });
    steps.push({
      id: 'artist-folder-parser',
      name: '2. Artist Folder Number-Stripping & Directory Creation',
      status: parseFailures.length === 0 ? 'pass' : 'fail',
      detail:
        parseFailures.length === 0
          ? `Verified "128. Darius Rucker" → "Darius Rucker", "{1-035} Trisha Yearwood" → "Trisha Yearwood", and created test subfolders in ${musicRoot}.`
          : `Parser mismatch on: ${parseFailures.map((f) => `${f.raw} -> ${cleanArtistName(f.raw)}`).join(', ')}`,
      durationMs: Math.max(1, Date.now() - tStep2),
    });

    // Step 3: Collect up to 5 sample audio files across different folders in /music
    const allAudioFiles = await collectAudioFilesRecursive(musicRoot, {
      recursive: true,
      includeInbox: true,
    });
    const pickedRealFiles: string[] = [];
    const seenFolders = new Set<string>();

    // Prefer picking from distinct folders first so cross-folder permissions are tested
    for (const f of allAudioFiles) {
      const dir = path.dirname(f);
      if (!seenFolders.has(dir)) {
        seenFolders.add(dir);
        pickedRealFiles.push(f);
        if (pickedRealFiles.length >= 5) break;
      }
    }
    if (pickedRealFiles.length < 5) {
      for (const f of allAudioFiles) {
        if (!pickedRealFiles.includes(f)) {
          pickedRealFiles.push(f);
          if (pickedRealFiles.length >= 5) break;
        }
      }
    }

    const syntheticCatalog = [
      {
        rawName: "128. Darius Rucker-Don't Think I Don't Think About It.mp3",
        rawArtist: '128. Darius Rucker',
        album: 'Learn to Live',
        year: 2008,
      },
      {
        rawName: '010.John Denver - Take Me Home, Country Roads.mp3',
        rawArtist: '010.John Denver',
        album: 'Poems, Prayers & Promises',
        year: 1971,
      },
      {
        rawName: "{1-035} Trisha Yearwood - She's In Love With The Boy.mp3",
        rawArtist: '{1-035} Trisha Yearwood',
        album: 'Trisha Yearwood',
        year: 1991,
      },
      {
        rawName: '029 Darius Rucker-Alright.mp3',
        rawArtist: '029 Darius Rucker',
        album: 'Learn to Live',
        year: 2008,
      },
      {
        rawName: '13_87 - Brantley Gilbert - Read Me My Rights.mp3',
        rawArtist: '13_87 - Brantley Gilbert',
        album: 'Just As I Am',
        year: 2014,
      },
    ];

    const tStep3 = Date.now();
    let realTracksTested = 0;
    let syntheticTracksTested = 0;

    // Tiny valid JPEG header buffer for testing cover artwork write & rename
    const sampleJpegBytes = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xd9,
    ]);

    for (let slot = 1; slot <= 5; slot++) {
      const realFile = pickedRealFiles[slot - 1];
      const synthSpec = syntheticCatalog[slot - 1];
      const isSynthetic = !realFile;
      if (isSynthetic) syntheticTracksTested++;
      else realTracksTested++;

      const relSourceLabel = realFile
        ? path.relative(musicRoot, realFile).replace(/\\/g, '/')
        : `[Synthetic Sample] ${synthSpec.rawName}`;

      const resultRow: FiveSongSampleTrackResult = {
        slot,
        sourceFile: relSourceLabel,
        isSyntheticSample: isSynthetic,
        rawArtistInput: synthSpec.rawArtist,
        cleanedArtistFolder: cleanArtistName(synthSpec.rawArtist),
        targetRelativePath: '',
        readOk: false,
        folderCreateOk: false,
        writeCopyOk: false,
        renameTrackOk: false,
        artworkRenameOk: false,
        crossFolderMoveOk: false,
        sourceDeletedCleanly: false,
        persistedOnDisk: false,
        passed: false,
      };

      try {
        // 1. Read test (read up to 64 KB of real track or synthesize sample payload)
        let samplePayload: Buffer;
        let ext = '.mp3';
        let rawArtistForDest = synthSpec.rawArtist;
        let albumForDest = synthSpec.album;
        let titleForDest = `Sample Track ${slot}`;
        let yearForDest = synthSpec.year;
        let trackNoForDest = slot;

        if (realFile) {
          ext = path.extname(realFile) || '.mp3';
          const fh = await fs.promises.open(realFile, 'r');
          try {
            const buf = Buffer.alloc(65536);
            const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
            samplePayload =
              bytesRead > 0
                ? buf.subarray(0, bytesRead)
                : Buffer.from(`BROKEIFY-RW-TEST-${slot}`);
          } finally {
            await fh.close();
          }

          const stemInfo = cleanTrackNumberPrefixFromFilename(
            path.basename(realFile, ext),
            slot
          );
          trackNoForDest = stemInfo.trackNumber;
          const split = splitArtistAndTitleFromStem(stemInfo.stem);
          rawArtistForDest = split?.artist || synthSpec.rawArtist;
          titleForDest = split?.title || stemInfo.stem;
        } else {
          samplePayload = Buffer.from(
            `ID3-BROKEIFY-5SONG-TEST-SLOT-${slot}-${synthSpec.rawName}-${Date.now()}`
          );
          const stemInfo = cleanTrackNumberPrefixFromFilename(
            path.basename(synthSpec.rawName, '.mp3'),
            slot
          );
          trackNoForDest = stemInfo.trackNumber;
          const split = splitArtistAndTitleFromStem(stemInfo.stem);
          rawArtistForDest = synthSpec.rawArtist;
          titleForDest = split?.title || stemInfo.stem;
        }

        resultRow.rawArtistInput = rawArtistForDest;
        resultRow.cleanedArtistFolder = cleanArtistName(rawArtistForDest);
        resultRow.readOk = samplePayload.length > 0;

        // 2. Write staging file in _staging folder
        const stagingFilePath = path.join(
          stagingSubDir,
          `slot-${slot}-staging${ext}`
        );
        await fs.promises.writeFile(stagingFilePath, samplePayload);
        const stagingStat = await fs.promises.stat(stagingFilePath);
        resultRow.writeCopyOk = stagingStat.size === samplePayload.length;

        // 3. Build organized target path inside testWorkspaceDir and create nested Artist/Album folder
        const fullDestPath = buildOrganizedTrackDestination(testWorkspaceDir, {
          artist: rawArtistForDest,
          album: albumForDest,
          year: yearForDest,
          trackNumber: trackNoForDest,
          title: titleForDest,
          ext,
        });
        resultRow.targetRelativePath = path
          .relative(testWorkspaceDir, fullDestPath)
          .replace(/\\/g, '/');

        const targetAlbumDir = path.dirname(fullDestPath);
        await fs.promises.mkdir(targetAlbumDir, { recursive: true });
        const albumDirStat = await fs.promises.stat(targetAlbumDir);
        resultRow.folderCreateOk = albumDirStat.isDirectory();

        // 4. Test in-folder file rename (.tmp -> final name)
        const tempRenamePath = `${stagingFilePath}.renametest`;
        await fs.promises.rename(stagingFilePath, tempRenamePath);
        await fs.promises.rename(tempRenamePath, stagingFilePath);
        resultRow.renameTrackOk = await pathExistsAsync(stagingFilePath);

        // 5. Test Artwork write & rename inside the newly created Album folder
        const coverTmpPath = path.join(targetAlbumDir, `cover-${slot}.tmp.jpg`);
        const coverFinalPath = path.join(targetAlbumDir, 'cover.jpg');
        await fs.promises.writeFile(coverTmpPath, sampleJpegBytes);
        await moveFileCleanlyWithVerify(coverTmpPath, coverFinalPath);
        const coverStat = await fs.promises.stat(coverFinalPath);
        resultRow.artworkRenameOk =
          coverStat.size === sampleJpegBytes.length &&
          !(await pathExistsAsync(coverTmpPath));

        // 6. Test cross-folder move from _staging -> Artist/Album/NN - Title.ext and verify source is deleted cleanly (zero duplicates)
        const moveRes = await moveFileCleanlyWithVerify(
          stagingFilePath,
          fullDestPath
        );
        resultRow.crossFolderMoveOk = moveRes.moved;
        resultRow.sourceDeletedCleanly = !(await pathExistsAsync(
          stagingFilePath
        ));

        // 7. Verify bytes persisted on disk at final destination
        const finalStat = await fs.promises.stat(fullDestPath);
        resultRow.persistedOnDisk =
          finalStat.isFile() && finalStat.size === samplePayload.length;

        // 8. Clean up slot files and test empty directory cleanup
        await fs.promises.unlink(fullDestPath);
        if (await pathExistsAsync(coverFinalPath)) {
          await fs.promises.unlink(coverFinalPath);
        }
        await cleanupEmptyParentDirs(targetAlbumDir, testWorkspaceDir);

        resultRow.passed =
          resultRow.readOk &&
          resultRow.writeCopyOk &&
          resultRow.folderCreateOk &&
          resultRow.renameTrackOk &&
          resultRow.artworkRenameOk &&
          resultRow.crossFolderMoveOk &&
          resultRow.sourceDeletedCleanly &&
          resultRow.persistedOnDisk;
      } catch (slotErr: any) {
        resultRow.error =
          slotErr instanceof Error ? slotErr.message : String(slotErr);
        resultRow.passed = false;
      }

      songResults.push(resultRow);
    }

    const passedSongs = songResults.filter((s) => s.passed).length;
    steps.push({
      id: 'five-song-rw-move',
      name: '3. 5-Song Read, Write, Rename, Artwork & Cross-Folder Move Test',
      status: passedSongs === 5 ? 'pass' : 'fail',
      detail:
        passedSongs === 5
          ? `All 5/5 sample tracks passed read, write, rename, cover.jpg rename, cross-folder move, and clean source deletion with disk persistence verified.`
          : `${passedSongs}/5 sample tracks passed. Check failed track rows below for Docker-to-Windows file lock or permission errors.`,
      durationMs: Math.max(1, Date.now() - tStep3),
    });

    // Step 4: Final Cleanup & Zero-Leftover Verification
    const tStep4 = Date.now();
    let cleanupOk = false;
    try {
      await fs.promises.rm(testWorkspaceDir, { recursive: true, force: true });
      cleanupOk = !(await pathExistsAsync(testWorkspaceDir));
    } catch {
      cleanupOk = false;
    }

    steps.push({
      id: 'cleanup-verify',
      name: '4. Empty Directory Cleanup & Delete Permission Check',
      status: cleanupOk ? 'pass' : 'fail',
      detail: cleanupOk
        ? 'Temporary test folders and files were cleanly deleted from /music with zero leftovers.'
        : 'Could not delete temporary test folder — Windows/SMB host may be holding open directory handles.',
      durationMs: Math.max(1, Date.now() - tStep4),
    });

    const overallPassed =
      steps.every((s) => s.status === 'pass') &&
      songResults.every((s) => s.passed);

    return {
      ok: true,
      passed: overallPassed,
      testedAt: new Date().toISOString(),
      durationMs: Math.max(1, Date.now() - startedAt),
      musicDir: musicRoot,
      realTracksTested,
      syntheticTracksTested,
      summary: overallPassed
        ? `PASS (5/5 Songs Verified in ${Math.max(1, Date.now() - startedAt)}ms) — Read, Write, Folder Creation, Artist Number-Stripping, Artwork Rename, and Clean File Moves all persisted on "${musicRoot}".`
        : `FAIL — One or more read/write/move/delete checks failed on "${musicRoot}". Review step details below.`,
      steps,
      songResults,
    };
  } finally {
    try {
      if (await pathExistsAsync(testWorkspaceDir)) {
        await fs.promises.rm(testWorkspaceDir, { recursive: true, force: true });
      }
    } catch {}
    setOrganizerActiveState(false);
  }
}


