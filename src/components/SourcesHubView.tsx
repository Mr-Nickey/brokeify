import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  CloudDownload,
  CloudUpload,
  Eye,
  EyeOff,
  HardDrive,
  Loader2,
  Lock,
  LogOut,
  Plus,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import type {
  BrokeifyCloudSettings,
  CloudSyncStatus,
  Playlist,
  ProviderConfig,
  ProviderType,
  Track,
} from '../types/music';
import { MusicProviderManager } from '../services/MusicProviderManager';
import { buildJellyfinDisplayPrefsUrl } from '../utils/musicLogic';
import { SlidingToggle } from './SlidingToggle';

interface SourcesHubViewProps {
  providers: ProviderConfig[];
  onUpdateProviders: (next: ProviderConfig[]) => void;
  onMergeRemoteTracks: (newTracks: Track[], providerName: string) => void;
  onMergeRemotePlaylists: (newPlaylists: Playlist[]) => void;
  storagePersistStatus: { persisted: boolean; message: string };
  cloudSyncStatus: CloudSyncStatus;
  onPushCloudSettings: () => Promise<void>;
  onPullCloudSettings: (fromConfig?: ProviderConfig) => Promise<void>;
  onApplyRestoredCloudSettings: (settings: BrokeifyCloudSettings) => void;
  onOpenOnboardingModal?: () => void;
  onLogoutProvider?: (type: ProviderType) => Promise<void>;
}

const RADIO_TAGS = [
  'rock',
  'synthwave',
  'electronic',
  'jazz',
  'metal',
  'ambient',
] as const;

