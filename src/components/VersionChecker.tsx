import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  GitCommit,
  Github,
  HelpCircle,
  Loader2,
  RefreshCw,
  Sparkles,
  Tag,
  Terminal,
} from 'lucide-react';
import type { BrokeifyVersionStatus } from '../types/music';

interface VersionCheckerProps {
  onShowToast?: (msg: string) => void;
  compact?: boolean;
}

export const VersionChecker: React.FC<VersionCheckerProps> = ({
  onShowToast,
  compact = false,
}) => {
  const [versionStatus, setVersionStatus] =
    useState<BrokeifyVersionStatus | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [showHowToUpdate, setShowHowToUpdate] = useState<boolean>(false);

  const fetchVersion = async (force = false) => {
    setIsChecking(true);
    try {
      const endpoint = force ? '/api/version?force=true' : '/api/version';
      const resp = await fetch(endpoint);
      if (resp.ok) {
        const data = await resp.json();
        if (data.ok && data.version) {
          setVersionStatus(data.version);
          if (force) {
            onShowToast?.(
              data.version.updateAvailable
                ? `🚀 New version found on GitHub: ${data.version.remoteDisplayVersion || data.version.remoteVersion}!`
                : `✅ You are running the latest version (${data.version.localDisplayVersion}).`
            );
          }
        }
      }
    } catch {
      // ignore
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    fetchVersion(false);
  }, []);

  if (!versionStatus && isChecking) {
    return (
      <div className="flex items-center gap-2 p-3 text-xs font-mono text-zinc-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00ff66]" />
        <span>Checking GitHub repository for updates...</span>
      </div>
    );
  }

  const v = versionStatus || {
    localVersion: '0.0.0.1',
    localDisplayVersion: 'v0.0.0.1-beta',
    localChannel: 'beta',
    localCommitSha: null,
    localBuildTime: null,
    remoteVersion: null,
    remoteDisplayVersion: null,
    remoteCommitSha: null,
    remoteCommitMessage: null,
    remoteCommitDate: null,
    remoteCommitUrl: null,
    repository: 'Mr-Nickey/brokeify',
    branch: 'main',
    updateAvailable: false,
    statusSummary: 'Running local Docker build.',
    checkedAt: new Date().toISOString(),
    changelog: [
      'v0.0.0.1-beta: Initial full-stack Docker release on Port 3487',
      'Cross-Device Playback Handoff (phone to TV/Chromecast)',
      'Per-device Jellyfin login gate & zero-reentry shared homelab profile',
      'Lidarr, slskd, YouTube Music, and Internet Archive download engines',
    ],
  };

  const formattedCheckTime = v.checkedAt
    ? v.checkedAt.replace('T', ' ').slice(0, 19)
    : '';

  // Compact badge rendering (for headers or summary cards)
  if (compact) {
    return (
      <div className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-lg border border-purple-500/40 bg-purple-950/40 px-2 py-0.5 text-[11px] font-mono font-bold text-purple-300">
          <Tag className="w-3 h-3 text-purple-400" />
          <span>{v.localDisplayVersion}</span>
        </span>
        {v.updateAvailable ? (
          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/50 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66]">
            <ArrowUpCircle className="w-3 h-3" />
            <span>Update: {v.remoteDisplayVersion || v.remoteVersion}</span>
          </span>
        ) : (
          <span className="text-[10px] font-mono text-zinc-400">Up to date</span>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="version-checker-card"
      className={`rounded-2xl border p-5 space-y-4 ${
        v.updateAvailable
          ? 'border-emerald-500/60 bg-emerald-950/25'
          : 'border-zinc-800 bg-zinc-950/80'
      }`}
    >
      {/* Header Row: Current Installed Version + Status Badge + Check Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              v.updateAvailable
                ? 'bg-[#00ff66]/20 border border-[#00ff66]/60 text-[#00ff66]'
                : 'bg-zinc-900 border border-zinc-700 text-purple-300'
            }`}
          >
            {v.updateAvailable ? (
              <ArrowUpCircle className="w-5 h-5 animate-bounce" />
            ) : (
              <Github className="w-5 h-5" />
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-mono font-bold text-white">
                Installed: {v.localDisplayVersion}
              </span>
              <span className="rounded bg-purple-500/20 border border-purple-500/50 px-1.5 py-0.2 text-[10px] font-mono font-bold uppercase text-purple-300">
                {v.localChannel}
              </span>
              {v.updateAvailable ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#00ff66] px-2 py-0.5 text-[10px] font-mono font-extrabold text-zinc-950">
                  <Sparkles className="w-3 h-3 fill-current" />
                  UPDATE AVAILABLE: {v.remoteDisplayVersion || v.remoteVersion}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[#00ff66]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Up to Date</span>
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-300 mt-0.5">
              Repository:{' '}
              <a
                href={`https://github.com/${v.repository}`}
                target="_blank"
                rel="noreferrer"
                className="text-purple-300 hover:text-white underline font-mono inline-flex items-center gap-1"
              >
                <span>github.com/{v.repository}</span>
                <ExternalLink className="w-3 h-3" />
              </a>{' '}
              · Branch: <span className="font-mono text-zinc-200">{v.branch}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => fetchVersion(true)}
            disabled={isChecking}
            data-testid="btn-check-version-updates"
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-[#00ff66]/50 hover:bg-zinc-800 px-3.5 py-2 text-xs font-mono font-bold text-zinc-200 hover:text-white transition-colors min-h-[38px]"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin text-[#00ff66]' : ''}`}
            />
            <span>{isChecking ? 'Checking GitHub...' : 'Check for Updates'}</span>
          </button>
        </div>
      </div>

      {/* Prominent Update Banner if a newer tag/commit exists on GitHub */}
      {v.updateAvailable && (
        <div
          data-testid="update-available-banner"
          className="rounded-xl border border-[#00ff66] bg-emerald-950/40 p-4 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="text-xs font-mono font-bold text-[#00ff66] uppercase flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" />
                <span>
                  New Release Ready:{' '}
                  {v.remoteDisplayVersion || v.remoteVersion}
                </span>
              </div>
              <p className="text-xs text-zinc-200">
                Your Docker container is on{' '}
                <strong className="text-white">{v.localDisplayVersion}</strong>.
                Pull the latest build from GitHub or rebuild your container to
                get all newest bug fixes!
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowHowToUpdate((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3 py-1.5 text-xs font-mono font-bold text-zinc-950"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>
                  {showHowToUpdate ? 'Hide Docker Commands' : 'How to Update 🐳'}
                </span>
              </button>

              {v.remoteCommitUrl && (
                <a
                  href={v.remoteCommitUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-300 hover:text-white"
                >
                  <span>View Release</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>

          {/* 1-Click Copy Docker Compose Update Instructions */}
          {showHowToUpdate && (
            <div className="rounded-lg bg-zinc-950 p-3 border border-zinc-800 space-y-2">
              <div className="text-xs font-mono font-bold text-zinc-300">
                Update in 3 Commands on your Homelab / Server:
              </div>
              <pre className="text-[11px] font-mono bg-zinc-900/90 text-zinc-200 p-2.5 rounded border border-zinc-800 overflow-x-auto select-all">
{`docker compose down
docker compose pull || docker compose build --no-cache
docker compose up -d`}
              </pre>
              <p className="text-[11px] text-zinc-400 font-mono">
                All settings, API keys, playlists &amp; themes in{' '}
                <code className="text-[#00ff66]">/app/data/config.json</code>{' '}
                are kept completely safe across Docker rebuilds.
              </p>
            </div>
          )}
        </div>
      )}

      {/* GitHub Repository Status & Commit Details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-zinc-800/80 text-xs font-mono">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2.5">
          <div className="text-[10px] text-zinc-400 uppercase">Release State</div>
          <div className="text-xs font-bold text-white mt-0.5 truncate">
            {v.localDisplayVersion} (Early Beta)
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2.5">
          <div className="text-[10px] text-zinc-400 uppercase">GitHub Latest Tag</div>
          <div className="text-xs font-bold mt-0.5 truncate">
            {v.remoteDisplayVersion || v.remoteVersion ? (
              <span className="text-[#00ff66]">
                {v.remoteDisplayVersion || v.remoteVersion}
              </span>
            ) : (
              <span className="text-zinc-400">Checking GitHub tags...</span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2.5">
          <div className="text-[10px] text-zinc-400 uppercase">Branch Commit</div>
          <div className="text-xs font-bold text-purple-300 mt-0.5 truncate flex items-center gap-1">
            <GitCommit className="w-3.5 h-3.5" />
            <span>{v.remoteCommitSha || 'main head'}</span>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2.5">
          <div className="text-[10px] text-zinc-400 uppercase">Last Checked</div>
          <div className="text-xs font-bold text-zinc-300 mt-0.5 truncate">
            {formattedCheckTime || 'Just now'}
          </div>
        </div>
      </div>

      {/* Beta Roadmap & Changelog */}
      {Array.isArray(v.changelog) && v.changelog.length > 0 && (
        <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
          <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <Tag className="w-3 h-3 text-[#00ff66]" />
            <span>Test Flight &amp; Beta Release Notes</span>
          </div>
          <ul className="space-y-1 text-xs font-mono text-zinc-300 list-disc list-inside">
            {v.changelog.map((line, idx) => (
              <li key={`changelog-${idx}`} className="text-zinc-300">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
