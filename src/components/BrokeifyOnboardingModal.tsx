import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Disc,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Loader2,
  LogOut,
  Radio,
  Server,
  Sparkles,
  UserCheck,
  X,
  Zap,
} from 'lucide-react';
import { BrokeifyLogo } from './BrokeifyLogo';
import { MusicProviderManager } from '../services/MusicProviderManager';
import type {
  BrokeifyCloudSettings,
  Playlist,
  ProviderConfig,
  ProviderType,
  Track,
} from '../types/music';

type OnboardingProviderSelection =
  | 'jellyfin'
  | 'plex'
  | 'navidrome'
  | 'emby'
  | 'demo';

type JellyfinLoginTab = 'quickconnect' | 'manual';

interface BrokeifyOnboardingModalProps {
  isOpen: boolean;
  canClose: boolean;
  providers: ProviderConfig[];
  onUpdateProviders: (next: ProviderConfig[]) => void;
  onMergeRemoteTracks: (tracks: Track[]) => void;
  onMergeRemotePlaylists: (playlists: Playlist[]) => void;
  onApplyRestoredCloudSettings: (settings: BrokeifyCloudSettings) => void;
  onShowToast: (message: string) => void;
  onCompleteAndLaunchLibrary: () => void;
  onClose: () => void;
  onLogoutProvider?: (type: ProviderType) => void;
}