export const SourcesHubView: React.FC<SourcesHubViewProps> = ({
  providers,
  onUpdateProviders,
  onMergeRemoteTracks,
  onMergeRemotePlaylists,
  storagePersistStatus,
  cloudSyncStatus,
  onPushCloudSettings,
  onPullCloudSettings,
  onApplyRestoredCloudSettings,
  onOpenOnboardingModal,
  onLogoutProvider,
}) => {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [selectedRadioTag, setSelectedRadioTag] = useState<string>('rock');
  const [fetchingCloudSource, setFetchingCloudSource] = useState<string | null>(
    null
  );
  const [showAddSourcePicker, setShowAddSourcePicker] =
    useState<boolean>(false);
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>(
    {}
  );
  const [confirmingLogoutType, setConfirmingLogoutType] =
    useState<ProviderType | null>(null);

  const jellyfinProvider =
    providers.find((p) => p.type === 'jellyfin') || providers[0];

  const jellyfinDisplayPrefsEndpoint = jellyfinProvider?.serverUrl?.trim()
    ? buildJellyfinDisplayPrefsUrl(
        jellyfinProvider.serverUrl,
        jellyfinProvider.userId || jellyfinProvider.username || 'admin',
        jellyfinProvider.token
      )
    : '/DisplayPreferences/brokeify?client=Brokeify';

  const handleFieldChange = (
    id: string,
    field: keyof ProviderConfig,
    value: string | boolean
  ) => {
    const next = providers.map((p) =>
      p.id === id ? { ...p, [field]: value } : p
    );
    onUpdateProviders(next);
  };

  const handleSecretChange = (prov: ProviderConfig, rawValue: string) => {
    const next = providers.map((p) => {
      if (p.id !== prov.id) return p;
      if (p.type === 'plex') {
        return { ...p, token: rawValue, password: rawValue };
      }
      return {
        ...p,
        password: rawValue,
        token: '',
        authMode: 'password' as const,
      };
    });
    onUpdateProviders(next);
  };

  const handleClearSecret = (prov: ProviderConfig) => {
    if (prov.type === 'jellyfin') {
      try {
        localStorage.removeItem('jellyfin_token');
        localStorage.removeItem('jellyfin_user_id');
      } catch {
        // ignore
      }
    }
    const next = providers.map((p) =>
      p.id === prov.id
        ? {
            ...p,
            password: '',
            token: '',
            userId: '',
            status: 'disconnected' as const,
            diagnosticLog: 'Cleared saved credentials from localStorage.',
            lastMessage: 'Cleared saved credentials.',
          }
        : p
    );
    onUpdateProviders(next);
  };

  const toggleSecretVisibility = (id: string) => {
    setVisibleSecrets((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleActivateHiddenSource = (provId: string) => {
    const next = providers.map((p) =>
      p.id === provId ? { ...p, enabled: true } : p
    );
    onUpdateProviders(next);
  };

  const handleTestAndSync = async (provider: ProviderConfig) => {
    setTestingId(provider.id);
    try {
      if (provider.type === 'jellyfin' || provider.type === 'emby') {
        const {
          updatedConfig,
          tracks,
          playlists: syncedPlaylists,
          restoredCloudSettings,
        } = await MusicProviderManager.fetchJellyfinMusic(provider);

        // Auto-turn OFF Built-In Demo Tracks once Jellyfin connects with real songs
        const shouldDisableDemo =
          provider.type === 'jellyfin' &&
          updatedConfig.status === 'connected' &&
          tracks.length > 0;

        const updatedList = providers.map((p) => {
          if (p.id === provider.id) return updatedConfig;
          if (shouldDisableDemo && p.type === 'built-in') {
            return {
              ...p,
              enabled: false,
              lastMessage:
                'Auto-disabled so only your real Jellyfin library & playlists appear.',
            };
          }
          return p;
        });

        onUpdateProviders(updatedList);
        if (tracks.length > 0) {
          onMergeRemoteTracks(tracks, provider.name);
        }
        if (syncedPlaylists.length > 0) {
          onMergeRemotePlaylists(syncedPlaylists);
        }

        if (
          provider.type === 'jellyfin' &&
          updatedConfig.status === 'connected'
        ) {
          if (restoredCloudSettings) {
            onApplyRestoredCloudSettings(restoredCloudSettings);
          } else {
            await onPullCloudSettings(updatedConfig);
          }
        }
      } else if (provider.type === 'navidrome') {
        const { updatedConfig, tracks } =
          await MusicProviderManager.connectNavidrome(provider);
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updatedConfig : p))
        );
        if (tracks.length > 0) {
          onMergeRemoteTracks(tracks, provider.name);
        }
      } else if (provider.type === 'plex') {
        const { updatedConfig, tracks } =
          await MusicProviderManager.connectPlex(provider);
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updatedConfig : p))
        );
        if (tracks.length > 0) {
          onMergeRemoteTracks(tracks, provider.name);
        }
      } else if (provider.type === 'radio-browser') {
        const tracks = await MusicProviderManager.fetchRadioBrowserStations(
          selectedRadioTag
        );
        const msg = `✅ Connected! Loaded ${tracks.length} live ${selectedRadioTag.toUpperCase()} stations`;
        const updated: ProviderConfig = {
          ...provider,
          enabled: true,
          status: 'connected',
          lastMessage: msg,
          diagnosticLog: msg,
          trackCount: tracks.length,
        };
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updated : p))
        );
        onMergeRemoteTracks(tracks, `Radio-Browser (${selectedRadioTag})`);
      } else if (provider.type === 'internet-archive') {
        const tracks =
          await MusicProviderManager.fetchInternetArchiveTracks();
        const msg = `✅ Connected! Loaded ${tracks.length} lossless/VBR live concert recordings`;
        const updated: ProviderConfig = {
          ...provider,
          enabled: true,
          status: 'connected',
          lastMessage: msg,
          diagnosticLog: msg,
          trackCount: tracks.length,
        };
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updated : p))
        );
        onMergeRemoteTracks(tracks, 'Internet Archive');
      } else {
        const msg =
          '✅ Connected! Loaded 8 built-in synthwave & car-test tracks';
        const updated: ProviderConfig = {
          ...provider,
          enabled: true,
          status: 'connected',
          lastMessage: msg,
          diagnosticLog: msg,
        };
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updated : p))
        );
      }
    } finally {
      setTestingId(null);
    }
  };

  const handleFetchRadioTag = async (tag: string) => {
    setSelectedRadioTag(tag);
    setFetchingCloudSource('radio');
    try {
      const tracks = await MusicProviderManager.fetchRadioBrowserStations(tag);
      onMergeRemoteTracks(tracks, `Radio-Browser (${tag})`);
    } finally {
      setFetchingCloudSource(null);
    }
  };

  const activeProviders = providers.filter((p) => p.enabled);
  const hiddenProviders = providers.filter((p) => !p.enabled);

  const renderConnectorCard = (prov: ProviderConfig) => {
    const isTesting = testingId === prov.id;
    const isJellyfinOrEmby = prov.type === 'jellyfin' || prov.type === 'emby';
    const isSelfHosted = ['jellyfin', 'emby', 'navidrome', 'plex'].includes(
      prov.type
    );
    const currentSecretValue =
      prov.type === 'plex' ? (prov.token ?? '') : (prov.password ?? '');
    const isShowingSecret = Boolean(visibleSecrets[prov.id]);
    const diagnosticText = prov.diagnosticLog || prov.lastMessage;
    const isConnectedSession =
      prov.status === 'connected' || Boolean(prov.token?.trim());

    return (
      <div
        key={prov.id}
        data-testid={`connector-card-${prov.type}`}
        className="rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-5 sm:p-6 flex flex-col justify-between gap-5 transition-colors"
      >
        <div className="space-y-4">
          {/* Card Header + Sliding Toggle Switch */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-zinc-800/90 flex items-center justify-center shrink-0">
                {prov.type === 'navidrome' ? (
                  <HardDrive className="w-5 h-5 text-emerald-400" />
                ) : prov.type === 'radio-browser' ? (
                  <Radio className="w-5 h-5 text-emerald-400" />
                ) : prov.type === 'internet-archive' ? (
                  <Cloud className="w-5 h-5 text-purple-400" />
                ) : prov.type === 'built-in' ? (
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                ) : (
                  <Server className="w-5 h-5 text-purple-400" />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white truncate">
                  {prov.name}
                </h3>
                <p className="text-xs text-zinc-400 font-mono truncate">
                  {isJellyfinOrEmby
                    ? 'Quick Connect or Username & Password'
                    : prov.type === 'navidrome'
                      ? 'Subsonic REST API v1.16.1'
                      : prov.type === 'plex'
                        ? 'Plex Music Server (X-Plex-Token)'
                        : prov.serverUrl}
                </p>
              </div>
            </div>

            <SlidingToggle
              checked={prov.enabled}
              onChange={(nextChecked) =>
                handleFieldChange(prov.id, 'enabled', nextChecked)
              }
              label={prov.enabled ? 'ON' : 'OFF'}
              ariaLabel={`Enable ${prov.name}`}
              testId={`toggle-provider-${prov.type}`}
            />
          </div>

          {/* Active Session Banner + Quick Connect / Log Out Bar for Jellyfin */}
          {prov.type === 'jellyfin' && (
            <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 text-xs">
                {isConnectedSession ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-zinc-200">
                      Signed in as{' '}
                      <strong className="text-emerald-400">
                        {prov.username || 'Jellyfin User'}
                      </strong>
                    </span>
                  </>
                ) : (
                  <span className="text-zinc-400">
                    Sign in with{' '}
                    <strong className="text-zinc-200">Quick Connect</strong> or
                    enter your Username &amp; Password below.
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {onOpenOnboardingModal && (
                  <button
                    type="button"
                    onClick={onOpenOnboardingModal}
                    data-testid="card-jellyfin-quickconnect-btn"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500 hover:text-zinc-950 border border-emerald-500/40 px-2.5 py-1 text-xs font-bold text-emerald-300 transition-colors"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Quick Connect</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Self-Hosted Server Configuration Fields */}
          {isSelfHosted && (
            <div className="space-y-3.5 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Server URL */}
                <div className="sm:col-span-2">
                  <label
                    htmlFor={`url-${prov.id}`}
                    className="block text-xs font-medium text-zinc-400 mb-1"
                  >
                    Server URL
                  </label>
                  <input
                    id={`url-${prov.id}`}
                    type="url"
                    value={prov.serverUrl ?? ''}
                    onChange={(e) =>
                      handleFieldChange(prov.id, 'serverUrl', e.target.value)
                    }
                    placeholder="https://jellyfin.yourdomain.com"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none font-mono"
                  />
                </div>

                {/* Username */}
                {prov.type !== 'plex' && (
                  <div>
                    <label
                      htmlFor={`user-${prov.id}`}
                      className="block text-xs font-medium text-zinc-400 mb-1"
                    >
                      Username
                    </label>
                    <input
                      id={`user-${prov.id}`}
                      type="text"
                      value={prov.username ?? ''}
                      onChange={(e) =>
                        handleFieldChange(prov.id, 'username', e.target.value)
                      }
                      placeholder="Enter username (e.g., admin)"
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                )}

                {/* Password with Clear (X) and Show/Hide (Eye) buttons */}
                <div className={prov.type === 'plex' ? 'sm:col-span-2' : ''}>
                  <label
                    htmlFor={`token-${prov.id}`}
                    className="block text-xs font-medium text-zinc-400 mb-1"
                  >
                    {prov.type === 'plex'
                      ? 'X-Plex-Token'
                      : 'Password'}
                  </label>
                  <div className="relative flex items-center">
                    <input
                      id={`token-${prov.id}`}
                      type={isShowingSecret ? 'text' : 'password'}
                      value={currentSecretValue}
                      onChange={(e) => handleSecretChange(prov, e.target.value)}
                      placeholder={
                        prov.type === 'plex'
                          ? 'Paste your X-Plex-Token...'
                          : isConnectedSession && !currentSecretValue
                            ? 'Authenticated via Session Token (or enter password)'
                            : 'Enter your password...'
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 pl-3.5 pr-20 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none font-mono"
                    />

                    <div className="absolute right-1.5 flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => handleClearSecret(prov)}
                        aria-label={`Clear saved password for ${prov.name}`}
                        title="Clear password"
                        data-testid={`clear-secret-${prov.type}`}
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-rose-400 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleSecretVisibility(prov.id)}
                        aria-label={
                          isShowingSecret
                            ? `Hide password for ${prov.name}`
                            : `Show password for ${prov.name}`
                        }
                        title={
                          isShowingSecret ? 'Hide password' : 'Show password'
                        }
                        data-testid={`toggle-show-secret-${prov.type}`}
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                      >
                        {isShowingSecret ? (
                          <EyeOff className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Radio-Browser Genre Tags */}
          {prov.type === 'radio-browser' && (
            <div className="pt-1">
              <p className="text-xs text-zinc-400 mb-2">
                Fetch live stations by genre tag:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {RADIO_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleFetchRadioTag(tag)}
                    disabled={fetchingCloudSource === 'radio'}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[36px] ${
                      selectedRadioTag === tag
                        ? 'bg-emerald-500 text-zinc-950 font-semibold'
                        : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-800 hover:text-white'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Row + Live Diagnostic Log */}
        <div className="space-y-3 pt-3 border-t border-zinc-800/60">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-mono text-zinc-400 tabular-nums">
              {prov.trackCount !== undefined && prov.trackCount > 0
                ? `${prov.trackCount} tracks${
                    prov.playlistCount
                      ? ` & ${prov.playlistCount} playlists`
                      : ''
                  } mounted`
                : `Status: ${prov.status.toUpperCase()}`}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleTestAndSync(prov)}
                disabled={isTesting}
                data-testid={`test-connection-${prov.type}`}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-bold text-zinc-950 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                {isTesting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>
                  {isConnectedSession && !currentSecretValue
                    ? 'Sync Library & Playlists'
                    : 'Connect & Save'}
                </span>
              </button>
            </div>
          </div>

          {/* Live Diagnostic Log Box beneath Connect & Save */}
          <div
            data-testid={`diagnostic-log-${prov.type}`}
            className={`rounded-xl border px-3.5 py-2.5 text-xs font-mono leading-relaxed flex items-start gap-2 ${
              prov.status === 'error'
                ? 'border-rose-500/40 bg-rose-950/30 text-rose-300'
                : prov.status === 'connected'
                  ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-950/80 text-zinc-400'
            }`}
          >
            {prov.status === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            ) : prov.status === 'connected' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <Terminal className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
            )}
            <span className="break-words">{diagnosticText}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Section 1: Active Music Sources (Only active connectors are shown; others stay hidden until activated) */}
      <section
        aria-labelledby="active-connectors-heading"
        className="space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
          <div>
            <h2
              id="active-connectors-heading"
              className="text-xl font-bold text-white tracking-tight"
            >
              Active Music Sources ({activeProviders.length} Enabled)
            </h2>
            <p className="text-sm text-zinc-400 mt-0.5">
              Sign in with Quick Connect or your Username &amp; Password.
              Additional sources stay tucked away until you activate them.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {onOpenOnboardingModal && (
              <button
                type="button"
                onClick={onOpenOnboardingModal}
                data-testid="sources-open-onboarding-btn"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-bold text-zinc-950 transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Quick Connect / Login</span>
              </button>
            )}

            {hiddenProviders.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAddSourcePicker(!showAddSourcePicker)}
                data-testid="toggle-add-sources-picker"
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-emerald-500/50 hover:text-white px-3.5 py-2 text-xs font-semibold text-zinc-200 transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  {showAddSourcePicker
                    ? 'Hide Extra Sources'
                    : `Activate Another Source (${hiddenProviders.length})`}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Compact Pop-Out Picker for Hidden Connectors */}
        {showAddSourcePicker && hiddenProviders.length > 0 && (
          <div
            data-testid="hidden-sources-picker"
            className="rounded-2xl border border-emerald-500/30 bg-zinc-900/60 p-4 space-y-2.5"
          >
            <div className="text-xs font-semibold text-zinc-300">
              Select a music source to activate its connector card:
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hiddenProviders.map((hp) => (
                <button
                  key={hp.id}
                  type="button"
                  onClick={() => handleActivateHiddenSource(hp.id)}
                  data-testid={`activate-source-${hp.type}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 hover:border-emerald-500 hover:bg-emerald-500/15 px-3.5 py-2 text-xs font-bold text-white transition-all"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{hp.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeProviders.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-8 text-center space-y-3">
            <p className="text-sm text-zinc-300 font-semibold">
              No music sources are currently active.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {hiddenProviders.map((hp) => (
                <button
                  key={hp.id}
                  type="button"
                  onClick={() => handleActivateHiddenSource(hp.id)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3.5 py-2 text-xs font-bold text-zinc-950 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Activate {hp.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {activeProviders.map((prov) => renderConnectorCard(prov))}
          </div>
        )}
      </section>

      {/* Section 2: Zero-Logout Persistence & Jellyfin Cloud Settings Sync */}
      <section
        aria-labelledby="cloud-sync-heading"
        className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6 space-y-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <Lock className="w-5 h-5 text-emerald-400 shrink-0" />
              <h2
                id="cloud-sync-heading"
                className="text-lg font-bold text-white tracking-tight"
              >
                Zero-Logout Persistence &amp; Jellyfin Cloud Settings Sync
              </h2>
            </div>
            <p className="text-xs text-zinc-400">
              Automatically backs up and restores your EQ presets, Car Mode
              leveler, extra server configs, and playlists via Jellyfin&apos;s
              native DisplayPreferences endpoint.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onPullCloudSettings()}
              disabled={cloudSyncStatus.state === 'syncing'}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-3.5 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <CloudDownload className="w-4 h-4 text-emerald-400" />
              <span>Pull &amp; Restore from Jellyfin</span>
            </button>

            <button
              type="button"
              onClick={onPushCloudSettings}
              disabled={cloudSyncStatus.state === 'syncing'}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-bold text-zinc-950 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <CloudUpload className="w-4 h-4" />
              <span>Push Settings to Jellyfin</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 space-y-1">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Android Chrome Storage Lock</span>
            </div>
            <p
              className="text-zinc-400 font-mono"
              data-testid="storage-persist-status"
            >
              {storagePersistStatus.message}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 space-y-1">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-purple-400 shrink-0" />
              <span>Zero-Logout Auth Token Guard</span>
            </div>
            <p className="text-zinc-400">
              Saved Jellyfin, Navidrome, Emby &amp; Plex tokens are never
              cleared on network timeout or offline errors.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 space-y-1">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <Cloud className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Jellyfin DisplayPreferences Sync</span>
            </div>
            <p
              className="text-emerald-400 font-mono truncate"
              title={jellyfinDisplayPrefsEndpoint}
              data-testid="jellyfin-cloud-sync-endpoint"
            >
              {jellyfinDisplayPrefsEndpoint}
            </p>
            <p
              className="text-zinc-400"
              data-testid="cloud-sync-status-message"
            >
              {cloudSyncStatus.message}
            </p>
          </div>
        </div>
      </section>

      {/* Section 3: Tucked-Away Account & Session Controls (Safe 2-Step Sign Out at Bottom) */}
      <section
        aria-labelledby="account-session-heading"
        data-testid="account-session-footer"
        className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="space-y-1">
          <h3
            id="account-session-heading"
            className="text-sm font-bold text-zinc-200 flex items-center gap-2"
          >
            <LogOut className="w-4 h-4 text-zinc-400 shrink-0" />
            <span>Account &amp; Session Management</span>
          </h3>
          <p className="text-xs text-zinc-400">
            Need to switch accounts or reset your server login? Sign out safely below (requires 2-tap confirmation so you never hit it by accident).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {activeProviders
            .filter((p) =>
              ['jellyfin', 'emby', 'navidrome', 'plex'].includes(p.type)
            )
            .map((prov) => {
              const isConfirming = confirmingLogoutType === prov.type;
              return isConfirming ? (
                <div
                  key={`logout-confirm-${prov.id}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-500/50 bg-rose-950/40 p-1.5"
                >
                  <span className="text-xs font-semibold text-rose-200 px-2">
                    Sign out of {prov.name}?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingLogoutType(null);
                      if (onLogoutProvider) {
                        onLogoutProvider(prov.type);
                      } else {
                        handleClearSecret(prov);
                      }
                    }}
                    data-testid={`confirm-logout-provider-${prov.type}`}
                    className="rounded-lg bg-rose-500 hover:bg-rose-400 px-3 py-1.5 text-xs font-bold text-white transition-colors"
                  >
                    Yes, Log Out
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingLogoutType(null)}
                    data-testid={`cancel-logout-provider-${prov.type}`}
                    className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  key={`logout-btn-${prov.id}`}
                  type="button"
                  onClick={() => setConfirmingLogoutType(prov.type)}
                  data-testid={`logout-provider-${prov.type}`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 hover:border-rose-500/40 hover:text-rose-300 px-3.5 py-2 text-xs font-semibold text-zinc-400 transition-colors min-h-[38px]"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Log Out of {prov.name}</span>
                </button>
              );
            })}
        </div>
      </section>
    </div>
  );
};
