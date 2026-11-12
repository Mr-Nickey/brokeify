import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

interface LivePingTelemetry {
  ok: boolean;
  latencyMs: number;
  version: string;
  uptimeSec: number;
  memoryRssMb: number;
  checkedAt: string;
  sqlite?: {
    path: string;
    journalMode: string;
    busyTimeoutMs: number;
    readable: boolean;
    writable: boolean;
  };
  musicMount?: {
    path: string;
    readable: boolean;
    totalTracks: number;
    totalAlbums: number;
    totalArtists: number;
    totalPlaylists: number;
  };
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
  // OFF by default so it uses zero background resources until turned on
  const [systemHealthEnabled, setSystemHealthEnabled] =
    useState<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [pingTelemetry, setPingTelemetry] = useState<LivePingTelemetry | null>(
    null
  );
  const [copiedKumaUrl, setCopiedKumaUrl] = useState<boolean>(false);
  const [levelFilter, setLevelFilter] = useState<DebugLogLevel | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<
    DebugLogCategory | 'all'
  >('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  const [copiedReport, setCopiedReport] = useState<boolean>(false);

  const fetchServerLogs = useCallback(async () => {
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
  }, []);

  const runSelfChecks = useCallback(
    async (silent = false) => {
      setIsRunningDiagnostics(true);
      try {
        // 1. Measure real client -> /api/ping round-trip latency + inspect SQLite & /music telemetry
        const pingStart = performance.now();
        try {
          const pingResp = await fetch('/api/ping', { cache: 'no-store' });
          const pingLatencyMs = Math.max(
            1,
            Math.round(performance.now() - pingStart)
          );
          if (pingResp.ok) {
            const pingData = await pingResp.json();
            setPingTelemetry({
              ok: Boolean(pingData.ok),
              latencyMs: pingLatencyMs,
              version: pingData.version || '1.3.0',
              uptimeSec: Number(pingData.uptimeSec || 0),
              memoryRssMb: Number(pingData.memoryRssMb || 0),
              checkedAt: new Date().toLocaleTimeString(),
              sqlite: pingData.sqlite,
              musicMount: pingData.musicMount,
            });
          } else {
            setPingTelemetry((prev) => ({
              ok: false,
              latencyMs: pingLatencyMs,
              version: prev?.version || '1.3.0',
              uptimeSec: prev?.uptimeSec || 0,
              memoryRssMb: prev?.memoryRssMb || 0,
              checkedAt: new Date().toLocaleTimeString(),
              sqlite: prev?.sqlite,
              musicMount: prev?.musicMount,
            }));
          }
        } catch {
          setPingTelemetry((prev) => ({
            ok: false,
            latencyMs: 0,
            version: prev?.version || '1.3.0',
            uptimeSec: prev?.uptimeSec || 0,
            memoryRssMb: prev?.memoryRssMb || 0,
            checkedAt: new Date().toLocaleTimeString(),
            sqlite: prev?.sqlite,
            musicMount: prev?.musicMount,
          }));
        }

        // 2. Run deep backend diagnostics (/api/ping, /data/brokeify.db WAL, /music mount, slskd, Lidarr, MusicBrainz, LRCLIB)
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
          if (!silent) {
            const errCount = data.checks.filter(
              (c: HomelabDiagnosticCheck) => c.status === 'error'
            ).length;
            onShowToast?.(
              errCount === 0
                ? '✅ System Health & Diagnostics complete — all services healthy!'
                : `⚠️ Diagnostics detected ${errCount} connection issue(s). See badges below.`
            );
          }
        }
      } catch (err) {
        logDebugEvent(
          'error',
          'system',
          `System Health Diagnostics failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      } finally {
        setIsRunningDiagnostics(false);
      }
    },
    [onShowToast]
  );

  useEffect(() => {
    fetchServerLogs();
    const unsub = subscribeDebugLogs((nextClientLogs) => {
      setClientLogs([...nextClientLogs]);
    });
    return () => unsub();
  }, [fetchServerLogs]);

  // Periodic self-checks ONLY run when System Health & Diagnostics is toggled ON (off by default = 0 background overhead)
  useEffect(() => {
    if (!systemHealthEnabled) return;
    runSelfChecks(true);
    const timer = setInterval(() => {
      runSelfChecks(true);
    }, 15000);
    return () => clearInterval(timer);
  }, [systemHealthEnabled, runSelfChecks]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      fetchServerLogs();
    }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchServerLogs]);

  const handleToggleSystemHealth = () => {
    setSystemHealthEnabled((prev) => {
      const next = !prev;
      onShowToast?.(
        next
          ? '🩺 System Health & Diagnostics ENABLED — running live self-checks every 15s (Dozzle & Uptime Kuma telemetry active).'
          : '⏸️ System Health & Diagnostics OFF — background self-checks stopped (0 background resources).'
      );
      return next;
    });
  };

  const handleRunHomelabDiagnostics = async () => {
    await runSelfChecks(false);
  };

  const handleCopyKumaEndpoint = async () => {
    const url = `${window.location.origin}/api/ping`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKumaUrl(true);
      setTimeout(() => setCopiedKumaUrl(false), 2500);
      onShowToast?.(`📋 Copied Uptime Kuma monitor URL: ${url}`);
    } catch {
      onShowToast?.(`Uptime Kuma URL: ${url}`);
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

  // Lookup helpers for the 4 core diagnostic groups
  const checkById = useMemo(() => {
    const map = new Map<string, HomelabDiagnosticCheck>();
    for (const c of healthChecks) {
      map.set(c.id, c);
    }
    return map;
  }, [healthChecks]);

  const apiPingCheck = checkById.get('api-ping');
  const sqliteCheck = checkById.get('sqlite');
  const musicMountCheck = checkById.get('music-mount');
  const optionalIntegrationChecks = useMemo(
    () =>
      (['slskd', 'lidarr', 'musicbrainz', 'lrclib'] as const)
        .map((id) => checkById.get(id))
        .filter((c): c is HomelabDiagnosticCheck => Boolean(c)),
    [checkById]
  );

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
      pingTelemetry,
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
      pingTelemetry,
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

      {/* Toggleable System Health & Diagnostics Panel (Off by Default = Zero Background Overhead) */}
      <div
        className={`winamp-bezel rounded-2xl border p-5 space-y-4 transition-colors ${
          systemHealthEnabled
            ? 'border-[#00ff66]/60 bg-zinc-950/95 shadow-[0_0_25px_rgba(0,255,102,0.08)]'
            : 'border-zinc-800 bg-zinc-950/90'
        }`}
        data-testid="system-health-diagnostics-panel"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#00ff66]">
              <Activity
                className={`w-4 h-4 ${
                  systemHealthEnabled ? 'animate-pulse text-[#00ff66]' : 'text-zinc-400'
                }`}
              />
              <span>
                System Health &amp; Diagnostics // Uptime Kuma &amp; Dozzle Telemetry
              </span>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                  systemHealthEnabled
                    ? 'bg-emerald-500/20 text-[#00ff66] border border-emerald-500/40'
                    : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                }`}
              >
                {systemHealthEnabled
                  ? 'LIVE POLLING (15S)'
                  : 'OFF BY DEFAULT (0 BACKGROUND CPU)'}
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-bold text-white font-mono">
              Toggleable Self-Check Monitor &amp; Container Observability
            </h2>
            <p className="text-xs text-zinc-300 max-w-3xl leading-relaxed">
              Off by default so Brokeify uses{' '}
              <strong className="text-white">zero background resources</strong>{' '}
              during normal listening. Flip the switch below to run periodic
              self-checks on <code className="text-[#00ff66]">/api/ping</code>,{' '}
              <code className="text-[#00ff66]">/data/brokeify.db</code> (WAL
              mode), <code className="text-[#00ff66]">/music</code> library
              mount, and optional integrations (<strong className="text-white">slskd</strong>,{' '}
              <strong className="text-white">Lidarr</strong>,{' '}
              <strong className="text-white">MusicBrainz</strong>,{' '}
              <strong className="text-white">LRCLIB</strong>), while streaming
              structured <code className="text-amber-300">[DOZZLE-HEALTHCHECK]</code>{' '}
              lines to container stdout for <strong className="text-white">Dozzle</strong>.
            </p>
          </div>

          {/* Toggle Switch + Uptime Kuma Copy Button */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={systemHealthEnabled}
              onClick={handleToggleSystemHealth}
              data-testid="toggle-system-health-diagnostics"
              className={`inline-flex items-center gap-3 rounded-xl border px-4 py-2.5 text-xs font-mono font-bold transition-all min-h-[44px] ${
                systemHealthEnabled
                  ? 'border-[#00ff66] bg-emerald-500/15 text-white shadow-md'
                  : 'border-zinc-700 bg-zinc-900 hover:border-zinc-600 text-zinc-300'
              }`}
            >
              <span
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  systemHealthEnabled ? 'bg-[#00ff66]' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-zinc-950 transition-transform ${
                    systemHealthEnabled ? 'translate-x-4' : 'translate-x-1'
                  }`}
                />
              </span>
              <div className="text-left">
                <div className="text-xs font-bold leading-tight">
                  System Health &amp; Diagnostics:{' '}
                  <span
                    className={
                      systemHealthEnabled ? 'text-[#00ff66]' : 'text-zinc-400'
                    }
                  >
                    {systemHealthEnabled ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div className="text-[10px] font-normal text-zinc-400">
                  {systemHealthEnabled
                    ? `Last check: ${pingTelemetry?.checkedAt || 'running...'}`
                    : 'Zero background polling'}
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={handleCopyKumaEndpoint}
              data-testid="btn-copy-uptime-kuma-url"
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-[#00ff66]/50 px-3.5 py-2.5 text-xs font-mono font-bold text-zinc-200 hover:text-white transition-colors min-h-[44px]"
              title="Copy /api/ping endpoint URL for Uptime Kuma HTTP(s) or JSON Query monitor"
            >
              {copiedKumaUrl ? (
                <ClipboardCheck className="w-4 h-4 text-[#00ff66]" />
              ) : (
                <Copy className="w-4 h-4 text-[#00ff66]" />
              )}
              <span>
                {copiedKumaUrl ? 'Copied /api/ping!' : 'Uptime Kuma URL'}
              </span>
            </button>
          </div>
        </div>

        {/* Live Status Badges (Shown when System Health switch is ON or after a manual 1-Click Health Check) */}
        {(systemHealthEnabled || healthChecks.length > 0 || pingTelemetry) && (
          <div
            className="pt-3 border-t border-zinc-800/90 space-y-3"
            data-testid="live-health-status-badges"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {/* 1. API Server & Response Latency (/api/ping) */}
              <div
                data-testid="health-badge-api-ping"
                className={`rounded-xl border p-3.5 space-y-1.5 ${
                  pingTelemetry?.ok !== false && apiPingCheck?.status !== 'error'
                    ? 'border-emerald-500/40 bg-emerald-950/20'
                    : 'border-rose-500/50 bg-rose-950/25'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold text-white">
                    1. API Server (`/api/ping`)
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-bold uppercase ${
                      pingTelemetry?.ok !== false &&
                      apiPingCheck?.status !== 'error'
                        ? 'bg-emerald-500/20 text-[#00ff66]'
                        : 'bg-rose-500/25 text-rose-300'
                    }`}
                  >
                    {isRunningDiagnostics && !pingTelemetry ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : pingTelemetry?.ok !== false ? (
                      `${pingTelemetry?.latencyMs ?? apiPingCheck?.latencyMs ?? 1}ms ONLINE`
                    ) : (
                      'UNREACHABLE'
                    )}
                  </span>
                </div>
                <p className="text-xs text-zinc-200 font-mono">
                  {apiPingCheck?.summary ||
                    (pingTelemetry
                      ? `HTTP 200 OK · Round-trip latency ${pingTelemetry.latencyMs}ms · Uptime ${Math.floor(
                          pingTelemetry.uptimeSec / 60
                        )}m`
                      : 'Measuring /api/ping response latency...')}
                </p>
                <p className="text-[11px] text-zinc-400 font-mono">
                  Uptime Kuma ready (`/api/ping`) · Dozzle stdout structured logs active
                </p>
              </div>

              {/* 2. SQLite Database (/data/brokeify.db read/write & WAL status) */}
              <div
                data-testid="health-badge-sqlite"
                className={`rounded-xl border p-3.5 space-y-1.5 ${
                  sqliteCheck?.status === 'error' ||
                  pingTelemetry?.sqlite?.writable === false
                    ? 'border-rose-500/50 bg-rose-950/25'
                    : 'border-emerald-500/40 bg-emerald-950/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold text-white">
                    2. SQLite DB (`/data/brokeify.db`)
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-bold uppercase ${
                      sqliteCheck?.status === 'error' ||
                      pingTelemetry?.sqlite?.writable === false
                        ? 'bg-rose-500/25 text-rose-300'
                        : 'bg-emerald-500/20 text-[#00ff66]'
                    }`}
                  >
                    {sqliteCheck?.status === 'error'
                      ? 'LOCKED / ERROR'
                      : `R/W OK · ${(
                          pingTelemetry?.sqlite?.journalMode || 'WAL'
                        ).toUpperCase()}`}
                  </span>
                </div>
                <p className="text-xs text-zinc-200 font-mono">
                  {sqliteCheck?.summary ||
                    (pingTelemetry?.sqlite
                      ? `Read/Write OK · journal_mode=${pingTelemetry.sqlite.journalMode.toUpperCase()} · busy_timeout=${pingTelemetry.sqlite.busyTimeoutMs}ms`
                      : 'Verifying /data/brokeify.db WAL & write probe...')}
                </p>
                <p className="text-[11px] text-zinc-400 font-mono truncate">
                  {sqliteCheck?.details ||
                    pingTelemetry?.sqlite?.path ||
                    '/data/brokeify.db'}
                </p>
              </div>

              {/* 3. Music Library Mount (/music readable & track count) */}
              <div
                data-testid="health-badge-music-mount"
                className={`rounded-xl border p-3.5 space-y-1.5 ${
                  musicMountCheck?.status === 'error'
                    ? 'border-rose-500/50 bg-rose-950/25'
                    : musicMountCheck?.status === 'warn' ||
                        pingTelemetry?.musicMount?.readable === false
                      ? 'border-amber-500/40 bg-amber-950/20'
                      : 'border-emerald-500/40 bg-emerald-950/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold text-white">
                    3. Music Mount (`/music`)
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-bold uppercase ${
                      musicMountCheck?.status === 'ok' ||
                      pingTelemetry?.musicMount?.readable
                        ? 'bg-emerald-500/20 text-[#00ff66]'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {musicMountCheck?.status === 'ok' ||
                    pingTelemetry?.musicMount?.readable
                      ? `READABLE · ${
                          pingTelemetry?.musicMount?.totalTracks ?? 0
                        } TRACKS`
                      : 'EMPTY / UNMOUNTED'}
                  </span>
                </div>
                <p className="text-xs text-zinc-200 font-mono">
                  {musicMountCheck?.summary ||
                    (pingTelemetry?.musicMount
                      ? `${
                          pingTelemetry.musicMount.readable
                            ? 'Mount readable'
                            : 'Mount not found (safe fallback)'
                        } · ${pingTelemetry.musicMount.totalTracks} tracks, ${
                          pingTelemetry.musicMount.totalAlbums
                        } albums`
                      : 'Checking /music mount & indexed track count...')}
                </p>
                <p className="text-[11px] text-zinc-400 font-mono truncate">
                  {musicMountCheck?.details ||
                    pingTelemetry?.musicMount?.path ||
                    '/music'}
                </p>
              </div>

              {/* 4. Optional Integrations (slskd, Lidarr, MusicBrainz, LRCLIB reachability) */}
              <div
                data-testid="health-badge-optional-integrations"
                className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3.5 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold text-white">
                    4. Optional Integrations
                  </span>
                  <span className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-mono font-bold uppercase text-zinc-300">
                    {optionalIntegrationChecks.filter((c) => c.status === 'ok')
                      .length}{' '}
                    / 4 ONLINE
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  {(
                    [
                      { id: 'slskd', label: 'slskd' },
                      { id: 'lidarr', label: 'Lidarr' },
                      { id: 'musicbrainz', label: 'MusicBrainz' },
                      { id: 'lrclib', label: 'LRCLIB' },
                    ] as const
                  ).map((svc) => {
                    const chk = checkById.get(svc.id);
                    const status = chk?.status || 'unconfigured';
                    return (
                      <div
                        key={svc.id}
                        data-testid={`health-subbadge-${svc.id}`}
                        title={chk?.summary || `${svc.label}: not checked yet`}
                        className={`flex items-center justify-between gap-1 rounded-lg border px-2 py-1 text-[11px] font-mono ${
                          status === 'ok'
                            ? 'border-emerald-500/40 bg-emerald-950/30 text-[#00ff66]'
                            : status === 'error'
                              ? 'border-rose-500/50 bg-rose-950/30 text-rose-300'
                              : 'border-zinc-800 bg-zinc-950/70 text-zinc-400'
                        }`}
                      >
                        <span className="font-bold truncate">{svc.label}</span>
                        <span className="text-[10px] uppercase shrink-0">
                          {status === 'ok'
                            ? chk?.latencyMs
                              ? `${chk.latencyMs}ms`
                              : 'OK'
                            : status === 'error'
                              ? 'ERR'
                              : 'OPT'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

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

        {/* Health Check Results Grid (shown when user clicks 1-Click Health Check or enables System Health) */}
        {healthChecks.length > 0 && (
          <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
            <div className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
              <Server className="w-3.5 h-3.5 text-[#00ff66]" />
              <span>Detailed Service Diagnostic Breakdown</span>
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
                        ? chk.latencyMs
                          ? `ONLINE (${chk.latencyMs}ms)`
                          : 'ONLINE'
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
