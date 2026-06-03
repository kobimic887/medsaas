import { Routes, Route, Navigate } from "react-router-dom";
import { Dashboard, Auth, MainPage } from "@/layouts";
import { isLocalhost, API_CONFIG } from "@/utils/constants";
import { useEffect, useState } from "react";

function App() {
  const [localhostAuthComplete, setLocalhostAuthComplete] = useState(false);

  // Perform automatic login on localhost
  useEffect(() => {
    const performLocalhostLogin = async () => {
      if (isLocalhost()) {
        // Check if already logged in
        const existingToken = localStorage.getItem("access_token");
        if (existingToken) {
          setLocalhostAuthComplete(true);
          return;
        }

        try {
          console.log("Performing automatic localhost login...");
          const res = await fetch(API_CONFIG.buildApiUrl('/signin'), {
            method: "POST",
            headers: { "Content-Type": "application/json", accept: "*/*" },
            body: JSON.stringify({ 
              username: "anton", 
              password: "Ag06086!" 
            }),
          });
          
          const data = await res.json();
          
          if (res.ok && data.token) {
            // Store tokens and user info
            localStorage.setItem("auth_token", data.token);
            localStorage.setItem("access_token", data.token);
            localStorage.setItem("user_info", JSON.stringify(data.user || { username: "anton" }));
            console.log("Localhost login successful");
          } else {
            console.error("Localhost login failed:", data.error || "Unknown error");
          }
        } catch (error) {
          console.error("Localhost login error:", error);
        }
      }
      setLocalhostAuthComplete(true);
    };

    performLocalhostLogin();
  }, []);

  // Don't render routes until localhost auth is complete
  if (isLocalhost() && !localhostAuthComplete) {
    return (
      <div className="min-h-screen bg-blue-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-blue-gray-600">Authenticating for localhost development...</p>
        </div>
      </div>
    );
  }
  
  // Redirect to control panel on localhost, otherwise go to main page
  const defaultRoute = isLocalhost() ? "/dashboard/controlpanel" : "/main/mainHome";
  
  return (
    <Routes>
      <Route path="/dashboard/*" element={<Dashboard />} />
      <Route path="/main/*" element={<MainPage />} />
      <Route path="/auth/*" element={<Auth />} />
      <Route path="*" element={<Navigate to={defaultRoute} replace />} />
    </Routes>
  );
}

export default App;
