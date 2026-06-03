import { useLocation, Link, useNavigate } from "react-router-dom";
import {
  Navbar,
  Typography,
  Button,
  IconButton,
  Breadcrumbs,
  Input,
  Menu,
  MenuHandler,
  MenuList,
  MenuItem,
  Avatar,
  Chip,
} from "@material-tailwind/react";
import {
  UserCircleIcon,
  Cog6ToothIcon,
  BellIcon,
  ClockIcon,
  CreditCardIcon,
  Bars3Icon,
  MagnifyingGlassIcon,
  XMarkIcon,
  TrashIcon,
} from "@heroicons/react/24/solid";
import {
  useMaterialTailwindController,
  setOpenConfigurator,
  setOpenSidenav,
} from "@/context";
import { loadStripe } from '@stripe/stripe-js';

// Initialize Stripe
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
import React, { useState, useEffect } from "react";
import { API_CONFIG, getAuthToken } from "@/utils/constants";

export function DashboardNavbar() {
  const [controller, dispatch] = useMaterialTailwindController();
  const { fixedNavbar, openSidenav } = controller;
  const { pathname } = useLocation();
  const [layout, page] = pathname.split("/").filter((el) => el !== "");
  const [showMobileSearch, setShowMobileSearch] = useState(false);

  // User info state
  const [user, setUser] = useState({ name: "", simulationTokens: 0 });
  const [cartItems, setCartItems] = useState([]);
  const [cartTotal, setCartTotal] = useState(0);
  const navigate = useNavigate();

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
    };
  }, []);

  useEffect(() => {
    validateTokenAndLoadUser();
  }, [pathname]);

  const validateTokenAndLoadUser = async () => {
    const token = getAuthToken();
    const apiUrl = API_CONFIG.buildApiUrl("/validate-token");
    
    if (!token) {
      console.log("No token found, redirecting to main");
      navigate("/main/mainhome", { replace: true });
      return;
    }
    
    fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Invalid token");
        return res.json();
      })
      .then((data) => {
        // Add null check for data
        if (!data) {
          console.error("Received null/undefined data from validate-token API");
          navigate("/main/mainhome", { replace: true });
          return;
        }
        
        if (!data.valid) {
          navigate("/main/mainhome", { replace: true });
        } else {
          // If backend returns user info and tokens, update localStorage and state
          if (data.user) {
            localStorage.setItem("user_info", JSON.stringify(data.user));
          }
          if (data.user && typeof data.user.simulationTokens !== 'undefined') {
            setUser({
              name: data.user.username || data.user.email || "User",
              simulationTokens: data.user.simulationTokens
            });
          } else {
            // Fallback to localStorage user info
            const storedUser = localStorage.getItem("user_info");
            if (storedUser) {
              try {
                const parsedUser = JSON.parse(storedUser);
                setUser({
                  name: parsedUser.username || parsedUser.email || "User",
                  simulationTokens: parsedUser.simulationTokens || 0
                });
              } catch (e) {
                console.error("Error parsing stored user info:", e);
                setUser({ name: "User", simulationTokens: 0 });
              }
            }
          }
        }
      })
      .catch((err) => {
        console.error("Token validation failed:", err);
        navigate("/main/mainhome", { replace: true });
      });
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

      // Use the existing /api/send-email endpoint with the correct format
      const response = await fetch(API_CONFIG.buildApiUrl('/send-email'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: userName,
          subject: `Shopping Cart Enquiry from ${userName}`,
          message: emailMessage,
          recipientEmail: 'contact@pyxis-discovery.com'
        })
      });

      const result = await response.json();
      
      if (response.ok && result.success) {
        alert('Enquiry sent successfully! We will contact you soon.');
      } else {
        throw new Error(result.error || 'Failed to send enquiry');
      }
    } catch (error) {
      console.error('Error sending enquiry:', error);
      alert(`Failed to send enquiry: ${error.message}. Please try again.`);
    }
  };

  const handleCheckout = async () => {
    try {
      // Check if Stripe is configured
      if (!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY) {
        alert('Stripe is not configured. Please check the setup instructions.');
        return;
      }

      if (cartItems.length === 0) {
        alert('Your cart is empty!');
        return;
      }

      // Calculate total
      const total = cartItems.reduce((sum, item) => sum + (item.totalPrice || item.price || 0), 0);

      // Create a description of cart items for Stripe
      const itemsDescription = cartItems.map((item, index) => 
        `${index + 1}. ${item.name || 'Molecule'} - ${item.amount}mg: $${(item.totalPrice || item.price || 0).toFixed(2)}`
      ).join('; ');

      const token = localStorage.getItem('auth_token');
      
      // Create checkout session
      const response = await fetch(`https://${window.location.hostname}:3000/create-checkout-session-onetime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          cartItems: cartItems,
          totalAmount: total,
          description: itemsDescription
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
      console.error('Error during checkout:', error);
      alert(`Failed to start checkout: ${error.message}`);
    }
  };

  const logout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("user_info");
    localStorage.removeItem("moleculeCart");
    navigate("/main/mainhome", { replace: true });
  };

  return (
    <Navbar
      id="top-navbar"
      color="white"
      className="sticky top-0 z-40 py-3 shadow-md shadow-blue-gray-500/5 rounded-none border-b border-blue-gray-100"
      fullWidth
      blurred={true}
    >
      <div id="navbar-content" className="flex items-center justify-between w-full px-4">
        {/* Left Side - Mobile Menu Toggle and Breadcrumbs */}
        <div id="navbar-left" className="flex items-center gap-4">
          {/* Mobile Menu Toggle */}
          <IconButton
            id="mobile-menu-toggle"
            variant="text"
            color="blue-gray"
            className="grid xl:hidden"
            onClick={() => setOpenSidenav(dispatch, !openSidenav)}
          >
            <Bars3Icon strokeWidth={3} className="h-6 w-6 text-blue-gray-500" />
          </IconButton>

          {/* Breadcrumbs */}
          <div id="breadcrumbs" className="hidden lg:block">
            <Breadcrumbs className="bg-transparent p-0">
              <Link to="/dashboard/controlpanel" className="opacity-60">
                Dashboard
              </Link>
              <Typography
                variant="small"
                color="blue-gray"
                className="font-normal opacity-100 capitalize"
              >
                {page || "Home"}
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
        <div id="navbar-right" className="flex items-center gap-2">
          {/* Mobile Search Toggle */}
          <IconButton
            id="mobile-search-toggle"
            variant="text"
            color="blue-gray"
            className="grid md:hidden"
            onClick={() => setShowMobileSearch(!showMobileSearch)}
          >
            {showMobileSearch ? (
              <XMarkIcon className="h-5 w-5 text-blue-gray-500" />
            ) : (
              <MagnifyingGlassIcon className="h-5 w-5 text-blue-gray-500" />
            )}
          </IconButton>

          {/* Simulation Tokens Display */}
          <div className="hidden md:flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1">
            <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <Typography variant="small" color="blue-gray" className="font-medium">
             Remaining Tokens: {user.simulationTokens}
            </Typography>
          </div>

          {/* Cart Menu */}
          <Menu>
            <MenuHandler>
              <IconButton id="cart-menu-button" variant="text" color="blue-gray">
                <div className="relative">
                  <CreditCardIcon className="h-5 w-5 text-blue-gray-500" />
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
            <MenuList id="cart-menu-list" className="w-80 border-0 shadow-lg">
              <div className="p-3 border-b border-blue-gray-100">
                <Typography variant="h6" color="blue-gray">
                  Molecule Cart ({cartItems.length} {cartItems.length === 1 ? 'item' : 'items'})
                </Typography>
                <div className="flex justify-between items-center mt-1">
                  <Typography variant="small" color="blue-gray" className="font-normal">
                    Total Amount: {cartItems.reduce((sum, item) => sum + (item.amount || 0), 0)}mg
                  </Typography>
                  <Typography variant="small" color="green" className="font-bold text-lg">
                    Total: ${cartTotal.toFixed(2)}
                  </Typography>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {cartItems.length === 0 ? (
                  <div className="p-4 text-center">
                    <Typography variant="small" color="blue-gray" className="font-normal">
                      Your cart is empty
                    </Typography>
                  </div>
                ) : (
                  cartItems.map((item, index) => (
                    <MenuItem key={index} className="flex items-center justify-between p-3 border-b border-blue-gray-50">
                      <div className="flex-1">
                        <Typography variant="small" color="blue-gray" className="font-medium">
                          {item.name || `Molecule ${index + 1}`}
                        </Typography>
                        <div className="flex items-center gap-2 mt-1">
                          <Typography variant="small" color="blue-gray" className="font-normal text-xs">
                            {item.amount}mg
                          </Typography>
                          <Typography variant="small" color="green" className="font-bold text-xs">
                            ${(item.totalPrice || item.price || 0).toFixed(2)}
                          </Typography>
                        </div>
                        {item.smiles && (
                          <Typography variant="small" color="gray" className="font-mono truncate max-w-48 text-xs">
                            {item.smiles.length > 30 ? `${item.smiles.substring(0, 30)}...` : item.smiles}
                          </Typography>
                        )}
                      </div>
                      <IconButton
                        variant="text"
                        color="red"
                        size="sm"
                        onClick={() => removeFromCart(index)}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </IconButton>
                    </MenuItem>
                  ))
                )}
              </div>
              {cartItems.length > 0 && (
                <div className="p-3 border-t border-blue-gray-100 space-y-2">
                  <Button 
                    fullWidth 
                    color="blue" 
                    size="sm"
                    onClick={handleCheckout}
                  >
                    Checkout with Stripe
                  </Button>
                  <Button 
                    fullWidth 
                    color="green" 
                    size="sm"
                    onClick={handleSendEnquiry}
                  >
                    Send Enquiry
                  </Button>
                </div>
              )}
            </MenuList>
          </Menu>

          {/* Notifications Menu */}
          <Menu>
            <MenuHandler>
              <IconButton id="notifications-menu-button" variant="text" color="blue-gray">
                <BellIcon className="h-5 w-5 text-blue-gray-500" />
              </IconButton>
            </MenuHandler>
            <MenuList id="notifications-menu-list" className="w-max border-0">
              <MenuItem>No new notifications</MenuItem>
            </MenuList>
          </Menu>

          {/* User Menu */}
          <Menu>
            <MenuHandler>
              <Button
                id="user-menu-button"
                variant="text"
                color="blue-gray"
                className="flex items-center gap-2 rounded-full py-0.5 pr-2 pl-0.5 lg:ml-auto"
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
                  className="font-medium hidden lg:block"
                >
                  {user.name}
                </Typography>
              </Button>
            </MenuHandler>
            <MenuList id="user-menu-list" className="p-1">
              <div className="p-2 border-b border-blue-gray-100">
                <Typography variant="small" color="blue-gray" className="font-medium">
                  {user.name}
                </Typography>
                <Typography variant="small" color="blue-gray" className="font-normal text-xs">
                  Simulation Tokens: {user.simulationTokens}
                </Typography>
              </div>
              <MenuItem className="flex items-center gap-2">
                <UserCircleIcon className="h-4 w-4" />
                <Link to="/dashboard/profile" className="w-full">
                  Profile
                </Link>
              </MenuItem>
              <MenuItem className="flex items-center gap-2">
                <Cog6ToothIcon className="h-4 w-4" />
                Settings
              </MenuItem>
              <hr className="my-2 border-blue-gray-50" />
              <MenuItem className="flex items-center gap-2 text-red-500" onClick={logout}>
                Sign Out
              </MenuItem>
            </MenuList>
          </Menu>
        </div>
      </div>
    </Navbar>
  );
}

DashboardNavbar.displayName = "/src/widgets/layout/dashboard-navbar.jsx";

export default DashboardNavbar;
