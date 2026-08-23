import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { RouteFallback } from "@/widgets/layout/route-fallback";
import { hasValidToken } from "@/utils/constants";

// Both layouts split too, not just the pages inside them. Each drags in its own
// navbar, the sidenav and the branding hook, and a signed-out visitor has no use
// for the dashboard shell. Imported directly rather than through "@/layouts", whose
// barrel would re-export both into whichever chunk touched it first.
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
        <Route
          path="/auth/*"
          element={isAuthenticated ? <Navigate to="/dashboard/controlpanel" replace /> : <Auth />}
        />
        <Route path="/main/*" element={<MainPage />} />
        {/* Marketing landing lives in this repo (`/main/*`). Public is pyxis-web on
            84 :5174. An already-authenticated visitor never stops here: /auth/* above
            bounces them on to the dashboard. */}
        <Route path="*" element={<Navigate to="/main/mainHome" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
