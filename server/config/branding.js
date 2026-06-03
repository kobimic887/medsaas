const PLATFORM_NAME = (process.env.PLATFORM_NAME || 'MedSaaS').trim();
const PLATFORM_WEBSITE_URL = (process.env.PLATFORM_WEBSITE_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');

export function getPlatformName() {
  return PLATFORM_NAME;
}

export function getPlatformWebsiteUrl() {
  return PLATFORM_WEBSITE_URL;
}

/** Primary label for emails/UI — company name when known, else platform name. */
export function getBrandName(companyName) {
  const company = typeof companyName === 'string' ? companyName.trim() : '';
  return company || PLATFORM_NAME;
}

export function getEmailFromLabel(companyName) {
  return `"${getBrandName(companyName)}" <${process.env.EMAIL_USER || 'no-reply@example.com'}>`;
}
