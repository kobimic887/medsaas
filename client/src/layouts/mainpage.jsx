import { Routes, Route } from "react-router-dom";
import {  
  MainNavbar,
  Footer,
} from "@/widgets/layout";
import routes from "@/routes";

export function MainPage() {
  return (
    <div className="min-h-screen bg-blue-gray-50/50 flex flex-col">
      <div className="flex-1 flex flex-col">
        <MainNavbar />
        <div className="flex-1 flex flex-col p-4">
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
        <div className="text-blue-gray-600">
          <Footer />
        </div>
      </div>
    </div>
  );
}

MainPage.displayName = "/src/layout/mainpage.jsx";

export default MainPage;
