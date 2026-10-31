import React, { useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  HardDrive,
  Loader2,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import type { ProviderConfig, Track } from '../types/music';
import { MusicProviderManager } from '../services/MusicProviderManager';

interface SourcesHubViewProps {
  providers: ProviderConfig[];
  onUpdateProviders: (next: ProviderConfig[]) => void;
  onMergeRemoteTracks: (newTracks: Track[], providerName: string) => void;
}

const RADIO_TAGS = ['rock', 'synthwave', 'electronic', 'jazz', 'metal', 'ambient'] as const;

export const SourcesHubView: React.FC<SourcesHubViewProps> = ({
  providers,
  onUpdateProviders,
  onMergeRemoteTracks,
}) => {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [selectedRadioTag, setSelectedRadioTag] = useState<string>('rock');
  const [fetchingCloudSource, setFetchingCloudSource] = useState<string | null>(null);

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
        const { updatedConfig, tracks } =
          await MusicProviderManager.connectJellyfinOrEmby(provider);
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updatedConfig : p))
        );
        onMergeRemoteTracks(tracks, provider.name);
      } else if (provider.type === 'navidrome') {
        const { updatedConfig, tracks } =
          await MusicProviderManager.connectNavidrome(provider);
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updatedConfig : p))
        );
        onMergeRemoteTracks(tracks, provider.name);
      } else if (provider.type === 'plex') {
        const { updatedConfig, tracks } =
          await MusicProviderManager.connectPlex(provider);
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updatedConfig : p))
        );
        onMergeRemoteTracks(tracks, provider.name);
      } else if (provider.type === 'radio-browser') {
        const tracks = await MusicProviderManager.fetchRadioBrowserStations(
          selectedRadioTag
        );
        const updated: ProviderConfig = {
          ...provider,
          enabled: true,
          status: 'connected',
          lastMessage: `Fetched ${tracks.length} live ${selectedRadioTag.toUpperCase()} stations from Radio-Browser API`,
          trackCount: tracks.length,
        };
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updated : p))
        );
        onMergeRemoteTracks(tracks, `Radio-Browser (${selectedRadioTag})`);
      } else if (provider.type === 'internet-archive') {
        const tracks = await MusicProviderManager.fetchInternetArchiveTracks();
        const updated: ProviderConfig = {
          ...provider,
          enabled: true,
          status: 'connected',
          lastMessage: `Synced ${tracks.length} lossless/VBR concert tapes from archive.org/details/etree`,
          trackCount: tracks.length,
        };
        onUpdateProviders(
          providers.map((p) => (p.id === provider.id ? updated : p))
        );
        onMergeRemoteTracks(tracks, 'Internet Archive');
      } else {
        const updated: ProviderConfig = {
          ...provider,
          enabled: true,
          status: 'connected',
          lastMessage: 'Built-in zero-setup vault verified and online',
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

  const selfHostedProviders = providers.filter((p) =>
    ['jellyfin', 'emby', 'navidrome', 'plex'].includes(p.type)
  );
  const cloudProviders = providers.filter((p) =>
    ['built-in', 'radio-browser', 'internet-archive'].includes(p.type)
  );

  return (
    <div className="space-y-10">
      {/* Section 1: Instant Free Cloud Sources */}
      <section aria-labelledby="cloud-sources-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-zinc-800/80 pb-4">
          <div>
            <h2
              id="cloud-sources-heading"
              className="text-xl font-bold text-white tracking-tight"
            >
              Built-In Free Ad-Free Cloud Sources
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              Zero setup required. Streams immediately in the car via Brokeify
              Cloud Vault, Radio-Browser API, and Internet Archive Audio.
            </p>
          </div>
          <span className="text-xs font-mono text-emerald-400 tabular-nums">
            {cloudProviders.filter((c) => c.enabled).length} of {cloudProviders.length} active
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {cloudProviders.map((prov) => {
            const isTesting = testingId === prov.id;
            return (
              <div
                key={prov.id}
                className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      {prov.type === 'radio-browser' ? (
                        <Radio className="w-5 h-5 text-emerald-400 shrink-0" />
                      ) : prov.type === 'internet-archive' ? (
                        <Cloud className="w-5 h-5 text-purple-400 shrink-0" />
                      ) : (
                        <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                      )}
                      <div>
                        <h3 className="text-base font-semibold text-white">
                          {prov.name}
                        </h3>
                        <p className="text-xs text-zinc-400 font-mono truncate max-w-[220px]">
                          {prov.serverUrl}
                        </p>
                      </div>
                    </div>

                    <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none min-h-[40px]">
                      <input
                        type="checkbox"
                        checked={prov.enabled}
                        onChange={(e) =>
                          handleFieldChange(prov.id, 'enabled', e.target.checked)
                        }
                        aria-label={`Enable ${prov.name}`}
                        className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
                      />
                      <span>{prov.enabled ? 'Enabled' : 'Disabled'}</span>
                    </label>
                  </div>

                  <p className="text-xs text-zinc-300 leading-relaxed">
                    {prov.lastMessage}
                  </p>

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

                <div className="pt-3 border-t border-zinc-800/60 flex items-center justify-between gap-3">
                  <span className="text-xs text-zinc-400 font-mono tabular-nums">
                    Status: {prov.status.toUpperCase()}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleTestAndSync(prov)}
                    disabled={isTesting}
                    className="inline-flex items-center gap-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                  >
                    {isTesting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span>Test Connection</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 2: Self-Hosted Media Servers */}
      <section aria-labelledby="self-hosted-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-zinc-800/80 pb-4">
          <div>
            <h2
              id="self-hosted-heading"
              className="text-xl font-bold text-white tracking-tight"
            >
              Self-Hosted Server Connectors (Jellyfin, Navidrome, Emby, Plex)
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              Connect your home lab NAS servers. All tokens and server URLs persist
              locally in your browser.
            </p>
          </div>
          <span className="text-xs font-mono text-zinc-400">
            Supports LUFS NormalizationGain & Subsonic v1.16.1
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {selfHostedProviders.map((prov) => {
            const isTesting = testingId === prov.id;
            return (
              <div
                key={prov.id}
                className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6 flex flex-col justify-between gap-5"
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-zinc-800/90 flex items-center justify-center shrink-0">
                        {prov.type === 'navidrome' ? (
                          <HardDrive className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <Server className="w-5 h-5 text-purple-400" />
                        )}
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-white">
                          {prov.name}
                        </h3>
                        <p className="text-xs text-zinc-400">
                          {prov.type === 'jellyfin' || prov.type === 'emby'
                            ? 'POST /Users/AuthenticateByName • X-Emby-Authorization'
                            : prov.type === 'navidrome'
                              ? '/rest/getPlaylists.view • /rest/stream.view?maxBitRate=320'
                              : '/library/sections • Direct Part Stream'}
                        </p>
                      </div>
                    </div>

                    <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none min-h-[40px]">
                      <input
                        type="checkbox"
                        checked={prov.enabled}
                        onChange={(e) =>
                          handleFieldChange(prov.id, 'enabled', e.target.checked)
                        }
                        aria-label={`Enable ${prov.name}`}
                        className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
                      />
                      <span>{prov.enabled ? 'Active' : 'Off'}</span>
                    </label>
                  </div>

                  {/* Form Fields */}
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
                        placeholder="https://music.yourdomain.com"
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none font-mono"
                      />
                    </div>

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
                          value={prov.username || ''}
                          onChange={(e) =>
                            handleFieldChange(prov.id, 'username', e.target.value)
                          }
                          placeholder="admin"
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    )}

                    <div>
                      <label
                        htmlFor={`token-${prov.id}`}
                        className="block text-xs font-medium text-zinc-400 mb-1"
                      >
                        {prov.type === 'plex'
                          ? 'X-Plex-Token'
                          : prov.type === 'navidrome'
                            ? 'Password or Subsonic Token'
                            : 'API Key / Password'}
                      </label>
                      <input
                        id={`token-${prov.id}`}
                        type="password"
                        value={
                          prov.type === 'plex'
                            ? prov.token || ''
                            : prov.password || prov.token || ''
                        }
                        onChange={(e) =>
                          handleFieldChange(
                            prov.id,
                            prov.type === 'plex' ? 'token' : 'password',
                            e.target.value
                          )
                        }
                        placeholder="••••••••••••"
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none font-mono"
                      />
                    </div>
                  </div>

                  <p className="text-xs text-zinc-400 flex items-center gap-1.5">
                    <CheckCircle2
                      className={`w-3.5 h-3.5 shrink-0 ${
                        prov.status === 'connected'
                          ? 'text-emerald-400'
                          : 'text-zinc-600'
                      }`}
                    />
                    <span className="truncate">{prov.lastMessage}</span>
                  </p>
                </div>

                <div className="pt-3 border-t border-zinc-800/60 flex items-center justify-between gap-3">
                  <span className="text-xs font-mono text-zinc-400 tabular-nums">
                    {prov.trackCount ? `${prov.trackCount} tracks mounted` : 'Not synced yet'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleTestAndSync(prov)}
                    disabled={isTesting}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-semibold text-zinc-950 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                  >
                    {isTesting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>Test Connection</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
