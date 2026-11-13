import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  Ban,
  CheckCircle2,
  Code2,
  Compass,
  Disc,
  DownloadCloud,
  ExternalLink,
  Filter,
  FolderSearch,
  Link2,
  ListPlus,
  Loader2,
  Music,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Youtube,
} from 'lucide-react';
import type {
  AutopilotPlaylistRule,
  AutopilotScheduleInterval,
  BrokeifyServerIntegrations,
  DiscoveryFilterConfig,
  DownloaderSourceMode,
  ListenBrainzDiscoverPlaylist,
  MusicBrainzAlbumDetail,
  MusicBrainzSearchResult,
  PicardOrganizerConfig,
  Playlist,
  SlskdGrabJob,
  Track,
} from '../types/music';
import {
  areTracksSameSong,
  createAlbumArtworkDataUri,
  crossResolveTrack,
  DEFAULT_DISCOVERY_FILTERS,
  evaluateDiscoveryFilter,
  extractSpotifyUrlInfo,
  formatDuration,
  parseSpotifyExport,
} from '../utils/musicLogic';

interface RequestDiscoverViewProps {
  catalog: Track[];
  playlists?: Playlist[];
  integrations: BrokeifyServerIntegrations;
  discoveryFilters: DiscoveryFilterConfig;
  onUpdateDiscoveryFilters: (next: DiscoveryFilterConfig) => void;
  onSaveDiscoveryFiltersNow?: (next: DiscoveryFilterConfig) => Promise<void>;
  autopilotRules?: AutopilotPlaylistRule[];
  onRefreshAutopilotRules?: () => void;
  picardConfig?: PicardOrganizerConfig;
  onUpdatePicardConfig?: (next: PicardOrganizerConfig) => void;
  jobs: SlskdGrabJob[];
  onPlayTrack: (track: Track) => void;
  onSaveResolvedPlaylist?: (playlist: Playlist) => void;
  onRefreshStatus: () => void;
  onOpenSettingsSources: () => void;
  onShowToast: (msg: string) => void;
}

type DiscoverSubMode =
  | 'search'
  | 'listenbrainz'
  | 'spotify'
  | 'autopilot'
  | 'filters'
  | 'transfers';

type PlaylistStatusFilter =
  | 'all'
  | 'missing'
  | 'in_jellyfin'
  | 'downloading'
  | 'not_found'
  | 'filtered';

const SAMPLE_SPOTIFY_TEXT = `Linkin Park - In the End
The Midnight - Sunset
Kavinsky - Nightcall
Daft Punk - One More Time (Live 2007)
Deftones - Be Quiet and Drive (Far Away) (Acoustic)
 Carpenter Brut - Turbo Killer`;

