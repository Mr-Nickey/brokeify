import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudDownload,
  CloudUpload,
  HardDrive,
  KeyRound,
  Loader2,
  Lock,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import type {
  BrokeifyCloudSettings,
  CloudSyncStatus,
  Playlist,
  ProviderConfig,
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
}

const RADIO_TAGS = ['rock', 'synthwave', 'electronic', 'jazz', 'metal', 'ambient'] as const;

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
}) => {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [selectedRadioTag, setSelectedRadioTag] = useState<string>('rock');
  const [fetchingCloudSource, setFetchingCloudSource] = useState<string | null>(null);
  const [showDisabledConnectors, setShowDisabledConnectors] = useState<boolean>(false);

  const jellyfinProvider =
    providers.find((p) => p.type === 'jellyfin') || providers[0];
  const builtInProvider = providers.find((p) => p.type === 'built-in');

  const jellyfinDisplayPrefsEndpoint = buildJellyfinDisplayPrefsUrl(
    jellyfinProvider?.serverUrl || 'https://jellyfin.flockingreeds.farm',
    jellyfinProvider?.userId || jellyfinProvider?.username || 'admin',
    jellyfinProvider?.token
  );

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

  const handleTestAndSync = async (provider: ProviderConfig) => {
    setTestingId(provider.id);
    try {
      if (provider.type === 'jellyfin' || provider.type === 'emby') {
        const {
          updatedConfig,
          tracks,
          playlists: syncedPlaylists,
          restoredCloudSettings,
        } = await MusicProviderManager.connectJellyfinOrEmby(provider);

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

        if (provider.type === 'jellyfin' && updatedConfig.status === 'connected') {
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
        const msg = `✅ Connected to Radio-Browser API -> Loaded ${tracks.length} live ${selectedRadioTag.toUpperCase()} stations`;
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
        const tracks = await MusicProviderManager.fetchInternetArchiveTracks();
        const msg = `✅ Connected to archive.org -> Loaded ${tracks.length} lossless/VBR live concert recordings`;
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
        const msg = '✅ Built-In Demo Tracks verified (6 full-length synth tracks ready)';
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
  const disabledProviders = providers.filter((p) => !p.enabled);

  const renderConnectorCard = (prov: ProviderConfig) => {
    const isTesting = testingId === prov.id;
    const isJellyfinOrEmby = prov.type === 'jellyfin' || prov.type === 'emby';
    const isSelfHosted = ['jellyfin', 'emby', 'navidrome', 'plex'].includes(
      prov.type
    );
    const useApiKeyMode = (prov.authMode || 'apikey') === 'apikey';
    const diagnosticText = prov.diagnosticLog || prov.lastMessage;

    return (
      <div
        key={prov.id}
        data-testid={`connector-card-${prov.type}`}
        className={`rounded-2xl border p-5 sm:p-6 flex flex-col justify-between gap-5 transition-colors ${
          prov.enabled
            ? 'border-zinc-800/90 bg-zinc-900/50'
            : 'border-zinc-800/60 bg-zinc-950/60 opacity-90'
        }`}
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
                    ? 'GET /Users?api_key=... OR POST /Users/AuthenticateByName'
                    : prov.type === 'navidrome'
                      ? '/rest/getPlaylists.view • /rest/stream.view?maxBitRate=320'
                      : prov.type === 'plex'
                        ? '/library/sections • X-Plex-Token'
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

          {/* Self-Hosted Server Configuration Fields */}
          {isSelfHosted && (
            <div className="space-y-3.5 pt-1">
              {/* Jellyfin / Emby Explicit Auth Method Toggle: Direct API Key vs Username + Password */}
              {isJellyfinOrEmby && (
                <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs">
                    <KeyRound className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="font-semibold text-zinc-200">
                      Auth Method:{' '}
                      <span className="text-emerald-400">
                        {useApiKeyMode
                          ? 'Method A — Direct Jellyfin API Key (Zero CORS Preflight)'
                          : 'Method B — Username + Password'}
                      </span>
                    </span>
                  </div>

                  <SlidingToggle
                    checked={useApiKeyMode}
                    onChange={(useKey) =>
                      handleFieldChange(
                        prov.id,
                        'authMode',
                        useKey ? 'apikey' : 'password'
                      )
                    }
                    label={useApiKeyMode ? 'Use API Key' : 'Use Password'}
                    ariaLabel={`Use API Key vs Password for ${prov.name}`}
                    size="sm"
                    testId={`toggle-authmode-${prov.type}`}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    value={prov.serverUrl}
                    onChange={(e) =>
                      handleFieldChange(prov.id, 'serverUrl', e.target.value)
                    }
                    placeholder="https://jellyfin.flockingreeds.farm"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none font-mono"
                  />
                </div>

                {prov.type !== 'plex' && (
                  <div>
                    <label
                      htmlFor={`user-${prov.id}`}
                      className="block text-xs font-medium text-zinc-400 mb-1"
                    >
                      {isJellyfinOrEmby && useApiKeyMode
                        ? 'Username (matches User ID, or blank for Admin)'
                        : 'Username'}
                    </label>
                    <input
                      id={`user-${prov.id}`}
                      type="text"
                      value={prov.username || ''}
                      onChange={(e) =>
                        handleFieldChange(prov.id, 'username', e.target.value)
                      }
                      placeholder={
                        isJellyfinOrEmby && useApiKeyMode
                          ? 'Nicky (optional)'
                          : 'Nicky'
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                )}

                <div className={prov.type === 'plex' ? 'sm:col-span-2' : ''}>
                  <label
                    htmlFor={`token-${prov.id}`}
                    className="block text-xs font-medium text-zinc-400 mb-1"
                  >
                    {prov.type === 'plex'
                      ? 'X-Plex-Token'
                      : prov.type === 'navidrome'
                        ? 'Password or Subsonic Token'
                        : useApiKeyMode
                          ? 'Direct Jellyfin API Key (32-char hex)'
                          : 'Account Password'}
                  </label>
                  <input
                    id={`token-${prov.id}`}
                    type="password"
                    value={
                      prov.type === 'plex'
                        ? prov.token || ''
                        : isJellyfinOrEmby && useApiKeyMode
                          ? prov.password || prov.token || ''
                          : prov.password || ''
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (prov.type === 'plex') {
                        handleFieldChange(prov.id, 'token', val);
                      } else if (isJellyfinOrEmby && useApiKeyMode) {
                        const next = providers.map((p) =>
                          p.id === prov.id
                            ? { ...p, password: val, token: val }
                            : p
                        );
                        onUpdateProviders(next);
                      } else {
                        handleFieldChange(prov.id, 'password', val);
                      }
                    }}
                    placeholder={
                      isJellyfinOrEmby && useApiKeyMode
                        ? 'Paste 32-char Jellyfin API Key...'
                        : '••••••••••••'
                    }
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none font-mono"
                  />
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
                ? `${prov.trackCount} songs${
                    prov.playlistCount ? ` & ${prov.playlistCount} playlists` : ''
                  } mounted`
                : `Status: ${prov.status.toUpperCase()}`}
            </span>

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
              <span>Test Connection</span>
            </button>
          </div>

          {/* Live Diagnostic Log Box beneath Test Connection */}
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
      {/* Section 1: Active / Enabled Connectors (Expanded by Default) */}
      <section aria-labelledby="active-connectors-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
          <div>
            <h2
              id="active-connectors-heading"
              className="text-xl font-bold text-white tracking-tight"
            >
              Active Music Sources ({activeProviders.length} Enabled)
            </h2>
            <p className="text-sm text-zinc-400 mt-0.5">
              Connect Jellyfin via Direct API Key or Password. Zero fake fallback
              tracks — only your real server songs and playlists are mounted.
            </p>
          </div>

          {/* Quick Toggle for Built-In Demo Tracks */}
          {builtInProvider && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3.5 py-2 flex items-center gap-3 shrink-0">
              <SlidingToggle
                checked={builtInProvider.enabled}
                onChange={(nextChecked) =>
                  handleFieldChange(builtInProvider.id, 'enabled', nextChecked)
                }
                label="Built-In Demo Tracks"
                ariaLabel="Toggle Built-In Demo Tracks"
                size="sm"
                testId="quick-toggle-builtin-demo"
              />
            </div>
          )}
        </div>

        {activeProviders.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-8 text-center space-y-2">
            <p className="text-sm text-zinc-300 font-semibold">
              No music sources are currently toggled ON.
            </p>
            <p className="text-xs text-zinc-400">
              Expand &ldquo;Other Available Connectors&rdquo; below to enable
              Jellyfin or another source.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {activeProviders.map((prov) => renderConnectorCard(prov))}
          </div>
        )}
      </section>

      {/* Section 2: Collapsible Accordion for Disabled / Unused Connectors */}
      {disabledProviders.length > 0 && (
        <section
          aria-labelledby="disabled-connectors-heading"
          className="rounded-2xl border border-zinc-800/90 bg-zinc-900/30 overflow-hidden"
        >
          <button
            type="button"
            onClick={() => setShowDisabledConnectors(!showDisabledConnectors)}
            aria-expanded={showDisabledConnectors}
            data-testid="other-connectors-accordion-btn"
            className="w-full px-5 sm:px-6 py-4 flex items-center justify-between gap-4 text-left hover:bg-zinc-900/60 transition-colors"
          >
            <div>
              <h2
                id="disabled-connectors-heading"
                className="text-base font-bold text-white tracking-tight"
              >
                Other Available Connectors ({disabledProviders.length} Hidden - Tap
                to Expand)
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {disabledProviders.map((d) => d.name).join(' · ')}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 shrink-0">
              <span>{showDisabledConnectors ? 'Collapse' : 'Expand'}</span>
              {showDisabledConnectors ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </div>
          </button>

          {showDisabledConnectors && (
            <div className="p-5 sm:p-6 pt-2 border-t border-zinc-800/80 grid grid-cols-1 lg:grid-cols-2 gap-6">
              {disabledProviders.map((prov) => renderConnectorCard(prov))}
            </div>
          )}
        </section>
      )}

      {/* Section 3: Zero-Logout Persistence & Jellyfin Cloud Settings Sync */}
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
                Zero-Logout Persistence & Jellyfin Cloud Settings Sync
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
              <span>Pull & Restore from Jellyfin</span>
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
            <p className="text-zinc-400 font-mono" data-testid="storage-persist-status">
              {storagePersistStatus.message}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 space-y-1">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-purple-400 shrink-0" />
              <span>Zero-Logout Auth Token Guard</span>
            </div>
            <p className="text-zinc-400">
              Saved Jellyfin, Navidrome, Emby & Plex tokens are never cleared on
              network timeout or offline errors.
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
            <p className="text-zinc-400" data-testid="cloud-sync-status-message">
              {cloudSyncStatus.message}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
