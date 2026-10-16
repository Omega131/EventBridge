import { useState } from 'react';
import ConfirmModal from './ConfirmModal';

// WHAT: AdminPanel component providing administrative controls.
// WHY: Signed-in admins can toggle downstream mock mode, clear all events, and invalidate all sessions.
// Signed-out visitors see only a read-only indicator of downstream health.
function AdminPanel({ isLoggedIn, mockHealthy, showToast, onSignedOut }) {
  // WHAT: State to control opening and closing the ConfirmModal.
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

  // WHAT: Loading states for in-flight administrative requests.
  const [isTogglingMock, setIsTogglingMock] = useState(false);
  const [isClearingEvents, setIsClearingEvents] = useState(false);
  const [isSigningOutEverywhere, setIsSigningOutEverywhere] = useState(false);

  // ─── 1. SIGNED-OUT VISITOR VIEW ──────────────────────────────────────────
  // WHAT: Signed-out visitors see only a read-only label indicating downstream health.
  if (!isLoggedIn) {
    return (
      <div className="admin-panel admin-panel-public" style={{ display: 'inline-flex', alignItems: 'center', margin: '8px 0' }}>
        <span className="downstream-label">
          Downstream: <strong>{mockHealthy ? 'Healthy' : 'Down'}</strong>
        </span>
      </div>
    );
  }

  // ─── 2. TOGGLE MOCK DOWNSTREAM MODE ──────────────────────────────────────
  // WHAT: Send POST /api/mock/mode with the inverted healthy value.
  // WHY: Allows the admin to simulate downstream outages.
  // RULE: "Do not flip it locally; the 'mock-status' stream message updates it. Show a toast on failure."
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
  // WHAT: Send POST /api/admin/clear-events with {"confirm": "DELETE ALL"}.
  // WHY: Resets the events table in Supabase.
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
      showToast(`Cleared ${data.deleted} event(s) from database`, 'success');

    } catch (err) {
      console.error('AdminPanel: Error clearing events:', err.message);
      showToast('Could not clear events. Please try again.', 'error');
    } finally {
      setIsClearingEvents(false);
    }
  }

  // ─── 4. SIGN OUT EVERYWHERE ──────────────────────────────────────────────
  // WHAT: Send POST /api/admin/sign-out-everywhere.
  // WHY: Increments database auth_version, revoking all existing admin tokens across all devices.
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
      // In all cases, set loggedIn to false locally
      if (onSignedOut) {
        onSignedOut();
      }
    }
  }

  // ─── 5. SIGNED-IN ADMIN VIEW ─────────────────────────────────────────────
  return (
    <div className="admin-panel admin-panel-active" style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '12px 0' }}>
      <div className="admin-controls-group" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        {/* Mock Downstream Toggle */}
        <button
          type="button"
          onClick={handleToggleMock}
          disabled={isTogglingMock}
          className={`btn ${mockHealthy ? 'btn-mock-healthy' : 'btn-mock-down'}`}
          title="Toggle mock downstream between Healthy and Down"
        >
          Mock downstream: {mockHealthy ? 'Healthy' : 'Down'}
        </button>

        {/* Clear all events */}
        <button
          type="button"
          onClick={() => setIsConfirmModalOpen(true)}
          disabled={isClearingEvents}
          className="btn btn-warning"
          title="Permanently delete all events from the database"
        >
          Clear all events
        </button>

        {/* Sign out everywhere */}
        <button
          type="button"
          onClick={handleSignOutEverywhere}
          disabled={isSigningOutEverywhere}
          className="btn btn-secondary"
          title="Invalidate all active sessions across all devices"
        >
          {isSigningOutEverywhere ? 'Signing out...' : 'Sign out everywhere'}
        </button>
      </div>

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
