/**
 * Lazy tenant backfill at token issue time.
 *
 * Legacy chem_beo users often lack companyId / role / active. Bulk Atlas surgery is
 * risky; instead, when a user signs in and there is exactly one company in the DB,
 * stamp the missing invisible plumbing onto their user document so the new JWT
 * carries companyId. Never invent a company, never guess among multiple tenants,
 * never set companyName (branding stays PLATFORM_NAME), never invent credits.
 */

/**
 * @param {import('mongodb').Collection} companiesCollection
 * @returns {Promise<string|null>} sole companyId, or null if 0 or 2+ companies
 */
export async function resolveSoleCompanyId(companiesCollection) {
  const companies = await companiesCollection.find({}).limit(2).toArray();
  if (companies.length !== 1) return null;
  const company = companies[0];
  if (typeof company.companyId === 'string' && company.companyId.trim()) {
    return company.companyId.trim();
  }
  if (company._id) return company._id.toString();
  return null;
}

/**
 * Fields to $set on a legacy-shaped user. Empty object means nothing to change.
 * @param {object} user
 * @param {string|null} soleCompanyId
 */
export function buildTenantBackfillPatch(user, soleCompanyId) {
  const set = {};
  if ((user?.companyId === undefined || user?.companyId === null) && soleCompanyId) {
    set.companyId = soleCompanyId;
  }
  if (!user?.role) set.role = 'member';
  if (typeof user?.active !== 'boolean') set.active = true;
  return set;
}

/**
 * Persist missing tenant fields (when safe) and return the merged user for JWT issue.
 * @param {{ usersCollection: import('mongodb').Collection, companiesCollection: import('mongodb').Collection, user: object }} args
 */
export async function ensureUserTenantOnLogin({ usersCollection, companiesCollection, user }) {
  if (!user?._id) return user;

  const soleCompanyId = await resolveSoleCompanyId(companiesCollection);
  const set = buildTenantBackfillPatch(user, soleCompanyId);
  if (Object.keys(set).length === 0) return user;

  set.updatedAt = new Date();
  await usersCollection.updateOne({ _id: user._id }, { $set: set });
  return { ...user, ...set };
}
