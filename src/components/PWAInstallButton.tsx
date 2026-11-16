import React, { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Hash,
  KeyRound,
  Link2,
  Loader2,
  Maximize2,
  MoreVertical,
  QrCode,
  RefreshCw,
  Share,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wifi,
  X,
} from 'lucide-react';

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(() =>
    typeof window !== 'undefined' ? window.__brokeifyDeferredPwaPrompt || null : null
  );
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    );
  });

  const isAndroid = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /Android/i.test(navigator.userAgent);
  }, []);

  const isIOS = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncPrompt = () => {
      if (window.__brokeifyDeferredPwaPrompt) {
        setDeferredPrompt(window.__brokeifyDeferredPwaPrompt);
      }
    };

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      window.__brokeifyDeferredPwaPrompt = e;
      setDeferredPrompt(e);
    };

    const handleInstalled = () => {
      window.__brokeifyDeferredPwaPrompt = null;
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    syncPrompt();
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('brokeify-pwa-prompt-ready', syncPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('brokeify-pwa-installed', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('brokeify-pwa-prompt-ready', syncPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('brokeify-pwa-installed', handleInstalled);
    };
  }, []);

  const triggerNativeInstall = useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'unavailable'
  > => {
    const promptEvent =
      deferredPrompt ||
      (typeof window !== 'undefined' ? window.__brokeifyDeferredPwaPrompt : null);
    if (!promptEvent || typeof promptEvent.prompt !== 'function') {
      return 'unavailable';
    }
    try {
      await promptEvent.prompt();
      const choiceResult = await promptEvent.userChoice;
      window.__brokeifyDeferredPwaPrompt = null;
      setDeferredPrompt(null);
      if (choiceResult?.outcome === 'accepted') {
        setIsInstalled(true);
        return 'accepted';
      }
      return 'dismissed';
    } catch {
      return 'unavailable';
    }
  }, [deferredPrompt]);

  return {
    canInstallPrompt: Boolean(deferredPrompt),
    isInstalled,
    isAndroid,
    isIOS,
    triggerNativeInstall,
  };
}

export interface PairedAndroidDevice {
  id: string;
  deviceName: string;
  model: string;
  clientIp: string;
  connectedAt: string;
  method?: 'qr' | 'quick-connect-6digit';
}

export interface PendingPhoneRequest {
  code: string;
  formattedCode: string;
  deviceName: string;
  clientIp: string;
}

export interface MobilePairInfoResponse {
  ok: boolean;
  app: string;
  version: string;
  serverUrl: string;
  detectedBrowserUrl?: string;
  publicDomainDetected?: boolean;
  localUrl?: string;
  lanUrl: string;
  port: number;
  quickConnectCode?: string;
  quickConnectFormatted?: string;
  token?: string;
  tempToken?: string;
  expiresAt?: string;
  expiresInSeconds?: number;
  apiKey: string;
  libraryStats?: {
    totalTracks: number;
    totalAlbums: number;
    totalArtists: number;
    totalPlaylists: number;
  };
  pairedDevices?: PairedAndroidDevice[];
  pendingPhoneRequests?: PendingPhoneRequest[];
}

type QrPayloadFormat = 'json' | 'deeplink';

interface AndroidQrContentProps {
  isModal?: boolean;
  onClose?: () => void;
  onOpenPopupModal?: () => void;
}

