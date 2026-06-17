import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "@material-tailwind/react";
import { MaterialTailwindControllerProvider } from "@/context";
import { AuthProvider } from "@/context/auth";
import { BrandingProvider } from "@/context/branding";
import { BlogProvider } from "@/context/blog";
import { initializeThemeMode, ThemeModeProvider } from "@/context/theme";
import { installAuthInterceptor } from "@/utils/authInterceptor";
import "./tailwind.css";

// Auto-redirect to sign-in when any same-origin API call returns 401 (expired/invalid token).
installAuthInterceptor();
initializeThemeMode();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ThemeModeProvider>
          <MaterialTailwindControllerProvider>
            <AuthProvider>
              <BrandingProvider>
                <BlogProvider>
                  <App />
                </BlogProvider>
              </BrandingProvider>
            </AuthProvider>
          </MaterialTailwindControllerProvider>
        </ThemeModeProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
