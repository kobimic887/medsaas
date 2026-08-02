import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Link, NavLink } from "react-router-dom";
import { XMarkIcon } from "@heroicons/react/24/outline";
import {
  Button,
  IconButton,
  Typography,
} from "@material-tailwind/react";
import { useMaterialTailwindController, setOpenSidenav } from "@/context";
import { useAuth } from "@/context/auth";

export function Sidenav({ brandImg, brandName, routes }) {
  const [controller, dispatch] = useMaterialTailwindController();
  const { isAdmin } = useAuth();
  const [brandImageFailed, setBrandImageFailed] = useState(false);
  const { sidenavType, openSidenav } = controller;
  const sidenavTypes = {
    dark: "bg-gradient-to-br from-slate-900 to-slate-950 shadow-lg shadow-black/20",
    white: "bg-white shadow-sm dark:bg-slate-900/95 dark:shadow-black/20",
    transparent: "bg-transparent dark:bg-slate-900/60",
  };

  useEffect(() => {
    setBrandImageFailed(false);
  }, [brandImg]);

  const showBrandImage = Boolean(brandImg) && !brandImageFailed;

  return (
    <>
      {/* Mobile Overlay */}
      {openSidenav && (
        <div 
          id="mobile-overlay"
          className="fixed inset-0 z-40 bg-black bg-opacity-50 xl:hidden"
          onClick={() => setOpenSidenav(dispatch, false)}
        />
      )}
      <aside
        id="left-sidebar"
        className={`${sidenavTypes[sidenavType]} ${
          openSidenav ? "translate-x-0" : "-translate-x-80"
        } fixed inset-0 z-50 my-4 ml-4 flex h-[calc(100vh-32px)] w-72 flex-col overflow-hidden rounded-xl border border-blue-gray-100 transition-transform duration-300 dark:border-slate-800 xl:translate-x-0`}
      >
        {/* Sidebar Header */}
        <div id="sidebar-header" className="relative z-50 shrink-0">
          <Link to="/" className="flex min-h-[104px] flex-col items-center justify-center gap-2 px-8 py-5 text-center">
            {showBrandImage && (
              <img
                src={brandImg}
                alt={`${brandName} logo`}
                className="h-12 w-auto max-w-[160px] object-contain"
                onError={() => setBrandImageFailed(true)}
              />
            )}
            <Typography
              variant="h6"
              color={sidenavType === "dark" ? "white" : "blue-gray"}
              className="dark:text-slate-100"
            >
              {brandName}
            </Typography>
          </Link>
          <IconButton
            id="sidebar-close-button"
            variant="text"
            color={sidenavType === "dark" ? "white" : "blue-gray"}
            size="sm"
            ripple={false}
            className="absolute right-0 top-0 grid rounded-br-none rounded-tl-none dark:text-slate-200 xl:hidden"
            onClick={() => setOpenSidenav(dispatch, false)}
          >
            <XMarkIcon strokeWidth={2.5} className="h-5 w-5" />
          </IconButton>
        </div>
        
        {/* Sidebar Navigation Menu */}
        <div id="sidebar-menu" className="min-h-0 flex-1 overflow-y-auto m-4 pr-1">
          {routes.map(({ layout, title, pages }, key) => (
            <ul key={key} className="mb-4 flex flex-col gap-1">
              {title && (
                <li className="mx-3.5 mt-4 mb-2">
                  <Typography
                    variant="small"
                    color={sidenavType === "dark" ? "white" : "blue-gray"}
                    className="font-black uppercase opacity-75 dark:text-slate-400"
                  >
                    {title}
                  </Typography>
                </li>
              )}
              {pages.filter(page => !page.hideFromMenu && (!page.adminOnly || isAdmin())).map(({ icon, name, path }) => (
                <li key={name}>
                  <NavLink to={`/${layout}${path}`}>
                    {({ isActive }) => (
                      <Button
                        id={`sidebar-link-${name.replace(/\s+/g, '-').toLowerCase()}`}
                        variant="text"
                        color={isActive ? undefined : (sidenavType === "dark" ? "white" : "blue-gray")}
                        className={`flex items-center gap-4 px-4 capitalize dark:hover:bg-slate-800/80${isActive ? ' !bg-brand-500 !text-white' : ' dark:text-slate-300'}`}
                        fullWidth
                        onClick={() => {
                          // Close mobile menu when item is clicked
                          if (window.innerWidth < 1280) {
                            setOpenSidenav(dispatch, false);
                          }
                        }}
                      >
                        {icon}
                        <Typography
                          color="inherit"
                          className="font-medium capitalize"
                        >
                          {name}
                        </Typography>
                      </Button>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </aside>
    </>
  );
}

Sidenav.defaultProps = {
  brandImg: null,
  brandName: "Pyxis Discovery",
};

Sidenav.propTypes = {
  brandImg: PropTypes.string,
  brandName: PropTypes.string,
  routes: PropTypes.arrayOf(PropTypes.object).isRequired,
};

Sidenav.displayName = "/src/widgets/layout/sidnave.jsx";

export default Sidenav;
