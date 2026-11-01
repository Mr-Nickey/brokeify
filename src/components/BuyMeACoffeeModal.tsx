import React, { useState } from 'react';
import { Coffee, ExternalLink, Heart, ShieldCheck, X } from 'lucide-react';

interface BuyMeACoffeeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BMC_STORAGE_KEY = 'brokeify_bmc_url_v1';
const DEFAULT_BMC_URL = 'https://www.buymeacoffee.com/';

export const BuyMeACoffeeModal: React.FC<BuyMeACoffeeModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [bmcUrl, setBmcUrl] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(BMC_STORAGE_KEY);
      if (saved && saved.trim()) return saved.trim();
    } catch {}
    return DEFAULT_BMC_URL;
  });

  if (!isOpen) return null;

  const safeHref = bmcUrl.trim() || DEFAULT_BMC_URL;

  const handleUrlChange = (nextUrl: string) => {
    setBmcUrl(nextUrl);
    try {
      localStorage.setItem(BMC_STORAGE_KEY, nextUrl);
    } catch {}
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bmc-modal-title"
      data-testid="bmc-modal"
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-amber-500/30 bg-zinc-900 p-6 sm:p-7 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shrink-0">
              <Coffee className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2
                id="bmc-modal-title"
                className="text-xl font-bold text-white tracking-tight"
              >
                Support Indie Development ☕
              </h2>
              <p className="text-xs text-amber-400 font-medium">
                100% Optional Tip · Zero Paywalls Forever
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Support Indie Development modal"
            data-testid="close-bmc-modal-btn"
            className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors min-h-[38px] min-w-[38px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Core Message */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
          <p className="text-sm text-zinc-200 leading-relaxed">
            Brokeify is 100% free, open-featured, with zero ads, zero paywalls,
            and zero subscriptions forever. If this app saves you from paying
            $11.99/month and makes your drives better, consider buying the dev a
            coffee to help cover server &amp; Play Store costs!
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              No locked features
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5 text-amber-300 font-medium">
              <Heart className="w-3.5 h-3.5" />
              Community-powered indie project
            </span>
          </div>
        </div>

        {/* Configurable Creator Tip URL */}
        <div className="space-y-1.5">
          <label
            htmlFor="bmc-custom-url"
            className="block text-xs font-medium text-zinc-400"
          >
            Buy Me a Coffee / Tip Jar Link
          </label>
          <input
            id="bmc-custom-url"
            type="url"
            value={bmcUrl ?? ''}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder="https://www.buymeacoffee.com/"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:border-amber-500 focus:outline-none font-mono"
          />
        </div>

        {/* Primary Tip / Buy Me a Coffee External Link CTA */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto rounded-xl border border-zinc-800 bg-zinc-950 hover:bg-zinc-800 px-4 py-2.5 text-xs font-semibold text-zinc-300 transition-colors min-h-[42px]"
          >
            Maybe Later
          </button>

          <a
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="bmc-external-link"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-[#f59e0b] hover:bg-amber-400 px-5 py-2.5 text-xs font-bold text-zinc-950 shadow-lg shadow-amber-500/20 transition-colors whitespace-nowrap shrink-0 min-h-[42px]"
          >
            <Coffee className="w-4 h-4" />
            <span>Tip / Buy Me a Coffee</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
};
