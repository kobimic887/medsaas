import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "@material-tailwind/react";
import { MaterialTailwindControllerProvider } from "@/context";
import { AuthProvider } from "@/context/auth";
import { BrandingProvider } from "@/context/branding";
import { BlogProvider } from "@/context/blog";
import { installAuthInterceptor } from "@/utils/authInterceptor";
import "./tailwind.css";
import "molstar/lib/mol-plugin-ui/skin/light.scss";
import "./styles/molstar.css";

// Auto-redirect to sign-in when any same-origin API call returns 401 (expired/invalid token).
installAuthInterceptor();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <MaterialTailwindControllerProvider>
          <AuthProvider>
            <BrandingProvider>
              <BlogProvider>
                <App />
              </BlogProvider>
            </BrandingProvider>
          </AuthProvider>
        </MaterialTailwindControllerProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
