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
import { useThemeMode } from "@/context/theme";
import { useState } from "react";

export function MainNavbar() {
  const { pathname } = useLocation();
  const [_layout, page] =  pathname.split("/").filter((el) => el !== "");
  const { isLoggedIn, logout, user, isAdmin } = useAuth();
  const { isDark, toggleTheme } = useThemeMode();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isLandingPage = page === "mainHome";

  const navLinks = [];


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
              background: isLandingPage
                ? "linear-gradient(135deg, #a855f7, #3b82f6)"
                : isDark
                  ? "linear-gradient(135deg, #c4b5fd, #67e8f9)"
                  : "#1e293b",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            ChemBench
          </span>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              isLandingPage
                ? "bg-purple-500/15 text-purple-300 border border-purple-500/20"
                : "bg-blue-50 text-blue-600 dark:border dark:border-blue-500/30 dark:bg-blue-950/50 dark:text-blue-200"
            }`}
          >
            BETA
          </span>
        </Link>

        {/* Desktop Nav Links (Removed) */}
        <div className="hidden xl:flex items-center gap-1">
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
                    <Link to="/dashboard/controlpanel" className="w-full">
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
                    ? "bg-gradient-to-r from-purple-500 to-blue-500 text-white shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40"
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
        <div className={`xl:hidden border-t px-4 py-3 space-y-1 ${
          isLandingPage ? "border-white/5 bg-[#0a0a0f]/95" : "border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-950"
        }`}>
          {navLinks.map(({ label, to }) => (
            <Link key={to} to={to} onClick={() => setMobileOpen(false)}>
              <div
                className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isLandingPage
                      ? "text-gray-300 hover:text-white hover:bg-white/5"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                }`}
              >
                {label}
              </div>
            </Link>
          ))}
          {!isLoggedIn() && (
            <Link to="/auth/sign-in" onClick={() => setMobileOpen(false)}>
              <div className={`block px-3 py-2 rounded-lg text-sm font-semibold ${
                isLandingPage ? "text-purple-300" : "text-blue-600 dark:text-brand-300"
              }`}>
                Sign In
              </div>
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}

MainNavbar.displayName = "/src/widgets/layout/main-navbar.jsx";

export default MainNavbar;
