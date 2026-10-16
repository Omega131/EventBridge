import { useState } from 'react';

// WHAT: LoginForm component for administrator authentication.
// WHY: Clean developer-tool login card matching the design system tokens.
function LoginForm({ onLogin, isLoading, errorMessage, onCancel }) {
  const [password, setPassword] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
    if (!password.trim() || isLoading) {
      return;
    }
    console.log('LoginForm: Submitting admin password...');
    onLogin(password);
  }

  return (
    <div className="login-card">
      <div className="login-header">
        <div className="login-header-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div>
          <h3 className="login-title">Admin Authentication</h3>
          <p className="login-subtitle">Sign in to inspect event payloads, failure logs, and trigger retries.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="login-form">
        <div className="login-input-group">
          <label htmlFor="admin-password-input" className="form-label visually-hidden">
            Admin Password
          </label>
          <input
            id="admin-password-input"
            type="password"
            className="form-input password-input font-mono"
            placeholder="Enter admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            autoComplete="current-password"
            autoFocus
          />

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isLoading || !password.trim()}
          >
            {isLoading ? 'Signing In...' : 'Sign In'}
          </button>

          {onCancel && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCancel}
              disabled={isLoading}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {errorMessage && (
        <div className="form-error-alert" role="alert">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}

export default LoginForm;
