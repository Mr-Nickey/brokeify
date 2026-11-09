import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  FolderOpen,
  HardDrive,
  Loader2,
  Network,
  RefreshCw,
  Server,
  Terminal,
  X,
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

type DriveSetupTab = 'connect-path' | 'docker-compose' | 'nas-network';

interface DriveInspectionStatus {
  musicDir: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  isDirectory: boolean;
  topLevelFolders: string[];
  audioFileCount: number;
  playlistFileCount: number;
  driveConnected: boolean;
  error?: string;
}

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

const DOCKER_COMPOSE_LOCAL_EXAMPLE = `services:
  brokeify:
    build: https://github.com/Mr-Nickey/brokeify.git#main
    container_name: brokeify
    restart: unless-stopped
    ports:
      - 3487:3487
    environment:
      - NODE_ENV=production
      - PORT=3487
      - BROKEIFY_DATA_DIR=/data
      - BROKEIFY_MUSIC_DIR=/music
      - SLSKD_URL=http://192.168.1.175:5030
      - SLSKD_API_KEY=your_slskd_api_key
      - LISTENBRAINZ_USER=your_username
    volumes:
      # 1. Persistent SQLite database (/data/brokeify.db), cover cache & config.json
      - /c/docker/brokeify/data:/data
      # 2. Mount your hard drive / music folder into /music inside the container:
      #    Windows / Dockge WSL2 example: /d/Message:/music:rw  (or D:/Message:/music:rw)
      #    Linux host example:            /mnt/music:/music:rw
      - /d/Message:/music:rw
networks: {}`;

const DOCKER_COMPOSE_NAS_SMB_EXAMPLE = `services:
  brokeify:
    build: https://github.com/Mr-Nickey/brokeify.git#main
    container_name: brokeify
    restart: unless-stopped
    ports:
      - 3487:3487
    environment:
      - NODE_ENV=production
      - PORT=3487
      - BROKEIFY_DATA_DIR=/data
      - BROKEIFY_MUSIC_DIR=/music
    volumes:
      - ./data:/data
      - nas_music:/music:rw

volumes:
  nas_music:
    driver: local
    driver_opts:
      type: cifs
      o: "username=YOUR_NAS_USER,password=YOUR_NAS_PASSWORD,vers=3.0,uid=1000,gid=1000,iocharset=utf8"
      device: "//192.168.1.200/Music"`;

const DOCKER_COMPOSE_NAS_NFS_EXAMPLE = `volumes:
  nas_music:
    driver: local
    driver_opts:
      type: nfs
      o: "addr=192.168.1.200,rw,nfsvers=4,nolock,soft"
      device: ":/volume1/Music"`;

