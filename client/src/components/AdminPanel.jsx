import { useState, useEffect, useRef } from 'react';
import ConfirmModal from './ConfirmModal';

// WHAT: AdminPanel component providing administrative controls.
// WHY: Signed-in admins access controls via a clean dropdown menu (mock toggle, clear events, sign out everywhere).
// Signed-out visitors see only a read-only indicator of downstream health.
function AdminPanel({ isLoggedIn, mockHealthy, showToast, onSignedOut, onLogout }) {
  // WHAT: State to control opening and closing the ConfirmModal.
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

  // WHAT: State to control opening and closing the Admin Dropdown menu.
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // WHAT: Loading states for in-flight administrative requests.
  const [isTogglingMock, setIsTogglingMock] = useState(false);
  const [isClearingEvents, setIsClearingEvents] = useState(false);
  const [isSigningOutEverywhere, setIsSigningOutEverywhere] = useState(false);

  // WHAT: Close dropdown on click outside or Escape key.
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsDropdownOpen(false);
      }
    }

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDropdownOpen]);

  // ─── 1. SIGNED-OUT VISITOR VIEW ──────────────────────────────────────────
  // WHAT: Signed-out visitors see only a read-only label indicating downstream health.
  if (!isLoggedIn) {
    return (
      <div className="status-pill status-pill-downstream" title="Mock Downstream Status">
        <span
          className={`status-dot ${mockHealthy ? 'status-dot-green' : 'status-dot-red'}`}
          aria-hidden="true"
        />
        <span>
          Downstream: <strong>{mockHealthy ? 'Healthy' : 'Down'}</strong>
        </span>
      </div>
    );
  }

  // ─── 2. TOGGLE MOCK DOWNSTREAM MODE ──────────────────────────────────────
  async function handleToggleMock() {
    console.log('AdminPanel: Toggling mock downstream mode from', mockHealthy, 'to', !mockHealthy);
    setIsTogglingMock(true);

    try {
      const response = await fetch('/api/mock/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ healthy: !mockHealthy })
      });

      console.log('AdminPanel: Mock mode toggle response status:', response.status);

      if (response.status === 401) {
        console.warn('AdminPanel: Unauthorized (401) while toggling mock mode.');
        showToast('Session expired. Please sign in again.', 'error');
        if (onSignedOut) {
          onSignedOut();
        }
        return;
      }

      if (!response.ok) {
        throw new Error('Server returned status ' + response.status);
      }

      // NOTE: We do not flip mockHealthy locally. The backend broadcasts "mock-status"
      // over SSE which updates the state for all open windows simultaneously.

    } catch (err) {
      console.error('AdminPanel: Failed to toggle mock mode:', err.message);
      showToast('Could not change mock mode. Please try again.', 'error');
    } finally {
      setIsTogglingMock(false);
    }
  }

  // ─── 3. CLEAR ALL EVENTS ─────────────────────────────────────────────────
  async function handleClearEventsConfirm() {
    console.log('AdminPanel: Executing clear-events...');
    setIsClearingEvents(true);

    try {
      const response = await fetch('/api/admin/clear-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ confirm: 'DELETE ALL' })
      });

      console.log('AdminPanel: Clear events response status:', response.status);

      if (response.status === 401) {
        console.warn('AdminPanel: Unauthorized (401) while clearing events.');
        showToast('Session expired. Please sign in again.', 'error');
        setIsConfirmModalOpen(false);
        if (onSignedOut) {
          onSignedOut();
        }
        return;
      }

      if (!response.ok) {
        throw new Error('Server returned status ' + response.status);
      }

      const data = await response.json();
      console.log('AdminPanel: Clear events succeeded. Deleted count:', data.deleted);

      // Close modal and notify via toast
      setIsConfirmModalOpen(false);
      setIsDropdownOpen(false);
      showToast(`Cleared ${data.deleted} event(s) from database`, 'success');

    } catch (err) {
      console.error('AdminPanel: Error clearing events:', err.message);
      showToast('Could not clear events. Please try again.', 'error');
    } finally {
      setIsClearingEvents(false);
    }
  }

  // ─── 4. SIGN OUT EVERYWHERE ──────────────────────────────────────────────
  async function handleSignOutEverywhere() {
    console.log('AdminPanel: Triggering sign out everywhere...');
    setIsSigningOutEverywhere(true);

    try {
      const response = await fetch('/api/admin/sign-out-everywhere', {
        method: 'POST',
        credentials: 'include'
      });

      console.log('AdminPanel: Sign out everywhere status:', response.status);

      if (response.status === 401) {
        console.warn('AdminPanel: Already signed out or expired.');
      }

      showToast('Signed out of all devices and sessions.', 'info');

    } catch (err) {
      console.error('AdminPanel: Error during sign out everywhere:', err.message);
      showToast('Could not sign out everywhere. Please check your connection.', 'error');
    } finally {
      setIsSigningOutEverywhere(false);
      setIsDropdownOpen(false);
      if (onSignedOut) {
        onSignedOut();
      }
    }
  }

  // ─── 5. SIGNED-IN ADMIN VIEW (DROPDOWN MENU) ─────────────────────────────
  return (
    <div className="admin-menu-container" ref={dropdownRef}>
      {/* Downstream Mock Pill in Header */}
      <button
        type="button"
        className="status-pill status-pill-interactive"
        onClick={handleToggleMock}
        disabled={isTogglingMock}
        title="Click to toggle downstream mock mode"
        aria-label={`Mock downstream is currently ${mockHealthy ? 'Healthy' : 'Down'}. Click to toggle.`}
      >
        <span
          className={`status-dot ${mockHealthy ? 'status-dot-green' : 'status-dot-red'}`}
          aria-hidden="true"
        />
        <span>Mock: <strong>{mockHealthy ? 'Healthy' : 'Down'}</strong></span>
      </button>

      {/* Admin Menu Trigger Button */}
      <button
        type="button"
        className={`btn btn-secondary btn-admin-trigger ${isDropdownOpen ? 'active' : ''}`}
        onClick={() => setIsDropdownOpen((prev) => !prev)}
        aria-expanded={isDropdownOpen}
        aria-haspopup="true"
        aria-label="Admin settings and actions menu"
      >
        {/* User Shield Icon */}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <span>Admin</span>
        {/* Chevron Icon */}
        <svg
          className={`chevron-icon ${isDropdownOpen ? 'chevron-open' : ''}`}
          width="13"
          height="13"
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
      </button>

      {/* Floating Dropdown Menu */}
      {isDropdownOpen && (
        <div className="admin-dropdown-menu" role="menu">
          <div className="dropdown-section-title">Downstream Simulation</div>

          {/* Toggle mock mode */}
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={handleToggleMock}
            disabled={isTogglingMock}
          >
            <div className="dropdown-item-content">
              <span className="dropdown-item-label">
                Mock Downstream: <strong>{mockHealthy ? 'Healthy' : 'Down'}</strong>
              </span>
              <span className="dropdown-item-desc">
                {mockHealthy ? 'Click to simulate downstream failure' : 'Click to restore downstream health'}
              </span>
            </div>
            <span className={`status-dot ${mockHealthy ? 'status-dot-green' : 'status-dot-red'}`} />
          </button>

          <div className="dropdown-divider" />
          <div className="dropdown-section-title">Database Administration</div>

          {/* Clear all events */}
          <button
            type="button"
            className="dropdown-item dropdown-item-danger"
            role="menuitem"
            onClick={() => {
              setIsDropdownOpen(false);
              setIsConfirmModalOpen(true);
            }}
            disabled={isClearingEvents}
          >
            <div className="dropdown-item-content">
              <span className="dropdown-item-label">Clear All Events</span>
              <span className="dropdown-item-desc">Permanently empty the events table</span>
            </div>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>

          <div className="dropdown-divider" />
          <div className="dropdown-section-title">Session Management</div>

          {/* Sign out everywhere */}
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={handleSignOutEverywhere}
            disabled={isSigningOutEverywhere}
          >
            <div className="dropdown-item-content">
              <span className="dropdown-item-label">
                {isSigningOutEverywhere ? 'Revoking sessions...' : 'Sign Out Everywhere'}
              </span>
              <span className="dropdown-item-desc">Invalidate all sessions across all devices</span>
            </div>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
              <line x1="12" y1="2" x2="12" y2="12" />
            </svg>
          </button>

          {/* Regular Sign out */}
          {onLogout && (
            <button
              type="button"
              className="dropdown-item text-muted"
              role="menuitem"
              onClick={() => {
                setIsDropdownOpen(false);
                onLogout();
              }}
            >
              <div className="dropdown-item-content">
                <span className="dropdown-item-label">Sign Out</span>
              </div>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Confirmation Modal for Clearing Events */}
      <ConfirmModal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={handleClearEventsConfirm}
        isLoading={isClearingEvents}
      />
    </div>
  );
}

export default AdminPanel;
