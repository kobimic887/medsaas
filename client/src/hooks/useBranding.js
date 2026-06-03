import { useAuth } from '@/context/auth';
import { getBrandName, getPlatformName } from '@/config/branding';

export function useBranding(previewCompanyName) {
  const { user } = useAuth();
  const brandName = getBrandName({ companyName: previewCompanyName, user });
  return {
    brandName,
    companyName: user?.companyName || previewCompanyName?.trim() || null,
    platformName: getPlatformName(),
  };
}
