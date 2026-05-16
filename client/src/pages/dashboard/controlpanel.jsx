import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Typography,
  Card,
  CardHeader,
  CardBody,
  IconButton,
  Menu,
  MenuHandler,
  MenuList,
  MenuItem,
  Avatar,
  Chip,
  Progress,
  Spinner,
  Alert,
  Button,
} from "@material-tailwind/react";
import {
  EllipsisVerticalIcon,
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  EyeIcon,
  CheckIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon, ClockIcon, ExclamationTriangleIcon, ShoppingCartIcon } from "@heroicons/react/24/solid";
import { API_CONFIG } from "@/utils/constants";

export function ControlPanel() {
  const navigate = useNavigate();
  const [activityData, setActivityData] = React.useState(null);
  const [userSimulationLogs, setUserSimulationLogs] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  
  // Price popup state
  const [showPricePopup, setShowPricePopup] = React.useState(false);
  const [priceData, setPriceData] = React.useState(null);
  const [priceLoading, setPriceLoading] = React.useState(false);
  const [currentSmiles, setCurrentSmiles] = React.useState('');
  
  // Cart state and functions
  const [cart, setCart] = React.useState([]);
  const [message, setMessage] = React.useState('');
  const [messageType, setMessageType] = React.useState('');

  // ADMET popup state
  const [showAdmetPopup, setShowAdmetPopup] = React.useState(false);
  const [admetData, setAdmetData] = React.useState(null);
  const [admetLoading, setAdmetLoading] = React.useState(false);
  const [currentSimulationId, setCurrentSimulationId] = React.useState('');

  // Function to fetch activities from API
  const fetchActivities = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('auth_token');
      const response = await fetch(API_CONFIG.buildApiUrl('/activity'), {
        headers: {
          "Content-Type": "application/json",
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setActivityData(data);
    } catch (err) {
      console.error('Error fetching activities:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Function to fetch simulation logs for current user
  const fetchUserSimulationLogs = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(API_CONFIG.buildApiUrl('/simulation-logs'), {
        headers: {
          "Content-Type": "application/json",
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      setUserSimulationLogs(data);
      console.log('Simulation logs data:', data); // Debug log to see data structure
    } catch (err) {
      console.error('Error fetching simulation logs:', err);
      setError(err.message);
    }
  };

  // Fetch activities and simulation logs on component mount
  React.useEffect(() => {
    fetchActivities();
    fetchUserSimulationLogs();
    loadCartFromStorage();
  }, []);

  // Format date for display
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString() + ' ' + new Date(dateString).toLocaleTimeString();
  };

  // Get status color based on simulation or project status
  const getStatusColor = (item) => {
    if (item.status === 'completed') return 'green';
    if (item.status === 'running') return 'blue';
    if (item.status === 'failed') return 'red';
    return 'gray';
  };

  // Check if ADMET data exists for a simulation log
  const hasAdmetData = (log) => {
    return log.admet && typeof log.admet === 'object' && Object.keys(log.admet).length > 0;
  };

  // Helper function to decode URL-encoded SMILES
  const decodeSmiles = (smiles) => {
    if (!smiles || smiles === 'N/A') return 'N/A';
    try {
      return decodeURIComponent(smiles);
    } catch (error) {
      // If decoding fails, return original string
      console.warn('Failed to decode SMILES:', smiles, error);
      return smiles;
    }
  };

  // Function to fetch price data from API
  const fetchPriceData = async (smiles) => {
    try {
      setPriceLoading(true);
      setCurrentSmiles(smiles);
      const token = localStorage.getItem('auth_token');      
      let _smiles = decodeURIComponent(smiles);      
      let _smiles1 = _smiles.split('\\').map(part => part.trim()).filter(part => part).join(`\\`);
      console.log('URL that will be sent:', API_CONFIG.buildApiUrl(`/asinex/exact/${encodeURIComponent(_smiles1)}`));
      const response = await fetch(API_CONFIG.buildApiUrl(`/asinex/exact/${_smiles}`), {
        headers: {
          "accept": "*/*",
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setPriceData(data);
      setShowPricePopup(true);
    } catch (err) {
      console.error('Error fetching price data:', err);
      setPriceData({ error: err.message });
      setShowPricePopup(true);
    } finally {
      setPriceLoading(false);
    }
  };

  // Function to fetch ADMET data from API
  const fetchAdmetData = async (simulationId) => {
    try {
      setAdmetLoading(true);
      setCurrentSimulationId(simulationId);
      const token = localStorage.getItem('auth_token');
      const response = await fetch(API_CONFIG.buildApiUrl(`/simulation/${simulationId}/admet`), {
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setAdmetData(data);
      setShowAdmetPopup(true);
      
      // Reload simulation logs after 2 seconds
      setTimeout(() => {
        fetchUserSimulationLogs();
      }, 2000);
    } catch (err) {
      console.error('Error fetching ADMET data:', err);
      setAdmetData({ error: err.message });
      setShowAdmetPopup(true);
    } finally {
      setAdmetLoading(false);
    }
  };

  // Cart utility functions
  const loadCartFromStorage = () => {
    try {
      const savedCart = localStorage.getItem('moleculeCart');
      if (savedCart) {
        const parsedCart = JSON.parse(savedCart);
        
        // Handle different cart data structures
        if (Array.isArray(parsedCart)) {
          // Simple array format (old format)
          setCart(parsedCart);
          return parsedCart;
        } else if (parsedCart.items && Array.isArray(parsedCart.items)) {
          // Object format with items and total (new format)
          setCart(parsedCart.items);
          return parsedCart.items;
        } else {
          // Unknown format, reset cart
          setCart([]);
          return [];
        }
      }
    } catch (error) {
      console.error('Error loading cart from storage:', error);
    }
    setCart([]);
    return [];
  };

  const saveCartToStorage = (cartItems) => {
    try {
      const total = cartItems.reduce((sum, item) => sum + (item.totalPrice || item.price || 0), 0);
      const cartData = {
        items: cartItems,
        total: total
      };
      localStorage.setItem('moleculeCart', JSON.stringify(cartData));
      // Dispatch custom event to notify other components
      window.dispatchEvent(new CustomEvent('cartUpdated'));
    } catch (error) {
      console.error('Error saving cart to storage:', error);
    }
  };

  const addToCart = (molecule, amount, pricePerMg) => {
    const cartItem = {
      id: `${currentSmiles}_${Date.now()}`,
      smiles: currentSmiles,
      name: molecule.id_number || molecule.IUPAC_NAME || molecule.name || 'Molecule',
      formula: molecule.brutto_formula || molecule.BRUTTO_FORMULA || molecule.formula || '',
      amount: amount,
      pricePerMg: pricePerMg,
      totalPrice: pricePerMg, // Do not multiply by amount - just use the price as is
      moleculeId: molecule.id || molecule.ASINEX_ID || molecule.id || 'N/A',
      availableMg: molecule.available_mg || molecule.AVAILABLE_MG || 0,
      addedAt: new Date().toISOString()
    };

    const updatedCart = [...cart, cartItem];
    setCart(updatedCart);
    saveCartToStorage(updatedCart);
    
    setMessage(`Added ${amount}mg of ${cartItem.name} to cart`);
    setMessageType('success');
    setTimeout(() => {
      setMessage('');
      setMessageType('');
    }, 3000);
  };

  // Handle navigation to molstar3d with simulation data
  const handleViewInMolstar = (log) => {
    const pdbId = log.pdbid || log.pdbId;
    const simulationKey = log.simulationKey || log.id;
    
    if (pdbId) {
      // Navigate to molstar3d with query parameters for the PDB and SDF data
      const queryParams = new URLSearchParams({
        pdb: pdbId,
        simulation: simulationKey || '',
        // Add any additional parameters that molstar3d might need
        ...(log.sdfData && { sdf: log.sdfData }),
        ...(log.resultsPath && { results: log.resultsPath }),
      });
      
      navigate(`/dashboard/molstar3d?${queryParams.toString()}`);
    } else {
      // Fallback: navigate without specific data
      navigate('/dashboard/molstar3d');
    }
  };

  return (
    <div className="mt-12">

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12">
          <Spinner className="h-8 w-8" />
          <Typography variant="small" color="gray">
            Loading control panel data...
          </Typography>
        </div>
      ) : activityData ? (
        <div className="space-y-8">
          {/* User Simulation Logs Table */}
          <Card className="border border-blue-gray-100 shadow-sm">
            <CardHeader
              floated={false}
              shadow={false}
              color="transparent"
              className="m-0 flex items-center justify-between p-6"
            >
              <div>
                <Typography variant="h6" color="blue-gray" className="mb-1">
                  Please find your Past Jobs listed below. You can review your past jobs by clicking on the SIMULATION ID                  
                </Typography>
                <Typography
                  variant="small"
                  className="flex items-center gap-1 font-normal text-blue-gray-600"
                >
                  <ClockIcon strokeWidth={3} className="h-4 w-4 text-blue-gray-200" />
                  <strong>{userSimulationLogs?.length || 0}</strong> simulation records
                </Typography>
                <Typography
                  variant="small"
                  className="mt-1 text-blue-gray-500"
                >
                  <button 
                    onClick={() => navigate('/dashboard/simulation')}
                    className="text-blue-600 hover:text-blue-800 underline hover:no-underline transition-colors"
                  >
                    Run a new simulation
                  </button>
                </Typography>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outlined" size="sm" className="flex items-center gap-2">
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  Export
                </Button>
                <Menu placement="left-start">
                  <MenuHandler>
                    <IconButton size="sm" variant="text" color="blue-gray">
                      <EllipsisVerticalIcon strokeWidth={3} className="h-6 w-6" />
                    </IconButton>
                  </MenuHandler>
                  <MenuList>
                    <MenuItem onClick={() => fetchUserSimulationLogs()}>Refresh Data</MenuItem>
                    <MenuItem>Filter by Status</MenuItem>
                    <MenuItem>Download Results</MenuItem>
                  </MenuList>
                </Menu>
              </div>
            </CardHeader>
            <CardBody className="overflow-x-scroll px-0 pt-0 pb-2" style={{ maxHeight: "70vh", overflowY: "auto" }}>
              <table className="w-full min-w-[640px] table-auto" id="results">
                <thead className="sticky top-0 bg-white z-10 shadow-sm">
                  <tr>
                    {["Simulation ID", "PDB ID", "SMILES", "Timestamp", "Status", "Price", "ADMET"].map((el, index) => (
                      <th 
                        key={el} 
                        className="border-b border-blue-gray-50 py-3 px-6 text-left bg-white"
                        style={index === 1 ? { width: '60px', minWidth: '60px', maxWidth: '60px' } : {}}
                        title={el === "ADMET" ? "ADMET-AI is a simple, fast, and accurate web interface for predicting the Absorption, Distribution, Metabolism, Excretion, and Toxicity (ADMET) properties of molecules using machine learning models" : ""}
                      >
                        <Typography variant="small" className="text-[12px] font-medium uppercase text-blue-gray-400">
                          {el}
                        </Typography>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {userSimulationLogs?.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="py-8 text-center">
                        <Typography variant="small" color="gray" className="text-sm">Loading simulation logs...</Typography>
                      </td>
                    </tr>
                  ) : (
                    userSimulationLogs?.map((log, key) => {
                      const className = `py-3 px-5 ${key === userSimulationLogs.length - 1 ? "" : "border-b border-blue-gray-50"}`;
                      const status = log.status || 'completed';
                      
                      return (
                        <tr key={log.simulationKey || log.id || key} className="hover:bg-blue-gray-50 cursor-pointer transition-colors">
                          <td className={className} onClick={() => handleViewInMolstar(log)}>
                            <Typography variant="small" color="blue-gray" className="font-mono text-sm hover:text-blue-600">
                              {log.simulationKey?.substring(0, 12) || log.id || 'N/A'}
                            </Typography>
                          </td>
                          <td 
                            className={className} 
                            onClick={() => handleViewInMolstar(log)}
                            style={{ width: '60px', minWidth: '60px', maxWidth: '60px', padding: '12px 4px' }}
                          >
                            <Typography variant="small" className="text-xs font-medium text-blue-gray-600 font-mono hover:text-blue-600" style={{ fontSize: '12px', lineHeight: '1.3' }}>
                              {(log.pdbid || log.pdbId || 'N/A').toString().substring(0, 10)}
                            </Typography>
                          </td>
                          <td className={className} onClick={() => handleViewInMolstar(log)} title={decodeSmiles(log.smiles || log.SMILES || 'N/A')}>
                            <Typography variant="small" className="text-xs font-medium text-blue-gray-600 font-mono hover:text-blue-600" style={{ fontSize: '12px', lineHeight: '1.3' }}>
                              {decodeSmiles(log.smiles || log.SMILES || 'N/A').toString().substring(0, 15)}
                            </Typography>
                          </td>
                          <td className={className} onClick={() => handleViewInMolstar(log)}>
                            <Typography variant="small" className="text-sm font-medium text-blue-gray-600">
                              {formatDate(log.timestamp || log.createdAt)}
                            </Typography>
                          </td>
                          <td className={className} onClick={() => handleViewInMolstar(log)}>
                            <Chip
                              variant="gradient"
                              color={getStatusColor({ status })}
                              value={status.charAt(0).toUpperCase() + status.slice(1)}
                              className="py-0.5 px-2 text-[12px] font-medium w-fit"
                            />
                          </td>
                          <td className={className}>
                            <Button
                              variant="outlined"
                              size="sm"
                              color="blue"
                              onClick={(e) => {
                                e.stopPropagation();
                                const smiles = log.smiles || log.SMILES || '';
                                if (smiles) {
                                  fetchPriceData(smiles);
                                }
                              }}
                              disabled={priceLoading || !log.smiles && !log.SMILES}
                              className="text-sm py-1 px-2"
                            >
                              {priceLoading && (currentSmiles === (log.smiles || log.SMILES)) ? 'Loading...' : 'Show Price'}
                            </Button>
                          </td>
                          <td className={className}>
                            <Button
                              variant="outlined"
                              size="sm"
                              color="blue"
                              onClick={(e) => {
                                e.stopPropagation();
                                const simulationId = log.simulationKey || log.id;
                                if (simulationId) {
                                  fetchAdmetData(simulationId);
                                }
                              }}
                              disabled={admetLoading || !log.simulationKey && !log.id}
                              className="text-sm py-1 px-2 flex items-center gap-1"
                              title={hasAdmetData(log) ? "ADMET data available" : "Click to calculate ADMET"}
                            >
                              {admetLoading && (currentSimulationId === (log.simulationKey || log.id)) ? (
                                'Loading...'
                              ) : (
                                <>
                                  {hasAdmetData(log) ? (
                                    <CheckIcon className="h-3 w-3 text-green-600" />
                                  ) : (
                                    <span className="text-red-500 font-bold text-xs">O</span>
                                  )}
                                  ADMET
                                </>
                              )}
                            </Button>
                          </td>
                          {/* <td className={className}>
                            <div className="flex items-center gap-2">
                              <IconButton 
                                variant="text" 
                                size="sm" 
                                title="View in Molstar3D"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleViewInMolstar(log);
                                }}
                              >
                                <EyeIcon className="h-4 w-4" />
                              </IconButton>
                              <IconButton variant="text" size="sm" title="View Details">
                                <MagnifyingGlassIcon className="h-4 w-4" />
                              </IconButton>
                              <IconButton variant="text" size="sm" title="Download Results">
                                <ArrowDownTrayIcon className="h-4 w-4" />
                              </IconButton>
                            </div>
                          </td> */}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </CardBody>
          </Card>

         


        </div>
      ) : (
        <div className="text-center py-12">
          <Typography variant="h6" color="gray">
            No data available
          </Typography>
          <Typography variant="small" color="gray" className="mt-2">
            Please ensure your API is running and accessible.
          </Typography>
          <Button variant="outlined" className="mt-4" onClick={fetchActivities}>
            Retry Loading
          </Button>
        </div>
      )}

      {/* Price Popup Modal */}
      {showPricePopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] overflow-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <Typography variant="h5" color="blue-gray">
                  Price Information
                </Typography>
                <IconButton 
                  variant="text" 
                  onClick={() => setShowPricePopup(false)}
                >
                  <span className="text-xl">×</span>
                </IconButton>
              </div>
              
              <div className="mb-4">
                <Typography variant="small" color="gray" className="font-mono">
                  SMILES: {currentSmiles}
                </Typography>
              </div>

              {message && (
                <Alert color={messageType === 'success' ? 'green' : 'red'} className="mb-4">
                  {message}
                </Alert>
              )}

              {priceLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner className="h-8 w-8" />
                  <Typography className="ml-2">Loading price data...</Typography>
                </div>
              ) : priceData?.error ? (
                <Alert color="red">
                  Error: {priceData.error}
                </Alert>
              ) : priceData?.data ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr>
                        <th className="p-2 font-bold">ID</th>
                        <th className="p-2 font-bold">ID Number</th>
                        <th className="p-2 font-bold">SMILES</th>
                        <th className="p-2 font-bold">Formula</th>
                        <th className="p-2 font-bold">Mol Weight</th>
                        <th className="p-2 font-bold">Available (mg)</th>
                        <th className="p-2 font-bold">Price 1mg</th>
                        <th className="p-2 font-bold">Price 5mg</th>
                        <th className="p-2 font-bold">Price 10mg</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b">
                        <td className="p-2">{priceData.data.id || 'N/A'}</td>
                        <td className="p-2">{priceData.data.id_number || 'N/A'}</td>
                        <td className="p-2 font-mono text-xs" title={priceData.data.smiles_string || 'N/A'}>
                          {(priceData.data.smiles_string || 'N/A').toString().slice(0, 30)}
                          {(priceData.data.smiles_string || 'N/A').toString().length > 30 ? '...' : ''}
                        </td>
                        <td className="p-2">{priceData.data.brutto_formula || 'N/A'}</td>
                        <td className="p-2">{priceData.data.mol_weight || 'N/A'}</td>
                        <td className="p-2">{priceData.data.available_mg || 'N/A'}</td>
                        <td className="p-2 cursor-pointer group" title={priceData.data.price_1mg ? `$${priceData.data.price_1mg}` : "-"}>
                          <span>{priceData.data.price_1mg ? `$${priceData.data.price_1mg}` : "-"}</span>
                          {priceData.data.price_1mg && (
                            <ShoppingCartIcon
                              className="inline-block h-5 w-5 text-green-600 ml-2 cursor-pointer opacity-70 group-hover:opacity-100"
                              title="Add 1mg to cart"
                              onClick={() => addToCart(priceData.data, 1, priceData.data.price_1mg)}
                            />
                          )}
                        </td>
                        <td className="p-2 cursor-pointer group" title={priceData.data.price_5mg ? `$${priceData.data.price_5mg}` : "-"}>
                          <span>{priceData.data.price_5mg ? `$${priceData.data.price_5mg}` : "-"}</span>
                          {priceData.data.price_5mg && (
                            <ShoppingCartIcon
                              className="inline-block h-5 w-5 text-green-600 ml-2 cursor-pointer opacity-70 group-hover:opacity-100"
                              title="Add 5mg to cart"
                              onClick={() => addToCart(priceData.data, 5, priceData.data.price_5mg)}
                            />
                          )}
                        </td>
                        <td className="p-2 cursor-pointer group" title={priceData.data.price_10mg ? `$${priceData.data.price_10mg}` : "-"}>
                          <span>{priceData.data.price_10mg ? `$${priceData.data.price_10mg}` : "-"}</span>
                          {priceData.data.price_10mg && (
                            <ShoppingCartIcon
                              className="inline-block h-5 w-5 text-green-600 ml-2 cursor-pointer opacity-70 group-hover:opacity-100"
                              title="Add 10mg to cart"
                              onClick={() => addToCart(priceData.data, 10, priceData.data.price_10mg)}
                            />
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : Array.isArray(priceData) && priceData.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr>
                        <th className="p-2 font-bold">ID</th>
                        <th className="p-2 font-bold">IUPAC Name</th>
                        <th className="p-2 font-bold">Formula</th>
                        <th className="p-2 font-bold">MW</th>
                        <th className="p-2 font-bold">Available (mg)</th>
                        <th className="p-2 font-bold">Price 1mg</th>
                        <th className="p-2 font-bold">Price 2mg</th>
                        <th className="p-2 font-bold">Price 5mg</th>
                        <th className="p-2 font-bold">Price 10mg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {priceData.map((mol, idx) => (
                        <tr key={mol.ASINEX_ID || mol.id || idx} className="border-b">
                          <td className="p-2">{mol.ASINEX_ID || mol.id || 'N/A'}</td>
                          <td className="p-2" title={mol.IUPAC_NAME || 'N/A'}>
                            {(mol.IUPAC_NAME || 'N/A').toString().slice(0, 30)}
                            {(mol.IUPAC_NAME || 'N/A').toString().length > 30 ? '...' : ''}
                          </td>
                          <td className="p-2">{mol.BRUTTO_FORMULA || mol.formula || 'N/A'}</td>
                          <td className="p-2">{mol.MW_STRUCTURE || mol.mw || 'N/A'}</td>
                          <td className="p-2">{mol.AVAILABLE_MG || mol.availableMg || 'N/A'}</td>
                          <td className="p-2 cursor-pointer group" title={mol.PRICE_1MG || mol.price_1mg ? `$${mol.PRICE_1MG || mol.price_1mg}` : "-"}>
                            <span>{mol.PRICE_1MG || mol.price_1mg ? `$${mol.PRICE_1MG || mol.price_1mg}` : "-"}</span>
                            {(mol.PRICE_1MG || mol.price_1mg) && (
                              <ShoppingCartIcon
                                className="inline-block h-5 w-5 text-green-600 ml-2 cursor-pointer opacity-70 group-hover:opacity-100"
                                title="Add 1mg to cart"
                                onClick={() => addToCart(mol, 1, mol.PRICE_1MG || mol.price_1mg)}
                              />
                            )}
                          </td>
                          <td className="p-2 cursor-pointer group" title={mol.PRICE_2MG || mol.price_2mg ? `$${mol.PRICE_2MG || mol.price_2mg}` : "-"}>
                            <span>{mol.PRICE_2MG || mol.price_2mg ? `$${mol.PRICE_2MG || mol.price_2mg}` : "-"}</span>
                            {(mol.PRICE_2MG || mol.price_2mg) && (
                              <ShoppingCartIcon
                                className="inline-block h-5 w-5 text-green-600 ml-2 cursor-pointer opacity-70 group-hover:opacity-100"
                                title="Add 2mg to cart"
                                onClick={() => addToCart(mol, 2, mol.PRICE_2MG || mol.price_2mg)}
                              />
                            )}
                          </td>
                          <td className="p-2 cursor-pointer group" title={mol.PRICE_5MG || mol.price_5mg ? `$${mol.PRICE_5MG || mol.price_5mg}` : "-"}>
                            <span>{mol.PRICE_5MG || mol.price_5mg ? `$${mol.PRICE_5MG || mol.price_5mg}` : "-"}</span>
                            {(mol.PRICE_5MG || mol.price_5mg) && (
                              <ShoppingCartIcon
                                className="inline-block h-5 w-5 text-green-600 ml-2 cursor-pointer opacity-70 group-hover:opacity-100"
                                title="Add 5mg to cart"
                                onClick={() => addToCart(mol, 5, mol.PRICE_5MG || mol.price_5mg)}
                              />
                            )}
                          </td>
                          <td className="p-2 cursor-pointer group" title={mol.PRICE_10MG || mol.price_10mg ? `$${mol.PRICE_10MG || mol.price_10mg}` : "-"}>
                            <span>{mol.PRICE_10MG || mol.price_10mg ? `$${mol.PRICE_10MG || mol.price_10mg}` : "-"}</span>
                            {(mol.PRICE_10MG || mol.price_10mg) && (
                              <ShoppingCartIcon
                                className="inline-block h-5 w-5 text-green-600 ml-2 cursor-pointer opacity-70 group-hover:opacity-100"
                                title="Add 10mg to cart"
                                onClick={() => addToCart(mol, 10, mol.PRICE_10MG || mol.price_10mg)}
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : priceData ? (
                <div className="overflow-x-auto">
                  <pre className="whitespace-pre-wrap text-sm font-mono bg-gray-50 p-4 rounded border">
                    {JSON.stringify(priceData, null, 2)}
                  </pre>
                </div>
              ) : (
                <Typography color="gray">No data available</Typography>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ADMET Popup Modal */}
      {showAdmetPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[80vh] overflow-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <Typography variant="h5" color="blue-gray">
                  ADMET Properties
                </Typography>
                <IconButton 
                  variant="text" 
                  onClick={() => setShowAdmetPopup(false)}
                >
                  <span className="text-xl">×</span>
                </IconButton>
              </div>
              
              <div className="mb-4">
                <Typography variant="small" color="gray" className="font-mono">
                  Simulation ID: {currentSimulationId}
                </Typography>
                {admetData?.simulationKey && (
                  <Typography variant="small" color="gray" className="font-mono">
                    Simulation Key: {admetData.simulationKey}
                  </Typography>
                )}
                {admetData?.smiles && (
                  <Typography variant="small" color="gray" className="font-mono">
                    SMILES: {admetData.smiles}
                  </Typography>
                )}
              </div>

              {admetLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner className="h-8 w-8" />
                  <Typography className="ml-2">Loading ADMET data...</Typography>
                </div>
              ) : admetData?.error ? (
                <Alert color="red">
                  Error: {admetData.error}
                </Alert>
              ) : admetData?.admet ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Molecular Properties */}
                  <Card className="shadow-sm">
                    <CardHeader floated={false} shadow={false} className="p-4">
                      <Typography variant="h6" color="blue-gray">
                        Molecular Properties
                      </Typography>
                    </CardHeader>
                    <CardBody className="p-4 pt-0">
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">Molecular Weight:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.molecular_weight || 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">LogP:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.logP || 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">TPSA:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.tpsa || 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">H-Bond Acceptors:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.hydrogen_bond_acceptors || 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">H-Bond Donors:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.hydrogen_bond_donors || 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">Lipinski:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.Lipinski || 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">QED:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.QED ? admetData.admet.QED.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">Stereo Centers:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.stereo_centers || 'N/A'}</Typography>
                        </div>
                      </div>
                    </CardBody>
                  </Card>

                  {/* Toxicity Predictions */}
                  <Card className="shadow-sm">
                    <CardHeader floated={false} shadow={false} className="p-4">
                      <Typography variant="h6" color="blue-gray">
                        Toxicity Predictions
                      </Typography>
                    </CardHeader>
                    <CardBody className="p-4 pt-0">
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">AMES:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.AMES ? admetData.admet.AMES.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">Carcinogens:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.Carcinogens_Lagunin ? admetData.admet.Carcinogens_Lagunin.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">Clinical Toxicity:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.ClinTox ? admetData.admet.ClinTox.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">DILI:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.DILI ? admetData.admet.DILI.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">Skin Reaction:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.Skin_Reaction ? admetData.admet.Skin_Reaction.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">hERG:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.hERG ? admetData.admet.hERG.toFixed(3) : 'N/A'}</Typography>
                        </div>
                      </div>
                    </CardBody>
                  </Card>

                  {/* Pharmacokinetics */}
                  <Card className="shadow-sm">
                    <CardHeader floated={false} shadow={false} className="p-4">
                      <Typography variant="h6" color="blue-gray">
                        Pharmacokinetics
                      </Typography>
                    </CardHeader>
                    <CardBody className="p-4 pt-0">
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">BBB Martins:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.BBB_Martins ? admetData.admet.BBB_Martins.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">Bioavailability:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.Bioavailability_Ma ? admetData.admet.Bioavailability_Ma.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">HIA Hou:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.HIA_Hou ? admetData.admet.HIA_Hou.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">PAMPA NCATS:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.PAMPA_NCATS ? admetData.admet.PAMPA_NCATS.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">Pgp Broccatelli:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.Pgp_Broccatelli ? admetData.admet.Pgp_Broccatelli.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">Caco2 Wang:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.Caco2_Wang ? admetData.admet.Caco2_Wang.toFixed(3) : 'N/A'}</Typography>
                        </div>
                      </div>
                    </CardBody>
                  </Card>

                  {/* CYP Enzyme Interactions */}
                  <Card className="shadow-sm">
                    <CardHeader floated={false} shadow={false} className="p-4">
                      <Typography variant="h6" color="blue-gray">
                        CYP Enzyme Interactions
                      </Typography>
                    </CardHeader>
                    <CardBody className="p-4 pt-0">
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">CYP1A2 Veith:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.CYP1A2_Veith ? admetData.admet.CYP1A2_Veith.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">CYP2C19 Veith:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.CYP2C19_Veith ? admetData.admet.CYP2C19_Veith.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">CYP2C9 Substrate:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.CYP2C9_Substrate_CarbonMangels ? admetData.admet.CYP2C9_Substrate_CarbonMangels.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">CYP2C9 Veith:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.CYP2C9_Veith ? admetData.admet.CYP2C9_Veith.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">CYP2D6 Substrate:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.CYP2D6_Substrate_CarbonMangels ? admetData.admet.CYP2D6_Substrate_CarbonMangels.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">CYP2D6 Veith:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.CYP2D6_Veith ? admetData.admet.CYP2D6_Veith.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">CYP3A4 Substrate:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.CYP3A4_Substrate_CarbonMangels ? admetData.admet.CYP3A4_Substrate_CarbonMangels.toFixed(3) : 'N/A'}</Typography>
                        </div>
                        <div className="flex justify-between">
                          <Typography variant="small" color="gray">CYP3A4 Veith:</Typography>
                          <Typography variant="small" className="font-medium">{admetData.admet.CYP3A4_Veith ? admetData.admet.CYP3A4_Veith.toFixed(3) : 'N/A'}</Typography>
                        </div>
                      </div>
                    </CardBody>
                  </Card>

                  {/* Additional Properties */}
                  <Card className="shadow-sm lg:col-span-2">
                    <CardHeader floated={false} shadow={false} className="p-4">
                      <Typography variant="h6" color="blue-gray">
                        Additional Properties
                      </Typography>
                    </CardHeader>
                    <CardBody className="p-4 pt-0">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <Typography variant="small" color="gray">LD50 Zhu:</Typography>
                            <Typography variant="small" className="font-medium">{admetData.admet.LD50_Zhu ? admetData.admet.LD50_Zhu.toFixed(3) : 'N/A'}</Typography>
                          </div>
                          <div className="flex justify-between">
                            <Typography variant="small" color="gray">Lipophilicity:</Typography>
                            <Typography variant="small" className="font-medium">{admetData.admet.Lipophilicity_AstraZeneca ? admetData.admet.Lipophilicity_AstraZeneca.toFixed(3) : 'N/A'}</Typography>
                          </div>
                          <div className="flex justify-between">
                            <Typography variant="small" color="gray">Solubility:</Typography>
                            <Typography variant="small" className="font-medium">{admetData.admet.Solubility_AqSolDB ? admetData.admet.Solubility_AqSolDB.toFixed(3) : 'N/A'}</Typography>
                          </div>
                          <div className="flex justify-between">
                            <Typography variant="small" color="gray">VDss Lombardo:</Typography>
                            <Typography variant="small" className="font-medium">{admetData.admet.VDss_Lombardo ? admetData.admet.VDss_Lombardo.toFixed(3) : 'N/A'}</Typography>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <Typography variant="small" color="gray">Clearance Hepatocyte:</Typography>
                            <Typography variant="small" className="font-medium">{admetData.admet.Clearance_Hepatocyte_AZ ? admetData.admet.Clearance_Hepatocyte_AZ.toFixed(3) : 'N/A'}</Typography>
                          </div>
                          <div className="flex justify-between">
                            <Typography variant="small" color="gray">Clearance Microsome:</Typography>
                            <Typography variant="small" className="font-medium">{admetData.admet.Clearance_Microsome_AZ ? admetData.admet.Clearance_Microsome_AZ.toFixed(3) : 'N/A'}</Typography>
                          </div>
                          <div className="flex justify-between">
                            <Typography variant="small" color="gray">Half Life Obach:</Typography>
                            <Typography variant="small" className="font-medium">{admetData.admet.Half_Life_Obach ? admetData.admet.Half_Life_Obach.toFixed(3) : 'N/A'}</Typography>
                          </div>
                          <div className="flex justify-between">
                            <Typography variant="small" color="gray">PPBR AZ:</Typography>
                            <Typography variant="small" className="font-medium">{admetData.admet.PPBR_AZ ? admetData.admet.PPBR_AZ.toFixed(3) : 'N/A'}</Typography>
                          </div>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                </div>
              ) : (
                <Typography color="gray">Calculating...</Typography>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ControlPanel;
