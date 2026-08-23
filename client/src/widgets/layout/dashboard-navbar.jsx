import { useLocation, useNavigate } from "react-router-dom";
import {
  Navbar,
  Typography,
  Button,
  IconButton,
  Breadcrumbs,
  Menu,
  MenuHandler,
  MenuList,
  MenuItem,
  Avatar,
  Chip,
  Alert,
} from "@material-tailwind/react";
import {
  BellIcon,
  CreditCardIcon,
  Bars3Icon,
  MagnifyingGlassIcon,
  XMarkIcon,
  TrashIcon,
  MoonIcon,
  SunIcon,
} from "@heroicons/react/24/solid";
import {
  useMaterialTailwindController,
  setOpenSidenav,
} from "@/context";
import { useThemeMode } from "@/context/theme";
import { useState, useEffect, useRef } from "react";
import { API_CONFIG, getAuthToken } from "@/utils/constants";

const NAVBAR_VALIDATE_TIMEOUT_MS = 15_000;
const CART_FETCH_TIMEOUT_MS = 15_000;

const PAGE_DESTINATIONS = [
  { label: "Dashboard", path: "/dashboard/dashboardHome" },
  { label: "Home", path: "/dashboard/controlpanel" },
  { label: "Simulation", path: "/dashboard/simulation" },
  { label: "Simulation Results", path: "/dashboard/molstar3d" },
  { label: "Molecule Viewer", path: "/dashboard/moleculeviewer" },
  { label: "Generate Molecules", path: "/dashboard/generate-molecules" },
  { label: "Protein Folding", path: "/dashboard/protein-folding" },
  { label: "Deep Similarity", path: "/dashboard/deep-similarity" },
  { label: "Literature", path: "/dashboard/literature" },
  { label: "Notifications", path: "/dashboard/notifications" },
  { label: "Plans & Credits", path: "/dashboard/paid-plans" },
];

const getStoredNavbarUser = () => {
  try {
    const storedUser = JSON.parse(localStorage.getItem("user_info") || "null");
    if (!storedUser) return { name: "", simulationTokens: 0 };
    return {
      name: storedUser.username || storedUser.email || "User",
      simulationTokens: Number(storedUser.simulationTokens) || 0,
    };
  } catch {
    return { name: "", simulationTokens: 0 };
  }
};

