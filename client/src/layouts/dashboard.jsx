import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import {
  Sidenav,
  DashboardNavbar,
  Footer,
} from "@/widgets/layout";
import routes from "@/routes";
import { useMaterialTailwindController } from "@/context";
import { useBranding } from "@/hooks/useBranding";

class DashboardErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Dashboard route failed to render:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mt-8 rounded-lg border border-red-100 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-red-700">
          This dashboard page could not load.
        </h2>
        <p className="mt-2 text-sm text-blue-gray-600">
          Try reloading the page. If it keeps happening, the error is now logged in the browser console instead of leaving a blank screen.
        </p>
        <button
          type="button"
          className="mt-4 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white"
          onClick={() => window.location.reload()}
        >
          Reload page
        </button>
      </div>
    );
  }
}

function DashboardRouteBoundary({ children }) {
  const { pathname } = useLocation();
  return <DashboardErrorBoundary key={pathname}>{children}</DashboardErrorBoundary>;
}

export function Dashboard() {
  const [controller] = useMaterialTailwindController();
  const { openSidenav } = controller;
  const { brandName, logo } = useBranding();

  return (
    <div id="dashboard-layout" className="min-h-screen bg-blue-gray-50/50 flex">
      {/* Left Sidebar Navigation */}
      <div id="sidebar-container" className="relative">
        <Sidenav
          routes={routes}
          brandImg={logo?.dataUrl || null}
          brandName={brandName}
        />
      </div>

      {/* Main Content Area */}
      <div 
        id="main-content-wrapper" 
        className={`flex-1 flex flex-col transition-all duration-300 ${
          openSidenav ? 'xl:ml-72' : 'xl:ml-0'
        }`}
      >
        {/* Top Navigation Header */}
        <header id="top-header" className="sticky top-0 z-30">
          <DashboardNavbar />
        </header>

        {/* Main Content */}
        <main id="main-content" className="flex-1 p-4">
          <Routes>
            <Route index element={<Navigate to="dashboardHome" replace />} />
            {routes.flatMap(({ layout, pages }) =>
              layout === "dashboard"
                ? pages.map(({ path, element }) => (
                    <Route
                      key={path}
                      path={path.replace(/^\/+/, "")}
                      element={<DashboardRouteBoundary>{element}</DashboardRouteBoundary>}
                    />
                  ))
                : []
            )}
            <Route path="*" element={<Navigate to="dashboardHome" replace />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer id="dashboard-footer" className="text-blue-gray-600 p-4">
          <Footer />
        </footer>
      </div>
    </div>
  );
}

Dashboard.displayName = "/src/layout/dashboard.jsx";

export default Dashboard;
