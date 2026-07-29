import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/context/auth";
import { BrandingProvider } from "@/context/branding";
import { initializeThemeMode, ThemeModeProvider } from "@/context/theme";
import { installAuthInterceptor } from "@/utils/authInterceptor";
import "./tailwind.css";

// Auto-redirect to sign-in when any same-origin API call returns 401 (expired/invalid token).
installAuthInterceptor();
initializeThemeMode();

// Material Tailwind's ThemeProvider and the sidenav controller used to wrap the
// whole app from here, which put the entire component library (vendor-ui, ~56 kB
// gzipped) on the critical path of every cold load — including the sign-in page,
// which is hand-written CSS and renders no Material Tailwind component at all.
// Both now live inside layouts/dashboard.jsx, the only subtree that consumes
// them, so a visitor who lands on sign-in never downloads the library.
//
// BlogProvider went with the blog page; nothing read it any more.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeModeProvider>
        <AuthProvider>
          <BrandingProvider>
            <App />
          </BrandingProvider>
        </AuthProvider>
      </ThemeModeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
