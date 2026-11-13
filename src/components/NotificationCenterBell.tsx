import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  CheckSquare,
  Download,
  Heart,
  Info,
  Radio,
  Shield,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';

export type AppNotificationCategory =
  | 'system'
  | 'download'
  | 'security'
  | 'library'
  | 'slskd'
  | 'lidarr'
  | 'youtube'
  | 'listenbrainz'
  | 'audio';

export type AppNotificationSeverity = 'info' | 'success' | 'warn' | 'error';

export interface AppNotificationItem {
  id: string;
  message: string;
  category: AppNotificationCategory;
  severity?: AppNotificationSeverity;
  service?: string;
  createdAt: string;
  read: boolean;
}

export function inferNotificationCategory(
  message: string
): AppNotificationCategory {
  const lower = message.toLowerCase();
  if (lower.includes('slskd') || lower.includes('soulseek')) return 'slskd';
  if (lower.includes('lidarr')) return 'lidarr';
  if (lower.includes('yt-dlp') || lower.includes('youtube')) return 'youtube';
  if (lower.includes('listenbrainz') || lower.includes('scrobble'))
    return 'listenbrainz';
  if (
    lower.includes('download') ||
    lower.includes('grab') ||
    lower.includes('ready to play') ||
    lower.includes('ready via') ||
    lower.includes('spotify') ||
    lower.includes('sync') ||
    lower.includes('queue')
  ) {
    return 'download';
  }
  if (
    lower.includes('lock') ||
    lower.includes('security') ||
    lower.includes('api key') ||
    lower.includes('login') ||
    lower.includes('password') ||
    lower.includes('token')
  ) {
    return 'security';
  }
  if (
    lower.includes('like') ||
    lower.includes('playlist') ||
    lower.includes('library') ||
    lower.includes('scan') ||
    lower.includes('shuffle')
  ) {
    return 'library';
  }
  return 'system';
}

export function inferNotificationSeverity(
  item: Pick<AppNotificationItem, 'message' | 'severity'>
): AppNotificationSeverity {
  if (item.severity) return item.severity;
  const lower = String(item.message || '').toLowerCase();
  if (
    lower.includes('🚨') ||
    lower.includes('unreachable') ||
    lower.includes('failed') ||
    lower.includes('error') ||
    lower.includes('disconnected') ||
    lower.includes('http 5') ||
    lower.includes('http 4') ||
    lower.includes('unmounted')
  ) {
    return 'error';
  }
  if (lower.includes('⚠️') || lower.includes('warn') || lower.includes('timeout')) {
    return 'warn';
  }
  if (
    lower.includes('ready to play') ||
    lower.includes('ready via') ||
    lower.includes('completed') ||
    lower.includes('downloaded') ||
    lower.includes('imported')
  ) {
    return 'success';
  }
  return 'info';
}

interface NotificationCenterBellProps {
  notifications: AppNotificationItem[];
  onMarkAsRead: (ids: string[]) => void;
  onMarkAllRead: () => void;
  onDeleteSelected: (ids: string[]) => void;
  onClearAll: () => void;
  mutePopupBanners: boolean;
  onToggleMutePopupBanners: () => void;
}