export const BrokeifyOnboardingModal: React.FC<BrokeifyOnboardingModalProps> = ({
  isOpen,
  canClose,
  providers,
  onUpdateProviders,
  onMergeRemoteTracks,
  onMergeRemotePlaylists,
  onApplyRestoredCloudSettings,
  onShowToast,
  onCompleteAndLaunchLibrary,
  onClose,
  onLogoutProvider,
}) => {
  const [selectedProvider, setSelectedProvider] =
    useState<OnboardingProviderSelection>('jellyfin');
  const [jfTab, setJfTab] = useState<JellyfinLoginTab>('quickconnect');
  const [showSecret, setShowSecret] = useState<boolean>(false);
  const [showExtraProviders, setShowExtraProviders] = useState<boolean>(false);

  // Jellyfin Quick Connect State
  const [pingLoading, setPingLoading] = useState<boolean>(false);
  const [pingStatus, setPingStatus] = useState<{
    ok: boolean;
    message: string;
    version?: string;
  } | null>(null);
  const [qcLoading, setQcLoading] = useState<boolean>(false);
  const [qcCode, setQcCode] = useState<string>('');
  const [qcSecret, setQcSecret] = useState<string>('');
  const [qcError, setQcError] = useState<string | null>(null);
  const [qcPollingStatus, setQcPollingStatus] = useState<string>('');

  // Manual / Provider Connection State
  const [connecting, setConnecting] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeProviderConfig =
    providers.find(
      (p) =>
        p.type ===
        (selectedProvider === 'demo' ? 'built-in' : selectedProvider)
    ) || providers[0];

  const stopQuickConnectPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!isOpen) {
      stopQuickConnectPolling();
    }
    return () => {
      stopQuickConnectPolling();
    };
  }, [isOpen]);

  // Automatic 3-second polling for GET {serverUrl}/QuickConnect/Connect?Secret={secret}
  useEffect(() => {
    stopQuickConnectPolling();
    if (!isOpen || selectedProvider !== 'jellyfin' || jfTab !== 'quickconnect') {
      return;
    }
    if (!qcSecret || !activeProviderConfig?.serverUrl?.trim()) {
      return;
    }

    const serverUrl = activeProviderConfig.serverUrl.trim();

    pollTimerRef.current = setInterval(async () => {
      try {
        const pollRes = await MusicProviderManager.pollJellyfinQuickConnect(
          serverUrl,
          qcSecret
        );
        if (pollRes.authenticated) {
          stopQuickConnectPolling();
          setQcPollingStatus(
            'Quick Connect approved! Exchanging secret for session token...'
          );
          const session =
            await MusicProviderManager.authenticateWithJellyfinQuickConnect(
              serverUrl,
              qcSecret
            );

          // 1. Save AccessToken and User.Id in localStorage under `jellyfin_token` and `jellyfin_user_id`
          try {
            localStorage.setItem('jellyfin_token', session.accessToken);
            localStorage.setItem('jellyfin_user_id', session.userId);
          } catch {
            // ignore storage errors
          }

          // 2. Set authMode to "session" so it uses the authenticated user session
          const jfProv =
            providers.find((p) => p.type === 'jellyfin') ||
            activeProviderConfig;
          const configuredJf: ProviderConfig = {
            ...jfProv,
            enabled: true,
            serverUrl: serverUrl.replace(/\/+$/, ''),
            authMode: 'session',
            username: session.username,
            token: session.accessToken,
            password: '',
            userId: session.userId,
            status: 'connected',
          };

          // 3. Close the modal and immediately trigger fetchJellyfinMusic()
          MusicProviderManager.markOnboardingCompleted();
          onUpdateProviders(
            providers.map((p) =>
              p.id === configuredJf.id ? configuredJf : p
            )
          );
          setQcCode('');
          setQcSecret('');
          onShowToast(`✅ Authorized as ${session.username}! Syncing Jellyfin library...`);
          onCompleteAndLaunchLibrary();

          const {
            updatedConfig,
            tracks,
            playlists,
            restoredCloudSettings,
          } = await MusicProviderManager.fetchJellyfinMusic(configuredJf);

          const nextProviders = providers.map((p) => {
            if (p.id === configuredJf.id) return updatedConfig;
            if (tracks.length > 0 && p.type === 'built-in') {
              return { ...p, enabled: false };
            }
            return p;
          });

          onUpdateProviders(nextProviders);
          if (tracks.length > 0) {
            onMergeRemoteTracks(tracks);
          }
          if (playlists.length > 0) {
            onMergeRemotePlaylists(playlists);
          }
          if (restoredCloudSettings) {
            onApplyRestoredCloudSettings(restoredCloudSettings);
          }
          onShowToast(
            `✅ Authorized as ${session.username}! Loaded ${tracks.length} tracks & ${playlists.length} playlists.`
          );
        }
      } catch (err: any) {
        setQcPollingStatus(
          `Waiting for Quick Connect approval... (${err?.message || 'polling every 3s'})`
        );
      }
    }, 3000);

    return () => {
      stopQuickConnectPolling();
    };
  }, [
    activeProviderConfig,
    isOpen,
    jfTab,
    onApplyRestoredCloudSettings,
    onCompleteAndLaunchLibrary,
    onMergeRemotePlaylists,
    onMergeRemoteTracks,
    onShowToast,
    onUpdateProviders,
    providers,
    qcSecret,
    selectedProvider,
  ]);

  if (!isOpen) return null;

  const updateProviderField = (
    type: ProviderType,
    field: keyof ProviderConfig,
    value: string | boolean
  ) => {
    const next = providers.map((p) =>
      p.type === type ? { ...p, [field]: value } : p
    );
    onUpdateProviders(next);
  };

  const handleClearSecret = (type: ProviderType) => {
    if (type === 'jellyfin') {
      try {
        localStorage.removeItem('jellyfin_token');
        localStorage.removeItem('jellyfin_user_id');
      } catch {
        // ignore
      }
    }
    const next = providers.map((p) =>
      p.type === type
        ? {
            ...p,
            password: '',
            token: '',
            userId: '',
            status: 'disconnected' as const,
          }
        : p
    );
    onUpdateProviders(next);
    setConnectError(null);
    setConnectSuccess(null);
  };

  // Close modal and return to library
  const handleDismissModal = () => {
    stopQuickConnectPolling();
    MusicProviderManager.markOnboardingCompleted();
    onCompleteAndLaunchLibrary();
  };

  // Ping GET {serverUrl}/System/Info/Public
  const handleTestJellyfinServer = async () => {
    setPingLoading(true);
    setPingStatus(null);
    setQcError(null);
    try {
      const res = await MusicProviderManager.testJellyfinServerPublicInfo(
        activeProviderConfig?.serverUrl ?? ''
      );
      setPingStatus(res);
    } finally {
      setPingLoading(false);
    }
  };

  // Initiate Quick Connect: POST {serverUrl}/QuickConnect/Initiate
  const handleGenerateQuickConnectCode = async () => {
    const url = (activeProviderConfig?.serverUrl ?? '').trim();
    if (!url) {
      setQcError(
        'Please enter your Jellyfin Server URL first (e.g., https://jellyfin.yourdomain.com).'
      );
      return;
    }

    setQcLoading(true);
    setQcError(null);
    setQcCode('');
    setQcSecret('');
    try {
      // Also ping public info if not tested yet
      if (!pingStatus?.ok) {
        const pingRes =
          await MusicProviderManager.testJellyfinServerPublicInfo(url);
        if (pingRes.ok) {
          setPingStatus(pingRes);
        }
      }

      const qc = await MusicProviderManager.initiateJellyfinQuickConnect(url);
      setQcCode(qc.code);
      setQcSecret(qc.secret);
      setQcPollingStatus(
        'Polling GET /QuickConnect/Connect?Secret=... every 3 seconds'
      );
    } catch (err: any) {
      setQcError(
        err?.message ||
          'Failed to initiate Quick Connect. Verify your Server URL or use Manual Login.'
      );
    } finally {
      setQcLoading(false);
    }
  };

  // Manual Connect for Jellyfin, Emby, Navidrome, or Plex
  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProviderConfig) return;

    setConnecting(true);
    setConnectError(null);
    setConnectSuccess(null);

    try {
      if (
        selectedProvider === 'jellyfin' ||
        selectedProvider === 'emby'
      ) {
        const configToConnect: ProviderConfig = {
          ...activeProviderConfig,
          authMode: 'password',
        };

        const {
          updatedConfig,
          tracks,
          playlists,
          restoredCloudSettings,
        } = await MusicProviderManager.fetchJellyfinMusic(configToConnect);

        if (updatedConfig.status === 'error') {
          setConnectError(
            updatedConfig.diagnosticLog ||
              updatedConfig.lastMessage ||
              'Connection failed.'
          );
          onUpdateProviders(
            providers.map((p) =>
              p.id === updatedConfig.id ? updatedConfig : p
            )
          );
          return;
        }

        const nextProviders = providers.map((p) => {
          if (p.id === updatedConfig.id) return updatedConfig;
          if (tracks.length > 0 && p.type === 'built-in') {
            return { ...p, enabled: false };
          }
          return p;
        });

        onUpdateProviders(nextProviders);
        if (tracks.length > 0) {
          onMergeRemoteTracks(tracks);
        }
        if (playlists.length > 0) {
          onMergeRemotePlaylists(playlists);
        }
        if (restoredCloudSettings) {
          onApplyRestoredCloudSettings(restoredCloudSettings);
        }

        MusicProviderManager.markOnboardingCompleted();
        onShowToast(
          `✅ Connected to ${updatedConfig.name} (${tracks.length} tracks)!`
        );
        setConnectSuccess(updatedConfig.lastMessage || 'Connected!');
        onCompleteAndLaunchLibrary();
      } else if (selectedProvider === 'navidrome') {
        const { updatedConfig, tracks } =
          await MusicProviderManager.connectNavidrome(activeProviderConfig);
        onUpdateProviders(
          providers.map((p) => (p.id === updatedConfig.id ? updatedConfig : p))
        );
        if (updatedConfig.status === 'error') {
          setConnectError(
            updatedConfig.diagnosticLog || 'Subsonic connection failed.'
          );
          return;
        }
        if (tracks.length > 0) {
          onMergeRemoteTracks(tracks);
        }
        MusicProviderManager.markOnboardingCompleted();
        onShowToast(`✅ Connected to Navidrome (${tracks.length} tracks)!`);
        onCompleteAndLaunchLibrary();
      } else if (selectedProvider === 'plex') {
        const { updatedConfig, tracks } =
          await MusicProviderManager.connectPlex(activeProviderConfig);
        onUpdateProviders(
          providers.map((p) => (p.id === updatedConfig.id ? updatedConfig : p))
        );
        if (updatedConfig.status === 'error') {
          setConnectError(
            updatedConfig.diagnosticLog || 'Plex connection failed.'
          );
          return;
        }
        if (tracks.length > 0) {
          onMergeRemoteTracks(tracks);
        }
        MusicProviderManager.markOnboardingCompleted();
        onShowToast(`✅ Connected to Plex (${tracks.length} tracks)!`);
        onCompleteAndLaunchLibrary();
      }
    } finally {
      setConnecting(false);
    }
  };

  const currentSecretValue =
    selectedProvider === 'plex'
      ? (activeProviderConfig?.token ?? '')
      : (activeProviderConfig?.password ?? '');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#09090b]/95 backdrop-blur-xl p-4 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="brokeify-onboarding-title"
      data-testid="brokeify-onboarding-modal"
    >
      <div className="relative w-full max-w-3xl rounded-3xl border border-zinc-800/90 bg-zinc-950/95 p-6 sm:p-8 shadow-2xl my-auto space-y-6">
        {/* Top Ambient Accent Bar */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-1.5 rounded-t-3xl bg-gradient-to-r from-emerald-500 via-purple-500 to-emerald-500"
          aria-hidden="true"
        />

        {/* Close Button if opened from Settings -> Manage Providers */}
        {canClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Provider Setup"
            data-testid="close-onboarding-btn"
            className="absolute top-5 right-5 rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* 1. BROKEIFY CONNECT HEADER */}
        <div className="flex flex-col items-center text-center space-y-2.5 pt-1">
          <BrokeifyLogo size={48} />
          <div className="space-y-1">
            <h1
              id="brokeify-onboarding-title"
              className="text-2xl sm:text-3xl font-bold tracking-tight text-white"
            >
              Welcome to Brokeify
            </h1>
            <p className="text-sm text-zinc-400">
              Connect your music provider to get started.
            </p>
          </div>
        </div>

        {/* 2. PROVIDER SELECTOR CARDS (Jellyfin + Free Cloud by default; extra connectors hidden until activated) */}
        <div className="space-y-2.5">
          <div
            className="grid grid-cols-1 gap-2.5"
            role="tablist"
            aria-label="Choose Music Provider"
          >
            {/* 1. Jellyfin (Default & Recommended) */}
            <button
              type="button"
              role="tab"
              aria-selected={selectedProvider === 'jellyfin'}
              onClick={() => {
                setSelectedProvider('jellyfin');
                setConnectError(null);
              }}
              data-testid="onboarding-provider-jellyfin"
              className={`rounded-2xl border p-3.5 text-left flex items-center justify-between gap-3 transition-all ${
                selectedProvider === 'jellyfin'
                  ? 'border-emerald-500 bg-emerald-500/15 shadow-lg shadow-emerald-500/10'
                  : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                  <Server className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <div className="text-xs sm:text-sm font-bold text-white">
                    Jellyfin Media Server
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Sign in via Quick Connect or Username &amp; Password
                  </div>
                </div>
              </div>
              <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-mono font-bold uppercase text-emerald-300 shrink-0">
                Active
              </span>
            </button>
          </div>

          {/* Toggle to reveal or hide other self-hosted connectors (Plex, Navidrome, Emby) */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowExtraProviders((prev) => !prev)}
              data-testid="onboarding-toggle-extra-providers"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 hover:text-emerald-300 transition-colors"
            >
              <span>
                {showExtraProviders ||
                selectedProvider === 'plex' ||
                selectedProvider === 'navidrome' ||
                selectedProvider === 'emby'
                  ? '▾ Hide other server types (Plex, Navidrome, Emby)'
                  : '+ Using Plex, Navidrome, or Emby instead? Click to activate'}
              </span>
            </button>
          </div>

          {(showExtraProviders ||
            selectedProvider === 'plex' ||
            selectedProvider === 'navidrome' ||
            selectedProvider === 'emby') && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              {/* Plex (via Plex Token) */}
              <button
                type="button"
                role="tab"
                aria-selected={selectedProvider === 'plex'}
                onClick={() => {
                  setSelectedProvider('plex');
                  updateProviderField('plex', 'enabled', true);
                  setConnectError(null);
                }}
                data-testid="onboarding-provider-plex"
                className={`rounded-2xl border p-3 text-left flex flex-col justify-between gap-2 transition-all ${
                  selectedProvider === 'plex'
                    ? 'border-amber-500 bg-amber-500/15'
                    : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
                }`}
              >
                <Disc className="w-4 h-4 text-amber-400" />
                <div>
                  <div className="text-xs font-bold text-white">Plex</div>
                  <div className="text-[10px] text-zinc-400 truncate">
                    via Plex Token
                  </div>
                </div>
              </button>

              {/* Navidrome / Subsonic */}
              <button
                type="button"
                role="tab"
                aria-selected={selectedProvider === 'navidrome'}
                onClick={() => {
                  setSelectedProvider('navidrome');
                  updateProviderField('navidrome', 'enabled', true);
                  setConnectError(null);
                }}
                data-testid="onboarding-provider-navidrome"
                className={`rounded-2xl border p-3 text-left flex flex-col justify-between gap-2 transition-all ${
                  selectedProvider === 'navidrome'
                    ? 'border-emerald-500 bg-emerald-500/15'
                    : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
                }`}
              >
                <HardDrive className="w-4 h-4 text-emerald-400" />
                <div>
                  <div className="text-xs font-bold text-white">Navidrome</div>
                  <div className="text-[10px] text-zinc-400 truncate">
                    Subsonic Login
                  </div>
                </div>
              </button>

              {/* Emby */}
              <button
                type="button"
                role="tab"
                aria-selected={selectedProvider === 'emby'}
                onClick={() => {
                  setSelectedProvider('emby');
                  updateProviderField('emby', 'enabled', true);
                  setConnectError(null);
                }}
                data-testid="onboarding-provider-emby"
                className={`rounded-2xl border p-3 text-left flex flex-col justify-between gap-2 transition-all ${
                  selectedProvider === 'emby'
                    ? 'border-purple-500 bg-purple-500/15'
                    : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
                }`}
              >
                <Radio className="w-4 h-4 text-purple-400" />
                <div>
                  <div className="text-xs font-bold text-white">Emby</div>
                  <div className="text-[10px] text-zinc-400 truncate">
                    Emby Server
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* ===================================================================
            JELLYFIN CONFIGURATION PANEL (QUICK CONNECT OR USERNAME & PASSWORD)
           =================================================================== */}
        {selectedProvider === 'jellyfin' && activeProviderConfig && (
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-5 sm:p-6 space-y-5">
            {/* Active Session Banner (without accidental Log Out button) */}
            {(activeProviderConfig.status === 'connected' ||
              Boolean(activeProviderConfig.token?.trim())) && (
              <div
                data-testid="onboarding-jf-session-banner"
                className="rounded-xl border border-emerald-500/40 bg-emerald-950/25 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-zinc-200">
                    Signed in to Jellyfin as{' '}
                    <strong className="text-emerald-300">
                      {activeProviderConfig.username || 'Jellyfin User'}
                    </strong>
                    {activeProviderConfig.trackCount
                      ? ` (${activeProviderConfig.trackCount} tracks, ${
                          activeProviderConfig.playlistCount || 0
                        } playlists)`
                      : ''}
                  </span>
                </div>
              </div>
            )}

            {/* Two Tabs: ⚡ Quick Connect (Fastest) | 🔑 Username & Password */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-1">
              <button
                type="button"
                onClick={() => {
                  setJfTab('quickconnect');
                  setConnectError(null);
                }}
                data-testid="onboarding-tab-quickconnect"
                className={`rounded-lg py-2.5 px-3 text-xs sm:text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
                  jfTab === 'quickconnect'
                    ? 'bg-emerald-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Zap className="w-4 h-4" />
                <span>⚡ Quick Connect (Fastest)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  stopQuickConnectPolling();
                  setJfTab('manual');
                  setQcError(null);
                }}
                data-testid="onboarding-tab-manual"
                className={`rounded-lg py-2.5 px-3 text-xs sm:text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
                  jfTab === 'manual'
                    ? 'bg-emerald-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <KeyRound className="w-4 h-4" />
                <span>🔑 Username &amp; Password</span>
              </button>
            </div>

            {/* Shared Server URL Input + Test Server Button */}
            <div className="space-y-2">
              <label
                htmlFor="onboarding-jf-url"
                className="block text-xs font-semibold text-zinc-300"
              >
                Jellyfin Server URL
              </label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <input
                  id="onboarding-jf-url"
                  type="url"
                  value={activeProviderConfig.serverUrl ?? ''}
                  onChange={(e) => {
                    updateProviderField('jellyfin', 'serverUrl', e.target.value);
                    setPingStatus(null);
                  }}
                  placeholder="https://jellyfin.yourdomain.com"
                  className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none font-mono"
                />

                <button
                  type="button"
                  onClick={handleTestJellyfinServer}
                  disabled={pingLoading}
                  data-testid="onboarding-test-server-btn"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500 hover:text-zinc-950 px-4 py-2.5 text-xs font-bold text-emerald-300 transition-colors whitespace-nowrap shrink-0 min-h-[42px]"
                >
                  {pingLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Server className="w-4 h-4" />
                  )}
                  <span>Test Server</span>
                </button>
              </div>

              {pingStatus && (
                <div
                  data-testid="onboarding-server-status"
                  className={`rounded-xl border px-3.5 py-2 text-xs font-mono flex items-center gap-2 ${
                    pingStatus.ok
                      ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                      : 'border-rose-500/40 bg-rose-950/30 text-rose-300'
                  }`}
                >
                  {pingStatus.ok ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <span>{pingStatus.message}</span>
                </div>
              )}
            </div>

            {/* TAB A: JELLYFIN QUICK CONNECT FLOW */}
            {jfTab === 'quickconnect' && (
              <div className="space-y-4 pt-1">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 text-center space-y-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-white">
                      Zero-Password Jellyfin Quick Connect
                    </h3>
                    <p className="text-xs text-zinc-400 max-w-lg mx-auto">
                      Authorize Brokeify in seconds from your phone or PC without typing your password.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleGenerateQuickConnectCode}
                    disabled={
                      qcLoading || !(activeProviderConfig.serverUrl ?? '').trim()
                    }
                    data-testid="onboarding-generate-qc-btn"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 px-5 py-3 text-xs sm:text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition-all min-h-[44px]"
                  >
                    {qcLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Zap className="w-4 h-4 fill-current" />
                    )}
                    <span>Generate Quick Connect Code</span>
                  </button>

                  {qcCode && (
                    <div
                      data-testid="onboarding-qc-panel"
                      className="rounded-2xl border border-emerald-500/40 bg-emerald-950/20 p-5 space-y-3"
                    >
                      <div className="text-[11px] font-mono uppercase tracking-wider text-emerald-300">
                        Your 6-Digit Jellyfin Quick Connect Code
                      </div>
                      <div
                        data-testid="onboarding-qc-code"
                        className="text-3xl font-mono tracking-widest text-emerald-400 font-bold select-all"
                      >
                        {qcCode}
                      </div>
                      <p className="text-xs text-zinc-300 max-w-md mx-auto leading-relaxed">
                        On any device where you are already logged into Jellyfin, go to{' '}
                        <strong className="text-white">
                          Settings ⚙️ -&gt; Quick Connect
                        </strong>{' '}
                        and enter this code.
                      </p>
                      <div className="inline-flex items-center gap-2 text-xs font-mono text-amber-300 pt-1">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>
                          {qcPollingStatus ||
                            'Waiting for approval (polling every 3s)...'}
                        </span>
                      </div>
                    </div>
                  )}

                  {qcError && (
                    <div
                      data-testid="onboarding-qc-error"
                      className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-4 py-2.5 text-xs font-mono text-rose-300 text-left flex items-start gap-2"
                    >
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{qcError}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB B: SIMPLE USERNAME & PASSWORD LOGIN */}
            {jfTab === 'manual' && (
              <form onSubmit={handleManualConnect} className="space-y-4 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="onboarding-jf-user"
                      className="block text-xs font-medium text-zinc-400 mb-1"
                    >
                      Username
                    </label>
                    <input
                      id="onboarding-jf-user"
                      type="text"
                      value={activeProviderConfig.username ?? ''}
                      onChange={(e) =>
                        updateProviderField(
                          'jellyfin',
                          'username',
                          e.target.value
                        )
                      }
                      placeholder="Enter username (e.g., admin)"
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="onboarding-jf-secret"
                      className="block text-xs font-medium text-zinc-400 mb-1"
                    >
                      Password
                    </label>
                    <div className="relative flex items-center">
                      <input
                        id="onboarding-jf-secret"
                        type={showSecret ? 'text' : 'password'}
                        value={activeProviderConfig.password ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          const next = providers.map((p) =>
                            p.type === 'jellyfin'
                              ? {
                                  ...p,
                                  password: val,
                                  token: '',
                                  authMode: 'password' as const,
                                }
                              : p
                          );
                          onUpdateProviders(next);
                        }}
                        placeholder="Enter your Jellyfin password..."
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 pl-3.5 pr-20 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none font-mono"
                      />

                      <div className="absolute right-1.5 flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleClearSecret('jellyfin')}
                          aria-label="Clear saved password"
                          className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-rose-400 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowSecret(!showSecret)}
                          aria-label={
                            showSecret ? 'Hide password' : 'Show password'
                          }
                          className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                        >
                          {showSecret ? (
                            <EyeOff className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {connectError && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3.5 py-2.5 text-xs font-mono text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{connectError}</span>
                  </div>
                )}

                {connectSuccess && (
                  <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3.5 py-2.5 text-xs font-mono text-emerald-300 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{connectSuccess}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={connecting}
                    data-testid="onboarding-manual-connect-btn"
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-5 py-2.5 text-xs sm:text-sm font-bold text-zinc-950 transition-colors min-h-[42px]"
                  >
                    {connecting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <UserCheck className="w-4 h-4" />
                    )}
                    <span>Connect &amp; Launch Library</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ===================================================================
            PLEX / NAVIDROME / EMBY CONFIGURATION PANEL
           =================================================================== */}
        {(selectedProvider === 'plex' ||
          selectedProvider === 'navidrome' ||
          selectedProvider === 'emby') &&
          activeProviderConfig && (
            <form
              onSubmit={handleManualConnect}
              className="rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-5 sm:p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-white">
                  Configure {activeProviderConfig.name}
                </h2>
                <span className="text-xs font-mono text-zinc-400">
                  Zero-Logout Local Storage
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="onboarding-other-url"
                    className="block text-xs font-medium text-zinc-400 mb-1"
                  >
                    Server URL
                  </label>
                  <input
                    id="onboarding-other-url"
                    type="url"
                    value={activeProviderConfig.serverUrl ?? ''}
                    onChange={(e) =>
                      updateProviderField(
                        selectedProvider,
                        'serverUrl',
                        e.target.value
                      )
                    }
                    placeholder={
                      selectedProvider === 'plex'
                        ? 'http://192.168.1.50:32400'
                        : selectedProvider === 'navidrome'
                          ? 'https://navidrome.yourdomain.com'
                          : 'https://emby.yourdomain.com'
                    }
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none font-mono"
                  />
                </div>

                {selectedProvider !== 'plex' && (
                  <div>
                    <label
                      htmlFor="onboarding-other-user"
                      className="block text-xs font-medium text-zinc-400 mb-1"
                    >
                      Username
                    </label>
                    <input
                      id="onboarding-other-user"
                      type="text"
                      value={activeProviderConfig.username ?? ''}
                      onChange={(e) =>
                        updateProviderField(
                          selectedProvider,
                          'username',
                          e.target.value
                        )
                      }
                      placeholder="Enter username (e.g., admin)"
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                )}

                <div
                  className={
                    selectedProvider === 'plex' ? 'sm:col-span-2' : ''
                  }
                >
                  <label
                    htmlFor="onboarding-other-secret"
                    className="block text-xs font-medium text-zinc-400 mb-1"
                  >
                    {selectedProvider === 'plex'
                      ? 'X-Plex-Token'
                      : selectedProvider === 'navidrome'
                        ? 'Password or Subsonic Token'
                        : 'Password or API Key'}
                  </label>
                  <div className="relative flex items-center">
                    <input
                      id="onboarding-other-secret"
                      type={showSecret ? 'text' : 'password'}
                      value={currentSecretValue}
                      onChange={(e) => {
                        const val = e.target.value;
                        const next = providers.map((p) =>
                          p.type === selectedProvider
                            ? { ...p, password: val, token: val }
                            : p
                        );
                        onUpdateProviders(next);
                      }}
                      placeholder={
                        selectedProvider === 'plex'
                          ? 'Paste your X-Plex-Token...'
                          : 'Enter password or API key...'
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 pl-3.5 pr-20 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none font-mono"
                    />
                    <div className="absolute right-1.5 flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => handleClearSecret(selectedProvider)}
                        aria-label="Clear secret"
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-rose-400 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowSecret(!showSecret)}
                        aria-label="Toggle secret visibility"
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                      >
                        {showSecret ? (
                          <EyeOff className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {connectError && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3.5 py-2.5 text-xs font-mono text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{connectError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="submit"
                  disabled={connecting}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-5 py-2.5 text-xs sm:text-sm font-bold text-zinc-950 transition-colors min-h-[42px]"
                >
                  {connecting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <UserCheck className="w-4 h-4" />
                  )}
                  <span>Connect &amp; Launch Library</span>
                </button>
              </div>
            </form>
          )}

        {/* Bottom Footer */}
        <div className="pt-2 border-t border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400">
          <span>
            You can always add or switch servers later in{' '}
            <strong className="text-zinc-200">
              Settings -&gt; Manage Providers
            </strong>
            .
          </span>

          {canClose && (
            <button
              type="button"
              onClick={handleDismissModal}
              data-testid="onboarding-return-library-btn"
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 hover:text-white px-4 py-2 text-xs font-bold text-zinc-200 transition-colors whitespace-nowrap shrink-0"
            >
              <span>Return to Library →</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
