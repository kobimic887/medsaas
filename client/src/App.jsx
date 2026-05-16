import { Routes, Route, Navigate } from "react-router-dom";
import { Dashboard, Auth, MainPage } from "@/layouts";
import { getAuthToken } from "@/utils/constants";

function RequireAuth({ children }) {
  const token = getAuthToken();
  if (!token) {
    return <Navigate to="/auth/sign-in" replace />;
  }
  return children;
}

function App() {
  const isAuthenticated = !!getAuthToken();

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
