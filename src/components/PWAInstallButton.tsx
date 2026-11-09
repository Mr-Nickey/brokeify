import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Camera,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Globe,
  KeyRound,
  Loader2,
  Maximize2,
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

export interface MobilePairInfoResponse {
  ok: boolean;
  app: string;
  version: string;
  serverUrl: string;
  localUrl?: string;
  lanUrl: string;
  port: number;
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
  const [pairInfo, setPairInfo] = useState<MobilePairInfoResponse | null>(null);
  const [customServerUrl, setCustomServerUrl] = useState<string>('');
  const [urlMode, setUrlMode] = useState<'lan' | 'origin' | 'custom'>('lan');
  const [payloadFormat, setPayloadFormat] = useState<QrPayloadFormat>('json');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [regeneratingKey, setRegeneratingKey] = useState<boolean>(false);
  const [testingHandshake, setTestingHandshake] = useState<boolean>(false);

  const browserOrigin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'http://192.168.1.175:3487';

  const fetchPairInfo = async () => {
    try {
      const resp = await fetch('/api/mobile/pair-info');
      if (resp.ok) {
        const data = (await resp.json()) as MobilePairInfoResponse;
        setPairInfo(data);
        if (!customServerUrl) {
          setCustomServerUrl(
            data.localUrl || data.lanUrl || browserOrigin
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

  const activeServerUrl = useMemo(() => {
    if (urlMode === 'lan') {
      return (
        pairInfo?.localUrl ||
        pairInfo?.lanUrl ||
        'http://192.168.1.175:3487'
      ).replace(/\/+$/, '');
    }
    if (urlMode === 'custom') {
      return customServerUrl.trim().replace(/\/+$/, '') || browserOrigin;
    }
    return browserOrigin.replace(/\/+$/, '');
  }, [
    browserOrigin,
    customServerUrl,
    pairInfo?.lanUrl,
    pairInfo?.localUrl,
    urlMode,
  ]);

  const tempToken =
    pairInfo?.tempToken || pairInfo?.token || 'pair_temp_token';

  const qrPayloadString = useMemo(() => {
    const apiKey = pairInfo?.apiKey || 'brk_standalone';
    const localUrl =
      pairInfo?.localUrl || pairInfo?.lanUrl || 'http://192.168.1.175:3487';

    if (payloadFormat === 'deeplink') {
      const params = new URLSearchParams({
        serverUrl: activeServerUrl,
        localUrl,
        token: tempToken,
        key: apiKey,
      });
      return `brokeify://pair?${params.toString()}`;
    }

    return JSON.stringify({
      app: 'brokeify',
      v: 1,
      serverUrl: activeServerUrl,
      localUrl,
      publicUrl: browserOrigin,
      token: tempToken,
      expiresAt: pairInfo?.expiresAt || null,
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
  }, [
    activeServerUrl,
    browserOrigin,
    pairInfo?.apiKey,
    pairInfo?.expiresAt,
    pairInfo?.lanUrl,
    pairInfo?.localUrl,
    payloadFormat,
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

  const handleSimulateAndroidVerify = async () => {
    setTestingHandshake(true);
    try {
      await fetch('/api/mobile/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tempToken}`,
        },
        body: JSON.stringify({
          deviceName: 'Android Companion App',
          model: 'Built-in Camera QR Scanner',
          token: tempToken,
        }),
      });
      await fetchPairInfo();
    } finally {
      setTestingHandshake(false);
    }
  };

  const pairedDevices = pairInfo?.pairedDevices || [];

  return (
    <div className="space-y-5">
      {/* Main Grid: Large High-Contrast QR Code + Controls & Instructions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Large High-Contrast Scannable QR Code */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center rounded-2xl border-2 border-[#00ff66]/50 bg-zinc-950/90 p-5 space-y-4 shadow-xl">
          <div className="rounded-2xl bg-white p-4 shadow-2xl border-4 border-[#00ff66]">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Connect Android App High-Contrast QR Code"
                data-testid="android-qr-code-img"
                className="w-60 h-60 sm:w-68 sm:h-68 object-contain"
              />
            ) : (
              <div className="w-60 h-60 sm:w-68 sm:h-68 flex items-center justify-center text-zinc-900">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
            )}
          </div>

          <div className="w-full space-y-2 text-center">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[#00ff66]/15 border border-[#00ff66]/40 px-3 py-1 text-xs font-mono font-bold text-[#00ff66]">
              <Camera className="w-3.5 h-3.5" />
              <span>Scan with Android App Camera</span>
            </div>
            <p className="text-[11px] font-mono text-zinc-400">
              Encodes Local Server URL + Temporary Connection Token
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

        {/* Right Column: Server URL Config, Temp Token, & Step-by-Step Camera Instructions */}
        <div className="lg:col-span-7 space-y-4">
          {/* Step-by-Step Instructions on how to use the Android App's built-in camera scanner */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
              <h3 className="text-xs sm:text-sm font-mono font-bold uppercase text-[#00ff66] flex items-center gap-2">
                <Camera className="w-4 h-4" />
                <span>
                  How to Link Your Android App Using the Built-In Camera Scanner
                </span>
              </h3>
              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66]">
                ZERO TYPING
              </span>
            </div>

            <ol className="text-xs text-zinc-200 space-y-2 list-decimal list-inside font-mono leading-relaxed">
              <li>
                Open the <strong>Brokeify Android App</strong> on your phone and
                tap <strong>&ldquo;Connect to Docker Server&rdquo;</strong>{' '}
                (or the <strong>Scan QR Code 📷</strong> icon).
              </li>
              <li>
                Point your phone&apos;s built-in camera scanner at the{' '}
                <strong className="text-[#00ff66]">high-contrast QR code</strong>{' '}
                on the left.
              </li>
              <li>
                The camera automatically reads the JSON payload containing your{' '}
                <strong>Local Server URL</strong> (
                <code className="text-white">{activeServerUrl}</code>) and{' '}
                <strong>Temporary Connection Token</strong> (
                <code className="text-[#00ff66]">{tempToken}</code>).
              </li>
              <li>
                Your Android app sends a handshake to{' '}
                <code className="text-[#00ff66]">POST /api/mobile/verify</code>,
                exchanges the temporary token for a persistent session key, and
                immediately syncs your tracks, albums, and playlists for on-the-go
                streaming!
              </li>
            </ol>
          </div>

          {/* Server Local / Public URL Selector */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-mono font-bold uppercase text-zinc-300">
                Server URL Encoded in QR Code
              </label>
              <div className="flex items-center gap-1.5">
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
                  <span>Local LAN URL</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUrlMode('origin')}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-mono font-bold flex items-center gap-1 transition-colors ${
                    urlMode === 'origin'
                      ? 'border-[#00ff66] bg-[#00ff66]/15 text-[#00ff66]'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                  }`}
                >
                  <Globe className="w-3 h-3" />
                  <span>Browser / Domain URL</span>
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
                  <span>Custom</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                type="text"
                value={urlMode === 'custom' ? customServerUrl : activeServerUrl}
                onChange={(e) => {
                  setUrlMode('custom');
                  setCustomServerUrl(e.target.value);
                }}
                placeholder="http://192.168.1.175:3487"
                data-testid="android-qr-server-url-input"
                className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs sm:text-sm font-mono text-white focus:border-[#00ff66] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleCopy('server-url-inline', activeServerUrl)}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#00ff66]/50 bg-[#00ff66]/15 hover:bg-[#00ff66]/25 px-3.5 py-2 text-xs font-mono font-bold text-[#00ff66] transition-colors whitespace-nowrap min-h-[38px]"
              >
                {copiedKey === 'server-url-inline' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Server URL</span>
                  </>
                )}
              </button>
            </div>

            {/* Temporary Connection Token Row */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
              <div className="flex items-center gap-2 min-w-0">
                <KeyRound className="w-4 h-4 text-[#00ff66] shrink-0" />
                <span className="text-zinc-400">Temp Connection Token:</span>
                <code
                  data-testid="android-temp-token-value"
                  className="text-[#00ff66] font-bold truncate"
                >
                  {tempToken}
                </code>
                {pairInfo?.expiresInSeconds !== undefined && (
                  <span className="text-[10px] text-zinc-400">
                    (valid {Math.ceil(pairInfo.expiresInSeconds / 60)}m)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleCopy('temptoken', tempToken)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-300 hover:text-white"
                >
                  {copiedKey === 'temptoken' ? 'Copied!' : 'Copy Token'}
                </button>
                <button
                  type="button"
                  onClick={handleRegenerateToken}
                  disabled={regeneratingKey}
                  data-testid="refresh-temp-token-btn"
                  title="Generate new temporary connection token"
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-300 hover:text-[#00ff66]"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${regeneratingKey ? 'animate-spin' : ''}`}
                  />
                  <span>New Token</span>
                </button>
              </div>
            </div>
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
                    : 'Waiting for Android Camera Scan...'}
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
                <span>Test Camera Handshake</span>
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
                      LINKED
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs font-mono text-zinc-400 leading-relaxed">
                As soon as your Android app scans the QR code and calls{' '}
                <code className="text-white">POST /api/mobile/verify</code>,
                your phone will appear here as linked.
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
              Encoded QR JSON Payload (Android Scanner Schema)
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
            <QrCode className="w-5 h-5 text-[#00ff66]" />
            <h3
              id="android-qr-modal-title"
              className="text-xs sm:text-sm font-mono font-bold uppercase tracking-wider text-white"
            >
              CONNECT ANDROID APP // QR CAMERA SCANNER PAIRING
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Connect Android App Modal"
            data-testid="close-android-qr-modal-btn"
            className="rounded-lg p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6 max-h-[85vh] overflow-y-auto">
          <AndroidQrPairingPanel isModal={true} onClose={onClose} />
        </div>
      </div>
    </div>
  );
};

/**
 * Inline 'Connect Android App' Section for the Settings tab that displays the
 * large, high-contrast QR code, 'Copy Server URL' button, temporary connection token,
 * and step-by-step instructions for the Android app's built-in camera scanner.
 */
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
          <div className="flex items-center gap-2.5">
            <QrCode className="w-5 h-5 text-[#00ff66] shrink-0" />
            <h2
              id="connect-android-app-heading"
              className="text-lg sm:text-xl font-bold text-white tracking-tight font-mono"
            >
              Connect Android App
            </h2>
            <span className="rounded-full bg-[#00ff66]/15 border border-[#00ff66]/40 px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase text-[#00ff66]">
              Camera QR Pairing
            </span>
          </div>
          <p className="text-xs sm:text-sm text-zinc-300 max-w-3xl">
            Scan this high-contrast QR code using your Brokeify Android
            app&apos;s built-in camera scanner to link your phone to this Docker
            server and stream your library on the go.
          </p>
        </div>

        <div className="shrink-0">
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

export const MobilePixelInstallBanner: React.FC = () => {
  return null;
};