const AndroidQrPairingPanel: React.FC<AndroidQrContentProps> = ({
  isModal = false,
  onClose,
  onOpenPopupModal,
}) => {
  const browserOrigin =
    typeof window !== 'undefined'
      ? window.location.origin.replace(/\/+$/, '')
      : 'http://localhost:3487';

  const isCustomDomainInBrowser = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const h = window.location.hostname.toLowerCase();
    return (
      h !== 'localhost' &&
      h !== '127.0.0.1' &&
      !h.endsWith('.run.app')
    );
  }, []);

  const [pairInfo, setPairInfo] = useState<MobilePairInfoResponse | null>(null);
  const [customServerUrl, setCustomServerUrl] = useState<string>(browserOrigin);
  // Default to 'origin' (the exact URL currently being used in the browser) when on a domain/LAN host so it matches what the user connected with
  const [urlMode, setUrlMode] = useState<'origin' | 'lan' | 'custom'>(
    isCustomDomainInBrowser ? 'origin' : 'origin'
  );
  const [payloadFormat, setPayloadFormat] = useState<QrPayloadFormat>('json');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [regeneratingKey, setRegeneratingKey] = useState<boolean>(false);
  const [testingHandshake, setTestingHandshake] = useState<boolean>(false);

  // Jellyfin-style 6-Digit Phone Code Authorization state
  const [phonePinInput, setPhonePinInput] = useState<string>('');
  const [authorizingPin, setAuthorizingPin] = useState<boolean>(false);
  const [pinAuthFeedback, setPinAuthFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // URL Reachability Verification state
  const [urlVerifyState, setUrlVerifyState] = useState<{
    checking: boolean;
    ok: boolean | null;
    message: string;
  }>({
    checking: false,
    ok: null,
    message: '',
  });

  const fetchPairInfo = async () => {
    try {
      const resp = await fetch('/api/mobile/pair-info');
      if (resp.ok) {
        const data = (await resp.json()) as MobilePairInfoResponse;
        setPairInfo(data);
        if (!customServerUrl) {
          setCustomServerUrl(
            browserOrigin || data.detectedBrowserUrl || data.lanUrl
          );
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchPairInfo();
    const interval = setInterval(() => {
      fetchPairInfo();
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const detectedCurrentUrl = useMemo(() => {
    return (
      browserOrigin ||
      pairInfo?.detectedBrowserUrl ||
      pairInfo?.serverUrl ||
      'http://localhost:3487'
    ).replace(/\/+$/, '');
  }, [browserOrigin, pairInfo?.detectedBrowserUrl, pairInfo?.serverUrl]);

  const activeServerUrl = useMemo(() => {
    if (urlMode === 'lan') {
      return (
        pairInfo?.localUrl ||
        pairInfo?.lanUrl ||
        'http://localhost:3487'
      ).replace(/\/+$/, '');
    }
    if (urlMode === 'custom') {
      return customServerUrl.trim().replace(/\/+$/, '') || detectedCurrentUrl;
    }
    return detectedCurrentUrl;
  }, [
    customServerUrl,
    detectedCurrentUrl,
    pairInfo?.lanUrl,
    pairInfo?.localUrl,
    urlMode,
  ]);

  // Automatically verify reachability of the active URL
  const verifyTargetUrlReachability = async (targetUrl: string) => {
    setUrlVerifyState({
      checking: true,
      ok: null,
      message: 'Checking connection to URL...',
    });
    try {
      // If checking current browser origin, test relative /api/health; otherwise test full URL
      const endpoint =
        targetUrl === browserOrigin
          ? '/api/health'
          : `${targetUrl.replace(/\/+$/, '')}/api/health`;
      const resp = await fetch(endpoint, { method: 'GET' });
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setUrlVerifyState({
          checking: false,
          ok: true,
          message: `✅ Verified Reachable: ${targetUrl} responded (${
            data.totalTracks ?? 0
          } tracks ready)`,
        });
      } else {
        setUrlVerifyState({
          checking: false,
          ok: false,
          message: `⚠️ URL responded with HTTP ${resp.status}. Double-check port or reverse proxy.`,
        });
      }
    } catch {
      setUrlVerifyState({
        checking: false,
        ok: false,
        message: `⚠️ Browser could not reach ${targetUrl} directly (if this is a LAN IP while you are on HTTPS domain, use your HTTPS domain URL instead).`,
      });
    }
  };

  useEffect(() => {
    if (activeServerUrl) {
      verifyTargetUrlReachability(activeServerUrl);
    }
  }, [activeServerUrl]);

  const tempToken =
    pairInfo?.tempToken || pairInfo?.token || 'pair_temp_token';
  const quickConnectCode = pairInfo?.quickConnectCode || '482915';
  const quickConnectFormatted =
    pairInfo?.quickConnectFormatted ||
    `${quickConnectCode.slice(0, 3)} ${quickConnectCode.slice(3)}`;

  const qrPayloadString = useMemo(() => {
    const apiKey = pairInfo?.apiKey || 'brk_standalone';
    const localUrl =
      pairInfo?.localUrl || pairInfo?.lanUrl || 'http://localhost:3487';

    if (payloadFormat === 'deeplink') {
      const params = new URLSearchParams({
        serverUrl: activeServerUrl,
        localUrl,
        code: quickConnectCode,
        token: tempToken,
        key: apiKey,
      });
      return `brokeify://pair?${params.toString()}`;
    }

    return JSON.stringify({
      app: 'brokeify',
      v: 2,
      serverUrl: activeServerUrl,
      localUrl,
      publicUrl: detectedCurrentUrl,
      quickConnectCode,
      token: tempToken,
      expiresAt: pairInfo?.expiresAt || null,
      apiKey,
      endpoints: {
        verify: '/api/mobile/verify',
        quickConnect: '/api/mobile/quick-connect',
        tracks: '/api/library/tracks',
        albums: '/api/library/albums',
        artists: '/api/library/artists',
        playlists: '/api/playlists',
        stream: '/api/stream/{trackId}',
        cover: '/api/covers/{albumId}',
        scrobble: '/api/scrobble',
      },
    });
  }, [
    activeServerUrl,
    detectedCurrentUrl,
    pairInfo?.apiKey,
    pairInfo?.expiresAt,
    pairInfo?.lanUrl,
    pairInfo?.localUrl,
    payloadFormat,
    quickConnectCode,
    tempToken,
  ]);

  useEffect(() => {
    if (!qrPayloadString) return;
    let cancelled = false;
    QRCode.toDataURL(qrPayloadString, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [qrPayloadString]);

  const handleCopy = (key: string, value: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2400);
  };

  const handleRegenerateToken = async () => {
    setRegeneratingKey(true);
    try {
      const resp = await fetch('/api/mobile/regenerate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotateApiKey: false }),
      });
      if (resp.ok) {
        await fetchPairInfo();
      }
    } finally {
      setRegeneratingKey(false);
    }
  };

  const handleAuthorizePhoneCode = async (codeOverride?: string) => {
    const cleanCode = (codeOverride ?? phonePinInput).replace(/\D/g, '');
    if (cleanCode.length !== 6) {
      setPinAuthFeedback({
        ok: false,
        message: 'Enter a 6-digit Quick Connect code (e.g. 482 915).',
      });
      return;
    }

    setAuthorizingPin(true);
    setPinAuthFeedback(null);
    try {
      const resp = await fetch('/api/mobile/quick-connect/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: cleanCode,
          deviceName: 'Android Phone (6-Digit Quick Connect)',
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        setPinAuthFeedback({
          ok: true,
          message:
            data.message ||
            `✅ Phone linked via 6-digit code ${cleanCode.slice(
              0,
              3
            )} ${cleanCode.slice(3)}!`,
        });
        setPhonePinInput('');
        await fetchPairInfo();
      } else {
        setPinAuthFeedback({
          ok: false,
          message:
            data.error ||
            'Could not find an active request for that 6-digit code.',
        });
      }
    } catch {
      setPinAuthFeedback({
        ok: false,
        message: 'Network error verifying 6-digit Quick Connect code.',
      });
    } finally {
      setAuthorizingPin(false);
    }
  };

  const handleSimulateAndroidVerify = async () => {
    setTestingHandshake(true);
    try {
      await fetch('/api/mobile/quick-connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceName: 'Android Companion App',
          model: '6-Digit Quick Connect & QR Scanner',
          code: quickConnectCode,
          token: tempToken,
        }),
      });
      await fetchPairInfo();
    } finally {
      setTestingHandshake(false);
    }
  };

  const pairedDevices = pairInfo?.pairedDevices || [];
  const pendingPhoneRequests = pairInfo?.pendingPhoneRequests || [];

  return (
    <div className="space-y-5">
      {/* Main Grid: Left (QR Code + 6-Digit Quick Connect Code) + Right (Detected URL + Instructions) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: High-Contrast QR Code + Jellyfin-Style 6-Digit Quick Connect Code */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center rounded-2xl border-2 border-[#00ff66]/50 bg-zinc-950/90 p-5 space-y-4 shadow-xl">
          {/* JELLYFIN-STYLE 6-DIGIT QUICK CONNECT PIN BANNER */}
          <div className="w-full rounded-2xl border-2 border-purple-500/60 bg-purple-950/30 p-4 text-center space-y-2 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider text-purple-300">
                <Hash className="w-3.5 h-3.5 text-[#00ff66]" />
                <span>6-Digit Quick Connect Code</span>
              </span>
              {pairInfo?.expiresInSeconds !== undefined && (
                <span className="rounded bg-zinc-900/90 px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                  Valid {Math.ceil(pairInfo.expiresInSeconds / 60)}m
                </span>
              )}
            </div>

            <div
              data-testid="android-quick-connect-6digit-code"
              className="py-2 px-3 rounded-xl bg-zinc-950/90 border border-purple-500/40 text-3xl sm:text-4xl font-mono font-extrabold tracking-[0.25em] text-[#00ff66] select-all"
            >
              {quickConnectFormatted}
            </div>

            <p className="text-[11px] font-mono text-zinc-300">
              Enter your Server URL + these <strong>6 numbers</strong> in the
              Android app, OR scan the QR code below!
            </p>

            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleCopy('qc-pin', quickConnectCode)}
                data-testid="copy-6digit-code-btn"
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 px-3 py-2 text-xs font-mono font-bold text-white transition-colors"
              >
                {copiedKey === 'qc-pin' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied {quickConnectFormatted}!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy 6-Digit Code</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleRegenerateToken}
                disabled={regeneratingKey}
                title="Generate a fresh 6-digit Quick Connect code"
                className="inline-flex items-center justify-center gap-1 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-[#00ff66] px-3 py-2 text-xs font-mono font-semibold text-zinc-200 transition-colors"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    regeneratingKey ? 'animate-spin' : ''
                  }`}
                />
                <span>New Code</span>
              </button>
            </div>
          </div>

          {/* High-Contrast Scannable QR Code */}
          <div className="rounded-2xl bg-white p-3.5 shadow-2xl border-4 border-[#00ff66]">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Connect Android App High-Contrast QR Code"
                data-testid="android-qr-code-img"
                className="w-52 h-52 sm:w-60 sm:h-60 object-contain"
              />
            ) : (
              <div className="w-52 h-52 sm:w-60 sm:h-60 flex items-center justify-center text-zinc-900">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
            )}
          </div>

          <div className="w-full space-y-1 text-center">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[#00ff66]/15 border border-[#00ff66]/40 px-3 py-1 text-xs font-mono font-bold text-[#00ff66]">
              <Camera className="w-3.5 h-3.5" />
              <span>Or Scan QR with Android Camera</span>
            </div>
            <p className="text-[11px] font-mono text-zinc-400">
              Encodes <code className="text-white">{activeServerUrl}</code> +
              6-Digit Code <code className="text-[#00ff66]">{quickConnectFormatted}</code>
            </p>
          </div>

          {/* Primary Copy Server URL Button right beneath QR Code */}
          <div className="w-full flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => handleCopy('server-url', activeServerUrl)}
              data-testid="copy-server-url-btn"
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[42px] shadow-lg"
            >
              {copiedKey === 'server-url' ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Copied Server URL!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy Server URL</span>
                </>
              )}
            </button>

            {!isModal && onOpenPopupModal && (
              <button
                type="button"
                onClick={onOpenPopupModal}
                data-testid="open-qr-popup-btn"
                title="Open QR Code in Fullscreen Popup"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-[#00ff66]/50 hover:text-[#00ff66] px-3.5 py-2.5 text-xs font-mono font-semibold text-zinc-200 transition-colors min-h-[42px]"
              >
                <Maximize2 className="w-4 h-4" />
                <span>Popup</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Column: Auto-Detected Browser URL, Server URL Config, & Reverse Quick Connect Authorization */}
        <div className="lg:col-span-7 space-y-4">
          {/* Server URL Encoded in QR Code & Auto-Detected Current Connection URL */}
          <div className="rounded-2xl border-2 border-[#00ff66]/40 bg-zinc-950/90 p-4 space-y-3.5 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs sm:text-sm font-mono font-bold uppercase text-[#00ff66] flex items-center gap-2">
                <Globe className="w-4 h-4" />
                <span>Server URL Encoded in QR Code &amp; Quick Connect</span>
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setUrlMode('origin');
                    setCustomServerUrl(detectedCurrentUrl);
                  }}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-mono font-bold flex items-center gap-1 transition-colors ${
                    urlMode === 'origin'
                      ? 'border-[#00ff66] bg-[#00ff66]/15 text-[#00ff66]'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                  }`}
                >
                  <Globe className="w-3 h-3" />
                  <span>Current Browser URL</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUrlMode('lan')}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-mono font-bold flex items-center gap-1 transition-colors ${
                    urlMode === 'lan'
                      ? 'border-[#00ff66] bg-[#00ff66]/15 text-[#00ff66]'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                  }`}
                >
                  <Wifi className="w-3 h-3" />
                  <span>Local LAN IP</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUrlMode('custom')}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-mono font-bold flex items-center gap-1 transition-colors ${
                    urlMode === 'custom'
                      ? 'border-[#00ff66] bg-[#00ff66]/15 text-[#00ff66]'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                  }`}
                >
                  <Code2 className="w-3 h-3" />
                  <span>Custom URL</span>
                </button>
              </div>
            </div>

            {/* Auto-Detected URL Currently Being Used to Connect */}
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5 text-[#00ff66] shrink-0" />
                  <span>
                    URL You Are Currently Connected To (Auto-Detected):
                  </span>
                </div>
                <div
                  data-testid="detected-current-browser-url"
                  className="text-sm font-bold text-white truncate mt-0.5 select-all"
                >
                  {detectedCurrentUrl}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setUrlMode('origin');
                    setCustomServerUrl(detectedCurrentUrl);
                  }}
                  className="rounded-lg border border-[#00ff66]/50 bg-[#00ff66]/15 hover:bg-[#00ff66]/25 px-2.5 py-1.5 text-[11px] font-bold text-[#00ff66] transition-colors"
                >
                  Use This URL
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleCopy('detected-url', detectedCurrentUrl)
                  }
                  className="rounded-lg border border-zinc-700 bg-zinc-900 hover:text-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors"
                >
                  {copiedKey === 'detected-url' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Editable Active URL Input + Copy Button */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                type="text"
                value={urlMode === 'custom' ? customServerUrl : activeServerUrl}
                onChange={(e) => {
                  setUrlMode('custom');
                  setCustomServerUrl(e.target.value);
                }}
                placeholder="https://your-brokeify-server.com or http://192.168.1.100:3487"
                data-testid="android-qr-server-url-input"
                className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-xs sm:text-sm font-mono text-white focus:border-[#00ff66] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleCopy('server-url-inline', activeServerUrl)}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-colors whitespace-nowrap min-h-[40px]"
              >
                {copiedKey === 'server-url-inline' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Active URL</span>
                  </>
                )}
              </button>
            </div>

            {/* Live Connection Verification Indicator */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
              <div
                className={`flex items-center gap-1.5 ${
                  urlVerifyState.checking
                    ? 'text-zinc-400'
                    : urlVerifyState.ok
                      ? 'text-[#00ff66]'
                      : 'text-amber-300'
                }`}
              >
                {urlVerifyState.checking && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                <span>{urlVerifyState.message}</span>
              </div>
              <button
                type="button"
                onClick={() => verifyTargetUrlReachability(activeServerUrl)}
                className="text-zinc-400 hover:text-white underline"
              >
                Re-test URL
              </button>
            </div>
          </div>

          {/* Jellyfin-Style Reverse Quick Connect: Type 6-Digit Code from Phone */}
          <div className="rounded-2xl border border-purple-500/40 bg-zinc-950/80 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-purple-400" />
                <h3 className="text-xs sm:text-sm font-mono font-bold uppercase text-white">
                  Authorize 6-Digit Code Shown on Your Phone
                </h3>
              </div>
              <span className="rounded bg-purple-500/20 border border-purple-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-purple-300">
                BROKEIFY 6-DIGIT QUICK CONNECT
              </span>
            </div>

            <p className="text-xs font-mono text-zinc-300 leading-relaxed">
              You can connect either way: type the 6-digit code on the left (
              <strong className="text-[#00ff66]">{quickConnectFormatted}</strong>
              ) into your Android phone, <strong>OR</strong> if your phone shows
              a 6-digit code on its screen, enter it here to authorize your
              phone immediately:
            </p>

            {pendingPhoneRequests.length > 0 && (
              <div className="space-y-2">
                {pendingPhoneRequests.map((reqItem) => (
                  <div
                    key={reqItem.code}
                    className="rounded-xl border border-[#00ff66]/50 bg-emerald-950/30 p-3 flex flex-wrap items-center justify-between gap-2 text-xs font-mono"
                  >
                    <div>
                      <span className="text-[#00ff66] font-bold">
                        📲 Phone Request Waiting: {reqItem.deviceName}
                      </span>
                      <span className="text-zinc-400 ml-2">
                        (Code: <strong>{reqItem.formattedCode}</strong> · IP:{' '}
                        {reqItem.clientIp})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAuthorizePhoneCode(reqItem.code)}
                      className="rounded-lg bg-[#00ff66] hover:bg-emerald-400 px-3 py-1.5 text-xs font-bold text-zinc-950"
                    >
                      Approve {reqItem.formattedCode}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAuthorizePhoneCode();
              }}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
            >
              <input
                type="text"
                inputMode="numeric"
                maxLength={7}
                value={phonePinInput}
                onChange={(e) => setPhonePinInput(e.target.value)}
                placeholder="Enter 6-digit code (e.g. 482 915)"
                data-testid="quick-connect-authorize-input"
                className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm font-mono font-bold tracking-widest text-white placeholder:font-normal placeholder:tracking-normal focus:border-purple-400 focus:outline-none"
              />
              <button
                type="submit"
                disabled={authorizingPin}
                data-testid="quick-connect-authorize-btn"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-4 py-2.5 text-xs font-mono font-bold text-white transition-colors min-h-[40px]"
              >
                {authorizingPin ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                <span>Authorize 6-Digit Code</span>
              </button>
            </form>

            {pinAuthFeedback && (
              <div
                className={`rounded-xl border px-3 py-2 text-xs font-mono ${
                  pinAuthFeedback.ok
                    ? 'border-emerald-500/40 bg-emerald-950/30 text-[#00ff66]'
                    : 'border-rose-500/40 bg-rose-950/30 text-rose-300'
                }`}
              >
                {pinAuthFeedback.message}
              </div>
            )}
          </div>

          {/* Quick 2-Step Instructions */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-2">
              <h3 className="text-xs font-mono font-bold uppercase text-[#00ff66] flex items-center gap-2">
                <Smartphone className="w-4 h-4" />
                <span>2 Easy Ways to Connect Your Android Phone</span>
              </h3>
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <KeyRound className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-zinc-400">Token:</span>
                <code
                  data-testid="android-temp-token-value"
                  className="text-[#00ff66]"
                >
                  {tempToken.slice(0, 14)}…
                </code>
              </div>
            </div>

            <ol className="text-xs text-zinc-200 space-y-1.5 list-decimal list-inside font-mono leading-relaxed">
              <li>
                <strong>Method 1 — 6-Digit Quick Connect:</strong> Open the{' '}
                <a
                  href="https://github.com/Mr-Nickey/brokeify-android"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#00ff66] underline hover:text-emerald-300 font-bold"
                >
                  Brokeify Android App
                </a>
                , paste your Server URL (
                <code className="text-white">{activeServerUrl}</code>), and type
                the 6-digit code{' '}
                <strong className="text-[#00ff66]">
                  {quickConnectFormatted}
                </strong>
                .
              </li>
              <li>
                <strong>Method 2 — Camera QR Scan:</strong> Tap{' '}
                <strong>Scan QR Code 📷</strong> in the Android app and point
                your camera at the QR code on the left — zero typing required!
              </li>
            </ol>
          </div>
        </div>
      </div>

      {/* Live Connected Android Devices + JSON Payload Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Connected Android Devices Status Box */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-white">
                <CheckCircle2
                  className={`w-4 h-4 ${
                    pairedDevices.length > 0
                      ? 'text-[#00ff66]'
                      : 'text-zinc-500'
                  }`}
                />
                <span>
                  {pairedDevices.length > 0
                    ? `Linked Android Devices (${pairedDevices.length})`
                    : 'Waiting for 6-Digit Quick Connect or QR Scan...'}
                </span>
              </div>

              <button
                type="button"
                onClick={handleSimulateAndroidVerify}
                disabled={testingHandshake}
                data-testid="test-android-handshake-btn"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#00ff66]/40 bg-[#00ff66]/10 hover:bg-[#00ff66]/20 px-3 py-1 text-[11px] font-mono font-bold text-[#00ff66] transition-colors"
              >
                {testingHandshake ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Smartphone className="w-3 h-3" />
                )}
                <span>Test 6-Digit Handshake</span>
              </button>
            </div>

            {pairedDevices.length > 0 ? (
              <div className="space-y-2 pt-1">
                {pairedDevices.map((dev) => (
                  <div
                    key={dev.id}
                    className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 px-3.5 py-2 text-xs font-mono flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-[#00ff66] truncate">
                        📱 {dev.deviceName}
                      </div>
                      <div className="text-[11px] text-zinc-400 truncate">
                        IP: {dev.clientIp} ·{' '}
                        {new Date(dev.connectedAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <span className="rounded bg-[#00ff66]/20 px-2 py-0.5 text-[10px] font-bold text-[#00ff66]">
                      {dev.method === 'quick-connect-6digit'
                        ? '6-DIGIT PIN'
                        : 'LINKED'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs font-mono text-zinc-400 leading-relaxed">
                As soon as your Android phone connects using the 6-digit Quick
                Connect code or QR scanner, it will appear here.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80 text-[11px] font-mono text-zinc-400">
            <span>Payload Mode:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPayloadFormat('json')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  payloadFormat === 'json'
                    ? 'bg-[#00ff66] text-zinc-950'
                    : 'bg-zinc-900 text-zinc-400'
                }`}
              >
                JSON
              </button>
              <button
                type="button"
                onClick={() => setPayloadFormat('deeplink')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  payloadFormat === 'deeplink'
                    ? 'bg-[#00ff66] text-zinc-950'
                    : 'bg-zinc-900 text-zinc-400'
                }`}
              >
                brokeify://
              </button>
            </div>
          </div>
        </div>

        {/* Exact JSON Payload Encoded in the QR Code */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-mono font-bold uppercase text-cyan-300">
              Encoded QR &amp; Quick Connect Payload
            </span>
            <button
              type="button"
              onClick={() => handleCopy('payload', qrPayloadString)}
              data-testid="copy-qr-json-payload-btn"
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 px-2.5 py-1 text-[11px] font-mono font-bold text-cyan-300"
            >
              {copiedKey === 'payload' ? (
                <>
                  <Check className="w-3 h-3" />
                  <span>Copied JSON!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy JSON Payload</span>
                </>
              )}
            </button>
          </div>
          <pre
            data-testid="qr-json-payload-preview"
            className="rounded-xl border border-zinc-800 bg-black/80 p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-40 leading-relaxed"
          >
            {payloadFormat === 'json'
              ? JSON.stringify(JSON.parse(qrPayloadString), null, 2)
              : qrPayloadString}
          </pre>
        </div>
      </div>

      {isModal && onClose && (
        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-5 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-colors"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
};

export const AndroidPwaInstallCard: React.FC<{ compact?: boolean }> = ({
  compact = false,
}) => {
  const {
    canInstallPrompt,
    isInstalled,
    isAndroid,
    isIOS,
    triggerNativeInstall,
  } = usePWAInstall();
  const [showManualSteps, setShowManualSteps] = useState<boolean>(false);
  const [showLanHttpTip, setShowLanHttpTip] = useState<boolean>(false);
  const [installFeedback, setInstallFeedback] = useState<string | null>(null);
  const [copiedFlag, setCopiedFlag] = useState<boolean>(false);
  const [copiedOrigin, setCopiedOrigin] = useState<boolean>(false);

  const currentOrigin =
    typeof window !== 'undefined'
      ? window.location.origin.replace(/\/+$/, '')
      : 'http://localhost:3487';

  const isInsecureLanIp = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.location.protocol === 'http:' &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    );
  }, []);

  const handleInstallClick = async () => {
    if (canInstallPrompt) {
      const outcome = await triggerNativeInstall();
      if (outcome === 'accepted') {
        setInstallFeedback(
          '✅ Brokeify is installing to your Android Home Screen & App Drawer!'
        );
        return;
      }
      if (outcome === 'dismissed') {
        setInstallFeedback(
          'Install prompt dismissed — you can tap Install again anytime or use Chrome’s ⋮ menu → Install app.'
        );
        return;
      }
    }
    setShowManualSteps((prev) => !prev);
  };

  const handleCopyOrigin = async () => {
    try {
      await navigator.clipboard.writeText(currentOrigin);
      setCopiedOrigin(true);
      setTimeout(() => setCopiedOrigin(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleCopyChromeFlag = async () => {
    try {
      await navigator.clipboard.writeText(
        'chrome://flags/#unsafely-treat-insecure-origin-as-secure'
      );
      setCopiedFlag(true);
      setTimeout(() => setCopiedFlag(false), 2500);
    } catch {
      // ignore
    }
  };

  return (
    <div
      data-testid="android-pwa-install-card"
      className={`rounded-2xl border-2 ${
        isInstalled
          ? 'border-emerald-500/60 bg-emerald-950/25'
          : 'border-[#00ff66]/70 bg-gradient-to-br from-emerald-950/40 via-zinc-950 to-zinc-900'
      } ${compact ? 'p-3.5 space-y-3' : 'p-4 sm:p-5 space-y-4'} shadow-xl`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#00ff66] px-2.5 py-0.5 text-[10px] font-mono font-extrabold uppercase text-zinc-950">
              <Smartphone className="w-3.5 h-3.5" />
              <span>Android Phone PWA</span>
            </span>
            {isInstalled ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66]">
                <CheckCircle2 className="w-3 h-3" />
                <span>Installed Full-Screen App</span>
              </span>
            ) : canInstallPrompt ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66] animate-pulse">
                <Sparkles className="w-3 h-3" />
                <span>Ready for 1-Tap Install</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[10px] font-mono text-zinc-300">
                <span>One-Handed Mobile Player + Lock-Screen Controls</span>
              </span>
            )}
          </div>
          <h4 className="text-sm sm:text-base font-bold text-white font-mono">
            {isInstalled
              ? 'Brokeify is running as an Installed Android App'
              : 'Install Brokeify Directly on Your Android Phone (No Store Needed)'}
          </h4>
          <p className="text-xs text-zinc-300 leading-relaxed">
            Install the Web App (PWA) for a native full-screen Android music player with{' '}
            <strong className="text-[#00ff66]">one-handed bottom thumb navigation</strong>,{' '}
            <strong className="text-white">Bluetooth / lock-screen controls</strong>, and{' '}
            <strong className="text-white">Offline Road-Trip Vault</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!isInstalled && (
            <button
              type="button"
              onClick={handleInstallClick}
              data-testid="pwa-native-install-btn"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-3 text-xs sm:text-sm font-mono font-extrabold text-zinc-950 shadow-[0_0_20px_rgba(0,255,102,0.35)] transition-all active:scale-95 min-h-[46px]"
            >
              <Download className="w-4 h-4 stroke-[2.5]" />
              <span>
                {canInstallPrompt
                  ? '1-Tap Install on Android'
                  : isAndroid
                    ? 'Install on This Android Phone'
                    : isIOS
                      ? 'How to Add to iPhone Home Screen'
                      : 'Android Phone Install Steps'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowManualSteps((prev) => !prev)}
            data-testid="pwa-toggle-manual-guide-btn"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900/90 hover:bg-zinc-800 px-3 py-2.5 text-xs font-mono font-semibold text-zinc-200 transition-colors min-h-[44px]"
          >
            <span>{showManualSteps ? 'Hide Guide' : 'Chrome Install Guide'}</span>
            {showManualSteps ? (
              <ChevronUp className="w-4 h-4 text-[#00ff66]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[#00ff66]" />
            )}
          </button>
        </div>
      </div>

      {installFeedback && (
        <div className="rounded-xl border border-[#00ff66]/50 bg-emerald-950/40 px-3.5 py-2.5 text-xs font-mono text-[#00ff66]">
          {installFeedback}
        </div>
      )}

      {(showManualSteps || (!canInstallPrompt && isAndroid && !isInstalled)) && (
        <div
          data-testid="pwa-android-manual-steps"
          className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-3.5 sm:p-4 space-y-3"
        >
          {isIOS ? (
            <div className="space-y-2 text-xs font-mono text-zinc-200">
              <div className="text-[#00ff66] font-bold uppercase tracking-wider">
                iPhone / iPad Safari Home Screen Install:
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-zinc-300">
                <li>
                  Open <strong className="text-white">{currentOrigin}</strong> in{' '}
                  <strong>Safari</strong>.
                </li>
                <li>
                  Tap the <Share className="w-3.5 h-3.5 inline text-sky-400 mx-0.5" />{' '}
                  <strong>Share</strong> button on the bottom bar.
                </li>
                <li>
                  Scroll down and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong>.
                </li>
              </ol>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-mono font-bold uppercase tracking-wider text-[#00ff66]">
                  3-Step Android Chrome Install (Works on Pixel, Samsung, OnePlus, etc.)
                </div>
                <button
                  type="button"
                  onClick={handleCopyOrigin}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-2.5 py-1 text-[11px] font-mono text-[#00ff66]"
                >
                  {copiedOrigin ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copied URL!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Server URL</span>
                    </>
                  )}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
                <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/70 p-3 space-y-1">
                  <div className="text-[10px] font-bold uppercase text-[#00ff66]">
                    Step 1 · Open in Chrome
                  </div>
                  <p className="text-zinc-200 leading-snug">
                    Open <strong className="text-white break-all">{currentOrigin}</strong> in{' '}
                    <strong>Google Chrome</strong> on your Android phone.
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/70 p-3 space-y-1">
                  <div className="text-[10px] font-bold uppercase text-[#00ff66]">
                    Step 2 · Tap Chrome ⋮ Menu
                  </div>
                  <p className="text-zinc-200 leading-snug">
                    Tap the{' '}
                    <span className="inline-flex items-center px-1 py-0.5 rounded bg-zinc-800 text-white">
                      <MoreVertical className="w-3 h-3" />
                    </span>{' '}
                    <strong>3-dots menu</strong> in Chrome&rsquo;s top-right corner.
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/70 p-3 space-y-1">
                  <div className="text-[10px] font-bold uppercase text-[#00ff66]">
                    Step 3 · Tap &ldquo;Install App&rdquo;
                  </div>
                  <p className="text-zinc-200 leading-snug">
                    Tap <strong className="text-[#00ff66]">&ldquo;Install app&rdquo;</strong> or{' '}
                    <strong className="text-white">&ldquo;Add to Home screen&rdquo;</strong> to pin Brokeify to your app drawer.
                  </p>
                </div>
              </div>

              {/* Helpful Self-Hosted HTTP LAN IP Tip for Android Chrome */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowLanHttpTip((prev) => !prev)}
                  className="text-[11px] font-mono text-amber-300 hover:text-amber-200 inline-flex items-center gap-1"
                >
                  <span>
                    💡 Using a local HTTP LAN IP (e.g. http://192.168.1.x:3487) without HTTPS?
                  </span>
                  {showLanHttpTip ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {(showLanHttpTip || isInsecureLanIp) && (
                  <div className="mt-2 rounded-xl border border-amber-500/40 bg-amber-950/25 p-3 text-[11px] font-mono text-amber-100 space-y-2">
                    <p>
                      Android Chrome normally requires HTTPS for full PWA installation, or you can whitelist your local server URL in 10 seconds:
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-black/70 px-2 py-1 text-amber-300 break-all">
                        chrome://flags/#unsafely-treat-insecure-origin-as-secure
                      </code>
                      <button
                        type="button"
                        onClick={handleCopyChromeFlag}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-400 hover:bg-amber-300 px-2.5 py-1 text-[11px] font-bold text-zinc-950"
                      >
                        {copiedFlag ? (
                          <>
                            <Check className="w-3 h-3" />
                            <span>Copied Flag URL</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Chrome Flag</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-zinc-300">
                      Paste that into Android Chrome, add{' '}
                      <strong className="text-white">{currentOrigin}</strong>, set to{' '}
                      <strong>Enabled</strong>, and tap <strong>Relaunch</strong> — Android Chrome will then offer 1-tap native PWA install!
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface AndroidQrPairingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AndroidQrPairingModal: React.FC<AndroidQrPairingModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="android-qr-modal-title"
      data-testid="android-qr-pairing-modal"
    >
      <div className="w-full max-w-4xl winamp-bezel rounded-3xl border-2 border-[#00ff66]/50 bg-zinc-950 overflow-hidden shadow-2xl my-auto text-left">
        <div className="winamp-titlebar px-5 py-3.5 flex items-center justify-between border-b border-zinc-700/80">
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-5 h-5 text-[#00ff66]" />
            <h3
              id="android-qr-modal-title"
              className="text-xs sm:text-sm font-mono font-bold uppercase tracking-wider text-white"
            >
              INSTALL ANDROID PHONE APP (PWA) // 6-DIGIT QUICK CONNECT &amp; QR PAIRING
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Connect Android App Modal"
            data-testid="close-android-qr-modal-btn"
            className="rounded-lg p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-6 max-h-[85vh] overflow-y-auto space-y-5">
          <AndroidPwaInstallCard />
          <AndroidQrPairingPanel isModal={true} onClose={onClose} />
        </div>
      </div>
    </div>
  );
};

export const ConnectAndroidAppSection: React.FC = () => {
  const [showPopup, setShowPopup] = useState(false);

  return (
    <section
      aria-labelledby="connect-android-app-heading"
      data-testid="connect-android-app-section"
      className="rounded-2xl border-2 border-[#00ff66]/50 bg-zinc-900/60 p-5 sm:p-6 space-y-5 shadow-xl"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <QrCode className="w-5 h-5 text-[#00ff66] shrink-0" />
            <h2
              id="connect-android-app-heading"
              className="text-lg sm:text-xl font-bold text-white tracking-tight font-mono"
            >
              Install &amp; Connect Android App
            </h2>
            <span className="rounded-full bg-[#00ff66]/20 border border-[#00ff66]/50 px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase text-[#00ff66]">
              1-Tap Android PWA
            </span>
            <span className="rounded-full bg-purple-500/20 border border-purple-500/40 px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase text-purple-300">
              6-Digit Quick Connect
            </span>
            <span className="rounded-full bg-[#00ff66]/15 border border-[#00ff66]/40 px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase text-[#00ff66]">
              Camera QR Pairing
            </span>
          </div>
          <p className="text-xs sm:text-sm text-zinc-300 max-w-3xl">
            Install Brokeify directly as a full-screen Android PWA or link your phone using the{' '}
            <strong>6-digit Quick Connect code</strong> and high-contrast QR code.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <a
            href="https://github.com/Mr-Nickey/brokeify-android"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="download-android-apk-link"
            className="inline-flex items-center gap-2 rounded-xl border border-purple-500/50 bg-purple-500/15 hover:bg-purple-500/25 px-3.5 py-2 text-xs font-mono font-bold text-purple-300 transition-colors whitespace-nowrap min-h-[40px]"
          >
            <Smartphone className="w-4 h-4" />
            <span>Get Android APK (GitHub)</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <button
            type="button"
            onClick={() => setShowPopup(true)}
            data-testid="open-fullscreen-qr-modal-btn"
            className="inline-flex items-center gap-2 rounded-xl border border-[#00ff66]/50 bg-[#00ff66]/15 hover:bg-[#00ff66]/25 px-4 py-2 text-xs font-mono font-bold text-[#00ff66] transition-colors whitespace-nowrap min-h-[40px]"
          >
            <Maximize2 className="w-4 h-4" />
            <span>Open Fullscreen QR Popup</span>
          </button>
        </div>
      </div>

      <AndroidPwaInstallCard />

      <AndroidQrPairingPanel
        isModal={false}
        onOpenPopupModal={() => setShowPopup(true)}
      />

      <AndroidQrPairingModal
        isOpen={showPopup}
        onClose={() => setShowPopup(false)}
      />
    </section>
  );
};

export const PWAInstallButton: React.FC = () => {
  const [showQrModal, setShowQrModal] = useState(false);
  const { canInstallPrompt, isInstalled } = usePWAInstall();

  return (
    <>
      <button
        type="button"
        onClick={() => setShowQrModal(true)}
        data-testid="navbar-android-qr-btn"
        aria-label="Connect Android App"
        className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-mono font-bold transition-colors whitespace-nowrap shrink-0 min-h-[38px] min-w-[38px] ${
          canInstallPrompt && !isInstalled
            ? 'border-[#00ff66] bg-[#00ff66] text-zinc-950 shadow-[0_0_12px_rgba(0,255,102,0.4)]'
            : 'border-[#00ff66]/50 bg-[#00ff66]/15 hover:bg-[#00ff66]/25 text-[#00ff66]'
        }`}
        title={
          canInstallPrompt
            ? '1-Tap Install Android App (PWA) or Pair via QR Code'
            : 'Install Android App (PWA) & 6-Digit Quick Connect'
        }
      >
        {canInstallPrompt && !isInstalled ? (
          <>
            <Download className="w-4 h-4 stroke-[2.4] shrink-0" />
            <span className="hidden sm:inline">Install App</span>
          </>
        ) : (
          <>
            <QrCode className="w-4 h-4 text-[#00ff66] shrink-0" />
            <span aria-hidden="true" className="text-sm leading-none">
              📲
            </span>
          </>
        )}
      </button>

      <AndroidQrPairingModal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
      />
    </>
  );
};

export const MobilePixelInstallBanner: React.FC = () => {
  const { canInstallPrompt, isInstalled, isAndroid, triggerNativeInstall } =
    usePWAInstall();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('brokeify_pwa_banner_dismissed_v1') === '1';
    } catch {
      return false;
    }
  });
  const [showModal, setShowModal] = useState<boolean>(false);

  if (isInstalled || dismissed) return null;
  if (!canInstallPrompt && !isAndroid) return null;

  const handleInstallNow = async () => {
    if (canInstallPrompt) {
      const res = await triggerNativeInstall();
      if (res === 'accepted') return;
    }
    setShowModal(true);
  };

  return (
    <>
      <div
        data-testid="mobile-pwa-install-banner"
        className="md:hidden rounded-2xl border border-[#00ff66]/50 bg-gradient-to-r from-emerald-950/80 via-zinc-900 to-zinc-950 px-3.5 py-2.5 flex items-center justify-between gap-2.5 shadow-lg"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#00ff66]/15 border border-[#00ff66]/40 flex items-center justify-center shrink-0">
            <Smartphone className="w-4 h-4 text-[#00ff66]" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-mono font-bold text-white truncate">
              Install Brokeify on Android
            </div>
            <div className="text-[10px] font-mono text-zinc-400 truncate">
              Full-screen player · Lock-screen controls
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleInstallNow}
            className="rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3 py-2 text-xs font-mono font-extrabold text-zinc-950 transition-transform active:scale-95 min-h-[38px]"
          >
            Install
          </button>
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              try {
                sessionStorage.setItem('brokeify_pwa_banner_dismissed_v1', '1');
              } catch {
                // ignore
              }
            }}
            aria-label="Dismiss Android Install Banner"
            className="p-2 rounded-lg text-zinc-400 hover:text-white min-h-[38px] min-w-[38px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <AndroidQrPairingModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    </>
  );
};
