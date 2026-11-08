import React, { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ListPlus,
  Loader2,
  Play,
  Sparkles,
  Upload,
} from 'lucide-react';
import type {
  Playlist,
  SpotifyResolvedItem,
  Track,
} from '../types/music';
import {
  crossResolveTrack,
  parseSpotifyExport,
} from '../utils/musicLogic';

interface SpotifyImporterViewProps {
  catalog: Track[];
  onPlayTrack: (track: Track) => void;
  onSaveResolvedPlaylist: (playlist: Playlist) => void;
}

const SAMPLE_SPOTIFY_EXPORTS: Record<string, { name: string; text: string }> = {
  synthwave: {
    name: 'Spotify Synthwave Night Drive',
    text: `The Midnight - Sunset (Remastered)
Kavinsky - Nightcall
HOME - Resonance
Carpenter Brut - Turbo Killer
Chrome Tape Syndicate - Neon Overdrive (Dead-Zone Mix)
The Self-Hosted Collective - Subsonic Highway 101`,
  },
  homelab: {
    name: 'Home-Lab & Cyberpunk Beats',
    text: `Duct Tape Oscillator - Eleven Ninety-Nine Robbery
Jellyfin Ghost - Midnight Transcode (FLAC to Car)
Kavinsky - Nightcall
Chrome Tape Syndicate - Neon Overdrive`,
  },
};

