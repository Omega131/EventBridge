import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Copy,
  Check,
  ChevronRight,
  Inbox,
  ArrowUpRight
} from 'lucide-react';
import { sound } from '../utils/sound';

function getRelativeTime(isoString) {
  if (!isoString) return '-';
  const timestamp = Date.parse(isoString);
  if (isNaN(timestamp)) return isoString;

  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function EventTable({
  events,
  selectedEventId,
  onSelectEvent,
  isLoggedIn,
  recentlyChangedId,
  isLoading,
  showToast,
  soundEnabled,
  onOpenDispatcher
}) {
  const [, setTick] = useState(0);
  const [copiedId, setCopiedId] = useState(null);

  // Keep relative times fresh
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  async function handleCopyId(e, id) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      sound.playTap(soundEnabled);
      showToast?.('Copied event UUID to clipboard', 'info');
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    } catch (err) {
      console.error('Failed to copy ID:', err);
    }
  }

  function renderStatusBadge(status, attemptCount) {
    if (status === 'Completed') {
      return (
        <span className="badge badge-completed">
          <span className="badge-dot badge-dot-emerald" aria-hidden="true" />
          <CheckCircle2 size={13} className="badge-icon" />
          <span>Completed</span>
        </span>
      );
    }
    if (status === 'Failed') {
      return (
        <span className="badge badge-failed">
          <span className="badge-dot badge-dot-rose" aria-hidden="true" />
          <XCircle size={13} className="badge-icon" />
          <span>Failed</span>
        </span>
      );
    }
    return (
      <span className="badge badge-received">
        <span className="badge-dot badge-dot-amber" aria-hidden="true" />
        <Clock size={13} className="badge-icon badge-spin-slow" />
        <span>Received</span>
        {(attemptCount || 0) >= 1 && (
          <span className="badge-sub-pill font-mono">retry #{attemptCount}</span>
        )}
      </span>
    );
  }

  // Skeleton Loading State
  if (isLoading && (!events || events.length === 0)) {
    return (
      <div className="table-card">
        <div className="table-skeleton-wrap">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-cell skeleton-id" />
              <div className="skeleton-cell skeleton-time" />
              <div className="skeleton-cell skeleton-badge" />
              <div className="skeleton-cell skeleton-attempts" />
              <div className="skeleton-cell skeleton-action" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Empty State with Action
  if (!events || events.length === 0) {
    return (
      <div className="empty-state-card animate-fade-in">
        <div className="empty-radar-glow" aria-hidden="true">
          <div className="radar-circle circle-1" />
          <div className="radar-circle circle-2" />
          <div className="radar-circle circle-3" />
          <div className="empty-state-icon">
            <Inbox size={36} className="text-indigo-400" />
          </div>
        </div>

        <h3 className="empty-state-title">No webhook events in view</h3>
        <p className="empty-state-subtitle">
          Waiting for incoming HTTP POST requests at <code>/api/webhook</code>. Send a test webhook
          to observe live ingestion, automatic retries, and real-time SSE streaming.
        </p>

        {onOpenDispatcher && (
          <button
            type="button"
            className="btn btn-primary btn-empty-cta"
            onClick={onOpenDispatcher}
          >
            <span>Open Webhook Studio</span>
            <ArrowUpRight size={15} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="table-card">
      <div className="table-responsive">
        <table className="events-table">
          <thead>
            <tr>
              <th scope="col" className="th-id">Event Identifier</th>
              <th scope="col" className="th-time">Timestamp</th>
              <th scope="col" className="th-status">Delivery Status</th>
              <th scope="col" className="th-attempts">Attempts</th>
              <th scope="col" className="th-action text-right">Payload</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const isSelected = selectedEventId === event.id;
              const isRecentlyChanged = recentlyChangedId === event.id;
              const isCopied = copiedId === event.id;

              const truncatedId =
                event.id.length > 16
                  ? `${event.id.slice(0, 8)}••••${event.id.slice(-4)}`
                  : event.id;

              const fullTimestamp = event.created_at
                ? new Date(event.created_at).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'medium'
                  })
                : '-';

              const exactUtc = event.created_at
                ? new Date(event.created_at).toISOString()
                : '-';

              return (
                <tr
                  key={event.id}
                  className={[
                    'event-row',
                    isLoggedIn ? 'clickable-row' : '',
                    isSelected ? 'selected-row' : '',
                    isRecentlyChanged ? 'highlight-row' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    if (onSelectEvent) {
                      onSelectEvent(event.id);
                    }
                  }}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectEvent?.(event.id);
                    }
                  }}
                  aria-selected={isSelected}
                  title={
                    isLoggedIn
                      ? 'Click row to inspect payload and delivery logs'
                      : 'Sign in to inspect full JSON payload'
                  }
                >
                  {/* Event ID column */}
                  <td className="td-id">
                    <button
                      type="button"
                      className={`id-copy-button font-mono ${isCopied ? 'copied' : ''}`}
                      onClick={(e) => handleCopyId(e, event.id)}
                      title={`Copy full UUID (${event.id})`}
                      aria-label={`Copy full event ID ${event.id}`}
                    >
                      <span className="id-text">{truncatedId}</span>
                      <span className="id-copy-icon-wrap" aria-hidden="true">
                        {isCopied ? (
                          <Check size={13} className="text-emerald-400" />
                        ) : (
                          <Copy size={13} className="text-secondary" />
                        )}
                      </span>
                    </button>
                  </td>

                  {/* Relative & Exact Timestamp */}
                  <td className="td-time">
                    <div
                      className="time-cell-wrap"
                      title={`Local: ${fullTimestamp}\nUTC: ${exactUtc}`}
                    >
                      <span className="relative-time tabular-nums">
                        {getRelativeTime(event.created_at)}
                      </span>
                      <span className="exact-time-preview tabular-nums">
                        {event.created_at ? new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                      </span>
                    </div>
                  </td>

                  {/* Status Badge */}
                  <td className="td-status">
                    <div className="status-cell-wrapper">
                      {renderStatusBadge(event.status, event.attempt_count)}
                    </div>
                  </td>

                  {/* Attempts Column */}
                  <td className="td-attempts">
                    <div className="attempts-pill-wrap">
                      <span className="attempts-count tabular-nums font-mono">
                        {event.attempt_count ?? 0}
                      </span>
                      <span className="attempts-sublabel">tries</span>
                    </div>
                  </td>

                  {/* Action / Inspect */}
                  <td className="td-action text-right">
                    <div className="row-action-wrap">
                      <span className="btn-inspect-pill">
                        <span>{isLoggedIn ? 'Inspect' : 'Details'}</span>
                        <ChevronRight size={13} className="inspect-chevron" />
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="table-footer-hud">
        <span className="table-count-text">
          Showing <strong className="font-mono text-primary">{events.length}</strong> event{events.length === 1 ? '' : 's'}
        </span>
        <span className="table-keyboard-hint">
          {isLoggedIn ? (
            <>Click any row to open slide-over payload inspector</>
          ) : (
            <>Sign in as Admin to view payloads and trigger manual retries</>
          )}
        </span>
      </div>
    </div>
  );
}
