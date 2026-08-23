import PropTypes from "prop-types";
import { createContext, useContext, useEffect, useState } from "react";
import { clearViewerStorage } from "@/utils/viewerStorage";

const AuthContext = createContext();

const USER_STORAGE_KEY = "user_info";
const ACCESS_TOKEN_KEY = "access_token";
const AUTH_TOKEN_KEY = "auth_token";

const getStoredUser = () => {
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error("Failed to parse stored user info:", error);
    return null;
  }
};

const getStoredToken = () => {
  return localStorage.getItem(ACCESS_TOKEN_KEY) || localStorage.getItem(AUTH_TOKEN_KEY);
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedUser = getStoredUser();
    const token = getStoredToken();
    if (storedUser && token) {
      setUser(storedUser);
    } else {
      clearViewerStorage();
      localStorage.removeItem(USER_STORAGE_KEY);
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setUser(null);
    }
    setIsLoading(false);
  }, []);

  const login = (userData, token) => {
    if (!userData || typeof userData !== "object" || !token) {
      return { success: false, error: "Invalid login payload" };
    }

    // Result files live in localStorage, so without this reset a newly signed-in
    // account could inherit the previous account's simulation key and the Results
    // page would try to fetch a file that does not belong to it. Preserve a result
    // when the same account signs in again, but never carry it across accounts.
    const storedUser = getStoredUser();
    const accountChanged = !storedUser
      || storedUser.username !== userData.username
      || storedUser.companyId !== userData.companyId;
    if (accountChanged) clearViewerStorage();
    setUser(userData);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    return { success: true, user: userData };
  };

  const logout = () => {
    clearViewerStorage();
    setUser(null);
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
    // cleanup legacy key if present
    localStorage.removeItem("user");
  };

  const isAdmin = () => {
    // Demo sessions keep the account's real role in the JWT, but they must not
    // open company-admin chrome. Members and the public demo are the same path.
    if (user?.demo) return false;
    const role = user?.role;
    return role === "owner" || role === "admin";
  };

  const isLoggedIn = () => {
    return !!user && !!getStoredToken();
  };

  const value = {
    user,
    login,
    logout,
    isAdmin,
    isLoggedIn,
    isLoading
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
