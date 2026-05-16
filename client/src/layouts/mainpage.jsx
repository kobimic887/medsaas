import { Routes, Route, useLocation } from "react-router-dom";
import {  
  MainNavbar,
  Footer,
} from "@/widgets/layout";
import routes from "@/routes";

export function MainPage() {
  const { pathname } = useLocation();
  const isLandingPage = pathname.includes("/mainHome");

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: isLandingPage ? "#0a0a0f" : "#f8fafc",
        transition: "background 0.3s ease",
      }}
    >
      <div className="flex-1 flex flex-col">
        <MainNavbar />
        <div className={`flex-1 flex flex-col ${isLandingPage ? "" : "p-4"}`}>
          <Routes>
            {routes.flatMap(({ layout, pages }) =>
              layout === "main"
                ? pages.map(({ path, element }) => (
                    <Route key={path} exact path={path} element={element} />
                  ))
                : []
            )}
          </Routes>
        </div>
        {!isLandingPage && (
          <div className="text-blue-gray-600">
            <Footer />
          </div>
        )}
      </div>
    </div>
  );
}

MainPage.displayName = "/src/layout/mainpage.jsx";

export default MainPage;