export const NotificationCenterBell: React.FC<NotificationCenterBellProps> = ({
  notifications,
  onMarkAsRead,
  onMarkAllRead,
  onDeleteSelected,
  onClearAll,
  mutePopupBanners,
  onToggleMutePopupBanners,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<
    'all' | 'unread' | 'download' | 'errors'
  >('all');
  const [hasCheckedCurrentBatch, setHasCheckedCurrentBatch] = useState(false);
  const lastUnreadSignatureRef = useRef<string>('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  const unreadItems = useMemo(
    () => notifications.filter((n) => !n.read),
    [notifications]
  );

  const unreadCount = unreadItems.length;

  const unreadErrors = useMemo(
    () =>
      unreadItems.filter((n) => {
        const sev = inferNotificationSeverity(n);
        return sev === 'error' || sev === 'warn';
      }).length,
    [unreadItems]
  );

  // Re-arm bouncing/flashing whenever a new unread notification arrives
  useEffect(() => {
    const sig = unreadItems.map((n) => n.id).join('|');
    if (unreadCount === 0) {
      setHasCheckedCurrentBatch(true);
      lastUnreadSignatureRef.current = '';
      return;
    }
    if (sig !== lastUnreadSignatureRef.current) {
      lastUnreadSignatureRef.current = sig;
      if (!isOpen) {
        setHasCheckedCurrentBatch(false);
      }
    }
  }, [unreadItems, unreadCount, isOpen]);

  // Auto-quiet immediately when the user opens the Alerts dropdown
  useEffect(() => {
    if (isOpen) {
      setHasCheckedCurrentBatch(true);
    }
  }, [isOpen]);

  const isFlashingActive = unreadCount > 0 && !hasCheckedCurrentBatch && !isOpen;
  const hasUrgentError = unreadErrors > 0;

  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      if (filter === 'unread') return !n.read;
      if (filter === 'download')
        return (
          n.category === 'download' ||
          n.category === 'slskd' ||
          n.category === 'lidarr' ||
          n.category === 'youtube' ||
          n.category === 'listenbrainz'
        );
      if (filter === 'errors') {
        const sev = inferNotificationSeverity(n);
        return sev === 'error' || sev === 'warn';
      }
      return true;
    });
  }, [notifications, filter]);

  // Keep selectedIds pruned to existing notification IDs
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(notifications.map((n) => n.id));
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [notifications]);

  // Close popover when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const allVisibleSelected =
    filteredNotifications.length > 0 &&
    filteredNotifications.every((n) => selectedIds.has(n.id));

  const handleToggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const n of filteredNotifications) {
          next.delete(n.id);
        }
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const n of filteredNotifications) {
          next.add(n.id);
        }
        return next;
      });
    }
  };

  const handleToggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteChecked = () => {
    if (selectedIds.size === 0) return;
    onDeleteSelected(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const renderCategoryIcon = (item: AppNotificationItem) => {
    const sev = inferNotificationSeverity(item);
    if (sev === 'error') {
      return <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
    }
    if (sev === 'warn') {
      return <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    }
    if (
      item.category === 'download' ||
      item.category === 'slskd' ||
      item.category === 'lidarr' ||
      item.category === 'youtube'
    ) {
      return <Download className="w-3.5 h-3.5 text-[#10b981] shrink-0" />;
    }
    if (item.category === 'listenbrainz') {
      return <Radio className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
    }
    if (item.category === 'security') {
      return <Shield className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
    }
    if (item.category === 'library') {
      return <Heart className="w-3.5 h-3.5 text-[#00ff66] shrink-0" />;
    }
    return <Sparkles className="w-3.5 h-3.5 text-[#10b981] shrink-0" />;
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Radar Ping Ring when unread alerts are waiting for attention */}
      {isFlashingActive && (
        <span
          aria-hidden="true"
          data-testid="notification-bell-radar-ping"
          className={`pointer-events-none absolute -inset-0.5 rounded-xl opacity-75 animate-ping ${
            hasUrgentError
              ? 'bg-red-500/50 border border-amber-400'
              : 'bg-[#10b981]/45 border border-[#10b981]'
          }`}
        />
      )}

      <button
        type="button"
        onClick={() => {
          setHasCheckedCurrentBatch(true);
          setIsOpen((prev) => !prev);
        }}
        data-testid="btn-notification-center"
        aria-label={`Notifications (${unreadCount} unread${
          unreadErrors > 0 ? `, ${unreadErrors} errors` : ''
        })`}
        title={
          hasUrgentError
            ? `URGENT: ${unreadErrors} service error(s) (${unreadCount} unread total)`
            : `Notifications (${unreadCount} unread, ${notifications.length} total)`
        }
        className={`relative inline-flex items-center justify-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-mono font-semibold transition-all min-h-[36px] min-w-[38px] ${
          isOpen
            ? 'border-[#00ff66] bg-emerald-500/20 text-[#00ff66]'
            : isFlashingActive && hasUrgentError
              ? 'border-[#ef4444] bg-red-950/80 text-amber-200 shadow-[0_0_20px_rgba(239,68,68,0.75)] animate-pulse'
              : isFlashingActive
                ? 'border-[#10b981] bg-emerald-950/75 text-[#10b981] shadow-[0_0_18px_rgba(16,185,129,0.65)]'
                : unreadCount > 0 && hasUrgentError
                  ? 'border-red-500/70 bg-zinc-900 text-red-300 hover:border-red-400'
                  : unreadCount > 0
                    ? 'border-[#10b981]/60 bg-zinc-900 text-emerald-300 hover:border-[#10b981]'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white hover:border-zinc-600'
        }`}
      >
        <Bell
          className={`w-4 h-4 ${
            isFlashingActive
              ? hasUrgentError
                ? 'animate-bounce text-[#f59e0b]'
                : 'animate-bounce text-[#10b981]'
              : ''
          }`}
        />
        <span className="hidden xl:inline">Alerts</span>

        {/* Color-Coded Unread Notification Count Badge */}
        {unreadCount > 0 && (
          <span
            data-testid="notification-badge-count"
            className={`-top-1.5 -right-1.5 absolute min-w-[18px] h-[18px] px-1 rounded-full border border-zinc-950 text-[10px] font-mono font-extrabold text-white flex items-center justify-center shadow-md ${
              hasUrgentError ? 'bg-[#ef4444]' : 'bg-[#10b981] text-zinc-950'
            }`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Center Dropdown / Drawer */}
      {isOpen && (
        <div
          data-testid="notification-center-popover"
          className="fixed sm:absolute right-2 sm:right-0 top-14 sm:top-full sm:mt-2 w-[calc(100vw-1rem)] sm:w-[440px] max-h-[82vh] rounded-2xl border border-zinc-700 bg-zinc-950/98 shadow-2xl backdrop-blur-xl z-50 flex flex-col overflow-hidden"
        >
          {/* Top Header */}
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-2 bg-zinc-900/80">
            <div className="flex items-center gap-2 min-w-0">
              <Bell
                className={`w-4 h-4 shrink-0 ${
                  hasUrgentError ? 'text-red-400' : 'text-[#10b981]'
                }`}
              />
              <span className="text-xs sm:text-sm font-mono font-bold text-white truncate">
                Alerts & Activity
              </span>
              <span className="text-[11px] font-mono text-zinc-400">
                · {unreadCount} unread
                {unreadErrors > 0 ? ` (${unreadErrors} errors)` : ''}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={onToggleMutePopupBanners}
                data-testid="btn-toggle-mute-toasts"
                title={
                  mutePopupBanners
                    ? 'Bell Only Mode (Default): Zero layout-shifting banners; all alerts collect here'
                    : 'Click to lock in Bell Only silent mode'
                }
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold transition-colors ${
                  mutePopupBanners
                    ? 'border-[#10b981]/40 bg-[#10b981]/15 text-[#10b981]'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white'
                }`}
              >
                {mutePopupBanners ? (
                  <>
                    <BellOff className="w-3 h-3" />
                    <span>Bell Only</span>
                  </>
                ) : (
                  <>
                    <Bell className="w-3 h-3 text-[#10b981]" />
                    <span>Popups ON</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
                aria-label="Close Notifications"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Filter & Batch Action Toolbar */}
          <div className="px-3.5 py-2.5 border-b border-zinc-800/90 bg-zinc-950 space-y-2">
            {/* Filter Tabs */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 flex-wrap">
                {(
                  [
                    { id: 'all', label: `All (${notifications.length})` },
                    { id: 'unread', label: `Unread (${unreadCount})` },
                    { id: 'download', label: 'Downloads' },
                    {
                      id: 'errors',
                      label:
                        unreadErrors > 0
                          ? `Errors (${unreadErrors})`
                          : 'Errors / System',
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id)}
                    data-testid={`notification-filter-${tab.id}`}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold transition-colors ${
                      filter === tab.id
                        ? tab.id === 'errors' && unreadErrors > 0
                          ? 'bg-red-500 text-white font-bold'
                          : 'bg-[#10b981] text-zinc-950 font-bold'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Select All / Mark Read / Delete Selected / Clear All Row */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-zinc-900">
              <button
                type="button"
                onClick={handleToggleSelectAllVisible}
                disabled={filteredNotifications.length === 0}
                data-testid="checkbox-notifications-select-all"
                className="inline-flex items-center gap-1.5 text-[11px] font-mono text-zinc-300 hover:text-white disabled:opacity-40"
              >
                {allVisibleSelected ? (
                  <CheckSquare className="w-3.5 h-3.5 text-[#10b981]" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-zinc-500" />
                )}
                <span>
                  {allVisibleSelected ? 'Deselect All' : 'Select All'}
                  {selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                </span>
              </button>

              <div className="flex items-center gap-1.5">
                {selectedIds.size > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onMarkAsRead(Array.from(selectedIds));
                        setSelectedIds(new Set());
                      }}
                      data-testid="btn-notifications-mark-selected-read"
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-900/40 px-2 py-1 text-[10px] font-mono font-bold text-[#10b981]"
                    >
                      <Check className="w-3 h-3" />
                      <span>Read ({selectedIds.size})</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDeleteChecked}
                      data-testid="btn-notifications-clear-selected"
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-500/50 bg-rose-950/40 hover:bg-rose-900/50 px-2 py-1 text-[10px] font-mono font-bold text-rose-300"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear Selected ({selectedIds.size})</span>
                    </button>
                  </>
                )}

                {unreadCount > 0 && selectedIds.size === 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setHasCheckedCurrentBatch(true);
                      onMarkAllRead();
                    }}
                    data-testid="btn-notifications-mark-all-read"
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 hover:border-[#10b981]/40 px-2 py-1 text-[10px] font-mono font-semibold text-zinc-200 hover:text-white"
                  >
                    <CheckCheck className="w-3 h-3 text-[#10b981]" />
                    <span>Mark All Read</span>
                  </button>
                )}

                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setHasCheckedCurrentBatch(true);
                      onClearAll();
                      setSelectedIds(new Set());
                    }}
                    data-testid="btn-notifications-clear-all"
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-950/30 hover:bg-rose-900/50 px-2 py-1 text-[10px] font-mono font-bold text-rose-300"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear All</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Notification Items List */}
          <div className="overflow-y-auto divide-y divide-zinc-800/70 max-h-[380px]">
            {filteredNotifications.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <Info className="w-6 h-6 text-zinc-500 mx-auto" />
                <div className="text-xs font-mono font-bold text-zinc-300">
                  No notifications to display
                </div>
                <p className="text-[11px] font-mono text-zinc-500">
                  Completed track downloads, Spotify/ListenBrainz playlist syncs,
                  and service health alerts collect quietly here without
                  interrupting playback.
                </p>
              </div>
            ) : (
              filteredNotifications.map((item) => {
                const isSelected = selectedIds.has(item.id);
                const sev = inferNotificationSeverity(item);
                return (
                  <div
                    key={item.id}
                    data-testid={`notification-item-${item.id}`}
                    className={`px-3.5 py-2.5 flex items-start gap-2.5 text-xs font-mono transition-colors ${
                      isSelected
                        ? 'bg-emerald-950/25'
                        : !item.read && (sev === 'error' || sev === 'warn')
                          ? 'bg-red-950/25 border-l-2 border-l-red-500'
                          : !item.read
                            ? 'bg-zinc-900/70 border-l-2 border-l-[#10b981]'
                            : 'bg-zinc-950 hover:bg-zinc-900/40'
                    }`}
                  >
                    {/* Select Checkbox */}
                    <button
                      type="button"
                      onClick={() => handleToggleSelectOne(item.id)}
                      data-testid={`checkbox-notification-${item.id}`}
                      aria-label="Select notification"
                      className="mt-0.5 text-zinc-400 hover:text-white shrink-0"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-[#10b981]" />
                      ) : (
                        <Square className="w-4 h-4 text-zinc-600" />
                      )}
                    </button>

                    {/* Category / Severity Icon */}
                    <div className="mt-0.5">{renderCategoryIcon(item)}</div>

                    {/* Message & Timestamp */}
                    <button
                      type="button"
                      onClick={() => {
                        if (!item.read) {
                          onMarkAsRead([item.id]);
                        } else {
                          handleToggleSelectOne(item.id);
                        }
                      }}
                      className="flex-1 min-w-0 text-left space-y-1"
                    >
                      <div
                        className={`leading-snug break-words ${
                          !item.read
                            ? sev === 'error'
                              ? 'text-red-200 font-semibold'
                              : sev === 'warn'
                                ? 'text-amber-200 font-semibold'
                                : 'text-white font-semibold'
                            : 'text-zinc-300'
                        }`}
                      >
                        {item.message}
                      </div>
                      <div className="text-[10px] text-zinc-500 flex items-center gap-1.5 flex-wrap">
                        <span>{item.createdAt}</span>
                        <span>·</span>
                        <span className="uppercase">
                          {item.service || item.category}
                        </span>
                        {!item.read && (
                          <>
                            <span>·</span>
                            <span
                              className={`font-bold ${
                                sev === 'error' || sev === 'warn'
                                  ? 'text-red-400'
                                  : 'text-[#10b981]'
                              }`}
                            >
                              {sev === 'error' ? 'ERROR' : 'NEW'}
                            </span>
                          </>
                        )}
                      </div>
                    </button>

                    {/* Single Dismiss Button */}
                    <button
                      type="button"
                      onClick={() => onDeleteSelected([item.id])}
                      title="Dismiss notification"
                      className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800/60 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
