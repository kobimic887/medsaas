import { Routes, Route } from "react-router-dom";
import { Cog6ToothIcon } from "@heroicons/react/24/solid";
import { IconButton } from "@material-tailwind/react";
import {
  Sidenav,
  DashboardNavbar,
  Configurator,
  Footer,
} from "@/widgets/layout";
import routes from "@/routes";
import { useMaterialTailwindController, setOpenConfigurator } from "@/context";

export function Dashboard() {
  const [controller, dispatch] = useMaterialTailwindController();
  const { sidenavType, openSidenav } = controller;

  return (
    <div id="dashboard-layout" className="min-h-screen bg-blue-gray-50/50 flex">
      {/* Left Sidebar Navigation */}
      <div id="sidebar-container" className="relative">
        <Sidenav
          routes={routes}
          brandImg="/img/logo-ct.png"
          brandName="Pyxis Discovery"
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
            {routes.map(
              ({ layout, pages }) =>
                layout === "dashboard" &&
                pages.map(({ path, element }) => (
                  <Route exact path={path} element={element} />
                ))
            )}
          </Routes>
        </main>

        {/* Footer */}
        <footer id="dashboard-footer" className="text-blue-gray-600 p-4">
          <Footer />
        </footer>
      </div>

      {/* Configurator */}
      <Configurator />
      <IconButton
        id="configurator-button"
        size="lg"
        color="white"
        className="fixed bottom-8 right-8 z-40 rounded-full shadow-blue-gray-900/10"
        ripple={false}
        onClick={() => setOpenConfigurator(dispatch, true)}
      >
        <Cog6ToothIcon className="h-5 w-5" />
      </IconButton>
    </div>
  );
}

Dashboard.displayName = "/src/layout/dashboard.jsx";

export default Dashboard;
