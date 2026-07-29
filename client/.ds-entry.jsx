// Design-system bundle entry for /design-sync (claude.ai/design).
// Re-exports the reusable components onto the design-sync global and provides a
// single preview-context wrapper (MemoryRouter + the app's controller/auth/
// theme providers) so context-coupled layout widgets render in isolation.
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { MaterialTailwindControllerProvider } from "./src/context";
import { AuthProvider } from "./src/context/auth";
import { ThemeModeContext } from "./src/context/theme";

// Cards
export { MessageCard } from "./src/widgets/cards/message-card";
export { ProfileInfoCard } from "./src/widgets/cards/profile-info-card";
export { StatisticsCard } from "./src/widgets/cards/statistics-card";
// Charts
export { StatisticsChart } from "./src/widgets/charts/statistics-chart";
// Brand
export { BrandingPreview } from "./src/components/BrandingPreview";
// Layout
export { Sidenav } from "./src/widgets/layout/sidenav";
export { DashboardNavbar } from "./src/widgets/layout/dashboard-navbar";
export { Footer } from "./src/widgets/layout/footer";

// Preview-only context wrapper (cfg.provider). Not a component card.
// The app defaults to DARK theme (DEFAULT_THEME="dark", which sets
// <html class="dark">). For a canonical, light-first design-system showcase we
// pin a fixed LIGHT theme value here instead of the app's ThemeModeProvider —
// this satisfies useThemeMode() without the html-class side-effect, so the
// forced-dark CSS never engages. Components still support dark via dark: variants.
const lightTheme = {
  theme: "light",
  isDark: false,
  setTheme: () => {},
  toggleTheme: () => {},
};

export function DsPreviewProvider({ children }) {
  return (
    <MemoryRouter>
      <ThemeModeContext.Provider value={lightTheme}>
        <AuthProvider>
          <MaterialTailwindControllerProvider>
            {children}
          </MaterialTailwindControllerProvider>
        </AuthProvider>
      </ThemeModeContext.Provider>
    </MemoryRouter>
  );
}
