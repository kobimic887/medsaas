import { Suspense } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import {
  MainNavbar,
  Footer,
} from "@/widgets/layout";
import { RouteFallback } from "@/widgets/layout/route-fallback";
import { SkipLink } from "@/components/SkipLink";
import routes from "@/routes";

export function MainPage() {
  const { pathname } = useLocation();
  const isLandingPage = pathname.includes("/mainHome");

  return (
    <div
      className={`flex min-h-screen flex-col transition-colors duration-300 ${
        isLandingPage ? "bg-[#0a0a0f]" : "bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
      }`}
    >
      <SkipLink />
      <div className="flex-1 flex flex-col">
        <MainNavbar />
        <main id="main-content" className={`flex-1 flex flex-col ${isLandingPage ? "" : "p-4"}`}>
          {/* Marketing pages are lazy (routes.jsx); Suspense is mandatory once they are. */}
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {routes.flatMap(({ layout, pages }) =>
                layout === "main"
                  ? pages.map(({ path, element }) => (
                      <Route key={path} exact path={path} element={element} />
                    ))
                  : []
              )}
            </Routes>
          </Suspense>
        </main>
        {!isLandingPage && (
          <div className="text-blue-gray-600 dark:text-slate-400">
            <Footer />
          </div>
        )}
      </div>
    </div>
  );
}

MainPage.displayName = "/src/layout/mainpage.jsx";

export default MainPage;
