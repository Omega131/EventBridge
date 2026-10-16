import { useState, useEffect } from 'react';

// WHAT: Format ISO timestamp to readable relative time ("just now", "2m ago", "1h ago").
// WHY: Relative timestamps make it easy to spot recent webhook activity at a glance.
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

// WHAT: EventTable component rendering the webhook event timeline.
// WHY: Presents events with truncated monospace ID, relative time, status badge (icon + dot + text),
// and attempt count. Clickable rows open the slide-over drawer for signed-in admins.
function EventTable({
  events,
  selectedEventId,
  onSelectEvent,
  isLoggedIn,
  recentlyChangedId,
  isLoading,
  showToast
}) {
  // WHAT: 30-second re-render timer to keep relative timestamps ("2m ago") fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // WHAT: Copy full event ID to clipboard when clicked.
  async function handleCopyId(e, id) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      if (showToast) {
        showToast('Copied event ID to clipboard', 'info');
      }
    } catch (err) {
      console.error('Failed to copy ID:', err);
    }
  }

  // WHAT: Render status badge with icon, dot, and text (never color alone, no emojis).
  function renderBadge(status) {
    if (status === 'Completed') {
      return (
        <span className="badge badge-completed">
          <span className="badge-dot" aria-hidden="true" />
          <svg className="badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Completed</span>
        </span>
      );
    }
    if (status === 'Failed') {
      return (
        <span className="badge badge-failed">
          <span className="badge-dot" aria-hidden="true" />
          <svg className="badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>Failed</span>
        </span>
      );
    }
    return (
      <span className="badge badge-received">
        <span className="badge-dot" aria-hidden="true" />
        <svg className="badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span>Received</span>
      </span>
    );
  }

  // ─── 1. SKELETON LOADING STATE ────────────────────────────────────────────
  if (isLoading && (!events || events.length === 0)) {
    return (
      <div className="table-card">
        <div className="skeleton-table">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-cell skeleton-id" />
              <div className="skeleton-cell skeleton-time" />
              <div className="skeleton-cell skeleton-badge" />
              <div className="skeleton-cell skeleton-attempts" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── 2. EMPTY STATE WITH SVG ILLUSTRATION ────────────────────────────────
  if (!events || events.length === 0) {
    return (
      <div className="empty-state-card">
        {/* Simple geometric SVG illustration of an inbox / webhook antenna */}
        <div className="empty-state-icon" aria-hidden="true">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="12" y="18" width="40" height="34" rx="8" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
            <path d="M22 34L32 42L42 34" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="32" y1="12" x2="32" y2="28" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="32" cy="10" r="3" fill="currentColor" />
          </svg>
        </div>
        <h3 className="empty-state-title">No events yet. Send your first webhook.</h3>
        <p className="empty-state-subtitle">
          Use the curl command in the card above to send your first event to <code>/api/webhook</code>.
        </p>
      </div>
    );
  }

  // ─── 3. MAIN TABLE ────────────────────────────────────────────────────────
  return (
    <div className="table-card">
      <div className="table-responsive">
        <table className="events-table">
          <thead>
            <tr>
              <th scope="col" className="th-id">Event ID</th>
              <th scope="col" className="th-time">Time</th>
              <th scope="col" className="th-status">Status</th>
              <th scope="col" className="th-attempts">Attempts</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const isSelected = selectedEventId === event.id;
              const isRecentlyChanged = recentlyChangedId === event.id;

              const rowClasses = [
                'event-row',
                isLoggedIn ? 'clickable-row' : '',
                isSelected ? 'selected-row' : '',
                isRecentlyChanged ? 'highlight-row' : ''
              ].filter(Boolean).join(' ');

              // Truncate ID: e.g. "a9ababaa...0052"
              const truncatedId =
                event.id.length > 14
                  ? `${event.id.slice(0, 8)}...${event.id.slice(-4)}`
                  : event.id;

              const fullTimestamp = event.created_at
                ? new Date(event.created_at).toLocaleString()
                : '-';

              return (
                <tr
                  key={event.id}
                  className={rowClasses}
                  onClick={() => {
                    if (isLoggedIn && onSelectEvent) {
                      onSelectEvent(event.id);
                    }
                  }}
                  tabIndex={isLoggedIn ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (isLoggedIn && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onSelectEvent(event.id);
                    }
                  }}
                  aria-selected={isSelected}
                  title={isLoggedIn ? 'Click to view payload in drawer' : 'Sign in to inspect payload'}
                >
                  {/* Event ID with copy action */}
                  <td className="td-id">
                    <button
                      type="button"
                      className="id-copy-button font-mono"
                      onClick={(e) => handleCopyId(e, event.id)}
                      title="Click to copy full ID"
                      aria-label={`Copy full event ID ${event.id}`}
                    >
                      <span className="id-text">{truncatedId}</span>
                      <svg className="id-copy-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                  </td>

                  {/* Relative Time with Full Timestamp in Tooltip */}
                  <td className="td-time">
                    <span
                      className="relative-time tabular-nums"
                      title={fullTimestamp}
                    >
                      {getRelativeTime(event.created_at)}
                    </span>
                  </td>

                  {/* Status Badge & Retrying Label */}
                  <td className="td-status">
                    <div className="status-cell-wrapper">
                      {renderBadge(event.status)}
                      {event.status === 'Received' && (event.attempt_count || 0) >= 1 && (
                        <span className="retrying-pill">Retrying...</span>
                      )}
                    </div>
                  </td>

                  {/* Attempts */}
                  <td className="td-attempts">
                    <span className="attempts-count tabular-nums font-mono">
                      {event.attempt_count ?? 0}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isLoggedIn && (
        <div className="table-footer-hint">
          <span>Click any row to open the payload inspector drawer</span>
        </div>
      )}
    </div>
  );
}

export default EventTable;
