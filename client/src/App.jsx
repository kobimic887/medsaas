import { Routes, Route, Navigate } from "react-router-dom";
import { Dashboard, Auth, MainPage } from "@/layouts";
import { hasValidToken } from "@/utils/constants";

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
  );
}

export default App;
