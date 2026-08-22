import { Link } from "react-router-dom";
import { PyxisLogo } from "@/components/PyxisLogo";
import { getPlatformName } from "@/config/branding";

export function AuthShell({ title, subtitle, children }) {
  return (
    <div className="cb-auth-page">
      <div className="cb-auth-bg" aria-hidden="true">
        <div className="cb-orb cb-orb-1" />
        <div className="cb-orb cb-orb-2" />
        <div className="cb-grid-bg" />
      </div>

      <div className="cb-auth-container">
        <Link
          to="/main/mainHome"
          className="cb-auth-brand rounded-lg no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400"
          aria-label={`${getPlatformName()} home`}
        >
          <PyxisLogo className="cb-auth-logo-mark" title={getPlatformName()} />
          <span className="cb-auth-badge">BETA</span>
        </Link>

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

export default AuthShell;
