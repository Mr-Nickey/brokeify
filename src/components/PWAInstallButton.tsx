import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Smartphone,
  Terminal,
  X,
} from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
        true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [customDomainUrl, setCustomDomainUrl] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      if (!origin.includes('.run.app')) {
        return origin;
      }
    }
    return '';
  });

  const appOrigin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://brokeify.pages.dev';

  const targetPwaUrl = (customDomainUrl.trim() || appOrigin).replace(/\/+$/, '');
  const bubblewrapCmd = `npx @bubblewrap/cli init --manifest=${targetPwaUrl}/manifest.json && npx @bubblewrap/cli build`;

  const handleCopy = (key: string, value: string) => {
    try {
      navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2200);
    } catch {}
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!isInstalled && isInstallable && (
          <button
            type="button"
            onClick={install}
            data-testid="pwa-direct-install-btn"
            className="inline-flex items-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3.5 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isIOS ? 'Install on iOS' : 'Install on Pixel Now'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowGuide(true)}
          data-testid="open-apk-guide-btn"
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/50 bg-emerald-500/15 hover:bg-emerald-500/25 px-3.5 py-2 text-xs font-mono font-bold text-[#00ff66] transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
          aria-label="Open Android APK and Pixel Phone Install Guide"
        >
          <Smartphone className="w-3.5 h-3.5 text-[#00ff66]" />
          <span>📱 Pixel / Android APK Guide</span>
        </button>
      </div>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-modal-title"
        >
          <div className="w-full max-w-xl winamp-bezel rounded-2xl border border-zinc-700 bg-zinc-950 overflow-hidden shadow-2xl my-auto">
            <div className="winamp-titlebar px-5 py-3.5 flex items-center justify-between border-b border-zinc-700/80">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-4 h-4 text-[#00ff66]" />
                <h3
                  id="pwa-install-modal-title"
                  className="text-xs sm:text-sm font-mono font-bold uppercase tracking-wider text-white"
                >
                  GITHUB + CLOUDFLARE PAGES // PIXEL APK &amp; OFFLINE GUIDE
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close APK install guide"
                className="rounded-lg p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto text-left">
              {/* Why Cloudflare Pages + GitHub works with PWABuilder */}
              <div className="rounded-xl border border-sky-500/40 bg-sky-950/20 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold uppercase text-sky-300">
                    1. Build .APK from GitHub + Cloudflare Pages (PWABuilder)
                  </span>
                  <span className="rounded bg-sky-500/20 px-2 py-0.5 text-[10px] font-mono font-bold text-sky-300">
                    MANIFEST + SW READY
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  Temporary <code className="text-zinc-200">*.run.app</code>{' '}
                  preview links sit behind a preview proxy that blocks external
                  bots like PWABuilder. Once you push this update to{' '}
                  <strong className="text-white">
                    github.com/Mr-Nickey/brokeify
                  </strong>{' '}
                  and Cloudflare Pages deploys it to your custom domain, both{' '}
                  <code className="text-[#00ff66]">/manifest.json</code> and{' '}
                  <code className="text-[#00ff66]">/sw.js</code> are served at
                  the root so PWABuilder scores 100%!
                </p>

                <div className="space-y-1.5 pt-1">
                  <label
                    htmlFor="cf-custom-domain-input"
                    className="block text-[11px] font-mono text-zinc-300"
                  >
                    Your Cloudflare Pages / Custom Domain URL:
                  </label>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      id="cf-custom-domain-input"
                      type="url"
                      value={customDomainUrl}
                      onChange={(e) => setCustomDomainUrl(e.target.value)}
                      placeholder="https://brokeify.yourdomain.com"
                      className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-white placeholder-zinc-500 focus:border-[#00ff66] focus:outline-none"
                    />
                    <a
                      href={`https://www.pwabuilder.com/reportcard?site=${encodeURIComponent(
                        targetPwaUrl
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 px-3.5 py-1.5 text-xs font-mono font-bold text-zinc-950 transition-colors shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open in PWABuilder</span>
                    </a>
                  </div>
                </div>
              </div>

              {/* Method 2: Direct Chrome Install on Pixel from Cloudflare Domain */}
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold uppercase text-[#00ff66]">
                    2. Custom Brokeify Icon + Full Offline Playlist Storage
                  </span>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66]">
                    NO APK REQUIRED FOR STORAGE
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  You <strong className="text-white">do not need an APK</strong>{' '}
                  just to download full playlists offline! Brokeify uses{' '}
                  <code className="text-[#00ff66]">
                    navigator.storage.persist()
                  </code>{' '}
                  + IndexedDB (<code className="text-white">brokeify-offline-vault</code>),
                  which Android grants up to <strong>60% of your Pixel&apos;s free storage</strong>{' '}
                  (tens of gigabytes of FLAC/MP3 playlists).
                </p>
                <ol className="text-xs text-zinc-200 space-y-1 list-decimal list-inside font-mono">
                  <li>
                    Open your <strong>Cloudflare Pages domain</strong> in Chrome
                    on your Pixel phone.
                  </li>
                  <li>
                    Tap <strong>⋮ → Add to Home screen → Install app</strong>{' '}
                    (or install the PWABuilder <code className="text-[#00ff66]">.apk</code>).
                  </li>
                  <li>
                    Android compiles a signed <strong>WebAPK</strong> with the{' '}
                    <strong className="text-[#00ff66]">Brokeify emerald icon</strong>{' '}
                    in your Pixel App Drawer, Home Screen, and lock-screen media
                    player!
                  </li>
                </ol>
              </div>

              {/* Method 3: Local CLI APK Build via Google Bubblewrap */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold uppercase text-purple-300 inline-flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>3. Or Build Signed .APK Locally via Bubblewrap CLI</span>
                  </span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  You can also build a standalone Android APK directly from your{' '}
                  <code className="text-zinc-200">Mr-Nickey/brokeify</code>{' '}
                  Cloudflare Pages deployment in one command:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-[11px] font-mono text-[#00ff66] overflow-x-auto whitespace-nowrap">
                    {bubblewrapCmd}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy('cli', bubblewrapCmd)}
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs font-mono font-bold text-white shrink-0"
                  >
                    {copiedKey === 'cli' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#00ff66]" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-full rounded-xl bg-[#00ff66] hover:bg-emerald-400 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
