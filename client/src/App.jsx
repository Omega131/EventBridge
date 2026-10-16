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
function App() {

  // ─── THEME ENGINE (LIGHT / DARK) ─────────────────────────────────────────
  // WHAT: Theme state ('light' or 'dark').
  // WHY: Defaults to the user's system setting, remembers choice in localStorage inside try/catch.
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('eventbridge-theme');
      if (saved === 'dark' || saved === 'light') {
        return saved;
      }
    } catch (_) {}
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }
    return 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('eventbridge-theme', theme);
    } catch (_) {}
  }, [theme]);

  function toggleTheme() {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }


  // ─── APPLICATION STATE ───────────────────────────────────────────────────

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [events, setEvents] = useState([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [eventsError, setEventsError] = useState(null);

  const [selectedEventId, setSelectedEventId] = useState(null);
  const [selectedEventDetails, setSelectedEventDetails] = useState(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState(null);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [isLoginCardOpen, setIsLoginCardOpen] = useState(false);

  const [liveStatus, setLiveStatus] = useState('connecting');
  const [recentlyChangedId, setRecentlyChangedId] = useState(null);
  const [mockHealthy, setMockHealthy] = useState(true);
  const [toasts, setToasts] = useState([]);

  // Toolbar & filter state
  const [statusFilter, setStatusFilter] = useState('All'); // 'All' | 'Received' | 'Completed' | 'Failed'
  const [searchQuery, setSearchQuery] = useState('');
  const [isWebhookCardOpen, setIsWebhookCardOpen] = useState(false);


  // ─── TOAST NOTIFICATION SYSTEM ───────────────────────────────────────────

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

  const selectedEventIdRef = useRef(selectedEventId);
  useEffect(() => {
    selectedEventIdRef.current = selectedEventId;
  }, [selectedEventId]);

  const isLoggedInRef = useRef(isLoggedIn);
  useEffect(() => {
    isLoggedInRef.current = isLoggedIn;
  }, [isLoggedIn]);

  const highlightTimerRef = useRef(null);


  // ─── AUTHENTICATION HELPERS ──────────────────────────────────────────────

  function handleSignedOut() {
    console.log('App: Clearing admin session state.');
    setIsLoggedIn(false);
    setSelectedEventId(null);
    setSelectedEventDetails(null);
    setDetailsError(null);
  }


  // ─── API CALLS ──────────────────────────────────────────────────────────

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

  async function fetchMockStatus() {
    console.log('App: Fetching mock status via GET /api/mock/status...');
    try {
      const response = await fetch('/api/mock/status');
      if (response.ok) {
        const data = await response.json();
        console.log('App: Initial mock downstream status received:', data);
        setMockHealthy(data.healthy === true);
      }
    } catch (err) {
      console.error('App: Failed to fetch mock status:', err.message);
    }
  }

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

      // WHAT: Merge row by row with mergeEvent instead of replacing whole state.
      // WHY: Stops an old response from overwriting a newer live update.
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
        setIsLoginCardOpen(false);
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

  function handleSelectEvent(eventId) {
    if (!isLoggedIn) {
      setIsLoginCardOpen(true);
      showToast('Please sign in as admin to view event payloads', 'info');
      return;
    }
    console.log('App: Selecting event ID:', eventId);
    setSelectedEventId(eventId);
    fetchEventDetails(eventId, false);
  }

  function handleCloseDetails() {
    setSelectedEventId(null);
    setSelectedEventDetails(null);
    setDetailsError(null);
  }


  // ─── INITIALIZATION (useEffect) ──────────────────────────────────────────

  useEffect(() => {
    console.log('App: Mounted. Initializing auth and mock downstream status...');
    checkAuthStatus();
    fetchMockStatus();
  }, []);


  // ─── SERVER-SENT EVENTS (SSE) LIVE UPDATES ───────────────────────────────

  useEffect(() => {
    console.log('App: Connecting to SSE stream at /api/stream...');
    const es = new EventSource('/api/stream');

    es.onopen = () => {
      console.log('App: SSE stream connected. Setting status to live and syncing event list.');
      setLiveStatus('live');
      fetchEvents();
    };

    es.addEventListener('event-update', (event) => {
      try {
        const updatedEvent = JSON.parse(event.data);
        console.log('App: Received SSE event-update for ID:', updatedEvent.id, 'Status:', updatedEvent.status);

        setRecentlyChangedId(updatedEvent.id);
        if (highlightTimerRef.current) {
          clearTimeout(highlightTimerRef.current);
        }
        highlightTimerRef.current = setTimeout(() => {
          setRecentlyChangedId(null);
        }, 1500);

        setEvents((previousEvents) => mergeEvent(previousEvents, updatedEvent));

        if (isLoggedInRef.current && selectedEventIdRef.current === updatedEvent.id) {
          console.log('App: Live update affects selected event. Refreshing details for ID:', updatedEvent.id);
          fetchEventDetails(updatedEvent.id, true);
        }

      } catch (err) {
        console.error('App: Error handling event-update message:', err.message);
      }
    });

    es.addEventListener('events-cleared', () => {
      console.log('App: Received SSE events-cleared event. Resetting list and details.');
      setEvents([]);
      setSelectedEventId(null);
      setSelectedEventDetails(null);
      setDetailsError(null);
      showToast('All events were cleared', 'info');
    });

    es.addEventListener('mock-status', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('App: Received SSE mock-status event:', data);
        setMockHealthy(data.healthy === true);
      } catch (err) {
        console.error('App: Error handling mock-status message:', err.message);
      }
    });

    es.onerror = () => {
      console.warn('App: SSE stream disconnected. EventSource will automatically attempt to reconnect...');
      setLiveStatus('reconnecting');
    };

    return () => {
      console.log('App: Cleaning up EventSource connection.');
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      es.close();
    };
  }, []);


  // ─── COMPUTED STATS (LATEST 100 EVENTS) ──────────────────────────────────
  const totalEvents = events.length;
  const completedCount = events.filter((e) => e.status === 'Completed').length;
  const failedCount = events.filter((e) => e.status === 'Failed').length;
  const receivedCount = events.filter((e) => e.status === 'Received').length;
  const successRate =
    totalEvents > 0
      ? ((completedCount / totalEvents) * 100).toFixed(1) + '%'
      : '0.0%';


  // ─── COMPUTED FILTERED EVENTS FOR TABLE ──────────────────────────────────
  const displayedEvents = events.filter((event) => {
    if (statusFilter !== 'All' && event.status !== statusFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      if (!event.id.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });


  // ─── WEBHOOK CURL HELPERS ────────────────────────────────────────────────
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const webhookUrl = `${origin}/api/webhook`;
  const curlExample = `curl -X POST ${webhookUrl} \\
  -H "Content-Type: application/json" \\
  -H "x-webhook-secret: YOUR_SECRET" \\
  -d '{"event":"order.created","amount":149.99,"customer":"cust_123"}'`;

  async function handleCopyCurl() {
    try {
      await navigator.clipboard.writeText(curlExample);
      showToast('Copied curl command to clipboard', 'info');
    } catch (err) {
      console.error('Failed to copy curl:', err);
    }
  }

  async function handleCopyWebhookUrl() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      showToast('Copied webhook URL to clipboard', 'info');
    } catch (err) {
      console.error('Failed to copy webhook URL:', err);
    }
  }


  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <div className="dashboard-shell">

      {/* ─── HEADER ──────────────────────────────────────────────────────── */}
      <header className="dashboard-header">
        <div className="header-left">
          {/* Logo Mark SVG */}
          <div className="brand-logo" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 11a9 9 0 0 1 9 9" />
              <path d="M4 4a16 16 0 0 1 16 16" />
              <circle cx="5" cy="19" r="1" fill="currentColor" />
            </svg>
          </div>
          <div>
            <span className="brand-title">EventBridge</span>
            <span className="brand-subtitle">Webhook Ingestion Monitor</span>
          </div>
        </div>

        <div className="header-right">
          {/* Live / Reconnecting Status Pill */}
          {liveStatus === 'live' ? (
            <div className="status-pill status-pill-live" title="Live SSE stream connected">
              <span className="status-dot status-dot-live" aria-hidden="true" />
              <span>Live</span>
            </div>
          ) : (
            <div className="status-pill status-pill-reconnecting" title="Connecting or reconnecting to SSE stream...">
              <span className="status-dot status-dot-reconnecting" aria-hidden="true" />
              <span>Reconnecting</span>
            </div>
          )}

          {/* Theme Toggle Button */}
          <button
            type="button"
            className="btn-icon theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label={`Toggle theme (currently ${theme} mode)`}
          >
            {theme === 'dark' ? (
              // Sun SVG
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              // Moon SVG
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          {/* Admin Panel (Dropdown menu if signed in, or read-only downstream pill if visitor) */}
          <AdminPanel
            isLoggedIn={isLoggedIn}
            mockHealthy={mockHealthy}
            showToast={showToast}
            onSignedOut={handleSignedOut}
            onLogout={handleLogout}
          />

          {/* Visitor Sign In Button (when signed out) */}
          {!isLoggedIn && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setIsLoginCardOpen((prev) => !prev)}
            >
              Sign In
            </button>
          )}
        </div>
      </header>


      {/* ─── MAIN CONTENT ────────────────────────────────────────────────── */}
      <main className="dashboard-main">

        {/* Optional Collapsible Login Form Card */}
        {!isLoggedIn && isLoginCardOpen && (
          <section className="login-section">
            <LoginForm
              onLogin={handleLogin}
              isLoading={isLoggingIn}
              errorMessage={loginError}
              onCancel={() => setIsLoginCardOpen(false)}
            />
          </section>
        )}

        {/* ─── 2. SEND A WEBHOOK CARD (COLLAPSIBLE) ─────────────────────── */}
        <section className="webhook-helper-card">
          <div
            className="webhook-helper-header"
            onClick={() => setIsWebhookCardOpen((prev) => !prev)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setIsWebhookCardOpen((prev) => !prev);
              }
            }}
            aria-expanded={isWebhookCardOpen}
          >
            <div className="webhook-helper-title-group">
              <div className="terminal-icon-badge" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </div>
              <div>
                <h2 className="helper-card-heading">Send a webhook</h2>
                <p className="helper-card-subheading">
                  POST payload to <code className="endpoint-pill">{webhookUrl}</code>
                </p>
              </div>
            </div>

            <div className="helper-header-actions">
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyWebhookUrl();
                }}
              >
                Copy URL
              </button>
              <svg
                className={`chevron-icon ${isWebhookCardOpen ? 'chevron-open' : ''}`}
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>

          {isWebhookCardOpen && (
            <div className="webhook-helper-body">
              <div className="curl-box">
                <div className="curl-box-header">
                  <span className="curl-label">Example curl request</span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={handleCopyCurl}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span>Copy curl</span>
                  </button>
                </div>
                <pre className="curl-code font-mono">{curlExample}</pre>
              </div>

              <div className="webhook-notice">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>
                  The <code>x-webhook-secret</code> header is verified server-side. Replace <code>YOUR_SECRET</code> with your shared team key (shared separately). Real keys are never displayed here.
                </span>
              </div>
            </div>
          )}
        </section>


        {/* ─── 3. STATS ROW (LATEST 100 EVENTS) ─────────────────────────── */}
        <section className="stats-row" aria-label="Event statistics (latest 100 events)">
          <div className="stat-card">
            <span className="stat-label">Total in view</span>
            <div className="stat-value-group">
              <span className="stat-value tabular-nums font-mono">{totalEvents}</span>
              <span className="stat-sublabel">latest 100 events</span>
            </div>
          </div>

          <div className="stat-card stat-card-completed">
            <span className="stat-label">Completed</span>
            <div className="stat-value-group">
              <span className="stat-value text-success tabular-nums font-mono">{completedCount}</span>
              <span className="stat-sublabel">delivered downstream</span>
            </div>
          </div>

          <div className="stat-card stat-card-failed">
            <span className="stat-label">Failed</span>
            <div className="stat-value-group">
              <span className="stat-value text-danger tabular-nums font-mono">{failedCount}</span>
              <span className="stat-sublabel">requires attention</span>
            </div>
          </div>

          <div className="stat-card stat-card-received">
            <span className="stat-label">Received</span>
            <div className="stat-value-group">
              <span className="stat-value text-received tabular-nums font-mono">{receivedCount}</span>
              <span className="stat-sublabel">in processing / retry</span>
            </div>
          </div>

          <div className="stat-card stat-card-rate">
            <span className="stat-label">Success Rate</span>
            <div className="stat-value-group">
              <span className="stat-value tabular-nums font-mono">{successRate}</span>
              <span className="stat-sublabel">delivery efficiency</span>
            </div>
          </div>
        </section>


        {/* ─── 4. TOOLBAR (FILTER CHIPS & SEARCH BOX) ───────────────────── */}
        <section className="toolbar-section">
          {/* Filter Chips */}
          <div className="filter-chips" role="group" aria-label="Filter events by status">
            {[
              { label: 'All', count: totalEvents },
              { label: 'Received', count: receivedCount },
              { label: 'Completed', count: completedCount },
              { label: 'Failed', count: failedCount }
            ].map((chip) => (
              <button
                key={chip.label}
                type="button"
                className={`filter-chip ${statusFilter === chip.label ? 'active' : ''}`}
                onClick={() => setStatusFilter(chip.label)}
              >
                <span>{chip.label}</span>
                <span className="chip-count tabular-nums font-mono">{chip.count}</span>
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="search-box">
            <svg className="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="search-input font-mono"
              placeholder="Search by event ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Filter events by UUID"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </section>


        {/* ─── SERVER ERROR BANNER (IF DOWN) ────────────────────────────── */}
        {eventsError && (
          <div className="banner banner-error" role="alert">
            <div className="banner-content">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{eventsError}</span>
            </div>
            <button type="button" onClick={fetchEvents} className="btn btn-secondary btn-xs">
              Try again
            </button>
          </div>
        )}


        {/* ─── 5. EVENTS TABLE ──────────────────────────────────────────── */}
        <section className="table-section">
          <EventTable
            events={displayedEvents}
            selectedEventId={selectedEventId}
            onSelectEvent={handleSelectEvent}
            isLoggedIn={isLoggedIn}
            recentlyChangedId={recentlyChangedId}
            isLoading={isLoadingEvents}
            showToast={showToast}
          />
        </section>

      </main>


      {/* ─── 6. SLIDE-OVER EVENT DETAILS DRAWER ─────────────────────────── */}
      {selectedEventId && (
        <EventDetails
          eventDetails={selectedEventDetails}
          isLoading={isLoadingDetails}
          errorMessage={detailsError}
          onClose={handleCloseDetails}
          isLoggedIn={isLoggedIn}
          onSignedOut={handleSignedOut}
          showToast={showToast}
        />
      )}


      {/* ─── FOOTER ──────────────────────────────────────────────────────── */}
      <footer className="dashboard-footer">
        <p>EventBridge • Enterprise Webhook Ingestion Engine • Tabular Monitor</p>
      </footer>


      {/* ─── 8. TOAST NOTIFICATIONS CONTAINER ────────────────────────────── */}
      <div
        className="toast-container"
        aria-live="polite"
        role="region"
        aria-label="System notifications"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast-item toast-${toast.kind || 'info'}`}
            role="status"
          >
            {/* Kind Icon */}
            <div className="toast-icon-wrap" aria-hidden="true">
              {toast.kind === 'success' ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : toast.kind === 'error' ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              ) : toast.kind === 'warning' ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              )}
            </div>

            <span className="toast-text">{toast.text}</span>
          </div>
        ))}
      </div>

    </div>
  );
}

export default App;
