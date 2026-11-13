import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckSquare,
  ChevronRight,
  Edit3,
  FileAudio,
  Fingerprint,
  Folder,
  FolderInput,
  FolderPlus,
  HardDrive,
  Home,
  Inbox,
  Loader2,
  Play,
  RefreshCw,
  Sliders,
  Sparkles,
  Square,
  Tag,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type { LibraryOrganizeJobState } from '../types/music';

interface BrowseFolderItem {
  name: string;
  relativePath: string;
  childCount: number;
  isStagingInbox?: boolean;
}

interface BrowseFileItem {
  name: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  trackId: string | null;
  title: string;
  artist: string;
  album: string;
  trackNumber: number;
  discNumber: number;
  year: number | null;
  genre: string;
  durationSec: number;
  bitrate: number;
  format: string;
  artworkUrl: string | null;
  mbid: string | null;
  variantFlags: string[];
}

interface IdentifyPreviewItem {
  beforePath: string;
  afterPath: string;
  title: string;
  artist: string;
  album: string;
  trackNumber: number;
  year: number;
  recordingMbid?: string;
  coverArtUrl?: string;
  sourceMethod: string;
  detectedVariantFlags: string[];
  applied: boolean;
}

interface FileAndTagManagerViewProps {
  onLibraryChanged?: () => void;
  onNotify?: (message: string) => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

export const FileAndTagManagerView: React.FC<FileAndTagManagerViewProps> = ({
  onLibraryChanged,
  onNotify,
}) => {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [musicRoot, setMusicRoot] = useState<string>('/music');
  const [folders, setFolders] = useState<BrowseFolderItem[]>([]);
  const [files, setFiles] = useState<BrowseFileItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(
    new Set()
  );

  // Inline rename state
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');

  // New folder state
  const [showNewFolderInput, setShowNewFolderInput] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');

  // Move modal / bar state
  const [showMoveBar, setShowMoveBar] = useState<boolean>(false);
  const [targetMoveFolder, setTargetMoveFolder] = useState<string>('');

  // Bulk Tag Editor state
  const [showBulkTagEditor, setShowBulkTagEditor] = useState<boolean>(false);
  const [bulkTitle, setBulkTitle] = useState<string>('');
  const [bulkArtist, setBulkArtist] = useState<string>('');
  const [bulkAlbum, setBulkAlbum] = useState<string>('');
  const [bulkTrackNumber, setBulkTrackNumber] = useState<string>('');
  const [bulkYear, setBulkYear] = useState<string>('');
  const [bulkGenre, setBulkGenre] = useState<string>('');
  const [bulkAutoOrganize, setBulkAutoOrganize] = useState<boolean>(true);
  const [bulkSaving, setBulkSaving] = useState<boolean>(false);

  // 1-Click Auto-Identify & Organize Folder (AcoustID + MusicBrainz) state
  const [identifying, setIdentifying] = useState<boolean>(false);
  const [identifyPreview, setIdentifyPreview] = useState<
    IdentifyPreviewItem[] | null
  >(null);

  // Background Full Established Library Organizer state
  const [organizeJob, setOrganizeJob] = useState<LibraryOrganizeJobState | null>(null);
  const [showOrganizeModal, setShowOrganizeModal] = useState<boolean>(false);
  const [organizeScope, setOrganizeScope] = useState<'entire_library' | 'current_folder'>('entire_library');
  const [organizeRecursive, setOrganizeRecursive] = useState<boolean>(true);
  const [organizeDryRun, setOrganizeDryRun] = useState<boolean>(true);
  const [organizeSkipOrganized, setOrganizeSkipOrganized] = useState<boolean>(false);

  const fetchOrganizeJobStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/library/organize/status');
      const data = await resp.json();
      if (resp.ok && data?.ok && data.job) {
        setOrganizeJob(data.job);
        if (data.job.status === 'completed' && data.job.organizedCount > 0) {
          onLibraryChanged?.();
        }
      }
    } catch {
      // ignore
    }
  }, [onLibraryChanged]);

  useEffect(() => {
    fetchOrganizeJobStatus();
  }, [fetchOrganizeJobStatus]);

  useEffect(() => {
    if (
      organizeJob &&
      (organizeJob.status === 'running' || organizeJob.status === 'scanning')
    ) {
      const timer = setInterval(() => {
        fetchOrganizeJobStatus();
      }, 1500);
      return () => clearInterval(timer);
    }
  }, [organizeJob, fetchOrganizeJobStatus]);

  const handleStartOrganizeJob = async (dryRunOverride?: boolean) => {
    const isDry = dryRunOverride !== undefined ? dryRunOverride : organizeDryRun;
    const targetPath = organizeScope === 'current_folder' ? currentPath : '';
    setShowOrganizeModal(false);
    try {
      const resp = await fetch('/api/library/organize/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPath,
          recursive: organizeRecursive,
          dryRun: isDry,
          skipOrganized: organizeSkipOrganized,
        }),
      });
      const data = await resp.json();
      if (resp.ok && data?.ok && data.job) {
        setOrganizeJob(data.job);
        const mode = isDry ? 'Preview' : 'Organization';
        const target = targetPath ? `/music/${targetPath}` : 'Entire /music Library';
        setStatusBanner({
          type: 'ok',
          text: `Started ${mode} for ${target} (${organizeRecursive ? 'Recursive' : 'Folder only'}).`,
        });
      } else {
        setStatusBanner({
          type: 'err',
          text: data?.error || 'Failed to start library organizer.',
        });
      }
    } catch {
      setStatusBanner({
        type: 'err',
        text: 'Network error starting library organizer.',
      });
    }
  };

  const handleApplyOrganizeJob = async () => {
    try {
      const resp = await fetch('/api/library/organize/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await resp.json();
      if (resp.ok && data?.ok && data.job) {
        setOrganizeJob(data.job);
        setStatusBanner({
          type: 'ok',
          text: `Applying organization to ${data.job.totalFiles} tracks...`,
        });
      } else {
        setStatusBanner({
          type: 'err',
          text: data?.error || 'Failed to apply organization.',
        });
      }
    } catch {
      setStatusBanner({
        type: 'err',
        text: 'Network error applying library organization.',
      });
    }
  };

  const handleCancelOrganizeJob = async () => {
    try {
      const resp = await fetch('/api/library/organize/cancel', {
        method: 'POST',
      });
      const data = await resp.json();
      if (resp.ok && data?.ok && data.job) {
        setOrganizeJob(data.job);
        setStatusBanner({
          type: 'ok',
          text: 'Library organizer operation cancelled.',
        });
        loadDirectory(currentPath);
        onLibraryChanged?.();
      }
    } catch {
      setStatusBanner({
        type: 'err',
        text: 'Network error cancelling organizer.',
      });
    }
  };


  const loadDirectory = useCallback(async (relPath: string) => {
    setLoading(true);
    try {
      const resp = await fetch(
        `/api/files/browse?path=${encodeURIComponent(relPath)}`
      );
      const data = await resp.json();
      if (resp.ok && data?.ok) {
        setCurrentPath(data.currentPath || '');
        setMusicRoot(data.musicRoot || '/music');
        setFolders(Array.isArray(data.folders) ? data.folders : []);
        setFiles(Array.isArray(data.files) ? data.files : []);
        setSelectedFilePaths(new Set());
      } else {
        setStatusBanner({
          type: 'err',
          text: data?.error || 'Failed to browse directory.',
        });
      }
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text:
          err instanceof Error ? err.message : 'Network error loading folder.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  const pathSegments = currentPath
    ? currentPath.split('/').filter(Boolean)
    : [];

  const toggleSelectFile = (relPath: string) => {
    setSelectedFilePaths((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };

  const allFilesSelected =
    files.length > 0 &&
    files.every((f) => selectedFilePaths.has(f.relativePath));

  const toggleSelectAllFiles = () => {
    if (allFilesSelected) {
      setSelectedFilePaths(new Set());
    } else {
      setSelectedFilePaths(new Set(files.map((f) => f.relativePath)));
    }
  };

  const handleOpenBulkTagModal = () => {
    const selectedItems = files.filter((f) =>
      selectedFilePaths.has(f.relativePath)
    );
    if (selectedItems.length === 1) {
      const single = selectedItems[0];
      setBulkTitle(single.title || '');
      setBulkArtist(single.artist || '');
      setBulkAlbum(single.album || '');
      setBulkTrackNumber(String(single.trackNumber || 1));
      setBulkYear(single.year ? String(single.year) : '');
      setBulkGenre(single.genre || '');
    } else if (selectedItems.length > 1) {
      const first = selectedItems[0];
      setBulkTitle('');
      setBulkArtist(
        selectedItems.every((x) => x.artist === first.artist)
          ? first.artist
          : ''
      );
      setBulkAlbum(
        selectedItems.every((x) => x.album === first.album) ? first.album : ''
      );
      setBulkTrackNumber('');
      setBulkYear(
        selectedItems.every((x) => x.year === first.year) && first.year
          ? String(first.year)
          : ''
      );
      setBulkGenre(
        selectedItems.every((x) => x.genre === first.genre) ? first.genre : ''
      );
    }
    setShowBulkTagEditor(true);
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      const resp = await fetch('/api/files/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPath: currentPath,
          folderName: newFolderName.trim(),
        }),
      });
      const data = await resp.json();
      if (resp.ok && data?.ok) {
        setNewFolderName('');
        setShowNewFolderInput(false);
        loadDirectory(currentPath);
        setStatusBanner({
          type: 'ok',
          text: `Created folder "${data.relativePath}".`,
        });
      } else {
        setStatusBanner({
          type: 'err',
          text: data?.error || 'Could not create folder.',
        });
      }
    } catch {
      setStatusBanner({ type: 'err', text: 'Network error creating folder.' });
    }
  };

  const handleConfirmRename = async (relPath: string) => {
    if (!renameValue.trim()) {
      setRenamingPath(null);
      return;
    }
    try {
      const resp = await fetch('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relativePath: relPath,
          newName: renameValue.trim(),
        }),
      });
      const data = await resp.json();
      if (resp.ok && data?.ok) {
        setRenamingPath(null);
        loadDirectory(currentPath);
        onLibraryChanged?.();
        setStatusBanner({
          type: 'ok',
          text: `Renamed to "${data.newPath}".`,
        });
      } else {
        setStatusBanner({
          type: 'err',
          text: data?.error || 'Rename failed.',
        });
      }
    } catch {
      setStatusBanner({ type: 'err', text: 'Network error renaming item.' });
    }
  };

  const handleMoveSelected = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFilePaths.size === 0) return;
    try {
      const resp = await fetch('/api/files/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paths: Array.from(selectedFilePaths),
          targetFolder: targetMoveFolder.trim(),
        }),
      });
      const data = await resp.json();
      if (resp.ok && data?.ok) {
        setShowMoveBar(false);
        loadDirectory(currentPath);
        onLibraryChanged?.();
        const msg = `Moved ${data.movedCount} file(s) to /music/${data.targetFolder || ''}.`;
        setStatusBanner({ type: 'ok', text: msg });
        onNotify?.(msg);
      } else {
        setStatusBanner({
          type: 'err',
          text: data?.error || 'Failed to move files.',
        });
      }
    } catch {
      setStatusBanner({ type: 'err', text: 'Network error moving files.' });
    }
  };

  const handleDeleteItems = async (pathsToDelete: string[]) => {
    if (pathsToDelete.length === 0) return;
    try {
      const resp = await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: pathsToDelete }),
      });
      const data = await resp.json();
      if (resp.ok && data?.ok) {
        loadDirectory(currentPath);
        onLibraryChanged?.();
        const msg = `Deleted ${data.deletedCount} item(s) from /music.`;
        setStatusBanner({ type: 'ok', text: msg });
        onNotify?.(msg);
      } else {
        setStatusBanner({
          type: 'err',
          text: data?.error || 'Failed to delete item(s).',
        });
      }
    } catch {
      setStatusBanner({ type: 'err', text: 'Network error deleting items.' });
    }
  };

  const handleSaveBulkTags = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFilePaths.size === 0) return;
    setBulkSaving(true);
    try {
      const items = Array.from(selectedFilePaths).map((relPath) => ({
        relativePath: relPath,
        ...(bulkTitle.trim() ? { title: bulkTitle.trim() } : {}),
        ...(bulkArtist.trim() ? { artist: bulkArtist.trim() } : {}),
        ...(bulkAlbum.trim() ? { album: bulkAlbum.trim() } : {}),
        ...(bulkTrackNumber.trim()
          ? { trackNumber: Number(bulkTrackNumber) }
          : {}),
        ...(bulkYear.trim() ? { year: Number(bulkYear) } : {}),
        ...(bulkGenre.trim() ? { genre: bulkGenre.trim() } : {}),
      }));

      const resp = await fetch('/api/files/bulk-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          organizeFiles: bulkAutoOrganize,
        }),
      });
      const data = await resp.json();
      if (resp.ok && data?.ok) {
        setShowBulkTagEditor(false);
        loadDirectory(currentPath);
        onLibraryChanged?.();
        setStatusBanner({
          type: 'ok',
          text:
            data.message ||
            `Updated metadata tags on ${data.updatedCount} track(s).`,
        });
        onNotify?.(data.message || `Updated ${data.updatedCount} track(s).`);
      } else {
        setStatusBanner({
          type: 'err',
          text: data?.error || 'Bulk tag update failed.',
        });
      }
    } catch {
      setStatusBanner({
        type: 'err',
        text: 'Network error updating metadata tags.',
      });
    } finally {
      setBulkSaving(false);
    }
  };

  const handleAutoIdentifyFolder = async (apply: boolean) => {
    setIdentifying(true);
    setStatusBanner(null);
    try {
      const resp = await fetch('/api/files/identify-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relativePath: currentPath,
          apply,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.ok) {
        setStatusBanner({
          type: 'err',
          text: data?.error || 'Auto-Identify failed.',
        });
        return;
      }

      const items: IdentifyPreviewItem[] = Array.isArray(data.items)
        ? data.items
        : [];
      if (apply) {
        setIdentifyPreview(null);
        loadDirectory(currentPath);
        onLibraryChanged?.();
        const msg = `Fingerprinted, tagged & organized ${items.length} file(s) via AcoustID + MusicBrainz + Cover Art Archive!`;
        setStatusBanner({ type: 'ok', text: msg });
        onNotify?.(msg);
      } else {
        setIdentifyPreview(items);
      }
    } catch (err) {
      setStatusBanner({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'Network error running AcoustID + MusicBrainz.',
      });
    } finally {
      setIdentifying(false);
    }
  };

  return (
    <div
      data-testid="file-and-tag-manager-view"
      className="winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden space-y-0"
    >
      {/* Top Titlebar */}
      <div className="winamp-titlebar px-4 py-3 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <HardDrive className="w-4 h-4 text-[#00ff66] shrink-0" />
          <div>
            <h2 className="text-xs sm:text-sm font-mono font-bold uppercase tracking-wider text-white">
              WEB FILE, FOLDER &amp; TAG MANAGER ({musicRoot})
            </h2>
            <p className="text-[11px] font-mono text-zinc-400">
              Browse `/music`, edit ID3/FLAC tags, move/rename folders, or run
              1-click AcoustID + MusicBrainz Picard auto-organization
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowOrganizeModal(true)}
            data-testid="btn-clean-established-library"
            className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/50 bg-purple-950/40 hover:bg-purple-900/60 px-3.5 py-1.5 text-xs font-mono font-bold text-purple-200 transition-colors shadow-md"
          >
            <Wand2 className="w-3.5 h-3.5 text-purple-300" />
            <span>Clean Established Library</span>
          </button>

          <button
            type="button"
            onClick={() => setCurrentPath('_inbox')}
            data-testid="btn-jump-staging-inbox"
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-mono font-bold transition-colors ${
              currentPath === '_inbox'
                ? 'border-[#00ff66] bg-[#00ff66]/20 text-[#00ff66]'
                : 'border-amber-500/40 bg-amber-950/30 hover:bg-amber-900/40 text-amber-300'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            <span>Staging Inbox (_inbox)</span>
          </button>

          <button
            type="button"
            disabled={identifying || files.length === 0}
            onClick={() => handleAutoIdentifyFolder(false)}
            data-testid="btn-auto-identify-organize-folder"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-40 px-3.5 py-1.5 text-xs font-mono font-bold text-zinc-950 transition-colors shadow-md"
          >
            {identifying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Fingerprint className="w-3.5 h-3.5" />
            )}
            <span>Auto-Identify &amp; Organize Folder ({files.length})</span>
          </button>
        </div>
      </div>

      {/* Breadcrumb Bar + Folder Action Toolbar */}
      <div className="px-4 py-2.5 bg-zinc-950/90 border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-2">
        {/* Breadcrumb Path */}
        <div className="flex flex-wrap items-center gap-1 text-xs font-mono">
          <button
            type="button"
            onClick={() => setCurrentPath('')}
            data-testid="breadcrumb-music-root"
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition-colors ${
              currentPath === ''
                ? 'bg-zinc-800 text-[#00ff66] font-bold'
                : 'text-zinc-300 hover:text-white hover:bg-zinc-900'
            }`}
          >
            <Home className="w-3.5 h-3.5 text-[#00ff66]" />
            <span>/music</span>
          </button>

          {pathSegments.map((seg, idx) => {
            const rel = pathSegments.slice(0, idx + 1).join('/');
            const isLast = idx === pathSegments.length - 1;
            return (
              <React.Fragment key={rel}>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
                <button
                  type="button"
                  onClick={() => setCurrentPath(rel)}
                  className={`rounded-lg px-2 py-1 transition-colors ${
                    isLast
                      ? 'bg-zinc-800 text-[#00ff66] font-bold'
                      : 'text-zinc-300 hover:text-white hover:bg-zinc-900'
                  }`}
                >
                  {seg}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Actions: New Folder, Select All, Bulk Edit Tags, Move, Delete */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowNewFolderInput((prev) => !prev)}
            data-testid="btn-filemanager-new-folder"
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 hover:border-zinc-500 px-2.5 py-1 text-xs font-mono text-zinc-200 hover:text-white"
          >
            <FolderPlus className="w-3.5 h-3.5 text-[#00ff66]" />
            <span>New Folder</span>
          </button>

          {files.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectAllFiles}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 hover:border-zinc-500 px-2.5 py-1 text-xs font-mono text-zinc-200 hover:text-white"
            >
              {allFilesSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-[#00ff66]" />
              ) : (
                <Square className="w-3.5 h-3.5 text-zinc-400" />
              )}
              <span>
                {allFilesSelected ? 'Deselect All' : 'Select All Files'}
              </span>
            </button>
          )}

          {selectedFilePaths.size > 0 && (
            <>
              <button
                type="button"
                onClick={handleOpenBulkTagModal}
                data-testid="btn-filemanager-bulk-tag"
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-950/40 hover:bg-emerald-900/50 px-2.5 py-1 text-xs font-mono font-bold text-[#00ff66]"
              >
                <Tag className="w-3.5 h-3.5" />
                <span>Edit Tags ({selectedFilePaths.size})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTargetMoveFolder(currentPath);
                  setShowMoveBar((prev) => !prev);
                }}
                data-testid="btn-filemanager-move-selected"
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/50 bg-indigo-950/40 hover:bg-indigo-900/50 px-2.5 py-1 text-xs font-mono font-bold text-indigo-300"
              >
                <FolderInput className="w-3.5 h-3.5" />
                <span>Move ({selectedFilePaths.size})</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  handleDeleteItems(Array.from(selectedFilePaths))
                }
                data-testid="btn-filemanager-delete-selected"
                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/50 bg-rose-950/40 hover:bg-rose-900/50 px-2.5 py-1 text-xs font-mono font-bold text-rose-300"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete ({selectedFilePaths.size})</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => loadDirectory(currentPath)}
            title="Refresh directory"
            className="p-1.5 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Status Alert */}
      {statusBanner && (
        <div
          className={`px-4 py-2 text-xs font-mono flex items-center justify-between border-b ${
            statusBanner.type === 'ok'
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
          }`}
        >
          <span>{statusBanner.text}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-zinc-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Established Library Full Organizer Live Progress Banner */}
      {organizeJob &&
        (organizeJob.status === 'running' || organizeJob.status === 'scanning') && (
          <div
            data-testid="organizer-live-progress-card"
            className="p-4 bg-gradient-to-r from-emerald-950/80 via-zinc-950 to-indigo-950/70 border-b border-[#00ff66]/60 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Loader2 className="w-5 h-5 text-[#00ff66] animate-spin shrink-0" />
                <div>
                  <div className="text-xs font-mono font-bold text-white flex items-center gap-2">
                    <span>
                      {organizeJob.dryRun
                        ? '🔍 PREVIEWING LIBRARY ORGANIZATION...'
                        : '⚡ CLEANING & ORGANIZING ESTABLISHED LIBRARY...'}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-[#00ff66]/20 border border-[#00ff66]/50 text-[#00ff66]">
                      {organizeJob.processedFiles} / {organizeJob.totalFiles} tracks (
                      {organizeJob.totalFiles > 0
                        ? Math.round(
                            (organizeJob.processedFiles / organizeJob.totalFiles) * 100
                          )
                        : 0}
                      %)
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-zinc-300 truncate max-w-xl">
                    {organizeJob.currentTrackTitle ? (
                      <span>
                        Fingerprinting: <strong>{organizeJob.currentTrackTitle}</strong> —{' '}
                        {organizeJob.currentTrackArtist || 'Unknown Artist'}
                      </span>
                    ) : (
                      <span>{organizeJob.currentFile || 'Scanning audio files...'}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelOrganizeJob}
                  data-testid="btn-cancel-organize-job"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/50 bg-rose-950/40 hover:bg-rose-900/60 px-3 py-1.5 text-xs font-mono font-bold text-rose-300 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancel / Stop</span>
                </button>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-zinc-900 rounded-full h-2.5 overflow-hidden border border-zinc-800">
              <div
                className="bg-gradient-to-r from-[#00ff66] to-emerald-400 h-2.5 rounded-full transition-all duration-300"
                style={{
                  width: `${
                    organizeJob.totalFiles > 0
                      ? Math.min(
                          100,
                          Math.round(
                            (organizeJob.processedFiles / organizeJob.totalFiles) * 100
                          )
                        )
                      : 5
                  }%`,
                }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span>
                Target:{' '}
                <code className="text-zinc-200">
                  /music/{organizeJob.targetPath || ''}
                </code>{' '}
                ({organizeJob.recursive ? 'Recursive' : 'Folder only'})
              </span>
              <div className="flex items-center gap-3">
                <span className="text-[#00ff66]">
                  ✓ {organizeJob.organizedCount} processed
                </span>
                {organizeJob.skippedCount > 0 && (
                  <span className="text-zinc-500">
                    · {organizeJob.skippedCount} skipped
                  </span>
                )}
                {organizeJob.errorCount > 0 && (
                  <span className="text-rose-400">
                    · {organizeJob.errorCount} errors
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

      {/* Full Library Organize Preview Panel */}
      {organizeJob &&
        organizeJob.status === 'preview_ready' &&
        organizeJob.items.length > 0 && (
          <div
            data-testid="organize-preview-panel"
            className="p-4 bg-gradient-to-b from-emerald-950/40 via-zinc-950 to-zinc-950 border-b border-[#00ff66]/50 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#00ff66]" />
                <h3 className="text-xs sm:text-sm font-mono font-bold text-white">
                  Library Organization Preview ({organizeJob.items.length} Tracks Ready)
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApplyOrganizeJob}
                  data-testid="btn-apply-organize-preview"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3.5 py-1.5 text-xs font-mono font-bold text-zinc-950 shadow-md"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Apply &amp; Clean Up Entire Library Now</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOrganizeJob(null)}
                  className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-mono text-zinc-300 hover:text-white"
                >
                  Dismiss
                </button>
              </div>
            </div>

            <div className="max-h-[300px] overflow-y-auto divide-y divide-zinc-800/80 rounded-xl border border-zinc-800 bg-zinc-950/90">
              {organizeJob.items.map((item, idx) => (
                <div
                  key={idx}
                  className="p-2.5 text-xs font-mono flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 text-zinc-400 truncate">
                      <span className="text-rose-300 line-through truncate max-w-xs">
                        {item.beforePath}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#00ff66] shrink-0" />
                      <span className="text-[#00ff66] font-bold truncate">
                        {item.afterPath}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-300 flex flex-wrap items-center gap-2">
                      <span>
                        <strong>{item.title}</strong> — {item.artist} ({item.album}
                        {item.year ? `, ${item.year}` : ''})
                      </span>
                      <span className="text-[10px] text-indigo-300 uppercase">
                        [{item.sourceMethod}]
                      </span>
                      {item.alreadyOrganized && (
                        <span className="text-[10px] text-emerald-400 font-bold">
                          ✓ ALREADY IN PLACE
                        </span>
                      )}
                      {item.detectedVariantFlags.map((flag) => (
                        <span
                          key={flag}
                          className="text-[10px] text-amber-300 font-bold uppercase"
                        >
                          ⚠️ {flag}
                        </span>
                      ))}
                      {item.error && (
                        <span className="text-[10px] text-rose-400">
                          Error: {item.error}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      {/* New Folder Input Row */}
      {showNewFolderInput && (
        <form
          onSubmit={handleCreateFolder}
          className="px-4 py-2.5 bg-zinc-900/90 border-b border-zinc-800 flex items-center gap-2"
        >
          <FolderPlus className="w-4 h-4 text-[#00ff66] shrink-0" />
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="New Artist or Album folder name (e.g. Daft Punk/Discovery (2001))..."
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3 py-1.5 text-xs font-mono font-bold text-zinc-950"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setShowNewFolderInput(false)}
            className="rounded-xl border border-zinc-700 px-2.5 py-1.5 text-xs font-mono text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Move Selected Files Bar */}
      {showMoveBar && (
        <form
          onSubmit={handleMoveSelected}
          className="px-4 py-2.5 bg-indigo-950/30 border-b border-indigo-500/40 flex flex-wrap items-center gap-2"
        >
          <FolderInput className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="text-xs font-mono text-indigo-200">
            Move {selectedFilePaths.size} file(s) to `/music/`:
          </span>
          <input
            type="text"
            value={targetMoveFolder}
            onChange={(e) => setTargetMoveFolder(e.target.value)}
            placeholder="e.g. Artist Name/Album Name (2024)"
            className="flex-1 min-w-[220px] rounded-xl border border-indigo-500/40 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-white focus:border-indigo-400 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-xl bg-indigo-500 hover:bg-indigo-400 px-3 py-1.5 text-xs font-mono font-bold text-white"
          >
            Move Files Here
          </button>
          <button
            type="button"
            onClick={() => setShowMoveBar(false)}
            className="rounded-xl border border-zinc-700 px-2.5 py-1.5 text-xs font-mono text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Bulk Metadata Tag Editor Panel */}
      {showBulkTagEditor && (
        <form
          onSubmit={handleSaveBulkTags}
          data-testid="bulk-tag-editor-panel"
          className="p-4 bg-zinc-900/95 border-b border-emerald-500/40 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-[#00ff66]" />
              <h3 className="text-xs sm:text-sm font-mono font-bold text-white">
                Edit Audio Metadata Tags ({selectedFilePaths.size} selected)
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowBulkTagEditor(false)}
              className="text-zinc-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">
                Title {selectedFilePaths.size > 1 && '(Leave blank to keep)'}
              </label>
              <input
                type="text"
                value={bulkTitle}
                onChange={(e) => setBulkTitle(e.target.value)}
                placeholder={
                  selectedFilePaths.size > 1 ? 'Keep individual titles' : 'Title'
                }
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">
                Artist
              </label>
              <input
                type="text"
                value={bulkArtist}
                onChange={(e) => setBulkArtist(e.target.value)}
                placeholder="Artist Name"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">
                Album
              </label>
              <input
                type="text"
                value={bulkAlbum}
                onChange={(e) => setBulkAlbum(e.target.value)}
                placeholder="Album Name"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">
                Track #
              </label>
              <input
                type="number"
                min={1}
                value={bulkTrackNumber}
                onChange={(e) => setBulkTrackNumber(e.target.value)}
                placeholder="1"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">
                Release Year
              </label>
              <input
                type="number"
                min={1900}
                max={2100}
                value={bulkYear}
                onChange={(e) => setBulkYear(e.target.value)}
                placeholder="2024"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">
                Genre
              </label>
              <input
                type="text"
                value={bulkGenre}
                onChange={(e) => setBulkGenre(e.target.value)}
                placeholder="Electronic, Rock..."
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-white"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 text-xs font-mono text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={bulkAutoOrganize}
                onChange={(e) => setBulkAutoOrganize(e.target.checked)}
                className="rounded accent-[#00ff66]"
              />
              <span>
                Also organize &amp; rename into{' '}
                <code className="text-[#00ff66]">
                  /music/&#123;Artist&#125;/&#123;Album&#125; (&#123;Year&#125;)/&#123;TrackNumber&#125; - &#123;Title&#125;.&#123;ext&#125;
                </code>
              </span>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={bulkSaving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-50 px-4 py-1.5 text-xs font-mono font-bold text-zinc-950"
              >
                {bulkSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>Write Tags to File(s) &amp; Update SQLite</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Before / After Preview Modal for 1-Click Auto-Identify & Organize Folder */}
      {identifyPreview && (
        <div
          data-testid="identify-folder-preview-panel"
          className="p-4 bg-gradient-to-b from-emerald-950/40 via-zinc-950 to-zinc-950 border-b border-[#00ff66]/50 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#00ff66]" />
              <h3 className="text-xs sm:text-sm font-mono font-bold text-white">
                AcoustID + MusicBrainz Before / After Organization Preview (
                {identifyPreview.length} Tracks)
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={identifying}
                onClick={() => handleAutoIdentifyFolder(true)}
                data-testid="btn-confirm-apply-identify-folder"
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3.5 py-1.5 text-xs font-mono font-bold text-zinc-950 shadow-md"
              >
                {identifying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>Apply Tags, Artwork &amp; Move Files Now</span>
              </button>
              <button
                type="button"
                onClick={() => setIdentifyPreview(null)}
                className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-mono text-zinc-300 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>

          <div className="max-h-[260px] overflow-y-auto divide-y divide-zinc-800/80 rounded-xl border border-zinc-800 bg-zinc-950/90">
            {identifyPreview.map((item, idx) => (
              <div
                key={idx}
                className="p-2.5 text-xs font-mono flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 text-zinc-400 truncate">
                    <span className="text-rose-300 line-through truncate">
                      {item.beforePath}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#00ff66] shrink-0" />
                    <span className="text-[#00ff66] font-bold truncate">
                      {item.afterPath}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-300 flex flex-wrap items-center gap-2">
                    <span>
                      <strong>{item.title}</strong> — {item.artist} (
                      {item.album}, {item.year})
                    </span>
                    <span className="text-[10px] text-indigo-300 uppercase">
                      [{item.sourceMethod}]
                    </span>
                    {item.detectedVariantFlags.map((flag) => (
                      <span
                        key={flag}
                        className="text-[10px] text-amber-300 font-bold uppercase"
                      >
                        ⚠️ {flag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Directory Listing: Subfolders + Audio Files */}
      <div className="divide-y divide-zinc-800/70 max-h-[540px] overflow-y-auto">
        {folders.length === 0 && files.length === 0 && !loading && (
          <div className="p-10 text-center space-y-2 font-mono">
            <Folder className="w-8 h-8 text-zinc-600 mx-auto" />
            <div className="text-sm font-bold text-zinc-300">
              This folder is empty
            </div>
            <p className="text-xs text-zinc-500 max-w-md mx-auto">
              Downloaded tracks from slskd and yt-dlp land in{' '}
              <code>/music/_inbox</code> and are automatically fingerprinted and
              organized into <code>/music/Artist/Album (Year)/</code>.
            </p>
          </div>
        )}

        {/* Folders */}
        {folders.map((folder) => {
          const isRenaming = renamingPath === folder.relativePath;
          return (
            <div
              key={`dir-${folder.relativePath}`}
              data-testid={`filemanager-folder-${folder.name}`}
              className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-zinc-900/60 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                {folder.isStagingInbox ? (
                  <Inbox className="w-4 h-4 text-amber-400 shrink-0" />
                ) : (
                  <Folder className="w-4 h-4 text-[#00ff66] shrink-0" />
                )}

                {isRenaming ? (
                  <div className="flex items-center gap-1.5 flex-1 max-w-md">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="flex-1 rounded-lg border border-[#00ff66] bg-zinc-950 px-2.5 py-1 text-xs font-mono text-white"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleConfirmRename(folder.relativePath)}
                      className="rounded-lg bg-[#00ff66] px-2.5 py-1 text-xs font-mono font-bold text-zinc-950"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingPath(null)}
                      className="rounded-lg border border-zinc-700 px-2 py-1 text-xs font-mono text-zinc-400"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCurrentPath(folder.relativePath)}
                    className="flex items-center gap-2 text-left min-w-0 group"
                  >
                    <span className="text-xs sm:text-sm font-mono font-bold text-white group-hover:text-[#00ff66] truncate">
                      {folder.name}
                    </span>
                    {folder.isStagingInbox && (
                      <span className="text-[10px] font-mono text-amber-300">
                        (Staging / Incoming Downloads Inbox)
                      </span>
                    )}
                    <span className="text-[11px] font-mono text-zinc-500">
                      ({folder.childCount} items)
                    </span>
                  </button>
                )}
              </div>

              {!folder.isStagingInbox && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingPath(folder.relativePath);
                      setRenameValue(folder.name);
                    }}
                    title="Rename folder"
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteItems([folder.relativePath])}
                    title="Delete folder"
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-zinc-800"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Audio Files */}
        {files.map((file) => {
          const isSelected = selectedFilePaths.has(file.relativePath);
          const isRenaming = renamingPath === file.relativePath;
          return (
            <div
              key={`file-${file.relativePath}`}
              data-testid={`filemanager-file-${file.name}`}
              className={`px-4 py-2.5 flex items-center justify-between gap-3 transition-colors ${
                isSelected ? 'bg-emerald-950/25' : 'hover:bg-zinc-900/50'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => toggleSelectFile(file.relativePath)}
                  className="text-zinc-400 hover:text-white shrink-0"
                >
                  {isSelected ? (
                    <CheckSquare className="w-4 h-4 text-[#00ff66]" />
                  ) : (
                    <Square className="w-4 h-4 text-zinc-600" />
                  )}
                </button>

                <FileAudio className="w-4 h-4 text-cyan-400 shrink-0" />

                {isRenaming ? (
                  <div className="flex items-center gap-1.5 flex-1 max-w-md">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="flex-1 rounded-lg border border-[#00ff66] bg-zinc-950 px-2.5 py-1 text-xs font-mono text-white"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleConfirmRename(file.relativePath)}
                      className="rounded-lg bg-[#00ff66] px-2.5 py-1 text-xs font-mono font-bold text-zinc-950"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingPath(null)}
                      className="rounded-lg border border-zinc-700 px-2 py-1 text-xs font-mono text-zinc-400"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono font-bold text-white truncate">
                        {file.name}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-500">
                        {file.format} · {formatBytes(file.sizeBytes)}
                      </span>
                      {file.variantFlags.map((flag) => (
                        <span
                          key={flag}
                          className="inline-flex items-center gap-0.5 text-[10px] font-mono font-bold text-amber-300 uppercase"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {flag}
                        </span>
                      ))}
                    </div>
                    <div className="text-[11px] font-mono text-zinc-400 truncate">
                      Tag: <strong className="text-zinc-200">{file.title}</strong>{' '}
                      — {file.artist} · {file.album}
                      {file.year ? ` (${file.year})` : ''} · Track #
                      {file.trackNumber}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFilePaths(new Set([file.relativePath]));
                    setBulkTitle(file.title || '');
                    setBulkArtist(file.artist || '');
                    setBulkAlbum(file.album || '');
                    setBulkTrackNumber(String(file.trackNumber || 1));
                    setBulkYear(file.year ? String(file.year) : '');
                    setBulkGenre(file.genre || '');
                    setShowBulkTagEditor(true);
                  }}
                  title="Edit ID3/FLAC Metadata Tags"
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-[#00ff66] hover:bg-zinc-800"
                >
                  <Tag className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRenamingPath(file.relativePath);
                    setRenameValue(file.name);
                  }}
                  title="Rename file"
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteItems([file.relativePath])}
                  title="Delete file"
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-zinc-800"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Clean Established Library Modal */}
      {showOrganizeModal && (
        <div
          data-testid="clean-established-library-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <div className="w-full max-w-lg rounded-2xl border border-purple-500/50 bg-zinc-950 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-purple-400" />
                <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
                  Clean Up Established Music Library
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowOrganizeModal(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-300">
              Clean, fingerprint, tag, and organize an already established or messy music collection into standard structure:
              <br />
              <code className="text-[#00ff66] font-mono text-[11px] block mt-1">
                /music/&#123;Artist&#125;/&#123;Album&#125; (&#123;Year&#125;)/&#123;TrackNumber&#125; - &#123;Title&#125;.&#123;ext&#125;
              </code>
            </p>

            <div className="space-y-3 text-xs font-mono">
              {/* Scope Selection */}
              <div className="space-y-1">
                <label className="text-zinc-400">Target Folder Scope:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setOrganizeScope('entire_library')}
                    className={`rounded-xl border p-2.5 text-left transition-colors ${
                      organizeScope === 'entire_library'
                        ? 'border-[#00ff66] bg-[#00ff66]/15 text-[#00ff66] font-bold'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <div>Entire Library</div>
                    <div className="text-[10px] text-zinc-500 font-normal">
                      All tracks in /music
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setOrganizeScope('current_folder')}
                    className={`rounded-xl border p-2.5 text-left transition-colors ${
                      organizeScope === 'current_folder'
                        ? 'border-[#00ff66] bg-[#00ff66]/15 text-[#00ff66] font-bold'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <div>Current Folder Only</div>
                    <div className="text-[10px] text-zinc-500 font-normal truncate">
                      /music/{currentPath || '(root)'}
                    </div>
                  </button>
                </div>
              </div>

              {/* Recursive Checkbox */}
              <label className="flex items-center gap-2 cursor-pointer text-zinc-300 pt-1">
                <input
                  type="checkbox"
                  checked={organizeRecursive}
                  onChange={(e) => setOrganizeRecursive(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-[#00ff66] focus:ring-0"
                />
                <span>Include all subfolders recursively</span>
              </label>

              {/* Skip Already Organized Checkbox */}
              <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                <input
                  type="checkbox"
                  checked={organizeSkipOrganized}
                  onChange={(e) => setOrganizeSkipOrganized(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-[#00ff66] focus:ring-0"
                />
                <span>Skip files already in Artist/Album format</span>
              </label>

              {/* Dry Run Checkbox */}
              <label className="flex items-center gap-2 cursor-pointer text-purple-300">
                <input
                  type="checkbox"
                  checked={organizeDryRun}
                  onChange={(e) => setOrganizeDryRun(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-purple-400 focus:ring-0"
                />
                <span>Dry Run: Preview Before/After changes without modifying files</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowOrganizeModal(false)}
                className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-mono text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleStartOrganizeJob(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/60 bg-purple-950/60 hover:bg-purple-900/80 px-3.5 py-1.5 text-xs font-mono font-bold text-purple-200"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Dry-Run Preview</span>
              </button>
              <button
                type="button"
                onClick={() => handleStartOrganizeJob(false)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-3.5 py-1.5 text-xs font-mono font-bold text-zinc-950 shadow-md"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>Start Organization</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
