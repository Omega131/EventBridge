import { useState, useEffect, useRef } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  TrendingUp,
  Search,
  X,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  RotateCw,
  Sparkles,
  Zap,
  Radio,
  FileSpreadsheet,
  FileJson
} from 'lucide-react';
import LoginForm from './components/LoginForm';
import EventTable from './components/EventTable';
import EventDetails from './components/EventDetails';
import AdminPanel from './components/AdminPanel';
import WebhookDispatcher from './components/WebhookDispatcher';
import { sound } from './utils/sound';
import './App.css';

// ─── STALE-UPDATE GUARD HELPER ───────────────────────────────────────────────
function mergeEvent(list, incoming) {
  if (!incoming || !incoming.id) return list;

  const incomingUpdatedAtMs = incoming.updated_at ? Date.parse(incoming.updated_at) : 0;
  let found = false;
  const nextList = [];

  for (let i = 0; i < list.length; i++) {
    const existing = list[i];
    if (existing.id === incoming.id) {
      found = true;
      const existingUpdatedAtMs = existing.updated_at ? Date.parse(existing.updated_at) : 0;
      if (incomingUpdatedAtMs >= existingUpdatedAtMs) {
        nextList.push(incoming);
      } else {
        nextList.push(existing);
      }
    } else {
      nextList.push(existing);
    }
  }

  if (!found) {
    nextList.push(incoming);
  }

  nextList.sort((a, b) => {
    const timeA = a.created_at ? Date.parse(a.created_at) : 0;
    const timeB = b.created_at ? Date.parse(b.created_at) : 0;
    if (timeB !== timeA) return timeB - timeA;
    return (b.id || '').localeCompare(a.id || '');
  });

  return nextList;
}

