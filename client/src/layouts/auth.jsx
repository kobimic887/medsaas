import { Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import {
  ChartPieIcon,
  UserIcon,
  UserPlusIcon,
  ArrowRightOnRectangleIcon,
} from "@heroicons/react/24/solid";
import { RouteFallback } from "@/widgets/layout/route-fallback";
import routes from "@/routes";

export function Auth() {
  const _navbarRoutes = [
    {
      name: "dashboard",
      path: "/dashboard/home",
      icon: ChartPieIcon,
    },
    {
      name: "profile",
      path: "/dashboard/home",
      icon: UserIcon,
    },
    {
      name: "sign up",
      path: "/auth/sign-up",
      icon: UserPlusIcon,
    },
    {
      name: "sign in",
      path: "/auth/sign-in",
      icon: ArrowRightOnRectangleIcon,
    },
  ];

  return (
    <div className="relative min-h-screen w-full">
      {/* Sign-in and sign-up are lazy (routes.jsx); Suspense is mandatory once they are. */}
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
    </div>
  );
}

Auth.displayName = "/src/layout/Auth.jsx";

export default Auth;
