import React, { useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Loader2,
  Moon,
  Palette,
  RotateCcw,
  Save,
  Sparkles,
  Sun,
  Type,
} from 'lucide-react';
import type { CustomThemeConfig, VisualThemeId } from '../types/music';
import {
  CUSTOM_CSS_PRESETS,
  DEFAULT_CUSTOM_THEME,
  VISUAL_THEMES,
} from '../utils/musicLogic';
import { SlidingToggle } from './SlidingToggle';

interface ThemesCustomCssViewProps {
  visualTheme: VisualThemeId;
  onChangeVisualTheme: (theme: VisualThemeId) => void;
  customTheme: CustomThemeConfig;
  onChangeCustomTheme: (next: CustomThemeConfig) => void;
  onSaveThemeToServer?: (next: CustomThemeConfig) => Promise<void>;
  onShowToast: (msg: string) => void;
}

export const ThemesCustomCssView: React.FC<ThemesCustomCssViewProps> = ({
  visualTheme,
  onChangeVisualTheme,
  customTheme,
  onChangeCustomTheme,
  onSaveThemeToServer,
  onShowToast,
}) => {
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const activeSkin =
    VISUAL_THEMES.find((t) => t.id === visualTheme) || VISUAL_THEMES[0];

  const handleSaveNow = async () => {
    setIsSaving(true);
    try {
      if (onSaveThemeToServer) {
        await onSaveThemeToServer(customTheme);
      }
      onShowToast(
        '🎨 Saved your Visual Theme, Custom Colors & Custom CSS to config.json!'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      data-testid="themes-custom-css-view"
      className="space-y-6"
    >
      {/* Friendly Plain-English Intro Banner */}
      <section className="winamp-bezel rounded-2xl border border-emerald-500/40 bg-zinc-900/70 p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <Palette className="w-5 h-5 text-[#00ff66] shrink-0" />
            <h2 className="text-lg font-bold text-white tracking-tight font-mono">
              Appearance, Visual Skins, Custom Colors &amp; Custom CSS
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed max-w-3xl">
            Make the player look however you want! Pick one of the{' '}
            <strong className="text-white">6 ready-made Dark or Light skins</strong>{' '}
            below, pick your own{' '}
            <strong className="text-[#00ff66]">favorite button colors &amp; app title</strong>,
            or paste your own{' '}
            <strong className="text-purple-300">Custom CSS</strong>. Everything
            saves right to your server&apos;s <code className="text-[#00ff66]">config.json</code>{' '}
            so your TV, laptop, and phone all match automatically.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              onChangeVisualTheme('cyber-deck');
              onChangeCustomTheme(DEFAULT_CUSTOM_THEME);
              onShowToast('Restored default Cyber Deck theme and colors.');
            }}
            data-testid="reset-theme-defaults-btn"
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-zinc-500 px-3.5 py-2 text-xs font-mono font-semibold text-zinc-200 hover:text-white min-h-[40px]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to Default Look</span>
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={handleSaveNow}
            data-testid="save-custom-theme-btn"
            className="inline-flex items-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors min-h-[40px]"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>Save Appearance to Server</span>
          </button>
        </div>
      </section>

      {/* Step 1: Ready-Made Dark & Light Skins */}
      <section
        data-testid="visual-theme-selector-section"
        className="winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden"
      >
        <div className="winamp-titlebar px-5 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-700/80">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-[#00ff66] shrink-0" />
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
              STEP 1 // PICK A READY-MADE SKIN (DARK OR DAYLIGHT MODE)
            </h3>
          </div>
          <span className="text-[11px] font-mono text-[#00ff66]">
            Active Skin: {activeSkin.name} ({activeSkin.mode.toUpperCase()})
          </span>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-zinc-300">
            Click any card below to switch between high-contrast dark skins for
            night driving or bright daylight skins for sunny garages and patios:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {VISUAL_THEMES.map((skin) => {
              const isSelected = visualTheme === skin.id;
              return (
                <button
                  key={skin.id}
                  type="button"
                  onClick={() => {
                    onChangeVisualTheme(skin.id);
                    onShowToast(
                      `🎨 Applied "${skin.name}" (${
                        skin.mode === 'light' ? 'Light Skin' : 'Dark Skin'
                      })`
                    );
                  }}
                  data-testid={`visual-theme-option-${skin.id}`}
                  className={`rounded-2xl border p-4 text-left transition-all flex flex-col justify-between gap-3 ${
                    isSelected
                      ? 'border-[#00ff66] bg-emerald-500/15 ring-1 ring-[#00ff66]/50 shadow-md'
                      : 'border-zinc-800 bg-zinc-950/80 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {skin.mode === 'light' ? (
                          <Sun className="w-4 h-4 text-amber-400 shrink-0" />
                        ) : (
                          <Moon className="w-4 h-4 text-[#00ff66] shrink-0" />
                        )}
                        <span className="text-sm font-bold text-white truncate">
                          {skin.name}
                        </span>
                      </div>
                      <span className="inline-block mt-1 rounded bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[10px] font-mono font-bold text-zinc-300 uppercase">
                        {skin.badge}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {skin.swatches.map((hex, i) => (
                        <span
                          key={`${skin.id}-swatch-${i}`}
                          className="w-4 h-4 rounded-full border border-zinc-600 shadow-inner"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                  </div>

                  <p className="text-xs text-zinc-300 leading-relaxed">
                    {skin.description}
                  </p>

                  <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[11px] font-mono">
                    <span className="text-zinc-400">
                      {skin.mode === 'light' ? '☀️ Daylight Skin' : '🌙 Dark Skin'}
                    </span>
                    <span
                      className={`font-bold shrink-0 ${
                        isSelected ? 'text-[#00ff66]' : 'text-zinc-400'
                      }`}
                    >
                      {isSelected ? '● ACTIVE SKIN' : 'Click to Apply'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Step 2: Custom Branding & Favorite Color Picker (Zero Coding Needed) */}
      <section className="winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden">
        <div className="winamp-titlebar px-5 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-700/80">
          <div className="flex items-center gap-2">
            <Type className="w-4 h-4 text-[#00ff66] shrink-0" />
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
              STEP 2 // YOUR OWN BRANDING &amp; FAVORITE COLORS (NO CODING NEEDED)
            </h3>
          </div>
          <span className="text-[11px] font-mono text-zinc-400">
            Customize the top header name &amp; button colors
          </span>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Custom App Name & Tagline */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
            <h4 className="text-xs font-mono font-bold uppercase text-[#00ff66]">
              1. Custom App Name &amp; Header Subtitle
            </h4>
            <p className="text-xs text-zinc-400">
              Want the top-left logo to say your own name, garage stereo name, or
              home server name instead of &ldquo;BROKEIFY&rdquo;? Type it here:
            </p>

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="custom-app-name-input"
                  className="block text-xs font-medium text-zinc-300 mb-1"
                >
                  Custom Header Title (Leave blank for &ldquo;BROKEIFY&rdquo;)
                </label>
                <input
                  id="custom-app-name-input"
                  type="text"
                  value={customTheme.customAppName || ''}
                  onChange={(e) =>
                    onChangeCustomTheme({
                      ...customTheme,
                      customAppName: e.target.value,
                    })
                  }
                  placeholder="BROKEIFY (or e.g. GARAGE DECK / NICK'S JUKEBOX)"
                  data-testid="custom-app-name-input"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-sm font-mono text-white placeholder-zinc-500 focus:border-[#00ff66] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="custom-app-tagline-input"
                  className="block text-xs font-medium text-zinc-300 mb-1"
                >
                  Custom Subtitle Under Title (Optional)
                </label>
                <input
                  id="custom-app-tagline-input"
                  type="text"
                  value={customTheme.customTagline || ''}
                  onChange={(e) =>
                    onChangeCustomTheme({
                      ...customTheme,
                      customTagline: e.target.value,
                    })
                  }
                  placeholder="'99 RETRO DECK // SELF-HOSTED AUDIO"
                  data-testid="custom-app-tagline-input"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-mono text-white placeholder-zinc-500 focus:border-[#00ff66] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Favorite Colors Picker */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
            <h4 className="text-xs font-mono font-bold uppercase text-purple-300">
              2. Pick Your Favorite Button &amp; Highlight Colors
            </h4>
            <p className="text-xs text-zinc-400">
              Click either color box below to choose your own primary button
              color and shuffle/secondary highlight color. Turn on &ldquo;Apply
              Custom Colors &amp; CSS&rdquo; in Step 3 to activate them!
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-3 space-y-2">
                <label
                  htmlFor="primary-accent-picker"
                  className="block text-xs font-semibold text-zinc-200"
                >
                  Primary Accent Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="primary-accent-picker"
                    type="color"
                    value={customTheme.primaryAccent || '#00ff66'}
                    onChange={(e) =>
                      onChangeCustomTheme({
                        ...customTheme,
                        enabled: true,
                        primaryAccent: e.target.value,
                      })
                    }
                    className="w-10 h-10 rounded-lg border border-zinc-700 bg-zinc-950 cursor-pointer shrink-0"
                  />
                  <input
                    type="text"
                    value={customTheme.primaryAccent || '#00ff66'}
                    onChange={(e) =>
                      onChangeCustomTheme({
                        ...customTheme,
                        enabled: true,
                        primaryAccent: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-white"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-3 space-y-2">
                <label
                  htmlFor="secondary-accent-picker"
                  className="block text-xs font-semibold text-zinc-200"
                >
                  Secondary / Shuffle Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="secondary-accent-picker"
                    type="color"
                    value={customTheme.secondaryAccent || '#a855f7'}
                    onChange={(e) =>
                      onChangeCustomTheme({
                        ...customTheme,
                        enabled: true,
                        secondaryAccent: e.target.value,
                      })
                    }
                    className="w-10 h-10 rounded-lg border border-zinc-700 bg-zinc-950 cursor-pointer shrink-0"
                  />
                  <input
                    type="text"
                    value={customTheme.secondaryAccent || '#a855f7'}
                    onChange={(e) =>
                      onChangeCustomTheme({
                        ...customTheme,
                        enabled: true,
                        secondaryAccent: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-white"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Step 3: Custom CSS Studio + 1-Click Starter Theme Presets */}
      <section className="winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden">
        <div className="winamp-titlebar px-5 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-700/80">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-[#00ff66] shrink-0" />
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
              STEP 3 // CUSTOM CSS EDITOR &amp; 1-CLICK COLOR PRESETS
            </h3>
          </div>

          <SlidingToggle
            checked={customTheme.enabled}
            onChange={(enabled) =>
              onChangeCustomTheme({
                ...customTheme,
                enabled,
              })
            }
            label={
              customTheme.enabled
                ? 'Custom Colors & CSS: ON'
                : 'Custom Colors & CSS: OFF'
            }
            ariaLabel="Enable Custom Colors and Custom CSS"
            testId="toggle-custom-css-enabled"
          />
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <span className="block text-xs font-mono font-bold uppercase text-zinc-300">
              Try a 1-Click Custom Theme Preset (or write your own CSS below):
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {CUSTOM_CSS_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    onChangeCustomTheme({
                      ...customTheme,
                      enabled: preset.id !== 'preset-none',
                      primaryAccent: preset.primaryAccent,
                      secondaryAccent: preset.secondaryAccent,
                      customCss: preset.css,
                    });
                    onShowToast(`✨ Loaded "${preset.name}" preset!`);
                  }}
                  data-testid={`custom-css-preset-${preset.id}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 hover:border-[#00ff66] px-3.5 py-2 text-xs font-mono font-bold text-white transition-colors"
                >
                  <span
                    className="w-3 h-3 rounded-full border border-zinc-500"
                    style={{ backgroundColor: preset.primaryAccent }}
                  />
                  <span>{preset.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="user-custom-css-textarea"
              className="block text-xs font-mono font-semibold text-zinc-300"
            >
              Your Custom CSS Stylesheet (Applied live to the entire app):
            </label>
            <textarea
              id="user-custom-css-textarea"
              rows={8}
              value={customTheme.customCss}
              onChange={(e) =>
                onChangeCustomTheme({
                  ...customTheme,
                  enabled: true,
                  customCss: e.target.value,
                })
              }
              placeholder={`/* Example: Make panels dark navy with neon cyan borders */\n.winamp-bezel {\n  background: rgba(10, 20, 40, 0.92) !important;\n  border-color: #00e5ff !important;\n}`}
              data-testid="user-custom-css-textarea"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3.5 text-xs font-mono text-emerald-200 leading-relaxed focus:border-[#00ff66] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-800/80 text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#00ff66] shrink-0" />
              <span>
                Tip: Classes you can style include{' '}
                <code className="text-[#00ff66]">.winamp-bezel</code>,{' '}
                <code className="text-[#00ff66]">.winamp-titlebar</code>, and{' '}
                <code className="text-[#00ff66]">.winamp-lcd</code>.
              </span>
            </div>

            <button
              type="button"
              onClick={handleSaveNow}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2 text-xs font-mono font-bold text-zinc-950"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Save My Theme &amp; CSS</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
