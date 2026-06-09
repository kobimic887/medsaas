import { useAuth } from '@/context/auth';
import { useBrandingContext } from '@/context/branding';
import { getBrandName, getPlatformName } from '@/config/branding';

export function useBranding(previewCompanyName) {
  const { user } = useAuth();
  const { branding, loading, error, refreshBranding } = useBrandingContext();
  const brandName = getBrandName({ companyName: previewCompanyName, user });
  return {
    brandName,
    companyName: user?.companyName || previewCompanyName?.trim() || null,
    platformName: getPlatformName(),
    palette: branding.palette,
    logo: branding.logo,
    isCustomBranding: branding.isCustom,
    brandingUpdatedAt: branding.updatedAt,
    brandingLoading: loading,
    brandingError: error,
    refreshBranding,
  };
}