export function DashboardNavbar() {
  const [controller, dispatch] = useMaterialTailwindController();
  const { openSidenav } = controller;
  const { isDark, toggleTheme } = useThemeMode();
  const { pathname } = useLocation();
  const routeSegments = pathname.split("/").filter(Boolean);
  const page = routeSegments.length === 0 || (routeSegments.length === 1 && routeSegments[0] === "dashboard")
    ? "dashboardHome"
    : routeSegments[routeSegments.length - 1];
  const pageLabels = {
    dashboardHome: "Home",
    controlpanel: "Home",
    companyadmin: "Company Admin",
    "company-admin": "Company Admin",
    simulation: "Simulation",
    moleculeviewer: "Molecule Viewer",
    molstar3d: "Molstar 3D",
    literature: "Literature",
    "generate-molecules": "Generate Molecules",
    "protein-folding": "Protein Folding",
    "gromacs-md": "GROMACS MD",
    "glioblastoma-predict": "Glioblastoma Prediction",
    "deep-similarity": "Deep Similarity",
    notifications: "Notifications",
    paidplans: "Plans & Credits",
  };
  const pageLabel = pageLabels[page] || page
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [pageQuery, setPageQuery] = useState("");

  // User info state
  const [user, setUser] = useState(getStoredNavbarUser);
  const [cartItems, setCartItems] = useState([]);
  const [cartTotal, setCartTotal] = useState(0);
  const [cartAction, setCartAction] = useState(null);
  const [actionMessage, setActionMessage] = useState("");
  const [actionMessageType, setActionMessageType] = useState("success");
  const actionMessageTimerRef = useRef(null);
  const cartRequestControllerRef = useRef(null);
  const cartTimeoutRef = useRef(null);
  const navigate = useNavigate();

  const matchingPages = PAGE_DESTINATIONS.filter(({ label }) =>
    label.toLowerCase().includes(pageQuery.trim().toLowerCase()),
  );

  const showActionMessage = (message, type = "success") => {
    if (actionMessageTimerRef.current) window.clearTimeout(actionMessageTimerRef.current);
    setActionMessage(message);
    setActionMessageType(type);
    actionMessageTimerRef.current = window.setTimeout(() => {
      setActionMessage("");
      actionMessageTimerRef.current = null;
    }, 6000);
  };

  useEffect(() => {
    // Load cart data from localStorage
    loadCartFromStorage();
    
    // Set up storage event listener to update cart when changed in other tabs/components
    const handleStorageChange = (e) => {
      if (e.key === 'moleculeCart') {
        loadCartFromStorage();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    // Also set up a custom event listener for cart updates within the same tab
    const handleCartUpdate = () => {
      loadCartFromStorage();
    };
    
    window.addEventListener('cartUpdated', handleCartUpdate);
    
    // Cleanup
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('cartUpdated', handleCartUpdate);
      if (actionMessageTimerRef.current) window.clearTimeout(actionMessageTimerRef.current);
      window.clearTimeout(cartTimeoutRef.current);
      cartRequestControllerRef.current?.abort();
      cartRequestControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), NAVBAR_VALIDATE_TIMEOUT_MS);
    validateTokenAndLoadUser(controller.signal);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [pathname]);

  const validateTokenAndLoadUser = async (signal) => {
    const token = getAuthToken();
    const apiUrl = API_CONFIG.buildApiUrl("/validate-token");
    
    if (!token) {
      navigate("/auth/sign-in", { replace: true });
      return;
    }
    
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("Invalid token");
      const data = await response.json();

      if (!data?.valid) {
        navigate("/auth/sign-in", { replace: true });
        return;
      }

      if (data.user) localStorage.setItem("user_info", JSON.stringify(data.user));
      setUser(data.user && typeof data.user.simulationTokens !== "undefined"
        ? {
            name: data.user.username || data.user.email || "User",
            simulationTokens: data.user.simulationTokens,
          }
        : getStoredNavbarUser());
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("Token validation failed:", err);
      navigate("/auth/sign-in", { replace: true });
    }
  };

  const loadCartFromStorage = () => {
    try {
      const cart = localStorage.getItem('moleculeCart');
      if (cart) {
        const cartData = JSON.parse(cart);
        
        // Handle different cart data structures
        if (Array.isArray(cartData)) {
          // Simple array format from simulation page
          setCartItems(cartData);
          const total = cartData.reduce((sum, item) => sum + (item.totalPrice || item.price || 0), 0);
          setCartTotal(total);
        } else if (cartData.items && Array.isArray(cartData.items)) {
          // Object format with items and total
          setCartItems(cartData.items);
          setCartTotal(cartData.total || 0);
        } else {
          // Unknown format, reset cart
          setCartItems([]);
          setCartTotal(0);
        }
      } else {
        setCartItems([]);
        setCartTotal(0);
      }
    } catch (error) {
      console.error('Error loading cart from storage:', error);
      setCartItems([]);
      setCartTotal(0);
    }
  };

  const removeFromCart = (index) => {
    try {
      const cart = localStorage.getItem('moleculeCart');
      if (cart) {
        const cartData = JSON.parse(cart);
        
        let updatedItems;
        if (Array.isArray(cartData)) {
          // Simple array format
          updatedItems = [...cartData];
          updatedItems.splice(index, 1);
        } else if (cartData.items && Array.isArray(cartData.items)) {
          // Object format with items
          updatedItems = [...cartData.items];
          updatedItems.splice(index, 1);
        } else {
          return; // Unknown format
        }
        
        const newTotal = updatedItems.reduce((sum, item) => sum + (item.totalPrice || item.price || 0), 0);
        
        // Save in object format for consistency
        const newCartData = {
          items: updatedItems,
          total: newTotal
        };
        
        localStorage.setItem('moleculeCart', JSON.stringify(newCartData));
        loadCartFromStorage();
        
        // Dispatch a custom event to notify other components
        window.dispatchEvent(new Event('cartUpdated'));
      }
    } catch (error) {
      console.error('Error removing item from cart:', error);
    }
  };

  const handleSendEnquiry = async () => {
    cartRequestControllerRef.current?.abort();
    window.clearTimeout(cartTimeoutRef.current);
    const controller = new AbortController();
    cartRequestControllerRef.current = controller;
    let timedOut = false;
    cartTimeoutRef.current = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CART_FETCH_TIMEOUT_MS);
    setCartAction("enquiry");
    try {
      // Get logged-in user email from localStorage
      const storedUser = localStorage.getItem("user_info");
      let userEmail = 'unknown@example.com';
      let userName = user.name || 'Customer';
      
      if (storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser);
          userEmail = parsedUser.email || userEmail;
          userName = parsedUser.username || parsedUser.email || userName;
        } catch (e) {
          console.error("Error parsing stored user info:", e);
        }
      }

      const cartData = {
        items: cartItems,
        total: cartTotal,
        user: { ...user, email: userEmail },
        timestamp: new Date().toISOString()
      };

      // Format cart items for email body
      const cartItemsText = cartData.items.map((item, index) => `
${index + 1}. SMILES: ${item.smiles || 'N/A'}
   Amount: ${item.amount || 'N/A'}mg
   Price: $${(item.totalPrice || item.price || 0).toFixed(2)}
   ${item.name ? `Name: ${item.name}` : ''}
      `).join('\n');

      const emailMessage = `
SHOPPING CART ENQUIRY

Customer Information:
- Name: ${userName}
- Email: ${userEmail}
- Simulation Tokens: ${cartData.user.simulationTokens || 0}

Cart Details:
${cartItemsText}

TOTAL AMOUNT: ${cartData.items.reduce((sum, item) => sum + (item.amount || 0), 0)}mg
TOTAL PRICE: $${cartData.total.toFixed(2)}

Timestamp: ${new Date(cartData.timestamp).toLocaleString()}

Please contact the customer at ${userEmail} to process this order.
      `;

      // Use the existing /api/send-email endpoint with the correct format.
      // It requires a bearer token — without one it answers 401, and the global
      // interceptor reads any same-origin 401 as a dead session, so submitting a
      // cart enquiry signed the customer out instead of sending the enquiry.
      const emailToken = getAuthToken();
      const response = await fetch(API_CONFIG.buildApiUrl('/send-email'), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(emailToken ? { Authorization: `Bearer ${emailToken}` } : {})
        },
        body: JSON.stringify({
          name: userName,
          subject: `Shopping Cart Enquiry from ${userName}`,
          message: emailMessage,
          // The visitor's own address, not a destination. /api/send-email always
          // delivers to CONTACT_RECIPIENT/EMAIL_USER and uses this only as the
          // reply-to, so sending a brand mailbox here made every cart enquiry
          // reply to itself instead of to the customer.
          recipientEmail: userEmail
        })
      });

      const result = await response.json().catch(() => null);
      
      if (response.ok && result?.success) {
        showActionMessage('Enquiry sent. We will contact you soon.');
      } else {
        throw new Error(result?.error || `Failed to send enquiry (HTTP ${response.status})`);
      }
    } catch (error) {
      if (error.name === "AbortError") {
        if (timedOut) showActionMessage('Enquiry timed out. Please try again.', 'error');
        return;
      }
      console.error('Error sending enquiry:', error);
      showActionMessage(`Failed to send enquiry: ${error.message}. Please try again.`, 'error');
    } finally {
      window.clearTimeout(cartTimeoutRef.current);
      if (cartRequestControllerRef.current === controller) {
        cartRequestControllerRef.current = null;
        setCartAction(null);
      }
    }
  };

  const handleCheckout = async () => {
    let controller = null;
    let timedOut = false;
    try {
      // Check if Stripe is configured
      if (!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY) {
        showActionMessage('Checkout is temporarily unavailable. Please send an enquiry instead.', 'error');
        return;
      }

      if (cartItems.length === 0) {
        showActionMessage('Your cart is empty.', 'error');
        return;
      }

      cartRequestControllerRef.current?.abort();
      window.clearTimeout(cartTimeoutRef.current);
      controller = new AbortController();
      cartRequestControllerRef.current = controller;
      timedOut = false;
      cartTimeoutRef.current = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, CART_FETCH_TIMEOUT_MS);
      setCartAction("checkout");

      const token = getAuthToken();
      
      // Create checkout session
      const response = await fetch(API_CONFIG.buildUrl('/create-checkout-session-onetime'), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          cartItems,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create checkout session');
      }

      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.error);
      }

      // Redirect to checkout
      window.location.href = result.url;
      
    } catch (error) {
      if (error.name === "AbortError") {
        if (timedOut) showActionMessage('Checkout timed out. Please try again.', 'error');
        return;
      }
      console.error('Error during checkout:', error);
      showActionMessage(`Failed to start checkout: ${error.message}`, 'error');
    } finally {
      window.clearTimeout(cartTimeoutRef.current);
      if (controller && cartRequestControllerRef.current === controller) {
        cartRequestControllerRef.current = null;
        setCartAction(null);
      }
    }
  };

  const logout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("auth_token");
    localStorage.removeItem("user_info");
    localStorage.removeItem("moleculeCart");
    navigate("/auth/sign-in", { replace: true });
  };

  return (
    <Navbar
      id="top-navbar"
      color="white"
      className="rounded-none border-b border-blue-gray-100 bg-white/95 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90"
      fullWidth
      blurred={true}
    >
      {actionMessage && (
        <div className="fixed right-4 top-20 z-[70] w-[min(24rem,calc(100vw-2rem))]" role="status" aria-live="polite">
          <Alert
            color={actionMessageType === "error" ? "red" : "green"}
            dismissible
            onClose={() => setActionMessage("")}
          >
            {actionMessage}
          </Alert>
        </div>
      )}
      <div id="navbar-content" className="flex min-w-0 items-center justify-between gap-3 px-4">
        {/* Left Side - Mobile Menu Toggle and Breadcrumbs */}
        <div id="navbar-left" className="flex min-w-0 items-center gap-4">
          {/* Mobile Menu Toggle */}
          <IconButton
            id="mobile-menu-toggle"
            variant="text"
            color="blue-gray"
            className="grid dark:text-slate-300 xl:hidden"
            aria-label={openSidenav ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setOpenSidenav(dispatch, !openSidenav)}
          >
            <Bars3Icon strokeWidth={3} className="h-6 w-6 text-blue-gray-500 dark:text-slate-300" />
          </IconButton>

          {/* Current page label. The old parent crumb exposed the internal route
              layout name ("Dashboard") and raw slugs ("Deep-Similarity"). */}
          <div id="breadcrumbs" className="hidden min-w-0 lg:block">
            <Breadcrumbs className="bg-transparent p-0">
              <Typography
                variant="small"
                color="blue-gray"
                className="truncate font-medium opacity-100 dark:text-slate-100"
              >
                {pageLabel}
              </Typography>
            </Breadcrumbs>
          </div>
        </div>

        {/* Center - Search Bar */}
        {/* <div id="navbar-center" className="flex-1 max-w-md mx-4">
          <div className={`${showMobileSearch ? 'block' : 'hidden md:block'}`}>
            <Input
              id="search-input"
              type="search"
              placeholder="Search..."
              className="!border-blue-gray-300 focus:!border-blue-500"
              labelProps={{
                className: "before:content-none after:content-none",
              }}
              icon={<MagnifyingGlassIcon className="h-5 w-5" />}
            />
          </div>
        </div> */}

        {/* Right Side - Actions and User Menu */}
        <div id="navbar-right" className="flex shrink-0 items-center gap-2">
          {/* Mobile Search Toggle */}
          <IconButton
            id="mobile-search-toggle"
            variant="text"
            color="blue-gray"
            className="grid dark:text-slate-300 md:hidden"
            aria-label={showMobileSearch ? "Close page finder" : "Open page finder"}
            aria-expanded={showMobileSearch}
            onClick={() => setShowMobileSearch(!showMobileSearch)}
          >
            {showMobileSearch ? (
              <XMarkIcon className="h-5 w-5 text-blue-gray-500 dark:text-slate-300" />
            ) : (
              <MagnifyingGlassIcon className="h-5 w-5 text-blue-gray-500 dark:text-slate-300" />
            )}
          </IconButton>

          {/* Simulation Tokens Display */}
          <div className="hidden items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1 dark:border-blue-500/30 dark:bg-blue-950/50 md:flex">
            <svg aria-hidden="true" className="h-4 w-4 text-blue-600 dark:text-blue-300" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <Typography variant="small" color="blue-gray" className="font-medium dark:text-slate-200">
             Remaining Tokens: {user.simulationTokens}
            </Typography>
          </div>

          <IconButton
            id="theme-toggle-button"
            variant="text"
            color="blue-gray"
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="dark:text-slate-300"
            onClick={toggleTheme}
          >
            {isDark ? (
              <SunIcon className="h-5 w-5 text-blue-gray-500 dark:text-amber-300" />
            ) : (
              <MoonIcon className="h-5 w-5 text-blue-gray-500" />
            )}
          </IconButton>

          {/* Cart Menu */}
          <Menu>
            <MenuHandler>
              <IconButton id="cart-menu-button" variant="text" color="blue-gray" className="dark:text-slate-300" aria-label={`Open molecule cart with ${cartItems.length} items`}>
                <div className="relative">
                  <CreditCardIcon className="h-5 w-5 text-blue-gray-500 dark:text-slate-300" />
                  {cartItems.length > 0 && (
                    <Chip
                      value={cartItems.length}
                      size="sm"
                      className="absolute -top-2 -right-2 h-5 w-5 bg-red-500 text-white text-xs flex items-center justify-center"
                    />
                  )}
                </div>
              </IconButton>
            </MenuHandler>
            <MenuList id="cart-menu-list" className="w-80 border-0 bg-white shadow-lg dark:border dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
              <div className="border-b border-blue-gray-100 p-3 dark:border-slate-800">
                <Typography variant="h6" color="blue-gray" className="dark:text-slate-50">
                  Molecule Cart ({cartItems.length} {cartItems.length === 1 ? 'item' : 'items'})
                </Typography>
                <div className="flex justify-between items-center mt-1">
                  <Typography variant="small" color="blue-gray" className="font-normal dark:text-slate-300">
                    Total Amount: {cartItems.reduce((sum, item) => sum + (item.amount || 0), 0)}mg
                  </Typography>
                  <Typography variant="small" className="font-bold text-lg text-brand-500">
                    Total: ${cartTotal.toFixed(2)}
                  </Typography>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {cartItems.length === 0 ? (
                  <div className="p-4 text-center">
                    <Typography variant="small" color="blue-gray" className="font-normal dark:text-slate-300">
                      Your cart is empty
                    </Typography>
                  </div>
                ) : (
                  cartItems.map((item, index) => (
                    <MenuItem key={index} className="flex items-center justify-between border-b border-blue-gray-50 p-3 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800">
                      <div className="flex-1">
                        <Typography variant="small" color="blue-gray" className="font-medium dark:text-slate-100">
                          {item.name || `Molecule ${index + 1}`}
                        </Typography>
                        <div className="flex items-center gap-2 mt-1">
                          <Typography variant="small" color="blue-gray" className="text-xs font-normal dark:text-slate-300">
                            {item.amount}mg
                          </Typography>
                          <Typography variant="small" className="font-bold text-xs text-brand-500">
                            ${(item.totalPrice || item.price || 0).toFixed(2)}
                          </Typography>
                        </div>
                        {item.smiles && (
                          <Typography variant="small" color="gray" className="max-w-48 truncate font-mono text-xs dark:text-slate-400">
                            {item.smiles.length > 30 ? `${item.smiles.substring(0, 30)}...` : item.smiles}
                          </Typography>
                        )}
                      </div>
                      <IconButton
                        variant="text"
                        color="red"
                        size="sm"
                        aria-label={`Remove ${item.name || `molecule ${index + 1}`} from cart`}
                        onClick={() => removeFromCart(index)}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </IconButton>
                    </MenuItem>
                  ))
                )}
              </div>
              {cartItems.length > 0 && (
                <div className="space-y-2 border-t border-blue-gray-100 p-3 dark:border-slate-800">
                  <Button 
                    fullWidth 
                    color="blue" 
                    size="sm"
                    onClick={handleCheckout}
                    disabled={cartAction !== null}
                  >
                    {cartAction === "checkout" ? "Opening checkout…" : "Checkout with Stripe"}
                  </Button>
                  <Button
                    fullWidth
                    size="sm"
                    onClick={handleSendEnquiry}
                    disabled={cartAction !== null}
                    className="bg-brand-500 text-white shadow-md shadow-brand-500/20 hover:shadow-lg hover:shadow-brand-500/40 focus:opacity-[0.85] focus:shadow-none active:opacity-[0.85] active:shadow-none"
                  >
                    {cartAction === "enquiry" ? "Sending enquiry…" : "Send Enquiry"}
                  </Button>
                </div>
              )}
            </MenuList>
          </Menu>

          {/* Notifications Menu */}
          <Menu>
            <MenuHandler>
              <IconButton id="notifications-menu-button" variant="text" color="blue-gray" className="dark:text-slate-300" aria-label="Open notifications">
                <BellIcon className="h-5 w-5 text-blue-gray-500 dark:text-slate-300" />
              </IconButton>
            </MenuHandler>
            <MenuList id="notifications-menu-list" className="w-max border-0 bg-white dark:border dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
              <MenuItem className="dark:hover:bg-slate-800">No new notifications</MenuItem>
            </MenuList>
          </Menu>

          {/* User Menu */}
          <Menu>
            <MenuHandler>
              <Button
                id="user-menu-button"
                variant="text"
                color="blue-gray"
                className="flex items-center gap-2 rounded-full py-0.5 pr-2 pl-0.5 dark:text-slate-300 lg:ml-auto"
              >
                <Avatar
                  variant="circular"
                  size="sm"
                  alt="User Avatar"
                  className="border border-gray-900 p-0.5"
                  src="/img/team-1.jpeg"
                />
                <Typography
                  variant="small"
                  color="blue-gray"
                  className="hidden font-medium dark:text-slate-100 lg:block"
                >
                  {user.name}
                </Typography>
              </Button>
            </MenuHandler>
            <MenuList id="user-menu-list" className="bg-white p-1 dark:border dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
              <div className="border-b border-blue-gray-100 p-2 dark:border-slate-800">
                <Typography variant="small" color="blue-gray" className="font-medium dark:text-slate-100">
                  {user.name}
                </Typography>
                <Typography variant="small" color="blue-gray" className="text-xs font-normal tabular-nums dark:text-slate-300">
                  Simulation Tokens: {user.simulationTokens}
                </Typography>
              </div>
              {/* The Profile entry is gone with the page it opened. It was Creative Tim
                  filler — fabricated colleagues with stock photos and dead reply buttons,
                  social-network toggles, an invented bio — and nothing on it was this
                  product's. The two facts it did carry that users want, name and token
                  balance, are already in this menu directly above. */}
              <hr className="my-2 border-blue-gray-50 dark:border-slate-800" />
              <MenuItem className="flex items-center gap-2 text-red-500 dark:hover:bg-slate-800" onClick={logout}>
                Sign Out
              </MenuItem>
            </MenuList>
          </Menu>
        </div>
      </div>
      {showMobileSearch && (
        <div className="mt-3 border-t border-blue-gray-100 px-4 pt-3 dark:border-slate-800 md:hidden">
          <label htmlFor="dashboard-page-finder" className="sr-only">Find a dashboard page</label>
          <div className="flex items-center gap-2 rounded-lg border border-blue-gray-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
            <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-blue-gray-400" aria-hidden="true" />
            <input
              id="dashboard-page-finder"
              type="search"
              value={pageQuery}
              onChange={(event) => setPageQuery(event.target.value)}
              placeholder="Find a dashboard page"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-blue-gray-900 outline-none placeholder:text-blue-gray-400 dark:text-slate-100"
            />
          </div>
          <nav className="mt-2 grid max-h-56 gap-1 overflow-y-auto" aria-label="Matching dashboard pages">
            {matchingPages.length > 0 ? matchingPages.map((destination) => (
              <button
                key={destination.path}
                type="button"
                className="rounded-md px-3 py-2 text-left text-sm text-blue-gray-800 hover:bg-blue-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={() => {
                  navigate(destination.path);
                  setShowMobileSearch(false);
                  setPageQuery("");
                }}
              >
                {destination.label}
              </button>
            )) : (
              <p className="px-3 py-2 text-sm text-blue-gray-500 dark:text-slate-400">No matching pages.</p>
            )}
          </nav>
        </div>
      )}
    </Navbar>
  );
}

DashboardNavbar.displayName = "/src/widgets/layout/dashboard-navbar.jsx";

export default DashboardNavbar;
