import { useState, useEffect, useRef } from 'react';
import {
  X,
  Copy,
  Check,
  RotateCw,
  AlertOctagon,
  Clock,
  CheckCircle2,
  XCircle,
  Hash,
  Layers,
  FileJson
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { sound } from '../utils/sound';

export default function EventDetails({
  eventDetails,
  isLoading,
  errorMessage,
  onClose,
  isLoggedIn,
  onSignedOut,
  showToast,
  soundEnabled
}) {
  const [retrying, setRetrying] = useState(false);
  const [claimedEventId, setClaimedEventId] = useState(null);
  const isRetryingRef = useRef(false);

  const retryTriggered = Boolean(eventDetails?.id && claimedEventId === eventDetails.id);

  const [copiedPayload, setCopiedPayload] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [activeTab, setActiveTab] = useState('payload'); // 'payload' | 'metadata'

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function handleRetry() {
    // SYNCHRONOUS DOUBLE-CLICK GUARD:
    // React state updates (setRetrying) are batched and asynchronous.
    // If a user clicks twice within ~100ms, the second click enters before React re-renders
    // with disabled=true. Checking isRetryingRef.current synchronously blocks the second click immediately.
    if (!eventDetails || !eventDetails.id || isRetryingRef.current || retrying || retryTriggered) {
      return;
    }
    isRetryingRef.current = true;
    setRetrying(true);

    try {
      const response = await fetch('/api/events/' + eventDetails.id + '/retry', {
        method: 'POST',
        credentials: 'include'
      });

      if (response.status === 202) {
        setClaimedEventId(eventDetails.id); // Optimistically lock retry for this event
        sound.playSuccess(soundEnabled);
        confetti({
          particleCount: 30,
          spread: 45,
          origin: { x: 0.85, y: 0.85 },
          colors: ['#6366f1', '#10b981', '#38bdf8']
        });
        showToast?.('Retry pipeline triggered', 'success');
      } else if (response.status === 409) {
        setClaimedEventId(eventDetails.id);
        showToast?.('Event is already being retried or has completed', 'warning');
      } else if (response.status === 401) {
        showToast?.('Session expired. Please sign in again.', 'error');
        onSignedOut?.();
      } else {
        showToast?.('Could not retry. Please try again.', 'error');
      }
    } catch (err) {
      console.error('Error requesting retry:', err);
      showToast?.('Network error triggering retry', 'error');
      isRetryingRef.current = false;
    } finally {
      setRetrying(false);
    }
  }

  async function handleCopyPayload() {
    if (!eventDetails?.payload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(eventDetails.payload, null, 2));
      setCopiedPayload(true);
      sound.playTap(soundEnabled);
      showToast?.('Copied formatted JSON payload', 'info');
      setTimeout(() => setCopiedPayload(false), 2000);
    } catch (err) {
      console.error('Copy payload failed:', err);
    }
  }

  async function handleCopyId() {
    if (!eventDetails?.id) return;
    try {
      await navigator.clipboard.writeText(eventDetails.id);
      setCopiedId(true);
      sound.playTap(soundEnabled);
      showToast?.('Copied Event UUID', 'info');
      setTimeout(() => setCopiedId(false), 2000);
    } catch (err) {
      console.error('Copy ID failed:', err);
    }
  }

  async function handleCopyKey() {
    if (!eventDetails?.idempotency_key) return;
    try {
      await navigator.clipboard.writeText(eventDetails.idempotency_key);
      setCopiedKey(true);
      sound.playTap(soundEnabled);
      showToast?.('Copied Idempotency Key', 'info');
      setTimeout(() => setCopiedKey(false), 2000);
    } catch (err) {
      console.error('Copy key failed:', err);
    }
  }

  function renderStatusBadge(status) {
    if (status === 'Completed') {
      return (
        <span className="badge badge-completed">
          <span className="badge-dot badge-dot-emerald" aria-hidden="true" />
          <CheckCircle2 size={13} className="badge-icon" />
          <span>Completed</span>
        </span>
      );
    }
    if (status === 'Failed') {
      return (
        <span className="badge badge-failed">
          <span className="badge-dot badge-dot-rose" aria-hidden="true" />
          <XCircle size={13} className="badge-icon" />
          <span>Failed</span>
        </span>
      );
    }
    return (
      <span className="badge badge-received">
        <span className="badge-dot badge-dot-amber" aria-hidden="true" />
        <Clock size={13} className="badge-icon badge-spin-slow" />
        <span>Received</span>
      </span>
    );
  }

  return (
    <div
      className="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Event Payload Inspector Drawer"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <aside className="drawer-panel animate-slide-in">
        {/* Drawer Header */}
        <div className="drawer-header">
          <div className="drawer-header-info">
            <div className="drawer-label-row">
              <span className="drawer-pill-tag">
                <FileJson size={12} className="inline mr-1 text-indigo-400" />
                Payload Inspector
              </span>
            </div>

            <button
              type="button"
              className="drawer-id-button font-mono"
              onClick={handleCopyId}
              title="Click to copy full Event UUID"
            >
              <span>{eventDetails?.id || 'Loading event...'}</span>
              {copiedId ? (
                <Check size={13} className="text-emerald-400" />
              ) : (
                <Copy size={13} className="text-secondary" />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn-icon drawer-close-btn"
            title="Close inspector (Escape)"
            aria-label="Close event details"
          >
            <X size={18} />
          </button>
        </div>

        {/* Segmented Tab Bar */}
        <div className="drawer-tabs-bar">
          <button
            type="button"
            className={`drawer-tab ${activeTab === 'payload' ? 'active' : ''}`}
            onClick={() => setActiveTab('payload')}
          >
            <FileJson size={14} />
            <span>Payload JSON</span>
          </button>
          <button
            type="button"
            className={`drawer-tab ${activeTab === 'metadata' ? 'active' : ''}`}
            onClick={() => setActiveTab('metadata')}
          >
            <Layers size={14} />
            <span>Delivery Telemetry</span>
          </button>
        </div>

        {/* Drawer Body */}
        <div className="drawer-body">
          {isLoading ? (
            <div className="drawer-loading">
              <div className="spinner-lg" aria-hidden="true" />
              <p className="loading-text">Decryption & streaming payload...</p>
            </div>
          ) : errorMessage ? (
            <div className="banner banner-error" role="alert">
              <AlertOctagon size={18} className="flex-shrink-0" />
              <div>
                <p className="font-semibold">Unable to inspect event</p>
                <p className="text-xs text-muted">{errorMessage}</p>
              </div>
            </div>
          ) : eventDetails ? (
            <>
              {/* Status Overview Card */}
              <div className="drawer-summary-card">
                <div className="summary-col">
                  <span className="summary-label">Status</span>
                  <div className="summary-value">
                    {renderStatusBadge(eventDetails.status)}
                  </div>
                </div>

                <div className="summary-col">
                  <span className="summary-label">Delivery Attempts</span>
                  <span className="summary-value font-mono tabular-nums">
                    {eventDetails.attempt_count ?? 1}
                  </span>
                </div>

                <div className="summary-col">
                  <span className="summary-label">Created</span>
                  <span className="summary-value tabular-nums text-xs">
                    {eventDetails.created_at
                      ? new Date(eventDetails.created_at).toLocaleTimeString()
                      : '-'}
                  </span>
                </div>
              </div>

              {/* Failure Alert Box (if present) */}
              {eventDetails.failure_reason && (
                <div className="failure-alert animate-fade-in" role="alert">
                  <div className="failure-alert-header">
                    <AlertOctagon size={16} className="text-rose-400" />
                    <strong>Downstream Delivery Failure</strong>
                  </div>
                  <p className="failure-alert-text font-mono">{eventDetails.failure_reason}</p>
                  <p className="failure-alert-suggestion">
                    The mock or real downstream server rejected or timed out on this webhook. You
                    can trigger an immediate retry below or toggle mock downstream status in Admin.
                  </p>
                </div>
              )}

              {/* TAB 1: PAYLOAD JSON */}
              {activeTab === 'payload' && (
                <div className="payload-section animate-fade-in">
                  <div className="payload-header">
                    <span className="payload-title">Raw Ingested Body</span>
                    <button
                      type="button"
                      onClick={handleCopyPayload}
                      className="btn btn-secondary btn-xs"
                      title="Copy payload to clipboard"
                    >
                      {copiedPayload ? (
                        <Check size={12} className="text-emerald-400" />
                      ) : (
                        <Copy size={12} />
                      )}
                      <span>{copiedPayload ? 'Copied JSON' : 'Copy JSON'}</span>
                    </button>
                  </div>

                  <pre className="payload-code font-mono">
                    {JSON.stringify(eventDetails.payload, null, 2)}
                  </pre>
                </div>
              )}

              {/* TAB 2: METADATA & TELEMETRY */}
              {activeTab === 'metadata' && (
                <div className="metadata-section animate-fade-in">
                  <div className="meta-card">
                    <div className="meta-card-header">
                      <Hash size={14} className="text-indigo-400" />
                      <span className="meta-card-title">Idempotency Signature</span>
                    </div>
                    <div className="meta-key-wrap">
                      <code className="meta-key-code font-mono">
                        {eventDetails.idempotency_key}
                      </code>
                      <button
                        type="button"
                        className="btn-icon btn-copy-key"
                        onClick={handleCopyKey}
                        title="Copy idempotency key"
                      >
                        {copiedKey ? (
                          <Check size={13} className="text-emerald-400" />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                    </div>
                    <p className="meta-card-hint">
                      Guarantees exactly-once ingestion. Duplicate requests with this key update the
                      existing record without spawning duplicate downstream deliveries.
                    </p>
                  </div>

                  <div className="meta-details-list">
                    <div className="meta-detail-row">
                      <span className="meta-detail-label">Exact ISO Timestamp</span>
                      <span className="meta-detail-value font-mono text-xs tabular-nums">
                        {eventDetails.created_at || '-'}
                      </span>
                    </div>

                    <div className="meta-detail-row">
                      <span className="meta-detail-label">Last State Update</span>
                      <span className="meta-detail-value font-mono text-xs tabular-nums">
                        {eventDetails.updated_at || '-'}
                      </span>
                    </div>

                    <div className="meta-detail-row">
                      <span className="meta-detail-label">Retry Eligible</span>
                      <span className="meta-detail-value">
                        {eventDetails.status === 'Failed' ? (
                          <span className="text-emerald-400 font-semibold">Yes (Admin Action)</span>
                        ) : (
                          <span className="text-muted">No (Terminal / Completed)</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Drawer Footer */}
        {eventDetails && (
          <div className="drawer-footer">
            {isLoggedIn && eventDetails.status === 'Failed' && (
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying || retryTriggered}
                className="btn btn-primary btn-retry-glowing"
              >
                <RotateCw size={14} className={retrying ? 'animate-spin' : ''} />
                <span>
                  {retrying
                    ? 'Triggering Retry...'
                    : retryTriggered
                    ? 'Retry Claimed (In-Flight)'
                    : 'Retry Webhook Delivery'}
                </span>
              </button>
            )}

            <button type="button" onClick={onClose} className="btn btn-secondary">
              Close Inspector
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
