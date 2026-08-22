import React, { Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { RouteFallback } from "@/widgets/layout/route-fallback";
import {
  Sidenav,
  DashboardNavbar,
  Footer,
} from "@/widgets/layout";
import routes from "@/routes";
import { ThemeProvider } from "@material-tailwind/react";
import { useMaterialTailwindController, MaterialTailwindControllerProvider } from "@/context";
import { useBranding } from "@/hooks/useBranding";
import { SkipLink } from "@/components/SkipLink";

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
      <div className="mt-8 rounded-lg border border-red-100 bg-white p-6 shadow-sm dark:border-red-900/60 dark:bg-slate-900 dark:shadow-black/20">
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-300">
          This dashboard page could not load.
        </h2>
        <p className="mt-2 text-sm text-blue-gray-600 dark:text-slate-300">
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

// The providers Material Tailwind needs live here rather than in main.jsx, so the
// library is pulled in with this lazy chunk instead of the entry. DashboardShell
// consumes the controller, so it has to sit *below* the provider — hence the split.
export function Dashboard() {
  return (
    <ThemeProvider>
      <MaterialTailwindControllerProvider>
        <DashboardShell />
      </MaterialTailwindControllerProvider>
    </ThemeProvider>
  );
}

function DashboardShell() {
  const [controller] = useMaterialTailwindController();
  const { openSidenav } = controller;
  // The sidebar header names the product, not the tenant. This used to render
  // useBranding()'s brandName, which is the company name when one is set — so the
  // owner of "kobi inc" saw "kobi inc" in the top-left while the demo account,
  // which carries no company name, correctly saw "Pyxis Discovery". One product,
  // one name, same for everyone. The per-company logo and palette still apply;
  // it is only the wordmark that stops varying.
  const { platformName, logo } = useBranding();

  return (
    <div id="dashboard-layout" className="flex min-h-screen overflow-x-hidden bg-blue-gray-50/50 text-blue-gray-900 dark:bg-slate-950 dark:text-slate-100">
      <SkipLink />
      {/* Left Sidebar Navigation */}
      <div id="sidebar-container" className="relative">
        <Sidenav
          routes={routes}
          brandImg={logo?.dataUrl || null}
          brandName={platformName}
        />
      </div>

      {/* Main Content Area */}
      <div 
        id="main-content-wrapper" 
        className={`min-w-0 flex-1 flex flex-col transition-all duration-300 ${
          openSidenav ? 'xl:ml-72' : 'xl:ml-0'
        }`}
      >
        {/* Top Navigation Header */}
        <header id="top-header" className="sticky top-0 z-30">
          <DashboardNavbar />
        </header>

        {/* Main Content */}
        <main id="main-content" className="min-w-0 flex-1 p-4">
          <Routes>
            <Route index element={<Navigate to="dashboardHome" replace />} />
            {routes.flatMap(({ layout, pages }) =>
              layout === "dashboard"
                ? pages.map(({ path, element }) => (
                    <Route
                      key={path}
                      path={path.replace(/^\/+/, "")}
                      // Pages are lazy (routes.jsx), so a Suspense boundary is mandatory.
                      // Per route, and inside the error boundary: the skeleton is scoped to
                      // the page being opened rather than blanking the whole content area,
                      // and a chunk that fails to download — stale hash after a deploy, a
                      // dropped connection — still lands in the reload prompt rather than
                      // on a white screen.
                      element={
                        <DashboardRouteBoundary>
                          <Suspense fallback={<RouteFallback />}>{element}</Suspense>
                        </DashboardRouteBoundary>
                      }
                    />
                  ))
                : []
            )}
            <Route path="*" element={<Navigate to="dashboardHome" replace />} />
          </Routes>
        </main>

        {/* Footer */}
        <div id="dashboard-footer" className="p-4 text-blue-gray-600 dark:text-slate-400">
          <Footer />
        </div>
      </div>
    </div>
  );
}

Dashboard.displayName = "/src/layout/dashboard.jsx";

export default Dashboard;
