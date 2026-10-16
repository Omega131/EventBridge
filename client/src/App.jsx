import { useState, useEffect, useRef } from 'react';
import LoginForm from './components/LoginForm';
import EventTable from './components/EventTable';
import EventDetails from './components/EventDetails';
import AdminPanel from './components/AdminPanel';
import './App.css';

// ─── STALE-UPDATE GUARD HELPER ───────────────────────────────────────────────
// WHAT: Merges a single incoming event row into an existing event list using a stale-update guard.
// WHY: In a live distributed application, HTTP responses and Server-Sent Events can arrive out of order.
// If a slower full re-fetch (GET /api/events) or delayed network packet resolves AFTER a newer live update
// has already changed an event's status to "Completed" or "Failed", a naive overwrite would move the event
// backwards to an old status. By comparing Date.parse(incoming.updated_at) against the stored updated_at,
// we ensure older updates are ignored and state changes remain strictly monotonic.
function mergeEvent(list, incoming) {
  if (!incoming || !incoming.id) {
    return list;
  }

  // Parse incoming updated_at timestamp as milliseconds since epoch (fallback to 0 if missing)
  const incomingUpdatedAtMs = incoming.updated_at ? Date.parse(incoming.updated_at) : 0;
  let found = false;
  const nextList = [];

  // Plain loop through the existing list
  for (let i = 0; i < list.length; i++) {
    const existing = list[i];
    if (existing.id === incoming.id) {
      found = true;
      const existingUpdatedAtMs = existing.updated_at ? Date.parse(existing.updated_at) : 0;

      // WHAT: Replace existing row ONLY if incoming.updated_at is newer than or equal to stored
      // WHY: Stops an older response or delayed SSE packet from overwriting a newer live update.
      if (incomingUpdatedAtMs >= existingUpdatedAtMs) {
        nextList.push(incoming);
      } else {
        console.log(
          'mergeEvent: Ignored older update for event ' +
            incoming.id +
            '. Incoming updated_at (' +
            incoming.updated_at +
            ') < stored (' +
            existing.updated_at +
            ')'
        );
        nextList.push(existing);
      }
    } else {
      nextList.push(existing);
    }
  }

  // WHAT: If the id was not in the list, append it as a newly discovered event
  if (!found) {
    nextList.push(incoming);
  }

  // WHAT: Return the list sorted by created_at descending (newest first), then id descending as tie-breaker
  // WHY: Matches the canonical server sort order so the UI stays consistent.
  nextList.sort((a, b) => {
    const timeA = a.created_at ? Date.parse(a.created_at) : 0;
    const timeB = b.created_at ? Date.parse(b.created_at) : 0;
    if (timeB !== timeA) {
      return timeB - timeA; // Descending by creation time
    }
    return (b.id || '').localeCompare(a.id || ''); // Descending by ID as tie-breaker
  });

  return nextList;
}

