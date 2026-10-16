import { useState, useEffect } from 'react';

// WHAT: ConfirmModal component for destructive admin actions (clearing all events).
// WHY: Deleting all events is irreversible. Requiring the admin to explicitly type
// "DELETE ALL" prevents accidental clicks.
function ConfirmModal({ isOpen, onClose, onConfirm, isLoading }) {
  // WHAT: Local state to track the text typed into the confirmation box.
  // WHY: The confirm button remains strictly disabled until this text matches "DELETE ALL" exactly.
  const [confirmText, setConfirmText] = useState('');

  // WHAT: Reset confirmation text whenever the modal opens or closes.
  // WHY: Ensures a previous aborted confirmation doesn't leave text in the input.
  useEffect(() => {
    if (!isOpen) {
      setConfirmText('');
    }
  }, [isOpen]);

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
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}
    >
      <div
        className="modal-card"
        style={{
          backgroundColor: '#ffffff',
          color: '#1f2937',
          padding: '24px',
          borderRadius: '8px',
          maxWidth: '440px',
          width: '90%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)'
        }}
      >
        <h3 id="confirm-modal-title" style={{ marginTop: 0 }}>Clear All Events</h3>

        <p className="modal-description">
          This permanently deletes every event in the database.
          This action <strong>cannot be undone</strong>.
        </p>

        <form onSubmit={handleConfirmSubmit}>
          <label htmlFor="confirm-input" className="modal-label" style={{ display: 'block', marginBottom: '6px' }}>
            Type <strong>DELETE ALL</strong> to confirm:
          </label>

          <input
            id="confirm-input"
            type="text"
            className="modal-input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE ALL"
            disabled={isLoading}
            autoFocus
            style={{ width: '100%', padding: '8px', boxSizing: 'border-box', marginBottom: '16px' }}
          />

          <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
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
              style={{
                backgroundColor: confirmText === 'DELETE ALL' ? '#dc2626' : '#9ca3af',
                color: '#fff',
                cursor: confirmText === 'DELETE ALL' && !isLoading ? 'pointer' : 'not-allowed'
              }}
            >
              {isLoading ? 'Clearing Events...' : 'Clear All Events'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ConfirmModal;