export const RequestDiscoverView: React.FC<RequestDiscoverViewProps> = ({
  catalog,
  playlists = [],
  integrations,
  discoveryFilters,
  onUpdateDiscoveryFilters,
  onSaveDiscoveryFiltersNow,
  autopilotRules = [],
  onRefreshAutopilotRules,
  picardConfig,
  onUpdatePicardConfig,
  jobs,
  onPlayTrack,
  onSaveResolvedPlaylist,
  onRefreshStatus,
  onOpenSettingsSources,
  onShowToast,
}) => {
  const [subMode, setSubMode] = useState<DiscoverSubMode>('search');
  const [sourceMode, setSourceMode] = useState<DownloaderSourceMode>(
    integrations.preferredDownloader || 'auto'
  );
  const [statusFilter, setStatusFilter] = useState<PlaylistStatusFilter>('all');

  // MusicBrainz Search State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchType, setSearchType] = useState<'album' | 'track'>('album');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<MusicBrainzSearchResult[]>(
    []
  );

  // Expanded Album Tracklist State
  const [expandedAlbumId, setExpandedAlbumId] = useState<string | null>(null);
  const [loadingAlbumId, setLoadingAlbumId] = useState<string | null>(null);
  const [albumDetailsById, setAlbumDetailsById] = useState<
    Record<string, MusicBrainzAlbumDetail>
  >({});

  // Grab in-progress button state
  const [grabbingKey, setGrabbingKey] = useState<string | null>(null);

  // ListenBrainz Discovery State
  const [lbUsernameInput, setLbUsernameInput] = useState<string>(
    integrations.listenbrainzUsername || ''
  );
  const [isLoadingLb, setIsLoadingLb] = useState<boolean>(false);
  const [lbError, setLbError] = useState<string | null>(null);
  const [lbPlaylists, setLbPlaylists] = useState<
    ListenBrainzDiscoverPlaylist[]
  >([]);
  const [selectedLbPlaylistId, setSelectedLbPlaylistId] = useState<
    string | null
  >(null);

  // Spotify / Playlist Link & Tracklist Importer State
  const [spotifyUrlInput, setSpotifyUrlInput] = useState<string>('');
  const [isFetchingSpotifyUrl, setIsFetchingSpotifyUrl] =
    useState<boolean>(false);
  const [importedPlaylistTitle, setImportedPlaylistTitle] = useState<string>(
    'Imported Spotify Playlist'
  );
  const [rawPlaylistText, setRawPlaylistText] =
    useState<string>(SAMPLE_SPOTIFY_TEXT);

  // Exclusion Filters Keyword Input State
  const [newExcludedWord, setNewExcludedWord] = useState<string>('');
  const [isSavingFilters, setIsSavingFilters] = useState<boolean>(false);

  // Autopilot Rule Form State
  const [apPlaylistId, setApPlaylistId] = useState<string>('');
  const [apSpotifyUrl, setApSpotifyUrl] = useState<string>('');
  const [apInterval, setApInterval] =
    useState<AutopilotScheduleInterval>('weekly');
  const [isSavingAutopilot, setIsSavingAutopilot] = useState<boolean>(false);
  const [syncingRuleId, setSyncingRuleId] = useState<string | null>(null);

  // MusicBrainz Picard + AI Auto-Tagger Test State
  const [picardTestInput, setPicardTestInput] = useState<string>(
    'Linkin Park - In The End (Official HD Video) [1080p]'
  );
  const [isTestingPicard, setIsTestingPicard] = useState<boolean>(false);
  const [picardTestResult, setPicardTestResult] = useState<{
    artist: string;
    title: string;
    album: string;
    year: string;
    trackNumber: string;
    organizedPath: string;
    source: string;
  } | null>(null);

  // Mode 5 Downloads Tab Filters & Bulk Action State
  const [transferStatusFilter, setTransferStatusFilter] = useState<
    | 'all'
    | 'active'
    | 'almost_done'
    | 'queued'
    | 'completed'
    | 'failed'
    | 'filtered'
  >('all');
  const [transferEngineFilter, setTransferEngineFilter] = useState<
    'all' | 'slskd' | 'youtube' | 'archive' | 'lidarr'
  >('all');
  const [transferSearchQuery, setTransferSearchQuery] = useState<string>('');
  const [managingJobsAction, setManagingJobsAction] = useState<string | null>(
    null
  );

  const formatDownloadBytes = (bytes?: number): string => {
    const b = Number(bytes || 0);
    if (!Number.isFinite(b) || b <= 0) return '0 B';
    if (b >= 1024 * 1024 * 1024) {
      return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    if (b >= 1024 * 1024) {
      return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (b >= 1024) {
      return `${Math.round(b / 1024)} KB`;
    }
    return `${b} B`;
  };

  const computeJobProgressPercent = (job: SlskdGrabJob): number => {
    if (job.status === 'completed') return 100;
    if (
      typeof job.progressPercent === 'number' &&
      Number.isFinite(job.progressPercent)
    ) {
      return Math.min(100, Math.max(0, Math.round(job.progressPercent)));
    }
    if (Array.isArray(job.files) && job.files.length > 0) {
      let sumPct = 0;
      for (const f of job.files) {
        if (f.completed) {
          sumPct += 100;
        } else if (typeof f.percentComplete === 'number') {
          sumPct += Math.min(100, Math.max(0, f.percentComplete));
        } else if (f.size > 0 && typeof f.bytesTransferred === 'number') {
          sumPct += Math.min(100, Math.round((f.bytesTransferred / f.size) * 100));
        }
      }
      return Math.min(100, Math.max(0, Math.round(sumPct / job.files.length)));
    }
    if (job.status === 'downloading') return 12;
    if (job.status === 'searching') return 4;
    return 0;
  };

  const handleManageDownloadJobs = async (payload: {
    action:
      | 'clear-completed'
      | 'clear-failed'
      | 'clear-all'
      | 'remove-job'
      | 'retry-job'
      | 'retry-all-failed';
    jobId?: string;
    sourceMode?: string;
    includeFiltered?: boolean;
    ignoreFilters?: boolean;
  }) => {
    const actionKey = payload.jobId
      ? `${payload.action}-${payload.jobId}`
      : payload.action;
    setManagingJobsAction(actionKey);
    try {
      const resp = await fetch('/api/slskd/jobs/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        if (payload.action === 'clear-completed') {
          onShowToast(
            `Removed ${data.removedCount || 0} completed download(s).`
          );
        } else if (payload.action === 'clear-failed') {
          onShowToast(
            `Cleared ${data.removedCount || 0} failed/filtered download(s).`
          );
        } else if (payload.action === 'retry-all-failed') {
          onShowToast(
            `Re-queued ${data.retriedCount || 0} failed download(s)${
              payload.sourceMode ? ` via ${payload.sourceMode.toUpperCase()}` : ''
            }!`
          );
        } else if (payload.action === 'retry-job') {
          onShowToast('Re-queued download job!');
        } else if (payload.action === 'remove-job') {
          onShowToast('Removed download job from list.');
        }
        onRefreshStatus();
      } else {
        onShowToast(data.error || 'Failed to update download jobs.');
      }
    } catch {
      onShowToast('Network error while managing download jobs.');
    } finally {
      setManagingJobsAction(null);
    }
  };

  useEffect(() => {
    if (integrations.listenbrainzUsername) {
      setLbUsernameInput(integrations.listenbrainzUsername);
    }
  }, [integrations.listenbrainzUsername]);

  useEffect(() => {
    if (integrations.preferredDownloader) {
      setSourceMode(integrations.preferredDownloader);
    }
  }, [integrations.preferredDownloader]);

  // Helper to import a Spotify URL via backend /api/spotify/import-url
  const handleImportSpotifyUrl = async (urlToFetch?: string) => {
    const targetUrl = (urlToFetch ?? spotifyUrlInput).trim();
    if (!targetUrl) {
      onShowToast('Paste a Spotify Playlist, Album, or Track link first.');
      return;
    }

    setIsFetchingSpotifyUrl(true);
    try {
      const resp = await fetch('/api/spotify/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        onShowToast(`⚠️ ${data.error || 'Could not import Spotify URL.'}`);
        return;
      }

      if (data.playlistTitle) {
        setImportedPlaylistTitle(data.playlistTitle);
      }

      if (Array.isArray(data.tracks) && data.tracks.length > 0) {
        const lines = data.tracks.map(
          (t: { artist: string; title: string }) => `${t.artist} - ${t.title}`
        );
        setRawPlaylistText(lines.join('\n'));
        setSubMode('spotify');
        onShowToast(
          `🎵 Imported ${data.tracks.length} tracks from "${data.playlistTitle}"!`
        );
      } else {
        setSubMode('spotify');
        onShowToast(`ℹ️ ${data.message}`);
      }
    } catch (err) {
      onShowToast(
        `⚠️ ${
          err instanceof Error ? err.message : 'Failed to reach Spotify importer'
        }`
      );
    } finally {
      setIsFetchingSpotifyUrl(false);
    }
  };

  const handleSearchMusicBrainz = async (
    e?: React.FormEvent,
    overrideQuery?: string,
    overrideType?: 'album' | 'track'
  ) => {
    if (e) e.preventDefault();
    const q = (overrideQuery ?? searchQuery).trim();
    const activeType = overrideType ?? searchType;
    if (!q) return;

    // If the user pasted a Spotify Playlist / Album / Track link right into the main search bar, handle it automatically!
    const spotifyInfo = extractSpotifyUrlInfo(q);
    if (spotifyInfo) {
      setSpotifyUrlInput(q);
      await handleImportSpotifyUrl(q);
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    try {
      const resp = await fetch(
        `/api/musicbrainz/search?q=${encodeURIComponent(
          q
        )}&type=${encodeURIComponent(activeType)}`
      );
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setSearchError(data.error || 'MusicBrainz search failed.');
        setSearchResults([]);
      } else {
        setSearchResults(Array.isArray(data.results) ? data.results : []);
      }
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : 'Failed to reach /api/musicbrainz'
      );
    } finally {
      setIsSearching(false);
    }
  };

  const handleToggleAlbumTracklist = async (releaseGroupId: string) => {
    if (expandedAlbumId === releaseGroupId) {
      setExpandedAlbumId(null);
      return;
    }
    setExpandedAlbumId(releaseGroupId);
    if (albumDetailsById[releaseGroupId]) return;

    setLoadingAlbumId(releaseGroupId);
    try {
      const resp = await fetch(
        `/api/musicbrainz/album/${encodeURIComponent(releaseGroupId)}`
      );
      const data = await resp.json();
      if (resp.ok && data.ok && data.album) {
        setAlbumDetailsById((prev) => ({
          ...prev,
          [releaseGroupId]: data.album,
        }));
      }
    } catch {
      // ignore
    } finally {
      setLoadingAlbumId(null);
    }
  };

  const handleGrabViaDownloader = async (payload: {
    key: string;
    type: 'album' | 'track' | 'playlist';
    artist?: string;
    title?: string;
    tracks?: Array<{ artist: string; title: string; durationSec?: number }>;
    overrideSource?: DownloaderSourceMode;
    ignoreFilters?: boolean;
  }) => {
    setGrabbingKey(payload.key);
    try {
      const activeSource = payload.overrideSource || sourceMode;
      const resp = await fetch('/api/slskd/grab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: payload.type,
          artist: payload.artist,
          title: payload.title,
          tracks: payload.tracks,
          sourceMode: activeSource,
          ignoreFilters: Boolean(payload.ignoreFilters),
          filters: discoveryFilters,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        onShowToast(
          `⚠️ ${
            data.error ||
            'Could not start download. Check Settings -> Server & Connections.'
          }`
        );
      } else {
        onShowToast(`📥 ${data.message}`);
        onRefreshStatus();
      }
    } catch (err) {
      onShowToast(
        `⚠️ ${
          err instanceof Error ? err.message : 'Failed to reach downloader API'
        }`
      );
    } finally {
      setGrabbingKey(null);
    }
  };

  const fetchListenBrainzDiscover = async (usernameOverride?: string) => {
    const targetUser = (usernameOverride ?? lbUsernameInput).trim();
    if (!targetUser) {
      setLbError(
        'Enter your ListenBrainz username above (or in Settings -> Server & Connections) to load your Weekly Exploration and Weekly Jams playlists.'
      );
      setLbPlaylists([]);
      return;
    }
    setIsLoadingLb(true);
    setLbError(null);
    try {
      const resp = await fetch(
        `/api/listenbrainz/discover?username=${encodeURIComponent(targetUser)}`
      );
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setLbError(
          data.error ||
            `Failed to load ListenBrainz playlists for ${targetUser}`
        );
        setLbPlaylists([]);
      } else {
        const list: ListenBrainzDiscoverPlaylist[] = Array.isArray(
          data.playlists
        )
          ? data.playlists
          : [];
        setLbPlaylists(list);
        if (list.length > 0 && !selectedLbPlaylistId) {
          setSelectedLbPlaylistId(list[0].id);
        }
      }
    } catch (err) {
      setLbError(
        err instanceof Error
          ? err.message
          : 'Failed to connect to /api/listenbrainz/discover'
      );
    } finally {
      setIsLoadingLb(false);
    }
  };

  useEffect(() => {
    if (
      subMode === 'listenbrainz' &&
      lbPlaylists.length === 0 &&
      !isLoadingLb &&
      (lbUsernameInput.trim() || integrations.listenbrainzUsername?.trim())
    ) {
      fetchListenBrainzDiscover();
    }
  }, [subMode]);

  // Check if a track is already in the local Jellyfin catalog
  const findMatchingCatalogTrack = (
    title: string,
    artist: string
  ): Track | null => {
    const probe: Pick<Track, 'id' | 'title' | 'artist'> = {
      id: `probe-${title}-${artist}`,
      title,
      artist,
    };
    return catalog.find((c) => areTracksSameSong(c, probe)) || null;
  };

  // Find active/recent download job for a track so playlists show "Downloading", "Not Found", or "Completed"
  const findMatchingJobForTrack = (
    title: string,
    artist: string
  ): SlskdGrabJob | null => {
    const probe: Pick<Track, 'id' | 'title' | 'artist'> = {
      id: `jobprobe-${title}-${artist}`,
      title,
      artist,
    };
    for (const j of jobs) {
      if (
        areTracksSameSong(
          { id: j.id, title: j.title || j.label, artist: j.artist || '' },
          probe
        )
      ) {
        return j;
      }
    }
    return null;
  };

  /**
   * Computes the comprehensive "Better-Than-Explo" status for any playlist track:
   * - 'in_jellyfin': Already on Jellyfin (or download completed)
   * - 'downloading': Currently searching/queued/downloading in slskd or YouTube Music
   * - 'not_found': Searched but not found / failed
   * - 'filtered': Excluded by the user's Live / Remix / Acoustic / Custom Script filters
   * - 'missing': Not in Jellyfin yet and ready to download
   */
  const getPlaylistTrackRichStatus = (tr: {
    title: string;
    artist: string;
    album?: string;
    durationSec?: number;
    inLibrary?: boolean;
  }): {
    state:
      | 'in_jellyfin'
      | 'downloading'
      | 'not_found'
      | 'filtered'
      | 'missing';
    matchedTrack: Track | null;
    matchedJob: SlskdGrabJob | null;
    filterReason: string | null;
  } => {
    const matchedTrack = findMatchingCatalogTrack(tr.title, tr.artist);
    const matchedJob = findMatchingJobForTrack(tr.title, tr.artist);

    if (matchedTrack || tr.inLibrary || matchedJob?.status === 'completed') {
      return {
        state: 'in_jellyfin',
        matchedTrack,
        matchedJob,
        filterReason: null,
      };
    }

    if (
      matchedJob &&
      (matchedJob.status === 'searching' ||
        matchedJob.status === 'queued' ||
        matchedJob.status === 'downloading')
    ) {
      return {
        state: 'downloading',
        matchedTrack: null,
        matchedJob,
        filterReason: null,
      };
    }

    if (
      matchedJob &&
      (matchedJob.status === 'not_found' || matchedJob.status === 'failed')
    ) {
      return {
        state: 'not_found',
        matchedTrack: null,
        matchedJob,
        filterReason: null,
      };
    }

    const filterEval = evaluateDiscoveryFilter(
      {
        title: tr.title,
        artist: tr.artist,
        album: tr.album,
        durationSec: tr.durationSec,
      },
      discoveryFilters
    );
    if (filterEval.excluded || matchedJob?.status === 'filtered') {
      return {
        state: 'filtered',
        matchedTrack: null,
        matchedJob,
        filterReason:
          filterEval.reason ||
          matchedJob?.message ||
          'Excluded by Filter Rules',
      };
    }

    return {
      state: 'missing',
      matchedTrack: null,
      matchedJob: null,
      filterReason: null,
    };
  };

  const activeLbPlaylist =
    lbPlaylists.find((p) => p.id === selectedLbPlaylistId) ||
    lbPlaylists[0] ||
    null;

  // Parse Spotify / Custom Importer tracks and compute their rich status
  const parsedSpotifyItems = parseSpotifyExport(rawPlaylistText).map((item) => {
    const resolved = crossResolveTrack(item, catalog);
    const rich = getPlaylistTrackRichStatus({
      title: item.title,
      artist: item.artist,
      album: item.album,
      durationSec: item.durationSec,
      inLibrary: Boolean(resolved.matchedTrack),
    });
    return {
      item,
      resolved,
      rich: {
        ...rich,
        matchedTrack: resolved.matchedTrack || rich.matchedTrack,
      },
    };
  });

  const activeExclusionCount = [
    discoveryFilters.excludeLive,
    discoveryFilters.excludeRemix,
    discoveryFilters.excludeAcoustic,
    discoveryFilters.excludeInstrumental,
    discoveryFilters.excludeSpedUpSlowed,
    discoveryFilters.excludeCommentary,
    discoveryFilters.customScriptEnabled,
  ].filter(Boolean).length + (discoveryFilters.customExcludedWords?.length || 0);

  return (
    <section
      aria-label="Request Music and Discover Engine"
      data-testid="request-discover-view"
      className="space-y-6"
    >
      {/* Top Header, Downloader Source Selector & 5-Tab Sub-Mode Switcher */}
      <div className="winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden">
        <div className="winamp-titlebar px-5 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-700/80">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-[#00ff66]" />
            <h1 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
              REQUEST &amp; DISCOVER // SEARCH, SPOTIFY IMPORTER, LISTENBRAINZ &amp; MULTI-DOWNLOADER
            </h1>
          </div>

          {/* Downloader Engine Selector (Auto / slskd / Lidarr / YouTube Music / Archive) */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
            <label
              htmlFor="discover-downloader-source"
              className="text-zinc-300 font-semibold"
            >
              Download Engine:
            </label>
            <select
              id="discover-downloader-source"
              value={sourceMode}
              onChange={(e) =>
                setSourceMode(e.target.value as DownloaderSourceMode)
              }
              data-testid="select-downloader-engine"
              className="rounded-lg border border-emerald-500/50 bg-zinc-950 px-2.5 py-1 text-xs font-mono font-bold text-[#00ff66] focus:outline-none"
            >
              <option value="auto">
                ⚡ Auto Waterfall (slskd → Lidarr → YouTube Music)
              </option>
              <option value="slskd">
                💿 slskd Only (Soulseek P2P FLAC / 320k)
              </option>
              <option value="lidarr">
                🎯 Lidarr Automated Indexer (Arr Stack)
              </option>
              <option value="youtube">
                ▶️ YouTube Music Downloader (yt-dlp / Audio Stream)
              </option>
              <option value="archive">
                🏛️ Internet Archive Open Audio
              </option>
            </select>
          </div>
        </div>

        <div className="p-4 sm:p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSubMode('search')}
              data-testid="discover-subtab-search"
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-mono font-bold transition-colors min-h-[38px] ${
                subMode === 'search'
                  ? 'bg-[#00ff66] text-zinc-950'
                  : 'bg-zinc-950 text-zinc-300 hover:text-white border border-zinc-800'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>1. Search Songs, Albums &amp; Links</span>
            </button>

            <button
              type="button"
              onClick={() => setSubMode('spotify')}
              data-testid="discover-subtab-spotify"
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-mono font-bold transition-colors min-h-[38px] ${
                subMode === 'spotify'
                  ? 'bg-[#00ff66] text-zinc-950'
                  : 'bg-zinc-950 text-zinc-300 hover:text-white border border-zinc-800'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                2. Spotify &amp; Playlist Importer
                {autopilotRules.length > 0 ? ` (${autopilotRules.length} Auto)` : ''}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSubMode('listenbrainz')}
              data-testid="discover-subtab-listenbrainz"
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-mono font-bold transition-colors min-h-[38px] ${
                subMode === 'listenbrainz'
                  ? 'bg-[#00ff66] text-zinc-950'
                  : 'bg-zinc-950 text-zinc-300 hover:text-white border border-zinc-800'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>
                3. ListenBrainz Mixes
                {integrations.listenbrainzUsername
                  ? ` (${integrations.listenbrainzUsername})`
                  : ''}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSubMode('filters')}
              data-testid="discover-subtab-filters"
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-mono font-bold transition-colors min-h-[38px] ${
                subMode === 'filters'
                  ? 'bg-[#00ff66] text-zinc-950'
                  : 'bg-zinc-950 text-zinc-300 hover:text-white border border-zinc-800'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>4. Exclusion Filters ({activeExclusionCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setSubMode('transfers')}
              data-testid="discover-subtab-transfers"
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-mono font-bold transition-colors min-h-[38px] ${
                subMode === 'transfers'
                  ? 'bg-[#00ff66] text-zinc-950'
                  : 'bg-zinc-950 text-zinc-300 hover:text-white border border-zinc-800'
              }`}
            >
              <DownloadCloud className="w-3.5 h-3.5" />
              <span>5. Downloads ({jobs.length})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenSettingsSources}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-[#00ff66]/50 px-3 py-2 text-xs font-mono font-semibold text-zinc-200 hover:text-white min-h-[38px]"
          >
            <Settings className="w-3.5 h-3.5 text-[#00ff66]" />
            <span>Configure Downloaders</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          MODE 1: UNIFIED SEARCH (ARTIST / ALBUM / SONG OR PASTE A SPOTIFY LINK)
         ===================================================================== */}
      {subMode === 'search' && (
        <div className="winamp-bezel rounded-2xl border border-zinc-700/80 p-5 space-y-5">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 text-xs text-zinc-300 leading-relaxed">
            <strong className="text-[#00ff66]">How this works:</strong> Type any{' '}
            <strong className="text-white">Artist, Album, or Song name</strong>{' '}
            to search MusicBrainz and download it via{' '}
            <code className="text-[#00ff66]">slskd</code> or{' '}
            <code className="text-rose-400">YouTube Music</code>—or paste a{' '}
            <strong className="text-white">
              Spotify Playlist / Album Link
            </strong>{' '}
            (<code className="text-[#00ff66]">https://open.spotify.com/playlist/...</code>)
            right into the box below and Brokeify will import the entire playlist!
          </div>

          <form
            onSubmit={handleSearchMusicBrainz}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
          >
            <div className="flex rounded-xl border border-zinc-700 bg-zinc-950 p-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setSearchType('album');
                  if (searchQuery.trim() && !extractSpotifyUrlInfo(searchQuery)) {
                    handleSearchMusicBrainz(undefined, searchQuery, 'album');
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-colors ${
                  searchType === 'album'
                    ? 'bg-[#00ff66] text-zinc-950'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Albums
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchType('track');
                  if (searchQuery.trim() && !extractSpotifyUrlInfo(searchQuery)) {
                    handleSearchMusicBrainz(undefined, searchQuery, 'track');
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-colors ${
                  searchType === 'track'
                    ? 'bg-[#00ff66] text-zinc-950'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Songs
              </button>
            </div>

            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search any Artist, Album, Song — or drop a Spotify Playlist link..."
                aria-label="Search MusicBrainz or paste Spotify link"
                data-testid="musicbrainz-search-input"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-[#00ff66] focus:outline-none font-mono min-h-[42px]"
              />
            </div>

            <button
              type="submit"
              disabled={isSearching || isFetchingSpotifyUrl}
              data-testid="musicbrainz-search-submit"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-50 px-5 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[42px] shrink-0"
            >
              {isSearching || isFetchingSpotifyUrl ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span>
                {extractSpotifyUrlInfo(searchQuery)
                  ? 'Import Spotify Link'
                  : `Search ${searchType === 'album' ? 'Albums' : 'Songs'}`}
              </span>
            </button>
          </form>

          {searchError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs font-mono text-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{searchError}</span>
            </div>
          )}

          {searchResults.length === 0 && !isSearching ? (
            <div className="py-10 text-center space-y-2 text-zinc-400 font-mono text-xs">
              <Disc className="w-8 h-8 text-zinc-600 mx-auto" />
              <p>
                Search for any Artist, Album, or Song above (or drop a Spotify
                playlist URL).
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {searchResults.map((res) => {
                const isAlbum = res.type === 'album';
                const isExpanded = expandedAlbumId === res.id;
                const albumDetail = albumDetailsById[res.id];
                const isLoadingDetail = loadingAlbumId === res.id;
                const matchedInLibrary = !isAlbum
                  ? findMatchingCatalogTrack(res.title, res.artist)
                  : null;
                const filterEval = evaluateDiscoveryFilter(
                  {
                    title: res.title,
                    artist: res.artist,
                    album: res.album,
                    durationSec: res.durationSec,
                  },
                  discoveryFilters
                );
                const grabKey = `mb-${res.id}`;
                const ytGrabKey = `mb-yt-${res.id}`;

                return (
                  <div
                    key={res.id}
                    data-testid={`mb-result-${res.id}`}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4 flex flex-col justify-between gap-3"
                  >
                    <div className="flex items-start gap-3.5">
                      <img
                        src={
                          res.coverUrl ||
                          createAlbumArtworkDataUri(
                            res.title,
                            res.artist,
                            '#00ff66',
                            '#09090b'
                          )
                        }
                        alt={res.title}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = createAlbumArtworkDataUri(
                            res.title,
                            res.artist,
                            '#00ff66',
                            '#09090b'
                          );
                        }}
                        className="w-16 h-16 rounded-xl border border-zinc-700 object-cover shrink-0"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="rounded bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-[10px] font-mono font-bold text-[#00ff66] uppercase">
                            {isAlbum ? res.primaryType || 'ALBUM' : 'TRACK'}
                          </span>
                          {res.year && (
                            <span className="text-[11px] font-mono text-zinc-400">
                              {res.year}
                            </span>
                          )}
                          {filterEval.excluded && (
                            <span className="rounded bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-mono font-bold text-amber-300">
                              {filterEval.reason}
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-bold text-white truncate mt-1">
                          {res.title}
                        </h3>
                        <p className="text-xs text-[#00ff66] font-mono truncate">
                          {res.artist}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {isAlbum && (
                          <button
                            type="button"
                            onClick={() => handleToggleAlbumTracklist(res.id)}
                            className="inline-flex items-center gap-1 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-zinc-500 px-2.5 py-1.5 text-[11px] font-mono text-zinc-200"
                          >
                            <FolderSearch className="w-3.5 h-3.5 text-sky-400" />
                            <span>
                              {isExpanded ? 'Hide Tracks' : 'View Tracklist'}
                            </span>
                          </button>
                        )}

                        {matchedInLibrary ? (
                          <button
                            type="button"
                            onClick={() => onPlayTrack(matchedInLibrary)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/50 px-3 py-1.5 text-xs font-mono font-bold text-[#00ff66]"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>In Library · Play</span>
                          </button>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              disabled={grabbingKey === grabKey}
                              onClick={() =>
                                handleGrabViaDownloader({
                                  key: grabKey,
                                  type: isAlbum ? 'album' : 'track',
                                  artist: res.artist,
                                  title: res.title,
                                  ignoreFilters: filterEval.excluded,
                                  tracks: albumDetail?.tracks?.map((t) => ({
                                    artist: t.artist,
                                    title: t.title,
                                    durationSec: t.durationSec,
                                  })),
                                })
                              }
                              data-testid={`grab-btn-${res.id}`}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-50 px-3 py-1.5 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[34px]"
                            >
                              {grabbingKey === grabKey ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <ArrowDownToLine className="w-3.5 h-3.5" />
                              )}
                              <span>
                                {isAlbum ? 'Grab Full Album' : 'Grab Song'}
                              </span>
                            </button>

                            <button
                              type="button"
                              disabled={grabbingKey === ytGrabKey}
                              onClick={() =>
                                handleGrabViaDownloader({
                                  key: ytGrabKey,
                                  type: 'track',
                                  artist: res.artist,
                                  title: res.title,
                                  overrideSource: 'youtube',
                                  ignoreFilters: true,
                                })
                              }
                              title="Download directly from YouTube Music"
                              className="inline-flex items-center gap-1 rounded-xl border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500 hover:text-zinc-950 px-2.5 py-1.5 text-[11px] font-mono font-bold text-rose-300 transition-colors min-h-[34px]"
                            >
                              {grabbingKey === ytGrabKey ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Youtube className="w-3.5 h-3.5" />
                              )}
                              <span>YT Music</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Expanded Album Tracklist */}
                    {isAlbum && isExpanded && (
                      <div className="pt-3 border-t border-zinc-800/80 space-y-2">
                        {isLoadingDetail ? (
                          <div className="py-4 text-center text-xs font-mono text-zinc-400 flex items-center justify-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin text-[#00ff66]" />
                            <span>
                              Loading exact MusicBrainz release tracklist...
                            </span>
                          </div>
                        ) : albumDetail && albumDetail.tracks.length > 0 ? (
                          <div className="divide-y divide-zinc-800/60">
                            {albumDetail.tracks.map((tr) => {
                              const rich = getPlaylistTrackRichStatus({
                                title: tr.title,
                                artist: tr.artist,
                                album: tr.album,
                                durationSec: tr.durationSec,
                              });
                              const trGrabKey = `mb-tr-${tr.id}`;
                              return (
                                <div
                                  key={tr.id}
                                  className="py-2 px-2 flex items-center justify-between gap-2 text-xs"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-6 text-right font-mono text-zinc-500">
                                      {tr.number}.
                                    </span>
                                    <span className="font-semibold text-white truncate">
                                      {tr.title}
                                    </span>
                                    {rich.state === 'filtered' && (
                                      <span className="rounded bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-mono text-amber-300">
                                        {rich.filterReason}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {rich.matchedTrack ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onPlayTrack(rich.matchedTrack!)
                                        }
                                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-[11px] font-mono font-bold text-[#00ff66]"
                                      >
                                        <CheckCircle2 className="w-3 h-3" />
                                        <span>In Library</span>
                                      </button>
                                    ) : rich.state === 'downloading' ? (
                                      <span className="inline-flex items-center gap-1 rounded-lg bg-sky-500/20 border border-sky-500/40 px-2.5 py-1 text-[11px] font-mono font-bold text-sky-300">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        <span>Downloading</span>
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={grabbingKey === trGrabKey}
                                        onClick={() =>
                                          handleGrabViaDownloader({
                                            key: trGrabKey,
                                            type: 'track',
                                            artist: tr.artist,
                                            title: tr.title,
                                            ignoreFilters:
                                              rich.state === 'filtered',
                                          })
                                        }
                                        className="inline-flex items-center gap-1 rounded-lg bg-purple-600 hover:bg-purple-500 px-2.5 py-1 text-[11px] font-mono font-bold text-white"
                                      >
                                        <ArrowDownToLine className="w-3 h-3" />
                                        <span>
                                          {rich.state === 'filtered'
                                            ? 'Override & Grab'
                                            : 'Grab Track'}
                                        </span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-xs font-mono text-zinc-400 py-2">
                            No detailed tracklist found—click &ldquo;Grab Full
                            Album&rdquo; to search directly.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          MODE 2: SPOTIFY & PLAYLIST LINK IMPORTER (BETTER THAN EXPLO)
         ===================================================================== */}
      {subMode === 'spotify' && (
        <div
          data-testid="discover-spotify-importer-panel"
          className="winamp-bezel rounded-2xl border border-zinc-700/80 p-5 space-y-5"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-white font-mono flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#00ff66]" />
                <span>
                  Spotify Playlist Link &amp; Tracklist Importer + Autopilot Sync
                </span>
              </h2>
              <p className="text-xs text-zinc-300">
                Drop any public{' '}
                <strong className="text-white">Spotify Playlist or Album Link</strong>{' '}
                (or paste a song list) below. Brokeify shows you exactly which songs
                are <span className="text-[#00ff66] font-semibold">In Library</span>,{' '}
                <span className="text-sky-300 font-semibold">Downloading</span>,{' '}
                <span className="text-rose-300 font-semibold">Not Found</span>, or{' '}
                <span className="text-amber-300 font-semibold">Filtered Out</span>—and
                lets you grab all missing songs via <code className="text-[#00ff66]">slskd</code> or{' '}
                <code className="text-rose-300">YouTube Music</code> in 1 click!
              </p>
            </div>
          </div>

          {/* Step 1: Drop a Spotify URL */}
          <div className="rounded-2xl border border-emerald-500/30 bg-zinc-950/90 p-4 space-y-3">
            <label
              htmlFor="discover-spotify-url-input"
              className="block text-xs font-mono font-bold uppercase text-[#00ff66]"
            >
              Option A: Drop a Spotify Playlist, Album, or Song Link
            </label>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <div className="relative flex-1">
                <Link2 className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="discover-spotify-url-input"
                  type="text"
                  value={spotifyUrlInput}
                  onChange={(e) => setSpotifyUrlInput(e.target.value)}
                  placeholder="https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
                  data-testid="spotify-url-import-input"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 pl-10 pr-4 py-2.5 text-xs font-mono text-white placeholder-zinc-500 focus:border-[#00ff66] focus:outline-none min-h-[40px]"
                />
              </div>
              <button
                type="button"
                disabled={isFetchingSpotifyUrl}
                onClick={() => handleImportSpotifyUrl()}
                data-testid="spotify-url-import-btn"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-50 px-4 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[40px] shrink-0"
              >
                {isFetchingSpotifyUrl ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4" />
                )}
                <span>Fetch Spotify Playlist</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left 5 Columns: Playlist Name & Raw Tracklist Editor */}
            <div className="lg:col-span-5 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
              <div>
                <label
                  htmlFor="imported-pl-title"
                  className="block text-xs font-semibold text-zinc-300 mb-1"
                >
                  Playlist Name
                </label>
                <input
                  id="imported-pl-title"
                  type="text"
                  value={importedPlaylistTitle}
                  onChange={(e) => setImportedPlaylistTitle(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="imported-pl-raw"
                  className="block text-xs font-semibold text-zinc-300 mb-1"
                >
                  Option B: Paste or Edit Tracklist (`Artist - Title`, CSV, or JSON)
                </label>
                <textarea
                  id="imported-pl-raw"
                  rows={8}
                  value={rawPlaylistText}
                  onChange={(e) => setRawPlaylistText(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-xs font-mono text-zinc-100 leading-relaxed focus:border-[#00ff66] focus:outline-none"
                />
              </div>

              {onSaveResolvedPlaylist && (
                <button
                  type="button"
                  onClick={() => {
                    const matchedIds = parsedSpotifyItems
                      .map((p) => p.rich.matchedTrack?.id)
                      .filter((id): id is string => Boolean(id));
                    if (matchedIds.length === 0) {
                      onShowToast(
                        '⚠️ None of these songs are in your library yet. Click "Download Missing" first!'
                      );
                      return;
                    }
                    const newPl: Playlist = {
                      id: `pl-spotify-${Date.now()}`,
                      name:
                        importedPlaylistTitle.trim() ||
                        'Imported Spotify Playlist',
                      originalName:
                        importedPlaylistTitle.trim() ||
                        'Imported Spotify Playlist',
                      description: `Imported playlist (${matchedIds.length}/${parsedSpotifyItems.length} tracks in library).`,
                      source: 'spotify-resolved',
                      trackIds: matchedIds,
                      createdAt: new Date().toISOString().slice(0, 10),
                      coverAccent: '#00ff66',
                    };
                    onSaveResolvedPlaylist(newPl);
                    onShowToast(
                      `💾 Saved "${newPl.name}" (${matchedIds.length} tracks) to Library -> Playlists!`
                    );
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 py-2.5 px-4 text-xs font-mono font-bold text-white transition-colors min-h-[40px]"
                >
                  <ListPlus className="w-4 h-4" />
                  <span>Save Matched Tracks to My Playlists</span>
                </button>
              )}
            </div>

            {/* Right 7 Columns: Better-Than-Explo Playlist Status Matrix */}
            <div className="lg:col-span-7 rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4 space-y-4">
              {(() => {
                const countInJf = parsedSpotifyItems.filter(
                  (x) => x.rich.state === 'in_jellyfin'
                ).length;
                const countDownloading = parsedSpotifyItems.filter(
                  (x) => x.rich.state === 'downloading'
                ).length;
                const countNotFound = parsedSpotifyItems.filter(
                  (x) => x.rich.state === 'not_found'
                ).length;
                const countFiltered = parsedSpotifyItems.filter(
                  (x) => x.rich.state === 'filtered'
                ).length;
                const countMissing = parsedSpotifyItems.filter(
                  (x) => x.rich.state === 'missing'
                ).length;

                const missingToGrab = parsedSpotifyItems
                  .filter(
                    (x) =>
                      x.rich.state === 'missing' || x.rich.state === 'not_found'
                  )
                  .map((x) => ({
                    artist: x.item.artist,
                    title: x.item.title,
                    durationSec: x.item.durationSec,
                  }));

                const visibleItems = parsedSpotifyItems.filter((x) =>
                  statusFilter === 'all' ? true : x.rich.state === statusFilter
                );

                return (
                  <>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
                      <div>
                        <h3 className="text-sm font-bold text-white font-mono">
                          {importedPlaylistTitle} ({parsedSpotifyItems.length}{' '}
                          Tracks)
                        </h3>
                        <p className="text-[11px] font-mono text-zinc-400 mt-0.5">
                          Click any status pill below to inspect Missing,
                          Downloading, In Library, Not Found, or Filtered songs.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={
                            missingToGrab.length === 0 ||
                            grabbingKey === 'spotify-grab-missing'
                          }
                          onClick={() =>
                            handleGrabViaDownloader({
                              key: 'spotify-grab-missing',
                              type: 'playlist',
                              tracks: missingToGrab,
                            })
                          }
                          data-testid="spotify-download-missing-btn"
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-40 px-3.5 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[36px]"
                        >
                          {grabbingKey === 'spotify-grab-missing' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ArrowDownToLine className="w-3.5 h-3.5" />
                          )}
                          <span>
                            Grab {missingToGrab.length} Missing ({sourceMode.toUpperCase()})
                          </span>
                        </button>

                        <button
                          type="button"
                          disabled={
                            missingToGrab.length === 0 ||
                            grabbingKey === 'spotify-grab-yt'
                          }
                          onClick={() =>
                            handleGrabViaDownloader({
                              key: 'spotify-grab-yt',
                              type: 'playlist',
                              tracks: missingToGrab,
                              overrideSource: 'youtube',
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500 hover:text-zinc-950 disabled:opacity-40 px-3 py-2 text-xs font-mono font-bold text-rose-300 transition-colors min-h-[36px]"
                        >
                          <Youtube className="w-3.5 h-3.5" />
                          <span>Grab Missing via YT Music</span>
                        </button>
                      </div>
                    </div>

                    {/* Status Filter Pills */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                      <button
                        type="button"
                        onClick={() => setStatusFilter('all')}
                        className={`rounded-lg px-2.5 py-1 border ${
                          statusFilter === 'all'
                            ? 'border-white bg-zinc-800 text-white font-bold'
                            : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'
                        }`}
                      >
                        All ({parsedSpotifyItems.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter('in_jellyfin')}
                        className={`rounded-lg px-2.5 py-1 border ${
                          statusFilter === 'in_jellyfin'
                            ? 'border-[#00ff66] bg-emerald-500/20 text-[#00ff66] font-bold'
                            : 'border-emerald-500/30 bg-emerald-500/10 text-[#00ff66]'
                        }`}
                      >
                        🟢 In Library ({countInJf})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter('missing')}
                        className={`rounded-lg px-2.5 py-1 border ${
                          statusFilter === 'missing'
                            ? 'border-amber-400 bg-amber-500/25 text-amber-200 font-bold'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                        }`}
                      >
                        🟡 Missing ({countMissing})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter('downloading')}
                        className={`rounded-lg px-2.5 py-1 border ${
                          statusFilter === 'downloading'
                            ? 'border-sky-400 bg-sky-500/25 text-sky-200 font-bold'
                            : 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                        }`}
                      >
                        🔵 Downloading ({countDownloading})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter('not_found')}
                        className={`rounded-lg px-2.5 py-1 border ${
                          statusFilter === 'not_found'
                            ? 'border-rose-400 bg-rose-500/25 text-rose-200 font-bold'
                            : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                        }`}
                      >
                        🔴 Cant Find ({countNotFound})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter('filtered')}
                        className={`rounded-lg px-2.5 py-1 border ${
                          statusFilter === 'filtered'
                            ? 'border-purple-400 bg-purple-500/25 text-purple-200 font-bold'
                            : 'border-purple-500/30 bg-purple-500/10 text-purple-300'
                        }`}
                      >
                        ⚪ Excluded by Filter ({countFiltered})
                      </button>
                    </div>

                    {/* Track Rows */}
                    <div className="divide-y divide-zinc-800/70 max-h-[460px] overflow-y-auto pr-1">
                      {visibleItems.map(({ item, rich }, idx) => {
                        const rowKey = `sp-row-${idx}`;
                        return (
                          <div
                            key={rowKey}
                            className="py-2.5 px-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-zinc-500">
                                  {String(idx + 1).padStart(2, '0')}.
                                </span>
                                <span className="font-bold text-white truncate">
                                  {item.title}
                                </span>
                                <span className="text-zinc-400 font-mono truncate">
                                  — {item.artist}
                                </span>
                              </div>
                              {/* Detailed Status Sub-line */}
                              <div className="mt-1 flex items-center gap-2 text-[11px] font-mono">
                                {rich.state === 'in_jellyfin' && (
                                  <span className="text-[#00ff66]">
                                    ✓ In Brokeify Library
                                  </span>
                                )}
                                {rich.state === 'downloading' && (
                                  <span className="text-sky-300">
                                    ⏳ {rich.matchedJob?.message || 'Downloading...'}
                                  </span>
                                )}
                                {rich.state === 'not_found' && (
                                  <span className="text-rose-300">
                                    ❌{' '}
                                    {rich.matchedJob?.message ||
                                      'Could not find on slskd'}
                                  </span>
                                )}
                                {rich.state === 'filtered' && (
                                  <span className="text-purple-300">
                                    🚫 {rich.filterReason}
                                  </span>
                                )}
                                {rich.state === 'missing' && (
                                  <span className="text-amber-300">
                                    • Missing from Library
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {rich.state === 'in_jellyfin' &&
                              rich.matchedTrack ? (
                                <button
                                  type="button"
                                  onClick={() => onPlayTrack(rich.matchedTrack!)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-[11px] font-mono font-bold text-[#00ff66]"
                                >
                                  <Play className="w-3 h-3 fill-current" />
                                  <span>Play</span>
                                </button>
                              ) : rich.state === 'downloading' ? (
                                <span className="inline-flex items-center gap-1 rounded-lg bg-sky-500/20 border border-sky-500/40 px-2.5 py-1 text-[11px] font-mono text-sky-300">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  <span>Downloading</span>
                                </span>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    disabled={grabbingKey === rowKey}
                                    onClick={() =>
                                      handleGrabViaDownloader({
                                        key: rowKey,
                                        type: 'track',
                                        artist: item.artist,
                                        title: item.title,
                                        ignoreFilters:
                                          rich.state === 'filtered',
                                      })
                                    }
                                    className="inline-flex items-center gap-1 rounded-lg bg-[#00ff66] hover:bg-emerald-400 px-2.5 py-1 text-[11px] font-mono font-bold text-zinc-950"
                                  >
                                    <ArrowDownToLine className="w-3 h-3" />
                                    <span>
                                      {rich.state === 'filtered'
                                        ? 'Override & Grab'
                                        : 'Grab'}
                                    </span>
                                  </button>

                                  <button
                                    type="button"
                                    disabled={grabbingKey === `${rowKey}-yt`}
                                    onClick={() =>
                                      handleGrabViaDownloader({
                                        key: `${rowKey}-yt`,
                                        type: 'track',
                                        artist: item.artist,
                                        title: item.title,
                                        overrideSource: 'youtube',
                                        ignoreFilters: true,
                                      })
                                    }
                                    title="Download from YouTube Music"
                                    className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500 hover:text-zinc-950 px-2 py-1 text-[11px] font-mono font-bold text-rose-300"
                                  >
                                    <Youtube className="w-3 h-3" />
                                    <span>YT</span>
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Embedded Autopilot Linked Playlists inside Spotify & Playlist Importer */}
          <div
            data-testid="discover-autopilot-embedded-panel"
            className="rounded-2xl border border-emerald-500/30 bg-zinc-950/90 p-4 sm:p-5 space-y-4 mt-4"
          >
            <div className="space-y-1 border-b border-zinc-800 pb-3">
              <h3 className="text-sm sm:text-base font-bold text-white font-mono flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-[#00ff66]" />
                <span>
                  Autopilot Linked Playlists (Daily, Weekly, or Monthly Spotify Sync)
                </span>
              </h3>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Link any of your playlists to a public{' '}
                <strong className="text-white">Spotify Playlist URL</strong>.
                Brokeify will automatically check that Spotify playlist{' '}
                <strong className="text-[#00ff66]">
                  Daily, Weekly, or Monthly
                </strong>{' '}
                in the background, download any new songs via{' '}
                <code className="text-[#00ff66]">slskd</code> or{' '}
                <code className="text-rose-300">YouTube Music</code>, organize
                them into clean folders, and add them to your playlist.
              </p>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!apSpotifyUrl.trim()) {
                  onShowToast('Paste a Spotify Playlist URL first.');
                  return;
                }
                const targetPl = playlists.find((p) => p.id === apPlaylistId);
                setIsSavingAutopilot(true);
                try {
                  const resp = await fetch('/api/autopilot/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      rule: {
                        id: `autopilot-${Date.now()}`,
                        playlistId: targetPl?.id || `pl-auto-${Date.now()}`,
                        playlistName:
                          targetPl?.name || 'Autopilot Spotify Mix',
                        spotifyUrl: apSpotifyUrl.trim(),
                        interval: apInterval,
                        enabled: true,
                        preferredDownloader: sourceMode,
                        organizeWithPicard: true,
                      },
                    }),
                  });
                  const data = await resp.json();
                  if (resp.ok && data.ok) {
                    onShowToast(
                      `🤖 Autopilot rule saved! Will check Spotify ${apInterval}.`
                    );
                    setApSpotifyUrl('');
                    if (onRefreshAutopilotRules) onRefreshAutopilotRules();
                  } else {
                    onShowToast(
                      `⚠️ ${data.error || 'Could not save Autopilot rule'}`
                    );
                  }
                } finally {
                  setIsSavingAutopilot(false);
                }
              }}
              className="grid grid-cols-1 md:grid-cols-12 gap-3"
            >
              <div className="md:col-span-3">
                <label className="block text-xs font-mono text-zinc-300 mb-1">
                  1. Target Playlist
                </label>
                <select
                  value={apPlaylistId}
                  onChange={(e) => setApPlaylistId(e.target.value)}
                  data-testid="autopilot-select-playlist"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none min-h-[40px]"
                >
                  <option value="">+ Create New Autopilot Playlist</option>
                  {playlists.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-4">
                <label className="block text-xs font-mono text-zinc-300 mb-1">
                  2. Spotify Playlist URL to Watch
                </label>
                <input
                  type="text"
                  value={apSpotifyUrl}
                  onChange={(e) => setApSpotifyUrl(e.target.value)}
                  placeholder="https://open.spotify.com/playlist/..."
                  data-testid="autopilot-spotify-url-input"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none min-h-[40px]"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-mono text-zinc-300 mb-1">
                  3. Check Schedule
                </label>
                <select
                  value={apInterval}
                  onChange={(e) =>
                    setApInterval(e.target.value as AutopilotScheduleInterval)
                  }
                  data-testid="autopilot-schedule-select"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-[#00ff66] font-bold focus:border-[#00ff66] focus:outline-none min-h-[40px]"
                >
                  <option value="daily">Every Day (Daily)</option>
                  <option value="weekly">Every Week (Weekly)</option>
                  <option value="monthly">Every Month (Monthly)</option>
                </select>
              </div>

              <div className="md:col-span-3 flex items-end">
                <button
                  type="submit"
                  disabled={isSavingAutopilot}
                  data-testid="autopilot-create-btn"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2.5 text-xs font-mono font-bold text-zinc-950 min-h-[40px]"
                >
                  {isSavingAutopilot ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  <span>Enable Autopilot</span>
                </button>
              </div>
            </form>

            {autopilotRules.length > 0 && (
              <div className="space-y-2.5 pt-2">
                {autopilotRules.map((rule) => (
                  <div
                    key={rule.id}
                    data-testid={`autopilot-rule-${rule.id}`}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66] uppercase">
                          AUTOPILOT: {rule.interval.toUpperCase()}
                        </span>
                        <span className="text-sm font-bold text-white truncate">
                          {rule.playlistName}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-zinc-400 truncate">
                        Linked Spotify URL: {rule.spotifyUrl}
                      </div>
                      {rule.lastRunMessage && (
                        <div className="text-[11px] font-mono text-purple-300">
                          Last Check: {rule.lastRunMessage}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={syncingRuleId === rule.id}
                        onClick={async () => {
                          setSyncingRuleId(rule.id);
                          try {
                            const resp = await fetch(
                              '/api/autopilot/sync-now',
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ruleId: rule.id }),
                              }
                            );
                            const data = await resp.json();
                            onShowToast(
                              data.message || 'Autopilot check completed!'
                            );
                            if (onRefreshAutopilotRules)
                              onRefreshAutopilotRules();
                            onRefreshStatus();
                          } finally {
                            setSyncingRuleId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3 py-1.5 text-xs font-mono font-bold text-zinc-950"
                      >
                        {syncingRuleId === rule.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        <span>Check &amp; Sync Now</span>
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          await fetch(
                            `/api/autopilot/${encodeURIComponent(rule.id)}`,
                            { method: 'DELETE' }
                          );
                          onShowToast('Removed Autopilot rule.');
                          if (onRefreshAutopilotRules)
                            onRefreshAutopilotRules();
                        }}
                        className="rounded-xl border border-zinc-800 bg-zinc-900 hover:border-rose-500/50 hover:text-rose-400 p-2 text-zinc-400"
                        title="Delete Autopilot Rule"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          MODE 3: LISTENBRAINZ WEEKLY EXPLORATION & JAMS (BETTER THAN EXPLO)
         ===================================================================== */}
      {subMode === 'listenbrainz' && (
        <div className="winamp-bezel rounded-2xl border border-zinc-700/80 p-5 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white font-mono flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span>
                  ListenBrainz Discovery Playlists
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Shows exactly which songs in your ListenBrainz mixes are{' '}
                <span className="text-[#00ff66]">In Library</span>,{' '}
                <span className="text-sky-300">Downloading</span>,{' '}
                <span className="text-rose-300">Not Found</span>, or{' '}
                <span className="text-purple-300">Excluded by Filters</span>—and
                downloads missing songs via <code className="text-[#00ff66]">slskd</code> or{' '}
                <code className="text-rose-300">YouTube Music</code>.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchListenBrainzDiscover(lbUsernameInput);
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={lbUsernameInput}
                onChange={(e) => setLbUsernameInput(e.target.value)}
                placeholder="ListenBrainz username..."
                aria-label="ListenBrainz Username"
                data-testid="listenbrainz-username-input"
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none min-h-[38px]"
              />
              <button
                type="submit"
                disabled={isLoadingLb}
                data-testid="listenbrainz-fetch-btn"
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3.5 py-2 text-xs font-mono font-bold text-zinc-950 min-h-[38px]"
              >
                {isLoadingLb ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>Sync Mixes</span>
              </button>
            </form>
          </div>

          {lbError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs font-mono text-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{lbError}</span>
            </div>
          )}

          {isLoadingLb ? (
            <div className="py-12 text-center text-xs font-mono text-zinc-400 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-[#00ff66]" />
              <span>
                Fetching ListenBrainz Weekly Exploration &amp; Weekly Jams...
              </span>
            </div>
          ) : lbPlaylists.length === 0 ? (
            <div className="py-10 text-center text-xs font-mono text-zinc-400">
              Enter your ListenBrainz username above and click Sync Mixes.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Playlist Selector Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {lbPlaylists.map((pl) => {
                  const isSelected = activeLbPlaylist?.id === pl.id;
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => setSelectedLbPlaylistId(pl.id)}
                      className={`rounded-2xl border p-4 text-left transition-all flex flex-col justify-between gap-2 ${
                        isSelected
                          ? 'border-[#00ff66] bg-emerald-500/15 ring-1 ring-[#00ff66]/50'
                          : 'border-zinc-800 bg-zinc-950/80 hover:border-zinc-700'
                      }`}
                    >
                      <div>
                        <span className="text-[10px] font-mono uppercase text-purple-300 font-bold">
                          ListenBrainz Mix
                        </span>
                        <h3 className="text-sm font-bold text-white truncate mt-0.5">
                          {pl.title}
                        </h3>
                      </div>

                      <div className="flex items-center justify-between text-[11px] font-mono pt-2 border-t border-zinc-800/80">
                        <span className="text-[#00ff66]">
                          {pl.inLibraryCount}/{pl.trackCount} in Library
                        </span>
                        <span className="text-amber-300">
                          {pl.missingCount} missing
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Active ListenBrainz Playlist Detail with Better-Than-Explo Status Breakdown */}
              {activeLbPlaylist &&
                (() => {
                  const enrichedTracks = activeLbPlaylist.tracks.map((tr) => ({
                    tr,
                    rich: getPlaylistTrackRichStatus({
                      title: tr.title,
                      artist: tr.artist,
                      album: tr.album,
                      durationSec: Math.round((tr.durationMs || 210000) / 1000),
                      inLibrary: tr.inLibrary,
                    }),
                  }));

                  const countInJf = enrichedTracks.filter(
                    (x) => x.rich.state === 'in_jellyfin'
                  ).length;
                  const countDownloading = enrichedTracks.filter(
                    (x) => x.rich.state === 'downloading'
                  ).length;
                  const countNotFound = enrichedTracks.filter(
                    (x) => x.rich.state === 'not_found'
                  ).length;
                  const countFiltered = enrichedTracks.filter(
                    (x) => x.rich.state === 'filtered'
                  ).length;
                  const countMissing = enrichedTracks.filter(
                    (x) => x.rich.state === 'missing'
                  ).length;

                  const missingTracksToGrab = enrichedTracks
                    .filter(
                      (x) =>
                        x.rich.state === 'missing' ||
                        x.rich.state === 'not_found'
                    )
                    .map((x) => ({
                      artist: x.tr.artist,
                      title: x.tr.title,
                      durationSec: Math.round(
                        (x.tr.durationMs || 210000) / 1000
                      ),
                    }));

                  const visibleTracks = enrichedTracks.filter((x) =>
                    statusFilter === 'all'
                      ? true
                      : x.rich.state === statusFilter
                  );

                  return (
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4 sm:p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
                        <div>
                          <h3 className="text-base font-bold text-white font-mono">
                            {activeLbPlaylist.title}
                          </h3>
                          <p className="text-xs text-zinc-400">
                            {countInJf} in Library · {countMissing} missing ·{' '}
                            {countDownloading} downloading · {countNotFound} not
                            found · {countFiltered} excluded by filters
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={
                              missingTracksToGrab.length === 0 ||
                              grabbingKey === `lb-pl-${activeLbPlaylist.id}`
                            }
                            onClick={() =>
                              handleGrabViaDownloader({
                                key: `lb-pl-${activeLbPlaylist.id}`,
                                type: 'playlist',
                                tracks: missingTracksToGrab,
                              })
                            }
                            data-testid="download-missing-playlist-tracks-btn"
                            className="inline-flex items-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-40 px-4 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[38px]"
                          >
                            {grabbingKey === `lb-pl-${activeLbPlaylist.id}` ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <ArrowDownToLine className="w-4 h-4" />
                            )}
                            <span>
                              Download {missingTracksToGrab.length} Missing (
                              {sourceMode.toUpperCase()})
                            </span>
                          </button>

                          <button
                            type="button"
                            disabled={
                              missingTracksToGrab.length === 0 ||
                              grabbingKey === `lb-yt-${activeLbPlaylist.id}`
                            }
                            onClick={() =>
                              handleGrabViaDownloader({
                                key: `lb-yt-${activeLbPlaylist.id}`,
                                type: 'playlist',
                                tracks: missingTracksToGrab,
                                overrideSource: 'youtube',
                              })
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500 hover:text-zinc-950 disabled:opacity-40 px-3 py-2 text-xs font-mono font-bold text-rose-300 transition-colors min-h-[38px]"
                          >
                            <Youtube className="w-4 h-4" />
                            <span>Grab Missing via YouTube</span>
                          </button>
                        </div>
                      </div>

                      {/* Filter Pills */}
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                        <button
                          type="button"
                          onClick={() => setStatusFilter('all')}
                          className={`rounded-lg px-2.5 py-1 border ${
                            statusFilter === 'all'
                              ? 'border-white bg-zinc-800 text-white font-bold'
                              : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'
                          }`}
                        >
                          All ({enrichedTracks.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusFilter('in_jellyfin')}
                          className={`rounded-lg px-2.5 py-1 border ${
                            statusFilter === 'in_jellyfin'
                              ? 'border-[#00ff66] bg-emerald-500/20 text-[#00ff66] font-bold'
                              : 'border-emerald-500/30 bg-emerald-500/10 text-[#00ff66]'
                          }`}
                        >
                          🟢 In Library ({countInJf})
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusFilter('missing')}
                          className={`rounded-lg px-2.5 py-1 border ${
                            statusFilter === 'missing'
                              ? 'border-amber-400 bg-amber-500/25 text-amber-200 font-bold'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                          }`}
                        >
                          🟡 Missing ({countMissing})
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusFilter('downloading')}
                          className={`rounded-lg px-2.5 py-1 border ${
                            statusFilter === 'downloading'
                              ? 'border-sky-400 bg-sky-500/25 text-sky-200 font-bold'
                              : 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                          }`}
                        >
                          🔵 Downloading ({countDownloading})
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusFilter('not_found')}
                          className={`rounded-lg px-2.5 py-1 border ${
                            statusFilter === 'not_found'
                              ? 'border-rose-400 bg-rose-500/25 text-rose-200 font-bold'
                              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                          }`}
                        >
                          🔴 Cant Find ({countNotFound})
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusFilter('filtered')}
                          className={`rounded-lg px-2.5 py-1 border ${
                            statusFilter === 'filtered'
                              ? 'border-purple-400 bg-purple-500/25 text-purple-200 font-bold'
                              : 'border-purple-500/30 bg-purple-500/10 text-purple-300'
                          }`}
                        >
                          ⚪ Excluded ({countFiltered})
                        </button>
                      </div>

                      <div className="divide-y divide-zinc-800/70 max-h-[460px] overflow-y-auto pr-1">
                        {visibleTracks.map(({ tr, rich }, idx) => {
                          const trKey = `lb-tr-${tr.id}`;
                          return (
                            <div
                              key={tr.id}
                              className="py-2.5 px-2 flex items-center justify-between gap-3 text-xs"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span className="w-6 text-right font-mono text-zinc-500">
                                    {idx + 1}.
                                  </span>
                                  <span className="font-bold text-white truncate">
                                    {tr.title}
                                  </span>
                                  <span className="text-[#00ff66] font-mono truncate">
                                    — {tr.artist}
                                  </span>
                                  <span className="text-zinc-500 font-mono hidden md:inline">
                                    (
                                    {formatDuration(
                                      Math.round((tr.durationMs || 210000) / 1000)
                                    )}
                                    )
                                  </span>
                                </div>
                                <div className="pl-8 mt-0.5 text-[11px] font-mono">
                                  {rich.state === 'in_jellyfin' && (
                                    <span className="text-[#00ff66]">
                                      ✓ In Brokeify Library
                                    </span>
                                  )}
                                  {rich.state === 'downloading' && (
                                    <span className="text-sky-300">
                                      ⏳{' '}
                                      {rich.matchedJob?.message ||
                                        'Downloading...'}
                                    </span>
                                  )}
                                  {rich.state === 'not_found' && (
                                    <span className="text-rose-300">
                                      ❌{' '}
                                      {rich.matchedJob?.message ||
                                        'Not found on slskd'}
                                    </span>
                                  )}
                                  {rich.state === 'filtered' && (
                                    <span className="text-purple-300">
                                      🚫 {rich.filterReason}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {rich.matchedTrack ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onPlayTrack(rich.matchedTrack!)
                                    }
                                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-[11px] font-mono font-bold text-[#00ff66]"
                                  >
                                    <Play className="w-3 h-3 fill-current" />
                                    <span>Play</span>
                                  </button>
                                ) : rich.state === 'in_jellyfin' ? (
                                  <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-[11px] font-mono text-[#00ff66]">
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>In Library</span>
                                  </span>
                                ) : rich.state === 'downloading' ? (
                                  <span className="inline-flex items-center gap-1 rounded-lg bg-sky-500/20 border border-sky-500/40 px-2.5 py-1 text-[11px] font-mono text-sky-300">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    <span>Downloading</span>
                                  </span>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      disabled={grabbingKey === trKey}
                                      onClick={() =>
                                        handleGrabViaDownloader({
                                          key: trKey,
                                          type: 'track',
                                          artist: tr.artist,
                                          title: tr.title,
                                          ignoreFilters:
                                            rich.state === 'filtered',
                                        })
                                      }
                                      className="inline-flex items-center gap-1 rounded-lg bg-purple-600 hover:bg-purple-500 px-2.5 py-1 text-[11px] font-mono font-bold text-white"
                                    >
                                      <ArrowDownToLine className="w-3 h-3" />
                                      <span>
                                        {rich.state === 'filtered'
                                          ? 'Override'
                                          : 'Grab'}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={grabbingKey === `${trKey}-yt`}
                                      onClick={() =>
                                        handleGrabViaDownloader({
                                          key: `${trKey}-yt`,
                                          type: 'track',
                                          artist: tr.artist,
                                          title: tr.title,
                                          overrideSource: 'youtube',
                                          ignoreFilters: true,
                                        })
                                      }
                                      title="Download via YouTube Music"
                                      className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500 hover:text-zinc-950 px-2 py-1 text-[11px] font-mono font-bold text-rose-300"
                                    >
                                      <Youtube className="w-3 h-3" />
                                      <span>YT</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          MODE 4: EXPLO-STYLE EXCLUSION FILTERS & CUSTOM FILTER SCRIPTS
         ===================================================================== */}
      {subMode === 'filters' && (
        <div
          data-testid="discover-exclusion-filters-panel"
          className="winamp-bezel rounded-2xl border border-zinc-700/80 p-5 space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-white font-mono flex items-center gap-2">
                <Filter className="w-4 h-4 text-[#00ff66]" />
                <span>
                  Exclusion Filters &amp; Custom Filter Script (Skip Live, Remix, Acoustic &amp; More)
                </span>
              </h2>
              <p className="text-xs text-zinc-300">
                Turn on any toggle below or write your own custom rule so
                Brokeify automatically skips unwanted versions when downloading
                playlists or albums.
              </p>
            </div>

            {onSaveDiscoveryFiltersNow && (
              <button
                type="button"
                disabled={isSavingFilters}
                onClick={async () => {
                  setIsSavingFilters(true);
                  try {
                    await onSaveDiscoveryFiltersNow(discoveryFilters);
                  } finally {
                    setIsSavingFilters(false);
                  }
                }}
                data-testid="save-discovery-filters-btn"
                className="inline-flex items-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[40px] shrink-0"
              >
                {isSavingFilters ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Save Filters to Server</span>
              </button>
            )}
          </div>

          {/* 1-Click Exclusion Toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {[
              {
                key: 'excludeLive' as const,
                title: '🚫 Exclude Live Versions',
                desc: 'Skips songs with "Live", "Live at...", "In Concert", or "Live Session" in the title or album.',
              },
              {
                key: 'excludeRemix' as const,
                title: '🚫 Exclude Remixes & Club Edits',
                desc: 'Skips songs with "Remix", "Club Mix", "Extended Mix", "VIP Mix", "Bootleg", or "Mashup".',
              },
              {
                key: 'excludeAcoustic' as const,
                title: '🚫 Exclude Acoustic & Stripped',
                desc: 'Skips "Acoustic", "Unplugged", "Stripped", or "Piano Version" recordings.',
              },
              {
                key: 'excludeInstrumental' as const,
                title: '🚫 Exclude Instrumentals & Karaoke',
                desc: 'Skips "Instrumental", "Karaoke", "Backing Track", "Tribute", and "8-Bit" covers.',
              },
              {
                key: 'excludeSpedUpSlowed' as const,
                title: '🚫 Exclude Sped Up / Slowed & Reverb',
                desc: 'Skips TikTok-style "Sped Up", "Nightcore", "Slowed + Reverb", and "8D Audio" edits.',
              },
              {
                key: 'excludeCommentary' as const,
                title: '🚫 Exclude Commentary & Skits',
                desc: 'Skips "Track by Track Commentary", "Interview", "Skit", and "Voice Memo" tracks.',
              },
            ].map((item) => {
              const isChecked = Boolean(discoveryFilters[item.key]);
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() =>
                    onUpdateDiscoveryFilters({
                      ...discoveryFilters,
                      [item.key]: !isChecked,
                    })
                  }
                  data-testid={`filter-toggle-${item.key}`}
                  className={`rounded-2xl border p-4 text-left transition-all flex flex-col justify-between gap-2 ${
                    isChecked
                      ? 'border-[#00ff66] bg-emerald-500/15 ring-1 ring-[#00ff66]/40'
                      : 'border-zinc-800 bg-zinc-950/80 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-white">
                      {item.title}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-mono font-bold uppercase ${
                        isChecked
                          ? 'bg-[#00ff66] text-zinc-950'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {isChecked ? 'BLOCKING' : 'ALLOWED'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    {item.desc}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Custom Excluded Words + Duration Bounds */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
              <h3 className="text-xs font-mono font-bold uppercase text-[#00ff66]">
                Custom Excluded Words / Phrases
              </h3>
              <p className="text-xs text-zinc-400">
                Add any word or artist name you never want downloaded (for
                example: <code className="text-white">demo</code>,{' '}
                <code className="text-white">clean version</code>,{' '}
                <code className="text-white">mono</code>).
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const word = newExcludedWord.trim();
                  if (!word) return;
                  const nextWords = Array.from(
                    new Set([
                      ...(discoveryFilters.customExcludedWords || []),
                      word,
                    ])
                  );
                  onUpdateDiscoveryFilters({
                    ...discoveryFilters,
                    customExcludedWords: nextWords,
                  });
                  setNewExcludedWord('');
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={newExcludedWord}
                  onChange={(e) => setNewExcludedWord(e.target.value)}
                  placeholder="Type word to exclude (e.g. demo)..."
                  data-testid="input-custom-exclude-word"
                  className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                />
                <button
                  type="submit"
                  data-testid="add-custom-exclude-word-btn"
                  className="inline-flex items-center gap-1 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3.5 py-2 text-xs font-mono font-bold text-zinc-950"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Word</span>
                </button>
              </form>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {(discoveryFilters.customExcludedWords || []).length === 0 ? (
                  <span className="text-[11px] font-mono text-zinc-500">
                    No custom excluded words added yet.
                  </span>
                ) : (
                  (discoveryFilters.customExcludedWords || []).map((word) => (
                    <span
                      key={word}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-xs font-mono text-rose-200"
                    >
                      <Ban className="w-3 h-3 text-rose-400" />
                      <span>{word}</span>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateDiscoveryFilters({
                            ...discoveryFilters,
                            customExcludedWords: (
                              discoveryFilters.customExcludedWords || []
                            ).filter((w) => w !== word),
                          })
                        }
                        className="text-rose-300 hover:text-white ml-1"
                        aria-label={`Remove ${word}`}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* Min / Max Track Length Filter */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
              <h3 className="text-xs font-mono font-bold uppercase text-[#00ff66]">
                Song Length Limits (Skip Short Skits &amp; Giant DJ Mixes)
              </h3>
              <p className="text-xs text-zinc-400">
                Automatically ignore super-short album intros/skits or hour-long
                continuous DJ mixes.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">
                    Minimum Length:{' '}
                    <strong className="text-[#00ff66] font-mono">
                      {discoveryFilters.minDurationSec}s
                    </strong>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={180}
                    step={15}
                    value={discoveryFilters.minDurationSec}
                    onChange={(e) =>
                      onUpdateDiscoveryFilters({
                        ...discoveryFilters,
                        minDurationSec: Number(e.target.value),
                      })
                    }
                    className="w-full cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-xs text-zinc-300 mb-1">
                    Maximum Length:{' '}
                    <strong className="text-[#00ff66] font-mono">
                      {Math.round(discoveryFilters.maxDurationSec / 60)} min (
                      {discoveryFilters.maxDurationSec}s)
                    </strong>
                  </label>
                  <input
                    type="range"
                    min={300}
                    max={1800}
                    step={60}
                    value={discoveryFilters.maxDurationSec}
                    onChange={(e) =>
                      onUpdateDiscoveryFilters({
                        ...discoveryFilters,
                        maxDurationSec: Number(e.target.value),
                      })
                    }
                    className="w-full cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Custom JavaScript Filter Script */}
          <div className="rounded-2xl border border-purple-500/40 bg-zinc-950/90 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-purple-400" />
                <h3 className="text-xs font-mono font-bold uppercase text-purple-300">
                  Custom Filter Script (Advanced Rule Engine)
                </h3>
              </div>

              <button
                type="button"
                onClick={() =>
                  onUpdateDiscoveryFilters({
                    ...discoveryFilters,
                    customScriptEnabled: !discoveryFilters.customScriptEnabled,
                  })
                }
                data-testid="toggle-custom-filter-script"
                className={`rounded-xl px-3 py-1.5 text-xs font-mono font-bold transition-colors ${
                  discoveryFilters.customScriptEnabled
                    ? 'bg-[#00ff66] text-zinc-950'
                    : 'bg-zinc-800 text-zinc-300 hover:text-white'
                }`}
              >
                {discoveryFilters.customScriptEnabled
                  ? '● Custom Script ENABLED'
                  : 'Enable Custom Script'}
              </button>
            </div>

            <p className="text-xs text-zinc-300">
              Write any custom JavaScript rule using{' '}
              <code className="text-[#00ff66]">title</code>,{' '}
              <code className="text-[#00ff66]">artist</code>,{' '}
              <code className="text-[#00ff66]">album</code>, and{' '}
              <code className="text-[#00ff66]">durationSec</code>. Return{' '}
              <code className="text-rose-300">false</code> to exclude a song or{' '}
              <code className="text-[#00ff66]">true</code> to keep it.
            </p>

            <textarea
              rows={5}
              value={discoveryFilters.customScriptCode}
              onChange={(e) =>
                onUpdateDiscoveryFilters({
                  ...discoveryFilters,
                  customScriptCode: e.target.value,
                })
              }
              data-testid="custom-filter-script-textarea"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-xs font-mono text-emerald-200 leading-relaxed focus:border-[#00ff66] focus:outline-none"
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  onUpdateDiscoveryFilters({
                    ...DEFAULT_DISCOVERY_FILTERS,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-zinc-500 px-3 py-1.5 text-xs font-mono text-zinc-300"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Reset Filters to Default</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODE 4B: AUTOPILOT LINKED PLAYLISTS & MUSICBRAINZ PICARD + AI ORGANIZER
         ===================================================================== */}
      {subMode === 'autopilot' && (
        <div
          data-testid="discover-autopilot-picard-panel"
          className="space-y-6"
        >
          {/* Section A: Autopilot Linked Playlists */}
          <div className="winamp-bezel rounded-2xl border border-zinc-700/80 p-5 space-y-5">
            <div className="space-y-1 border-b border-zinc-800 pb-4">
              <h2 className="text-base font-bold text-white font-mono flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-[#00ff66]" />
                <span>
                  Autopilot Linked Playlists (Daily, Weekly, or Monthly Spotify Sync)
                </span>
              </h2>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Link any of your playlists to a public{' '}
                <strong className="text-white">Spotify Playlist URL</strong>.
                Brokeify will automatically check that Spotify playlist{' '}
                <strong className="text-[#00ff66]">
                  Daily, Weekly, or Monthly
                </strong>{' '}
                in the background, download any new songs via{' '}
                <code className="text-[#00ff66]">slskd</code> or{' '}
                <code className="text-rose-300">YouTube Music</code>, organize
                them into clean folders, and add them to your playlist!
              </p>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!apSpotifyUrl.trim()) {
                  onShowToast('Paste a Spotify Playlist URL first.');
                  return;
                }
                const targetPl = playlists.find((p) => p.id === apPlaylistId);
                setIsSavingAutopilot(true);
                try {
                  const resp = await fetch('/api/autopilot/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      rule: {
                        id: `autopilot-${Date.now()}`,
                        playlistId: targetPl?.id || `pl-auto-${Date.now()}`,
                        playlistName:
                          targetPl?.name || 'Autopilot Spotify Mix',
                        spotifyUrl: apSpotifyUrl.trim(),
                        interval: apInterval,
                        enabled: true,
                        preferredDownloader: sourceMode,
                        organizeWithPicard: true,
                      },
                    }),
                  });
                  const data = await resp.json();
                  if (resp.ok && data.ok) {
                    onShowToast(
                      `🤖 Autopilot rule saved! Will check Spotify ${apInterval}.`
                    );
                    setApSpotifyUrl('');
                    if (onRefreshAutopilotRules) onRefreshAutopilotRules();
                  } else {
                    onShowToast(
                      `⚠️ ${data.error || 'Could not save Autopilot rule'}`
                    );
                  }
                } finally {
                  setIsSavingAutopilot(false);
                }
              }}
              className="grid grid-cols-1 md:grid-cols-12 gap-3 rounded-2xl border border-emerald-500/30 bg-zinc-950/90 p-4"
            >
              <div className="md:col-span-3">
                <label className="block text-xs font-mono text-zinc-300 mb-1">
                  1. Target Playlist
                </label>
                <select
                  value={apPlaylistId}
                  onChange={(e) => setApPlaylistId(e.target.value)}
                  data-testid="autopilot-select-playlist"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none min-h-[40px]"
                >
                  <option value="">+ Create New Autopilot Playlist</option>
                  {playlists.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-4">
                <label className="block text-xs font-mono text-zinc-300 mb-1">
                  2. Spotify Playlist URL to Watch
                </label>
                <input
                  type="text"
                  value={apSpotifyUrl}
                  onChange={(e) => setApSpotifyUrl(e.target.value)}
                  placeholder="https://open.spotify.com/playlist/..."
                  data-testid="autopilot-spotify-url-input"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none min-h-[40px]"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-mono text-zinc-300 mb-1">
                  3. Check Schedule
                </label>
                <select
                  value={apInterval}
                  onChange={(e) =>
                    setApInterval(e.target.value as AutopilotScheduleInterval)
                  }
                  data-testid="autopilot-schedule-select"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-[#00ff66] font-bold focus:border-[#00ff66] focus:outline-none min-h-[40px]"
                >
                  <option value="daily">Every Day (Daily)</option>
                  <option value="weekly">Every Week (Weekly)</option>
                  <option value="monthly">Every Month (Monthly)</option>
                </select>
              </div>

              <div className="md:col-span-3 flex items-end">
                <button
                  type="submit"
                  disabled={isSavingAutopilot}
                  data-testid="autopilot-create-btn"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2.5 text-xs font-mono font-bold text-zinc-950 min-h-[40px]"
                >
                  {isSavingAutopilot ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  <span>Enable Autopilot</span>
                </button>
              </div>
            </form>

            {/* Active Autopilot Rules List */}
            {autopilotRules.length === 0 ? (
              <div className="py-6 text-center text-xs font-mono text-zinc-400">
                No Autopilot linked playlists active yet. Add one above or from
                any playlist&apos;s <strong className="text-white">⋯</strong> menu!
              </div>
            ) : (
              <div className="space-y-3">
                {autopilotRules.map((rule) => (
                  <div
                    key={rule.id}
                    data-testid={`autopilot-rule-${rule.id}`}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66] uppercase">
                          AUTOPILOT: {rule.interval.toUpperCase()}
                        </span>
                        <span className="text-sm font-bold text-white truncate">
                          {rule.playlistName}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-zinc-400 truncate">
                        Linked Spotify URL: {rule.spotifyUrl}
                      </div>
                      {rule.lastRunMessage && (
                        <div className="text-[11px] font-mono text-purple-300">
                          Last Check: {rule.lastRunMessage}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={syncingRuleId === rule.id}
                        onClick={async () => {
                          setSyncingRuleId(rule.id);
                          try {
                            const resp = await fetch(
                              '/api/autopilot/sync-now',
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ruleId: rule.id }),
                              }
                            );
                            const data = await resp.json();
                            onShowToast(
                              data.message || 'Autopilot check completed!'
                            );
                            if (onRefreshAutopilotRules)
                              onRefreshAutopilotRules();
                            onRefreshStatus();
                          } finally {
                            setSyncingRuleId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3 py-1.5 text-xs font-mono font-bold text-zinc-950"
                      >
                        {syncingRuleId === rule.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        <span>Check &amp; Sync Now</span>
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          await fetch(
                            `/api/autopilot/${encodeURIComponent(rule.id)}`,
                            { method: 'DELETE' }
                          );
                          onShowToast('Removed Autopilot rule.');
                          if (onRefreshAutopilotRules)
                            onRefreshAutopilotRules();
                        }}
                        className="rounded-xl border border-zinc-800 bg-zinc-900 hover:border-rose-500/50 hover:text-rose-400 p-2 text-zinc-400"
                        title="Delete Autopilot Rule"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section B: MusicBrainz Picard + AI Auto-Tagger & Folder Organizer */}
          <div className="winamp-bezel rounded-2xl border border-zinc-700/80 p-5 space-y-5">
            <div className="space-y-1 border-b border-zinc-800 pb-4">
              <h2 className="text-base font-bold text-white font-mono flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span>
                  MusicBrainz Picard + AI Auto-Tagger &amp; Organized Folder Builder
                </span>
              </h2>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Automatically cleans messy download filenames (like{' '}
                <code className="text-rose-300">
                  Linkin_Park_-_In_The_End_Official_Video_1080p.mp3
                </code>
                ), looks up the canonical Album, Release Year, and Track Number
                via <strong className="text-white">MusicBrainz Picard</strong>{' '}
                and <strong className="text-[#00ff66]">AI Metadata Cleaning</strong>,
                and organizes downloads into neat{' '}
                <code className="text-[#00ff66]">
                  {picardConfig?.folderTemplate ||
                    '{Artist}/{Album} ({Year})/{TrackNumber} - {Title}.{ext}'}
                </code>{' '}
                folders for Jellyfin!
              </p>
            </div>

            {picardConfig && onUpdatePicardConfig && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono text-zinc-300 mb-1">
                    Folder Organization Template (Picard Style)
                  </label>
                  <input
                    type="text"
                    value={picardConfig.folderTemplate}
                    onChange={(e) =>
                      onUpdatePicardConfig({
                        ...picardConfig,
                        folderTemplate: e.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-[#00ff66] focus:border-[#00ff66] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-zinc-300 mb-1">
                    Music Library Download Folder Path
                  </label>
                  <input
                    type="text"
                    value={picardConfig.targetMusicRoot}
                    onChange={(e) =>
                      onUpdatePicardConfig({
                        ...picardConfig,
                        targetMusicRoot: e.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Interactive Picard + AI Metadata Test Box */}
            <div className="rounded-2xl border border-purple-500/30 bg-zinc-950/90 p-4 space-y-3">
              <label className="block text-xs font-mono font-bold uppercase text-purple-300">
                Test MusicBrainz Picard + AI Folder Organizer on Any Messy Song Name:
              </label>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  value={picardTestInput}
                  onChange={(e) => setPicardTestInput(e.target.value)}
                  placeholder="Paste any messy filename or song title..."
                  data-testid="picard-test-input"
                  className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-mono text-white"
                />
                <button
                  type="button"
                  disabled={isTestingPicard}
                  onClick={async () => {
                    setIsTestingPicard(true);
                    try {
                      const parts = picardTestInput.split(' - ');
                      const artist =
                        parts.length > 1 ? parts[0].trim() : 'Unknown Artist';
                      const title =
                        parts.length > 1
                          ? parts.slice(1).join(' - ').trim()
                          : picardTestInput.trim();
                      const resp = await fetch('/api/picard/resolve-metadata', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          artist,
                          title,
                          ext: 'flac',
                          folderTemplate: picardConfig?.folderTemplate,
                        }),
                      });
                      const data = await resp.json();
                      if (resp.ok && data.ok && data.resolved) {
                        setPicardTestResult(data.resolved);
                      }
                    } finally {
                      setIsTestingPicard(false);
                    }
                  }}
                  data-testid="picard-test-btn"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2 text-xs font-mono font-bold text-white shrink-0 min-h-[38px]"
                >
                  {isTestingPicard ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>Clean &amp; Organize with Picard + AI</span>
                </button>
              </div>

              {picardTestResult && (
                <div
                  data-testid="picard-test-result"
                  className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3.5 text-xs font-mono space-y-1.5"
                >
                  <div className="text-[#00ff66] font-bold">
                    ✓ Organized Folder Path: {picardTestResult.organizedPath}
                  </div>
                  <div className="text-zinc-300">
                    Artist: <strong>{picardTestResult.artist}</strong> · Title:{' '}
                    <strong>{picardTestResult.title}</strong> · Album:{' '}
                    <strong>
                      {picardTestResult.album} ({picardTestResult.year})
                    </strong>{' '}
                    · Track #{picardTestResult.trackNumber} (Source:{' '}
                    {picardTestResult.source})
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODE 5: ACTIVE & COMPLETED DOWNLOAD TRANSFERS (slskd + YouTube Music)
         ===================================================================== */}
      {subMode === 'transfers' && (() => {
        const activeCount = jobs.filter(
          (j) => j.status === 'downloading' || j.status === 'searching'
        ).length;
        const almostDoneCount = jobs.filter((j) => {
          const pct = computeJobProgressPercent(j);
          return (
            j.status === 'downloading' &&
            (Boolean(j.isAlmostDone) || (pct >= 85 && pct < 100))
          );
        }).length;
        const queuedCount = jobs.filter((j) => j.status === 'queued').length;
        const completedCount = jobs.filter(
          (j) => j.status === 'completed'
        ).length;
        const failedCount = jobs.filter(
          (j) => j.status === 'failed' || j.status === 'not_found'
        ).length;
        const filteredCount = jobs.filter(
          (j) => j.status === 'filtered'
        ).length;

        const searchClean = transferSearchQuery.trim().toLowerCase();
        const filteredTransferJobs = jobs.filter((job) => {
          const pct = computeJobProgressPercent(job);
          const isAlmost =
            job.status === 'downloading' &&
            (Boolean(job.isAlmostDone) || (pct >= 85 && pct < 100));

          if (transferStatusFilter === 'active') {
            if (job.status !== 'downloading' && job.status !== 'searching') {
              return false;
            }
          } else if (transferStatusFilter === 'almost_done') {
            if (!isAlmost) return false;
          } else if (transferStatusFilter === 'queued') {
            if (job.status !== 'queued') return false;
          } else if (transferStatusFilter === 'completed') {
            if (job.status !== 'completed') return false;
          } else if (transferStatusFilter === 'failed') {
            if (job.status !== 'failed' && job.status !== 'not_found') {
              return false;
            }
          } else if (transferStatusFilter === 'filtered') {
            if (job.status !== 'filtered') return false;
          }

          if (
            transferEngineFilter !== 'all' &&
            (job.sourceEngine || 'slskd') !== transferEngineFilter
          ) {
            return false;
          }

          if (searchClean) {
            const hay = `${job.label || ''} ${job.artist || ''} ${
              job.title || ''
            } ${job.matchedPeer || ''} ${job.message || ''} ${
              job.sourceEngine || ''
            }`.toLowerCase();
            if (!hay.includes(searchClean)) return false;
          }

          return true;
        });

        return (
          <div className="winamp-bezel rounded-2xl border border-zinc-700/80 p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white font-mono">
                  Automated Download Transfers &amp; Library Auto-Importer
                </h2>
                <p className="text-xs text-zinc-400">
                  Live transfer progress from{' '}
                  <code className="text-[#00ff66]">slskd</code>,{' '}
                  <code className="text-rose-300">YouTube Music (yt-dlp)</code>,
                  and <code className="text-sky-300">Open Audio Archive</code>.
                  Automatically fingerprints, tags, and organizes completed
                  tracks into <code className="text-[#00ff66]">/music</code>!
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {completedCount > 0 && (
                  <button
                    type="button"
                    disabled={managingJobsAction !== null}
                    onClick={() =>
                      handleManageDownloadJobs({ action: 'clear-completed' })
                    }
                    data-testid="downloads-remove-completed-btn"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-3 py-2 text-xs font-mono font-bold text-[#00ff66] transition-colors min-h-[36px] disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Remove Completed ({completedCount})</span>
                  </button>
                )}

                {failedCount > 0 && (
                  <>
                    <button
                      type="button"
                      disabled={managingJobsAction !== null}
                      onClick={() =>
                        handleManageDownloadJobs({
                          action: 'retry-all-failed',
                        })
                      }
                      data-testid="downloads-retry-errors-btn"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/50 bg-amber-500/15 hover:bg-amber-500/25 px-3 py-2 text-xs font-mono font-bold text-amber-300 transition-colors min-h-[36px] disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Retry All Errors ({failedCount})</span>
                    </button>

                    <button
                      type="button"
                      disabled={managingJobsAction !== null}
                      onClick={() =>
                        handleManageDownloadJobs({
                          action: 'retry-all-failed',
                          sourceMode: 'youtube',
                          ignoreFilters: true,
                        })
                      }
                      data-testid="downloads-retry-errors-yt-btn"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/50 bg-rose-500/15 hover:bg-rose-500/25 px-3 py-2 text-xs font-mono font-bold text-rose-300 transition-colors min-h-[36px] disabled:opacity-50"
                    >
                      <Youtube className="w-3.5 h-3.5" />
                      <span>Retry Errors via YouTube</span>
                    </button>
                  </>
                )}

                {(failedCount > 0 || filteredCount > 0) && (
                  <button
                    type="button"
                    disabled={managingJobsAction !== null}
                    onClick={() =>
                      handleManageDownloadJobs({ action: 'clear-failed' })
                    }
                    data-testid="downloads-clear-failed-btn"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-rose-500/50 hover:text-rose-300 px-3 py-2 text-xs font-mono text-zinc-300 transition-colors min-h-[36px] disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>
                      Clear Failed/Filtered ({failedCount + filteredCount})
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onRefreshStatus}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-200 hover:text-white min-h-[36px]"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#00ff66]" />
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {/* Filter Bar: Status Pills + Engine Filter + Search Input */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/75 p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: `All (${jobs.length})` },
                    {
                      id: 'active',
                      label: `Downloading / Active (${activeCount})`,
                    },
                    {
                      id: 'almost_done',
                      label: `Almost Done 85%+ (${almostDoneCount})`,
                    },
                    { id: 'queued', label: `Queued (${queuedCount})` },
                    { id: 'completed', label: `Completed (${completedCount})` },
                    {
                      id: 'failed',
                      label: `Errors / Failed (${failedCount})`,
                    },
                    { id: 'filtered', label: `Filtered (${filteredCount})` },
                  ] as const
                ).map((pill) => {
                  const active = transferStatusFilter === pill.id;
                  return (
                    <button
                      key={pill.id}
                      type="button"
                      onClick={() => setTransferStatusFilter(pill.id)}
                      data-testid={`downloads-filter-${pill.id}`}
                      className={`rounded-lg px-2.5 py-1.5 text-[11px] font-mono font-bold transition-colors ${
                        active
                          ? 'bg-[#00ff66] text-zinc-950 shadow-sm'
                          : 'bg-zinc-900 text-zinc-300 border border-zinc-800 hover:border-zinc-700 hover:text-white'
                      }`}
                    >
                      {pill.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-mono text-zinc-400 mr-1">
                    Engine:
                  </span>
                  {(
                    [
                      { id: 'all', label: 'All Engines' },
                      { id: 'slskd', label: 'slskd P2P' },
                      { id: 'youtube', label: 'YouTube (yt-dlp)' },
                      { id: 'archive', label: 'Open Archive' },
                      { id: 'lidarr', label: 'Lidarr' },
                    ] as const
                  ).map((eng) => {
                    const active = transferEngineFilter === eng.id;
                    return (
                      <button
                        key={eng.id}
                        type="button"
                        onClick={() => setTransferEngineFilter(eng.id)}
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-mono transition-colors ${
                          active
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/50 font-bold'
                            : 'bg-zinc-900/90 text-zinc-400 border border-zinc-800 hover:text-zinc-200'
                        }`}
                      >
                        {eng.label}
                      </button>
                    );
                  })}
                </div>

                <div className="relative flex-1 max-w-xs">
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={transferSearchQuery}
                    onChange={(e) => setTransferSearchQuery(e.target.value)}
                    placeholder="Filter downloads by song, artist, peer..."
                    data-testid="downloads-search-input"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/90 pl-8 pr-3 py-1.5 text-xs font-mono text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#00ff66]"
                  />
                </div>
              </div>
            </div>

            {jobs.length === 0 ? (
              <div className="py-10 text-center text-xs font-mono text-zinc-400 space-y-2">
                <Music className="w-8 h-8 text-zinc-600 mx-auto" />
                <p>
                  No download jobs queued yet. Grab an album, song, Spotify
                  playlist, or ListenBrainz mix!
                </p>
              </div>
            ) : filteredTransferJobs.length === 0 ? (
              <div className="py-8 text-center text-xs font-mono text-zinc-400 space-y-2">
                <Filter className="w-6 h-6 text-zinc-600 mx-auto" />
                <p>No download transfers match your current filters.</p>
                <button
                  type="button"
                  onClick={() => {
                    setTransferStatusFilter('all');
                    setTransferEngineFilter('all');
                    setTransferSearchQuery('');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-[#00ff66] hover:bg-zinc-800"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredTransferJobs.map((job) => {
                  const pct = computeJobProgressPercent(job);
                  const isAlmostDone =
                    job.status === 'downloading' &&
                    (Boolean(job.isAlmostDone) || (pct >= 85 && pct < 100));
                  const showProgressBar =
                    job.status === 'downloading' ||
                    job.status === 'searching' ||
                    job.status === 'completed' ||
                    pct > 0;

                  return (
                    <div
                      key={job.id}
                      className={`rounded-2xl border p-4 flex flex-col gap-3 transition-colors ${
                        isAlmostDone
                          ? 'border-emerald-500/50 bg-emerald-950/15'
                          : job.status === 'failed' ||
                            job.status === 'not_found'
                          ? 'border-rose-500/35 bg-zinc-950/90'
                          : 'border-zinc-800 bg-zinc-950/90'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] font-mono font-bold uppercase ${
                                job.status === 'completed'
                                  ? 'bg-emerald-500/20 text-[#00ff66] border border-emerald-500/40'
                                  : job.status === 'failed' ||
                                    job.status === 'not_found'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                  : job.status === 'filtered'
                                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                                  : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                              }`}
                            >
                              {job.status}
                            </span>

                            {isAlmostDone && (
                              <span className="rounded bg-emerald-500/25 border border-emerald-400/60 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66] animate-pulse">
                                ⚡ ALMOST DONE ({pct}%)
                              </span>
                            )}

                            {job.sourceEngine && (
                              <span className="rounded bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[10px] font-mono text-zinc-300 uppercase">
                                Engine: {job.sourceEngine}
                              </span>
                            )}
                            {job.matchedFormat && (
                              <span className="rounded bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[10px] font-mono text-[#00ff66]">
                                {job.matchedFormat}
                              </span>
                            )}
                            {job.matchedPeer && (
                              <span className="text-[11px] font-mono text-zinc-400">
                                Source: {job.matchedPeer}
                              </span>
                            )}
                            {job.queuePosition && job.status === 'queued' && (
                              <span className="rounded bg-zinc-900 border border-zinc-800 px-2 py-0.5 text-[10px] font-mono text-amber-300">
                                Queue #{job.queuePosition}
                              </span>
                            )}
                          </div>

                          <div className="text-sm font-bold text-white truncate">
                            {job.label}
                          </div>
                          <div className="text-xs font-mono text-zinc-400">
                            {job.message}
                          </div>
                          {job.organizedPath && (
                            <div className="text-[11px] font-mono text-[#00ff66]">
                              📁 Picard Path: {job.organizedPath}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {job.files?.length > 0 && (
                            <div className="text-xs font-mono text-zinc-300 mr-1">
                              {job.files.filter((f) => f.completed).length}/
                              {job.files.length} files
                            </div>
                          )}

                          {(job.status === 'not_found' ||
                            job.status === 'failed' ||
                            job.status === 'filtered') && (
                            <>
                              <button
                                type="button"
                                disabled={managingJobsAction !== null}
                                onClick={() =>
                                  handleManageDownloadJobs({
                                    action: 'retry-job',
                                    jobId: job.id,
                                    ignoreFilters: job.status === 'filtered',
                                  })
                                }
                                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/50 bg-amber-500/15 hover:bg-amber-500 hover:text-zinc-950 px-3 py-1.5 text-xs font-mono font-bold text-amber-300 transition-colors"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>Retry</span>
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  handleManageDownloadJobs({
                                    action: 'retry-job',
                                    jobId: job.id,
                                    sourceMode: 'youtube',
                                    ignoreFilters: true,
                                  })
                                }
                                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/50 bg-rose-500/15 hover:bg-rose-500 hover:text-zinc-950 px-3 py-1.5 text-xs font-mono font-bold text-rose-300 transition-colors"
                              >
                                <Youtube className="w-3.5 h-3.5" />
                                <span>Retry via YouTube</span>
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            title="Remove from downloads list"
                            disabled={managingJobsAction !== null}
                            onClick={() =>
                              handleManageDownloadJobs({
                                action: 'remove-job',
                                jobId: job.id,
                              })
                            }
                            className="inline-flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 hover:border-rose-500/50 hover:text-rose-300 px-2.5 py-1.5 text-xs font-mono text-zinc-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Live SDK / yt-dlp Progress Bar & Transfer Telemetry */}
                      {showProgressBar && (
                        <div className="space-y-1.5 pt-1 border-t border-zinc-800/80">
                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <div className="flex items-center gap-2 text-zinc-300 flex-wrap">
                              <span
                                className={`font-bold ${
                                  job.status === 'completed' || isAlmostDone
                                    ? 'text-[#00ff66]'
                                    : 'text-sky-300'
                                }`}
                              >
                                {pct}% Complete
                              </span>
                              {Boolean(job.totalBytes && job.totalBytes > 0) && (
                                <span className="text-zinc-400">
                                  ({formatDownloadBytes(job.transferredBytes)} /{' '}
                                  {formatDownloadBytes(job.totalBytes)})
                                </span>
                              )}
                              {job.speedText && (
                                <span className="text-emerald-300">
                                  · {job.speedText}
                                </span>
                              )}
                              {job.etaText && job.status === 'downloading' && (
                                <span className="text-amber-300">
                                  · ETA {job.etaText}
                                </span>
                              )}
                            </div>

                            <span className="text-zinc-400">
                              {job.status === 'completed'
                                ? '100% · Ready in Library'
                                : isAlmostDone
                                ? 'Finishing transfer...'
                                : job.status === 'searching'
                                ? 'Querying peers / streams...'
                                : 'Transferring...'}
                            </span>
                          </div>

                          <div className="w-full h-2 rounded-full bg-zinc-900 overflow-hidden border border-zinc-800">
                            <div
                              className={`h-full transition-all duration-300 ${
                                job.status === 'completed'
                                  ? 'bg-[#00ff66]'
                                  : isAlmostDone
                                  ? 'bg-gradient-to-r from-[#00ff66] to-emerald-400'
                                  : job.status === 'failed'
                                  ? 'bg-rose-500'
                                  : 'bg-gradient-to-r from-sky-500 to-[#00ff66]'
                              }`}
                              style={{
                                width: `${Math.min(100, Math.max(3, pct))}%`,
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
    </section>
  );
};
