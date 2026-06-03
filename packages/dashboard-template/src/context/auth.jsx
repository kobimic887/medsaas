import React, { createContext, useContext, useState, useEffect } from "react";
import PropTypes from "prop-types";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user is stored in localStorage
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    setIsLoading(false);
  }, []);

  const login = (email, password) => {
    // Simple admin check - in production this would be a proper API call
    if (email === 'admin@admin.com' && (password === '' || password === 'admin')) {
      const adminUser = {
        email: 'admin@admin.com',
        name: 'Admin',
        role: 'admin',
        isAdmin: true
      };
      setUser(adminUser);
      localStorage.setItem('user', JSON.stringify(adminUser));
      return { success: true, user: adminUser };
    } else {
      // Regular user login (for now just accept any other email)
      const regularUser = {
        email: email,
        name: email.split('@')[0],
        role: 'user',
        isAdmin: false
      };
      setUser(regularUser);
      localStorage.setItem('user', JSON.stringify(regularUser));
      return { success: true, user: regularUser };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('user');
  };

  const isAdmin = () => {
    return user?.isAdmin || false;
  };

  const isLoggedIn = () => {
    return !!user;
  };

  const value = {
    user,
    login,
    logout,
    isAdmin,
    isLoggedIn,
    isLoading
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
