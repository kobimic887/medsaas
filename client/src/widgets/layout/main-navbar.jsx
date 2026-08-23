import { useLocation, Link } from "react-router-dom";
import {
  IconButton,
  Menu,
  MenuHandler,
  MenuList,
  MenuItem,
} from "@material-tailwind/react";
import {
  UserCircleIcon,
  Bars3Icon,
  MoonIcon,
  SunIcon,
} from "@heroicons/react/24/solid";
import { useAuth } from "@/context/auth";
import { getPlatformName } from "@/config/branding";
import { useThemeMode } from "@/context/theme";
import { useState } from "react";

export function MainNavbar() {
  const { pathname } = useLocation();
  const [_layout, page] =  pathname.split("/").filter((el) => el !== "");
  const { isLoggedIn, logout, user, isAdmin } = useAuth();
  const { isDark, toggleTheme } = useThemeMode();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isLandingPage = page === "mainHome";

  const navLinks = [
    { label: "Home", to: "/main/mainHome" },
    { label: "Services", to: "/main/services" },
    { label: "About", to: "/main/about-us" },
    { label: "Insights", to: "/main/insights" },
    { label: "Plans", to: "/main/paidplansdescription" },
    { label: "Contact", to: "/main/contact-us" },
  ];

  return (
    <nav
      className={`w-full z-50 transition-all duration-300 ${
        isLandingPage
          ? "fixed top-0 left-0 bg-[#0a0a0f]/80 backdrop-blur-lg border-b border-white/5"
          : "sticky top-0 border-b border-transparent bg-white shadow-md dark:border-slate-800 dark:bg-slate-950/95 dark:shadow-black/20"
      }`}
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Brand */}
        <Link to="/main/mainHome" className="flex items-center gap-2 no-underline">
          <span
            className="text-2xl font-extrabold tracking-tight"
            style={{
              fontFamily: "'Outfit', sans-serif",
              // Pyxis citron into the brand's teal. These were the retired product's
              // violet/blue and violet/cyan pairs, which is why the brand mark on the
              // marketing site still rendered purple after the rebrand.
              background: isLandingPage
                ? "linear-gradient(135deg, #b4b239, #4d8b80)"
                : isDark
                  ? "linear-gradient(135deg, #d4d26a, #6fae9f)"
                  : "#072824",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            {getPlatformName()}
          </span>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              isLandingPage
                ? "bg-brand-500/15 text-brand-300 border border-brand-500/20"
                : "bg-brand-50 text-brand-700 dark:border dark:border-brand-500/30 dark:bg-brand-900/50 dark:text-brand-200"
            }`}
          >
            BETA
          </span>
        </Link>

        {/* Desktop navigation */}
        <div className="hidden xl:flex items-center gap-1">
          {navLinks.map(({ label, to }) => {
            const isActive = pathname === to;
            return (
              <Link
                key={to}
                to={to}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium no-underline transition-colors ${
                  isLandingPage
                    ? isActive
                      ? "bg-white/10 text-white"
                      : "text-gray-300 hover:bg-white/5 hover:text-white"
                    : isActive
                      ? "bg-brand-50 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className={`grid h-10 w-10 place-items-center rounded-lg transition-colors ${
              isLandingPage
                ? "text-gray-300 hover:bg-white/5 hover:text-white"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            }`}
            onClick={toggleTheme}
          >
            {isDark ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
          </button>
          {isLoggedIn() ? (
            <Menu>
              <MenuHandler>
                <button
                  type="button"
                  className={`hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isLandingPage
                      ? "text-gray-300 hover:text-white hover:bg-white/5"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  }`}
                >
                  <UserCircleIcon className="h-5 w-5" />
                  {user?.email || "User"}
                </button>
              </MenuHandler>
              <MenuList className="bg-white dark:border dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
                <MenuItem className="dark:hover:bg-slate-800">
                  <Link to="/dashboard/controlpanel" className="w-full">
                    Dashboard
                  </Link>
                </MenuItem>
                {isAdmin() && (
                  <MenuItem className="dark:hover:bg-slate-800">
                    <Link to="/dashboard/company-admin" className="w-full">
                      Admin Panel
                    </Link>
                  </MenuItem>
                )}
                <MenuItem className="dark:hover:bg-slate-800" onClick={logout}>Sign Out</MenuItem>
              </MenuList>
            </Menu>
          ) : (
            <Link to="/auth/sign-in" className="no-underline">
              <button
                type="button"
                className={`hidden xl:flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                  isLandingPage
                    ? "bg-gradient-to-r from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-500/25 hover:shadow-brand-500/40"
                    : "bg-blue-600 text-white hover:bg-blue-700 dark:bg-brand-500 dark:hover:bg-brand-400"
                }`}
              >
                Sign In
              </button>
              <IconButton
                variant="text"
                color="blue-gray"
                className="grid dark:text-slate-300 xl:hidden"
              >
                <UserCircleIcon className={`h-5 w-5 ${isLandingPage ? "text-gray-300" : "text-blue-gray-500 dark:text-slate-300"}`} />
              </IconButton>
            </Link>
          )}

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
            aria-controls="main-mobile-navigation"
            className={`xl:hidden p-2 rounded-lg transition-colors ${
              isLandingPage ? "text-gray-300 hover:bg-white/5" : "text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <Bars3Icon className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div id="main-mobile-navigation" className={`xl:hidden border-t px-4 py-3 space-y-1 ${
          isLandingPage ? "border-white/5 bg-[#0a0a0f]/95" : "border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-950"
        }`}>
          {navLinks.map(({ label, to }) => {
            const isActive = pathname === to;
            return (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                aria-current={isActive ? "page" : undefined}
                className={`block rounded-lg px-3 py-2 text-sm font-medium no-underline transition-colors ${
                    isLandingPage
                      ? isActive
                        ? "bg-white/10 text-white"
                        : "text-gray-300 hover:bg-white/5 hover:text-white"
                      : isActive
                        ? "bg-brand-50 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                }`}
              >
                {label}
              </Link>
            );
          })}
          {isLoggedIn() ? (
            <>
              <Link
                to="/dashboard/controlpanel"
                onClick={() => setMobileOpen(false)}
                className={`block rounded-lg px-3 py-2 text-sm font-semibold no-underline ${
                  isLandingPage ? "text-brand-300" : "text-brand-700 dark:text-brand-300"
                }`}
              >
                Dashboard
              </Link>
              {isAdmin() && (
                <Link
                  to="/dashboard/company-admin"
                  onClick={() => setMobileOpen(false)}
                  className={`block rounded-lg px-3 py-2 text-sm font-semibold no-underline ${
                    isLandingPage ? "text-brand-300" : "text-brand-700 dark:text-brand-300"
                  }`}
                >
                  Admin Panel
                </Link>
              )}
              <button
                type="button"
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${
                  isLandingPage ? "text-gray-300" : "text-gray-600 dark:text-slate-300"
                }`}
                onClick={() => {
                  setMobileOpen(false);
                  logout();
                }}
              >
                Sign Out
              </button>
            </>
          ) : (
            <Link
              to="/auth/sign-in"
              onClick={() => setMobileOpen(false)}
              className={`block rounded-lg px-3 py-2 text-sm font-semibold no-underline ${
                isLandingPage ? "text-brand-300" : "text-blue-600 dark:text-brand-300"
              }`}>
                Sign In
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}

MainNavbar.displayName = "/src/widgets/layout/main-navbar.jsx";

export default MainNavbar;