// ─── MAIN APPLICATION COMPONENT ──────────────────────────────────────────────
// WHAT: Main Application Component for EventBridge.
// WHY: Coordinates the entire frontend: holds top-level state, manages Server-Sent Events (SSE)
// live stream connection, handles API calls, and passes props down to child components.
function App() {

  // ─── STATE MANAGEMENT ───────────────────────────────────────────────────

  // WHAT: Whether the current visitor is authenticated as an admin.
  // WHY: Controls whether to display the login form or the sign-out button,
  // and whether table rows can be clicked to inspect payloads.
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // WHAT: Array of event summary rows.
  // WHY: Displays the main event timeline in the EventTable.
  const [events, setEvents] = useState([]);

  // WHAT: Loading indicator for the initial events list.
  // WHY: Informs the user when events are first loading from the backend.
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);

  // WHAT: Error message for event list fetching.
  // WHY: Informs the user if the backend is down or unreachable.
  const [eventsError, setEventsError] = useState(null);

  // WHAT: ID of the currently selected event row.
  // WHY: Tracks which row is highlighted in the table.
  const [selectedEventId, setSelectedEventId] = useState(null);

  // WHAT: Complete event row details for the selected event (from GET /api/events/:id).
  // WHY: Contains the full webhook payload and failure reason for the EventDetails panel.
  const [selectedEventDetails, setSelectedEventDetails] = useState(null);

  // WHAT: Loading indicator for the event details panel.
  // WHY: Displays a spinner/status while fetching single-event details.
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // WHAT: Error message for event details fetching.
  // WHY: Displays an error if fetching event details fails.
  const [detailsError, setDetailsError] = useState(null);

  // WHAT: Loading indicator for the login form submission.
  // WHY: Disables the button while POST /api/login is in flight.
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // WHAT: Error message from a failed login attempt (e.g. "Wrong password").
  // WHY: Gives direct feedback on invalid credentials.
  const [loginError, setLoginError] = useState(null);

  // WHAT: Connection state of the Server-Sent Events (SSE) stream.
  // WHY: Values are 'connecting', 'live', or 'reconnecting'. Controls the header badge.
  const [liveStatus, setLiveStatus] = useState('connecting');

  // WHAT: ID of the event row that just received a live update.
  // WHY: Triggers a short 1.5-second CSS highlight animation on that table row.
  const [recentlyChangedId, setRecentlyChangedId] = useState(null);

  // WHAT: Health status of the mock downstream service (true = Healthy, false = Down).
  // WHY: Controls mock status badge for visitors and toggle switch state for admins.
  const [mockHealthy, setMockHealthy] = useState(true);

  // WHAT: Array of active toast notifications: [{ id, text, kind }]
  // WHY: Displays non-intrusive alerts for admin actions, errors, and system events.
  const [toasts, setToasts] = useState([]);


  // ─── TOAST NOTIFICATION SYSTEM ───────────────────────────────────────────

  // WHAT: Show a toast notification that automatically dismisses after 4 seconds.
  // WHY: Simple beginner-friendly notification system without external libraries.
  function showToast(text, kind = 'info') {
    const id = Date.now() + '-' + Math.random().toString(36).substring(2, 9);
    console.log('App: Showing toast (' + kind + '):', text);

    setToasts((previousToasts) => [...previousToasts, { id, text, kind }]);

    setTimeout(() => {
      console.log('App: Auto-removing toast after 4s:', id);
      setToasts((previousToasts) => previousToasts.filter((t) => t.id !== id));
    }, 4000);
  }


  // ─── REFS FOR LIVE STREAM ───────────────────────────────────────────────

  // WHAT: Refs to store the latest values of selectedEventId and isLoggedIn.
  // WHY: The SSE event listener runs inside a useEffect with empty dependencies ([]).
  // Using refs ensures the listener always reads the current user selection and login state
  // without needing to disconnect and reconnect the EventSource whenever selection or login changes.
  const selectedEventIdRef = useRef(selectedEventId);
  useEffect(() => {
    selectedEventIdRef.current = selectedEventId;
  }, [selectedEventId]);

  const isLoggedInRef = useRef(isLoggedIn);
  useEffect(() => {
    isLoggedInRef.current = isLoggedIn;
  }, [isLoggedIn]);

  // WHAT: Timer ref for clearing the 1.5s row highlight.
  // WHY: Prevents conflicting timers if multiple updates arrive rapidly.
  const highlightTimerRef = useRef(null);


  // ─── AUTHENTICATION HELPERS ──────────────────────────────────────────────

  // WHAT: Centralized sign-out handler used by logout button, 401 handlers, and "Sign out everywhere".
  // WHY: Resets authentication status and cleans up any sensitive selected event details.
  function handleSignedOut() {
    console.log('App: Clearing admin session state.');
    setIsLoggedIn(false);
    setSelectedEventId(null);
    setSelectedEventDetails(null);
    setDetailsError(null);
  }


  // ─── API CALLS ──────────────────────────────────────────────────────────

  // WHAT: Check if the user already has a valid session cookie.
  // WHY: Runs on initial page load so a refreshed page keeps the user signed in.
  async function checkAuthStatus() {
    console.log('App: Checking session status via GET /api/me...');
    try {
      const response = await fetch('/api/me', {
        credentials: 'include'
      });
      const data = await response.json();
      console.log('App: Session status received:', data);
      setIsLoggedIn(data.loggedIn === true);
    } catch (err) {
      console.error('App: Failed to check auth status:', err.message);
      setIsLoggedIn(false);
    }
  }

  // WHAT: Fetch current mock downstream status from GET /api/mock/status.
  // WHY: Runs once on startup so that both visitors and admins see the correct health status right away.
  async function fetchMockStatus() {
    console.log('App: Fetching mock status via GET /api/mock/status...');
    try {
      const response = await fetch('/api/mock/status');
      if (response.ok) {
        const data = await response.json();
        console.log('App: Initial mock downstream status received:', data);
        setMockHealthy(data.healthy === true);
      } else {
        console.warn('App: Mock status request returned status:', response.status);
      }
    } catch (err) {
      console.error('App: Failed to fetch mock status:', err.message);
    }
  }

  // WHAT: Fetch the latest 100 events from the backend.
  // WHY: Populates the EventTable with the latest public event list.
  async function fetchEvents() {
    console.log('App: Fetching events via GET /api/events...');
    setEventsError(null);

    try {
      const response = await fetch('/api/events', {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Server returned error status ' + response.status);
      }

      const data = await response.json();
      console.log('App: Received ' + data.length + ' events from server. Merging row by row...');

      // WHAT: Merge the fetched list row by row with mergeEvent instead of replacing the whole state.
      // WHY: It stops an old response (e.g. from an in-flight GET /api/events request that started
      // before an event changed state) from overwriting a newer live update that arrived via SSE.
      setEvents((previousEvents) => {
        let mergedList = previousEvents;
        for (let i = 0; i < data.length; i++) {
          mergedList = mergeEvent(mergedList, data[i]);
        }
        return mergedList;
      });
    } catch (err) {
      console.error('App: Error fetching events:', err.message);
      setEventsError('Unable to load events. Make sure the backend server is running on port 3000.');
    } finally {
      setIsLoadingEvents(false);
    }
  }

  // WHAT: Handle admin login submission.
  // WHY: Calls POST /api/login with the password and sets session state.
  async function handleLogin(password) {
    console.log('App: Attempting login...');
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ password })
      });

      const data = await response.json();

      if (response.ok && data.loggedIn) {
        console.log('App: Login successful.');
        setIsLoggedIn(true);
        setLoginError(null);
        showToast('Signed in successfully', 'success');
      } else {
        console.log('App: Login rejected:', data.error || 'Wrong password');
        setLoginError(data.error === 'Wrong password' ? 'Wrong password' : (data.error || 'Login failed'));
      }
    } catch (err) {
      console.error('App: Login network error:', err.message);
      setLoginError('Could not reach the server. Please try again.');
    } finally {
      setIsLoggingIn(false);
    }
  }

  // WHAT: Handle admin sign out.
  // WHY: Calls POST /api/logout to clear the session cookie and updates local state.
  async function handleLogout() {
    console.log('App: Logging out...');
    try {
      await fetch('/api/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (err) {
      console.error('App: Logout request failed:', err.message);
    } finally {
      handleSignedOut();
      showToast('Signed out successfully', 'info');
      console.log('App: User logged out.');
    }
  }

  // WHAT: Fetch complete details for a single event ID.
  // WHY: Used when an admin clicks an event row, and ALSO called automatically when an
  // SSE "event-update" arrives for the event that is currently open in the details panel.
  async function fetchEventDetails(eventId, isBackgroundRefresh = false) {
    if (!isLoggedInRef.current) {
      return;
    }

    console.log('App: Fetching details for event ID:', eventId, isBackgroundRefresh ? '(background refresh)' : '');
    if (!isBackgroundRefresh) {
      setIsLoadingDetails(true);
      setDetailsError(null);
    }

    try {
      const response = await fetch('/api/events/' + eventId, {
        credentials: 'include'
      });

      if (response.status === 401) {
        console.warn('App: Session expired while fetching details (401).');
        handleSignedOut();
        showToast('Session expired. Please sign in again.', 'error');
        setDetailsError('Your session has expired. Please sign in again.');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load event details (Status ' + response.status + ')');
      }

      const data = await response.json();
      console.log('App: Fetched full event details for:', eventId);
      setSelectedEventDetails(data);
    } catch (err) {
      console.error('App: Error loading event details:', err.message);
      if (!isBackgroundRefresh) {
        setDetailsError('Could not load details for event ' + eventId + ': ' + err.message);
      }
    } finally {
      if (!isBackgroundRefresh) {
        setIsLoadingDetails(false);
      }
    }
  }

  // WHAT: Select an event row in the table when clicked.
  function handleSelectEvent(eventId) {
    if (!isLoggedIn) {
      return;
    }
    console.log('App: Selecting event ID:', eventId);
    setSelectedEventId(eventId);
    fetchEventDetails(eventId, false);
  }

  // WHAT: Deselect the current event and close the details panel.
  function handleCloseDetails() {
    setSelectedEventId(null);
    setSelectedEventDetails(null);
    setDetailsError(null);
  }


  // ─── INITIALIZATION (useEffect) ──────────────────────────────────────────

  // WHAT: Run once on mount to verify session and get downstream health status.
  // WHY: Restores admin session on page refresh and loads initial mock downstream mode.
  useEffect(() => {
    console.log('App: Mounted. Initializing auth and mock downstream status...');
    checkAuthStatus();
    fetchMockStatus();
  }, []);


  // ─── SERVER-SENT EVENTS (SSE) LIVE UPDATES ───────────────────────────────

  // WHAT: Open an EventSource connection to /api/stream when the App mounts.
  // WHY: Subscribes to real-time event updates pushed by the server, eliminating polling.
  useEffect(() => {
    console.log('App: Connecting to SSE stream at /api/stream...');
    const es = new EventSource('/api/stream');

    // WHAT: Stream connection opened successfully.
    // WHY: Set liveStatus to "live" and re-fetch the full list from GET /api/events.
    // Re-fetching merges row by row so any events received while connecting are synced without
    // overwriting newer live updates.
    es.onopen = () => {
      console.log('App: SSE stream connected. Setting status to live and syncing event list.');
      setLiveStatus('live');
      fetchEvents();
    };

    // WHAT: Listen for "event-update" custom events pushed from the server.
    // WHY: Broadcast whenever a webhook is received, completed, or failed.
    es.addEventListener('event-update', (event) => {
      try {
        const updatedEvent = JSON.parse(event.data);
        console.log('App: Received SSE event-update for ID:', updatedEvent.id, 'Status:', updatedEvent.status);

        // Highlight table row for 1.5 seconds
        setRecentlyChangedId(updatedEvent.id);
        if (highlightTimerRef.current) {
          clearTimeout(highlightTimerRef.current);
        }
        highlightTimerRef.current = setTimeout(() => {
          setRecentlyChangedId(null);
        }, 1500);

        // WHAT: Use mergeEvent with stale-update guard for every "event-update" message.
        // WHY: Protects against out-of-order network messages overwriting newer status with older status.
        setEvents((previousEvents) => mergeEvent(previousEvents, updatedEvent));

        // Refresh details panel if this event is currently selected by a signed-in admin
        if (isLoggedInRef.current && selectedEventIdRef.current === updatedEvent.id) {
          console.log('App: Live update affects selected event. Refreshing details for ID:', updatedEvent.id);
          fetchEventDetails(updatedEvent.id, true);
        }

      } catch (err) {
        console.error('App: Error handling event-update message:', err.message);
      }
    });

    // WHAT: Listen for "events-cleared" broadcast from server.
    // WHY: Fired when an admin clears all events. Empties the list, closes details, and shows a toast.
    es.addEventListener('events-cleared', () => {
      console.log('App: Received SSE events-cleared event. Resetting list and details.');
      setEvents([]);
      setSelectedEventId(null);
      setSelectedEventDetails(null);
      setDetailsError(null);
      showToast('All events were cleared', 'info');
    });

    // WHAT: Listen for "mock-status" broadcast from server.
    // WHY: Fired when downstream mock status changes. Keeps mockHealthy in sync across all clients.
    es.addEventListener('mock-status', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('App: Received SSE mock-status event:', data);
        setMockHealthy(data.healthy === true);
      } catch (err) {
        console.error('App: Error handling mock-status message:', err.message);
      }
    });

    // WHAT: Handle connection drops or network interruptions.
    // WHY: EventSource automatically attempts to reconnect on its own; we update the badge to "Reconnecting...".
    es.onerror = () => {
      console.warn('App: SSE stream disconnected. EventSource will automatically attempt to reconnect...');
      setLiveStatus('reconnecting');
    };

    // WHAT: Cleanup function called when the App component unmounts.
    // WHY: Calling es.close() closes the HTTP connection to prevent memory leaks and dangling sockets.
    return () => {
      console.log('App: Cleaning up EventSource connection.');
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      es.close();
    };
  }, []);


  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <div className="app-container">

      {/* ─── HEADER BAR ──────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-branding">
          <h1 className="app-title">EventBridge</h1>
          <p className="app-tagline">Live webhook event monitor</p>
        </div>

        {/* Header actions: Live Stream badge and Admin auth status */}
        <div className="header-actions">
          {/* Status badge: Live vs Reconnecting... */}
          {liveStatus === 'live' ? (
            <span className="live-badge live-badge-active" title="Connected to live event stream">
              <span className="live-dot"></span> Live
            </span>
          ) : (
            <span className="live-badge live-badge-reconnecting" title="Connecting or reconnecting to stream...">
              <span className="reconnecting-dot"></span> Reconnecting...
            </span>
          )}

          {isLoggedIn ? (
            <div className="admin-status-badge">
              <span className="admin-pill">Admin Mode</span>
              <button
                type="button"
                onClick={handleLogout}
                className="btn btn-secondary"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <span className="public-indicator">Public Viewer</span>
          )}
        </div>
      </header>


      {/* ─── MAIN CONTENT ────────────────────────────────────────────────── */}
      <main className="app-main">

        {/* Admin Controls (visible when signed in) OR Public downstream indicator (when signed out) */}
        <section className="section-admin" style={{ marginBottom: '16px' }}>
          <AdminPanel
            isLoggedIn={isLoggedIn}
            mockHealthy={mockHealthy}
            showToast={showToast}
            onSignedOut={handleSignedOut}
          />
        </section>

        {/* If the user is NOT logged in, show the small login card */}
        {!isLoggedIn && (
          <section className="section-login">
            <LoginForm
              onLogin={handleLogin}
              isLoading={isLoggingIn}
              errorMessage={loginError}
            />
          </section>
        )}

        {/* Table Controls */}
        <div className="table-controls">
          <div className="controls-left">
            <h2 className="section-title">Webhook Events</h2>
            <span className="events-count">
              {events.length} {events.length === 1 ? 'event' : 'events'} recorded
            </span>
          </div>
        </div>

        {/* Server error banner if backend is unreachable */}
        {eventsError && (
          <div className="banner banner-error" role="alert">
            <p>{eventsError}</p>
            <button onClick={fetchEvents} className="btn-retry-inline">Retry Connection</button>
          </div>
        )}

        {/* Loading state indicator for events table */}
        {isLoadingEvents && events.length === 0 ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Loading events from server...</p>
          </div>
        ) : (
          /* Events Table with live row highlight */
          <EventTable
            events={events}
            selectedEventId={selectedEventId}
            onSelectEvent={handleSelectEvent}
            isLoggedIn={isLoggedIn}
            recentlyChangedId={recentlyChangedId}
          />
        )}

        {/* ─── EVENT DETAILS PANEL (UNDER TABLE) ─────────────────────────── */}
        {/* Only rendered when an event is selected by an admin */}
        {selectedEventId && (
          <section className="section-details">
            <EventDetails
              eventDetails={selectedEventDetails}
              isLoading={isLoadingDetails}
              errorMessage={detailsError}
              onClose={handleCloseDetails}
              isLoggedIn={isLoggedIn}
              onSignedOut={handleSignedOut}
              showToast={showToast}
            />
          </section>
        )}

      </main>

      {/* ─── FOOTER ──────────────────────────────────────────────────────── */}
      <footer className="app-footer">
        <p>EventBridge • College Recruitment Project • Task ID: EventBridge</p>
      </footer>

      {/* ─── TOAST NOTIFICATIONS CONTAINER ───────────────────────────────── */}
      {/* WHAT: Fixed container with aria-live="polite" to host toast notifications. */}
      {/* WHY: Ensures accessible announcements without shifting layout or interrupting page flow. */}
      <div
        className="toast-container"
        aria-live="polite"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          zIndex: 10000,
          pointerEvents: 'none'
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.kind || 'info'}`}
            role="status"
            style={{
              pointerEvents: 'auto',
              padding: '12px 18px',
              borderRadius: '6px',
              backgroundColor:
                toast.kind === 'error'
                  ? '#dc2626'
                  : toast.kind === 'success'
                  ? '#16a34a'
                  : toast.kind === 'warning'
                  ? '#d97706'
                  : '#2563eb',
              color: '#ffffff',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.2), 0 4px 6px -2px rgba(0, 0, 0, 0.1)',
              fontSize: '14px',
              fontWeight: '500',
              maxWidth: '380px',
              wordBreak: 'break-word'
            }}
          >
            {toast.text}
          </div>
        ))}
      </div>

    </div>
  );
}

export default App;
