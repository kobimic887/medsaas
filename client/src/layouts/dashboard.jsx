import { Routes, Route } from "react-router-dom";
import {
  Sidenav,
  DashboardNavbar,
  Footer,
} from "@/widgets/layout";
import routes from "@/routes";
import { useMaterialTailwindController } from "@/context";
import { useBranding } from "@/hooks/useBranding";

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
            {routes.flatMap(({ layout, pages }) =>
              layout === "dashboard"
                ? pages.map(({ path, element }) => (
                    <Route key={path} exact path={path} element={element} />
                  ))
                : []
            )}
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