export default function App() {
  // ─── THEME ENGINE ────────────────────────────────────────────────────────
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('eventbridge-theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {}
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }
    return 'dark'; // High-tech dark mode by default
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('eventbridge-theme', theme);
    } catch {}
  }, [theme]);

  function toggleTheme() {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }

  // ─── SOUND TELEMETRY SETTING ─────────────────────────────────────────────
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('eventbridge-sound');
      if (saved !== null) return saved === 'true';
    } catch {}
    return true; // Default sound on for live feeling
  });

  function toggleSound() {
    setSoundEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('eventbridge-sound', String(next));
      } catch {}
      if (next) sound.playPing(true);
      return next;
    });
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
  const [isRefreshing, setIsRefreshing] = useState(false);

  const searchInputRef = useRef(null);
  const selectedEventIdRef = useRef(selectedEventId);
  useEffect(() => {
    selectedEventIdRef.current = selectedEventId;
  }, [selectedEventId]);

  const isLoggedInRef = useRef(isLoggedIn);
  useEffect(() => {
    isLoggedInRef.current = isLoggedIn;
  }, [isLoggedIn]);

  const highlightTimerRef = useRef(null);

  // ─── KEYBOARD SHORTCUTS ──────────────────────────────────────────────────
  useEffect(() => {
    function handleGlobalKeyDown(e) {
      if ((e.key === '/' || (e.ctrlKey && e.key === 'k') || (e.metaKey && e.key === 'k')) && document.activeElement !== searchInputRef.current) {
        if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // ─── TOAST NOTIFICATIONS ─────────────────────────────────────────────────
  function showToast(text, kind = 'info') {
    const id = Date.now() + '-' + Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, text, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }

  // ─── AUTHENTICATION HELPERS ──────────────────────────────────────────────
  function handleSignedOut() {
    setIsLoggedIn(false);
    setSelectedEventId(null);
    setSelectedEventDetails(null);
    setDetailsError(null);
  }

  async function checkAuthStatus() {
    try {
      const response = await fetch('/api/me', { credentials: 'include' });
      const data = await response.json();
      setIsLoggedIn(data.loggedIn === true);
    } catch (err) {
      console.error('App: Failed to check auth status:', err.message);
      setIsLoggedIn(false);
    }
  }

  async function fetchMockStatus() {
    try {
      const response = await fetch('/api/mock/status');
      if (response.ok) {
        const data = await response.json();
        setMockHealthy(data.healthy === true);
      }
    } catch (err) {
      console.error('App: Failed to fetch mock status:', err.message);
    }
  }

  async function fetchEvents(isManual = false) {
    if (isManual) setIsRefreshing(true);
    setEventsError(null);

    try {
      const response = await fetch('/api/events', { credentials: 'include' });
      if (!response.ok) throw new Error('Server returned status ' + response.status);
      const data = await response.json();

      setEvents((previousEvents) => {
        let mergedList = previousEvents;
        for (let i = 0; i < data.length; i++) {
          mergedList = mergeEvent(mergedList, data[i]);
        }
        return mergedList;
      });
      if (isManual) {
        showToast('Event stream synced', 'info');
      }
    } catch (err) {
      console.error('App: Error fetching events:', err.message);
      setEventsError('Unable to connect to backend on port 3000.');
    } finally {
      setIsLoadingEvents(false);
      if (isManual) setIsRefreshing(false);
    }
  }

  async function handleLogin(password) {
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password })
      });

      const data = await response.json();

      if (response.ok && data.loggedIn) {
        setIsLoggedIn(true);
        setLoginError(null);
        setIsLoginCardOpen(false);
        sound.playSuccess(soundEnabled);
        showToast('Signed in successfully', 'success');
      } else {
        setLoginError(data.error === 'Wrong password' ? 'Incorrect admin password' : (data.error || 'Login failed'));
      }
    } catch (err) {
      console.error('App: Login error:', err.message);
      setLoginError('Could not reach the server. Please check port 3000.');
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch (err) {
      console.error('App: Logout error:', err.message);
    } finally {
      handleSignedOut();
      showToast('Signed out successfully', 'info');
    }
  }

  async function fetchEventDetails(eventId, isBackgroundRefresh = false) {
    if (!isLoggedInRef.current) return;
    if (!isBackgroundRefresh) {
      setIsLoadingDetails(true);
      setDetailsError(null);
    }

    try {
      const response = await fetch('/api/events/' + eventId, { credentials: 'include' });
      if (response.status === 401) {
        handleSignedOut();
        showToast('Session expired. Please sign in again.', 'error');
        setDetailsError('Your session has expired.');
        return;
      }
      if (!response.ok) throw new Error('Status ' + response.status);
      const data = await response.json();
      setSelectedEventDetails(data);
    } catch (err) {
      console.error('App: Error loading event details:', err.message);
      if (!isBackgroundRefresh) {
        setDetailsError('Could not load payload: ' + err.message);
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
      showToast('Please sign in as admin to inspect payloads', 'info');
      return;
    }
    setSelectedEventId(eventId);
    fetchEventDetails(eventId, false);
  }

  function handleCloseDetails() {
    setSelectedEventId(null);
    setSelectedEventDetails(null);
    setDetailsError(null);
  }

  // ─── INITIALIZATION ──────────────────────────────────────────────────────
  useEffect(() => {
    checkAuthStatus();
    fetchMockStatus();
  }, []);

  // ─── SSE CONNECTION ──────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/stream');

    es.onopen = () => {
      setLiveStatus('live');
      fetchEvents();
    };

    es.addEventListener('event-update', (event) => {
      try {
        const updatedEvent = JSON.parse(event.data);

        // Sound chime for incoming event
        sound.playPing(soundEnabled);

        // Glow highlight row
        setRecentlyChangedId(updatedEvent.id);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
          setRecentlyChangedId(null);
        }, 1800);

        setEvents((prev) => mergeEvent(prev, updatedEvent));

        if (isLoggedInRef.current && selectedEventIdRef.current === updatedEvent.id) {
          fetchEventDetails(updatedEvent.id, true);
        }
      } catch (err) {
        console.error('App: Error parsing event-update:', err);
      }
    });

    es.addEventListener('events-cleared', () => {
      setEvents([]);
      setSelectedEventId(null);
      setSelectedEventDetails(null);
      setDetailsError(null);
      showToast('All events cleared from database', 'info');
    });

    es.addEventListener('mock-status', (event) => {
      try {
        const data = JSON.parse(event.data);
        setMockHealthy(data.healthy === true);
      } catch (err) {
        console.error('App: Error handling mock-status:', err);
      }
    });

    es.onerror = () => {
      setLiveStatus('reconnecting');
    };

    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      es.close();
    };
  }, [soundEnabled]);

  // ─── COMPUTED STATS ──────────────────────────────────────────────────────
  const totalEvents = events.length;
  const completedCount = events.filter((e) => e.status === 'Completed').length;
  const failedCount = events.filter((e) => e.status === 'Failed').length;
  const receivedCount = events.filter((e) => e.status === 'Received').length;
  const successRateNum = totalEvents > 0 ? ((completedCount / totalEvents) * 100).toFixed(1) : '100.0';

  // ─── FILTERED EVENTS ─────────────────────────────────────────────────────
  const displayedEvents = events.filter((event) => {
    if (statusFilter !== 'All' && event.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      if (!event.id.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // ─── EXPORT FUNCTIONALITY ────────────────────────────────────────────────
  function exportEventsJson() {
    try {
      const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eventbridge-events-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Exported events as JSON', 'success');
    } catch {
      showToast('Export failed', 'error');
    }
  }

  function exportEventsCsv() {
    try {
      const headers = ['id', 'status', 'attempt_count', 'created_at', 'updated_at'];
      const rows = events.map((e) => [
        `"${e.id}"`,
        `"${e.status}"`,
        e.attempt_count ?? 0,
        `"${e.created_at || ''}"`,
        `"${e.updated_at || ''}"`
      ]);
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eventbridge-events-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Exported events as CSV', 'success');
    } catch {
      showToast('Export failed', 'error');
    }
  }

  return (
    <div className="dashboard-shell">
      {/* ─── AMBIENT AURORA BACKGROUND ─── */}
      <div className="ambient-background" aria-hidden="true">
        <div className="aurora-glow aurora-1" />
        <div className="aurora-glow aurora-2" />
        <div className="aurora-glow aurora-3" />
        <div className="ambient-grid-overlay" />
      </div>

      {/* ─── 1. ULTRA-PREMIUM HEADER ─── */}
      <header className="dashboard-header">
        <div className="header-left">
          {/* Logo with pulsating neon core */}
          <div className="brand-logo-wrap" aria-hidden="true">
            <div className="brand-logo-outer">
              <div className="brand-logo-inner">
                <Radio size={20} className="brand-icon-radio" />
              </div>
            </div>
            <span className="brand-pulse-dot" />
          </div>

          <div className="brand-info">
            <div className="brand-title-row">
              <span className="brand-title">EventBridge</span>
              <span className="brand-version-tag">v2.0</span>
            </div>
            <span className="brand-subtitle">Real-time Webhook Ingestion Engine</span>
          </div>
        </div>

        <div className="header-right">
          {/* Live SSE Radar Pill */}
          {liveStatus === 'live' ? (
            <div className="status-pill status-pill-live" title="Live SSE connection active & streaming">
              <span className="status-dot status-dot-live" aria-hidden="true" />
              <span className="font-semibold">Live Stream</span>
            </div>
          ) : (
            <div className="status-pill status-pill-reconnecting" title="Connecting to live SSE stream...">
              <span className="status-dot status-dot-reconnecting" aria-hidden="true" />
              <span>Connecting</span>
            </div>
          )}

          {/* Sound Mute/Unmute Telemetry Toggle */}
          <button
            type="button"
            className={`btn-icon ${soundEnabled ? 'active-audio' : ''}`}
            onClick={toggleSound}
            title={soundEnabled ? 'Mute audio telemetry' : 'Enable live audio chimes'}
            aria-label="Toggle sound feedback"
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>

          {/* Theme Toggle Button */}
          <button
            type="button"
            className="btn-icon theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label={`Toggle theme (currently ${theme} mode)`}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Admin Panel (Mock Status + Dropdown when logged in, or Visitor pill when logged out) */}
          <AdminPanel
            isLoggedIn={isLoggedIn}
            mockHealthy={mockHealthy}
            showToast={showToast}
            onSignedOut={handleSignedOut}
            onLogout={handleLogout}
            soundEnabled={soundEnabled}
          />

          {/* Sign In Trigger (Visitor view) */}
          {!isLoggedIn && (
            <button
              type="button"
              className="btn btn-primary btn-sm btn-signin-header"
              onClick={() => setIsLoginCardOpen((prev) => !prev)}
            >
              <Zap size={14} />
              <span>Admin Login</span>
            </button>
          )}
        </div>
      </header>

      {/* ─── MAIN CONTENT ─── */}
      <main className="dashboard-main">
        {/* Optional Collapsible Login Form */}
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

        {/* ─── 2. INTERACTIVE WEBHOOK DISPATCHER STUDIO ─── */}
        <WebhookDispatcher
          showToast={showToast}
          soundEnabled={soundEnabled}
        />

        {/* ─── 3. METRICS & TELEMETRY HUD ROW ─── */}
        <section className="stats-row" aria-label="Event statistics telemetry">
          {/* Total In View */}
          <div className="stat-card stat-card-total">
            <div className="stat-card-glow" />
            <div className="stat-card-header">
              <span className="stat-label">Total Ingested</span>
              <div className="stat-icon-wrap icon-indigo">
                <Activity size={15} />
              </div>
            </div>
            <div className="stat-value-group">
              <span className="stat-value tabular-nums font-mono">{totalEvents}</span>
              <span className="stat-sublabel">active stream buffer</span>
            </div>
            <div className="stat-spark-bar">
              <div
                className="stat-spark-fill fill-indigo"
                style={{ width: `${Math.min(100, (totalEvents / 100) * 100)}%` }}
              />
            </div>
          </div>

          {/* Completed */}
          <div className="stat-card stat-card-completed">
            <div className="stat-card-glow" />
            <div className="stat-card-header">
              <span className="stat-label">Delivered Downstream</span>
              <div className="stat-icon-wrap icon-emerald">
                <CheckCircle2 size={15} />
              </div>
            </div>
            <div className="stat-value-group">
              <span className="stat-value text-success tabular-nums font-mono">{completedCount}</span>
              <span className="stat-sublabel">200 OK acknowledged</span>
            </div>
            <div className="stat-spark-bar">
              <div
                className="stat-spark-fill fill-emerald"
                style={{ width: `${totalEvents > 0 ? (completedCount / totalEvents) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Failed */}
          <div className="stat-card stat-card-failed">
            <div className="stat-card-glow" />
            <div className="stat-card-header">
              <span className="stat-label">Failed / Retries Exhausted</span>
              <div className="stat-icon-wrap icon-rose">
                <AlertTriangle size={15} />
              </div>
            </div>
            <div className="stat-value-group">
              <span className="stat-value text-danger tabular-nums font-mono">{failedCount}</span>
              <span className="stat-sublabel">requires triage</span>
            </div>
            <div className="stat-spark-bar">
              <div
                className="stat-spark-fill fill-rose"
                style={{ width: `${totalEvents > 0 ? (failedCount / totalEvents) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Received / In-Flight */}
          <div className="stat-card stat-card-received">
            <div className="stat-card-glow" />
            <div className="stat-card-header">
              <span className="stat-label">In Processing</span>
              <div className="stat-icon-wrap icon-amber">
                <Clock size={15} />
              </div>
            </div>
            <div className="stat-value-group">
              <span className="stat-value text-received tabular-nums font-mono">{receivedCount}</span>
              <span className="stat-sublabel">queued or retrying</span>
            </div>
            <div className="stat-spark-bar">
              <div
                className="stat-spark-fill fill-amber"
                style={{ width: `${totalEvents > 0 ? (receivedCount / totalEvents) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Success Rate */}
          <div className="stat-card stat-card-rate">
            <div className="stat-card-glow" />
            <div className="stat-card-header">
              <span className="stat-label">Pipeline Reliability</span>
              <div className="stat-icon-wrap icon-cyan">
                <TrendingUp size={15} />
              </div>
            </div>
            <div className="stat-value-group">
              <span className="stat-value text-cyan tabular-nums font-mono">{successRateNum}%</span>
              <span className="stat-sublabel">delivery rate</span>
            </div>
            <div className="stat-spark-bar">
              <div
                className="stat-spark-fill fill-cyan"
                style={{ width: `${totalEvents > 0 ? successRateNum : 100}%` }}
              />
            </div>
          </div>
        </section>

        {/* ─── 4. TOOLBAR & FILTER CONTROLS ─── */}
        <section className="toolbar-section">
          {/* Status Filter Chips */}
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
                onClick={() => {
                  setStatusFilter(chip.label);
                  sound.playTap(soundEnabled);
                }}
              >
                <span>{chip.label}</span>
                <span className="chip-count tabular-nums font-mono">{chip.count}</span>
              </button>
            ))}
          </div>

          <div className="toolbar-right-actions">
            {/* Live Search Input */}
            <div className="search-box">
              <Search size={15} className="search-icon" aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="text"
                className="search-input font-mono"
                placeholder="Search event ID or UUID... (Press / to focus)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Filter events by UUID"
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              ) : (
                <span className="search-kbd-hint font-mono">/</span>
              )}
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              className="btn btn-secondary btn-icon-only"
              onClick={() => fetchEvents(true)}
              title="Refresh events from server"
              disabled={isRefreshing}
            >
              <RotateCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
            </button>

            {/* Export Dropdown / Buttons */}
            {events.length > 0 && (
              <div className="export-btn-group">
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={exportEventsJson}
                  title="Export events as JSON"
                >
                  <FileJson size={13} />
                  <span>JSON</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={exportEventsCsv}
                  title="Export events as CSV"
                >
                  <FileSpreadsheet size={13} />
                  <span>CSV</span>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ─── SERVER ERROR BANNER ─── */}
        {eventsError && (
          <div className="banner banner-error animate-fade-in" role="alert">
            <div className="banner-content">
              <AlertTriangle size={18} className="flex-shrink-0" />
              <span>{eventsError}</span>
            </div>
            <button
              type="button"
              onClick={() => fetchEvents(true)}
              className="btn btn-secondary btn-xs"
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* ─── 5. EVENTS TABLE ─── */}
        <section className="table-section">
          <EventTable
            events={displayedEvents}
            selectedEventId={selectedEventId}
            onSelectEvent={handleSelectEvent}
            isLoggedIn={isLoggedIn}
            recentlyChangedId={recentlyChangedId}
            isLoading={isLoadingEvents}
            showToast={showToast}
            soundEnabled={soundEnabled}
          />
        </section>
      </main>

      {/* ─── 6. SLIDE-OVER EVENT DETAILS DRAWER ─── */}
      {selectedEventId && (
        <EventDetails
          eventDetails={selectedEventDetails}
          isLoading={isLoadingDetails}
          errorMessage={detailsError}
          onClose={handleCloseDetails}
          isLoggedIn={isLoggedIn}
          onSignedOut={handleSignedOut}
          showToast={showToast}
          soundEnabled={soundEnabled}
        />
      )}

      {/* ─── 7. DASHBOARD FOOTER ─── */}
      <footer className="dashboard-footer">
        <div className="footer-content">
          <div className="footer-left">
            <span className="footer-dot" />
            <span>EventBridge Stream Engine • Enterprise Webhook Telemetry</span>
          </div>
          <div className="footer-right font-mono text-xs">
            <span>Supabase Ingestion • SSE Monotonic Stream</span>
          </div>
        </div>
      </footer>

      {/* ─── 8. FLOATING TOAST NOTIFICATIONS ─── */}
      <div
        className="toast-container"
        aria-live="polite"
        role="region"
        aria-label="System notifications"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast-item toast-${toast.kind || 'info'} animate-slide-up`}
            role="status"
          >
            <div className="toast-icon-wrap" aria-hidden="true">
              {toast.kind === 'success' ? (
                <CheckCircle2 size={16} className="text-emerald-400" />
              ) : toast.kind === 'error' ? (
                <AlertTriangle size={16} className="text-rose-400" />
              ) : toast.kind === 'warning' ? (
                <AlertTriangle size={16} className="text-amber-400" />
              ) : (
                <Sparkles size={16} className="text-indigo-400" />
              )}
            </div>
            <span className="toast-text">{toast.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
