import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell } from "@/components/AuthShell";
import { useAuth } from "@/context/auth";
import { API_CONFIG } from "@/utils/constants";

const AUTH_FETCH_TIMEOUT_MS = 15_000;

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
  const requestControllerRef = useRef(null);
  const requestTimeoutRef = useRef(null);
  const requestTimedOutRef = useRef(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  // Whether to offer the demo at all. Defaults to hidden and only appears once
  // the server confirms an account is configured, so a misconfigured deploy
  // shows one button fewer rather than one that errors when pressed.
  const [demoAvailable, setDemoAvailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), AUTH_FETCH_TIMEOUT_MS);
    fetch(API_CONFIG.buildApiUrl('/demo-session'), { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d) => setDemoAvailable(Boolean(d?.available)))
      .catch(() => { /* no demo button; sign-in still works */ });
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
      requestControllerRef.current?.abort();
      window.clearTimeout(requestTimeoutRef.current);
    };
  }, []);

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

  const beginRequest = () => {
    requestControllerRef.current?.abort();
    window.clearTimeout(requestTimeoutRef.current);
    const controller = new AbortController();
    requestControllerRef.current = controller;
    requestTimedOutRef.current = false;
    requestTimeoutRef.current = window.setTimeout(() => {
      requestTimedOutRef.current = true;
      controller.abort();
    }, AUTH_FETCH_TIMEOUT_MS);
    setLoading(true);
    return controller;
  };

  const finishRequest = (controller) => {
    if (requestControllerRef.current !== controller) return;
    window.clearTimeout(requestTimeoutRef.current);
    requestControllerRef.current = null;
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    clearMessages();
    const controller = beginRequest();
    try {
      const res = await fetch(API_CONFIG.buildApiUrl('/signin'), {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "*/*" },
        body: JSON.stringify({ username: username.trim(), password }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
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
      if (err.name === 'AbortError') {
        if (requestTimedOutRef.current) setError("Request timed out. Please try again.");
        return;
      }
      setError(err.message || "Login failed");
    } finally {
      finishRequest(controller);
    }
  };

  // "Proceed to Demo" — same button, same place, same words as the page it
  // replaces. The difference is invisible: the legacy version typed
  // tester123/Tester!23 into the form from the component source, which anyone
  // could read off the server. Here the server looks the demo account up itself
  // and hands back an ordinary session, so no password is ever in the page.
  const handleDemoSession = async () => {
    if (loading) return;
    clearMessages();
    const controller = beginRequest();
    try {
      const res = await fetch(API_CONFIG.buildApiUrl('/demo-session'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The demo is unavailable right now");
      const loginResult = login(data.user, data.token);
      if (!loginResult.success) throw new Error(loginResult.error || "Login failed");
      navigate("/dashboard/controlpanel");
    } catch (err) {
      if (err.name === 'AbortError') {
        if (requestTimedOutRef.current) setError("Request timed out. Please try again.");
        return;
      }
      setError(err.message || "The demo is unavailable right now");
    } finally {
      finishRequest(controller);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    clearMessages();
    const controller = beginRequest();
    try {
      const identifier = resetIdentifier.trim();
      const res = await fetch(API_CONFIG.buildApiUrl('/password-reset/request'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The backend matches on email OR username, so send the identifier as both.
        body: JSON.stringify({ email: identifier, username: identifier }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start password reset");
      // The endpoint never reveals whether the account exists.
      setNotice(data.message || "If the account exists, a reset email has been sent.");
    } catch (err) {
      if (err.name === 'AbortError') {
        if (requestTimedOutRef.current) setError("Request timed out. Please try again.");
        return;
      }
      setError(err.message || "Could not start password reset");
    } finally {
      finishRequest(controller);
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    clearMessages();
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    const controller = beginRequest();
    try {
      const res = await fetch(API_CONFIG.buildApiUrl('/password-reset/confirm'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, password: newPassword }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Password reset failed");
      setResetComplete(true);
      setNotice("Password reset successful — you can now sign in.");
      setNewPassword("");
      setConfirmPassword("");
      // Drop the token from the URL so a refresh returns to the sign-in form.
      setSearchParams({}, { replace: true });
    } catch (err) {
      if (err.name === 'AbortError') {
        if (requestTimedOutRef.current) setError("Request timed out. Please try again.");
        return;
      }
      setError(err.message || "Password reset failed");
    } finally {
      finishRequest(controller);
    }
  };

  const messages = (
    <>
      {error && (
        <div className="cb-auth-error" role="alert">
          <ErrorIcon />
          {error}
        </div>
      )}
      {notice && (
        <div
          className="cb-auth-error"
          role="status"
          style={{ color: "#15803d", borderColor: "#bbf7d0", background: "#f0fdf4" }}
        >
          {notice}
        </div>
      )}
    </>
  );

  // --- Reset-confirm view: reached via the link in the reset email ---
  if (resetToken && !resetComplete) {
    return (
      <AuthShell title="Set a new password" subtitle="Choose a new password for your account">
        <form onSubmit={handleResetSubmit} className="cb-auth-form" aria-busy={loading}>
          <div className="cb-auth-field">
            <label className="cb-auth-label" htmlFor="reset-new-password">New password</label>
            <input
              id="reset-new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
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
              autoComplete="new-password"
              minLength={8}
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
        <form onSubmit={handleForgotSubmit} className="cb-auth-form" aria-busy={loading}>
          <div className="cb-auth-field">
            <label className="cb-auth-label" htmlFor="forgot-identifier">Email or username</label>
            <input
              id="forgot-identifier"
              type="text"
              autoComplete="username"
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
            disabled={loading}
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
      <form onSubmit={handleSubmit} className="cb-auth-form" aria-busy={loading}>
        <div className="cb-auth-field">
          <label className="cb-auth-label" htmlFor="signin-username">Username</label>
          <input
            id="signin-username"
            type="text"
            autoComplete="username"
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
              disabled={loading}
              onClick={() => { setShowForgot(true); clearMessages(); }}
            >
              Forgot password?
            </button>
          </div>
          <input
            id="signin-password"
            type="password"
            autoComplete="current-password"
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

      {/* Hidden only when the server reports no demo account configured, so a
          broken button never ships. Placed under the form rather than above the
          title as the legacy page had it: the same action, but it no longer
          competes with the sign-in the returning user actually came for. */}
      {demoAvailable && (
        <div className="cb-auth-demo">
          <span className="cb-auth-demo-rule">or</span>
          <button
            type="button"
            onClick={handleDemoSession}
            disabled={loading}
            className="cb-auth-demo-btn"
          >
            Proceed to Demo
          </button>
        </div>
      )}

      <div className="cb-auth-footer">
        <span className="text-gray-500">Need an account?</span>{" "}
        <Link to="/auth/sign-up" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
          Create one
        </Link>
      </div>
    </AuthShell>
  );
}

export default SignIn;
