import { Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { RouteFallback } from "@/widgets/layout/route-fallback";
import { SkipLink } from "@/components/SkipLink";
import routes from "@/routes";

export function Auth() {
  return (
    <div className="relative min-h-screen w-full">
      <SkipLink />
      {/* Sign-in is lazy (routes.jsx); Suspense is mandatory once it is. */}
      <main id="main-content">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {routes.flatMap(({ layout, pages }) =>
              layout === "auth"
                ? pages.map(({ path, element }) => (
                    <Route key={path} exact path={path} element={element} />
                  ))
                : []
            )}
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

Auth.displayName = "/src/layout/Auth.jsx";

export default Auth;
