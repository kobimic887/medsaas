import { useEffect, useState } from "react";
import { IS_STAGING_BUILD, withAppBase } from "@/utils/appEnv";

/**
 * Persistent, unmistakable “this is staging” banner. Rendered only by the
 * isolated /staging/ build (IS_STAGING_BUILD); the production build renders
 * nothing and ships no banner markup. This is a labeling control — access
 * control is the separate staging auth, never this banner.
 */
export function StagingBanner() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!IS_STAGING_BUILD) return undefined;
    const controller = new AbortController();
    fetch(withAppBase("/api/staging/status"), { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setStatus(payload))
      .catch(() => setStatus(null));
    return () => controller.abort();
  }, []);
  if (!IS_STAGING_BUILD) return null;
  return (
    <div
      role="note"
      aria-label="Staging environment notice"
      className="staging-banner"
    >
      <span className="staging-banner-pill">STAGING</span>
      <span className="staging-banner-text">
        {status?.sharedProductionData
          ? "This staging app shares production accounts, history, credits and orders. Actions and purchases here affect real records and balances."
          : status?.demo
            ? "Isolated demo environment with sample data. Do not enter real projects, results or payment details here. Saved history is demo-only and resets when the staging service restarts."
            : "Staging environment. Account and data mode are being checked; wait for the status notice before making changes."}
      </span>
    </div>
  );
}

export default StagingBanner;
