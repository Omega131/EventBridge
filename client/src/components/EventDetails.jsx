import { useState, useEffect } from 'react';

// WHAT: EventDetails component to display full payload, diagnostic info, and retry controls for a selected event.
// WHY: Only signed-in administrators can access this data to debug webhook failures, inspect payloads, or trigger retries.
function EventDetails({ eventDetails, isLoading, errorMessage, onClose, isLoggedIn, onSignedOut, showToast }) {

  // ─── STATE MANAGEMENT ───────────────────────────────────────────────────

  // WHAT: Loading state while the retry HTTP request is in flight.
  // WHY: Disables the button and changes its label to "Retrying..." to prevent multiple clicks.
  const [retrying, setRetrying] = useState(false);

  // WHAT: Reset retrying state whenever a different event is selected.
  useEffect(() => {
    setRetrying(false);
  }, [eventDetails?.id]);


  // ─── RETRY HANDLER ───────────────────────────────────────────────────────

  // WHAT: Send POST /api/events/:id/retry to the backend server.
  // WHY: Allows administrators to re-deliver an event whose downstream call previously failed.
  async function handleRetry() {
    if (!eventDetails || !eventDetails.id) {
      return;
    }

    console.log('EventDetails: Triggering retry for event ID:', eventDetails.id);
    setRetrying(true);

    try {
      // Send POST request with credentials: 'include' to pass the session cookie
      const response = await fetch('/api/events/' + eventDetails.id + '/retry', {
        method: 'POST',
        credentials: 'include'
      });

      console.log('EventDetails: Server returned status:', response.status);

      if (response.status === 202) {
        // WHAT: 202 Accepted.
        // WHY: The claim succeeded and the background pipeline has been scheduled.
        // NOTE: We do NOT update the status in local state by hand! The live SSE update
        // will broadcast the change to all open browser windows, keeping everyone in sync.
        console.log('EventDetails: Retry claimed successfully (202 Accepted).');
        if (showToast) {
          showToast('Retry started', 'success');
        }

      } else if (response.status === 409) {
        // WHAT: 409 Conflict.
        // WHY: The event is either already retrying (status Received) or has already completed.
        console.warn('EventDetails: Retry rejected (409 Conflict) - already in progress or completed.');
        if (showToast) {
          showToast('This event is already being retried or has completed.', 'warning');
        }

      } else if (response.status === 401) {
        // WHAT: 401 Unauthorized.
        // WHY: The user's session cookie expired or is missing. Treat as signed out.
        console.warn('EventDetails: Unauthorized (401). Triggering signed-out state.');
        if (showToast) {
          showToast('Session expired. Please sign in again.', 'error');
        }
        if (onSignedOut) {
          onSignedOut();
        }

      } else {
        // WHAT: Any other HTTP error code (e.g. 500 Internal Server Error, 400 Bad Request).
        // WHY: Informs user that the retry could not be processed.
        console.error('EventDetails: Unexpected error status during retry:', response.status);
        if (showToast) {
          showToast('Could not retry. Try again.', 'error');
        }
      }

    } catch (err) {
      // WHAT: Handle network failures or dropped connections.
      // WHY: Guarantees the frontend doesn't crash and gives actionable feedback to the user.
      console.error('EventDetails: Network error while requesting retry:', err.message);
      if (showToast) {
        showToast('Could not retry. Try again.', 'error');
      }

    } finally {
      // WHAT: Reset retrying back to false.
      // WHY: Always re-enables the button regardless of whether the request succeeded or failed.
      console.log('EventDetails: Retry request finished. Resetting retrying state.');
      setRetrying(false);
    }
  }


  // ─── CONDITIONAL RENDERING (LOADING / ERROR / EMPTY) ────────────────────

  // WHAT: Loading state while fetching the detailed row from GET /api/events/:id.
  // WHY: Lets the user know a network request is currently in flight.
  if (isLoading) {
    return (
      <div className="details-panel loading-panel">
        <p>Loading event details...</p>
      </div>
    );
  }

  // WHAT: Error state if fetching details failed (e.g. 404 or network issue).
  // WHY: Displays clear feedback to the admin.
  if (errorMessage) {
    return (
      <div className="details-panel error-panel">
        <div className="details-header">
          <h3>Error Loading Event</h3>
          <button onClick={onClose} className="btn-close" title="Close panel">×</button>
        </div>
        <p className="error-message">{errorMessage}</p>
      </div>
    );
  }

  // WHAT: Return nothing if no event is currently selected.
  // WHY: Keeps the UI clean when nothing is selected.
  if (!eventDetails) {
    return null;
  }


  // ─── MAIN RENDER ────────────────────────────────────────────────────────

  return (
    <div className="details-panel">

      {/* Panel Header */}
      <div className="details-header">
        <div>
          <h3>Event Details</h3>
          <code className="details-id">{eventDetails.id}</code>
        </div>

        <div className="details-header-actions">
          {/* WHAT: Retry button shown ONLY when user is signed in AND status is "Failed". */}
          {/* WHY: Signed-out users must never see it, and events that already succeeded or are currently running cannot be retried. */}
          {isLoggedIn && eventDetails.status === 'Failed' && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="btn btn-retry"
              title="Retry downstream delivery for this failed event"
            >
              {retrying ? 'Retrying...' : 'Retry'}
            </button>
          )}

          {/* Close Panel Button */}
          <button
            onClick={onClose}
            className="btn-close"
            title="Close details panel"
            aria-label="Close details"
          >
            ×
          </button>
        </div>
      </div>


      {/* Metadata Overview Grid */}
      <div className="details-grid">

        {/* Current Status Badge (updates live via SSE refresh) */}
        <div className="detail-item">
          <span className="detail-label">Status</span>
          <div className="status-cell-wrapper">
            <span className={`badge badge-${(eventDetails.status || '').toLowerCase()}`}>
              {eventDetails.status}
            </span>
            {eventDetails.status === 'Received' && eventDetails.attempt_count >= 1 && (
              <span className="retrying-label">Retrying...</span>
            )}
          </div>
        </div>

        {/* Attempt Count (updates live via SSE refresh) */}
        <div className="detail-item">
          <span className="detail-label">Attempts</span>
          <span className="detail-value">{eventDetails.attempt_count}</span>
        </div>

        {/* Idempotency Key */}
        <div className="detail-item">
          <span className="detail-label">Idempotency Key</span>
          <code className="detail-value-code">{eventDetails.idempotency_key}</code>
        </div>

        {/* Creation Timestamp */}
        <div className="detail-item">
          <span className="detail-label">Created At</span>
          <span className="detail-value">
            {eventDetails.created_at ? new Date(eventDetails.created_at).toLocaleString() : '-'}
          </span>
        </div>
      </div>

      {/* WHAT: Display failure reason alert if the event failed. */}
      {/* WHY: Critical diagnostic information explaining why the downstream call failed. */}
      {/* This automatically clears when a retry completes successfully because the backend sets failure_reason to null. */}
      {eventDetails.failure_reason && (
        <div className="failure-alert">
          <strong>Failure Reason:</strong> {eventDetails.failure_reason}
        </div>
      )}

      {/* WHAT: Display the raw webhook payload as pretty-printed JSON. */}
      {/* WHY: Administrators must be able to inspect the exact data received in the webhook. */}
      <div className="payload-container">
        <div className="payload-header">
          <h4>Original Payload (JSON)</h4>
        </div>
        <pre className="payload-code">
          {JSON.stringify(eventDetails.payload, null, 2)}
        </pre>
      </div>

    </div>
  );
}

export default EventDetails;
