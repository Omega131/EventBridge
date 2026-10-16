import { useState, useEffect } from 'react';
import LoginForm from './components/LoginForm';
import EventTable from './components/EventTable';
import EventDetails from './components/EventDetails';
import './App.css';

// WHAT: Main Application Component for EventBridge.
// WHY: Coordinates the entire frontend: holds top-level state, handles API calls,
// and passes data and callback functions down to child components as props.
function App() {

  // ─── STATE MANAGEMENT ───────────────────────────────────────────────────

  // WHAT: Whether the current visitor is authenticated as an admin.
  // WHY: Controls whether to display the login form or the sign-out button,
  // and whether table rows can be clicked to inspect payloads.
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // WHAT: Array of event summary rows fetched from GET /api/events.
  // WHY: Displays the main event timeline in the EventTable.
  const [events, setEvents] = useState([]);

  // WHAT: Loading indicator for the events list.
  // WHY: Informs the user when events are being fetched from the backend.
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
    setIsLoadingEvents(true);
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

  // WHAT: Fetch complete details for a single event when its table row is clicked.
  // WHY: Only signed-in administrators can inspect full payloads and failure reasons.
  async function handleSelectEvent(eventId) {
    if (!isLoggedIn) {
      return;
    }

    console.log('App: Selecting event ID:', eventId);
    setSelectedEventId(eventId);
    setIsLoadingDetails(true);
    setDetailsError(null);

    try {
      const response = await fetch('/api/events/' + eventId, {
        credentials: 'include'
      });

      if (response.status === 401) {
        // Session expired or cookie was cleared
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
      setDetailsError('Could not load details for event ' + eventId + ': ' + err.message);
    } finally {
      setIsLoadingDetails(false);
    }
  }

  // WHAT: Deselect the current event and close the details panel.
  function handleCloseDetails() {
    setSelectedEventId(null);
    setSelectedEventDetails(null);
    setDetailsError(null);
  }


  // ─── INITIALIZATION (useEffect) ──────────────────────────────────────────

  // WHAT: Run once when the App component first mounts into the DOM.
  // WHY: Loads the initial authentication state and the initial list of events immediately.
  useEffect(() => {
    console.log('App: Mounted. Initializing auth and event data...');
    checkAuthStatus();
    fetchEvents();
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

        {/* Auth section in the header: shows sign-out if logged in */}
        <div className="header-actions">
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

        {/* Table Controls & Refresh Button */}
        <div className="table-controls">
          <div className="controls-left">
            <h2 className="section-title">Webhook Events</h2>
            <span className="events-count">
              {events.length} {events.length === 1 ? 'event' : 'events'} recorded
            </span>
          </div>

          <div className="controls-right">
            {/* Temporary refresh button (to be removed in Phase 5 when SSE live updates arrive) */}
            <button
              type="button"
              onClick={fetchEvents}
              disabled={isLoadingEvents}
              className="btn btn-outline"
              title="Reload the events list"
            >
              {isLoadingEvents ? 'Refreshing...' : '↻ Refresh List'}
            </button>
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
          /* Events Table */
          <EventTable
            events={events}
            selectedEventId={selectedEventId}
            onSelectEvent={handleSelectEvent}
            isLoggedIn={isLoggedIn}
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
