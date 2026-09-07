import { IS_STAGING_BUILD } from "@/utils/appEnv";

/**
 * Persistent, unmistakable “this is staging” banner. Rendered only by the
 * isolated /staging/ build (IS_STAGING_BUILD); the production build renders
 * nothing and ships no banner markup. This is a labeling control — access
 * control is the separate staging auth, never this banner.
 */
export function StagingBanner() {
  if (!IS_STAGING_BUILD) return null;
  return (
    <div
      role="note"
      aria-label="Staging environment notice"
      className="staging-banner"
    >
      <span className="staging-banner-pill">STAGING</span>
      <span className="staging-banner-text">
        Isolated demo environment with sample data. Do not enter real projects,
        results or payment details here. Saved history is demo-only and resets
        when the staging service restarts.
      </span>
    </div>
  );
}

export default StagingBanner;
