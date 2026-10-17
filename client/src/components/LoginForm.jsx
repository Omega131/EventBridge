import { useState } from 'react';
import { Lock, Eye, EyeOff, ArrowRight, AlertCircle, Sparkles, X } from 'lucide-react';

const DEMO_PASSWORD = 'recruitingmewasyoursmartestdecision';

export default function LoginForm({ onLogin, isLoading, errorMessage, onCancel }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  function handleSubmit(event) {
    event.preventDefault();
    if (!password.trim() || isLoading) return;
    onLogin(password);
  }

  function handleUseDemoPassword() {
    setPassword(DEMO_PASSWORD);
  }

  return (
    <div className="login-card animate-scale-in">
      <div className="login-header">
        <div className="login-header-left">
          <div className="login-header-icon" aria-hidden="true">
            <Lock size={18} className="text-indigo-400" />
          </div>
          <div>
            <h3 className="login-title">Administrator Authentication</h3>
            <p className="login-subtitle">
              Sign in to inspect full payloads, examine failure logs, and trigger manual retries.
            </p>
          </div>
        </div>

        {onCancel && (
          <button
            type="button"
            className="btn-icon"
            onClick={onCancel}
            disabled={isLoading}
            aria-label="Close login dialog"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="login-form">
        <div className="login-input-row">
          <div className="password-input-wrap">
            <input
              id="admin-password-input"
              type={showPassword ? 'text' : 'password'}
              className="form-input password-input font-mono"
              placeholder="Enter administrator password..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="current-password"
              autoFocus
            />
            <button
              type="button"
              className="btn-input-eye"
              onClick={() => setShowPassword((p) => !p)}
              title={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-login-submit"
            disabled={isLoading || !password.trim()}
          >
            <span>{isLoading ? 'Verifying...' : 'Sign In'}</span>
            <ArrowRight size={15} />
          </button>
        </div>

        {/* Quick Demo Helper Hint */}
        <div className="login-helper-row">
          <span className="demo-hint-text">
            Testing environment?
          </span>
          <button
            type="button"
            className="btn-demo-fill"
            onClick={handleUseDemoPassword}
          >
            <Sparkles size={11} className="inline mr-1 text-indigo-400" />
            Auto-fill demo password
          </button>
        </div>
      </form>

      {errorMessage && (
        <div className="form-error-alert animate-fade-in" role="alert">
          <AlertCircle size={15} className="flex-shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
