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

  const appOrigin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://ais-pre-y4ozpr3ufbp5fpgnflbxfe-456726951426.us-west1.run.app';

  const bubblewrapCmd = `npx @bubblewrap/cli init --manifest=${appOrigin}/manifest.webmanifest && npx @bubblewrap/cli build`;

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
                  INSTALL ON GOOGLE PIXEL // ANDROID APK BUILDER
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
              {/* Method 1: Instant Pixel WebAPK */}
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold uppercase text-[#00ff66]">
                    Method 1: Instant Pixel WebAPK (10 Seconds · Zero Sideloading)
                  </span>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66]">
                    EASIEST
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  On Google Pixel phones, Chrome compiles a real signed Android{' '}
                  <strong className="text-white">WebAPK</strong> directly onto
                  your phone with full app-drawer icon, standalone full-screen,
                  background audio, and Android Auto MediaSession support:
                </p>
                <ol className="text-xs text-zinc-200 space-y-1 list-decimal list-inside font-mono">
                  <li>
                    Open your Shared App URL in <strong>Chrome</strong> on your
                    Pixel phone.
                  </li>
                  <li>
                    Tap the <strong>⋮ (3-dots menu)</strong> in the top-right of
                    Chrome.
                  </li>
                  <li>
                    Tap <strong>&ldquo;Add to Home screen&rdquo; → &ldquo;Install app&rdquo;</strong>.
                  </li>
                </ol>

                <div className="pt-1 flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={appOrigin}
                    aria-label="Brokeify App URL"
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-200"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy('url', appOrigin)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#00ff66] hover:bg-emerald-400 px-3 py-1.5 text-xs font-mono font-bold text-zinc-950 shrink-0"
                  >
                    {copiedKey === 'url' ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy URL</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Method 2: PWABuilder Standalone .APK File */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold uppercase text-sky-400">
                    Method 2: Download a Standalone .APK File (PWABuilder · 60 Sec)
                  </span>
                  <span className="rounded bg-sky-500/20 px-2 py-0.5 text-[10px] font-mono font-bold text-sky-300">
                    REAL .APK FILE
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  Want a downloadable <code className="text-white">Brokeify.apk</code>{' '}
                  file to install or share? Brokeify already includes a
                  compliant Web App Manifest (<code className="text-white">512x512</code>{' '}
                  + maskable icons &amp; Service Worker):
                </p>
                <ol className="text-xs text-zinc-200 space-y-1 list-decimal list-inside font-mono">
                  <li>
                    Go to <strong>pwabuilder.com</strong> and paste the URL
                    above.
                  </li>
                  <li>
                    Click <strong>Package for Stores → Android → Download Package</strong>.
                  </li>
                  <li>
                    Unzip and transfer the signed <strong>.apk</strong> to your
                    Pixel phone and tap to install!
                  </li>
                </ol>
                <div className="pt-1">
                  <a
                    href={`https://www.pwabuilder.com/reportcard?site=${encodeURIComponent(
                      appOrigin
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/50 bg-sky-500/15 hover:bg-sky-500/25 px-3 py-1.5 text-xs font-mono font-bold text-sky-300 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open PWABuilder for This App</span>
                  </a>
                </div>
              </div>

              {/* Method 3: Local CLI APK Build via Google Bubblewrap */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold uppercase text-purple-300 inline-flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>Method 3: Build APK via Google Bubblewrap CLI</span>
                  </span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  If you have Node.js on your PC/Mac, run Google&apos;s official
                  Trusted Web Activity (TWA) APK compiler to generate{' '}
                  <code className="text-zinc-200">app-release-signed.apk</code>:
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
