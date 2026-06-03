import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  CardBody,
  CardHeader,
  Typography,
  Button,
  Alert,
  Spinner,
  Input,
} from "@material-tailwind/react";
import { 
  CloudIcon,
  ArrowPathIcon,
  CodeBracketIcon,
} from "@heroicons/react/24/outline";
import { ShoppingCartIcon } from '@heroicons/react/24/solid';
import ProfessionalMoleculeViewer from '../../components/ProfessionalMoleculeViewer';
import { API_CONFIG } from "@/utils/constants";
import { convertPriceToEuro, formatPrice } from '@/utils/algo/algo';

export function Simulation() {
  // Popup state for clipboard copy
  const [showClipboardPopup, setShowClipboardPopup] = useState(false);
  const [loading, setLoading] = useState(false);
  // State for toggling simulation inputs
  const [showSimInputs, setShowSimInputs] = useState(false);
  const [showDiffDockInputs, setShowDiffDockInputs] = useState(false);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [apiUrl, setApiUrl] = useState('/api/hello');
  const [useHttpbin, setUseHttpbin] = useState(true);
  const [searchCode, setSearchCode] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");

  const [simPdbId, setSimPdbId] = useState("");
  const [diffDockPdbId, setDiffDockPdbId] = useState("");
  const [diffDockLigandId, setDiffDockLigandId] = useState("");
  const [simResult, setSimResult] = useState(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState("");
  const [diffDockResult, setDiffDockResult] = useState(null);
  const [diffDockLoading, setDiffDockLoading] = useState(false);
  const [diffDockError, setDiffDockError] = useState("");
  const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState(''); // 'success', 'error', or ''
  const [topMolecules, setTopMolecules] = useState([]);
  const [topLoading, setTopLoading] = useState(false);
  const [topError, setTopError] = useState("");

  const [searchType, setSearchType] = useState("similarity"); // Add searchType state
  const [queryType, setQueryType] = useState("draw"); // Default to Draw molecule
  const [topLimit, setTopLimit] = useState(8); // Add topLimit state
  const [moleculeLimit, setMoleculeLimit] = useState(30); // Add moleculeLimit state
  const [similarityThreshold, setSimilarityThreshold] = useState(0.7); // Similarity threshold (0-1)
  const [molWeightMin, setMolWeightMin] = useState(0); // Molecular weight minimum (0-1000)
  const [molWeightMax, setMolWeightMax] = useState(1000); // Molecular weight maximum (0-1000)
  const [lastFromId, setLastFromId] = useState(0); // Track last fromId for pagination
  const [isSearchActive, setIsSearchActive] = useState(false); // Track if search is active
  const [lastSearchQuery, setLastSearchQuery] = useState(""); // Track last search query

  const [mculeSmiles, setMculeSmiles] = useState(""); // For drawing in mcule component

  const [cart, setCart] = useState([]);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(0);
  const [allMolecules, setAllMolecules] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [pageSize, setPageSize] = useState(10);
  
  // Hover preview state
  const [hoveredPreview, setHoveredPreview] = useState(null);
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0 });
  
  // Checkbox selection state
  const [selectedMolecules, setSelectedMolecules] = useState(new Set());
  
  // Currency conversion state
  const [currency, setCurrency] = useState('USD');
  const [exchangeRate, setExchangeRate] = useState(1);
  const [userCountry, setUserCountry] = useState('US');

  // Refs to prevent infinite loops in scroll handler
  const hasMoreRef = useRef(true);
  const topLoadingRef = useRef(false);
  const currentPageRef = useRef(0);
  const initialLoadingRef = useRef(true);
  const isLoadingPageRef = useRef(false); // Prevent multiple simultaneous requests
  const ketcherIframeRef = useRef(null);
  const isSearchActiveRef = useRef(false);

  const navigate = useNavigate();
  
  // Helper function to check if current user is tester
  const isTestUser = () => {
    try {
      const userInfo = localStorage.getItem('user_info');
      if (userInfo) {
        const user = JSON.parse(userInfo);
        return user.username === 'tester123' || user.email === 'tester123';
      }
    } catch (err) {
      console.error('Error checking user info:', err);
    }
    return false;
  };

  // Helper function to get test user's IP
  const getTestUserIp = () => {
    try {
      const simulationPairs = localStorage.getItem('molstar_simulation_pairs');
      if (simulationPairs) {
        const pairs = JSON.parse(simulationPairs);
        // Get the first IP from simulation pairs that belongs to this user
        const userIp = Object.values(pairs)[0]?.userIp;
        return userIp;
      }
    } catch (err) {
      console.error('Error getting test user IP:', err);
    }
    return null;
  };

  // Filter function for test user by IP
  const filterForTestUserByIp = (data) => {
    if (!isTestUser()) {
      // Not a test user, return all data
      return data;
    }

    const testUserIp = getTestUserIp();
    if (!testUserIp) {
      // No IP found, return all data
      return data;
    }

    try {
      const simulationPairs = localStorage.getItem('molstar_simulation_pairs');
      if (!simulationPairs) {
        return data;
      }

      const pairs = JSON.parse(simulationPairs);
      
      // Get all simulation keys that match the test user's IP
      const matchingKeys = Object.keys(pairs).filter(key => 
        pairs[key].userIp === testUserIp
      );

      // Filter data to only include items with matching simulation keys
      // This assumes data items have a simulationKey or similar identifier
      const filtered = data.filter(item => {
        // Check if item has a simulation key that matches
        if (item.simulationKey) {
          return matchingKeys.includes(item.simulationKey);
        }
        // If no simulation key, include the item (for backward compatibility)
        return true;
      });

      return filtered;
    } catch (err) {
      console.error('Error filtering for test user:', err);
      return data;
    }
  };
  
  // Update refs when state changes
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    topLoadingRef.current = topLoading;
  }, [topLoading]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    initialLoadingRef.current = initialLoading;
  }, [initialLoading]);

  useEffect(() => {
    isSearchActiveRef.current = isSearchActive;
  }, [isSearchActive]);

  // Check for payment success/cancel from URL params
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    
    if (paymentStatus === 'success') {
      setMessage('Payment successful! Your order has been received. We will contact you shortly to process your order.');
      setMessageType('success');
      // Clear the cart after successful payment
      localStorage.removeItem('moleculeCart');
      setCart([]);
      window.dispatchEvent(new Event('cartUpdated'));
      
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Scroll to top to show message
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (paymentStatus === 'canceled') {
      setMessage('Payment was canceled. Your cart items are still saved.');
      setMessageType('error');
      
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Scroll to top to show message
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const fetchApiData = async () => {
    setLoading(true);
    setError('');
    try {
      let fetchUrl = apiUrl;
      if (useHttpbin) {
        fetchUrl = '/api/hello';
      }
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const result = await response.json();
      if (result.success !== false) {
        setResponse(result.data);
        setLastUpdated(result.timestamp || new Date().toISOString());
      } else {
        throw new Error(result.error || 'Unknown error from API');
      }
    } catch (err) {
      setError(`Failed to fetch data: ${err.message}`);
      setResponse(null);
    } finally {
      setLoading(false);
    }
  };

  // Function to fetch molecules from /asinex/all/x_10
  const fetchAllMolecules = async (page = 0, append = false) => {
    // Prevent multiple simultaneous requests
    if (isLoadingPageRef.current) {
      console.log('Already loading, skipping request');
      return;
    }
    
    isLoadingPageRef.current = true;
    try {
      if (!append) {
        setTopLoading(true);
        setTopError("");
      }
      
      console.log(`Fetching page ${page} from /asinex/all/${page}_${pageSize}`);
      
      const token = localStorage.getItem('auth_token');
      const res = await fetch(API_CONFIG.buildApiUrl(`/asinex/all/${page}_${pageSize}`), {
        method: "GET",
        headers: { 
          'accept': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
      });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const result = await res.json();
      console.log('Fetched molecules from /asinex/all:', result);
      
      // Check if response fromId matches request (if using pagination with fromId)
      // Note: /asinex/all uses page-based pagination, but check in case API returns fromId
      if (result.fromId !== undefined && page > 0 && result.fromId === lastFromId) {
        console.log('Received same fromId - no new data available');
        setHasMore(false);
        return;
      }
      
      let formattedMolecules = [];
      
      // Handle different response formats
      if (Array.isArray(result)) {
        formattedMolecules = result.map(molecule => ({
          ASINEX_ID: molecule.id_number || molecule.id,
          SMILES_STRING: molecule.smiles_string,
          BRUTTO_FORMULA: molecule.brutto_formula,
          MW_STRUCTURE: molecule.mol_weight,
          AVAILABLE_MG: molecule.available_mg,
          PRICE_1MG: molecule.price_1mg,
          PRICE_5MG: molecule.price_5mg,
          PRICE_10MG: molecule.price_10mg,
          IUPAC_NAME: molecule.iupac_name || "N/A",
          INCHI: molecule.inchi || "N/A", 
          INCHIKEY: molecule.inchikey || "N/A",
          PRICE_2MG: molecule.price_2mg || "N/A"
        }));
      } else if (result.data && Array.isArray(result.data)) {
        formattedMolecules = result.data.map(molecule => ({
          ASINEX_ID: molecule.id_number || molecule.id,
          SMILES_STRING: molecule.smiles_string,
          BRUTTO_FORMULA: molecule.brutto_formula,
          MW_STRUCTURE: molecule.mol_weight,
          AVAILABLE_MG: molecule.available_mg,
          PRICE_1MG: molecule.price_1mg,
          PRICE_5MG: molecule.price_5mg,
          PRICE_10MG: molecule.price_10mg,
          IUPAC_NAME: molecule.iupac_name || "N/A",
          INCHI: molecule.inchi || "N/A", 
          INCHIKEY: molecule.inchikey || "N/A",
          PRICE_2MG: molecule.price_2mg || "N/A"
        }));
      }
      
      if (append) {
        setAllMolecules(prev => [...prev, ...formattedMolecules]);
        setTopMolecules(prev => [...prev, ...formattedMolecules]);
      } else {
        setAllMolecules(formattedMolecules);
        setTopMolecules(formattedMolecules);
        // Clear selected molecules when loading new data (not appending)
        setSelectedMolecules(new Set());
        // Reset search state when starting fresh browse mode
        setIsSearchActive(false);
        setLastSearchQuery("");
      }
      
      // Check if we have more data (if we got less than pageSize, we're at the end)
      if (formattedMolecules.length < pageSize) {
        setHasMore(false);
        console.log('No more data available');
      } else {
        setHasMore(true);
      }
      
      setCurrentPage(page);
      
    } catch (err) {
      setTopError(`Failed to fetch molecules: ${err.message}`);
      console.error('Error fetching molecules:', err);
    } finally {
      setTopLoading(false);
      setInitialLoading(false);
      isLoadingPageRef.current = false; // Always reset the loading flag
    }
  };

  const handleSearch = async () => {
    setSearchLoading(true);
    setSearchError("");
    setSearchResult(null);
    
    // Reset pagination when searching
    setCurrentPage(0);
    setAllMolecules([]);
    setHasMore(true);
    setLastFromId(0); // Reset fromId to 0 for new search
    
    // Clear selected molecules when doing a new search
    setSelectedMolecules(new Set());
    
    try {
      const token = localStorage.getItem('auth_token');
      const rawQuery = (searchCode || '').trim();

      // Map UI searchType to API method names
      const methodMap = {
        similarity: 'similarity',
        substructure: 'substructure',
        structure: 'structure',
        bas: 'bas',
        molweight: 'mw', // UI uses 'molweight', API uses 'mw'
        mw: 'mw'
      };
      const method = methodMap[searchType] || 'similarity';

      // Use lastFromId for pagination (starts at 0 for new search)
      const fromId = lastFromId;

      // Prepare request body with pagination parameters
      let requestBody = {
        fromId: fromId,
        pageSize: pageSize
      };

      // Add method-specific parameters
      if (searchType === 'bas') {
        // BAS search uses 'bas' parameter instead of 'smiles'
        requestBody.bas = rawQuery;
      } else if (searchType === 'similarity') {
        // Similarity search uses 'smiles' and 'threshold'
        requestBody.smiles = rawQuery;
        requestBody.threshold = similarityThreshold;
      } else if (searchType === 'molweight' || searchType === 'mw') {
        // Molecular weight search uses 'smiles' and weight range
        requestBody.smiles = rawQuery;
        requestBody.mwFrom = molWeightMin;
        requestBody.mwTo = molWeightMax;
      } else {
        // Other searches (substructure, structure) use 'smiles'
        requestBody.smiles = rawQuery;
      }

      // POST to /api4/{method} with JSON body
      const url = API_CONFIG.buildApiUrl(`/api4/${method}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'accept': '*/*',
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${res.statusText} - ${errorText}`);
      }
      const result = await res.json();
      //setSearchResult(result);
      console.log('Search result data structure:', result); // Debug log
      
      // Check if response fromId matches request fromId (meaning we've hit the end)
      if (result.fromId !== undefined && result.fromId === fromId) {
        console.log('Received same fromId as request - no new data available');
        setHasMore(false);
        return;
      }
      
      // Handle the new response structure
      if (result.data) {
        // Single result with data object (old format)
        const molecule = result.data;
        // Convert to array format for consistency with existing table rendering
        const formattedMolecule = {
          ASINEX_ID: molecule.id_number || molecule.id,
          SMILES_STRING: molecule.smiles_string,
          BRUTTO_FORMULA: molecule.brutto_formula,
          MW_STRUCTURE: molecule.mol_weight,
          AVAILABLE_MG: molecule.available_mg,
          PRICE_1MG: molecule.price_1mg,
          PRICE_5MG: molecule.price_5mg,
          PRICE_10MG: molecule.price_10mg,
          // Add other fields that might be missing
          IUPAC_NAME: molecule.iupac_name || "N/A",
          INCHI: molecule.inchi || "N/A", 
          INCHIKEY: molecule.inchikey || "N/A",
          PRICE_2MG: molecule.price_2mg || "N/A",
          SIMILARITY: molecule.similarity || molecule.Similarity || null
        };
        setTopMolecules([formattedMolecule]);
        // Clear selected molecules when loading new search results
        setSelectedMolecules(new Set());
      } else if (Array.isArray(result)) {
        // Direct array format (new format)
        const formattedMolecules = result.map(molecule => ({
          ASINEX_ID: molecule.id_number || molecule.id,
          SMILES_STRING: molecule.smiles_string,
          BRUTTO_FORMULA: molecule.brutto_formula,
          MW_STRUCTURE: molecule.mol_weight,
          AVAILABLE_MG: molecule.available_mg,
          PRICE_1MG: molecule.price_1mg,
          PRICE_5MG: molecule.price_5mg,
          PRICE_10MG: molecule.price_10mg,
          // Add other fields that might be missing
          IUPAC_NAME: molecule.iupac_name || "N/A",
          INCHI: molecule.inchi || "N/A", 
          INCHIKEY: molecule.inchikey || "N/A",
          PRICE_2MG: molecule.price_2mg || "N/A",
          SIMILARITY: molecule.similarity || molecule.Similarity || null
        }));
        setTopMolecules(formattedMolecules);
        // Clear selected molecules when loading new search results
        setSelectedMolecules(new Set());
        
        // Update lastFromId to the maximum id_number from the response for next page
        if (formattedMolecules.length > 0) {
          const maxId = Math.max(...formattedMolecules.map(m => {
            const id = m.ASINEX_ID || '0';
            return parseInt(id) || 0;
          }));
          setLastFromId(maxId);
        }
      } else if (result.id || result.id_number) {
        // Single object format (new format)
        const formattedMolecule = {
          ASINEX_ID: result.id_number || result.id,
          SMILES_STRING: result.smiles_string,
          BRUTTO_FORMULA: result.brutto_formula,
          MW_STRUCTURE: result.mol_weight,
          AVAILABLE_MG: result.available_mg,
          PRICE_1MG: result.price_1mg,
          PRICE_5MG: result.price_5mg,
          PRICE_10MG: result.price_10mg,
          // Add other fields that might be missing
          IUPAC_NAME: result.iupac_name || "N/A",
          INCHI: result.inchi || "N/A", 
          INCHIKEY: result.inchikey || "N/A",
          PRICE_2MG: result.price_2mg || "N/A",
          SIMILARITY: result.similarity || result.Similarity || null
        };
        setTopMolecules([formattedMolecule]);
        // Clear selected molecules when loading new search results  
        setSelectedMolecules(new Set());
      } else if (Array.isArray(result.molecules)) {
        // Array format with molecules property (old format)
        setTopMolecules(result.molecules);
        // Clear selected molecules when loading new search results
        setSelectedMolecules(new Set());
      } else {
        // Fallback for other formats
        setTopMolecules([]);
        // Clear selected molecules when loading new search results
        setSelectedMolecules(new Set());
      }
    } catch (err) {
      setSearchError("Not found, please try again later");
      setTimeout(() => {
        setSearchError("");
      }, 2000);
    } finally {
      setSearchLoading(false);
      setIsSearchActive(true); // Mark search as active
      setLastSearchQuery(searchCode); // Store the search query
    }
  };

  // Function to load more search results (for pagination during scroll)
  const loadMoreSearchResults = async () => {
    if (!isSearchActive || !lastSearchQuery) return;
    
    setTopLoading(true);
    
    try {
      const token = localStorage.getItem('auth_token');
      const rawQuery = lastSearchQuery.trim();

      // Map UI searchType to API method names
      const methodMap = {
        similarity: 'similarity',
        substructure: 'substructure',
        structure: 'structure',
        bas: 'bas',
        molweight: 'mw',
        mw: 'mw'
      };
      const method = methodMap[searchType] || 'similarity';

      // Prepare request body with pagination parameters
      let requestBody = {
        fromId: lastFromId,
        pageSize: pageSize
      };

      // Add method-specific parameters
      if (searchType === 'bas') {
        requestBody.bas = rawQuery;
      } else if (searchType === 'similarity') {
        requestBody.smiles = rawQuery;
        requestBody.threshold = similarityThreshold;
      } else if (searchType === 'molweight' || searchType === 'mw') {
        requestBody.smiles = rawQuery;
        requestBody.mwFrom = molWeightMin;
        requestBody.mwTo = molWeightMax;
      } else {
        requestBody.smiles = rawQuery;
      }

      // POST to /api4/{method} with JSON body
      const url = API_CONFIG.buildApiUrl(`/api4/${method}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'accept': '*/*',
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const result = await res.json();
      
      // Check if response fromId matches request fromId (meaning we've hit the end)
      if (result.fromId !== undefined && result.fromId === lastFromId) {
        console.log('Received same fromId as request - no new data available');
        setHasMore(false);
        return;
      }
      
      // Handle array response
      if (Array.isArray(result)) {
        const formattedMolecules = result.map(molecule => ({
          ASINEX_ID: molecule.id_number || molecule.id,
          SMILES_STRING: molecule.smiles_string,
          BRUTTO_FORMULA: molecule.brutto_formula,
          MW_STRUCTURE: molecule.mol_weight,
          AVAILABLE_MG: molecule.available_mg,
          PRICE_1MG: molecule.price_1mg,
          PRICE_5MG: molecule.price_5mg,
          PRICE_10MG: molecule.price_10mg,
          IUPAC_NAME: molecule.iupac_name || "N/A",
          INCHI: molecule.inchi || "N/A", 
          INCHIKEY: molecule.inchikey || "N/A",
          PRICE_2MG: molecule.price_2mg || "N/A",
          SIMILARITY: molecule.similarity || molecule.Similarity || null
        }));
        
        // Append to existing molecules
        setTopMolecules(prev => [...prev, ...formattedMolecules]);
        
        // Update lastFromId to the maximum id_number from the response for next page
        if (formattedMolecules.length > 0) {
          const maxId = Math.max(...formattedMolecules.map(m => {
            const id = m.ASINEX_ID || '0';
            return parseInt(id) || 0;
          }));
          setLastFromId(maxId);
        }
        
        // Check if we have more data
        if (formattedMolecules.length < pageSize) {
          setHasMore(false);
        }
      } else {
        // No more results
        setHasMore(false);
      }
    } catch (err) {
      console.error('Failed to load more search results:', err);
      setHasMore(false);
    } finally {
      setTopLoading(false);
    }
  };

  const handleSimulation = async () => {
    // Check if we have a SMILES from the search
    if (!searchCode) {
      setSimError("Please search for a molecule first to get the SMILES code for docking");
      return;
    }
    let _searchSmiles = searchCode.replace(',', ';').trim();
    setSimLoading(true);
    setSimError("");
    setSimResult(null);
    try {
      const token = localStorage.getItem('auth_token');
      
      // Create JSON payload
      const requestBody = {
        pdbid: simPdbId,
        smiles: encodeURIComponent(_searchSmiles)
      };
      
      const res = await fetch(API_CONFIG.buildApiUrl('/simulation'), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(requestBody)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      
      clearDiffDockStorage();
      const result = await res.json();
      setSimResult(result);

    } catch (err) {
      setSimError(`Failed to simulate: ${err.message}`);
    } finally {
      setSimLoading(false);
    }
  };
    const clearDiffDockStorage = () => {
      localStorage.removeItem('diffdock_protein');
      localStorage.removeItem('diffdock_ligand');
      localStorage.removeItem('diffdock_ligand_position');
    }
  const handleDiffDock = async () => {
    let ligand_file_type = "sdf";
    // Check if we have both PDB ID and Ligand ID
    if (!diffDockPdbId) {
      setDiffDockError("Please provide a PDB ID for DiffDock");
      return;
    }
    
    // If no Ligand ID provided, try to use SMILES from search input
    let ligandId = searchCode;

  
    if (!ligandId) {
      setDiffDockError("Please provide a Ligand ID for DiffDock or search for a molecule");
      return;
    }
    
    setDiffDockLoading(true);
    setDiffDockError("");
    setDiffDockResult(null);
    try {
      const token = localStorage.getItem('auth_token');
      
      // Create JSON payload for DiffDock
      const requestBody = {
        protein: diffDockPdbId,
        ligand: ligandId,
        ligandFileType: ligand_file_type || "sdf"
      };
      
      const res = await fetch(API_CONFIG.buildApiUrl('/diffdock/generate'), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(requestBody)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const result = await res.json();
      setDiffDockResult(result);
      setMessage('DiffDock simulation completed successfully!');
      setMessageType('success');
      setTimeout(() => {
        setMessage('');
        setMessageType('');
      }, 5000);
    } catch (err) {
      setDiffDockError(`Failed to run DiffDock: ${err.message}`);
    } finally {
      setDiffDockLoading(false);
    }
  };

  // Redirect to Molstar3D when simulation results are available
  useEffect(() => {
    if (simResult && simResult.simulationKey) {
      const pdbUrl = API_CONFIG.buildApiUrl(`/sanitizedpdb/${simResult.simulationKey}`);      
      const sdfUrl = API_CONFIG.buildApiUrl(`/sanitizedminimalsdf/${simResult.simulationKey}`);
      
      // Fetch user IP address
      const storeSimulationData = async () => {
        let currentUserIp = null;
        try {
          const ipResponse = await fetch('https://api.ipify.org?format=json');
          const ipData = await ipResponse.json();
          currentUserIp = ipData.ip;
        } catch (ipErr) {
          console.error('Failed to fetch IP address:', ipErr);
        }
        
        // Store URLs in localStorage and navigate to Molstar3D
        localStorage.setItem('molstar_pdb_url', pdbUrl);
        localStorage.setItem('molstar_sdf_url', sdfUrl);
        localStorage.setItem('molstar_simulation_key', simResult.simulationKey);
        
        // Get existing simulation pairs dictionary or create new one
        let simulationPairs = {};
        try {
          const existingPairs = localStorage.getItem('molstar_simulation_pairs');
          if (existingPairs) {
            simulationPairs = JSON.parse(existingPairs);
          }
        } catch (err) {
          console.error('Failed to parse existing simulation pairs:', err);
        }
        
        // Add new simulation pair to dictionary with simulationKey as key
        simulationPairs[simResult.simulationKey] = {
          simulationKey: simResult.simulationKey,
          userIp: currentUserIp,
          timestamp: new Date().toISOString()
        };
        
        // Store updated dictionary
        localStorage.setItem('molstar_simulation_pairs', JSON.stringify(simulationPairs));
        
        navigate('/dashboard/molstar3d');
      };
      
      storeSimulationData();
    }
  }, [simResult, navigate]);

  // Redirect to RDKit Molecule Viewer when DiffDock results are available
  useEffect(() => {
    if (diffDockResult) {
      // Store DiffDock result data in localStorage for the molecule viewer
      localStorage.setItem('diffdock_result', JSON.stringify(diffDockResult));
      localStorage.setItem('diffdock_pdb_id', diffDockPdbId);
      localStorage.setItem('diffdock_ligand_id', diffDockLigandId);
      localStorage.setItem('diffdock_timestamp', new Date().toISOString());
      
      // Extract and store protein and ligand data for Molstar3D
      if (diffDockResult.protein) {
        localStorage.setItem('diffdock_protein', diffDockResult.protein);
      }
      if (diffDockResult.ligand) {
        localStorage.setItem('diffdock_ligand', diffDockResult.ligand);
      }
      if (diffDockResult.ligand_positions && diffDockResult.ligand_positions.length > 0) {
        localStorage.setItem('diffdock_ligand_position', diffDockResult.ligand_positions[0]);
      }
      if (diffDockResult.position_confidence && diffDockResult.position_confidence.length > 0) {
        const confidenceScore = diffDockResult.position_confidence[diffDockResult.position_confidence.length - 1]; // Get confidence score of the last position
        if (confidenceScore !== null && confidenceScore !== undefined) {
          localStorage.setItem('diffdock_confidence_score', confidenceScore.toString());
        }
      }
      
      // Navigate to molecule viewer
      navigate('/dashboard/molstar3d');
    }
  }, [diffDockResult, diffDockPdbId, diffDockLigandId, navigate]);

  // Fetch currency info on mount
  useEffect(() => {
    const initCurrency = async () => {
      try {
        const result = await convertPriceToEuro(1);
        setCurrency(result.currency);
        setExchangeRate(result.exchangeRate);
        setUserCountry(result.country);
      } catch (error) {
        console.error('Failed to initialize currency:', error);
      }
    };
    initCurrency();
  }, []);

  // Auto-fetch on component mount
  useEffect(() => {
    // Load initial molecules when component mounts
    setIsSearchActive(false); // Not in search mode initially
    fetchAllMolecules(0, false);
  }, []); // Only run once on mount

  // Separate useEffect for scroll handling
  useEffect(() => {
    let scrollTimeout;
    
    const handleScroll = () => {
      // Clear previous timeout
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      
      // Debounce scroll events
      scrollTimeout = setTimeout(() => {
        if (
          window.innerHeight + document.documentElement.scrollTop
          >= document.documentElement.offsetHeight - 1000 && // Load when 1000px from bottom
          hasMoreRef.current &&
          !topLoadingRef.current &&
          !initialLoadingRef.current &&
          !isLoadingPageRef.current // Additional check
        ) {
          // Check if we're in search mode or browsing all molecules
          if (isSearchActiveRef.current) {
            console.log('Scroll triggered - Loading more search results');
            loadMoreSearchResults();
          } else {
            console.log('Scroll triggered - Loading next page:', currentPageRef.current + 1);
            fetchAllMolecules(currentPageRef.current + 1, true);
          }
        }
      }, 250); // 250ms debounce
    };

    window.addEventListener('scroll', handleScroll);
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
    };
  }, []); // Empty dependency array - only set up once


  const handleCellClick = value => {
    setSearchCode(value);
  };

  const saveCartToStorage = (cartData) => {
    try {
      localStorage.setItem('moleculeCart', JSON.stringify(cartData));
      // Dispatch custom event to notify navbar of cart update
      window.dispatchEvent(new Event('cartUpdated'));
    } catch (error) {
      console.error('Error saving cart to storage:', error);
    }
  };
  const addToCart = (molecule, amount, price) => {
    console.log(`Adding to cart: ${molecule}, Amount: ${amount}, Price: ${price}`);
    if (!molecule || !price) return;
    const priceNum = typeof price === 'number' ? price : Number(price) || 0;
    const cartItem = {
      name: molecule.BRUTTO_FORMULA || molecule.formula || molecule.SMILES_STRING || molecule.smiles || molecule.ASINEX_ID || 'Molecule',
      amount,
      price: priceNum,
      pricePerMg: priceNum, // for compatibility with dashboard-navbar
      totalPrice: priceNum, // Do not multiply by amount - just use the price as is
      id: molecule.ASINEX_ID || molecule.id || Math.random().toString(36).slice(2),
      smiles: molecule.SMILES_STRING || molecule.smiles || '',
      formula: molecule.BRUTTO_FORMULA || molecule.formula || '',
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

  // Hover preview functions
  const handleMouseEnter = (smiles, event, type) => {
    // Debug: Let's see what SMILES we're getting
    console.log('Hover SMILES data:', smiles, 'Type:', type);
    
    if (smiles && smiles !== 'N/A' && smiles.trim() !== '') {
      const rect = event.currentTarget.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const previewWidth = 220; // Preview width + padding
      
      // Calculate position - show on right if there's space, otherwise on left
      let xPosition = rect.right + 10;
      if (xPosition + previewWidth > windowWidth) {
        xPosition = rect.left - previewWidth - 10;
      }
      
      setPreviewPosition({
        x: Math.max(10, xPosition), // Ensure it doesn't go off-screen
        y: rect.top
      });
      setHoveredPreview({
        smiles: smiles.trim(), // Trim whitespace
        type: type
      });
    }
  };

  const handleMouseLeave = () => {
    setHoveredPreview(null);
  };

  // Helper function to extract SMILES from molecule object
  const extractSmiles = (mol) => {
    console.log('Full molecule object:', mol);
    console.log('Available fields:', Object.keys(mol));
    
    // Try different possible field names for SMILES
    const possibleFields = [
      'SMILES_STRING', 'SMILES', 'smiles', 'canonical_smiles', 
      'Canonical_SMILES', 'smi', 'structure', 'mol_smiles'
    ];
    
    for (const field of possibleFields) {
      if (mol[field] && typeof mol[field] === 'string' && mol[field].trim() !== '') {
        const smiles = mol[field].trim();
        // Basic SMILES validation - should contain typical SMILES characters
        if (smiles.length > 1 && /[A-Za-z0-9\[\]()@=#+\-\\/\\\\]/.test(smiles)) {
          console.log(`Found valid SMILES in field: ${field}, value: ${smiles}`);
          return smiles;
        } else {
          console.log(`Invalid SMILES format in field: ${field}, value: ${smiles}`);
        }
      }
    }
    
    console.log('No valid SMILES found in molecule:', mol);
    return null;
  };

  // Helper function to format numeric values to 4 decimal places
  const formatNumericValue = (value) => {
    if (value === null || value === undefined || value === "N/A" || value === "") {
      return "N/A";
    }
    
    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
      return "N/A";
    }
    
    // Format to 4 decimal places and remove trailing zeros
    return parseFloat(numValue.toFixed(6)).toString();
  };

  // Helper function to convert and format price with currency
  const formatPriceWithCurrency = (priceUSD) => {
    if (!priceUSD || priceUSD === "N/A") return "N/A";
    
    const numPrice = parseFloat(priceUSD);
    if (isNaN(numPrice)) return "N/A";
    
    const convertedPrice = numPrice * exchangeRate;
    return formatPrice(convertedPrice, currency);
  };

  // Handle checkbox selection
  const handleCheckboxChange = (molecule, isChecked) => {
    const moleculeId = molecule.ASINEX_ID || molecule.id || Math.random().toString(36).slice(2);
    const smiles = molecule.SMILES_STRING || molecule.SMILES || molecule.smiles || '';
    
    setSelectedMolecules(prev => {
      const newSelected = new Set(prev);
      if (isChecked) {
        newSelected.add(moleculeId);
      } else {
        newSelected.delete(moleculeId);
      }
      
      // Update search box with concatenated SMILES for all selected molecules
      const selectedSmiles = [];
      topMolecules.forEach(mol => {
        const id = mol.ASINEX_ID || mol.id || Math.random().toString(36).slice(2);
        const molSmiles = mol.SMILES_STRING || mol.SMILES || mol.smiles || '';
        if (newSelected.has(id) && molSmiles) {
          selectedSmiles.push(molSmiles);
        }
      });
      
      setSearchCode(selectedSmiles.join(','));
      return newSelected;
    });
  };

  // Handle select all/unselect all functionality
  const handleSelectAll = (isChecked) => {
    if (isChecked) {
      // Select all molecules on current page
      const newSelected = new Set();
      const selectedSmiles = [];
      
      topMolecules.forEach(mol => {
        const moleculeId = mol.ASINEX_ID || mol.id || Math.random().toString(36).slice(2);
        const molSmiles = mol.SMILES_STRING || mol.SMILES || mol.smiles || '';
        newSelected.add(moleculeId);
        if (molSmiles) {
          selectedSmiles.push(molSmiles);
        }
      });
      
      setSelectedMolecules(newSelected);
      setSearchCode(selectedSmiles.join(','));
    } else {
      // Unselect all molecules
      setSelectedMolecules(new Set());
      setSearchCode('');
    }
  };

  // Determine the state of the select all checkbox
  const getSelectAllState = () => {
    if (topMolecules.length === 0) return { checked: false, indeterminate: false };
    
    const totalMolecules = topMolecules.length;
    const selectedCount = topMolecules.filter(mol => {
      const moleculeId = mol.ASINEX_ID || mol.id || Math.random().toString(36).slice(2);
      return selectedMolecules.has(moleculeId);
    }).length;
    
    if (selectedCount === 0) {
      return { checked: false, indeterminate: false };
    } else if (selectedCount === totalMolecules) {
      return { checked: true, indeterminate: false };
    } else {
      return { checked: false, indeterminate: true };
    }
  };

  const handleCopySmiles = async () => {
    if (ketcherIframeRef.current) {
      try {
        const ketcher = ketcherIframeRef.current.contentWindow.ketcher;
        if (ketcher) {
          const smiles = await ketcher.getSmiles();
          if (smiles) {
            await navigator.clipboard.writeText(smiles);
            setSearchCode(smiles); // Also update the search box
            setShowClipboardPopup(true);
            setTimeout(() => setShowClipboardPopup(false), 3000);
          } else {
            alert("No molecule drawn to get SMILES from.");
          }
        } else {
          alert("Ketcher editor not available.");
        }
      } catch (err) {
        console.error("Failed to get SMILES from Ketcher:", err);
        alert("Failed to get SMILES. Make sure a molecule is drawn.");
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col pt-4 pb-4 bg-gray-50 w-full px-2 sm:px-4">
      {/* Hover Preview Tooltip */}
      {hoveredPreview && (
        <div 
          className="fixed z-50 bg-white border-2 border-gray-300 rounded-lg shadow-xl p-3"
          style={{
            left: `${previewPosition.x}px`,
            top: `${previewPosition.y}px`,
            transform: 'translateY(-50%)',
            maxWidth: '220px'
          }}
        >
          <div className="text-xs text-gray-600 mb-2 font-medium">
            {hoveredPreview.type} Preview
          </div>
          {/* Use simple image-based molecule viewer */}
          <div className="border border-gray-300 rounded overflow-hidden bg-white" style={{ width: '200px', height: '150px' }}>
            <img 
              src={`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(hoveredPreview.smiles)}/PNG?record_type=2d&image_size=200x150`}
              alt="Molecule structure"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              onError={(e) => {
                console.warn('Failed to load molecule image for SMILES:', hoveredPreview.smiles, 'URL:', e.target.src);
                
                // Try different approaches in sequence using data attributes to track attempts
                if (!e.target.getAttribute('data-fallback-attempted')) {
                  e.target.setAttribute('data-fallback-attempted', '1');
                  // Try simplified SMILES encoding (remove special characters that might cause issues)
                  const simplifiedSmiles = hoveredPreview.smiles.replace(/[^\w\[\]()@=#+\-\\/\\\\]/g, '');
                  if (simplifiedSmiles !== hoveredPreview.smiles) {
                    console.log('Trying simplified SMILES:', simplifiedSmiles);
                    e.target.src = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(simplifiedSmiles)}/PNG?record_type=2d&image_size=200x150`;
                    return;
                  }
                }
                
                if (e.target.getAttribute('data-fallback-attempted') === '1') {
                  e.target.setAttribute('data-fallback-attempted', '2');
                  // Try different image size parameter
                  console.log('Trying different image size for SMILES:', hoveredPreview.smiles);
                  e.target.src = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(hoveredPreview.smiles)}/PNG?image_size=small`;
                  return;
                }
                
                // Final fallback - show text message
                console.log('All fallbacks failed, showing text for SMILES:', hoveredPreview.smiles);
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'flex';
              }}
            />
            <div 
              className="flex items-center justify-center bg-gray-50 text-gray-500 text-sm w-full h-full"
              style={{ display: 'none' }}
            >
              <div className="text-center">
                <div>Structure Preview</div>
                <div className="text-xs mt-1">Service Unavailable</div>
                <div className="text-xs mt-1">Complex SMILES format</div>
              </div>
            </div>
          </div>
          <div className="text-xs text-gray-500 mt-2 font-mono break-all">
            {hoveredPreview.smiles.length > 25 
              ? `${hoveredPreview.smiles.substring(0, 25)}...` 
              : hoveredPreview.smiles
            }
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-2 w-full">        
        {/* Query type radio buttons above search box */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 mb-2 w-full">
          <Typography variant="small" color="blue-gray" className="mr-2">Query:</Typography>
          <label className="flex items-center gap-1 w-full sm:w-auto">
            <input
              type="radio"
              name="queryType"
              value="draw"
              checked={queryType === "draw"}
              onChange={() => setQueryType("draw")}
            />
            <span>Draw molecule</span>
          </label>
          <label className="flex items-center gap-1 w-full sm:w-auto">
            <input
              type="radio"
              name="queryType"
              value="text"
              checked={queryType === "text"}
              onChange={() => setQueryType("text")}
            />
            <span>Molecule ID, SMILES, CAS Number, IUPAC name, InChI, InChIKey</span>
          </label>
        </div>
        {/* Search type radio buttons */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 mb-2 w-full">
          <Typography variant="small" color="blue-gray" className="mr-2">Search type:</Typography>
          <label className="flex items-center gap-1 w-full sm:w-auto">
            <input
              type="radio"
              name="searchType"
              value="similarity"
              checked={searchType === "similarity"}
              onChange={() => setSearchType("similarity")}
            />
            <span>Similarity</span>
          </label>
          <label className="flex items-center gap-1 w-full sm:w-auto">
            <input
              type="radio"
              name="searchType"
              value="substructure"
              checked={searchType === "substructure"}
              onChange={() => setSearchType("substructure")}
            />
            <span>Substructure</span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="searchType"
              value="structure"
              checked={searchType === "structure"}
              onChange={() => setSearchType("structure")}
            />
            <span>Structure</span>
          </label>
          <label className="flex items-center gap-1 w-full sm:w-auto">
            <input
              type="radio"
              name="searchType"
              value="bas"
              checked={searchType === "bas"}
              onChange={() => setSearchType("bas")}
            />
            <span>BAS</span>
          </label>
          <label className="flex items-center gap-1 w-full sm:w-auto">
            <input
              type="radio"
              name="searchType"
              value="molweight"
              checked={searchType === "molweight"}
              onChange={() => setSearchType("molweight")}
            />
            <span>Mol weight</span>
          </label>
        </div>
        
        {/* Similarity Threshold Slider */}
        {searchType === "similarity" && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 mb-2 w-full p-4 bg-blue-50 rounded-lg border border-blue-200">
            <Typography variant="small" color="blue-gray" className="font-semibold min-w-fit">
              Similarity Threshold:
            </Typography>
            <div className="flex items-center gap-4 w-full sm:w-auto flex-1">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={similarityThreshold}
                onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
                className="flex-1 h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                style={{ minWidth: '150px' }}
              />
              <div className="flex items-center justify-center min-w-[60px] px-3 py-1 bg-blue-600 text-white rounded-lg font-bold text-lg">
                {similarityThreshold.toFixed(1)}
              </div>
            </div>
          </div>
        )}

        {/* Molecular Weight Range Sliders */}
        {searchType === "molweight" && (
          <div className="flex flex-col gap-3 mb-2 w-full p-4 bg-green-50 rounded-lg border border-green-200 molecular-weight-range">
            <Typography variant="small" color="blue-gray" className="font-semibold">
              Molecular Weight Range:
            </Typography>
            
            <div className="flex items-center gap-4 w-full">
              {/* Min value display */}
              <div className="flex items-center justify-center min-w-[80px] px-3 py-1 bg-green-600 text-white rounded-lg font-bold text-lg">
                {parseFloat(molWeightMin).toFixed(2)}
              </div>
              
              {/* Dual range slider container */}
              <div className="flex-1 relative" style={{ minWidth: '200px' }}>
                {/* Background track */}
                <div className="absolute w-full h-2 bg-green-200 rounded-lg" style={{ top: '50%', transform: 'translateY(-50%)' }}></div>
                
                {/* Active range highlight */}
                <div 
                  className="absolute h-2 bg-green-600 rounded-lg" 
                  style={{ 
                    left: `${(molWeightMin / 1000) * 100}%`,
                    width: `${((molWeightMax - molWeightMin) / 1000) * 100}%`,
                    top: '50%',
                    transform: 'translateY(-50%)'
                  }}
                ></div>
                
                {/* Max slider (placed first, lower z-index) */}
                <input
                  type="range"
                  min="0"
                  max="1000"
                  step="0.01"
                  value={molWeightMax}
                  onChange={(e) => {
                    const newMax = parseFloat(e.target.value);
                    if (newMax >= molWeightMin) {
                      setMolWeightMax(newMax);
                    }
                  }}
                  className="absolute w-full appearance-none bg-transparent cursor-pointer"
                  style={{
                    zIndex: 3,
                    height: '24px',
                    top: '50%',
                    transform: 'translateY(-50%)'
                  }}
                />
                
                {/* Min slider (placed second, higher z-index) */}
                <input
                  type="range"
                  min="0"
                  max="1000"
                  step="0.01"
                  value={molWeightMin}
                  onChange={(e) => {
                    const newMin = parseFloat(e.target.value);
                    if (newMin <= molWeightMax) {
                      setMolWeightMin(newMin);
                    }
                  }}
                  className="absolute w-full appearance-none bg-transparent cursor-pointer"
                  style={{
                    zIndex: 4,
                    height: '24px',
                    top: '50%',
                    transform: 'translateY(-50%)'
                  }}
                />
              </div>
              
              {/* Max value display */}
              <div className="flex items-center justify-center min-w-[80px] px-3 py-1 bg-green-600 text-white rounded-lg font-bold text-lg">
                {parseFloat(molWeightMax).toFixed(2)}
              </div>
            </div>
            
            <style dangerouslySetInnerHTML={{__html: `
              .molecular-weight-range input[type="range"] {
                pointer-events: none;
              }
              
              .molecular-weight-range input[type="range"]::-webkit-slider-thumb {
                appearance: none;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: #16a34a;
                cursor: pointer;
                border: 2px solid white;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                pointer-events: auto;
              }
              
              .molecular-weight-range input[type="range"]::-moz-range-thumb {
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: #16a34a;
                cursor: pointer;
                border: 2px solid white;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                pointer-events: auto;
              }
            `}} />
          </div>
        )}
        
        {queryType !== "draw" && (
        <div className="flex flex-col lg:flex-row gap-4 w-full">
          {/* Search section */}
          <div id="molecule-search" className="flex flex-col sm:flex-row items-stretch gap-2 w-full lg:w-1/2"> {/* 50% width search bar */}
            <Input
              label="Add molecule ID, SMILES, CAS Number, IUPAC name, InChI or InChIKey here"
              value={searchCode}
              onChange={e => setSearchCode(e.target.value)}
              className="flex-1 min-w-0 w-full" // full width within the container
            />
            <Button
              size="lg"
              color="green"
              onClick={handleSearch}
              disabled={searchLoading || !searchCode || selectedMolecules.size > 1}
              className="flex items-center gap-3 px-6 py-3 text-lg font-semibold shadow-md whitespace-nowrap"
            >
              {searchLoading ? <Spinner className="h-5 w-5" /> : <CloudIcon className="h-5 w-5" />}
              {searchLoading ? 'Searching...' : 'Search'}
            </Button>
          </div>
   

          {/* Docking section */}
          <div className="w-full lg:w-1/2 flex flex-col gap-4 p-6 rounded-lg shadow-lg bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200 border border-blue-300 self-start">
            <div className="flex gap-4 items-center">
              <button
                type="button"
                className="text-blue-700 underline text-left w-fit focus:outline-none hover:text-blue-900 transition-colors"
                tabIndex={0}
                onClick={() => setShowSimInputs(v => !v)}
              >
                Run 1 Click Docking
              </button>
              <button
                type="button"
                className="text-purple-700 underline text-left w-fit focus:outline-none hover:text-purple-900 transition-colors font-semibold"
                tabIndex={0}
                onClick={() => setShowDiffDockInputs(v => !v)}
              >
                DiffDock
              </button>
            </div>
            {showSimInputs && (
              <div id="simulation-inputs" className="flex items-center gap-0">
                <Input
                  label="PDB ID"
                  value={simPdbId}
                  onChange={e => setSimPdbId(e.target.value)}
                  className="w-full max-w-xs"
                />
                <Button
                  size="md"
                  color="blue"
                  onClick={handleSimulation}
                  disabled={simLoading || !simPdbId || !searchCode}
                  className="items-center gap-2"
                >
                  {simLoading ? 'Simulating...' : 'Simulate'}
                </Button>
              </div>
            )}
            {showDiffDockInputs && (
              <div id="diffdock-inputs" className="flex flex-col gap-2">
                <Input
                  label="PDB ID"
                  value={diffDockPdbId}
                  onChange={e => setDiffDockPdbId(e.target.value)}
                  className="w-full"
                />
                <Input
                  label="Ligand ID"
                  value={diffDockLigandId}
                  onChange={e => setDiffDockLigandId(e.target.value)}
                  className="w-full"
                />
                <Button
                  size="md"
                  color="purple"
                  onClick={handleDiffDock}
                  disabled={diffDockLoading || !diffDockPdbId || (!diffDockLigandId && !searchCode)}
                  className="items-center gap-2 w-full"
                >
                  {diffDockLoading ? 'Running DiffDock...' : 'Run'}
                </Button>
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Simulating Status Message */}
      {simLoading && (
        <Card className="mb-6">
          <CardBody className="text-center py-8">
            <div className="flex flex-col items-center gap-4">
              <Spinner className="h-8 w-8" color="blue" />
              <Typography variant="h6" color="blue-gray" className="mb-2">
                Processing Your Simulation
              </Typography>
              <Typography variant="small" color="gray" className="max-w-md">
                You will be redirected soon to 3D model viewer of the result. The SMILES will appear below the 3D model.
              </Typography>
            </div>
          </CardBody>
        </Card>
      )}

      {searchError && (
        <Alert color="yellow" className="mb-6">
          <Typography>{searchError}</Typography>
        </Alert>
      )}
      {searchResult && (
        <Card className="mb-6">
          <CardHeader
            variant="gradient"
            color="green"
            className="mb-4 grid h-12 place-items-center"
          >
            <Typography variant="h6" color="white">
              Search Result
            </Typography>
          </CardHeader>
          <CardBody>
            <pre className="whitespace-pre-wrap text-sm font-mono bg-white p-4 rounded border overflow-auto max-h-96">
              {JSON.stringify(searchResult, null, 2)}
            </pre>
          </CardBody>
        </Card>
      )}

      {queryType !== "text" && (
        <div id="editor" style={{ display: "flex", flexDirection: "row", width: "100%", height: "63vh", gap: "16px" }}>
          {/* Ketcher Editor - Half width */}
          <div style={{ width: "50%", height: "63vh", background: "#f5f5f5" }}>
            <iframe
              ref={ketcherIframeRef}
              src="/ketcher/index.html"
              title="Ketcher 2D Chemical Editor"
              style={{ width: "100%", height: "63vh", border: "2px solid #ccc", borderRadius: 8, background: "white" }}
              allowFullScreen
            />
          </div>
          
          {/* Controls Panel - Half width */}
          <div id="controls-panel" className="flex flex-col gap-4 w-1/2 p-4 bg-white rounded-lg shadow-lg">
            {/* Copy SMILES Button */}
            <Button 
              onClick={handleCopySmiles}
              color="orange"
              size="lg"
              className="w-full"
            >
              Copy SMILES from Drawing
            </Button>
            
            {/* Search section */}
            <div className="flex flex-col gap-2">
              <Typography variant="h6" color="blue-gray">Search Molecules</Typography>
              <Input
                label="Add molecule ID, SMILES, CAS Number, IUPAC name, InChI or InChIKey here"
                value={searchCode}
                onChange={e => setSearchCode(e.target.value)}
                className="w-full"
              />
              <Button
                size="lg"
                color="green"
                onClick={handleSearch}
                disabled={searchLoading || !searchCode || selectedMolecules.size > 1}
                className="flex items-center justify-center gap-3 w-full"
              >
                {searchLoading ? <Spinner className="h-5 w-5" /> : <CloudIcon className="h-5 w-5" />}
                {searchLoading ? 'Searching...' : 'Search'}
              </Button>
            </div>

            {/* Docking section */}
            <div className="flex flex-col gap-4 p-4 rounded-lg bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200 border border-blue-300">
              <div className="flex gap-4 items-center">
                <button
                  type="button"
                  className="text-blue-700 underline text-left w-fit focus:outline-none hover:text-blue-900 transition-colors"
                  tabIndex={0}
                  onClick={() => setShowSimInputs(v => !v)}
                >
                  Run 1 Click Docking
                </button>
                <button
                  type="button"
                  className="text-purple-700 underline text-left w-fit focus:outline-none hover:text-purple-900 transition-colors font-semibold"
                  tabIndex={0}
                  onClick={() => setShowDiffDockInputs(v => !v)}
                >
                  DiffDock
                </button>
              </div>
              {showSimInputs && (
                <div className="flex flex-col gap-2">
                  <Input
                    label="PDB ID"
                    value={simPdbId}
                    onChange={e => setSimPdbId(e.target.value)}
                    className="w-full"
                  />
                  <Button
                    size="md"
                    color="blue"
                    onClick={handleSimulation}
                    disabled={simLoading || !simPdbId || !searchCode}
                    className="flex items-center justify-center gap-2 w-full"
                  >
                    {simLoading ? 'Simulating...' : 'Simulate'}
                  </Button>
                </div>
              )}
              {showDiffDockInputs && (
                <div className="flex flex-col gap-2">
                  <Input
                    label="PDB ID"
                    value={diffDockPdbId}
                    onChange={e => setDiffDockPdbId(e.target.value)}
                    className="w-full"
                  />
                   <Input
                    label="LIGAND ID"
                    value={diffDockLigandId}
                    onChange={e => setDiffDockLigandId(e.target.value)}
                    className="w-full"
                  />
                  <Button
                    size="md"
                    color="purple"
                    onClick={handleDiffDock}
                    disabled={diffDockLoading || !diffDockPdbId || (!diffDockLigandId && !searchCode)}
                    className="flex items-center justify-center gap-2 w-full"
                  >
                    {diffDockLoading ? 'Running DiffDock...' : 'Run'}
                  </Button>
                </div>
              )}
            </div>
            
            {/* Page Size Selector */}
            <div className="flex flex-col gap-2 p-3 rounded-lg bg-gray-50 border border-gray-200">
              <Typography variant="small" color="blue-gray" className="font-semibold">
                Results per page:
              </Typography>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  // Reset to first page when changing page size
                  setCurrentPage(0);
                  setAllMolecules([]);
                  setTopMolecules([]);
                  setHasMore(true);
                  // Refetch with new page size
                  if (!isSearchActive) {
                    fetchAllMolecules(0, false);
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>
        </div>
      )}
        <div id="results" style={{ width: "100%", height: "70vh", background: "#e3e8ef" }}>
          {/* Header as a block element, not wrapping Card or div */}
          {/* <div className="mb-4">
            <Typography as="h5" variant="h5" color="blue-gray">Top {topMolecules.length} Molecules</Typography>
          </div> */}
          {topLoading && topMolecules.length === 0 && (
            <div className="flex items-center gap-2 mb-4">
              <Spinner className="h-5 w-5 text-blue-500" />
              <Typography>Loading molecules...</Typography>
            </div>
          )}
          {topError && (
            <Alert color="red" className="mb-4">{topError}</Alert>
          )}
          {!initialLoading && !topError && topMolecules.length > 0 && (
            <Card className="mb-4 overflow-auto" style={{ maxHeight: "70vh" }}>
              <CardBody className="p-0">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-white z-10 shadow-sm">
                    <tr>
                      <th className="p-2 font-bold bg-white">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={getSelectAllState().checked}
                            ref={(el) => {
                              if (el) el.indeterminate = getSelectAllState().indeterminate;
                            }}
                            onChange={(e) => handleSelectAll(e.target.checked)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <span>Select</span>
                        </div>
                      </th>
                      <th className="p-2 font-bold bg-white">#</th>
                      {searchType === "similarity" && <th className="p-2 font-bold bg-white">Similarity</th>}
                      <th className="p-2 font-bold bg-white">ID</th>
                      <th className="p-2 font-bold bg-white">IUPAC Name</th>
                      <th className="p-2 font-bold bg-white">SMILES</th>
                      <th className="p-2 font-bold bg-white">InChI</th>
                      <th className="p-2 font-bold bg-white">InChIKey</th>
                      <th className="p-2 font-bold bg-white">Formula</th>
                      <th className="p-2 font-bold bg-white">MW</th>
                      <th className="p-2 font-bold bg-white">Available (mg)</th>
                      <th className="p-2 font-bold bg-white">Price 1mg</th>
                      <th className="p-2 font-bold bg-white">Price 5mg</th>
                      <th className="p-2 font-bold bg-white">Price 10mg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topMolecules.map((mol, idx) => {
                      const moleculeId = mol.ASINEX_ID || mol.id || `molecule-${idx}`;
                      const uniqueKey = `${moleculeId}-${idx}`;
                      const isChecked = selectedMolecules.has(moleculeId);
                      
                      return (
                        <tr key={uniqueKey} className="border-b">
                          <td className="p-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => handleCheckboxChange(mol, e.target.checked)}
                              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                            />
                          </td>
                          <td className="p-2">{idx + 1}</td>
                          {searchType === "similarity" && (
                            <td className="p-2 font-bold text-blue-600" title={mol.SIMILARITY ? `Similarity: ${mol.SIMILARITY}` : "N/A"}>
                              {mol.SIMILARITY !== null && mol.SIMILARITY !== undefined ? parseFloat(mol.SIMILARITY).toFixed(3) : "N/A"}
                            </td>
                          )}
                        <td
                          className="p-2 cursor-pointer hover:bg-blue-100"
                          title={mol.ASINEX_ID ? String(mol.ASINEX_ID).replace(/^ASN/i, "") : "N/A"}
                          onClick={() => setSearchCode(mol.ASINEX_ID ? String(mol.ASINEX_ID).replace(/^ASN/i, "") : "")}
                          onMouseEnter={(e) => handleMouseEnter(extractSmiles(mol), e, "mcule ID")}
                          onMouseLeave={handleMouseLeave}
                        >
                          {(mol.ASINEX_ID ? String(mol.ASINEX_ID).replace(/^ASN/i, "") : "N/A").toString().slice(0,moleculeLimit)}{(mol.ASINEX_ID ? String(mol.ASINEX_ID).replace(/^ASN/i, "") : "N/A").toString().length > moleculeLimit ? '...' : ''}
                        </td>
                        <td
                          className="p-2 cursor-pointer hover:bg-blue-100"
                          title={mol.IUPAC_NAME || "N/A"}
                          onClick={() => setSearchCode(mol.IUPAC_NAME || "")}
                          onMouseEnter={(e) => handleMouseEnter(extractSmiles(mol), e, "IUPAC Name")}
                          onMouseLeave={handleMouseLeave}
                        >
                          {(mol.IUPAC_NAME || "N/A").toString().slice(0,moleculeLimit)}{(mol.IUPAC_NAME || "N/A").toString().length > moleculeLimit ? '...' : ''}
                        </td>
                        <td
                          className="p-2 font-mono text-xs cursor-pointer hover:bg-blue-100"
                          title={mol.SMILES_STRING || mol.SMILES || mol.smiles || "N/A"}
                          onClick={async () => {
                            const smiles = mol.SMILES_STRING || mol.SMILES || mol.smiles || "";
                            setSearchCode(smiles);
                            try {
                              await navigator.clipboard.writeText(smiles);
                              setShowClipboardPopup(true);
                              setTimeout(() => setShowClipboardPopup(false), 3000);
                            } catch (err) {
                              alert("Failed to copy SMILES to clipboard: " + err);
                            }
                          }}
                          onMouseEnter={(e) => handleMouseEnter(extractSmiles(mol), e, "SMILES")}
                          onMouseLeave={handleMouseLeave}
                        >
                          {(mol.SMILES_STRING || mol.SMILES || mol.smiles || "N/A").toString().slice(0,moleculeLimit)}{(mol.SMILES_STRING || mol.SMILES || mol.smiles || "N/A").toString().length > moleculeLimit ? '...' : ''}
                        </td>
                        <td
                          className="p-2 font-mono text-xs cursor-pointer hover:bg-blue-100"
                          title={mol.INCHI || "N/A"}
                          onClick={async () => {
                            const inchi = mol.INCHI || "";
                            setSearchCode(inchi);
                            try {
                              await navigator.clipboard.writeText(inchi);
                              setShowClipboardPopup(true);
                              setTimeout(() => setShowClipboardPopup(false), 3000);
                            } catch (err) {
                              alert("Failed to copy InChI to clipboard: " + err);
                            }
                          }}
                          onMouseEnter={(e) => handleMouseEnter(extractSmiles(mol), e, "InChI")}
                          onMouseLeave={handleMouseLeave}
                        >
                          {(mol.INCHI || "N/A").toString().slice(0,moleculeLimit)}{(mol.INCHI || "N/A").toString().length > moleculeLimit ? '...' : ''}
                        </td>
                        <td
                          className="p-2 font-mono text-xs cursor-pointer hover:bg-blue-100"
                          title={mol.INCHIKEY || "N/A"}
                          onClick={() => setSearchCode(mol.INCHIKEY || "")}
                          onMouseEnter={(e) => handleMouseEnter(extractSmiles(mol), e, "InChIKey")}
                          onMouseLeave={handleMouseLeave}
                        >
                          {(mol.INCHIKEY || "N/A").toString().slice(0,moleculeLimit)}{(mol.INCHIKEY || "N/A").toString().length > moleculeLimit ? '...' : ''}
                        </td>
                        <td className="p-2" title={mol.BRUTTO_FORMULA || "N/A"}>{(mol.BRUTTO_FORMULA || "N/A").toString().slice(0,moleculeLimit)}{(mol.BRUTTO_FORMULA || "N/A").toString().length > moleculeLimit ? '...' : ''}</td>
                        <td className="p-2" title={formatNumericValue(mol.MW_STRUCTURE)}>{formatNumericValue(mol.MW_STRUCTURE).toString().slice(0,moleculeLimit)}{formatNumericValue(mol.MW_STRUCTURE).toString().length > moleculeLimit ? '...' : ''}</td>
                        <td className="p-2" title={formatNumericValue(mol.AVAILABLE_MG)}>{formatNumericValue(mol.AVAILABLE_MG).toString().slice(0,moleculeLimit)}{formatNumericValue(mol.AVAILABLE_MG).toString().length > moleculeLimit ? '...' : ''}</td>
                        <td className="p-2 cursor-pointer group" title={mol.PRICE_1MG ? formatPriceWithCurrency(mol.PRICE_1MG) : "-"}
                          onClick={() => addToCart(mol, 1, mol.PRICE_1MG)}
                        >
                          <span>{(mol.PRICE_1MG ? formatPriceWithCurrency(mol.PRICE_1MG) : "-").toString().slice(0,moleculeLimit)}{(mol.PRICE_1MG ? formatPriceWithCurrency(mol.PRICE_1MG) : "-").toString().length > moleculeLimit ? '...' : ''}</span>
                          {mol.PRICE_1MG && (
                            <ShoppingCartIcon
                              className="inline-block h-5 w-5 text-green-600 ml-2 cursor-pointer opacity-70 group-hover:opacity-100"
                              title="Add 1mg to cart"
                            />
                          )}
                        </td>
                        <td className="p-2 cursor-pointer group" title={mol.PRICE_5MG ? formatPriceWithCurrency(mol.PRICE_5MG) : "-"}
                          onClick={() => addToCart(mol, 5, mol.PRICE_5MG)}
                        >
                          <span>{(mol.PRICE_5MG ? formatPriceWithCurrency(mol.PRICE_5MG) : "-").toString().slice(0,moleculeLimit)}{(mol.PRICE_5MG ? formatPriceWithCurrency(mol.PRICE_5MG) : "-").toString().length > moleculeLimit ? '...' : ''}</span>
                          {mol.PRICE_5MG && (
                            <ShoppingCartIcon
                              className="inline-block h-5 w-5 text-green-600 ml-2 cursor-pointer opacity-70 group-hover:opacity-100"
                              title="Add 5mg to cart"
                            />
                          )}
                        </td>
                        <td className="p-2 cursor-pointer group" title={mol.PRICE_10MG ? formatPriceWithCurrency(mol.PRICE_10MG) : "-"}
                          onClick={() => addToCart(mol, 10, mol.PRICE_10MG)}
                        >
                          <span>{(mol.PRICE_10MG ? formatPriceWithCurrency(mol.PRICE_10MG) : "-").toString().slice(0,moleculeLimit)}{(mol.PRICE_10MG ? formatPriceWithCurrency(mol.PRICE_10MG) : "-").toString().length > moleculeLimit ? '...' : ''}</span>
                          {mol.PRICE_10MG && (
                            <ShoppingCartIcon
                              className="inline-block h-5 w-5 text-green-600 ml-2 cursor-pointer opacity-70 group-hover:opacity-100"
                              title="Add 10mg to cart"
                            />
                          )}
                        </td>
                      </tr>
                    )
                    })}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}
          
          {/* Pagination Loading Indicator */}
          {topLoading && topMolecules.length > 0 && (
            <div className="flex items-center justify-center gap-2 mb-4 py-4">
              <Spinner className="h-5 w-5 text-blue-500" />
              <Typography variant="small" color="gray">Loading more molecules...</Typography>
            </div>
          )}
          
          {/* No More Data Message */}
          {!hasMore && topMolecules.length > 0 && !topLoading && (
            <div className="text-center py-4 mb-4">
              <Typography variant="small" color="gray">
                No more molecules to load. Showing {topMolecules.length} total molecules.
              </Typography>
            </div>
          )}
          
          {/* No Data State */}
          {!initialLoading && !topLoading && !topError && topMolecules.length === 0 && (
            <div className="text-center py-8">
              <Typography variant="small" color="gray">
                No molecules found. Try searching for specific compounds.
              </Typography>
            </div>
          )}
        </div>
      {showClipboardPopup && (
        <Alert color="green" className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 w-fit px-6 py-3 text-center shadow-lg">
          Ctrl+V into Draw molecule
        </Alert>
      )}
      {simLoading && (
        <div className="flex justify-center items-center mb-6">
          <Spinner className="h-8 w-8 text-blue-500" />
          <Typography className="ml-2">Running simulation...</Typography>
        </div>
      )}
      {simError && (
        <Alert color="red" className="mb-6">
          <div className="flex items-center gap-2">
            <Typography variant="h6">Simulation Error:</Typography>
            <Typography>{simError}</Typography>
          </div>
        </Alert>
      )}
      {simResult && (
        <Card className="mb-6">
          <CardHeader
            variant="gradient"
            className="mb-4 grid h-12 place-items-center"
          >
            <Typography variant="h6" color="black">
              Simulation Result
            </Typography>
          </CardHeader>
          <CardBody>
            <pre className="whitespace-pre-wrap text-sm font-mono bg-white p-4 rounded border overflow-auto max-h-48">
              {JSON.stringify(simResult, null, 2)}
            </pre>
            {simResult.simulationKey && (
              <div className="mt-4 flex gap-2">
                <a download
                  className="inline-block px-4 py-2 border border-blue-500 text-blue-500 rounded hover:bg-blue-50 transition"
                  href={API_CONFIG.buildApiUrl(`/sanitizedpdb/${simResult.simulationKey}`)}
                  target="_blank"
                >
                  View Sanitized PDB Result
                </a>
                <a download
                  className="inline-block px-4 py-2 border border-green-500 text-green-500 rounded hover:bg-green-50 transition"
                  href={API_CONFIG.buildApiUrl(`/sanitizedminimalsdf/${simResult.simulationKey}`)}
                  target="_blank"
                >
                  View Sanitized SDF Result
                </a>
              </div>
            )}
          </CardBody>
        </Card>
      )}
      {diffDockLoading && (
        <Card className="mb-6">
          <CardBody className="text-center py-8">
            <div className="flex flex-col items-center gap-4">
              <Spinner className="h-8 w-8" color="purple" />
              <Typography variant="h6" color="blue-gray" className="mb-2">
                Running DiffDock Simulation
              </Typography>
              <Typography variant="small" color="gray" className="max-w-md">
                Please wait while DiffDock processes your protein-ligand docking...
              </Typography>
            </div>
          </CardBody>
        </Card>
      )}
      {diffDockError && (
        <Alert color="red" className="mb-6">
          <div className="flex items-center gap-2">
            <Typography variant="h6">DiffDock Error:</Typography>
            <Typography>{diffDockError}</Typography>
          </div>
        </Alert>
      )}
      {diffDockResult && (
        <Card className="mb-6">
          <CardHeader
            variant="gradient"
            color="purple"
            className="mb-4 grid h-12 place-items-center"
          >
            <Typography variant="h6" color="white">
              DiffDock Result
            </Typography>
          </CardHeader>
          <CardBody>
            <pre className="whitespace-pre-wrap text-sm font-mono bg-white p-4 rounded border overflow-auto max-h-48">
              {JSON.stringify(diffDockResult, null, 2)}
            </pre>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

export default Simulation;