export const SpotifyImporterView: React.FC<SpotifyImporterViewProps> = ({
  catalog,
  onPlayTrack,
  onSaveResolvedPlaylist,
}) => {
  const [playlistTitle, setPlaylistTitle] = useState<string>(
    'Resolved Spotify Night Drive'
  );
  const [spotifyTokenOrUrl, setSpotifyTokenOrUrl] = useState<string>('');
  const [rawTracklist, setRawTracklist] = useState<string>(
    SAMPLE_SPOTIFY_EXPORTS.synthwave.text
  );
  const [resolvedItems, setResolvedItems] = useState<SpotifyResolvedItem[]>(() =>
    parseSpotifyExport(SAMPLE_SPOTIFY_EXPORTS.synthwave.text).map((item) =>
      crossResolveTrack(item, catalog)
    )
  );
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [isFetchingUrl, setIsFetchingUrl] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchTracksFromSpotifyUrl = async (url: string) => {
    setIsFetchingUrl(true);
    setFetchError(null);
    try {
      const resp = await fetch('/api/spotify/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setFetchError(data.error || 'Failed to fetch tracks from Spotify URL.');
        return false;
      }
      if (data.playlistTitle) {
        setPlaylistTitle(data.playlistTitle);
      }
      if (Array.isArray(data.tracks) && data.tracks.length > 0) {
        const textLines = data.tracks.map(
          (t: { artist: string; title: string }) => `${t.artist} - ${t.title}`
        );
        const newText = textLines.join('\n');
        setRawTracklist(newText);
        const parsed = parseSpotifyExport(newText);
        setResolvedItems(parsed.map((item) => crossResolveTrack(item, catalog)));
        setSavedNotice(`Loaded ${data.tracks.length} tracks from "${data.playlistTitle}"!`);
        return true;
      } else {
        setFetchError(`Found "${data.playlistTitle}", but Spotify hid tracklist details.`);
        return false;
      }
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : 'Could not contact Spotify importer'
      );
      return false;
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const handleCrossResolve = async () => {
    const raw = rawTracklist.trim();
    const tokenUrl = spotifyTokenOrUrl.trim();

    // Check if user entered a Spotify URL into either input
    const possibleUrl = [tokenUrl, raw].find((val) =>
      /open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track)\//i.test(val) ||
      /^spotify:(playlist|album|track):/i.test(val)
    );

    if (possibleUrl) {
      await fetchTracksFromSpotifyUrl(possibleUrl);
      return;
    }

    const parsed = parseSpotifyExport(rawTracklist);
    const resolved = parsed.map((item) => crossResolveTrack(item, catalog));
    setResolvedItems(resolved);
    setSavedNotice(null);
  };

  const handleLoadSample = (key: keyof typeof SAMPLE_SPOTIFY_EXPORTS) => {
    const sample = SAMPLE_SPOTIFY_EXPORTS[key];
    setPlaylistTitle(sample.name);
    setRawTracklist(sample.text);
    const parsed = parseSpotifyExport(sample.text);
    setResolvedItems(parsed.map((item) => crossResolveTrack(item, catalog)));
    setSavedNotice(null);
  };

  const handleSaveToLibrary = () => {
    const matchedIds = resolvedItems
      .map((r) => r.matchedTrack?.id)
      .filter((id): id is string => Boolean(id));

    if (matchedIds.length === 0) return;

    const newPl: Playlist = {
      id: `pl-spotify-${Date.now()}`,
      name: playlistTitle.trim() || 'Imported Spotify Playlist',
      description: `Cross-resolved ${matchedIds.length} tracks from Spotify export against your self-hosted & free cloud sources.`,
      source: 'spotify-resolved',
      trackIds: matchedIds,
      createdAt: new Date().toISOString().slice(0, 10),
      coverAccent: '#10b981',
    };
    onSaveResolvedPlaylist(newPl);
    setSavedNotice(`Saved "${newPl.name}" (${matchedIds.length} tracks) to Playlists!`);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-zinc-800/80 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Spotify Playlist Importer & Cross-Resolver
          </h2>
          <p className="text-sm text-zinc-400 mt-1">
            Paste a Spotify playlist tracklist, CSV/JSON export, or Web API token.
            Brokeify automatically cross-matches every song against your
            Jellyfin, Navidrome, Plex, and Free Cloud streams.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleLoadSample('synthwave')}
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 hover:border-emerald-500/50 hover:text-white transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            Load Synthwave Export
          </button>
          <button
            type="button"
            onClick={() => handleLoadSample('homelab')}
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 hover:border-purple-500/50 hover:text-white transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            Load Home-Lab Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Input Form */}
        <div className="lg:col-span-5 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6 space-y-4">
          <div>
            <label
              htmlFor="spotify-pl-name"
              className="block text-xs font-medium text-zinc-300 mb-1.5"
            >
              Target Brokeify Playlist Name
            </label>
            <input
              id="spotify-pl-name"
              type="text"
              value={playlistTitle}
              onChange={(e) => setPlaylistTitle(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="spotify-token-input"
                className="block text-xs font-medium text-zinc-400"
              >
                Spotify Playlist URL or Web Link
              </label>
              {spotifyTokenOrUrl.trim() && (
                <button
                  type="button"
                  disabled={isFetchingUrl}
                  onClick={() => fetchTracksFromSpotifyUrl(spotifyTokenOrUrl.trim())}
                  className="text-[11px] font-mono text-[#00ff66] hover:underline inline-flex items-center gap-1 font-bold"
                >
                  {isFetchingUrl ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <span>Fetch Tracks →</span>
                  )}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                id="spotify-token-input"
                type="text"
                value={spotifyTokenOrUrl}
                onChange={(e) => setSpotifyTokenOrUrl(e.target.value)}
                placeholder="https://open.spotify.com/playlist/..."
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none font-mono"
              />
            </div>
            {fetchError && (
              <p className="text-[11px] font-mono text-rose-400 mt-1.5 bg-rose-950/40 border border-rose-500/40 p-2 rounded-lg">
                ⚠️ {fetchError}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="spotify-raw-export"
              className="block text-xs font-medium text-zinc-300 mb-1.5"
            >
              Paste Tracklist (`Artist - Title`, CSV, or JSON)
            </label>
            <textarea
              id="spotify-raw-export"
              rows={7}
              value={rawTracklist}
              onChange={(e) => setRawTracklist(e.target.value)}
              placeholder="The Midnight - Sunset&#10;Kavinsky - Nightcall"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3.5 text-xs text-zinc-100 font-mono leading-relaxed focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={handleCrossResolve}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 py-3 px-4 text-sm font-semibold text-zinc-950 transition-colors min-h-[44px]"
          >
            <Sparkles className="w-4 h-4" />
            <span>Cross-Resolve Against My Servers</span>
          </button>
        </div>

        {/* Right Column: Resolution Results */}
        <div className="lg:col-span-7 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
            <div>
              <h3 className="text-base font-semibold text-white">
                Cross-Resolution Matrix ({resolvedItems.length} tracks)
              </h3>
              <p className="text-xs text-zinc-400">
                100% ad-free streams matched from your active sources
              </p>
            </div>

            <button
              type="button"
              onClick={handleSaveToLibrary}
              disabled={resolvedItems.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 px-4 py-2.5 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <ListPlus className="w-4 h-4" />
              <span>Save as Playable Playlist</span>
            </button>
          </div>

          {savedNotice && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{savedNotice}</span>
            </div>
          )}

          {resolvedItems.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <Upload className="w-8 h-8 text-zinc-600 mx-auto" />
              <p className="text-sm text-zinc-400">
                Paste a Spotify tracklist on the left and click Cross-Resolve.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/70">
              {resolvedItems.map((res, idx) => {
                const matched = res.matchedTrack;
                return (
                  <div
                    key={`${res.original.title}-${idx}`}
                    className="py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-white truncate">
                        <span className="text-xs font-mono text-zinc-500 tabular-nums">
                          {String(idx + 1).padStart(2, '0')}.
                        </span>
                        <span className="truncate">{res.original.title}</span>
                        <span className="text-zinc-500">·</span>
                        <span className="text-xs text-zinc-400 truncate">
                          {res.original.artist}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                        <ArrowRight className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="text-emerald-400 font-medium truncate">
                          {matched
                            ? `${matched.title} (${matched.sourceName})`
                            : 'Unresolved'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums text-zinc-400">
                          {res.confidence}% match
                        </span>
                      </div>
                    </div>

                    {matched && (
                      <button
                        type="button"
                        onClick={() => onPlayTrack(matched)}
                        aria-label={`Play resolved track ${matched.title}`}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-800 hover:bg-emerald-500 hover:text-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Play</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
