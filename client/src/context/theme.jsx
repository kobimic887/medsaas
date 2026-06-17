import React from "react";
import PropTypes from "prop-types";

const THEME_STORAGE_KEY = "medsaas-theme";
const DEFAULT_THEME = "dark";

export const ThemeModeContext = React.createContext(null);
ThemeModeContext.displayName = "ThemeModeContext";

function isValidTheme(value) {
  return value === "dark" || value === "light";
}

function readStoredTheme() {
  if (typeof window === "undefined") return DEFAULT_THEME;

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isValidTheme(storedTheme) ? storedTheme : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function applyTheme(theme) {
  if (typeof document === "undefined") return;

  const isDark = theme === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  if (document.body) {
    document.body.dataset.theme = theme;
    document.body.style.colorScheme = theme;
  }
}

export function initializeThemeMode() {
  const theme = readStoredTheme();
  applyTheme(theme);
  return theme;
}

export function ThemeModeProvider({ children }) {
  const [theme, setTheme] = React.useState(initializeThemeMode);

  React.useLayoutEffect(() => {
    applyTheme(theme);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // localStorage can be unavailable in private contexts; the in-memory
      // theme still applies for the current session.
    }
  }, [theme]);

  const value = React.useMemo(
    () => ({
      theme,
      isDark: theme === "dark",
      setTheme,
      toggleTheme: () => setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark")),
    }),
    [theme]
  );

  return (
    <ThemeModeContext.Provider value={value}>
      {children}
    </ThemeModeContext.Provider>
  );
}

ThemeModeProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export function useThemeMode() {
  const context = React.useContext(ThemeModeContext);

  if (!context) {
    throw new Error("useThemeMode should be used inside ThemeModeProvider.");
  }

  return context;
}
