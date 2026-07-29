import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/auth";
import { API_CONFIG } from "@/utils/constants";
import { getPlatformName } from "@/config/branding";

const ErrorIcon = () => (
  <svg aria-hidden="true" className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
  </svg>
);

const Spinner = () => (
  <svg aria-hidden="true" className="animate-spin h-4 w-4" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

export function SignIn() {
  const [searchParams, setSearchParams] = useSearchParams();
  const resetToken = searchParams.get("resetToken");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  // Forgot-password request flow
  const [showForgot, setShowForgot] = useState(false);
  const [resetIdentifier, setResetIdentifier] = useState("");

  // Reset-confirm flow (active when the email link carries ?resetToken=)
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetComplete, setResetComplete] = useState(false);

  const clearMessages = () => {
    setError("");
    setNotice("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    try {
      const res = await fetch(API_CONFIG.buildApiUrl('/signin'), {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "*/*" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signin failed");
      if (data.token) {
        const userPayload = data.user || {
          username,
          email: username,
          role: "member",
        };
        const loginResult = login(userPayload, data.token);
        if (!loginResult.success) {
          throw new Error(loginResult.error || "Login failed");
        }
        navigate("/dashboard/controlpanel");
      } else {
        setError("Invalid credentials");
      }
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    try {
      const identifier = resetIdentifier.trim();
      const res = await fetch(API_CONFIG.buildApiUrl('/password-reset/request'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The backend matches on email OR username, so send the identifier as both.
        body: JSON.stringify({ email: identifier, username: identifier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start password reset");
      // The endpoint never reveals whether the account exists.
      setNotice(data.message || "If the account exists, a reset email has been sent.");
    } catch (err) {
      setError(err.message || "Could not start password reset");
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    clearMessages();
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(API_CONFIG.buildApiUrl('/password-reset/confirm'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Password reset failed");
      setResetComplete(true);
      setNotice("Password reset successful — you can now sign in.");
      setNewPassword("");
      setConfirmPassword("");
      // Drop the token from the URL so a refresh returns to the sign-in form.
      setSearchParams({}, { replace: true });
    } catch (err) {
      setError(err.message || "Password reset failed");
    } finally {
      setLoading(false);
    }
  };

  const messages = (
    <>
      {error && (
        <div className="cb-auth-error">
          <ErrorIcon />
          {error}
        </div>
      )}
      {notice && (
        <div className="cb-auth-error" style={{ color: "#15803d", borderColor: "#bbf7d0", background: "#f0fdf4" }}>
          {notice}
        </div>
      )}
    </>
  );

  // --- Reset-confirm view: reached via the link in the reset email ---
  if (resetToken && !resetComplete) {
    return (
      <AuthShell title="Set a new password" subtitle="Choose a new password for your account">
        <form onSubmit={handleResetSubmit} className="cb-auth-form">
          <div className="cb-auth-field">
            <label className="cb-auth-label" htmlFor="reset-new-password">New password</label>
            <input
              id="reset-new-password"
              type="password"
              placeholder="••••••••"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="cb-auth-input"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              At least 8 characters with uppercase, lowercase, a digit, and a special character.
            </p>
          </div>
          <div className="cb-auth-field">
            <label className="cb-auth-label" htmlFor="reset-confirm-password">Confirm password</label>
            <input
              id="reset-confirm-password"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="cb-auth-input"
              required
            />
          </div>
          {messages}
          <button type="submit" disabled={loading} className="cb-auth-submit">
            {loading ? (
              <span className="flex items-center justify-center gap-2"><Spinner /> Resetting...</span>
            ) : "Reset password"}
          </button>
        </form>
        <div className="cb-auth-footer">
          <Link to="/auth/sign-in" className="cb-auth-link">Back to sign in</Link>
        </div>
      </AuthShell>
    );
  }

  // --- Forgot-password request view ---
  if (showForgot) {
    return (
      <AuthShell title="Reset your password" subtitle="We'll email you a link to set a new password">
        <form onSubmit={handleForgotSubmit} className="cb-auth-form">
          <div className="cb-auth-field">
            <label className="cb-auth-label" htmlFor="forgot-identifier">Email or username</label>
            <input
              id="forgot-identifier"
              type="text"
              placeholder="you@lab.com"
              value={resetIdentifier}
              onChange={e => setResetIdentifier(e.target.value)}
              className="cb-auth-input"
              required
            />
          </div>
          {messages}
          <button type="submit" disabled={loading} className="cb-auth-submit">
            {loading ? (
              <span className="flex items-center justify-center gap-2"><Spinner /> Sending...</span>
            ) : "Send reset link"}
          </button>
        </form>
        <div className="cb-auth-footer">
          <button
            type="button"
            className="cb-auth-link"
            onClick={() => { setShowForgot(false); clearMessages(); }}
          >
            Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  // --- Default sign-in view ---
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to access your lab dashboard">
      <form onSubmit={handleSubmit} className="cb-auth-form">
        <div className="cb-auth-field">
          <label className="cb-auth-label" htmlFor="signin-username">Username</label>
          <input
            id="signin-username"
            type="text"
            placeholder="Enter your username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="cb-auth-input"
            required
          />
        </div>

        <div className="cb-auth-field">
          <div className="flex justify-between items-center">
            <label className="cb-auth-label" htmlFor="signin-password">Password</label>
            <button
              type="button"
              className="cb-auth-link text-xs"
              onClick={() => { setShowForgot(true); clearMessages(); }}
            >
              Forgot password?
            </button>
          </div>
          <input
            id="signin-password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="cb-auth-input"
            required
          />
        </div>

        {messages}

        <button type="submit" disabled={loading} className="cb-auth-submit">
          {loading ? (
            <span className="flex items-center justify-center gap-2"><Spinner /> Signing in...</span>
          ) : "Sign In"}
        </button>
      </form>

      {/* Accounts are invite-only — an administrator creates them from Company
          Admin. Offering "Create account" here would lead to a route that no
          longer exists and a route that refuses. */}
      <div className="cb-auth-footer">
        <span className="text-gray-500">Need an account? Ask your administrator for an invitation.</span>
      </div>
    </AuthShell>
  );
}

function AuthShell({ title, subtitle, children }) {
  return (
    <div className="cb-auth-page">
      {/* Animated background */}
      <div className="cb-auth-bg">
        <div className="cb-orb cb-orb-1" />
        <div className="cb-orb cb-orb-2" />
        <div className="cb-grid-bg" />
      </div>

      <div className="cb-auth-container">
        {/* Brand. Not a link: there is no marketing home to go back to, and a
            dead link on the one page every user sees is worse than plain text. */}
        <div className="cb-auth-brand">
          <span className="cb-auth-logo">{getPlatformName()}</span>
          <span className="cb-auth-badge">BETA</span>
        </div>

        {/* Card */}
        <div className="cb-auth-card">
          <div className="cb-auth-card-header">
            <h1 className="cb-auth-title">{title}</h1>
            <p className="cb-auth-subtitle">{subtitle}</p>
          </div>

          {children}
        </div>

      </div>
    </div>
  );
}

export function getAuthToken() {
  return localStorage.getItem("auth_token");
}

export default SignIn;
