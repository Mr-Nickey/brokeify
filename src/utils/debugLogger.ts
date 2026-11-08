import type {
  BrokeifyDebugLogEntry,
  DebugLogCategory,
  DebugLogLevel,
} from '../types/music';

const CLIENT_DEBUG_LOGS_KEY = 'brokeify_debug_logs_v1';
const MAX_CLIENT_LOGS = 200;

type LogListener = (logs: BrokeifyDebugLogEntry[]) => void;
const listeners = new Set<LogListener>();

export function redactSensitiveText(input: string): string {
  if (!input) return '';
  return input
    .replace(
      /(api[_-]?key|token|password|authorization|secret)(["'\s:=]+)([^\s"',&}]+)/gi,
      '$1$2[REDACTED]'
    )
    .replace(/(MediaBrowser Token=")([^"]+)(")/gi, '$1[REDACTED]$3');
}

function loadStoredClientLogs(): BrokeifyDebugLogEntry[] {
  try {
    const raw = localStorage.getItem(CLIENT_DEBUG_LOGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.slice(0, MAX_CLIENT_LOGS);
    }
  } catch {
    // ignore storage errors
  }
  return [];
}

let clientLogsCache: BrokeifyDebugLogEntry[] = loadStoredClientLogs();

function saveStoredClientLogs(logs: BrokeifyDebugLogEntry[]): void {
  clientLogsCache = logs.slice(0, MAX_CLIENT_LOGS);
  try {
    localStorage.setItem(
      CLIENT_DEBUG_LOGS_KEY,
      JSON.stringify(clientLogsCache)
    );
  } catch {
    // ignore quota errors
  }
  for (const listener of listeners) {
    try {
      listener(clientLogsCache);
    } catch {
      // ignore listener errors
    }
  }
}

export function getClientDebugLogs(): BrokeifyDebugLogEntry[] {
  return clientLogsCache;
}

export function clearClientDebugLogs(): void {
  saveStoredClientLogs([]);
}

export function subscribeDebugLogs(listener: LogListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function inferCategoryFromUrl(url: string): DebugLogCategory {
  const lower = url.toLowerCase();
  if (lower.includes('jellyfin') || lower.includes('displaypreferences')) {
    return 'jellyfin';
  }
  if (lower.includes('lidarr')) return 'lidarr';
  if (lower.includes('slskd')) return 'slskd';
  if (lower.includes('listenbrainz')) return 'listenbrainz';
  if (lower.includes('spotify')) return 'spotify';
  if (lower.includes('youtube')) return 'youtube';
  if (lower.includes('autopilot')) return 'autopilot';
  if (lower.includes('playback-session')) return 'playback-sync';
  return 'system';
}

export function inferHintForError(
  category: DebugLogCategory,
  message: string,
  statusCode?: number
): string {
  const lower = message.toLowerCase();
  if (statusCode === 401 || statusCode === 403 || lower.includes('401') || lower.includes('unauthorized')) {
    return `Authentication rejected (${statusCode || 401}). Check that your ${category.toUpperCase()} API Key / Token or Username & Password is valid in Settings → 1. Server & Connections.`;
  }
  if (statusCode === 404) {
    return `Endpoint returned 404 Not Found. Verify that the base URL for ${category.toUpperCase()} does not have an extra trailing path (e.g., use http://lidarr:8686 or https://jellyfin.yourdomain.com).`;
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound')
  ) {
    return `Network / DNS connection failed. If running in Docker, ensure the container is on the same Docker network or use the reachable LAN IP / reverse-proxy URL.`;
  }
  if (lower.includes('cors')) {
    return `Browser blocked a cross-origin request. Route homelab calls through Brokeify's built-in /api/* proxy routes or check reverse proxy headers.`;
  }
  if (category === 'audio') {
    return `Audio stream failed to decode or load. Verify Jellyfin is online, your token is active, or enable Offline Queue Preloading.`;
  }
  return 'Inspect the expandable Details payload below for full HTTP status, endpoint URL, and stack trace.';
}

export function logDebugEvent(
  level: DebugLogLevel,
  category: DebugLogCategory,
  message: string,
  extra?: {
    details?: string;
    endpoint?: string;
    statusCode?: number;
    hint?: string;
    skipServerForward?: boolean;
  }
): BrokeifyDebugLogEntry {
  const entry: BrokeifyDebugLogEntry = {
    id: `dbg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    level,
    category,
    source: 'client',
    message: redactSensitiveText(message),
    details: extra?.details ? redactSensitiveText(extra.details) : undefined,
    endpoint: extra?.endpoint ? redactSensitiveText(extra.endpoint) : undefined,
    statusCode: extra?.statusCode,
    hint:
      extra?.hint ||
      (level === 'error' || level === 'warn'
        ? inferHintForError(category, message, extra?.statusCode)
        : undefined),
  };

  saveStoredClientLogs([entry, ...clientLogsCache]);

  // Forward client errors and warnings to the backend server log buffer so everything is unified
  if (
    !extra?.skipServerForward &&
    typeof window !== 'undefined' &&
    (level === 'error' || level === 'warn' || category === 'jellyfin' || category === 'lidarr' || category === 'slskd')
  ) {
    fetch('/api/debug/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry }),
    }).catch(() => {
      // Never recurse if server is unreachable
    });
  }

  return entry;
}

export function logDebugError(
  category: DebugLogCategory,
  message: string,
  error?: unknown,
  extra?: {
    endpoint?: string;
    statusCode?: number;
    hint?: string;
  }
): BrokeifyDebugLogEntry {
  let details = '';
  if (error instanceof Error) {
    details = `${error.name}: ${error.message}\n${error.stack || ''}`.trim();
  } else if (typeof error === 'string') {
    details = error;
  } else if (error && typeof error === 'object') {
    try {
      details = JSON.stringify(error, null, 2);
    } catch {
      details = String(error);
    }
  }

  return logDebugEvent('error', category, message, {
    details: details || undefined,
    endpoint: extra?.endpoint,
    statusCode: extra?.statusCode,
    hint: extra?.hint,
  });
}

let globalErrorHandlersInstalled = false;

export function installGlobalErrorCapture(): void {
  if (globalErrorHandlersInstalled || typeof window === 'undefined') return;
  globalErrorHandlersInstalled = true;

  window.addEventListener('error', (event) => {
    const msg = event.message || 'Uncaught window error';
    if (msg.includes('@vite/client') || msg.includes('ResizeObserver')) {
      return;
    }
    const loc = event.filename
      ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}`
      : undefined;
    logDebugError('client', `Uncaught Runtime Error: ${msg}`, event.error || loc, {
      endpoint: loc,
      hint: 'Check the stack trace in Details to see the exact component or line number.',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled Promise Rejection';
    if (msg.includes('@vite/client') || msg.includes('WebSocket')) {
      return;
    }
    logDebugError('client', `Unhandled Promise Rejection: ${msg}`, reason, {
      hint: 'An async operation failed without being caught. Expand Details for stack trace.',
    });
  });
}
