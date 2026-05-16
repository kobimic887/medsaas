import React, { useState } from "react";
import { Link } from "react-router-dom";
import { API_CONFIG } from "@/utils/constants";

export function SignUp() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [organization, setOrganization] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [ligandFile, setLigandFile] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const readFileAsBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = typeof reader.result === "string" ? reader.result : "";
        const base64 = value.includes(",") ? value.split(",")[1] : value;
        resolve(base64 || "");
      };
      reader.onerror = () => reject(new Error("Unable to read ligand file"));
      reader.readAsDataURL(file);
    });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    
    if (!termsAccepted) {
      setError("Please accept the Terms and Conditions to continue");
      return;
    }

    if (!organization.trim()) {
      setError("Company name is required");
      return;
    }

    if (!ligandFile) {
      setError("Ligand file upload is required");
      return;
    }

    if (ligandFile.size > 2 * 1024 * 1024) {
      setError("Ligand file must be 2MB or smaller");
      return;
    }
    
    setLoading(true);
    try {
      const ligandUpload = {
        fileName: ligandFile.name,
        contentType: ligandFile.type || "application/octet-stream",
        sizeBytes: ligandFile.size,
        contentBase64: await readFileAsBase64(ligandFile),
      };
      const res = await fetch(API_CONFIG.buildApiUrl('/signup'), {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "*/*" },
        body: JSON.stringify({ 
          username, 
          password, 
          email, 
          organization,
          phoneNumber,
          shippingAddress,
          billingAddress,
          ligandUpload
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signup failed");
      setSuccess(true);
    } catch (err) {
      setError(err.message);
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
        <div className="cb-auth-card cb-auth-card-wide">
          <div className="cb-auth-card-header">
            <h1 className="cb-auth-title">Create your account</h1>
            <p className="cb-auth-subtitle">Register your lab to start showcasing compounds</p>
          </div>

          {success ? (
            <div className="cb-auth-success">
              <div className="text-4xl mb-3">🎉</div>
              <h3 className="text-lg font-bold text-emerald-400 mb-2">Registration successful!</h3>
              <p className="text-slate-400 text-sm mb-4">Your account has been created. You can now sign in.</p>
              <Link to="/auth/sign-in" className="cb-auth-submit inline-block text-center">
                Go to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="cb-auth-form">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="cb-auth-field">
                  <label className="cb-auth-label">Username *</label>
                  <input
                    type="text"
                    placeholder="Choose a username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="cb-auth-input"
                    required
                  />
                </div>

                <div className="cb-auth-field">
                  <label className="cb-auth-label">Email *</label>
                  <input
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="cb-auth-input"
                    required
                  />
                </div>

                <div className="cb-auth-field">
                  <label className="cb-auth-label">Password *</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="cb-auth-input"
                    required
                  />
                </div>

                <div className="cb-auth-field">
                  <label className="cb-auth-label">Company / Lab Name *</label>
                  <input
                    type="text"
                    placeholder="Your laboratory name"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    className="cb-auth-input"
                    required
                  />
                </div>

                <div className="cb-auth-field">
                  <label className="cb-auth-label">Phone <span className="text-slate-600 font-normal">(Optional)</span></label>
                  <input
                    type="text"
                    placeholder="+1 (555) 123-4567"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="cb-auth-input"
                  />
                </div>

                <div className="cb-auth-field">
                  <label className="cb-auth-label">Shipping Address <span className="text-slate-600 font-normal">(Optional)</span></label>
                  <input
                    type="text"
                    placeholder="Street, City, State, ZIP"
                    value={shippingAddress}
                    onChange={(e) => setShippingAddress(e.target.value)}
                    className="cb-auth-input"
                  />
                </div>

                <div className="cb-auth-field md:col-span-2">
                  <label className="cb-auth-label">Billing Address <span className="text-slate-600 font-normal">(Optional)</span></label>
                  <input
                    type="text"
                    placeholder="Street, City, State, ZIP, Country"
                    value={billingAddress}
                    onChange={(e) => setBillingAddress(e.target.value)}
                    className="cb-auth-input"
                  />
                </div>

                <div className="cb-auth-field md:col-span-2">
                  <label className="cb-auth-label">Ligand File *</label>
                  <input
                    type="file"
                    accept=".sdf,.mol,.mol2,.csv,.txt,.json"
                    onChange={(e) => setLigandFile(e.target.files?.[0] || null)}
                    className="cb-auth-input"
                    required
                  />
                  <p className="mt-1 text-xs text-slate-500">Accepted formats: SDF, MOL, MOL2, CSV, TXT, JSON (max 2MB)</p>
                </div>
              </div>

              {/* Terms checkbox */}
              <label className="cb-auth-checkbox">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="cb-auth-check"
                />
                <span className="text-sm text-slate-400">
                  I agree to the{" "}
                  <a href="#" className="cb-auth-link">Terms and Conditions</a>
                </span>
              </label>

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
                    Creating account...
                  </span>
                ) : "Create Account"}
              </button>
            </form>
          )}

          <div className="cb-auth-footer">
            <span className="text-slate-500">Already have an account?</span>
            <Link to="/auth/sign-in" className="cb-auth-link">Sign in</Link>
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

export default SignUp;
