// WHAT: EventDetails component to display full payload and diagnostic info for a selected event.
// WHY: Only signed-in administrators can access this data to debug webhook failures or inspect payloads.
function EventDetails({ eventDetails, isLoading, errorMessage, onClose }) {

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

  return (
    <div className="details-panel">
      {/* Panel Header */}
      <div className="details-header">
        <div>
          <h3>Event Details</h3>
          <code className="details-id">{eventDetails.id}</code>
        </div>
        <button
          onClick={onClose}
          className="btn-close"
          title="Close details panel"
          aria-label="Close details"
        >
          ×
        </button>
      </div>

      {/* Metadata Overview Grid */}
      <div className="details-grid">
        <div className="detail-item">
          <span className="detail-label">Status</span>
          <span className={`badge badge-${(eventDetails.status || '').toLowerCase()}`}>
            {eventDetails.status}
          </span>
        </div>

        <div className="detail-item">
          <span className="detail-label">Attempts</span>
          <span className="detail-value">{eventDetails.attempt_count}</span>
        </div>

        <div className="detail-item">
          <span className="detail-label">Idempotency Key</span>
          <code className="detail-value-code">{eventDetails.idempotency_key}</code>
        </div>

        <div className="detail-item">
          <span className="detail-label">Created At</span>
          <span className="detail-value">
            {eventDetails.created_at ? new Date(eventDetails.created_at).toLocaleString() : '-'}
          </span>
        </div>
      </div>

      {/* WHAT: Display failure reason alert if the event failed. */}
      {/* WHY: Critical diagnostic information explaining why the downstream call failed. */}
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