export const BrokeifyOnboardingModal: React.FC<BrokeifyOnboardingModalProps> = ({
  isOpen,
  providers,
  onUpdateProviders,
  onMergeRemoteTracks,
  onMergeRemotePlaylists,
  onShowToast,
  onCompleteAndLaunchLibrary,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<DriveSetupTab>('connect-path');
  const [driveStatus, setDriveStatus] = useState<DriveInspectionStatus | null>(
    null
  );
  const [loadingStatus, setLoadingStatus] = useState<boolean>(false);
  const [customPathInput, setCustomPathInput] = useState<string>('/music');
  const [testingPath, setTestingPath] = useState<boolean>(false);
  const [connectingDrive, setConnectingDrive] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    driveStatus?: DriveInspectionStatus;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fetchCurrentDriveStatus = async () => {
    setLoadingStatus(true);
    try {
      const resp = await fetch('/api/storage/drive-status');
      if (resp.ok) {
        const data = await resp.json();
        if (data.driveStatus) {
          setDriveStatus(data.driveStatus);
          setCustomPathInput(data.driveStatus.musicDir || '/music');
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCurrentDriveStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopySnippet = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleTestPath = async (pathToTest?: string) => {
    const target = (pathToTest ?? customPathInput).trim() || '/music';
    setTestingPath(true);
    setTestResult(null);
    try {
      const resp = await fetch('/api/storage/test-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target }),
      });
      const data = await resp.json().catch(() => ({}));
      setTestResult({
        ok: Boolean(data.ok),
        message:
          data.message ||
          (data.ok
            ? 'Music drive verified!'
            : 'No audio files detected in that directory.'),
        driveStatus: data.driveStatus,
      });
      if (data.driveStatus) {
        setDriveStatus(data.driveStatus);
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err?.message || 'Failed to test folder path on server.',
      });
    } finally {
      setTestingPath(false);
    }
  };

  const handleConnectAndScanDrive = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const target = customPathInput.trim() || '/music';
    setConnectingDrive(true);
    setTestResult(null);
    try {
      const resp = await fetch('/api/storage/connect-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target }),
      });
      const data = await resp.json().catch(() => ({}));
      if (data.driveStatus) {
        setDriveStatus(data.driveStatus);
      }

      const {
        updatedConfig,
        tracks,
        playlists: syncedPlaylists,
      } = await MusicProviderManager.fetchLocalSqliteLibrary(providers[0]);

      onUpdateProviders(
        providers.map((p) =>
          p.id === updatedConfig.id || p.type === 'built-in' ? updatedConfig : p
        )
      );

      if (tracks.length > 0) {
        onMergeRemoteTracks(tracks);
        if (syncedPlaylists.length > 0) {
          onMergeRemotePlaylists(syncedPlaylists);
        }
        MusicProviderManager.markOnboardingCompleted();
        onShowToast(
          `✅ Connected music drive "${target}" (${tracks.length} tracks & ${syncedPlaylists.length} playlists indexed)!`
        );
        onCompleteAndLaunchLibrary();
      } else {
        setTestResult({
          ok: false,
          message:
            data.message ||
            `Connected to "${target}", but 0 audio files (.flac, .mp3, .m4a, .ogg, .opus, .wav, .aac) were found inside it. Mount your music drive in Docker Compose or select a folder that contains your music files.`,
          driveStatus: data.driveStatus,
        });
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err?.message || 'Failed to connect and scan music drive.',
      });
    } finally {
      setConnectingDrive(false);
    }
  };

  const isConnectedWithMusic = Boolean(
    driveStatus?.driveConnected && (driveStatus?.audioFileCount ?? 0) > 0
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#070a0f]/95 backdrop-blur-xl p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="brokeify-onboarding-title"
      data-testid="brokeify-onboarding-modal"
    >
      <div className="relative w-full max-w-4xl rounded-3xl border-2 border-[#00ff66]/40 bg-zinc-950/95 p-5 sm:p-8 shadow-2xl my-auto space-y-6">
        {/* Top Ambient Accent Bar */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-1.5 rounded-t-3xl bg-gradient-to-r from-rose-500 via-[#00ff66] to-cyan-500"
          aria-hidden="true"
        />

        {/* Close Button so user can inspect Settings at any time */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Music Drive Setup Overlay"
          data-testid="close-onboarding-btn"
          className="absolute top-5 right-5 rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex flex-col items-center text-center space-y-2.5 pt-1">
          <BrokeifyLogo size={46} />
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-wider text-amber-300">
              <HardDrive className="w-3.5 h-3.5 text-[#00ff66]" />
              <span>Standalone All-In-One SQLite Music Server</span>
            </div>
            <h1
              id="brokeify-onboarding-title"
              className="text-2xl sm:text-3xl font-bold tracking-tight text-white font-mono"
            >
              {isConnectedWithMusic
                ? 'Music Drive Connected & Active'
                : 'Connect Your Music Drive or NAS'}
            </h1>
            <p className="text-xs sm:text-sm text-zinc-300 max-w-2xl mx-auto leading-relaxed">
              Brokeify has <strong>zero built-in demo songs</strong>. It reads
              your actual audio files (<code className="text-[#00ff66]">.flac</code>,{' '}
              <code className="text-[#00ff66]">.mp3</code>,{' '}
              <code className="text-[#00ff66]">.m4a</code>,{' '}
              <code className="text-[#00ff66]">.ogg</code>,{' '}
              <code className="text-[#00ff66]">.opus</code>,{' '}
              <code className="text-[#00ff66]">.wav</code>,{' '}
              <code className="text-[#00ff66]">.aac</code>) and{' '}
              <code className="text-[#00ff66]">.m3u/.m3u8</code> playlists
              directly from a local folder, mounted hard drive, or NAS share.
            </p>
          </div>
        </div>

        {/* Live Drive Diagnostics Banner */}
        <div
          data-testid="drive-diagnostic-banner"
          className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            isConnectedWithMusic
              ? 'border-emerald-500/50 bg-emerald-950/25 text-emerald-200'
              : 'border-rose-500/60 bg-rose-950/30 text-rose-200'
          }`}
        >
          <div className="flex items-start gap-3">
            {loadingStatus ? (
              <Loader2 className="w-5 h-5 text-amber-400 animate-spin shrink-0 mt-0.5" />
            ) : isConnectedWithMusic ? (
              <CheckCircle2 className="w-5 h-5 text-[#00ff66] shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5 animate-pulse" />
            )}
            <div className="space-y-1 text-xs font-mono">
              <div className="font-bold text-sm text-white">
                {loadingStatus
                  ? 'Checking mounted music drive...'
                  : isConnectedWithMusic
                    ? `✅ DRIVE CONNECTED: ${driveStatus?.audioFileCount} Audio Files Found in ${driveStatus?.musicDir}`
                    : `🚨 NO MUSIC DRIVE DETECTED IN "${driveStatus?.musicDir || '/music'}" (0 Audio Files Found)`}
              </div>
              <p className="text-zinc-300 leading-relaxed">
                {driveStatus ? (
                  <>
                    Path: <code className="text-white">{driveStatus.musicDir}</code>{' '}
                    · Exists:{' '}
                    <strong className={driveStatus.exists ? 'text-[#00ff66]' : 'text-rose-400'}>
                      {driveStatus.exists ? 'YES' : 'NO'}
                    </strong>{' '}
                    · Readable:{' '}
                    <strong className={driveStatus.readable ? 'text-[#00ff66]' : 'text-rose-400'}>
                      {driveStatus.readable ? 'YES' : 'NO'}
                    </strong>{' '}
                    · Subfolders:{' '}
                    <strong className="text-white">
                      {driveStatus.topLevelFolders.length > 0
                        ? driveStatus.topLevelFolders.slice(0, 6).join(', ')
                        : 'None (Empty Folder)'}
                    </strong>
                  </>
                ) : (
                  'Mount your music folder in Docker Compose or enter your host/NAS path below.'
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleConnectAndScanDrive()}
            disabled={connectingDrive}
            data-testid="quick-rescan-drive-btn"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-colors shrink-0 min-h-[40px]"
          >
            {connectingDrive ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>Rescan Drive</span>
          </button>
        </div>

        {/* 3 Setup Tabs */}
        <div
          className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-1.5"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'connect-path'}
            onClick={() => setActiveTab('connect-path')}
            data-testid="tab-drive-connect-path"
            className={`rounded-xl py-2.5 px-3 text-xs font-mono font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'connect-path'
                ? 'bg-[#00ff66] text-zinc-950 shadow-md'
                : 'text-zinc-300 hover:text-white hover:bg-zinc-800/60'
            }`}
          >
            <FolderOpen className="w-4 h-4 shrink-0" />
            <span>1. Connect Folder / Drive Path</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'docker-compose'}
            onClick={() => setActiveTab('docker-compose')}
            data-testid="tab-drive-docker-compose"
            className={`rounded-xl py-2.5 px-3 text-xs font-mono font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'docker-compose'
                ? 'bg-[#00ff66] text-zinc-950 shadow-md'
                : 'text-zinc-300 hover:text-white hover:bg-zinc-800/60'
            }`}
          >
            <Terminal className="w-4 h-4 shrink-0" />
            <span>2. Docker Compose / Dockge Guide</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'nas-network'}
            onClick={() => setActiveTab('nas-network')}
            data-testid="tab-drive-nas-network"
            className={`rounded-xl py-2.5 px-3 text-xs font-mono font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'nas-network'
                ? 'bg-[#00ff66] text-zinc-950 shadow-md'
                : 'text-zinc-300 hover:text-white hover:bg-zinc-800/60'
            }`}
          >
            <Network className="w-4 h-4 shrink-0" />
            <span>3. NAS / SMB / NFS Share Setup</span>
          </button>
        </div>

        {/* ===================================================================
            TAB 1: CONNECT LOCAL / MOUNTED DRIVE PATH IN SETTINGS
           =================================================================== */}
        {activeTab === 'connect-path' && (
          <form
            onSubmit={handleConnectAndScanDrive}
            className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4"
          >
            <div className="space-y-1">
              <h2 className="text-base font-bold text-white font-mono flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-[#00ff66]" />
                <span>Point Brokeify to Your Music Folder or Mounted Drive</span>
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Enter the folder path inside the container (default{' '}
                <code className="text-white">/music</code>) or any local drive /
                NAS mount path on this machine that has folders with your audio
                files. Brokeify will test read access, index your songs into{' '}
                <code className="text-white">/data/brokeify.db</code>, and watch
                for new files automatically.
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="music-drive-path-input"
                className="block text-xs font-mono font-semibold text-zinc-300"
              >
                Music Drive / Folder Path
              </label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <input
                  id="music-drive-path-input"
                  type="text"
                  value={customPathInput}
                  onChange={(e) => setCustomPathInput(e.target.value)}
                  placeholder="/music"
                  data-testid="music-drive-path-input"
                  className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-[#00ff66] focus:outline-none font-mono"
                />

                <button
                  type="button"
                  onClick={() => handleTestPath()}
                  disabled={testingPath || connectingDrive}
                  data-testid="test-drive-path-btn"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#00ff66]/50 bg-[#00ff66]/15 hover:bg-[#00ff66]/25 px-4 py-2.5 text-xs font-mono font-bold text-[#00ff66] transition-colors whitespace-nowrap shrink-0 min-h-[42px]"
                >
                  {testingPath ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Server className="w-4 h-4" />
                  )}
                  <span>Test Folder Path</span>
                </button>

                <button
                  type="submit"
                  disabled={connectingDrive}
                  data-testid="connect-scan-drive-btn"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-5 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-colors whitespace-nowrap shrink-0 min-h-[42px]"
                >
                  {connectingDrive ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>Save &amp; Scan Drive Now</span>
                </button>
              </div>

              {/* Quick Path Presets */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] font-mono text-zinc-400 mr-1">
                  Common Mount Paths:
                </span>
                {[
                  '/music',
                  '/mnt/music',
                  '/mnt/nas/music',
                  '/media/music',
                  '/d/Message',
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setCustomPathInput(preset);
                      handleTestPath(preset);
                    }}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 hover:border-[#00ff66]/50 px-2.5 py-1 text-[11px] font-mono text-zinc-300 hover:text-[#00ff66] transition-colors"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {testResult && (
              <div
                data-testid="drive-test-result"
                className={`rounded-xl border p-3.5 text-xs font-mono space-y-2 ${
                  testResult.ok
                    ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                    : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
                }`}
              >
                <div className="flex items-start gap-2">
                  {testResult.ok ? (
                    <CheckCircle2 className="w-4 h-4 text-[#00ff66] shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <span className="font-bold">{testResult.message}</span>
                </div>
                {testResult.driveStatus && (
                  <div className="pl-6 text-[11px] text-zinc-300 space-y-1">
                    <div>
                      Audio Files Detected:{' '}
                      <strong className="text-white">
                        {testResult.driveStatus.audioFileCount}
                      </strong>{' '}
                      · Playlists (.m3u/.m3u8):{' '}
                      <strong className="text-white">
                        {testResult.driveStatus.playlistFileCount}
                      </strong>
                    </div>
                    {testResult.driveStatus.topLevelFolders.length > 0 && (
                      <div>
                        Detected Subfolders:{' '}
                        <code className="text-[#00ff66]">
                          {testResult.driveStatus.topLevelFolders.join(', ')}
                        </code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </form>
        )}

        {/* ===================================================================
            TAB 2: DOCKER COMPOSE / DOCKGE SETUP GUIDE
           =================================================================== */}
        {activeTab === 'docker-compose' && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-white font-mono">
                  How to Mount Your Drive in Docker Compose / Dockge
                </h2>
                <p className="text-xs text-zinc-400">
                  Bind-mount your host music folder to{' '}
                  <code className="text-[#00ff66]">/music:rw</code> and your
                  persistent database folder to{' '}
                  <code className="text-[#00ff66]">/data</code>.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  handleCopySnippet('compose-local', DOCKER_COMPOSE_LOCAL_EXAMPLE)
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#00ff66]/40 bg-[#00ff66]/15 hover:bg-[#00ff66] hover:text-zinc-950 px-3 py-2 text-xs font-mono font-bold text-[#00ff66] transition-colors"
              >
                {copiedKey === 'compose-local' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied compose.yaml!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy compose.yaml</span>
                  </>
                )}
              </button>
            </div>

            <pre className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed">
              {DOCKER_COMPOSE_LOCAL_EXAMPLE}
            </pre>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 space-y-1.5">
                <div className="text-[#00ff66] font-bold">
                  🪟 Windows / Dockge (WSL2) Drive MountTips
                </div>
                <p className="text-zinc-300 leading-relaxed">
                  If your music is on your Windows <code>D:\Message</code> drive:
                  <br />• In WSL2 / Dockge on Linux VM, use{' '}
                  <code className="text-white">/mnt/d/Message:/music:rw</code> or{' '}
                  <code className="text-white">D:/Message:/music:rw</code>.
                  <br />• If <code>/d/Message</code> appears empty inside the
                  container, switch the left side of the volume to{' '}
                  <code className="text-[#00ff66]">D:/Message:/music:rw</code>{' '}
                  or <code className="text-[#00ff66]">/mnt/d/Message:/music:rw</code>!
                </p>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 space-y-1.5">
                <div className="text-cyan-300 font-bold">
                  🐧 Linux / Unraid / Proxmox Host Mount
                </div>
                <p className="text-zinc-300 leading-relaxed">
                  Point the left side of the volume to wherever your music files
                  live on the host:
                  <br />•{' '}
                  <code className="text-white">/mnt/user/Music:/music:rw</code>{' '}
                  (Unraid)
                  <br />•{' '}
                  <code className="text-white">/mnt/storage/music:/music:rw</code>{' '}
                  (Ubuntu / Debian)
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 3: NAS / NETWORK DRIVE (SMB / CIFS / NFS) SETUP GUIDE
           =================================================================== */}
        {activeTab === 'nas-network' && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-white font-mono">
                  Connect a NAS / Network Share (Synology, TrueNAS, Unraid, SMB/NFS)
                </h2>
                <p className="text-xs text-zinc-400">
                  Docker Compose can mount your NAS network share directly into{' '}
                  <code className="text-[#00ff66]">/music</code> without even
                  mounting it on the host OS first.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  handleCopySnippet('compose-nas', DOCKER_COMPOSE_NAS_SMB_EXAMPLE)
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#00ff66]/40 bg-[#00ff66]/15 hover:bg-[#00ff66] hover:text-zinc-950 px-3 py-2 text-xs font-mono font-bold text-[#00ff66] transition-colors"
              >
                {copiedKey === 'compose-nas' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied SMB NAS Compose!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy SMB/CIFS Compose</span>
                  </>
                )}
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-mono font-bold text-[#00ff66]">
                Option A: Direct SMB / CIFS Network Share in compose.yaml (Windows Share / Synology / Unraid)
              </div>
              <pre className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed">
                {DOCKER_COMPOSE_NAS_SMB_EXAMPLE}
              </pre>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-cyan-300">
                  Option B: Direct NFS Network Share in compose.yaml (TrueNAS / Synology NFS)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    handleCopySnippet('compose-nfs', DOCKER_COMPOSE_NAS_NFS_EXAMPLE)
                  }
                  className="text-xs font-mono text-cyan-300 hover:underline flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  <span>
                    {copiedKey === 'compose-nfs' ? 'Copied!' : 'Copy NFS block'}
                  </span>
                </button>
              </div>
              <pre className="rounded-xl border border-zinc-800 bg-zinc-950 p-3.5 text-xs font-mono text-cyan-200 overflow-x-auto leading-relaxed">
                {DOCKER_COMPOSE_NAS_NFS_EXAMPLE}
              </pre>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-800/80">
          <div className="text-xs font-mono text-zinc-400">
            Zero built-in tracks · 100% self-hosted from your mounted drive
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              data-testid="dismiss-drive-overlay-btn"
              className="rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-4 py-2 text-xs font-mono font-semibold text-zinc-200 transition-colors"
            >
              {isConnectedWithMusic ? 'Close' : 'Browse Settings First'}
            </button>

            {isConnectedWithMusic && (
              <button
                type="button"
                onClick={onCompleteAndLaunchLibrary}
                className="rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-5 py-2 text-xs font-mono font-bold text-zinc-950 transition-colors"
              >
                Launch Music Library →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
