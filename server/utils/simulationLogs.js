/**
 * Dual-shape ownership for simulation_logs.
 *
 * Legacy chem_beo writes nested `user.username` (often no top-level companyId).
 * Maintained API writes top-level `username` / `companyId` / `companyName`.
 * Readers must match both; writers dual-write nested username so a legacy
 * Control Panel filter on `user.username` still sees new rows.
 */

/**
 * Mongo filter that matches maintained and legacy ownership fields for the
 * authenticated user (and their company when companyId is present).
 */
export function buildTenantFilter(user) {
  const clauses = [];

  if (user?.companyId) {
    clauses.push({ companyId: user.companyId });
  }

  if (user?.username) {
    clauses.push({ username: user.username });
    clauses.push({ 'user.username': user.username });
  }

  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { $or: clauses };
}

/**
 * Fields written on insert so both stack shapes can find the row.
 * Only stores `user.username` — never the full JWT (security finding #5).
 */
export function buildSimulationLogOwnership(user) {
  const username = typeof user?.username === 'string' ? user.username : null;
  const ownership = {
    username,
    companyId: user?.companyId || null,
    companyName: user?.companyName || null,
  };
  if (username) {
    // Nested username only — never the full JWT (security finding #5).
    ownership.user = { username };
  }
  return ownership;
}
