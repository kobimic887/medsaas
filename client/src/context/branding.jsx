import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import PropTypes from "prop-types";
import { useAuth } from "@/context/auth";
import { API_CONFIG, getAuthToken } from "@/utils/constants";

const DEFAULT_PALETTE = Object.freeze({
  primary: "#B4B239",
  accent: "#8E8C2D",
  light: "#E9E8C4",
  dark: "#484716",
});

const EMPTY_BRANDING = Object.freeze({
  palette: DEFAULT_PALETTE,
  logo: null,
  isCustom: false,
  updatedAt: null,
});

const BrandingContext = createContext(null);

export function BrandingProvider({ children }) {
  const { user, isLoading: authLoading } = useAuth();
  const companyId = user?.companyId || null;
  const [branding, setBranding] = useState(EMPTY_BRANDING);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestVersion = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshBranding = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    const token = getAuthToken();

    if (!companyId || !token) {
      if (mounted.current && version === requestVersion.current) {
        setBranding(EMPTY_BRANDING);
        setLoading(false);
        setError(null);
      }
      return EMPTY_BRANDING;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(API_CONFIG.buildApiUrl("/company/branding"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Failed to load company branding");
      }

      const nextBranding = {
        ...EMPTY_BRANDING,
        ...(body.branding || {}),
        palette: {
          ...DEFAULT_PALETTE,
          ...(body.branding?.palette || {}),
        },
      };
      if (mounted.current && version === requestVersion.current) {
        setBranding(nextBranding);
        setLoading(false);
      }
      return nextBranding;
    } catch (requestError) {
      if (mounted.current && version === requestVersion.current) {
        setBranding(EMPTY_BRANDING);
        setLoading(false);
        setError(requestError.message);
      }
      throw requestError;
    }
  }, [companyId]);

  useEffect(() => {
    if (authLoading) return undefined;
    if (!companyId) {
      requestVersion.current += 1;
      setBranding(EMPTY_BRANDING);
      setLoading(false);
      setError(null);
      return undefined;
    }

    refreshBranding().catch(() => {});
    return () => {
      requestVersion.current += 1;
    };
  }, [authLoading, companyId, refreshBranding]);

  return (
    <BrandingContext.Provider value={{ branding, loading, error, refreshBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBrandingContext() {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error("useBrandingContext must be used within a BrandingProvider");
  }
  return context;
}

BrandingProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export { BrandingContext };
