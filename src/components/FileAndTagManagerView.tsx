import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpLeft,
  CalendarClock,
  Check,
  CheckSquare,
  ChevronRight,
  Clock,
  Database,
  Edit3,
  FileAudio,
  Fingerprint,
  Folder,
  FolderInput,
  FolderPlus,
  GripVertical,
  HardDrive,
  Home,
  Inbox,
  Loader2,
  MousePointerClick,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Tag,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type {
  LibraryOrganizeJobState,
  PicardOrganizerConfig,
} from '../types/music';

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

interface StorageStatsData {
  musicRoot: string;
  musicUsedBytes: number;
  musicFileCount: number;
  musicFolderCount: number;
  stagingFileCount: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  diskUsedBytes: number;
  diskUsedPercent: number;
  dbSizeBytes: number;
  indexedTrackCount: number;
  missingMetadataCount: number;
  missingArtworkCount: number;
}

interface ScheduledCronJob {
  id: string;
  name: string;
  description: string;
  taskType:
    | 'library_scan_and_heal'
    | 'auto_organize_library'
    | 'cleanup_logs_and_temp'
    | 'playlist_sync_all';
  intervalHours: number;
  enabled: boolean;
  builtIn?: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: 'idle' | 'running' | 'success' | 'error';
  lastSummary: string;
}

