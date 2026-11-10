import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Copy,
  Download,
  HardDrive,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react';
import type {
  BrokeifyDebugLogEntry,
  DebugLogCategory,
  DebugLogLevel,
  HomelabDiagnosticCheck,
} from '../types/music';
import {
  clearClientDebugLogs,
  getClientDebugLogs,
  logDebugEvent,
  subscribeDebugLogs,
} from '../utils/debugLogger';
import { VersionChecker } from './VersionChecker';

interface ServerRuntimeInfo {
  uptimeSec: number;
  nodeVersion: string;
  port: number;
  configPath: string;
  debugLogPath: string;
  ytDlpAvailable: boolean;
  ytDlpVersion: string | null;
  ffmpegAvailable: boolean;
  activeGrabJobs: number;
  memoryRssMb: number;
}

interface DebugLogsViewProps {
  onShowToast?: (msg: string) => void;
}

export const DebugLogsView: React.FC<DebugLogsViewProps> = ({
  onShowToast,
}) => {
  const [serverLogs, setServerLogs] = useState<BrokeifyDebugLogEntry[]>([]);
  const [clientLogs, setClientLogs] = useState<BrokeifyDebugLogEntry[]>(() =>
    getClientDebugLogs()
  );
  const [serverInfo, setServerInfo] = useState<ServerRuntimeInfo | null>(null);
  const [healthChecks, setHealthChecks] = useState<HomelabDiagnosticCheck[]>(
    []
  );
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);
  const [isRunningDiagnostics, setIsRunningDiagnostics] =
    useState<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [levelFilter, setLevelFilter] = useState<DebugLogLevel | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<
    DebugLogCategory | 'all'
  >('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  const [copiedReport, setCopiedReport] = useState<boolean>(false);

  const fetchServerLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const resp = await fetch('/api/debug/logs');
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.logs)) {
          setServerLogs(data.logs);
        }
        if (data.serverInfo) {
          setServerInfo(data.serverInfo);
        }
      }
    } catch (err) {
      logDebugEvent(
        'error',
        'system',
        `Failed to fetch /api/debug/logs: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { skipServerForward: true }
      );
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    fetchServerLogs();
    const unsub = subscribeDebugLogs((nextClientLogs) => {
      setClientLogs([...nextClientLogs]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      fetchServerLogs();
    }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  const handleRunHomelabDiagnostics = async () => {
    setIsRunningDiagnostics(true);
    try {
      const resp = await fetch('/api/debug/diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && Array.isArray(data.checks)) {
        setHealthChecks(data.checks);
        if (Array.isArray(data.logs)) {
          setServerLogs(data.logs);
        }
        const errCount = data.checks.filter(
          (c: HomelabDiagnosticCheck) => c.status === 'error'
        ).length;
        onShowToast?.(
          errCount === 0
            ? '✅ Homelab Health Check complete — all configured services responded!'
            : `⚠️ Health Check found ${errCount} connection issue(s). See details below.`
        );
      }
    } catch (err) {
      logDebugEvent(
        'error',
        'system',
        `Homelab Diagnostics request failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      setIsRunningDiagnostics(false);
    }
  };

  const handleClearAllLogs = async () => {
    clearClientDebugLogs();
    setClientLogs([]);
    try {
      const resp = await fetch('/api/debug/logs', { method: 'DELETE' });
      if (resp.ok) {
        const data = await resp.json();
        setServerLogs(Array.isArray(data.logs) ? data.logs : []);
      }
    } catch {
      setServerLogs([]);
    }
    onShowToast?.('🧹 Cleared all server and browser debug logs.');
  };

  // Merge & deduplicate server + client logs sorted newest-first
  const combinedLogs = useMemo(() => {
    const map = new Map<string, BrokeifyDebugLogEntry>();
    for (const item of serverLogs) {
      map.set(`${item.timestamp}-${item.message}`, item);
    }
    for (const item of clientLogs) {
      const key = `${item.timestamp}-${item.message}`;
      if (!map.has(key)) {
        map.set(key, item);
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
  }, [serverLogs, clientLogs]);

  const filteredLogs = useMemo(() => {
    return combinedLogs.filter((entry) => {
      if (levelFilter !== 'all' && entry.level !== levelFilter) {
        return false;
      }
      if (categoryFilter !== 'all' && entry.category !== categoryFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${entry.message} ${entry.category} ${entry.endpoint || ''} ${
          entry.details || ''
        } ${entry.hint || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [combinedLogs, levelFilter, categoryFilter, searchQuery]);

  const counts = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    for (const l of combinedLogs) {
      if (l.level === 'error') errors += 1;
      else if (l.level === 'warn') warnings += 1;
    }
    return { errors, warnings, total: combinedLogs.length };
  }, [combinedLogs]);

  const toggleExpand = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyBugReport = async () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      userAgent:
        typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      serverInfo,
      healthChecks,
      logs: filteredLogs.slice(0, 100),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 3000);
      onShowToast?.(
        '📋 Copied redacted diagnostic bug report to clipboard!'
      );
    } catch {
      onShowToast?.('⚠️ Could not copy to clipboard — use Download JSON instead.');
    }
  };

  const handleDownloadBugReport = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      userAgent:
        typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      serverInfo,
      healthChecks,
      logs: combinedLogs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brokeify-debug-report-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    onShowToast?.('💾 Downloaded brokeify-debug-report.json!');
  };

  return (
    <div className="space-y-6" data-testid="debug-logs-view">
      {/* GitHub Repository Version & Update Checker */}
      <VersionChecker onShowToast={onShowToast} />

      {/* Top Banner: Plain-English Diagnostic & Error Hunter Overview */}
      <div className="winamp-bezel rounded-2xl border border-emerald-500/40 bg-zinc-950/90 p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#00ff66]">
              <Bug className="w-4 h-4" />
              <span>
                Step-by-Step Error Hunter // Server &amp; Browser Diagnostic Log
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-bold text-white font-mono">
              Homelab Connection Diagnostics &amp; Real-Time Error Log
            </h2>
            <p className="text-xs text-zinc-300 max-w-3xl leading-relaxed">
              Whenever Brokeify talks to{' '}
              <strong className="text-white">SQLite Library</strong>,{' '}
              <strong className="text-white">slskd</strong>,{' '}
              <strong className="text-white">Lidarr</strong>,{' '}
              <strong className="text-white">ListenBrainz</strong>,{' '}
              <strong className="text-white">Spotify</strong>, or{' '}
              <strong className="text-white">YouTube Music</strong>, any
              connection error, wrong API key, timeout, or audio stream hiccup is
              automatically recorded here with a plain-English{' '}
              <span className="text-[#00ff66] font-semibold">
                How to Fix Hint
              </span>
              . All passwords and API keys are automatically redacted.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRunHomelabDiagnostics}
              disabled={isRunningDiagnostics}
              data-testid="btn-run-homelab-diagnostics"
              className="inline-flex items-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-50 px-4 py-2.5 text-xs font-mono font-bold text-zinc-950 shadow-md transition-colors min-h-[42px]"
            >
              {isRunningDiagnostics ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Activity className="w-4 h-4" />
              )}
              <span>
                {isRunningDiagnostics
                  ? 'Testing All Connections...'
                  : '1-Click Health Check'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleCopyBugReport}
              data-testid="btn-copy-bug-report"
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-[#00ff66]/50 px-3.5 py-2.5 text-xs font-mono font-bold text-zinc-200 hover:text-white transition-colors min-h-[42px]"
            >
              {copiedReport ? (
                <ClipboardCheck className="w-4 h-4 text-[#00ff66]" />
              ) : (
                <Copy className="w-4 h-4 text-zinc-400" />
              )}
              <span>{copiedReport ? 'Copied!' : 'Copy Bug Report'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadBugReport}
              data-testid="btn-download-bug-report"
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-purple-500/50 px-3.5 py-2.5 text-xs font-mono font-bold text-zinc-200 hover:text-white transition-colors min-h-[42px]"
            >
              <Download className="w-4 h-4 text-purple-400" />
              <span>Export JSON</span>
            </button>
          </div>
        </div>

        {/* Runtime Telemetry Bar */}
        {serverInfo && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2 border-t border-zinc-800/80 text-xs font-mono">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2.5">
              <div className="text-[10px] text-zinc-400 uppercase">
                Server Port
              </div>
              <div className="text-sm font-bold text-[#00ff66] mt-0.5">
                :{serverInfo.port}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2.5">
              <div className="text-[10px] text-zinc-400 uppercase">
                Config Storage
              </div>
              <div
                title={serverInfo.configPath}
                className="text-xs font-bold text-white truncate mt-0.5"
              >
                {serverInfo.configPath}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2.5">
              <div className="text-[10px] text-zinc-400 uppercase">
                yt-dlp / ffmpeg
              </div>
              <div className="text-xs font-bold mt-0.5">
                {serverInfo.ytDlpAvailable ? (
                  <span className="text-[#00ff66]">Ready ({serverInfo.ytDlpVersion || 'installed'})</span>
                ) : (
                  <span className="text-amber-300">HTTP Fallback Mode</span>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2.5">
              <div className="text-[10px] text-zinc-400 uppercase">
                Memory &amp; Node
              </div>
              <div className="text-xs font-bold text-white mt-0.5">
                {serverInfo.memoryRssMb} MB · {serverInfo.nodeVersion}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2.5">
              <div className="text-[10px] text-zinc-400 uppercase">
                Errors Logged
              </div>
              <div
                className={`text-sm font-bold mt-0.5 ${
                  counts.errors > 0 ? 'text-rose-400' : 'text-[#00ff66]'
                }`}
              >
                {counts.errors} Error(s)
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-2.5">
              <div className="text-[10px] text-zinc-400 uppercase">
                Warnings / Total
              </div>
              <div className="text-sm font-bold text-amber-300 mt-0.5">
                {counts.warnings} Warn · {counts.total} Total
              </div>
            </div>
          </div>
        )}

        {/* Health Check Results Grid (shown when user clicks 1-Click Health Check) */}
        {healthChecks.length > 0 && (
          <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
            <div className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
              <Server className="w-3.5 h-3.5 text-[#00ff66]" />
              <span>Homelab Service Health Check Results</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {healthChecks.map((chk) => (
                <div
                  key={chk.id}
                  className={`rounded-xl border p-3.5 space-y-1.5 ${
                    chk.status === 'ok'
                      ? 'border-emerald-500/40 bg-emerald-950/20'
                      : chk.status === 'error'
                        ? 'border-rose-500/50 bg-rose-950/25'
                        : 'border-amber-500/40 bg-amber-950/20'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-bold text-white">
                      {chk.name}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-bold uppercase ${
                        chk.status === 'ok'
                          ? 'bg-emerald-500/20 text-[#00ff66]'
                          : chk.status === 'error'
                            ? 'bg-rose-500/25 text-rose-300'
                            : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {chk.status === 'ok'
                        ? 'ONLINE'
                        : chk.status === 'error'
                          ? 'ERROR'
                          : 'OPTIONAL'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-200 font-mono">
                    {chk.summary}
                  </p>
                  {chk.details && (
                    <p className="text-[11px] text-zinc-400 font-mono break-all">
                      {chk.details}
                    </p>
                  )}
                  {chk.hint && (
                    <div className="rounded-lg border border-zinc-700/80 bg-zinc-950/80 p-2 text-[11px] text-amber-200 font-mono flex items-start gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <span>{chk.hint}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filter & Search Toolbar */}
      <div className="winamp-bezel rounded-2xl border border-zinc-800 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Level Filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `All (${counts.total})` },
                { id: 'error', label: `Errors (${counts.errors})` },
                { id: 'warn', label: `Warnings (${counts.warnings})` },
                { id: 'info', label: 'Info' },
                { id: 'success', label: 'Success' },
              ] as const
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setLevelFilter(btn.id)}
                data-testid={`debug-filter-level-${btn.id}`}
                className={`rounded-xl px-3 py-1.5 text-xs font-mono font-bold transition-colors min-h-[34px] ${
                  levelFilter === btn.id
                    ? 'bg-[#00ff66] text-zinc-950'
                    : 'border border-zinc-800 bg-zinc-950 text-zinc-300 hover:text-white'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* Right Controls: Auto-Refresh, Test Error, Refresh, Clear */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoRefresh((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-mono font-semibold min-h-[34px] ${
                autoRefresh
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-[#00ff66]'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-400'
              }`}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-spin' : ''}`}
              />
              <span>Live Tail: {autoRefresh ? 'ON' : 'OFF'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                logDebugEvent(
                  'warn',
                  'system',
                  'Diagnostic Test Event logged manually from Settings → Debug & Error Logs',
                  {
                    endpoint: 'CLIENT // Manual Diagnostic Trigger',
                    details: JSON.stringify(
                      {
                        test: true,
                        timestamp: new Date().toISOString(),
                        location: window.location.href,
                      },
                      null,
                      2
                    ),
                    hint: 'Error & warning capture is working properly! Any real API or playback failure will appear just like this.',
                  }
                );
                setTimeout(fetchServerLogs, 300);
              }}
              data-testid="btn-trigger-test-log"
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 text-xs font-mono font-semibold text-amber-300 min-h-[34px]"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Write Test Log</span>
            </button>

            <button
              type="button"
              onClick={fetchServerLogs}
              disabled={isLoadingLogs}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-3 py-1.5 text-xs font-mono text-zinc-200 min-h-[34px]"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`}
              />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={handleClearAllLogs}
              data-testid="btn-clear-debug-logs"
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-950/30 hover:bg-rose-900/50 px-3 py-1.5 text-xs font-mono font-semibold text-rose-300 min-h-[34px]"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Logs</span>
            </button>
          </div>
        </div>

        {/* Category Filter Pills + Keyword Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-zinc-800/80">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: 'All Services' },
                { id: 'jellyfin', label: 'SQLite Library' },
                { id: 'slskd', label: 'slskd' },
                { id: 'lidarr', label: 'Lidarr' },
                { id: 'spotify', label: 'Spotify' },
                { id: 'youtube', label: 'YouTube / yt-dlp' },
                { id: 'listenbrainz', label: 'ListenBrainz' },
                { id: 'audio', label: 'Audio Engine' },
                { id: 'playback-sync', label: 'Cross-Device Sync' },
                { id: 'system', label: 'System' },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-mono transition-colors ${
                  categoryFilter === cat.id
                    ? 'bg-purple-600 text-white font-bold'
                    : 'bg-zinc-900/90 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[240px]">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search errors, URLs, status codes..."
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 pl-8 pr-3 py-1.5 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Live Log Entries List */}
      <div className="winamp-bezel rounded-2xl border border-zinc-800 overflow-hidden">
        <div className="winamp-titlebar px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between text-xs font-mono">
          <span className="font-bold text-white uppercase tracking-wider">
            UNIFIED DIAGNOSTIC EVENT STREAM ({filteredLogs.length} SHOWN)
          </span>
          <span className="text-zinc-400">
            Click any entry to inspect full HTTP response or stack trace
          </span>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-[#00ff66] mx-auto" />
            <div className="text-sm font-mono font-bold text-white">
              No matching errors or events in the log buffer
            </div>
            <p className="text-xs text-zinc-400 max-w-md mx-auto">
              Click <strong className="text-[#00ff66]">1-Click Health Check</strong> above to test all your homelab connections and populate a full diagnostic report.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/80 max-h-[620px] overflow-y-auto">
            {filteredLogs.map((entry) => {
              const isExpanded = expandedLogIds.has(entry.id);
              const formattedTime = entry.timestamp
                ? entry.timestamp.replace('T', ' ').slice(0, 19)
                : '';

              return (
                <div
                  key={entry.id}
                  data-testid="debug-log-row"
                  className={`p-3.5 sm:px-5 transition-colors ${
                    entry.level === 'error'
                      ? 'bg-rose-950/15 hover:bg-rose-950/25'
                      : entry.level === 'warn'
                        ? 'bg-amber-950/10 hover:bg-amber-950/20'
                        : 'hover:bg-zinc-900/50'
                  }`}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleExpand(entry.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleExpand(entry.id);
                      }
                    }}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                      {/* Level Badge */}
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-bold uppercase shrink-0 ${
                          entry.level === 'error'
                            ? 'bg-rose-500/20 border border-rose-500/50 text-rose-300'
                            : entry.level === 'warn'
                              ? 'bg-amber-500/20 border border-amber-500/50 text-amber-300'
                              : entry.level === 'success'
                                ? 'bg-emerald-500/20 border border-emerald-500/50 text-[#00ff66]'
                                : 'bg-sky-500/20 border border-sky-500/40 text-sky-300'
                        }`}
                      >
                        {entry.level === 'error' ? (
                          <AlertCircle className="w-3 h-3" />
                        ) : entry.level === 'warn' ? (
                          <AlertTriangle className="w-3 h-3" />
                        ) : entry.level === 'success' ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <Info className="w-3 h-3" />
                        )}
                        <span>{entry.level}</span>
                      </span>

                      {/* Category Badge */}
                      <span className="rounded bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[10px] font-mono font-semibold text-zinc-200 uppercase shrink-0">
                        {entry.category}
                      </span>

                      {/* Source Badge */}
                      <span className="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 uppercase shrink-0">
                        {entry.source}
                      </span>

                      {/* Status Code if present */}
                      {entry.statusCode ? (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold shrink-0 ${
                            entry.statusCode >= 400
                              ? 'bg-rose-900/60 text-rose-200'
                              : 'bg-zinc-800 text-zinc-300'
                          }`}
                        >
                          HTTP {entry.statusCode}
                        </span>
                      ) : null}

                      {/* Main Message */}
                      <span className="text-xs sm:text-sm font-mono font-semibold text-white break-words">
                        {entry.message}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 text-[11px] font-mono text-zinc-400">
                      <span>{formattedTime}</span>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-zinc-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-zinc-400" />
                      )}
                    </div>
                  </div>

                  {/* Plain-English Troubleshooting Hint */}
                  {entry.hint && (
                    <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs font-mono text-amber-200 flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-amber-300">How to fix: </strong>
                        <span>{entry.hint}</span>
                      </div>
                    </div>
                  )}

                  {/* Expanded Endpoint + Stack Trace / Payload Inspector */}
                  {isExpanded && (
                    <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-2 text-xs font-mono">
                      {entry.endpoint && (
                        <div>
                          <span className="text-zinc-400">Endpoint / Source: </span>
                          <span className="text-[#00ff66] break-all">
                            {entry.endpoint}
                          </span>
                        </div>
                      )}
                      {entry.details ? (
                        <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-zinc-300 bg-zinc-900/90 p-3 rounded-lg border border-zinc-800 max-h-64 overflow-y-auto">
                          {entry.details}
                        </pre>
                      ) : (
                        <div className="text-zinc-500 text-[11px]">
                          No additional stack trace or payload body attached to this event.
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
    </div>
  );
};
