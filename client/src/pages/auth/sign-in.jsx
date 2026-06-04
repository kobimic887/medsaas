import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/auth";
import { API_CONFIG } from "@/utils/constants";

export function SignIn() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    
    setLoading(true);
    try {
      const res = await fetch(API_CONFIG.buildApiUrl('/signin'), {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "*/*" },
        body: JSON.stringify({ username, password }),
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
        setSuccess(true);
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

  return (
    <div className="cb-auth-page">
      {/* Animated background */}
      <div className="cb-auth-bg">
        <div className="cb-orb cb-orb-1" />
        <div className="cb-orb cb-orb-2" />
        <div className="cb-grid-bg" />
      </div>

      <div className="cb-auth-container">
        {/* Brand */}
        <Link to="/main/mainHome" className="cb-auth-brand">
          <span className="cb-auth-logo">ChemBench</span>
          <span className="cb-auth-badge">BETA</span>
        </Link>

        {/* Card */}
        <div className="cb-auth-card">
          <div className="cb-auth-card-header">
            <h1 className="cb-auth-title">Welcome back</h1>
            <p className="cb-auth-subtitle">Sign in to access your lab dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="cb-auth-form">
            <div className="cb-auth-field">
              <label className="cb-auth-label">Username</label>
              <input
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
                <label className="cb-auth-label">Password</label>
                <a href="#" className="cb-auth-link text-xs">Forgot password?</a>
              </div>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="cb-auth-input"
                required
              />
            </div>

            {error && (
              <div className="cb-auth-error">
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="cb-auth-submit"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in...
                </span>
              ) : "Sign In"}
            </button>
          </form>

          <div className="cb-auth-footer">
            <span className="text-slate-500">Don't have an account?</span>
            <Link to="/auth/sign-up" className="cb-auth-link">Create account</Link>
          </div>
        </div>

        {/* Bottom link */}
        <Link to="/main/mainHome" className="cb-auth-back">
          ← Back to home
        </Link>
      </div>
    </div>
  );
}

export function getAuthToken() {
  return localStorage.getItem("auth_token");
}

export default SignIn;
