import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthShell } from "@/components/AuthShell";
import { useAuth } from "@/context/auth";
import { useBranding } from "@/hooks/useBranding";
import { API_CONFIG } from "@/utils/constants";

const AUTH_FETCH_TIMEOUT_MS = 15_000;

const Spinner = () => (
  <svg aria-hidden="true" className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

export function SignUp() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [organization, setOrganization] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const requestControllerRef = useRef(null);
  const requestTimeoutRef = useRef(null);
  const { brandName, platformName } = useBranding(organization);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => () => {
    requestControllerRef.current?.abort();
    window.clearTimeout(requestTimeoutRef.current);
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;

    setError("");
    setSuccess(false);
    const companyName = organization.trim();
    if (!companyName) {
      setError("Company name is required");
      return;
    }

    requestControllerRef.current?.abort();
    window.clearTimeout(requestTimeoutRef.current);
    const controller = new AbortController();
    requestControllerRef.current = controller;
    let timedOut = false;
    requestTimeoutRef.current = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, AUTH_FETCH_TIMEOUT_MS);
    setLoading(true);

    try {
      const response = await fetch(API_CONFIG.buildApiUrl("/signup"), {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "*/*" },
        body: JSON.stringify({
          username: username.trim(),
          password,
          email: email.trim(),
          organization: companyName,
        }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Signup failed");

      if (data.token && data.user) {
        const loginResult = login(data.user, data.token);
        if (!loginResult.success) {
          throw new Error(loginResult.error || "Your account was created, but sign-in failed");
        }
        navigate("/dashboard/controlpanel");
        return;
      }

      setSuccess(true);
    } catch (err) {
      if (err.name === "AbortError") {
        if (timedOut) setError("Request timed out. Please try again.");
        return;
      }
      setError(err.message || "Signup failed");
    } finally {
      window.clearTimeout(requestTimeoutRef.current);
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setLoading(false);
      }
    }
  };

  const title = organization.trim()
    ? `Set up ${brandName}`
    : `Create your company on ${platformName}`;
  const subtitle = organization.trim()
    ? `Register your company on ${brandName}.`
    : "Your company name is used for branding and admin.";

  return (
    <AuthShell title={title} subtitle={subtitle}>
      <form className="cb-auth-form" onSubmit={handleSubmit} aria-busy={loading}>
        <div className="cb-auth-field">
          <label className="cb-auth-label" htmlFor="signup-email">Email</label>
          <input
            id="signup-email"
            className="cb-auth-input"
            type="email"
            autoComplete="email"
            placeholder="you@lab.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="cb-auth-field">
          <label className="cb-auth-label" htmlFor="signup-username">Username</label>
          <input
            id="signup-username"
            className="cb-auth-input"
            type="text"
            autoComplete="username"
            placeholder="Your username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </div>

        <div className="cb-auth-field">
          <label className="cb-auth-label" htmlFor="signup-password">Password</label>
          <input
            id="signup-password"
            className="cb-auth-input"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
            aria-describedby="signup-password-help"
          />
          <p id="signup-password-help" className="mt-1 text-xs text-gray-500">
            At least 8 characters with uppercase, lowercase, a digit, and a special character.
          </p>
        </div>

        <div className="cb-auth-field">
          <label className="cb-auth-label" htmlFor="signup-company">Company name</label>
          <input
            id="signup-company"
            className="cb-auth-input"
            type="text"
            autoComplete="organization"
            placeholder="Your company"
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
            required
          />
        </div>

        {error && <div className="cb-auth-error" role="alert">{error}</div>}
        {success && (
          <div
            className="cb-auth-error"
            role="status"
            style={{ color: "#15803d", borderColor: "#bbf7d0", background: "#f0fdf4" }}
          >
            {brandName} account created. You can now sign in.
          </div>
        )}

        <button type="submit" className="cb-auth-submit" disabled={loading}>
          {loading ? (
            <span className="flex items-center justify-center gap-2"><Spinner /> Creating account...</span>
          ) : "Create account"}
        </button>
      </form>

      <div className="cb-auth-footer">
        <span className="text-gray-500">Already have an account?</span>{" "}
        <Link to="/auth/sign-in" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
          Sign in
        </Link>
      </div>
    </AuthShell>
  );
}

export default SignUp;
