import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { RouteFallback } from "@/widgets/layout/route-fallback";
import { hasValidToken } from "@/utils/constants";

// The three layouts split too, not just the pages inside them. Each one drags in its
// own navbars, the sidenav and the branding hook, and a signed-out visitor landing on
// the marketing site has no use for the dashboard shell. Imported directly rather than
// through "@/layouts", whose barrel would re-export all three into whichever chunk
// touched it first.
const Dashboard = lazy(() => import("@/layouts/dashboard"));
const Auth = lazy(() => import("@/layouts/auth"));
const MainPage = lazy(() => import("@/layouts/mainpage"));

function RequireAuth({ children }) {
  // Validate expiry, not just presence — an expired token left in localStorage
  // must not mount the dashboard (that caused the "flash then 403 storm").
  if (!hasValidToken()) {
    return <Navigate to="/auth/sign-in" replace />;
  }
  return children;
}

function App() {
  const isAuthenticated = hasValidToken();

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route
          path="/dashboard/*"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route path="/main/*" element={<MainPage />} />
        <Route
          path="/auth/*"
          element={isAuthenticated ? <Navigate to="/dashboard/controlpanel" replace /> : <Auth />}
        />
        <Route path="*" element={<Navigate to="/main/mainHome" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
