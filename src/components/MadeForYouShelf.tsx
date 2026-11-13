import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Flame,
  Heart,
  Loader2,
  Radio,
  Settings2,
  Shuffle,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Playlist, Track } from '../types/music';

interface MadeForYouShelfProps {
  likedTracks: Track[];
  onRepeatTracks: Track[];
  dailyMixTracks: Track[];
  timeCapsuleTracks: Track[];
  onOpenLikedSongs: () => void;
  onShuffleLikedSongs: () => void;
  onPlayOnRepeat: () => void;
  onPlayDailyMix: () => void;
  onPlayTimeCapsule: () => void;
  defaultListenBrainzUser?: string;
  onListenBrainzPlaylistCreated?: (
    playlist: Playlist,
    summaryMessage: string
  ) => void;
}

const MADE_FOR_YOU_COLLAPSED_KEY = 'brokeify_made_for_you_collapsed_v1';
const LB_GRAB_SETTINGS_KEY = 'brokeify_lb_grab_settings_v1';

interface LbGrabSettings {
  username: string;
  feedType: 'weekly-exploration' | 'weekly-jams' | 'top-recordings';
  songCount: number;
  downloaderMode: 'auto' | 'slskd' | 'lidarr' | 'youtube';
}

export const MadeForYouShelf: React.FC<MadeForYouShelfProps> = ({
  likedTracks,
  onRepeatTracks,
  dailyMixTracks,
  timeCapsuleTracks,
  onOpenLikedSongs,
  onShuffleLikedSongs,
  onPlayOnRepeat,
  onPlayDailyMix,
  onPlayTimeCapsule,
  defaultListenBrainzUser = '',
  onListenBrainzPlaylistCreated,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MADE_FOR_YOU_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [showLbSettings, setShowLbSettings] = useState<boolean>(false);
  const [lbBusy, setLbBusy] = useState<boolean>(false);
  const [lbStatus, setLbStatus] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const [lbSettings, setLbSettings] = useState<LbGrabSettings>(() => {
    try {
      const raw = localStorage.getItem(LB_GRAB_SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          username: parsed.username || defaultListenBrainzUser || '',
          feedType: parsed.feedType || 'weekly-exploration',
          songCount: Math.min(50, Math.max(10, Number(parsed.songCount) || 25)),
          downloaderMode: parsed.downloaderMode || 'auto',
        };
      }
    } catch {
      // ignore
    }
    return {
      username: defaultListenBrainzUser || '',
      feedType: 'weekly-exploration',
      songCount: 25,
      downloaderMode: 'auto',
    };
  });

  const updateLbSettings = (patch: Partial<LbGrabSettings>) => {
    setLbSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(LB_GRAB_SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleToggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MADE_FOR_YOU_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleGrabListenBrainzMix = async (autoDownload: boolean) => {
    const cleanUser = (
      lbSettings.username ||
      defaultListenBrainzUser ||
      ''
    ).trim();
    if (!cleanUser) {
      setLbStatus({
        type: 'err',
        text: 'Enter your ListenBrainz.org username first to fetch 10–50 songs.',
      });
      return;
    }

    setLbBusy(true);
    setLbStatus(null);
    try {
      const resp = await fetch('/api/listenbrainz/grab-mix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cleanUser,
          feedType: lbSettings.feedType,
          count: lbSettings.songCount,
          autoDownload,
          downloaderMode: lbSettings.downloaderMode,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.ok) {
        setLbStatus({
          type: 'err',
          text:
            data?.error ||
            `ListenBrainz fetch failed (HTTP ${resp.status}). Verify username "${cleanUser}".`,
        });
        return;
      }

      const summary = `Fetched ${data.totalFetched} songs from ListenBrainz.org (${data.inLibraryCount} in library${
        data.queuedForDownload > 0
          ? `, ${data.queuedForDownload} queued in ${lbSettings.downloaderMode.toUpperCase()}`
          : ''
      }).`;
      setLbStatus({ type: 'ok', text: summary });
      if (data.playlist && onListenBrainzPlaylistCreated) {
        onListenBrainzPlaylistCreated(data.playlist, summary);
      }
    } catch (err) {
      setLbStatus({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'Network error contacting ListenBrainz.org.',
      });
    } finally {
      setLbBusy(false);
    }
  };

  return (
    <div
      data-testid="made-for-you-shelf"
      className="winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden transition-all"
    >
      {/* Header Bar — Clickable to Collapse / Expand + Quick Reach Chips when Collapsed */}
      <div className="winamp-titlebar px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80">
        <button
          type="button"
          onClick={handleToggleCollapse}
          data-testid="toggle-made-for-you-shelf"
          aria-expanded={!isCollapsed}
          className="flex items-center gap-2 text-left group cursor-pointer min-w-0"
        >
          <Sparkles className="w-4 h-4 text-[#00ff66] shrink-0" />
          <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-white group-hover:text-[#00ff66] transition-colors truncate">
            MADE FOR YOU // LIKED SONGS &amp; SMART DAILY MIXES
          </h2>
          <span className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/90 px-2 py-0.5 text-[10px] font-mono text-zinc-300 group-hover:text-white shrink-0">
            {isCollapsed ? (
              <>
                <span>Expand</span>
                <ChevronDown className="w-3 h-3 text-[#00ff66]" />
              </>
            ) : (
              <>
                <span>Collapse</span>
                <ChevronUp className="w-3 h-3 text-zinc-400" />
              </>
            )}
          </span>
        </button>

        {/* Right Controls: Quick-Reach Chips when Collapsed + ListenBrainz 10-50 Song Grabber Toggle */}
        <div className="flex flex-wrap items-center gap-1.5">
          {isCollapsed && (
            <>
              <button
                type="button"
                onClick={onOpenLikedSongs}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-950/40 hover:bg-rose-900/50 px-2.5 py-1 text-[11px] font-mono font-bold text-rose-300 transition-colors"
              >
                <Heart className="w-3 h-3 fill-rose-500 text-rose-400" />
                <span>Liked ({likedTracks.length})</span>
              </button>
              <button
                type="button"
                disabled={onRepeatTracks.length === 0}
                onClick={onPlayOnRepeat}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-950/40 hover:bg-amber-900/50 disabled:opacity-40 px-2.5 py-1 text-[11px] font-mono font-bold text-amber-300 transition-colors"
              >
                <Flame className="w-3 h-3 text-amber-400" />
                <span>On Repeat ({onRepeatTracks.length})</span>
              </button>
              <button
                type="button"
                disabled={dailyMixTracks.length === 0}
                onClick={onPlayDailyMix}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-950/40 hover:bg-emerald-900/50 disabled:opacity-40 px-2.5 py-1 text-[11px] font-mono font-bold text-[#00ff66] transition-colors"
              >
                <Zap className="w-3 h-3 text-[#00ff66]" />
                <span>Daily Mix ({dailyMixTracks.length})</span>
              </button>
              <button
                type="button"
                disabled={timeCapsuleTracks.length === 0}
                onClick={onPlayTimeCapsule}
                className="inline-flex items-center gap-1 rounded-lg border border-purple-500/40 bg-purple-950/40 hover:bg-purple-900/50 disabled:opacity-40 px-2.5 py-1 text-[11px] font-mono font-bold text-purple-300 transition-colors"
              >
                <Clock className="w-3 h-3 text-purple-400" />
                <span>Time Capsule</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              if (isCollapsed) setIsCollapsed(false);
              setShowLbSettings((prev) => !prev);
            }}
            data-testid="btn-toggle-listenbrainz-grabber"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-mono font-bold transition-colors ${
              showLbSettings
                ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
                : 'border-indigo-500/40 bg-indigo-950/40 hover:bg-indigo-900/50 text-indigo-300'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-indigo-400" />
            <span>ListenBrainz Grabber ({lbSettings.songCount} Songs)</span>
            <Settings2 className="w-3 h-3 opacity-80" />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-4 space-y-4">
          {/* ListenBrainz.org 10–50 Song Custom Mix & Download Control Panel */}
          {showLbSettings && (
            <div
              data-testid="listenbrainz-grabber-panel"
              className="rounded-2xl border border-indigo-500/40 bg-gradient-to-r from-indigo-950/60 via-zinc-950 to-emerald-950/40 p-4 space-y-3.5 shadow-inner"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-xs sm:text-sm font-mono font-bold text-white">
                    ListenBrainz.org Smart Mix &amp; Auto-Grab (10–50 Songs)
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-indigo-300">
                  Pull personalized mixes from listenbrainz.org &amp; control
                  exact download count
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {/* 1. ListenBrainz Username */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                    ListenBrainz.org Username
                  </label>
                  <input
                    type="text"
                    value={lbSettings.username}
                    onChange={(e) =>
                      updateLbSettings({ username: e.target.value })
                    }
                    placeholder="e.g. your_lb_username"
                    data-testid="input-lb-grab-username"
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-xs font-mono text-white placeholder-zinc-500 focus:border-indigo-400 focus:outline-none"
                  />
                </div>

                {/* 2. Mix / Feed Type */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                    ListenBrainz Feed Type
                  </label>
                  <select
                    value={lbSettings.feedType}
                    onChange={(e) =>
                      updateLbSettings({
                        feedType: e.target.value as LbGrabSettings['feedType'],
                      })
                    }
                    data-testid="select-lb-grab-feed"
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-xs font-mono text-white focus:border-indigo-400 focus:outline-none"
                  >
                    <option value="weekly-exploration">
                      Weekly Exploration (Discovery)
                    </option>
                    <option value="weekly-jams">
                      Weekly Jams (Familiar Rotation)
                    </option>
                    <option value="top-recordings">
                      Top Recordings (Most Listened)
                    </option>
                  </select>
                </div>

                {/* 3. Song Count Slider & Presets (10 to 50 Songs) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider">
                    <span className="text-zinc-400">Songs to Grab (10–50)</span>
                    <span className="text-[#00ff66] font-bold">
                      {lbSettings.songCount} Songs
                    </span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={50}
                    step={5}
                    value={lbSettings.songCount}
                    onChange={(e) =>
                      updateLbSettings({ songCount: Number(e.target.value) })
                    }
                    data-testid="slider-lb-song-count"
                    className="w-full accent-[#00ff66] cursor-pointer"
                  />
                  <div className="flex items-center justify-between gap-1 pt-0.5">
                    {[10, 20, 30, 40, 50].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => updateLbSettings({ songCount: num })}
                        className={`flex-1 rounded py-0.5 text-[10px] font-mono font-bold transition-colors ${
                          lbSettings.songCount === num
                            ? 'bg-[#00ff66] text-zinc-950'
                            : 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800'
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 4. Preferred Download Engine */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                    Downloader Source
                  </label>
                  <select
                    value={lbSettings.downloaderMode}
                    onChange={(e) =>
                      updateLbSettings({
                        downloaderMode: e.target
                          .value as LbGrabSettings['downloaderMode'],
                      })
                    }
                    data-testid="select-lb-downloader-mode"
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-xs font-mono text-white focus:border-indigo-400 focus:outline-none"
                  >
                    <option value="auto">
                      Auto Waterfall (slskd → Lidarr → YT)
                    </option>
                    <option value="slskd">slskd (Soulseek P2P)</option>
                    <option value="lidarr">Lidarr (Arr Stack)</option>
                    <option value="youtube">YouTube Music (yt-dlp)</option>
                  </select>
                </div>
              </div>

              {/* Action Buttons & Live Status */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={lbBusy}
                    onClick={() => handleGrabListenBrainzMix(false)}
                    data-testid="btn-lb-import-only"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-400/50 bg-indigo-950/60 hover:bg-indigo-900/70 disabled:opacity-50 px-3.5 py-2 text-xs font-mono font-bold text-indigo-200 transition-colors"
                  >
                    {lbBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Radio className="w-3.5 h-3.5 text-indigo-400" />
                    )}
                    <span>
                      Import {lbSettings.songCount} Songs to Playlist
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={lbBusy}
                    onClick={() => handleGrabListenBrainzMix(true)}
                    data-testid="btn-lb-grab-and-download"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-50 px-3.5 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors shadow-md"
                  >
                    {lbBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>
                      Grab {lbSettings.songCount} Songs &amp; Download Missing
                    </span>
                  </button>
                </div>

                {lbStatus && (
                  <div
                    className={`text-xs font-mono px-3 py-1.5 rounded-xl border ${
                      lbStatus.type === 'ok'
                        ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                        : 'border-rose-500/40 bg-rose-950/40 text-rose-300'
                    }`}
                  >
                    {lbStatus.text}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 4 Smart Mix Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
            {/* Card 1: Liked Songs ❤️ */}
            <div
              data-testid="made-for-you-liked-card"
              className="rounded-2xl border border-rose-500/40 bg-gradient-to-br from-rose-950/80 via-zinc-950 to-purple-950/60 p-4 flex flex-col justify-between gap-3 hover:border-rose-400/70 transition-all shadow-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shrink-0">
                  <Heart className="w-5 h-5 text-white fill-white" />
                </div>
                <span className="text-[11px] font-mono font-bold text-rose-300">
                  {likedTracks.length} Tracks
                </span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-white font-mono">
                  Liked Songs ❤️
                </h3>
                <p className="text-[11px] text-zinc-300 mt-0.5 line-clamp-2">
                  Every song you tap the heart on across your library,
                  playlists, or player.
                </p>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={onOpenLikedSongs}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-500 hover:bg-rose-400 px-3 py-2 text-xs font-mono font-bold text-white transition-colors"
                >
                  <Heart className="w-3.5 h-3.5 fill-current" />
                  <span>Open Collection</span>
                </button>
                {likedTracks.length > 0 && (
                  <button
                    type="button"
                    onClick={onShuffleLikedSongs}
                    title="Shuffle Liked Songs"
                    className="rounded-xl border border-rose-500/50 bg-zinc-900/90 hover:bg-zinc-800 px-2.5 py-2 text-xs font-mono font-bold text-rose-300"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Card 2: On Repeat 🔥 */}
            <div
              data-testid="made-for-you-onrepeat-card"
              className="rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-950/70 via-zinc-950 to-orange-950/50 p-4 flex flex-col justify-between gap-3 hover:border-amber-400/70 transition-all shadow-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-lg shrink-0">
                  <Flame className="w-5 h-5 text-zinc-950 fill-zinc-950" />
                </div>
                <span className="text-[11px] font-mono font-bold text-amber-300">
                  {onRepeatTracks.length} Heavy Rotation
                </span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-white font-mono">
                  On Repeat 🔥
                </h3>
                <p className="text-[11px] text-zinc-300 mt-0.5 line-clamp-2">
                  Songs you&apos;ve been playing the most recently, ranked by
                  play count &amp; favorites.
                </p>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={onRepeatTracks.length === 0}
                  onClick={onPlayOnRepeat}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-40 px-3 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors"
                >
                  <Flame className="w-3.5 h-3.5" />
                  <span>Play On Repeat</span>
                </button>
              </div>
            </div>

            {/* Card 3: Daily Mix 1 ⚡ */}
            <div
              data-testid="made-for-you-dailymix-card"
              className="rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/70 via-zinc-950 to-teal-950/50 p-4 flex flex-col justify-between gap-3 hover:border-emerald-400/70 transition-all shadow-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#00ff66] to-emerald-600 flex items-center justify-center shadow-lg shrink-0">
                  <Zap className="w-5 h-5 text-zinc-950 fill-zinc-950" />
                </div>
                <span className="text-[11px] font-mono font-bold text-[#00ff66]">
                  {dailyMixTracks.length} Blended
                </span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-white font-mono">
                  Daily Mix 1 ⚡
                </h3>
                <p className="text-[11px] text-zinc-300 mt-0.5 line-clamp-2">
                  Your favorite artists &amp; liked tracks blended with matching
                  genre &amp; BPM cuts.
                </p>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={dailyMixTracks.length === 0}
                  onClick={onPlayDailyMix}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-40 px-3 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Play Daily Mix</span>
                </button>
              </div>
            </div>

            {/* Card 4: Time Capsule / Deep Cuts 🕰️ */}
            <div
              data-testid="made-for-you-timecapsule-card"
              className="rounded-2xl border border-purple-500/40 bg-gradient-to-br from-purple-950/70 via-zinc-950 to-indigo-950/60 p-4 flex flex-col justify-between gap-3 hover:border-purple-400/70 transition-all shadow-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shrink-0">
                  <Clock className="w-5 h-5 text-white" />
                </div>
                <span className="text-[11px] font-mono font-bold text-purple-300">
                  {timeCapsuleTracks.length} Deep Cuts
                </span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-white font-mono">
                  Time Capsule 🕰️
                </h3>
                <p className="text-[11px] text-zinc-300 mt-0.5 line-clamp-2">
                  Rediscover classic &amp; unplayed gems from your vault that
                  haven&apos;t spun lately.
                </p>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={timeCapsuleTracks.length === 0}
                  onClick={onPlayTimeCapsule}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-purple-500 hover:bg-purple-400 disabled:opacity-40 px-3 py-2 text-xs font-mono font-bold text-white transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Spin Time Capsule</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
