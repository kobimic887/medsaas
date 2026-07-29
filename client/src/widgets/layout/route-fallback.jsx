/**
 * What a route shows while its chunk is downloading.
 *
 * A skeleton rather than a spinner, and deliberately so: pages are code-split now
 * (see routes.jsx), so this is visible on every first navigation to a page. A block
 * that already occupies the page's shape reads as "this is loading" instead of
 * "something is wrong", and it does not shift the layout when the real content
 * arrives.
 *
 * `animate-pulse` only — no timers, no state, nothing to clean up. It renders for a
 * few hundred milliseconds at most and must never be the thing that costs a frame.
 */
export function RouteFallback() {
  return (
    <div
      className="mt-8 animate-pulse space-y-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="route-fallback"
    >
      <span className="sr-only">Loading page…</span>
      <div className="h-8 w-1/3 rounded-md bg-blue-gray-100 dark:bg-slate-800" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-28 rounded-xl bg-blue-gray-100 dark:bg-slate-800" />
        <div className="h-28 rounded-xl bg-blue-gray-100 dark:bg-slate-800" />
        <div className="h-28 rounded-xl bg-blue-gray-100 dark:bg-slate-800" />
      </div>
      <div className="h-64 rounded-xl bg-blue-gray-100 dark:bg-slate-800" />
    </div>
  );
}

export default RouteFallback;
