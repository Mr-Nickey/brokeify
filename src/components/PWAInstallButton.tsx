import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Globe,
  KeyRound,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
  Wifi,
  X,
} from 'lucide-react';

export interface PairedAndroidDevice {
  id: string;
  deviceName: string;
  model: string;
  clientIp: string;
  connectedAt: string;
}

interface MobilePairInfoResponse {
  ok: boolean;
  app: string;
  version: string;
  serverUrl: string;
  lanUrl: string;
  port: number;
  apiKey: string;
  libraryStats?: {
    totalTracks: number;
    totalAlbums: number;
    totalArtists: number;
    totalPlaylists: number;
  };
  pairedDevices?: PairedAndroidDevice[];
}

type QrPayloadFormat = 'json' | 'deeplink';

interface AndroidQrPairingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AndroidQrPairingModal: React.FC<AndroidQrPairingModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [pairInfo, setPairInfo] = useState<MobilePairInfoResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [customServerUrl, setCustomServerUrl] = useState<string>('');
  const [urlMode, setUrlMode] = useState<'origin' | 'lan' | 'custom'>('origin');
  const [payloadFormat, setPayloadFormat] = useState<QrPayloadFormat>('json');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [regeneratingKey, setRegeneratingKey] = useState<boolean>(false);
  const [testingHandshake, setTestingHandshake] = useState<boolean>(false);

  const browserOrigin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'http://192.168.1.175:3487';

  const fetchPairInfo = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const resp = await fetch('/api/mobile/pair-info');
      if (resp.ok) {
        const data = (await resp.json()) as MobilePairInfoResponse;
        setPairInfo(data);
        if (!customServerUrl) {
          setCustomServerUrl(browserOrigin);
        }
      }
    } catch {
      // ignore
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchPairInfo(false);
    const interval = setInterval(() => {
      fetchPairInfo(true);
    }, 3000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const activeServerUrl = useMemo(() => {
    if (urlMode === 'lan') {
      return pairInfo?.lanUrl || 'http://192.168.1.175:3487';
    }
    if (urlMode === 'custom') {
      return customServerUrl.trim().replace(/\/+$/, '') || browserOrigin;
    }
    return browserOrigin.replace(/\/+$/, '');
  }, [browserOrigin, customServerUrl, pairInfo?.lanUrl, urlMode]);

  const qrPayloadString = useMemo(() => {
    const apiKey = pairInfo?.apiKey || 'brk_standalone';
    const lanUrl = pairInfo?.lanUrl || 'http://192.168.1.175:3487';

    if (payloadFormat === 'deeplink') {
      const params = new URLSearchParams({
        url: activeServerUrl,
        lan: lanUrl,
        key: apiKey,
      });
      return `brokeify://pair?${params.toString()}`;
    }

    return JSON.stringify({
      app: 'brokeify',
      v: 1,
      url: activeServerUrl,
      lanUrl,
      apiKey,
      endpoints: {
        verify: '/api/mobile/verify',
        tracks: '/api/library/tracks',
        albums: '/api/library/albums',
        artists: '/api/library/artists',
        playlists: '/api/playlists',
        stream: '/api/stream/{trackId}',
        cover: '/api/covers/{albumId}',
        scrobble: '/api/scrobble',
      },
    });
  }, [activeServerUrl, pairInfo?.apiKey, pairInfo?.lanUrl, payloadFormat]);

  useEffect(() => {
    if (!isOpen || !qrPayloadString) return;
    let cancelled = false;
    QRCode.toDataURL(qrPayloadString, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: {
        dark: '#070a0f',
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
  }, [isOpen, qrPayloadString]);

  if (!isOpen) return null;

  const handleCopy = (key: string, value: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2200);
  };

  const handleRegenerateToken = async () => {
    setRegeneratingKey(true);
    try {
      const resp = await fetch('/api/mobile/regenerate-token', {
        method: 'POST',
      });
      if (resp.ok) {
        await fetchPairInfo(true);
      }
    } finally {
      setRegeneratingKey(false);
    }
  };

  const handleSimulateAndroidVerify = async () => {
    setTestingHandshake(true);
    try {
      await fetch('/api/mobile/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pairInfo?.apiKey || ''}`,
        },
        body: JSON.stringify({
          deviceName: 'Android Pixel Companion (Test)',
          model: 'Android Camera QR Handshake',
          apiKey: pairInfo?.apiKey,
        }),
      });
      await fetchPairInfo(true);
    } finally {
      setTestingHandshake(false);
    }
  };

  const pairedDevices = pairInfo?.pairedDevices || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="android-qr-modal-title"
      data-testid="android-qr-pairing-modal"
    >
      <div className="w-full max-w-3xl winamp-bezel rounded-3xl border-2 border-[#00ff66]/50 bg-zinc-950 overflow-hidden shadow-2xl my-auto text-left">
        {/* Header Bar */}
        <div className="winamp-titlebar px-5 py-3.5 flex items-center justify-between border-b border-zinc-700/80">
          <div className="flex items-center gap-2.5">
            <QrCode className="w-5 h-5 text-[#00ff66]" />
            <h3
              id="android-qr-modal-title"
              className="text-xs sm:text-sm font-mono font-bold uppercase tracking-wider text-white"
            >
              BROKEIFY ANDROID APP // QR CAMERA PAIRING &amp; ON-THE-GO STREAMING
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Android QR Pairing Modal"
            data-testid="close-android-qr-modal-btn"
            className="rounded-lg p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5 max-h-[85vh] overflow-y-auto">
          {/* Top Grid: Left = Scannable QR Code, Right = URL Selector & Live Status */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
            {/* Scannable High-Contrast QR Code Card */}
            <div className="md:col-span-5 flex flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3">
              <div className="rounded-2xl bg-white p-3 shadow-xl border-4 border-[#00ff66]">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Brokeify Android App Pairing QR Code"
                    data-testid="android-qr-code-img"
                    className="w-56 h-56 sm:w-64 sm:h-64 object-contain"
                  />
                ) : (
                  <div className="w-56 h-56 sm:w-64 sm:h-64 flex items-center justify-center text-zinc-900">
                    <Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                )}
              </div>

              <div className="text-center space-y-0.5">
                <div className="text-xs font-mono font-bold text-[#00ff66]">
                  Scan with Brokeify Android App Camera
                </div>
                <div className="text-[11px] font-mono text-zinc-400">
                  {pairInfo?.libraryStats?.totalTracks ?? 0} tracks ·{' '}
                  {pairInfo?.libraryStats?.totalAlbums ?? 0} albums ready to
                  stream
                </div>
              </div>
            </div>

            {/* Connection URL Mode & Format Controls */}
            <div className="md:col-span-7 space-y-4">
              <div className="space-y-1">
                <h4 className="text-sm sm:text-base font-bold text-white font-mono flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-[#00ff66]" />
                  <span>Instant Android Camera Pairing</span>
                </h4>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  Point your custom Android app&apos;s camera at this QR code. It
                  contains your server URL, local LAN fallback, API key, and
                  HTTP 206 streaming endpoints so you can play music on the go
                  with zero typing.
                </p>
              </div>

              {/* 1. Choose Server Address Encoded in QR */}
              <div className="space-y-2">
                <label className="block text-xs font-mono font-bold uppercase text-zinc-300">
                  1. Server Address for Your Phone
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setUrlMode('origin')}
                    className={`rounded-xl border px-3 py-2 text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-colors ${
                      urlMode === 'origin'
                        ? 'border-[#00ff66] bg-[#00ff66]/15 text-[#00ff66]'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5 shrink-0" />
                    <span>Current URL</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUrlMode('lan')}
                    className={`rounded-xl border px-3 py-2 text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-colors ${
                      urlMode === 'lan'
                        ? 'border-[#00ff66] bg-[#00ff66]/15 text-[#00ff66]'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <Wifi className="w-3.5 h-3.5 shrink-0" />
                    <span>Home LAN IP</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUrlMode('custom')}
                    className={`rounded-xl border px-3 py-2 text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-colors ${
                      urlMode === 'custom'
                        ? 'border-[#00ff66] bg-[#00ff66]/15 text-[#00ff66]'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Custom Domain</span>
                  </button>
                </div>

                <input
                  type="text"
                  value={
                    urlMode === 'custom' ? customServerUrl : activeServerUrl
                  }
                  onChange={(e) => {
                    setUrlMode('custom');
                    setCustomServerUrl(e.target.value);
                  }}
                  placeholder="https://music.flockingreeds.farm or http://192.168.1.175:3487"
                  data-testid="android-qr-server-url-input"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs sm:text-sm font-mono text-white focus:border-[#00ff66] focus:outline-none"
                />
              </div>

              {/* 2. Choose QR Format (JSON vs Deep Link URI) */}
              <div className="space-y-2">
                <label className="block text-xs font-mono font-bold uppercase text-zinc-300">
                  2. QR Payload Format for Your Android Scanner
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayloadFormat('json')}
                    className={`rounded-xl border px-3 py-2 text-xs font-mono font-bold transition-colors ${
                      payloadFormat === 'json'
                        ? 'border-[#00ff66] bg-[#00ff66] text-zinc-950'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white'
                    }`}
                  >
                    JSON Object (Recommended)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayloadFormat('deeplink')}
                    className={`rounded-xl border px-3 py-2 text-xs font-mono font-bold transition-colors ${
                      payloadFormat === 'deeplink'
                        ? 'border-[#00ff66] bg-[#00ff66] text-zinc-950'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white'
                    }`}
                  >
                    Deep Link (brokeify://pair)
                  </button>
                </div>
              </div>

              {/* API Key + Rotate */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                <div className="flex items-center gap-2 min-w-0">
                  <KeyRound className="w-4 h-4 text-[#00ff66] shrink-0" />
                  <span className="text-zinc-400">API Key:</span>
                  <code className="text-white truncate">
                    {pairInfo?.apiKey || 'Loading...'}
                  </code>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy('apikey', pairInfo?.apiKey || '')
                    }
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-300 hover:text-white"
                  >
                    {copiedKey === 'apikey' ? 'Copied!' : 'Copy Key'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerateToken}
                    disabled={regeneratingKey}
                    title="Generate new API key"
                    className="rounded-lg border border-zinc-700 bg-zinc-950 p-1.5 text-zinc-400 hover:text-[#00ff66]"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${regeneratingKey ? 'animate-spin' : ''}`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Live Connected Android Devices Status Box */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
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
                    ? `Connected Android Devices (${pairedDevices.length})`
                    : 'Waiting for Android App Camera Scan (GET/POST /api/mobile/verify)...'}
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
                <span>Test /api/mobile/verify Handshake</span>
              </button>
            </div>

            {pairedDevices.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {pairedDevices.map((dev) => (
                  <div
                    key={dev.id}
                    className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 px-3.5 py-2.5 text-xs font-mono flex items-center justify-between gap-2"
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
                      PAIRED
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Exact QR Payload Preview for Android Studio Camera Parser */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-mono font-bold uppercase text-cyan-300">
                Exact QR Payload Encoded Above (For Your Android Camera Parser)
              </span>
              <button
                type="button"
                onClick={() => handleCopy('payload', qrPayloadString)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 px-2.5 py-1 text-[11px] font-mono font-bold text-cyan-300"
              >
                {copiedKey === 'payload' ? (
                  <>
                    <Check className="w-3 h-3" />
                    <span>Copied Payload!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy QR Payload</span>
                  </>
                )}
              </button>
            </div>
            <pre className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto leading-relaxed">
              {payloadFormat === 'json'
                ? JSON.stringify(JSON.parse(qrPayloadString), null, 2)
                : qrPayloadString}
            </pre>
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-5 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const PWAInstallButton: React.FC = () => {
  const [showQrModal, setShowQrModal] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowQrModal(true)}
        data-testid="navbar-android-qr-btn"
        className="inline-flex items-center gap-1.5 rounded-xl border border-[#00ff66]/50 bg-[#00ff66]/15 hover:bg-[#00ff66]/25 px-3 py-1.5 text-xs font-mono font-bold text-[#00ff66] transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
        title="Scan QR Code with your Brokeify Android App to connect and stream on the go"
      >
        <QrCode className="w-3.5 h-3.5 text-[#00ff66]" />
        <span>📱 Connect Android App</span>
      </button>

      <AndroidQrPairingModal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
      />
    </>
  );
};

/**
 * Removed WebAPK install banner per user request (building native Android app instead).
 */
export const MobilePixelInstallBanner: React.FC = () => {
  return null;
};