interface FileAndTagManagerViewProps {
  onLibraryChanged?: () => void;
  onNotify?: (message: string) => void;
  picardConfig?: PicardOrganizerConfig;
  onUpdatePicardConfig?: (next: PicardOrganizerConfig) => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

export const FileAndTagManagerView: React.FC<FileAndTagManagerViewProps> = ({
  onLibraryChanged,
  onNotify,
  picardConfig,
  onUpdatePicardConfig,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<
    'files' | 'scheduler' | 'picard'
  >('files');

  const [currentPath, setCurrentPath] = useState<string>('');
  const [musicRoot, setMusicRoot] = useState<string>('/music');
  const [folders, setFolders] = useState<BrowseFolderItem[]>([]);
  const [files, setFiles] = useState<BrowseFileItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  // Unified selection supporting both files and folders + Shift-click range selection
  const [selectMode, setSelectMode] = useState<boolean>(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastClickedPath, setLastClickedPath] = useState<string | null>(null);

  // HTML5 Drag and Drop state
  const [draggedPaths, setDraggedPaths] = useState<string[]>([]);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  // Storage & Disk Stats state
  const [storageStats, setStorageStats] = useState<StorageStatsData | null>(
    null
  );
  const [loadingStorageStats, setLoadingStorageStats] =
    useState<boolean>(false);

  // Scheduled Cron Tasks state
  const [cronJobs, setCronJobs] = useState<ScheduledCronJob[]>([]);
  const [loadingCronJobs, setLoadingCronJobs] = useState<boolean>(false);
  const [runningCronId, setRunningCronId] = useState<string | null>(null);
  const [newCronName, setNewCronName] = useState<string>('');
  const [newCronTaskType, setNewCronTaskType] = useState<
    ScheduledCronJob['taskType']
  >('library_scan_and_heal');
  const [newCronIntervalHours, setNewCronIntervalHours] = useState<number>(24);

  // Picard & Acoustic Metadata Tagger test state
  const [picardTestInput, setPicardTestInput] = useState<string>(
    'Linkin Park - In The End (Official HD Video) [1080p]'
  );
  const [isTestingPicard, setIsTestingPicard] = useState<boolean>(false);
  const [picardTestResult, setPicardTestResult] = useState<{
    artist: string;
    title: string;
    album: string;
    year: string;
    trackNumber: string;
    organizedPath: string;
    source: string;
  } | null>(null);

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
  const [organizeJob, setOrganizeJob] =
    useState<LibraryOrganizeJobState | null>(null);
  const [showOrganizeModal, setShowOrganizeModal] = useState<boolean>(false);
  const [organizeScope, setOrganizeScope] = useState<
    'entire_library' | 'current_folder'
  >('entire_library');
  const [organizeRecursive, setOrganizeRecursive] = useState<boolean>(true);
  const [organizeDryRun, setOrganizeDryRun] = useState<boolean>(true);
  const [organizeSkipOrganized, setOrganizeSkipOrganized] =
    useState<boolean>(false);

  const onLibraryChangedRef = useRef(onLibraryChanged);
  useEffect(() => {
    onLibraryChangedRef.current = onLibraryChanged;
  }, [onLibraryChanged]);

  const directoryCacheRef = useRef<
    Map<
      string,
      {
        currentPath: string;
        musicRoot: string;
        folders: BrowseFolderItem[];
        files: BrowseFileItem[];
        cachedAt: number;
      }
    >
  >(new Map());

  const fetchStorageStats = useCallback(async (forceRefresh = true) => {
    setLoadingStorageStats(true);
    try {
      const resp = await fetch(
        forceRefresh ? '/api/storage/stats?refresh=1' : '/api/storage/stats'
      );
      const data = await resp.json();
      if (resp.ok && data?.ok && data.stats) {
        setStorageStats(data.stats);
      }
    } catch {
      // ignore
    } finally {
      setLoadingStorageStats(false);
    }
  }, []);

  const fetchCronJobs = useCallback(async () => {
    setLoadingCronJobs(true);
    try {
      const resp = await fetch('/api/scheduler/jobs');
      const data = await resp.json();
      if (resp.ok && data?.ok && Array.isArray(data.jobs)) {
        setCronJobs(data.jobs);
      }
    } catch {
      // ignore
    } finally {
      setLoadingCronJobs(false);
    }
  }, []);

  const fetchOrganizeJobStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/library/organize/status');
      const data = await resp.json();
      if (resp.ok && data?.ok && data.job) {
        setOrganizeJob((prev) => {
          if (
            prev &&
            (prev.status === 'running' || prev.status === 'scanning') &&
            data.job.status === 'completed' &&
            data.job.organizedCount > 0
          ) {
            directoryCacheRef.current.clear();
            onLibraryChangedRef.current?.();
          }
          return data.job;
        });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchOrganizeJobStatus();
    fetchStorageStats(false);
    fetchCronJobs();
  }, [fetchOrganizeJobStatus, fetchStorageStats, fetchCronJobs]);

  const organizeJobStatus = organizeJob?.status;
  useEffect(() => {
    if (organizeJobStatus === 'running' || organizeJobStatus === 'scanning') {
      const timer = setInterval(() => {
        fetchOrganizeJobStatus();
      }, 2000);
      return () => clearInterval(timer);
    }
  }, [organizeJobStatus, fetchOrganizeJobStatus]);

  const handleStartOrganizeJob = async (dryRunOverride?: boolean) => {
    const isDry =
      dryRunOverride !== undefined ? dryRunOverride : organizeDryRun;
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
        const target = targetPath
          ? `/music/${targetPath}`
          : 'Entire /music Library';
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
        loadDirectory(currentPath, true);
        onLibraryChangedRef.current?.();
      }
    } catch {
      setStatusBanner({
        type: 'err',
        text: 'Network error cancelling organizer.',
      });
    }
  };

  const loadDirectory = useCallback(
    async (relPath: string, forceRefresh = true) => {
      const normalizedKey = relPath || '';
      if (forceRefresh) {
        directoryCacheRef.current.clear();
      }
      const cached = directoryCacheRef.current.get(normalizedKey);
      if (cached && !forceRefresh) {
        setCurrentPath(cached.currentPath);
        setMusicRoot(cached.musicRoot);
        setFolders(cached.folders);
        setFiles(cached.files);
        setSelectedPaths(new Set());
        setLastClickedPath(null);
        // If cache is fresh (< 30s), skip network call completely
        if (Date.now() - cached.cachedAt < 30_000) {
          return;
        }
      } else {
        setLoading(true);
      }

      try {
        const resp = await fetch(
          `/api/files/browse?path=${encodeURIComponent(normalizedKey)}`
        );
        const data = await resp.json();
        if (resp.ok && data?.ok) {
          const nextFolders = Array.isArray(data.folders) ? data.folders : [];
          const nextFiles = Array.isArray(data.files) ? data.files : [];
          const nextPath = data.currentPath || '';
          const nextRoot = data.musicRoot || '/music';
          directoryCacheRef.current.set(normalizedKey, {
            currentPath: nextPath,
            musicRoot: nextRoot,
            folders: nextFolders,
            files: nextFiles,
            cachedAt: Date.now(),
          });
          setCurrentPath(nextPath);
          setMusicRoot(nextRoot);
          setFolders(nextFolders);
          setFiles(nextFiles);
          if (!cached) {
            setSelectedPaths(new Set());
            setLastClickedPath(null);
          }
        } else if (!cached) {
          setStatusBanner({
            type: 'err',
            text: data?.error || 'Failed to browse directory.',
          });
        }
      } catch (err) {
        if (!cached) {
          setStatusBanner({
            type: 'err',
            text:
              err instanceof Error
                ? err.message
                : 'Network error loading folder.',
          });
        }
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadDirectory(currentPath, false);
  }, [currentPath, loadDirectory]);

  const pathSegments = currentPath
    ? currentPath.split('/').filter(Boolean)
    : [];

  const parentPath =
    pathSegments.length > 0 ? pathSegments.slice(0, -1).join('/') : '';

  // Ordered list of all selectable paths in current directory (non-inbox folders + files)
  const allSelectablePaths = [
    ...folders
      .filter((f) => !f.isStagingInbox)
      .map((f) => f.relativePath),
    ...files.map((f) => f.relativePath),
  ];

  const selectedFileItems = files.filter((f) =>
    selectedPaths.has(f.relativePath)
  );

  const toggleSelectPath = (relPath: string, shiftKey?: boolean) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedPath && lastClickedPath !== relPath) {
        const startIdx = allSelectablePaths.indexOf(lastClickedPath);
        const endIdx = allSelectablePaths.indexOf(relPath);
        if (startIdx !== -1 && endIdx !== -1) {
          const [lo, hi] =
            startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          for (let i = lo; i <= hi; i++) {
            next.add(allSelectablePaths[i]);
          }
          return next;
        }
      }
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
    setLastClickedPath(relPath);
  };

  const allItemsSelected =
    allSelectablePaths.length > 0 &&
    allSelectablePaths.every((p) => selectedPaths.has(p));

  const toggleSelectAllItems = () => {
    if (allItemsSelected) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(allSelectablePaths));
    }
  };

  // Move paths helper (used by both the Move bar and HTML5 Drag-and-Drop)
  const movePathsToDestination = async (
    pathsToMove: string[],
    destinationFolder: string
  ) => {
    const validPaths = pathsToMove.filter(
      (p) => p && p !== destinationFolder && !destinationFolder.startsWith(`${p}/`)
    );
    if (validPaths.length === 0) return;

    try {
      const resp = await fetch('/api/files/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paths: validPaths,
          targetFolder: destinationFolder,
        }),
      });
      const data = await resp.json();
      if (resp.ok && data?.ok) {
        setShowMoveBar(false);
        setDraggedPaths([]);
        setDragOverTarget(null);
        loadDirectory(currentPath);
        fetchStorageStats();
        onLibraryChangedRef.current?.();
        const destLabel = data.targetFolder
          ? `/music/${data.targetFolder}`
          : '/music';
        const msg = `Moved ${data.movedCount} item(s) to ${destLabel}.`;
        setStatusBanner({ type: 'ok', text: msg });
        onNotify?.(msg);
      } else {
        setStatusBanner({
          type: 'err',
          text: data?.error || 'Failed to move items.',
        });
      }
    } catch {
      setStatusBanner({ type: 'err', text: 'Network error moving items.' });
    }
  };

  const handleDragStartItem = (e: React.DragEvent, relPath: string) => {
    const list = selectedPaths.has(relPath)
      ? Array.from(selectedPaths)
      : [relPath];
    setDraggedPaths(list);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(list));
  };

  const handleDropOnFolder = async (
    e: React.DragEvent,
    destinationFolder: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);
    let paths = draggedPaths;
    if (paths.length === 0) {
      try {
        const parsed = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (Array.isArray(parsed)) paths = parsed;
      } catch {
        // ignore
      }
    }
    if (paths.length > 0) {
      await movePathsToDestination(paths, destinationFolder);
    }
  };

  const handleOpenBulkTagModal = () => {
    if (selectedFileItems.length === 0) return;
    if (selectedFileItems.length === 1) {
      const single = selectedFileItems[0];
      setBulkTitle(single.title || '');
      setBulkArtist(single.artist || '');
      setBulkAlbum(single.album || '');
      setBulkTrackNumber(String(single.trackNumber || 1));
      setBulkYear(single.year ? String(single.year) : '');
      setBulkGenre(single.genre || '');
    } else if (selectedFileItems.length > 1) {
      const first = selectedFileItems[0];
      setBulkTitle('');
      setBulkArtist(
        selectedFileItems.every((x) => x.artist === first.artist)
          ? first.artist
          : ''
      );
      setBulkAlbum(
        selectedFileItems.every((x) => x.album === first.album)
          ? first.album
          : ''
      );
      setBulkTrackNumber('');
      setBulkYear(
        selectedFileItems.every((x) => x.year === first.year) && first.year
          ? String(first.year)
          : ''
      );
      setBulkGenre(
        selectedFileItems.every((x) => x.genre === first.genre)
          ? first.genre
          : ''
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
        fetchStorageStats();
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
        onLibraryChangedRef.current?.();
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
    if (selectedPaths.size === 0) return;
    await movePathsToDestination(
      Array.from(selectedPaths),
      targetMoveFolder.trim()
    );
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
        fetchStorageStats();
        onLibraryChangedRef.current?.();
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
    if (selectedFileItems.length === 0) return;
    setBulkSaving(true);
    try {
      const items = selectedFileItems.map((fileItem) => ({
        relativePath: fileItem.relativePath,
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
        fetchStorageStats();
        onLibraryChangedRef.current?.();
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
        fetchStorageStats();
        onLibraryChangedRef.current?.();
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

  const handleToggleCronJob = async (job: ScheduledCronJob) => {
    try {
      const resp = await fetch(
        `/api/scheduler/jobs/${encodeURIComponent(job.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !job.enabled }),
        }
      );
      const data = await resp.json();
      if (resp.ok && data?.ok && Array.isArray(data.jobs)) {
        setCronJobs(data.jobs);
      }
    } catch {
      // ignore
    }
  };

  const handleChangeCronInterval = async (
    job: ScheduledCronJob,
    intervalHours: number
  ) => {
    try {
      const resp = await fetch(
        `/api/scheduler/jobs/${encodeURIComponent(job.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intervalHours }),
        }
      );
      const data = await resp.json();
      if (resp.ok && data?.ok && Array.isArray(data.jobs)) {
        setCronJobs(data.jobs);
      }
    } catch {
      // ignore
    }
  };

  const handleRunCronJobNow = async (job: ScheduledCronJob) => {
    setRunningCronId(job.id);
    try {
      const resp = await fetch(
        `/api/scheduler/jobs/${encodeURIComponent(job.id)}/run`,
        {
          method: 'POST',
        }
      );
      const data = await resp.json();
      if (resp.ok && data?.ok) {
        if (Array.isArray(data.jobs)) setCronJobs(data.jobs);
        fetchStorageStats();
        loadDirectory(currentPath);
        onLibraryChangedRef.current?.();
        setStatusBanner({
          type: 'ok',
          text: `Task "${job.name}" completed: ${data.job?.lastSummary || 'Success'}`,
        });
      }
    } catch {
      setStatusBanner({
        type: 'err',
        text: `Failed to execute scheduled task "${job.name}".`,
      });
    } finally {
      setRunningCronId(null);
    }
  };

  const handleCreateCustomCronJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCronName.trim()) return;
    try {
      const resp = await fetch('/api/scheduler/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCronName.trim(),
          taskType: newCronTaskType,
          intervalHours: newCronIntervalHours,
          enabled: true,
        }),
      });
      const data = await resp.json();
      if (resp.ok && data?.ok && Array.isArray(data.jobs)) {
        setCronJobs(data.jobs);
        setNewCronName('');
        setStatusBanner({
          type: 'ok',
          text: `Added scheduled task "${data.job?.name}".`,
        });
      }
    } catch {
      // ignore
    }
  };

  const handleDeleteCronJob = async (jobId: string) => {
    try {
      const resp = await fetch(
        `/api/scheduler/jobs/${encodeURIComponent(jobId)}`,
        {
          method: 'DELETE',
        }
      );
      const data = await resp.json();
      if (resp.ok && data?.ok && Array.isArray(data.jobs)) {
        setCronJobs(data.jobs);
      }
    } catch {
      // ignore
    }
  };

  return (
    <div data-testid="file-and-tag-manager-view" className="space-y-5">
      {/* =====================================================================
          STORAGE & DRIVE CAPACITY DASHBOARD (/music + Docker Volume)
         ===================================================================== */}
      <div className="winamp-bezel rounded-2xl border border-zinc-700/80 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-3.5">
          <div className="flex items-center gap-2.5">
            <HardDrive className="w-5 h-5 text-[#00ff66] shrink-0" />
            <div>
              <h1 className="text-xs sm:text-sm font-mono font-bold uppercase tracking-wider text-white">
                FILES, STORAGE STATS, PICARD TAGGER &amp; 24H LIBRARY ORGANIZER
              </h1>
              <p className="text-[11px] font-mono text-zinc-400">
                Manage 1,000s of files &amp; folders with drag-and-drop, inspect
                drive space, clean messy libraries, and schedule 24h automated
                maintenance
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowOrganizeModal(true)}
              data-testid="btn-clean-established-library"
              className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/50 bg-purple-950/40 hover:bg-purple-900/60 px-3.5 py-2 text-xs font-mono font-bold text-purple-200 transition-colors shadow-md"
            >
              <Wand2 className="w-3.5 h-3.5 text-purple-300" />
              <span>Clean Established Library</span>
            </button>

            <button
              type="button"
              onClick={() => {
                fetchStorageStats();
                loadDirectory(currentPath);
                fetchCronJobs();
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:border-zinc-500 px-3 py-2 text-xs font-mono text-zinc-200 hover:text-white"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-[#00ff66] ${
                  loadingStorageStats ? 'animate-spin' : ''
                }`}
              />
              <span>Refresh Stats</span>
            </button>
          </div>
        </div>

        {/* Storage Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: Music Folder Used */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-3.5 space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span>MUSIC LIBRARY USED ({storageStats?.musicRoot || '/music'})</span>
              <FileAudio className="w-4 h-4 text-[#00ff66]" />
            </div>
            <div className="text-lg font-mono font-bold text-white">
              {storageStats ? formatBytes(storageStats.musicUsedBytes) : '—'}
            </div>
            <div className="text-[11px] font-mono text-zinc-400">
              <span className="text-[#00ff66] font-bold">
                {storageStats?.musicFileCount ?? files.length}
              </span>{' '}
              audio files ·{' '}
              <span className="text-zinc-200 font-bold">
                {storageStats?.musicFolderCount ?? folders.length}
              </span>{' '}
              folders
            </div>
          </div>

          {/* Card 2: Drive Free Space & Total Capacity */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span>DRIVE FREE SPACE</span>
              <HardDrive className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-lg font-mono font-bold text-cyan-300">
              {storageStats && storageStats.diskTotalBytes > 0
                ? `${formatBytes(storageStats.diskFreeBytes)} Free`
                : 'Mounted Volume'}
            </div>
            {storageStats && storageStats.diskTotalBytes > 0 ? (
              <div className="space-y-1">
                <div className="w-full h-2 rounded-full bg-zinc-900 overflow-hidden border border-zinc-800">
                  <div
                    className="h-full bg-gradient-to-r from-[#00ff66] to-cyan-400 rounded-full"
                    style={{
                      width: `${Math.min(100, storageStats.diskUsedPercent)}%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                  <span>{storageStats.diskUsedPercent}% used</span>
                  <span>
                    Total: {formatBytes(storageStats.diskTotalBytes)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-[11px] font-mono text-zinc-500">
                Docker volume active ({storageStats?.indexedTrackCount ?? 0} indexed)
              </div>
            )}
          </div>

          {/* Card 3: Metadata & Artwork Health */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-3.5 space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span>METADATA &amp; ARTWORK HEALTH</span>
              <Fingerprint className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-lg font-mono font-bold text-white">
              {storageStats
                ? `${storageStats.missingMetadataCount} Unverified`
                : '—'}
            </div>
            <div className="text-[11px] font-mono text-zinc-400">
              <span className="text-amber-300">
                {storageStats?.missingArtworkCount ?? 0} missing cover art
              </span>{' '}
              ·{' '}
              <span className="text-purple-300">
                {storageStats?.stagingFileCount ?? 0} in _inbox
              </span>
            </div>
          </div>

          {/* Card 4: SQLite Database & 24h Scheduler */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-3.5 space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span>SQLITE DB &amp; 24H CRON</span>
              <Database className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-lg font-mono font-bold text-[#00ff66]">
              {storageStats ? formatBytes(storageStats.dbSizeBytes) : '—'}
            </div>
            <div className="text-[11px] font-mono text-zinc-400">
              <span className="text-white font-bold">
                {cronJobs.filter((j) => j.enabled).length}/{cronJobs.length}
              </span>{' '}
              scheduled 24h tasks active
            </div>
          </div>
        </div>

        {/* Sub-Navigation Pills inside Files & Organizer */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setActiveSubTab('files')}
            data-testid="files-subtab-manager"
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-mono font-bold transition-colors ${
              activeSubTab === 'files'
                ? 'bg-[#00ff66] text-zinc-950 shadow-md'
                : 'bg-zinc-950 text-zinc-300 hover:text-white border border-zinc-800'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>1. Web File, Folder &amp; Tag Manager ({musicRoot})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('scheduler')}
            data-testid="files-subtab-scheduler"
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-mono font-bold transition-colors ${
              activeSubTab === 'scheduler'
                ? 'bg-[#00ff66] text-zinc-950 shadow-md'
                : 'bg-zinc-950 text-zinc-300 hover:text-white border border-zinc-800'
            }`}
          >
            <CalendarClock className="w-3.5 h-3.5" />
            <span>
              2. 24-Hour Automated Tasks &amp; Cron ({cronJobs.length})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('picard')}
            data-testid="files-subtab-picard"
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-mono font-bold transition-colors ${
              activeSubTab === 'picard'
                ? 'bg-[#00ff66] text-zinc-950 shadow-md'
                : 'bg-zinc-950 text-zinc-300 hover:text-white border border-zinc-800'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>3. Picard &amp; Acoustic Metadata Tagger</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          SUB-TAB 2: 24-HOUR AUTOMATED SCHEDULED TASKS & CRON ENGINE
         ===================================================================== */}
      {activeSubTab === 'scheduler' && (
        <div
          data-testid="scheduled-tasks-cron-panel"
          className="winamp-bezel rounded-2xl border border-zinc-700/80 p-5 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
            <div>
              <h2 className="text-sm sm:text-base font-mono font-bold text-white flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-[#00ff66]" />
                <span>
                  24-Hour Automated Maintenance &amp; Library Organizer Cron
                  Engine
                </span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Runs quietly every 24 hours (or any interval you choose) to scan{' '}
                <code>/music</code>, heal missing metadata &amp; cover art,
                organize incoming downloads, and keep SQLite fast.
              </p>
            </div>
            <button
              type="button"
              onClick={fetchCronJobs}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-200 hover:text-white shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-[#00ff66] ${
                  loadingCronJobs ? 'animate-spin' : ''
                }`}
              />
              <span>Refresh Tasks</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {cronJobs.map((job) => (
              <div
                key={job.id}
                data-testid={`cron-job-card-${job.id}`}
                className={`rounded-2xl border p-4 flex flex-col justify-between gap-3 transition-colors ${
                  job.enabled
                    ? 'border-emerald-500/40 bg-zinc-950/90'
                    : 'border-zinc-800 bg-zinc-950/50 opacity-75'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-mono font-bold uppercase ${
                            job.enabled
                              ? 'bg-[#00ff66]/20 text-[#00ff66] border border-[#00ff66]/40'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {job.enabled
                            ? `EVERY ${job.intervalHours}H`
                            : 'PAUSED'}
                        </span>
                        <h3 className="text-sm font-mono font-bold text-white">
                          {job.name}
                        </h3>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        {job.description}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggleCronJob(job)}
                      className={`rounded-xl px-3 py-1 text-xs font-mono font-bold shrink-0 transition-colors ${
                        job.enabled
                          ? 'bg-[#00ff66] text-zinc-950'
                          : 'border border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white'
                      }`}
                    >
                      {job.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>

                  <div className="rounded-xl bg-zinc-900/80 border border-zinc-800/80 p-2.5 text-[11px] font-mono space-y-1">
                    <div className="flex items-center justify-between text-zinc-400">
                      <span>
                        Last Run:{' '}
                        <strong className="text-zinc-200">
                          {job.lastRunAt || 'Not run yet'}
                        </strong>
                      </span>
                      <span>
                        Next Run:{' '}
                        <strong className="text-[#00ff66]">
                          {job.enabled ? job.nextRunAt || 'Scheduled' : 'Paused'}
                        </strong>
                      </span>
                    </div>
                    <div className="text-zinc-300 truncate">
                      Status: {job.lastSummary}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800/80">
                  <div className="flex items-center gap-1.5 text-xs font-mono">
                    <Clock className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="text-zinc-400">Schedule:</span>
                    <select
                      value={job.intervalHours}
                      onChange={(e) =>
                        handleChangeCronInterval(job, Number(e.target.value))
                      }
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-mono text-[#00ff66] font-bold"
                    >
                      <option value={6}>Every 6 Hours</option>
                      <option value={12}>Every 12 Hours</option>
                      <option value={24}>Every 24 Hours (Daily)</option>
                      <option value={72}>Every 3 Days</option>
                      <option value={168}>Every 7 Days (Weekly)</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={runningCronId === job.id}
                      onClick={() => handleRunCronJobNow(job)}
                      data-testid={`btn-run-cron-${job.id}`}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 disabled:opacity-50 px-3 py-1.5 text-xs font-mono font-bold text-zinc-950"
                    >
                      {runningCronId === job.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current" />
                      )}
                      <span>Run Now</span>
                    </button>

                    {!job.builtIn && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCronJob(job.id)}
                        className="p-1.5 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-rose-400"
                        title="Delete custom task"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add Custom Scheduled Task Form */}
          <form
            onSubmit={handleCreateCustomCronJob}
            className="rounded-2xl border border-emerald-500/30 bg-zinc-950/90 p-4 space-y-3"
          >
            <h3 className="text-xs font-mono font-bold uppercase text-[#00ff66]">
              + Add Custom Scheduled Task
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-4">
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  Task Name
                </label>
                <input
                  type="text"
                  value={newCronName}
                  onChange={(e) => setNewCronName(e.target.value)}
                  placeholder="e.g. Nightly Library Fingerprint & Cleanup"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white"
                />
              </div>
              <div className="md:col-span-4">
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  Action Type
                </label>
                <select
                  value={newCronTaskType}
                  onChange={(e) =>
                    setNewCronTaskType(
                      e.target.value as ScheduledCronJob['taskType']
                    )
                  }
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white"
                >
                  <option value="library_scan_and_heal">
                    Scan /music + Heal Missing Metadata &amp; Cover Art
                  </option>
                  <option value="auto_organize_library">
                    Auto-Organize Messy Folders &amp; Staging Inbox
                  </option>
                  <option value="cleanup_logs_and_temp">
                    Clean Empty Folders, Stale Alerts &amp; Optimize SQLite
                  </option>
                  <option value="playlist_sync_all">
                    Sync Linked Spotify &amp; ListenBrainz Playlists
                  </option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                  Interval
                </label>
                <select
                  value={newCronIntervalHours}
                  onChange={(e) =>
                    setNewCronIntervalHours(Number(e.target.value))
                  }
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-[#00ff66] font-bold"
                >
                  <option value={6}>Every 6h</option>
                  <option value={12}>Every 12h</option>
                  <option value={24}>Every 24h</option>
                  <option value={168}>Weekly</option>
                </select>
              </div>
              <div className="md:col-span-2 flex items-end">
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#00ff66] hover:bg-emerald-400 px-4 py-2 text-xs font-mono font-bold text-zinc-950"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Task</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 3: PICARD & ACOUSTIC METADATA TAGGER CONFIG / TESTER
         ===================================================================== */}
      {activeSubTab === 'picard' && (
        <div
          data-testid="picard-organizer-panel"
          className="winamp-bezel rounded-2xl border border-zinc-700/80 p-5 space-y-5"
        >
          <div className="space-y-1 border-b border-zinc-800 pb-4">
            <h2 className="text-base font-bold text-white font-mono flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span>
                MusicBrainz Picard + AcoustID Auto-Tagger &amp; Folder
                Architecture
              </span>
            </h2>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Automatically cleans messy download filenames (like{' '}
              <code className="text-rose-300">
                Linkin_Park_-_In_The_End_Official_Video_1080p.mp3
              </code>
              ), looks up the canonical Album, Release Year, and Track Number
              via <strong className="text-white">AcoustID Fingerprinting</strong>{' '}
              and <strong className="text-[#00ff66]">MusicBrainz Picard</strong>,
              and organizes files into clean{' '}
              <code className="text-[#00ff66]">
                {picardConfig?.folderTemplate ||
                  '{Artist}/{Album} ({Year})/{TrackNumber} - {Title}.{ext}'}
              </code>{' '}
              folders in your Brokeify library.
            </p>
          </div>

          {picardConfig && onUpdatePicardConfig && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-mono text-zinc-300 mb-1">
                  Folder Organization Template (Picard Style)
                </label>
                <input
                  type="text"
                  value={picardConfig.folderTemplate}
                  onChange={(e) =>
                    onUpdatePicardConfig({
                      ...picardConfig,
                      folderTemplate: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-[#00ff66] focus:border-[#00ff66] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-zinc-300 mb-1">
                  Music Library Root Path
                </label>
                <input
                  type="text"
                  value={picardConfig.targetMusicRoot}
                  onChange={(e) =>
                    onUpdatePicardConfig({
                      ...picardConfig,
                      targetMusicRoot: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-white focus:border-[#00ff66] focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-purple-500/30 bg-zinc-950/90 p-4 space-y-3">
            <label className="block text-xs font-mono font-bold uppercase text-purple-300">
              Test MusicBrainz Picard Folder Organizer on Any Messy Song Name:
            </label>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={picardTestInput}
                onChange={(e) => setPicardTestInput(e.target.value)}
                placeholder="Paste any messy filename or song title..."
                data-testid="picard-test-input"
                className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-mono text-white"
              />
              <button
                type="button"
                disabled={isTestingPicard}
                onClick={async () => {
                  setIsTestingPicard(true);
                  try {
                    const parts = picardTestInput.split(' - ');
                    const artist =
                      parts.length > 1 ? parts[0].trim() : 'Unknown Artist';
                    const title =
                      parts.length > 1
                        ? parts.slice(1).join(' - ').trim()
                        : picardTestInput.trim();
                    const resp = await fetch('/api/picard/resolve-metadata', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        artist,
                        title,
                        ext: 'flac',
                        folderTemplate: picardConfig?.folderTemplate,
                      }),
                    });
                    const data = await resp.json();
                    if (resp.ok && data.ok && data.resolved) {
                      setPicardTestResult(data.resolved);
                    }
                  } finally {
                    setIsTestingPicard(false);
                  }
                }}
                data-testid="picard-test-btn"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2 text-xs font-mono font-bold text-white shrink-0 min-h-[38px]"
              >
                {isTestingPicard ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span>Test Picard Metadata Resolver</span>
              </button>
            </div>

            {picardTestResult && (
              <div
                data-testid="picard-test-result"
                className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3.5 text-xs font-mono space-y-1.5"
              >
                <div className="text-[#00ff66] font-bold">
                  ✓ Organized Folder Path: {picardTestResult.organizedPath}
                </div>
                <div className="text-zinc-300">
                  Artist: <strong>{picardTestResult.artist}</strong> · Title:{' '}
                  <strong>{picardTestResult.title}</strong> · Album:{' '}
                  <strong>
                    {picardTestResult.album} ({picardTestResult.year})
                  </strong>{' '}
                  · Track #{picardTestResult.trackNumber} (Source:{' '}
                  {picardTestResult.source})
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 1: WEB FILE, FOLDER & TAG MANAGER (/music) WITH DRAG & DROP
         ===================================================================== */}
      {activeSubTab === 'files' && (
        <div className="winamp-bezel rounded-2xl border border-zinc-700/80 overflow-hidden space-y-0">
          {/* Top Titlebar */}
          <div className="winamp-titlebar px-4 py-3 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <HardDrive className="w-4 h-4 text-[#00ff66] shrink-0" />
              <div>
                <h2 className="text-xs sm:text-sm font-mono font-bold uppercase tracking-wider text-white">
                  WEB FILE, FOLDER &amp; TAG MANAGER ({musicRoot})
                </h2>
                <p className="text-[11px] font-mono text-zinc-400">
                  Select or Shift-click items, drag &amp; drop files/folders onto
                  any folder or breadcrumb to move them, or run 1-click AcoustID
                  + Picard organization
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
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
                <span>
                  Auto-Identify &amp; Organize Folder ({files.length})
                </span>
              </button>
            </div>
          </div>

          {/* Breadcrumb Bar (Drop Targets!) + Multi-Select & Folder Action Toolbar */}
          <div className="px-4 py-2.5 bg-zinc-950/90 border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-2">
            {/* Breadcrumb Path — each segment is also a Drag-and-Drop destination */}
            <div className="flex flex-wrap items-center gap-1 text-xs font-mono">
              <button
                type="button"
                onClick={() => setCurrentPath('')}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverTarget('__ROOT__');
                }}
                onDragLeave={() => setDragOverTarget(null)}
                onDrop={(e) => handleDropOnFolder(e, '')}
                data-testid="breadcrumb-music-root"
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition-colors ${
                  dragOverTarget === '__ROOT__'
                    ? 'ring-2 ring-[#00ff66] bg-emerald-950/60 text-[#00ff66]'
                    : currentPath === ''
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
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverTarget(rel);
                      }}
                      onDragLeave={() => setDragOverTarget(null)}
                      onDrop={(e) => handleDropOnFolder(e, rel)}
                      className={`rounded-lg px-2 py-1 transition-colors ${
                        dragOverTarget === rel
                          ? 'ring-2 ring-[#00ff66] bg-emerald-950/60 text-[#00ff66]'
                          : isLast
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

            {/* Actions: Select Mode, Select All, New Folder, Bulk Edit Tags, Move, Delete */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setSelectMode((prev) => {
                    if (prev) setSelectedPaths(new Set());
                    return !prev;
                  });
                }}
                data-testid="btn-filemanager-select-mode"
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-mono transition-colors ${
                  selectMode || selectedPaths.size > 0
                    ? 'border-[#00ff66] bg-emerald-950/40 text-[#00ff66] font-bold'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white'
                }`}
              >
                <MousePointerClick className="w-3.5 h-3.5" />
                <span>
                  {selectMode ? 'Exit Select Mode' : 'Select'}
                </span>
              </button>

              {allSelectablePaths.length > 0 && (
                <button
                  type="button"
                  onClick={toggleSelectAllItems}
                  data-testid="btn-filemanager-select-all"
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 hover:border-zinc-500 px-2.5 py-1 text-xs font-mono text-zinc-200 hover:text-white"
                >
                  {allItemsSelected ? (
                    <CheckSquare className="w-3.5 h-3.5 text-[#00ff66]" />
                  ) : (
                    <Square className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                  <span>
                    {allItemsSelected
                      ? `Deselect All (${selectedPaths.size})`
                      : `Select All (${allSelectablePaths.length})`}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowNewFolderInput((prev) => !prev)}
                data-testid="btn-filemanager-new-folder"
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 hover:border-zinc-500 px-2.5 py-1 text-xs font-mono text-zinc-200 hover:text-white"
              >
                <FolderPlus className="w-3.5 h-3.5 text-[#00ff66]" />
                <span>New Folder</span>
              </button>

              {selectedFileItems.length > 0 && (
                <button
                  type="button"
                  onClick={handleOpenBulkTagModal}
                  data-testid="btn-filemanager-bulk-tag"
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-950/40 hover:bg-emerald-900/50 px-2.5 py-1 text-xs font-mono font-bold text-[#00ff66]"
                >
                  <Tag className="w-3.5 h-3.5" />
                  <span>Edit Tags ({selectedFileItems.length})</span>
                </button>
              )}

              {selectedPaths.size > 0 && (
                <>
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
                    <span>Move ({selectedPaths.size})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleDeleteItems(Array.from(selectedPaths))
                    }
                    data-testid="btn-filemanager-delete-selected"
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-500/50 bg-rose-950/40 hover:bg-rose-900/50 px-2.5 py-1 text-xs font-mono font-bold text-rose-300"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete ({selectedPaths.size})</span>
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
            (organizeJob.status === 'running' ||
              organizeJob.status === 'scanning') && (
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
                          {organizeJob.processedFiles} /{' '}
                          {organizeJob.totalFiles} tracks (
                          {organizeJob.totalFiles > 0
                            ? Math.round(
                                (organizeJob.processedFiles /
                                  organizeJob.totalFiles) *
                                  100
                              )
                            : 0}
                          %)
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-zinc-300 truncate max-w-xl">
                        {organizeJob.currentTrackTitle ? (
                          <span>
                            Fingerprinting:{' '}
                            <strong>{organizeJob.currentTrackTitle}</strong> —{' '}
                            {organizeJob.currentTrackArtist || 'Unknown Artist'}
                          </span>
                        ) : (
                          <span>
                            {organizeJob.currentFile ||
                              'Scanning audio files...'}
                          </span>
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
                                (organizeJob.processedFiles /
                                  organizeJob.totalFiles) *
                                  100
                              )
                            )
                          : 5
                      }%`,
                    }}
                  />
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
                      Library Organization Preview ({organizeJob.items.length}{' '}
                      Tracks Ready)
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
                            <strong>{item.title}</strong> — {item.artist} (
                            {item.album}
                            {item.year ? `, ${item.year}` : ''})
                          </span>
                          <span className="text-[10px] text-indigo-300 uppercase">
                            [{item.sourceMethod}]
                          </span>
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

          {/* Move Selected Items Bar */}
          {showMoveBar && (
            <form
              onSubmit={handleMoveSelected}
              className="px-4 py-2.5 bg-indigo-950/30 border-b border-indigo-500/40 flex flex-wrap items-center gap-2"
            >
              <FolderInput className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="text-xs font-mono text-indigo-200">
                Move {selectedPaths.size} selected item(s) to `/music/`:
              </span>
              <input
                type="text"
                value={targetMoveFolder}
                onChange={(e) => setTargetMoveFolder(e.target.value)}
                placeholder="Leave blank for /music root, or e.g. Artist Name/Album (2024)"
                className="flex-1 min-w-[220px] rounded-xl border border-indigo-500/40 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-white focus:border-indigo-400 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-xl bg-indigo-500 hover:bg-indigo-400 px-3 py-1.5 text-xs font-mono font-bold text-white"
              >
                Move Items Here
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
                    Edit Audio Metadata Tags ({selectedFileItems.length} audio
                    file(s) selected)
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
                    Title{' '}
                    {selectedFileItems.length > 1 && '(Leave blank to keep)'}
                  </label>
                  <input
                    type="text"
                    value={bulkTitle}
                    onChange={(e) => setBulkTitle(e.target.value)}
                    placeholder={
                      selectedFileItems.length > 1
                        ? 'Keep individual titles'
                        : 'Title'
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
                      /music/&#123;Artist&#125;/&#123;Album&#125; (&#123;Year&#125;)/&#123;TrackNumber&#125;
                      - &#123;Title&#125;.&#123;ext&#125;
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
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Directory Listing: Parent Folder (..) + Subfolders + Audio Files */}
          <div className="divide-y divide-zinc-800/70 max-h-[580px] overflow-y-auto">
            {currentPath !== '' && (
              <div
                onClick={() => setCurrentPath(parentPath)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverTarget('__PARENT__');
                }}
                onDragLeave={() => setDragOverTarget(null)}
                onDrop={(e) => handleDropOnFolder(e, parentPath)}
                data-testid="filemanager-parent-folder"
                className={`px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                  dragOverTarget === '__PARENT__'
                    ? 'bg-emerald-950/50 ring-1 ring-[#00ff66]'
                    : 'bg-zinc-950/60 hover:bg-zinc-900/70'
                }`}
              >
                <div className="flex items-center gap-2.5 text-xs font-mono text-zinc-300">
                  <ArrowUpLeft className="w-4 h-4 text-[#00ff66]" />
                  <span className="font-bold text-white">..</span>
                  <span className="text-zinc-400">
                    (Up to /music/{parentPath || ''}) — Drop items here to move
                    up a folder
                  </span>
                </div>
              </div>
            )}

            {folders.length === 0 && files.length === 0 && !loading && (
              <div className="p-10 text-center space-y-2 font-mono">
                <Folder className="w-8 h-8 text-zinc-600 mx-auto" />
                <div className="text-sm font-bold text-zinc-300">
                  This folder is empty
                </div>
                <p className="text-xs text-zinc-500 max-w-md mx-auto">
                  Downloaded tracks from slskd and yt-dlp land in{' '}
                  <code>/music/_inbox</code> and are automatically fingerprinted
                  and organized into <code>/music/Artist/Album (Year)/</code>.
                </p>
              </div>
            )}

            {/* Subfolders (Draggable & Drop Targets) */}
            {folders.map((folder) => {
              const isRenaming = renamingPath === folder.relativePath;
              const isSelected = selectedPaths.has(folder.relativePath);
              const isDropTarget = dragOverTarget === folder.relativePath;
              return (
                <div
                  key={`dir-${folder.relativePath}`}
                  draggable={!isRenaming && !folder.isStagingInbox}
                  onDragStart={(e) =>
                    handleDragStartItem(e, folder.relativePath)
                  }
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverTarget(folder.relativePath);
                  }}
                  onDragLeave={() => setDragOverTarget(null)}
                  onDrop={(e) => handleDropOnFolder(e, folder.relativePath)}
                  data-testid={`filemanager-folder-${folder.name}`}
                  className={`px-4 py-2.5 flex items-center justify-between gap-3 transition-colors ${
                    isDropTarget
                      ? 'bg-emerald-950/60 ring-2 ring-inset ring-[#00ff66]'
                      : isSelected
                      ? 'bg-emerald-950/25'
                      : 'hover:bg-zinc-900/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {!folder.isStagingInbox && (
                      <button
                        type="button"
                        onClick={(e) =>
                          toggleSelectPath(folder.relativePath, e.shiftKey)
                        }
                        className="text-zinc-400 hover:text-white shrink-0"
                        title="Select folder (Shift+Click for range)"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-[#00ff66]" />
                        ) : (
                          <Square className="w-4 h-4 text-zinc-600" />
                        )}
                      </button>
                    )}

                    <GripVertical className="w-3.5 h-3.5 text-zinc-600 cursor-grab shrink-0" />

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
                          onClick={() =>
                            handleConfirmRename(folder.relativePath)
                          }
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
                        onClick={(e) => {
                          if (selectMode) {
                            toggleSelectPath(folder.relativePath, e.shiftKey);
                          } else {
                            setCurrentPath(folder.relativePath);
                          }
                        }}
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
                      {selectMode && (
                        <button
                          type="button"
                          onClick={() => setCurrentPath(folder.relativePath)}
                          className="px-2 py-1 rounded-lg border border-zinc-700 text-[11px] font-mono text-zinc-300 hover:text-white"
                        >
                          Open
                        </button>
                      )}
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
                        onClick={() =>
                          handleDeleteItems([folder.relativePath])
                        }
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

            {/* Audio Files (Draggable + Shift-Click Multi-Select) */}
            {files.map((file) => {
              const isSelected = selectedPaths.has(file.relativePath);
              const isRenaming = renamingPath === file.relativePath;
              return (
                <div
                  key={`file-${file.relativePath}`}
                  draggable={!isRenaming}
                  onDragStart={(e) =>
                    handleDragStartItem(e, file.relativePath)
                  }
                  onClick={(e) => {
                    if (selectMode && !isRenaming) {
                      toggleSelectPath(file.relativePath, e.shiftKey);
                    }
                  }}
                  data-testid={`filemanager-file-${file.name}`}
                  className={`px-4 py-2.5 flex items-center justify-between gap-3 transition-colors ${
                    isSelected ? 'bg-emerald-950/25' : 'hover:bg-zinc-900/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectPath(file.relativePath, e.shiftKey);
                      }}
                      className="text-zinc-400 hover:text-white shrink-0"
                      title="Select file (Shift+Click for range)"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-[#00ff66]" />
                      ) : (
                        <Square className="w-4 h-4 text-zinc-600" />
                      )}
                    </button>

                    <GripVertical className="w-3.5 h-3.5 text-zinc-600 cursor-grab shrink-0" />

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
                          Tag:{' '}
                          <strong className="text-zinc-200">
                            {file.title}
                          </strong>{' '}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPaths(new Set([file.relativePath]));
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
                      onClick={(e) => {
                        e.stopPropagation();
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
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteItems([file.relativePath]);
                      }}
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
        </div>
      )}

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
              Clean, fingerprint, tag, and organize an already established or
              messy music collection into standard structure:
              <br />
              <code className="text-[#00ff66] font-mono text-[11px] block mt-1">
                /music/&#123;Artist&#125;/&#123;Album&#125; (&#123;Year&#125;)/&#123;TrackNumber&#125;
                - &#123;Title&#125;.&#123;ext&#125;
              </code>
            </p>

            <div className="space-y-3 text-xs font-mono">
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

              <label className="flex items-center gap-2 cursor-pointer text-zinc-300 pt-1">
                <input
                  type="checkbox"
                  checked={organizeRecursive}
                  onChange={(e) => setOrganizeRecursive(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-[#00ff66] focus:ring-0"
                />
                <span>Include all subfolders recursively</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                <input
                  type="checkbox"
                  checked={organizeSkipOrganized}
                  onChange={(e) => setOrganizeSkipOrganized(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-[#00ff66] focus:ring-0"
                />
                <span>Skip files already in Artist/Album format</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-purple-300">
                <input
                  type="checkbox"
                  checked={organizeDryRun}
                  onChange={(e) => setOrganizeDryRun(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-purple-400 focus:ring-0"
                />
                <span>
                  Dry Run: Preview Before/After changes without modifying files
                </span>
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
