import { useState } from 'react';

// WHAT: LoginForm component displayed when an admin is not yet signed in.
// WHY: Allows the user to enter their admin password and submit it to POST /api/login.
// Keeps the input state local to this form component.
function LoginForm({ onLogin, isLoading, errorMessage }) {
  // WHAT: Local state to hold the password typed by the user.
  // WHY: Controls the input field value in standard React controlled-component pattern.
  const [password, setPassword] = useState('');

  // WHAT: Form submission handler.
  // WHY: Prevents full page reload and calls the parent's onLogin callback function.
  function handleSubmit(event) {
    event.preventDefault();
    console.log('LoginForm: Submitting admin password...');

    if (!password.trim()) {
      return;
    }

    onLogin(password);
  }

  return (
    <div className="login-card">
      <div className="login-header">
        <h3>Admin Sign In</h3>
        <p>Sign in to inspect event payloads and failure details.</p>
      </div>

      <form onSubmit={handleSubmit} className="login-form">
        <input
          type="password"
          className="password-input"
          placeholder="Enter admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isLoading}
          autoComplete="current-password"
        />

        <button
          type="submit"
          className="btn btn-primary"
          disabled={isLoading || !password.trim()}
        >
          {isLoading ? 'Signing In...' : 'Sign In'}
        </button>
      </form>

      {/* WHAT: Display an error message if login failed. */}
      {/* WHY: Provides clear visual feedback (e.g. "Wrong password"). */}
      {errorMessage && (
        <div className="error-message" role="alert">
          {errorMessage}
        </div>
      )}
    </div>
  );
}

export default LoginForm;
