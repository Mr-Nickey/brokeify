import React, { useState } from 'react';
import {
  AlertTriangle,
  Flag,
  Loader2,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { Track } from '../types/music';

export type WrongTrackReason =
  | 'wrong_song'
  | 'unwanted_remix'
  | 'unwanted_live'
  | 'unwanted_acoustic';

interface ReportWrongTrackModalProps {
  track: Track | null;
  playlistId?: string | null;
  onClose: () => void;
  onReportedSuccess: (data: {
    trackId: string;
    message: string;
    playlists?: any[];
  }) => void;
}

const REPORT_REASONS: Array<{
  id: WrongTrackReason;
  label: string;
  description: string;
}> = [
  {
    id: 'wrong_song',
    label: 'Wrong Song / Mismatch',
    description:
      'Audio does not match the track title or artist — quarantine & re-grab verified studio recording.',
  },
  {
    id: 'unwanted_remix',
    label: 'Unwanted Remix / Edit',
    description:
      'File is a club remix, DJ edit, sped-up, or mashup instead of the original album version.',
  },
  {
    id: 'unwanted_live',
    label: 'Unwanted Live Version',
    description:
      'File is a concert/crowd recording — filter out "live" & re-grab the studio master.',
  },
  {
    id: 'unwanted_acoustic',
    label: 'Unwanted Acoustic / Cover',
    description:
      'File is an acoustic, tribute, karaoke, or cover version — re-grab official artist recording.',
  },
];

export const ReportWrongTrackModal: React.FC<ReportWrongTrackModalProps> = ({
  track,
  playlistId,
  onClose,
  onReportedSuccess,
}) => {
  const [selectedReason, setSelectedReason] =
    useState<WrongTrackReason>('wrong_song');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!track) return null;

  const handleSubmitReport = async (reasonOverride?: WrongTrackReason) => {
    const finalReason = reasonOverride || selectedReason;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const resp = await fetch('/api/tracks/report-wrong', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackId: track.id,
          playlistId: playlistId || undefined,
          title: track.title,
          artist: track.artist,
          album: track.album,
          reason: finalReason,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.ok) {
        setErrorMsg(
          data?.error || 'Failed to report and re-queue replacement track.'
        );
        return;
      }
      onReportedSuccess({
        trackId: track.id,
        message:
          data.message ||
          `Quarantined "${track.title}" and queued clean studio replacement.`,
        playlists: data.playlists,
      });
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Network error reporting wrong track.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Report Wrong Track and Auto-Replace"
      data-testid="report-wrong-track-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-amber-500/50 bg-zinc-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-r from-amber-950/70 via-zinc-900 to-zinc-950 border-b border-zinc-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Flag className="w-4 h-4 text-amber-400 shrink-0" />
            <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
              Report Wrong Track &amp; Smart Re-Grab
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 font-mono">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">
            <div className="text-[10px] uppercase tracking-wider text-amber-400 font-bold">
              Target Track to Quarantine &amp; Replace
            </div>
            <div className="text-sm font-bold text-white mt-0.5 truncate">
              {track.title}
            </div>
            <div className="text-xs text-zinc-400 truncate">
              {track.artist} {track.album ? `· ${track.album}` : ''}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold text-zinc-300">
              1-Tap Reason (Click any reason to quarantine &amp; re-queue
              immediately):
            </div>
            <div className="grid grid-cols-1 gap-2">
              {REPORT_REASONS.map((r) => {
                const active = selectedReason === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setSelectedReason(r.id);
                      handleSubmitReport(r.id);
                    }}
                    data-testid={`report-reason-${r.id}`}
                    className={`p-3 rounded-xl border text-left transition-all flex items-start justify-between gap-3 ${
                      active
                        ? 'border-amber-400 bg-amber-950/35 text-white'
                        : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 text-zinc-200'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{r.label}</span>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-snug">
                        {r.description}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-amber-500/20 border border-amber-500/40 px-2 py-1 text-[10px] font-bold text-amber-200">
                      Quarantine &amp; Re-Grab →
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-[11px] text-zinc-400 space-y-1">
            <div className="text-zinc-200 font-bold flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-[#00ff66]" />
              <span>Automated Recovery Pipeline:</span>
            </div>
            <p>
              1. Quarantines the bad file out of <code>/music</code>, marks the
              track <code>Missing</code>, and logs an alert in the Bell.
            </p>
            <p>
              2. Re-queues via <code>slskd</code> / <code>yt-dlp</code> with
              negative filters (<code>-live -remix -acoustic -cover -karaoke</code>
              ) and verifies AcoustID recording duration before indexing.
            </p>
          </div>

          {errorMsg && (
            <div className="rounded-xl border border-rose-500/50 bg-rose-950/40 p-2.5 text-xs text-rose-300">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-bold text-zinc-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleSubmitReport()}
              data-testid="btn-confirm-report-wrong-track"
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-50 px-4 py-2 text-xs font-bold text-zinc-950"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>Quarantine &amp; Re-Grab Now</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
