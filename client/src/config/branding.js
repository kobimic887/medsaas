const PLATFORM_NAME = (import.meta.env.VITE_PLATFORM_NAME || 'MedSaaS').trim();

export function getPlatformName() {
  return PLATFORM_NAME;
}

/** Logged-in: company name. Sign-up/auth: optional preview company name. */
export function getBrandName({ companyName, user } = {}) {
  const fromUser = user?.companyName?.trim();
  const fromArg = typeof companyName === 'string' ? companyName.trim() : '';
  return fromUser || fromArg || PLATFORM_NAME;
}
