import { useState, useEffect } from 'react';

// WHAT: EventDetails component rendered as a slide-over drawer on the right.
// WHY: Allows signed-in administrators to inspect event payloads, failure reasons, and trigger retries.
// Closes on backdrop click or Escape key.
function EventDetails({ eventDetails, isLoading, errorMessage, onClose, isLoggedIn, onSignedOut, showToast }) {

  // ─── STATE MANAGEMENT ───────────────────────────────────────────────────

  // WHAT: Loading state while the retry HTTP request is in flight.
  const [retrying, setRetrying] = useState(false);

  // WHAT: Reset retrying state whenever a different event is selected.
  useEffect(() => {
    setRetrying(false);
  }, [eventDetails?.id]);

  // WHAT: Close drawer on Escape key.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);


  // ─── RETRY HANDLER ───────────────────────────────────────────────────────

  async function handleRetry() {
    if (!eventDetails || !eventDetails.id) {
      return;
    }

    console.log('EventDetails: Triggering retry for event ID:', eventDetails.id);
    setRetrying(true);

    try {
      const response = await fetch('/api/events/' + eventDetails.id + '/retry', {
        method: 'POST',
        credentials: 'include'
      });

      console.log('EventDetails: Server returned status:', response.status);

      if (response.status === 202) {
        console.log('EventDetails: Retry claimed successfully (202 Accepted).');
        if (showToast) {
          showToast('Retry started', 'success');
        }

      } else if (response.status === 409) {
        console.warn('EventDetails: Retry rejected (409 Conflict) - already in progress or completed.');
        if (showToast) {
          showToast('This event is already being retried or has completed.', 'warning');
        }

      } else if (response.status === 401) {
        console.warn('EventDetails: Unauthorized (401). Triggering signed-out state.');
        if (showToast) {
          showToast('Session expired. Please sign in again.', 'error');
        }
        if (onSignedOut) {
          onSignedOut();
        }

      } else {
        console.error('EventDetails: Unexpected error status during retry:', response.status);
        if (showToast) {
          showToast('Could not retry. Try again.', 'error');
        }
      }

    } catch (err) {
      console.error('EventDetails: Network error while requesting retry:', err.message);
      if (showToast) {
        showToast('Could not retry. Try again.', 'error');
      }

    } finally {
      console.log('EventDetails: Retry request finished. Resetting retrying state.');
      setRetrying(false);
    }
  }

  // WHAT: Copy pretty-printed JSON payload to clipboard.
  async function handleCopyPayload() {
    if (!eventDetails || !eventDetails.payload) return;
    try {
      const jsonText = JSON.stringify(eventDetails.payload, null, 2);
      await navigator.clipboard.writeText(jsonText);
      if (showToast) {
        showToast('Copied payload to clipboard', 'info');
      }
    } catch (err) {
      console.error('Failed to copy payload:', err);
      if (showToast) {
        showToast('Could not copy to clipboard', 'error');
      }
    }
  }

  // WHAT: Copy event ID to clipboard.
  async function handleCopyId() {
    if (!eventDetails || !eventDetails.id) return;
    try {
      await navigator.clipboard.writeText(eventDetails.id);
      if (showToast) {
        showToast('Copied event ID to clipboard', 'info');
      }
    } catch (err) {
      console.error('Failed to copy ID:', err);
    }
  }


  // ─── STATUS BADGE HELPER WITH ICONS (NO COLOR ALONE, NO EMOJIS) ─────────
  function renderStatusBadge(status) {
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


  // ─── RENDER DRAWER SHELL ────────────────────────────────────────────────
  return (
    <div
      className="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Event details slide-over"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <aside className="drawer-panel">

        {/* Drawer Header */}
        <div className="drawer-header">
          <div className="drawer-header-info">
            <h3 className="drawer-title">Event Details</h3>
            <button
              type="button"
              className="drawer-id-button font-mono"
              onClick={handleCopyId}
              title="Click to copy full Event ID"
              aria-label={`Event ID: ${eventDetails?.id || 'loading'}. Click to copy.`}
            >
              <span>{eventDetails?.id || '...'}</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>

          <div className="drawer-header-actions">
            <button
              type="button"
              onClick={onClose}
              className="btn-icon"
              title="Close panel (Escape)"
              aria-label="Close event details"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Drawer Content */}
        <div className="drawer-body">
          {isLoading ? (
            <div className="drawer-loading">
              <div className="spinner" aria-hidden="true" />
              <p>Loading event payload...</p>
            </div>
          ) : errorMessage ? (
            <div className="banner banner-error" role="alert">
              <p>{errorMessage}</p>
              <button type="button" onClick={onClose} className="btn btn-secondary">Close</button>
            </div>
          ) : eventDetails ? (
            <>
              {/* Metadata Overview Grid */}
              <div className="drawer-grid">
                <div className="drawer-field">
                  <span className="field-label">Status</span>
                  <div className="status-cell-wrapper">
                    {renderStatusBadge(eventDetails.status)}
                    {eventDetails.status === 'Received' && (eventDetails.attempt_count || 0) >= 1 && (
                      <span className="retrying-pill">Retrying...</span>
                    )}
                  </div>
                </div>

                <div className="drawer-field">
                  <span className="field-label">Delivery Attempts</span>
                  <span className="field-value tabular-nums font-mono">{eventDetails.attempt_count}</span>
                </div>

                <div className="drawer-field drawer-field-full">
                  <span className="field-label">Idempotency Key</span>
                  <code className="field-value-code font-mono">{eventDetails.idempotency_key}</code>
                </div>

                <div className="drawer-field drawer-field-full">
                  <span className="field-label">Created Timestamp</span>
                  <span className="field-value tabular-nums">
                    {eventDetails.created_at ? new Date(eventDetails.created_at).toLocaleString() : '-'}
                  </span>
                </div>
              </div>

              {/* Failure Alert Box (if present) */}
              {eventDetails.failure_reason && (
                <div className="failure-alert" role="alert">
                  <div className="failure-alert-header">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <strong>Downstream Failure Reason</strong>
                  </div>
                  <p className="failure-alert-text">{eventDetails.failure_reason}</p>
                </div>
              )}

              {/* Pretty-Printed JSON Payload */}
              <div className="payload-section">
                <div className="payload-header">
                  <span className="payload-title">Webhook Payload (JSON)</span>
                  <button
                    type="button"
                    onClick={handleCopyPayload}
                    className="btn btn-secondary btn-sm"
                    title="Copy payload to clipboard"
                    aria-label="Copy JSON payload"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span>Copy JSON</span>
                  </button>
                </div>

                <pre className="payload-code font-mono">
                  {JSON.stringify(eventDetails.payload, null, 2)}
                </pre>
              </div>
            </>
          ) : null}
        </div>

        {/* Drawer Footer Actions */}
        {eventDetails && (
          <div className="drawer-footer">
            {/* Retry button shown ONLY when user is signed in AND status is "Failed" */}
            {isLoggedIn && eventDetails.status === 'Failed' && (
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying}
                className="btn btn-primary btn-retry"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                <span>{retrying ? 'Retrying...' : 'Retry Event'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
            >
              Close
            </button>
          </div>
        )}

      </aside>
    </div>
  );
}

export default EventDetails;
