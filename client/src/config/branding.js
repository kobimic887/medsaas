const PLATFORM_NAME = (import.meta.env.VITE_PLATFORM_NAME || 'MedSaaS').trim();

export function getPlatformName() {
  return PLATFORM_NAME;
}

/** Logged-in: company name. Sign-up/auth: optional preview company name.
 * An explicit preview name wins over the stored user so the sign-up page
 * reflects what is being typed, not a leftover session. */
export function getBrandName({ companyName, user } = {}) {
  const fromUser = user?.companyName?.trim();
  const fromArg = typeof companyName === 'string' ? companyName.trim() : '';
  return fromArg || fromUser || PLATFORM_NAME;
}
