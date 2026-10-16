import { useState, useEffect, useRef } from 'react';
import LoginForm from './components/LoginForm';
import EventTable from './components/EventTable';
import EventDetails from './components/EventDetails';
import './App.css';

// WHAT: Main Application Component for EventBridge.
// WHY: Coordinates the entire frontend: holds top-level state, manages Server-Sent Events (SSE)
// live stream connection, handles API calls, and passes props down to child components.
function App() {

  // ─── STATE MANAGEMENT ───────────────────────────────────────────────────

  // WHAT: Whether the current visitor is authenticated as an admin.
  // WHY: Controls whether to display the login form or the sign-out button,
  // and whether table rows can be clicked to inspect payloads.
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // WHAT: Array of event summary rows fetched from GET /api/events.
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
      console.log('App: Received ' + data.length + ' events from server.');
      setEvents(data);
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
      setIsLoggedIn(false);
      setSelectedEventId(null);
      setSelectedEventDetails(null);
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
        console.warn('App: Session expired while fetching details.');
        setIsLoggedIn(false);
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

  // WHAT: Run once on mount to verify existing authentication session.
  // WHY: If the admin refreshed their browser, we restore their signed-in state immediately.
  useEffect(() => {
    console.log('App: Mounted. Initializing auth status...');
    checkAuthStatus();
  }, []);


  // ─── SERVER-SENT EVENTS (SSE) LIVE UPDATES ───────────────────────────────

  // WHAT: Open an EventSource connection to /api/stream when the App mounts.
  // WHY: Subscribes to real-time event updates pushed by the server, eliminating the need to poll.
  useEffect(() => {
    console.log('App: Connecting to SSE stream at /api/stream...');
    const es = new EventSource('/api/stream');

    // WHAT: Stream connection opened successfully.
    // WHY: Set liveStatus to "live" and re-fetch the full list from GET /api/events.
    // Re-fetching ensures that any events received while connecting or after a server restart are fully synced.
    es.onopen = () => {
      console.log('App: SSE stream connected. Setting status to live and syncing event list.');
      setLiveStatus('live');
      fetchEvents();
    };

    // WHAT: Listen for "event-update" custom events pushed from the server.
    // WHY: Broadcast whenever a webhook is received, completed, or failed.
    es.addEventListener('event-update', (event) => {
      try {
        // Parse the incoming JSON event data (id, created_at, status, attempt_count)
        const updatedEvent = JSON.parse(event.data);
        console.log('App: Received SSE event-update for ID:', updatedEvent.id, 'Status:', updatedEvent.status);

        // WHAT: Trigger the 1.5-second row fade highlight animation.
        // WHY: Visually alerts the user to the exact row that was inserted or updated.
        setRecentlyChangedId(updatedEvent.id);
        if (highlightTimerRef.current) {
          clearTimeout(highlightTimerRef.current);
        }
        highlightTimerRef.current = setTimeout(() => {
          setRecentlyChangedId(null);
        }, 1500);

        // WHAT: Merge the updated event into the events state using a plain loop.
        // WHY: Uses the functional updater setEvents(previous => ...) to prevent stale state issues.
        setEvents((previousEvents) => {
          let found = false;
          const newEventsList = [];

          // Plain for-loop: if the event is already in the list, replace it; otherwise keep existing
          for (let i = 0; i < previousEvents.length; i++) {
            const current = previousEvents[i];
            if (current.id === updatedEvent.id) {
              // Replace with fresh updated row
              newEventsList.push(updatedEvent);
              found = true;
            } else {
              newEventsList.push(current);
            }
          }

          // If not found in the list, it's a new event: append it
          if (!found) {
            newEventsList.push(updatedEvent);
          }

          // WHAT: Sort the merged list in the exact same order as the server:
          //       created_at descending (newest first), then id descending as tie-breaker.
          // WHY: Keeps the timeline in consistent order as new webhooks stream in.
          newEventsList.sort((a, b) => {
            const timeA = new Date(a.created_at).getTime();
            const timeB = new Date(b.created_at).getTime();
            if (timeB !== timeA) {
              return timeB - timeA; // Newest first
            }
            return b.id.localeCompare(a.id); // Tie-breaker
          });

          return newEventsList;
        });

        // WHAT: If an admin currently has this event open in the details panel, re-fetch full details.
        // WHY: Keeps the open panel (status, attempt count, failure reason) completely up to date.
        // Users who are not logged in do nothing extra.
        if (isLoggedInRef.current && selectedEventIdRef.current === updatedEvent.id) {
          console.log('App: Live update affects selected event. Refreshing details for ID:', updatedEvent.id);
          fetchEventDetails(updatedEvent.id, true);
        }

      } catch (err) {
        console.error('App: Error handling event-update message:', err.message);
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

        {/* Table Controls (temporary Refresh button removed) */}
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
            />
          </section>
        )}

      </main>

      {/* ─── FOOTER ──────────────────────────────────────────────────────── */}
      <footer className="app-footer">
        <p>EventBridge • College Recruitment Project • Task ID: EventBridge</p>
      </footer>

    </div>
  );
}

export default App;
