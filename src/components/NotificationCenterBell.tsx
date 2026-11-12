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
  | 'library';

export interface AppNotificationItem {
  id: string;
  message: string;
  category: AppNotificationCategory;
  createdAt: string;
  read: boolean;
}

export function inferNotificationCategory(
  message: string
): AppNotificationCategory {
  const lower = message.toLowerCase();
  if (
    lower.includes('download') ||
    lower.includes('grab') ||
    lower.includes('slskd') ||
    lower.includes('lidarr') ||
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
  const [filter, setFilter] = useState<'all' | 'unread' | 'download' | 'system'>(
    'all'
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      if (filter === 'unread') return !n.read;
      if (filter === 'download') return n.category === 'download';
      if (filter === 'system')
        return n.category === 'system' || n.category === 'security';
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

  const renderCategoryIcon = (cat: AppNotificationCategory, msg: string) => {
    if (msg.includes('⚠️') || msg.includes('🚨')) {
      return <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    }
    if (cat === 'download') {
      return <Download className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
    }
    if (cat === 'security') {
      return <Shield className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
    }
    if (cat === 'library') {
      return <Heart className="w-3.5 h-3.5 text-[#00ff66] shrink-0" />;
    }
    return <Sparkles className="w-3.5 h-3.5 text-[#00ff66] shrink-0" />;
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        data-testid="btn-notification-center"
        aria-label={`Notifications (${unreadCount} unread)`}
        title={`Notifications (${unreadCount} unread, ${notifications.length} total)`}
        className={`relative inline-flex items-center justify-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-mono font-semibold transition-colors min-h-[36px] min-w-[38px] ${
          isOpen
            ? 'border-[#00ff66] bg-emerald-500/20 text-[#00ff66]'
            : unreadCount > 0
              ? 'border-rose-500/50 bg-zinc-900 text-white hover:border-rose-400'
              : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white hover:border-zinc-600'
        }`}
      >
        <Bell className="w-4 h-4" />
        <span className="hidden xl:inline">Alerts</span>

        {/* Red Unread Notification Count Badge */}
        {unreadCount > 0 && (
          <span
            data-testid="notification-badge-count"
            className=" -top-1.5 -right-1.5 absolute min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 border border-zinc-950 text-[10px] font-mono font-extrabold text-white flex items-center justify-center shadow-md"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Center Dropdown / Drawer */}
      {isOpen && (
        <div
          data-testid="notification-center-popover"
          className="fixed sm:absolute right-2 sm:right-0 top-14 sm:top-full sm:mt-2 w-[calc(100vw-1rem)] sm:w-[420px] max-h-[80vh] rounded-2xl border border-zinc-700 bg-zinc-950/98 shadow-2xl backdrop-blur-xl z-50 flex flex-col overflow-hidden"
        >
          {/* Top Header */}
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-2 bg-zinc-900/80">
            <div className="flex items-center gap-2 min-w-0">
              <Bell className="w-4 h-4 text-[#00ff66] shrink-0" />
              <span className="text-xs sm:text-sm font-mono font-bold text-white truncate">
                Notifications
              </span>
              <span className="text-[11px] font-mono text-zinc-400">
                · {unreadCount} unread / {notifications.length} total
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={onToggleMutePopupBanners}
                data-testid="btn-toggle-mute-toasts"
                title={
                  mutePopupBanners
                    ? 'Quiet Mode ON: Notifications only collect in this Bell menu'
                    : 'Popup Toasts ON: Click to silence floating toast banners'
                }
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold transition-colors ${
                  mutePopupBanners
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
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
                    <Bell className="w-3 h-3 text-[#00ff66]" />
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
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: 'all', label: `All (${notifications.length})` },
                    { id: 'unread', label: `Unread (${unreadCount})` },
                    { id: 'download', label: 'Downloads' },
                    { id: 'system', label: 'System' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id)}
                    data-testid={`notification-filter-${tab.id}`}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold transition-colors ${
                      filter === tab.id
                        ? 'bg-[#00ff66] text-zinc-950 font-bold'
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
                  <CheckSquare className="w-3.5 h-3.5 text-[#00ff66]" />
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
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-900/40 px-2 py-1 text-[10px] font-mono font-bold text-[#00ff66]"
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
                    onClick={onMarkAllRead}
                    data-testid="btn-notifications-mark-all-read"
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 hover:border-[#00ff66]/40 px-2 py-1 text-[10px] font-mono font-semibold text-zinc-200 hover:text-white"
                  >
                    <CheckCheck className="w-3 h-3 text-[#00ff66]" />
                    <span>Mark All Read</span>
                  </button>
                )}

                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
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
                  Library scans, Spotify playlist syncs, download completions,
                  and security alerts will appear here.
                </p>
              </div>
            ) : (
              filteredNotifications.map((item) => {
                const isSelected = selectedIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    data-testid={`notification-item-${item.id}`}
                    className={`px-3.5 py-2.5 flex items-start gap-2.5 text-xs font-mono transition-colors ${
                      isSelected
                        ? 'bg-emerald-950/25'
                        : !item.read
                          ? 'bg-zinc-900/70'
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
                        <CheckSquare className="w-4 h-4 text-[#00ff66]" />
                      ) : (
                        <Square className="w-4 h-4 text-zinc-600" />
                      )}
                    </button>

                    {/* Category Icon */}
                    <div className="mt-0.5">
                      {renderCategoryIcon(item.category, item.message)}
                    </div>

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
                            ? 'text-white font-semibold'
                            : 'text-zinc-300'
                        }`}
                      >
                        {item.message}
                      </div>
                      <div className="text-[10px] text-zinc-500 flex items-center gap-1.5">
                        <span>{item.createdAt}</span>
                        <span>·</span>
                        <span className="uppercase">{item.category}</span>
                        {!item.read && (
                          <>
                            <span>·</span>
                            <span className="text-[#00ff66] font-bold">
                              NEW
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
