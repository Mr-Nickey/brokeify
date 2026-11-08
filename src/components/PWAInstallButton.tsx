import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Info,
  Layers,
  Share2,
  Smartphone,
  Sparkles,
  Terminal,
  WifiOff,
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
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
        true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));
    setIsAndroid(/android/.test(userAgent));

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
    isAndroid,
    install,
  };
}

interface PixelInstallGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTriggerDirectInstall?: () => void;
  canDirectInstall?: boolean;
}

export const PixelInstallGuideModal: React.FC<PixelInstallGuideModalProps> = ({
  isOpen,
  onClose,
  onTriggerDirectInstall,
  canDirectInstall = false,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentDomain =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://music.flockingreeds.farm';

  const handleCopy = (key: string, value: string) => {
    try {
      navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2200);
    } catch {}
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pixel-install-modal-title"
    >
      <div className="w-full max-w-xl winamp-bezel rounded-2xl border border-zinc-700 bg-zinc-950 overflow-hidden shadow-2xl my-auto text-left">
        <div className="winamp-titlebar px-5 py-3.5 flex items-center justify-between border-b border-zinc-700/80">
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-4 h-4 text-[#00ff66]" />
            <h3
              id="pixel-install-modal-title"
              className="text-xs sm:text-sm font-mono font-bold uppercase tracking-wider text-white"
            >
              PIXEL PHONE // ANDROID HOME SCREEN &amp; WEBAK INSTALL GUIDE
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close install guide"
            className="rounded-lg p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto text-left">
          {/* 1-Click Direct Install Option (if Chrome has fired prompt) */}
          {canDirectInstall && onTriggerDirectInstall && (
            <div className="rounded-xl border border-emerald-500/50 bg-emerald-950/30 p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
              <div className="space-y-1">
                <span className="text-xs font-mono font-bold text-[#00ff66] flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[#00ff66]" />
                  Direct Pixel Install Ready
                </span>
                <p className="text-xs text-zinc-300">
                  Chrome on your phone is ready to install Brokeify directly to your home screen!
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onTriggerDirectInstall();
                  onClose();
                }}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                <Download className="w-4 h-4" />
                <span>Install on Pixel Now</span>
              </button>
            </div>
          )}

          {/* Android Pixel Chrome Installation Steps */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-2">
              <span className="text-xs font-mono font-bold uppercase text-[#00ff66] flex items-center gap-1.5">
                <Smartphone className="w-4 h-4" />
                Install in Chrome on your Google Pixel Phone
              </span>
              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-mono font-bold text-[#00ff66]">
                OFFICIAL WEBAK
              </span>
            </div>

            <ol className="text-xs text-zinc-200 space-y-2.5 list-decimal list-inside font-mono leading-relaxed">
              <li className="pl-1">
                Open <strong className="text-white">{currentDomain}</strong> in{' '}
                <strong className="text-white">Google Chrome</strong> on your Pixel phone.
              </li>
              <li className="pl-1">
                Tap the <strong className="text-[#00ff66]">three dots (⋮)</strong> in the top-right corner of Chrome.
              </li>
              <li className="pl-1">
                Tap <strong className="text-[#00ff66]">&ldquo;Install app&rdquo;</strong> (or &ldquo;Add to Home screen&rdquo;).
              </li>
              <li className="pl-1">
                Confirm by tapping <strong className="text-white">&ldquo;Install&rdquo;</strong> on the prompt.
              </li>
            </ol>

            <div className="rounded-lg bg-black/50 border border-zinc-800 p-3 space-y-1.5 text-zinc-400 text-[11px]">
              <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#00ff66]" />
                What happens when you install on Pixel:
              </div>
              <ul className="list-disc list-inside space-y-1 pl-1 font-mono text-[10.5px]">
                <li>Android creates an official <strong>WebAPK</strong> with the Brokeify emerald cyber logo in your <strong>Pixel App Drawer</strong>.</li>
                <li>Hides browser address bar for a 100% native standalone fullscreen app experience.</li>
                <li>Integrates with <strong>Pixel lock-screen media player</strong> and <strong>Bluetooth car audio</strong>.</li>
                <li>Grants full offline storage access via <code className="text-[#00ff66]">navigator.storage.persist()</code> so cached songs and album covers work without signal!</li>
              </ul>
            </div>
          </div>

          {/* iOS Safari Instructions */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
            <span className="text-xs font-mono font-bold uppercase text-purple-300 flex items-center gap-1.5">
              <Share2 className="w-4 h-4" />
              iPhone / iPad (iOS Safari)
            </span>
            <p className="text-xs text-zinc-400 leading-relaxed font-mono">
              In Safari, tap the <strong>Share</strong> button (box with upward arrow) at the bottom &rarr; tap <strong>Add to Home Screen</strong> &rarr; tap <strong>Add</strong>.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-[#00ff66] hover:bg-emerald-400 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-colors"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } =
    usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const success = await install();
      if (!success) {
        setShowGuide(true);
      }
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        data-testid="navbar-pwa-install-btn"
        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/50 bg-emerald-500/15 hover:bg-emerald-500/25 px-3 py-1.5 text-xs font-mono font-bold text-[#00ff66] transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
        title="Install Brokeify on Pixel Phone / Home Screen"
      >
        <Smartphone className="w-3.5 h-3.5 text-[#00ff66]" />
        <span>{isInstallable ? 'Install on Pixel' : '📱 Install to Phone'}</span>
      </button>

      <PixelInstallGuideModal
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
        onTriggerDirectInstall={install}
        canDirectInstall={isInstallable}
      />
    </>
  );
};

/**
 * Mobile-specific banner that automatically prompts mobile Pixel / Android visitors
 * to install Brokeify directly to their phone with 1 tap.
 */
export const MobilePixelInstallBanner: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } =
    usePWAInstall();
  const [dismissed, setDismissed] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled || dismissed) {
    return null;
  }

  const handleInstallOrGuide = async () => {
    if (isInstallable) {
      const ok = await install();
      if (!ok) {
        setShowGuide(true);
      }
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <div
        data-testid="mobile-pixel-install-banner"
        className="rounded-2xl border border-[#00ff66]/50 bg-gradient-to-r from-emerald-950/80 via-zinc-900 to-zinc-950 p-3 sm:p-4 flex items-center justify-between gap-3 shadow-xl winamp-bezel"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#00ff66]/20 border border-[#00ff66]/40 flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5 text-[#00ff66]" />
          </div>
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-mono font-bold text-white truncate flex items-center gap-2">
              <span>Install Brokeify on your Pixel Phone</span>
              <span className="text-[10px] font-mono text-[#00ff66] bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/30 hidden xs:inline-block">
                WebAPK
              </span>
            </div>
            <div className="text-[11px] text-zinc-400 font-mono truncate">
              Standalone fullscreen player, car mode, and full offline caching
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleInstallOrGuide}
            data-testid="mobile-banner-install-btn"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3.5 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors shadow"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Install Now</span>
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss install banner"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <PixelInstallGuideModal
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
        onTriggerDirectInstall={install}
        canDirectInstall={isInstallable}
      />
    </>
  );
};
