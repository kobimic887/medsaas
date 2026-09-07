// Build-time environment facts for the React app.
//
// `import.meta.env.BASE_URL` mirrors the Vite `base` option and is a build-time
// constant that always starts and ends with "/":
//   - normal production/dev build  -> "/"      (assets at /assets/...)
//   - isolated staging build       -> "/staging/" (assets at /staging/assets/...)
// `import.meta.env.MODE` is "production" for the normal build and "staging"
// for `vite build --mode staging` (see client/package.json "build:staging").
//
// Everything that must stay inside the staging scope on the shared origin
// derives from APP_BASE_PATH below:
//   - API URLs (same-origin /staging/api -> nginx -> staging server),
//   - React Router's basename,
//   - iframe/static asset URLs that are written as literals in components,
//   - the localStorage/sessionStorage namespace (see storageNamespace.js).
const BASE_URL = import.meta.env.BASE_URL || "/";

/** "" for the normal build, "/staging" for the isolated staging build. */
export const APP_BASE_PATH =
  BASE_URL && BASE_URL !== "/" ? BASE_URL.replace(/\/+$/, "") : "";

/** True when this build is the isolated staging build under /staging/. */
export const IS_STAGING_BUILD = APP_BASE_PATH !== "";

/** "production" normally; "staging" for the staging build. */
export const APP_MODE = import.meta.env.MODE || "production";

/**
 * Prefix a root-relative path (or bare path) with the build's base path so the
 * result stays inside this environment. Root build -> path unchanged.
 */
export function withAppBase(path) {
  const p = String(path || "").startsWith("/") ? String(path) : `/${path}`;
  return `${APP_BASE_PATH}${p}`;
}
