import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, X, Trash2 } from 'lucide-react';

export default function ConfirmModal({ isOpen, onClose, onConfirm, isLoading }) {
  const [confirmText, setConfirmText] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (isOpen && e.key === 'Escape' && !isLoading) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  function handleClose() {
    setConfirmText('');
    onClose();
  }

  function handleConfirmSubmit(e) {
    e.preventDefault();
    if (confirmText === 'DELETE ALL' && !isLoading) {
      setConfirmText('');
      onConfirm();
    }
  }

  const isConfirmed = confirmText === 'DELETE ALL';

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) {
          handleClose();
        }
      }}
    >
      <div className="modal-dialog animate-scale-in">
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge danger" aria-hidden="true">
              <AlertTriangle size={20} className="text-rose-400" />
            </div>
            <div>
              <h3 id="confirm-modal-title" className="modal-title">
                Clear Ingested Events
              </h3>
              <p className="modal-subtitle">Destructive Database Action</p>
            </div>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={handleClose}
            disabled={isLoading}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-warning-box">
            <p className="modal-warning-text">
              This action will permanently delete every event record in Supabase. All stored
              payloads, attempt histories, and audit signatures will be permanently erased.
            </p>
          </div>

          <form onSubmit={handleConfirmSubmit} className="modal-form">
            <label htmlFor="confirm-input" className="form-label">
              Type <strong className="font-mono text-danger font-bold tracking-wider">DELETE ALL</strong> to authorize:
            </label>

            <input
              id="confirm-input"
              ref={inputRef}
              type="text"
              className="form-input font-mono input-lg"
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
                onClick={handleClose}
                disabled={isLoading}
                className="btn btn-secondary"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={!isConfirmed || isLoading}
                className={`btn btn-danger ${isConfirmed ? 'btn-danger-glowing' : ''}`}
              >
                <Trash2 size={15} />
                <span>{isLoading ? 'Purging Records...' : 'Clear All Events'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
