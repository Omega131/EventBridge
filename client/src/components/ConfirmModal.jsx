import { useState, useEffect, useRef } from 'react';

// WHAT: ConfirmModal component for destructive admin actions (clearing all events).
// WHY: Deleting all events is irreversible. Requiring the admin to explicitly type
// "DELETE ALL" prevents accidental clicks. Focus moves into the modal on open, and
// the Escape key closes it.
function ConfirmModal({ isOpen, onClose, onConfirm, isLoading }) {
  // WHAT: Local state to track the text typed into the confirmation box.
  // WHY: The confirm button remains strictly disabled until this text matches "DELETE ALL" exactly.
  const [confirmText, setConfirmText] = useState('');
  const inputRef = useRef(null);

  // WHAT: Reset confirmation text and auto-focus input whenever the modal opens.
  useEffect(() => {
    if (isOpen) {
      setConfirmText('');
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 50);
    }
  }, [isOpen]);

  // WHAT: Listen for Escape key press to cancel and close the modal.
  // WHY: Standard accessible dialog behavior.
  useEffect(() => {
    function handleKeyDown(e) {
      if (isOpen && e.key === 'Escape' && !isLoading) {
        console.log('ConfirmModal: Closed via Escape key.');
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  // If the modal is not open, render nothing
  if (!isOpen) {
    return null;
  }

  // WHAT: Handle form submit or button click.
  function handleConfirmSubmit(e) {
    e.preventDefault();
    if (confirmText === 'DELETE ALL' && !isLoading) {
      console.log('ConfirmModal: User confirmed DELETE ALL.');
      onConfirm();
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={(e) => {
        // Close if clicking the backdrop directly
        if (e.target === e.currentTarget && !isLoading) {
          onClose();
        }
      }}
    >
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title-group">
            {/* Warning Shield SVG */}
            <div className="modal-icon-badge" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div>
              <h3 id="confirm-modal-title" className="modal-title">Clear All Events</h3>
              <p className="modal-subtitle">Permanently delete all webhook history</p>
            </div>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close confirmation dialog"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-warning-text">
            This action will permanently delete every event in the database.
            This action <strong>cannot be undone</strong> and all recorded payloads will be lost.
          </p>

          <form onSubmit={handleConfirmSubmit} className="modal-form">
            <label htmlFor="confirm-input" className="form-label">
              Type <strong className="font-mono text-danger">DELETE ALL</strong> to confirm:
            </label>

            <input
              id="confirm-input"
              ref={inputRef}
              type="text"
              className="form-input font-mono"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE ALL"
              disabled={isLoading}
              autoComplete="off"
              spellCheck="false"
            />

            <div className="modal-actions">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="btn btn-secondary"
              >
                Cancel
              </button>

              {/* Red confirm button: enabled ONLY when confirmText === "DELETE ALL" */}
              <button
                type="submit"
                disabled={confirmText !== 'DELETE ALL' || isLoading}
                className="btn btn-danger"
              >
                {isLoading ? 'Clearing Events...' : 'Clear All Events'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
