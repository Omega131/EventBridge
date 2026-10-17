import { useState, useEffect, useRef } from 'react';
import {
  Shield,
  ChevronDown,
  Activity,
  Trash2,
  LogOut,
  Power
} from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import { sound } from '../utils/sound';

export default function AdminPanel({
  isLoggedIn,
  mockHealthy,
  showToast,
  onSignedOut,
  onLogout,
  soundEnabled
}) {
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const [isTogglingMock, setIsTogglingMock] = useState(false);
  const [isClearingEvents, setIsClearingEvents] = useState(false);
  const [isSigningOutEverywhere, setIsSigningOutEverywhere] = useState(false);

  const isTogglingRef = useRef(false);
  const isClearingRef = useRef(false);
  const isSigningOutRef = useRef(false);

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

  // Signed-out visitor view: Read-only badge
  if (!isLoggedIn) {
    return (
      <div
        className="status-pill status-pill-downstream"
        title="Current downstream receiver simulation status"
      >
        <span
          className={`status-dot ${mockHealthy ? 'status-dot-green' : 'status-dot-red'}`}
          aria-hidden="true"
        />
        <span>
          Downstream: <strong className={mockHealthy ? 'text-emerald-400' : 'text-rose-400'}>{mockHealthy ? 'Healthy' : 'Outage'}</strong>
        </span>
      </div>
    );
  }

  // Toggle mock downstream mode
  async function handleToggleMock() {
    if (isTogglingRef.current || isTogglingMock) return;
    isTogglingRef.current = true;
    setIsTogglingMock(true);
    sound.playTap(soundEnabled);

    try {
      const response = await fetch('/api/mock/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ healthy: !mockHealthy })
      });

      if (response.status === 401) {
        showToast?.('Session expired. Please sign in again.', 'error');
        onSignedOut?.();
        return;
      }

      if (!response.ok) {
        throw new Error('Server returned ' + response.status);
      }
      showToast?.(
        !mockHealthy ? 'Downstream restored to Healthy' : 'Simulating Downstream Outage',
        !mockHealthy ? 'success' : 'warning'
      );
    } catch (err) {
      console.error('Failed to toggle mock downstream:', err);
      showToast?.('Could not change downstream mode. Check backend server.', 'error');
    } finally {
      isTogglingRef.current = false;
      setIsTogglingMock(false);
    }
  }

  // Clear all events
  async function handleClearEventsConfirm() {
    if (isClearingRef.current || isClearingEvents) return;
    isClearingRef.current = true;
    setIsClearingEvents(true);

    try {
      const response = await fetch('/api/admin/clear-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ confirm: 'DELETE ALL' })
      });

      if (response.status === 401) {
        showToast?.('Session expired. Please sign in again.', 'error');
        setIsConfirmModalOpen(false);
        onSignedOut?.();
        return;
      }

      if (!response.ok) {
        throw new Error('Server returned ' + response.status);
      }

      const data = await response.json();
      setIsConfirmModalOpen(false);
      setIsDropdownOpen(false);
      sound.playSuccess(soundEnabled);
      showToast?.(`Cleared ${data.deleted} event(s) from database`, 'success');
    } catch (err) {
      console.error('Error clearing events:', err);
      showToast?.('Could not clear events. Please try again.', 'error');
    } finally {
      isClearingRef.current = false;
      setIsClearingEvents(false);
    }
  }

  // Sign out everywhere
  async function handleSignOutEverywhere() {
    if (isSigningOutRef.current || isSigningOutEverywhere) return;
    isSigningOutRef.current = true;
    setIsSigningOutEverywhere(true);
    try {
      await fetch('/api/admin/sign-out-everywhere', {
        method: 'POST',
        credentials: 'include'
      });
      showToast?.('Signed out of all devices and active sessions.', 'info');
    } catch (err) {
      console.error('Sign out everywhere failed:', err);
      showToast?.('Could not sign out everywhere. Check connection.', 'error');
    } finally {
      isSigningOutRef.current = false;
      setIsSigningOutEverywhere(false);
      setIsDropdownOpen(false);
      onSignedOut?.();
    }
  }

  return (
    <div className="admin-menu-container" ref={dropdownRef}>
      {/* Downstream Mock Interactive Switch Pill */}
      <button
        type="button"
        className="status-pill status-pill-interactive"
        onClick={handleToggleMock}
        disabled={isTogglingMock}
        title="Click to toggle downstream failure simulation"
        aria-label={`Mock downstream is ${mockHealthy ? 'Healthy' : 'Down'}. Click to toggle.`}
      >
        <span
          className={`status-dot ${mockHealthy ? 'status-dot-green' : 'status-dot-red'}`}
          aria-hidden="true"
        />
        <span>
          Downstream: <strong className={mockHealthy ? 'text-emerald-400' : 'text-rose-400'}>{mockHealthy ? 'Healthy' : 'Outage'}</strong>
        </span>
      </button>

      {/* Admin Menu Trigger */}
      <button
        type="button"
        className={`btn btn-secondary btn-admin-trigger ${isDropdownOpen ? 'active' : ''}`}
        onClick={() => {
          setIsDropdownOpen((prev) => !prev);
          sound.playTap(soundEnabled);
        }}
        aria-expanded={isDropdownOpen}
        aria-haspopup="true"
        aria-label="Admin settings and actions menu"
      >
        <Shield size={14} className="text-indigo-400" />
        <span className="font-semibold">Admin</span>
        <ChevronDown size={14} className={`chevron-icon ${isDropdownOpen ? 'chevron-open' : ''}`} />
      </button>

      {/* Floating Glass Dropdown Menu */}
      {isDropdownOpen && (
        <div className="admin-dropdown-menu animate-pop-in" role="menu">
          <div className="dropdown-section-title">Downstream Simulation</div>

          {/* Toggle mock mode */}
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={handleToggleMock}
            disabled={isTogglingMock}
          >
            <div className="dropdown-item-icon">
              <Activity size={16} className={mockHealthy ? 'text-emerald-400' : 'text-rose-400'} />
            </div>
            <div className="dropdown-item-content">
              <span className="dropdown-item-label">
                Mock Downstream: <strong>{mockHealthy ? 'Healthy' : 'Outage'}</strong>
              </span>
              <span className="dropdown-item-desc">
                {mockHealthy
                  ? 'Simulate 503 service outage to test retry backoff'
                  : 'Restore 200 OK delivery responses'}
              </span>
            </div>
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
            <div className="dropdown-item-icon text-rose-400">
              <Trash2 size={16} />
            </div>
            <div className="dropdown-item-content">
              <span className="dropdown-item-label text-danger">Clear All Events</span>
              <span className="dropdown-item-desc">Permanently empty the events database table</span>
            </div>
          </button>

          <div className="dropdown-divider" />
          <div className="dropdown-section-title">Session Security</div>

          {/* Sign out everywhere */}
          <button
            type="button"
            className="dropdown-item"
            role="menuitem"
            onClick={handleSignOutEverywhere}
            disabled={isSigningOutEverywhere}
          >
            <div className="dropdown-item-icon text-amber-400">
              <Power size={16} />
            </div>
            <div className="dropdown-item-content">
              <span className="dropdown-item-label">
                {isSigningOutEverywhere ? 'Revoking sessions...' : 'Sign Out Everywhere'}
              </span>
              <span className="dropdown-item-desc">Invalidate all sessions across all browsers</span>
            </div>
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
              <div className="dropdown-item-icon">
                <LogOut size={16} />
              </div>
              <div className="dropdown-item-content">
                <span className="dropdown-item-label">Sign Out</span>
              </div>
            </button>
          )}
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={handleClearEventsConfirm}
        isLoading={isClearingEvents}
      />
    </div>
  );
}
