import React, { useEffect, useState } from 'react';
import {
  Album,
  ArrowDownToLine,
  CheckCircle2,
  Compass,
  Disc,
  DownloadCloud,
  ExternalLink,
  ListMusic,
  Loader2,
  Music,
  Play,
  Radio,
  RefreshCw,
  Search,
  Server,
  Sparkles,
} from 'lucide-react';
import type {
  BrokeifyServerIntegrations,
  ListenBrainzDiscoverPlaylist,
  MusicBrainzAlbumDetail,
  MusicBrainzSearchResult,
  SlskdGrabJob,
  Track,
} from '../types/music';
import { createAlbumArtworkDataUri } from '../utils/artworkGenerator';
import { areTracksSameSong } from '../utils/musicLogic';

interface RequestDiscoverViewProps {
  catalog: Track[];
  integrations: BrokeifyServerIntegrations;
  jobs: SlskdGrabJob[];
  onPlayTrack: (track: Track) => void;
  onRefreshStatus: () => void;
  onOpenSettingsSources: () => void;
  onShowToast: (msg: string) => void;
}

type DiscoverSubMode = 'search' | 'listenbrainz' | 'transfers';

export const RequestDiscoverView: React.FC<RequestDiscoverViewProps> = ({
  catalog,
  integrations,
  jobs,
  onPlayTrack,
  onRefreshStatus,
  onOpenSettingsSources,
  onShowToast,
}) => {
  const [subMode, setSubMode] = useState<DiscoverSubMode>('search');

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

  useEffect(() => {
    if (integrations.listenbrainzUsername) {
      setLbUsernameInput(integrations.listenbrainzUsername);
    }
  }, [integrations.listenbrainzUsername]);

  const handleSearchMusicBrainz = async (
    e?: React.FormEvent,
    overrideQuery?: string,
    overrideType?: 'album' | 'track'
  ) => {
    if (e) e.preventDefault();
    const q = (overrideQuery ?? searchQuery).trim();
    const activeType = overrideType ?? searchType;
    if (!q) return;

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

  const handleGrabViaSlskd = async (payload: {
    key: string;
    type: 'album' | 'track' | 'playlist';
    artist?: string;
    title?: string;
    tracks?: Array<{ artist: string; title: string }>;
  }) => {
    setGrabbingKey(payload.key);
    try {
      const resp = await fetch('/api/slskd/grab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: payload.type,
          artist: payload.artist,
          title: payload.title,
          tracks: payload.tracks,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        onShowToast(
          `⚠️ ${data.error || 'Could not queue download in slskd. Check Settings -> Sources Hub.'}`
        );
      } else {
        onShowToast(`📥 ${data.message}`);
        onRefreshStatus();
      }
    } catch (err) {
      onShowToast(
        `⚠️ ${err instanceof Error ? err.message : 'Failed to reach /api/slskd/grab'}`
      );
    } finally {
      setGrabbingKey(null);
    }
  };

  const fetchListenBrainzDiscover = async (usernameOverride?: string) => {
    const targetUser = (usernameOverride ?? lbUsernameInput).trim();
    if (!targetUser) {
      setLbError(
        'Enter your ListenBrainz username above (or in Settings -> Sources Hub) to load your Weekly Exploration and Weekly Jams playlists.'
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
          data.error || `Failed to load ListenBrainz playlists for ${targetUser}`
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

  // Helper to check if a track is already in the local Jellyfin catalog
  const findMatchingCatalogTrack = (
    title: string,
    artist: string
  ): Track | null => {
    const probe: Pick<Track, 'id' | 'title' | 'artist'> = {
      id: `probe-${title}-${artist}`,
      title,
      artist,
    };
    return (
      catalog.find((c) => areTracksSameSong(c, probe)) || null
    );
  };

  const activeLbPlaylist =
    lbPlaylists.find((p) => p.id === selectedLbPlaylistId) ||
    lbPlaylists[0] ||
    null;

  return (
    <section
      aria-label="Request Music and Discover Engine"
      data-testid="request-discover-view"
      className="space-y-6"
    >
      {/* Top Header & Sub-Mode Switcher */}
      <div className="winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden">
        <div className="winamp-titlebar px-5 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-700/80">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-[#00ff66]" />
            <h1 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
              REQUEST MUSIC &amp; DISCOVER // EXPLO REPLACEMENT ENGINE (MUSICBRAINZ + LISTENBRAINZ + SLSKD)
            </h1>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span
              className={`rounded px-2 py-0.5 border ${
                integrations.slskdUrl
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-[#00ff66]'
                  : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
              }`}
            >
              slskd: {integrations.slskdUrl || 'Not Set'}
            </span>
            <span className="rounded px-2 py-0.5 border border-purple-500/40 bg-purple-500/15 text-purple-300">
              ListenBrainz: {integrations.listenbrainzUsername || 'Not Set'}
            </span>
          </div>
        </div>

        <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
              <span>Grab Album / Track (MusicBrainz)</span>
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
                ListenBrainz Weekly Exploration
                {integrations.listenbrainzUsername
                  ? ` (${integrations.listenbrainzUsername})`
                  : ''}
              </span>
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
              <span>slskd Transfers ({jobs.length})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenSettingsSources}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-[#00ff66]/50 px-3 py-2 text-xs font-mono font-semibold text-zinc-200 hover:text-white min-h-[38px]"
          >
            <Server className="w-3.5 h-3.5 text-[#00ff66]" />
            <span>Configure slskd &amp; ListenBrainz Keys</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          MODE 1: SEARCH & GRAB FULL ALBUM / TRACK (MUSICBRAINZ -> SLSKD -> JELLYFIN)
         ===================================================================== */}
      {subMode === 'search' && (
        <div className="winamp-bezel rounded-2xl border border-zinc-700/80 p-5 space-y-5">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-white font-mono flex items-center gap-2">
              <Album className="w-4 h-4 text-[#00ff66]" />
              <span>Search Any Artist, Album, or Song &amp; Auto-Grab via slskd</span>
            </h2>
            <p className="text-xs text-zinc-400">
              Searches MusicBrainz for exact album tracklists, automatically selects the best peer in your local{' '}
              <code className="text-[#00ff66]">slskd</code> with{' '}
              <code className="text-purple-300">hasFreeUploadSlot: true</code> (preferring FLAC or 320kbps MP3), and triggers{' '}
              <code className="text-[#00ff66]">POST /Library/Refresh</code> in Jellyfin the moment the download completes.
            </p>
          </div>

          <form
            onSubmit={(e) => handleSearchMusicBrainz(e)}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
          >
            <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-950 p-1 shrink-0 font-mono text-xs">
              <button
                type="button"
                onClick={() => setSearchType('album')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                  searchType === 'album'
                    ? 'bg-[#00ff66] text-zinc-950'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Albums
              </button>
              <button
                type="button"
                onClick={() => setSearchType('track')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                  searchType === 'track'
                    ? 'bg-[#00ff66] text-zinc-950'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Songs
              </button>
            </div>

            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  searchType === 'album'
                    ? 'Search album or artist (e.g. Linkin Park Hybrid Theory)...'
                    : 'Search song or artist (e.g. Sean Paul Temperature)...'
                }
                data-testid="musicbrainz-search-input"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-[#00ff66] focus:outline-none min-h-[42px]"
              />
            </div>

            <button
              type="submit"
              disabled={isSearching}
              data-testid="musicbrainz-search-btn"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-50 px-5 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[42px] shrink-0"
            >
              {isSearching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span>Search MusicBrainz</span>
            </button>
          </form>

          {/* Quick-Search Suggestions */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="text-zinc-500">Quick Search:</span>
            {[
              { label: 'Linkin Park - Hybrid Theory', type: 'album' as const },
              { label: 'Daft Punk - Discovery', type: 'album' as const },
              { label: 'The Prodigy - The Fat of the Land', type: 'album' as const },
              { label: 'Gorillaz - Demon Days', type: 'album' as const },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setSearchQuery(item.label);
                  setSearchType(item.type);
                  handleSearchMusicBrainz(undefined, item.label, item.type);
                }}
                className="rounded-lg border border-zinc-800 bg-zinc-950 hover:border-[#00ff66]/50 px-2.5 py-1 text-zinc-300 hover:text-[#00ff66] transition-colors"
              >
                {item.label}
              </button>
            ))}
          </div>

          {searchError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs font-mono text-rose-300">
              {searchError}
            </div>
          )}

          {/* Results List */}
          {searchResults.length > 0 && (
            <div className="space-y-3">
              {searchResults.map((res) => {
                const isAlbum = res.type === 'album';
                const isExpanded = expandedAlbumId === res.id;
                const albumDetail = albumDetailsById[res.id];
                const isLoadingDetail = loadingAlbumId === res.id;
                const grabKey = `${res.type}-${res.id}`;
                const matchedExisting = !isAlbum
                  ? findMatchingCatalogTrack(res.title, res.artist)
                  : null;

                return (
                  <div
                    key={res.id}
                    data-testid={`mb-result-${res.id}`}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/85 p-4 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <img
                          src={
                            res.coverUrl ||
                            createAlbumArtworkDataUri(
                              res.title,
                              res.artist,
                              '#10b981',
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
                              '#10b981',
                              '#09090b'
                            );
                          }}
                          className="w-14 h-14 rounded-xl border border-zinc-800 object-cover shrink-0"
                        />

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-white truncate">
                              {res.title}
                            </span>
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono uppercase text-[#00ff66]">
                              {isAlbum ? res.primaryType || 'Album' : 'Track'}
                            </span>
                            {res.year && (
                              <span className="text-xs font-mono text-zinc-400">
                                ({res.year})
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-300 font-mono mt-0.5">
                            {res.artist}
                            {!isAlbum && res.album ? ` · ${res.album}` : ''}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {isAlbum && (
                          <button
                            type="button"
                            onClick={() => handleToggleAlbumTracklist(res.id)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-zinc-500 px-3 py-2 text-xs font-mono font-semibold text-zinc-200 transition-colors min-h-[36px]"
                          >
                            {isLoadingDetail ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00ff66]" />
                            ) : (
                              <ListMusic className="w-3.5 h-3.5 text-[#00ff66]" />
                            )}
                            <span>
                              {isExpanded ? 'Hide Tracklist' : 'View Tracklist'}
                            </span>
                          </button>
                        )}

                        {matchedExisting ? (
                          <button
                            type="button"
                            onClick={() => onPlayTrack(matchedExisting)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/50 hover:bg-emerald-500/30 px-3.5 py-2 text-xs font-mono font-bold text-[#00ff66] transition-colors min-h-[36px]"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>In Jellyfin · Play</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={grabbingKey === grabKey}
                            onClick={() =>
                              handleGrabViaSlskd({
                                key: grabKey,
                                type: isAlbum ? 'album' : 'track',
                                artist: res.artist,
                                title: res.title,
                                tracks: albumDetail?.tracks?.map((t) => ({
                                  artist: t.artist,
                                  title: t.title,
                                })),
                              })
                            }
                            data-testid={`grab-btn-${res.id}`}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-50 px-3.5 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[36px]"
                          >
                            {grabbingKey === grabKey ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <ArrowDownToLine className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {isAlbum ? 'Grab Full Album' : 'Grab Track'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded Album Tracklist */}
                    {isAlbum && isExpanded && (
                      <div className="pt-3 border-t border-zinc-800/80 space-y-2">
                        {isLoadingDetail ? (
                          <div className="py-4 text-center text-xs font-mono text-zinc-400 flex items-center justify-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin text-[#00ff66]" />
                            <span>Loading exact MusicBrainz release tracklist...</span>
                          </div>
                        ) : albumDetail && albumDetail.tracks.length > 0 ? (
                          <div className="divide-y divide-zinc-800/60">
                            {albumDetail.tracks.map((tr) => {
                              const existingTrack = findMatchingCatalogTrack(
                                tr.title,
                                tr.artist
                              );
                              const trGrabKey = `mb-tr-${tr.id}`;
                              return (
                                <div
                                  key={tr.id}
                                  className="py-2 px-2 flex items-center justify-between gap-2 text-xs"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <span className="w-6 text-right font-mono text-zinc-500">
                                      {tr.number}.
                                    </span>
                                    <span className="font-semibold text-white truncate">
                                      {tr.title}
                                    </span>
                                    <span className="text-zinc-500 font-mono truncate hidden sm:inline">
                                      — {tr.artist}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    {existingTrack ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onPlayTrack(existingTrack)
                                        }
                                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-[11px] font-mono font-bold text-[#00ff66]"
                                      >
                                        <CheckCircle2 className="w-3 h-3" />
                                        <span>Play in Jellyfin</span>
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={grabbingKey === trGrabKey}
                                        onClick={() =>
                                          handleGrabViaSlskd({
                                            key: trGrabKey,
                                            type: 'track',
                                            artist: tr.artist,
                                            title: tr.title,
                                          })
                                        }
                                        className="inline-flex items-center gap-1 rounded-lg bg-purple-600 hover:bg-purple-500 px-2.5 py-1 text-[11px] font-mono font-bold text-white"
                                      >
                                        <ArrowDownToLine className="w-3 h-3" />
                                        <span>Grab Track</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-xs font-mono text-zinc-400 py-2">
                            No detailed tracklist found for this release group—click &ldquo;Grab Full Album&rdquo; to search slskd directly.
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
          MODE 2: LISTENBRAINZ WEEKLY EXPLORATION & JAMS (REPLACES EXPLO)
         ===================================================================== */}
      {subMode === 'listenbrainz' && (
        <div className="winamp-bezel rounded-2xl border border-zinc-700/80 p-5 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white font-mono flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span>
                  ListenBrainz Discovery Playlists (Weekly Exploration &amp; Weekly Jams)
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Fetches your official ListenBrainz{' '}
                <code className="text-[#00ff66]">createdfor</code> mixes, checks which tracks are already in Jellyfin, and downloads all missing songs via{' '}
                <code className="text-purple-300">slskd</code> in 1 click.
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
                <span>Sync ListenBrainz</span>
              </button>
            </form>
          </div>

          {lbError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs font-mono text-rose-300">
              {lbError}
            </div>
          )}

          {isLoadingLb ? (
            <div className="py-12 text-center space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#00ff66] mx-auto" />
              <p className="text-xs font-mono text-zinc-300">
                Fetching ListenBrainz Weekly Exploration &amp; Weekly Jams for{' '}
                <strong>{lbUsernameInput}</strong>...
              </p>
            </div>
          ) : lbPlaylists.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-6 text-center space-y-2">
              <p className="text-sm font-semibold text-zinc-200">
                No ListenBrainz &ldquo;Created For You&rdquo; playlists loaded yet.
              </p>
              <p className="text-xs text-zinc-400">
                Click <strong>Sync ListenBrainz</strong> above to pull playlists for{' '}
                <code className="text-[#00ff66]">{lbUsernameInput}</code>.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Playlist Selector Pills */}
              <div className="flex flex-wrap items-center gap-2">
                {lbPlaylists.map((pl) => {
                  const isSel = activeLbPlaylist?.id === pl.id;
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => setSelectedLbPlaylistId(pl.id)}
                      className={`rounded-xl border px-3.5 py-2 text-left transition-all ${
                        isSel
                          ? 'border-[#00ff66] bg-emerald-500/15 text-white'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-bold font-mono">
                        {pl.title}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                        {pl.trackCount} tracks ·{' '}
                        <span className="text-[#00ff66]">
                          {pl.inLibraryCount} in Jellyfin
                        </span>{' '}
                        ·{' '}
                        <span className="text-amber-300">
                          {pl.missingCount} missing
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {activeLbPlaylist && (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/90 overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3 bg-zinc-900/60">
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        {activeLbPlaylist.title}
                      </h3>
                      <p className="text-[11px] font-mono text-zinc-400">
                        {activeLbPlaylist.inLibraryCount} already in Jellyfin ·{' '}
                        {activeLbPlaylist.missingCount} missing tracks ready to grab via slskd
                      </p>
                    </div>

                    {activeLbPlaylist.tracks.some(
                      (t) =>
                        !t.inLibrary &&
                        !findMatchingCatalogTrack(t.title, t.artist)
                    ) && (
                      <button
                        type="button"
                        disabled={grabbingKey === `lb-pl-${activeLbPlaylist.id}`}
                        onClick={() => {
                          const missing = activeLbPlaylist.tracks
                            .filter(
                              (t) =>
                                !t.inLibrary &&
                                !findMatchingCatalogTrack(t.title, t.artist)
                            )
                            .map((t) => ({
                              artist: t.artist,
                              title: t.title,
                            }));
                          handleGrabViaSlskd({
                            key: `lb-pl-${activeLbPlaylist.id}`,
                            type: 'playlist',
                            tracks: missing,
                          });
                        }}
                        data-testid="download-missing-lb-tracks-btn"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#a855f7] hover:bg-purple-400 px-4 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[38px]"
                      >
                        <DownloadCloud className="w-4 h-4" />
                        <span>
                          Download Missing Playlist Tracks (
                          {
                            activeLbPlaylist.tracks.filter(
                              (t) =>
                                !t.inLibrary &&
                                !findMatchingCatalogTrack(t.title, t.artist)
                            ).length
                          }
                          )
                        </span>
                      </button>
                    )}
                  </div>

                  <div className="divide-y divide-zinc-800/60 max-h-[480px] overflow-y-auto p-3">
                    {activeLbPlaylist.tracks.map((tr, idx) => {
                      const localMatch = findMatchingCatalogTrack(
                        tr.title,
                        tr.artist
                      );
                      const isAvailable = tr.inLibrary || Boolean(localMatch);
                      const trGrabKey = `lb-tr-${tr.id}`;

                      return (
                        <div
                          key={tr.id}
                          className="py-2.5 px-2 flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="w-6 text-right text-xs font-mono text-zinc-500">
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs sm:text-sm font-semibold text-white truncate">
                                {tr.title}
                              </div>
                              <div className="text-[11px] font-mono text-zinc-400 truncate">
                                {tr.artist}
                                {tr.album ? ` · ${tr.album}` : ''}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {isAvailable ? (
                              <button
                                type="button"
                                onClick={() => {
                                  if (localMatch) onPlayTrack(localMatch);
                                }}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-mono font-bold text-[#00ff66]"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>
                                  {localMatch ? 'Play in Jellyfin ▶' : 'In Jellyfin'}
                                </span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={grabbingKey === trGrabKey}
                                onClick={() =>
                                  handleGrabViaSlskd({
                                    key: trGrabKey,
                                    type: 'track',
                                    artist: tr.artist,
                                    title: tr.title,
                                  })
                                }
                                className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3 py-1.5 text-xs font-mono font-bold text-zinc-950"
                              >
                                {grabbingKey === trGrabKey ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <ArrowDownToLine className="w-3.5 h-3.5" />
                                )}
                                <span>Grab Track</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          MODE 3: ACTIVE SLSKD TRANSFERS & JELLYFIN AUTO-REFRESH MONITOR
         ===================================================================== */}
      {subMode === 'transfers' && (
        <div className="winamp-bezel rounded-2xl border border-zinc-700/80 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white font-mono flex items-center gap-2">
                <DownloadCloud className="w-4 h-4 text-[#00ff66]" />
                <span>slskd Automated Download Queue &amp; Jellyfin Library Watcher</span>
              </h2>
              <p className="text-xs text-zinc-400">
                Background server polling watches{' '}
                <code className="text-[#00ff66]">GET /api/v0/transfers/downloads</code> and automatically triggers{' '}
                <code className="text-[#00ff66]">POST /Library/Refresh</code> on Jellyfin the instant an album or track finishes.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const resp = await fetch('/api/jellyfin/refresh', {
                      method: 'POST',
                    });
                    const data = await resp.json();
                    onShowToast(
                      data.ok
                        ? '🔄 Triggered Jellyfin Library/Refresh!'
                        : `⚠️ ${data.error || 'Could not refresh Jellyfin'}`
                    );
                  } catch {
                    onShowToast('⚠️ Failed to trigger Jellyfin Library Refresh');
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/50 bg-emerald-500/15 hover:bg-emerald-500/25 px-3.5 py-2 text-xs font-mono font-bold text-[#00ff66] min-h-[38px]"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Force Jellyfin Library Refresh</span>
              </button>
            </div>
          </div>

          {jobs.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-8 text-center space-y-2">
              <Disc className="w-7 h-7 text-zinc-600 mx-auto" />
              <p className="text-sm font-semibold text-zinc-300">
                No slskd downloads queued in this session yet.
              </p>
              <p className="text-xs text-zinc-500">
                Use <strong>Grab Album / Track</strong> or <strong>ListenBrainz Weekly Exploration</strong> to queue music automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-white truncate">
                        {job.label}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-mono font-bold uppercase ${
                          job.status === 'completed'
                            ? 'bg-emerald-500/20 text-[#00ff66] border border-emerald-500/40'
                            : job.status === 'failed'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                        }`}
                      >
                        {job.status}
                      </span>
                      {job.matchedFormat && (
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-[#00ff66]">
                          {job.matchedFormat}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-mono text-zinc-400">
                      {job.message}
                    </p>
                  </div>

                  {job.matchedPeer && (
                    <div className="text-[11px] font-mono text-zinc-400 shrink-0">
                      Peer: <strong className="text-white">{job.matchedPeer}</strong>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
