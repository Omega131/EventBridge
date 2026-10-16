// WHAT: EventTable component to render the list of webhook events.
// WHY: Presents the public event timeline with ID, localized timestamp, status badge, and attempt count.
// Allows signed-in users to click rows to view detailed payload information.
// Shows a short CSS highlight animation on rows that recently received a live update.
function EventTable({ events, selectedEventId, onSelectEvent, isLoggedIn, recentlyChangedId }) {

  // WHAT: Helper function to determine the CSS class for status badges.
  // WHY: Visual distinction between Received (grey), Completed (green), and Failed (red).
  function getStatusBadgeClass(status) {
    if (status === 'Completed') {
      return 'badge badge-completed';
    }
    if (status === 'Failed') {
      return 'badge badge-failed';
    }
    return 'badge badge-received'; // Default for 'Received'
  }

  // WHAT: Format an ISO timestamp string into the user's localized date and time.
  // WHY: Showing raw ISO timestamps (like 2026-10-15T12:00:00Z) is hard to read.
  function formatLocalTime(isoString) {
    if (!isoString) return '-';
    try {
      const date = new Date(isoString);
      return date.toLocaleString();
    } catch (err) {
      return isoString;
    }
  }

  // WHAT: Empty state when no events exist in the database.
  // WHY: Tells the user that the system is ready and waiting for webhooks.
  if (!events || events.length === 0) {
    return (
      <div className="empty-table-container">
        <p className="empty-message">No webhook events received yet.</p>
        <p className="empty-subtext">Send a POST request to <code>/api/webhook</code> to see events appear here.</p>
      </div>
    );
  }

  return (
    <div className="table-responsive">
      <table className="events-table">
        <thead>
          <tr>
            <th>Event ID</th>
            <th>Time</th>
            <th>Status</th>
            <th>Attempts</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const isSelected = selectedEventId === event.id;
            const isRecentlyChanged = recentlyChangedId === event.id;

            // Combine classes: clickable if logged in, selected-row if active in details, highlight-row if data just changed
            const rowClass = [
              isLoggedIn ? 'clickable-row' : '',
              isSelected ? 'selected-row' : '',
              isRecentlyChanged ? 'highlight-row' : ''
            ].filter(Boolean).join(' ');

            return (
              <tr
                key={event.id}
                className={rowClass}
                onClick={() => {
                  if (isLoggedIn && onSelectEvent) {
                    console.log('EventTable: Clicked event row:', event.id);
                    onSelectEvent(event.id);
                  }
                }}
                title={isLoggedIn ? 'Click to view payload & details' : 'Sign in as admin to view details'}
              >
                {/* Event ID (monospace font for easy scanning) */}
                <td className="event-id-cell">
                  <code>{event.id}</code>
                </td>

                {/* Formatted Local Timestamp */}
                <td className="event-time-cell">
                  {formatLocalTime(event.created_at)}
                </td>

                {/* Status Badge */}
                <td className="event-status-cell">
                  <span className={getStatusBadgeClass(event.status)}>
                    {event.status}
                  </span>
                </td>

                {/* Attempt Count */}
                <td className="event-attempts-cell">
                  {event.attempt_count}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {isLoggedIn && (
        <p className="table-hint">
          Tip: Click on any row to view its full JSON payload and failure reason below.
        </p>
      )}
    </div>
  );
}

export default EventTable;
