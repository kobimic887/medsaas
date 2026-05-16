import React, { createContext, useContext, useState, useEffect } from "react";
import PropTypes from "prop-types";

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

    setUser(userData);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    return { success: true, user: userData };
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
    // cleanup legacy key if present
    localStorage.removeItem("user");
  };

  const isAdmin = () => {
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
