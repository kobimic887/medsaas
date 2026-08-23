import {
  CloudIcon,
} from "@heroicons/react/24/outline";
import { ShoppingCartIcon } from '@heroicons/react/24/solid';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Spinner,
  Typography,
} from "@material-tailwind/react";
import {
  useEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { convertPriceToEuro, formatPrice } from '@/utils/algo/algo';
import { API_CONFIG, getAuthToken } from "@/utils/constants";
import { copyToClipboard } from '@/utils/copyToClipboard';
import { clearViewerStorage, markViewerHandoff, normalizePdbId, rcsbPdbDownloadUrl } from '@/utils/viewerStorage';

function catalogRowsFromResponse(result) {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];

  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.molecules)) return result.molecules;
  if (Array.isArray(result.list)) return result.list;
  if (Array.isArray(result.items)) return result.items;
  if (Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result.results)) return result.results;

  if (result.data && typeof result.data === 'object') return [result.data];
  return result.ASINEX_ID || result.BAS_CODE || result.bas_code || result.id_number || result.id
    ? [result]
    : [];
}

function normalizeCatalogMolecule(molecule = {}) {
  return {
    ...molecule,
    ASINEX_ID: molecule.ASINEX_ID || molecule.BAS_CODE || molecule.bas_code || molecule.basCode || molecule.id_number || molecule.id,
    CATALOG_ROW_ID: molecule.CATALOG_ROW_ID || molecule.id_number || molecule.id,
    SMILES_STRING: molecule.SMILES_STRING || molecule.SMILES || molecule.smiles_string || molecule.smiles,
    BRUTTO_FORMULA: molecule.BRUTTO_FORMULA || molecule.brutto_formula || molecule.formula,
    MW_STRUCTURE: molecule.MW_STRUCTURE ?? molecule.mol_weight ?? molecule.molecular_weight,
    AVAILABLE_MG: molecule.AVAILABLE_MG ?? molecule.available_mg,
    PRICE_1MG: molecule.PRICE_1MG ?? molecule.price_1mg,
    PRICE_2MG: molecule.PRICE_2MG ?? molecule.price_2mg,
    PRICE_5MG: molecule.PRICE_5MG ?? molecule.price_5mg,
    PRICE_10MG: molecule.PRICE_10MG ?? molecule.price_10mg,
    IUPAC_NAME: molecule.IUPAC_NAME || molecule.iupac_name || "N/A",
    INCHI: molecule.INCHI || molecule.inchi || "N/A",
    INCHIKEY: molecule.INCHIKEY || molecule.inchikey || "N/A",
    SIMILARITY: molecule.SIMILARITY ?? molecule.similarity ?? molecule.Similarity ?? null,
  };
}

/** Prefer plain wording over bare "HTTP 502: Bad Gateway" (restart gap or upstream). */
function describeUpstreamHttpError(status, statusText = '', bodyHint = '', kind = 'catalog') {
  if (status === 502 || status === 503 || status === 504) {
    return kind === 'docking'
      ? 'Upstream docking service failed. Please try again.'
      : 'Catalog temporarily unavailable (redeploy or upstream). Please try again.';
  }
  const base = `HTTP ${status}${statusText ? `: ${statusText}` : ''}`;
  if (!bodyHint) return base;
  const trimmed = String(bodyHint).trim().slice(0, 200);
  return trimmed ? `${base} - ${trimmed}` : base;
}

/** Brief client retry for gateway 5xx during pyxis-web restart (nginx 502 while bun is down). */
async function fetchWithGatewayRetry(url, init = {}, { maxAttempts = 3, baseDelayMs = 400 } = {}) {
  let lastResponse;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResponse = await fetch(url, init);
    const retryable =
      lastResponse.status === 502 ||
      lastResponse.status === 503 ||
      lastResponse.status === 504;
    if (!retryable || attempt === maxAttempts) return lastResponse;
    if (init.signal?.aborted) return lastResponse;
    await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
  }
  return lastResponse;
}

export function Simulation() {
  // Popup state for clipboard copy
  const [showClipboardPopup, setShowClipboardPopup] = useState(false);
  // State for toggling simulation inputs
  const [showSimInputs, setShowSimInputs] = useState(false);
  const [showDiffDockInputs, setShowDiffDockInputs] = useState(false);
  const [searchCode, setSearchCode] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");

  const [simPdbId, setSimPdbId] = useState("");
  const [diffDockPdbId, setDiffDockPdbId] = useState("");
  const [diffDockLigandId, setDiffDockLigandId] = useState("");
  const [simResult, setSimResult] = useState(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simElapsedSeconds, setSimElapsedSeconds] = useState(0);
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
  const moleculeLimit = 30;
  const [similarityThreshold, setSimilarityThreshold] = useState(0.7); // Similarity threshold (0-1)
  const [molWeightMin, setMolWeightMin] = useState(0); // Molecular weight minimum (0-1000)
  const [molWeightMax, setMolWeightMax] = useState(1000); // Molecular weight maximum (0-1000)
  const [lastFromId, setLastFromId] = useState(0); // Track last fromId for pagination
  const [isSearchActive, setIsSearchActive] = useState(false); // Track if search is active
  const [lastSearchQuery, setLastSearchQuery] = useState(""); // Track last search query

  const [cart, setCart] = useState([]);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(0);
  const [_allMolecules, setAllMolecules] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [catalogSettled, setCatalogSettled] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  
  // Hover preview state
  const [hoveredPreview, setHoveredPreview] = useState(null);
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0 });
  
  // Checkbox selection state
  const [selectedMolecules, setSelectedMolecules] = useState(new Set());

  useEffect(() => {
    if (!simLoading) {
      setSimElapsedSeconds(0);
      return undefined;
    }

    const startedAt = Date.now();
    const updateElapsed = () => setSimElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [simLoading]);
  
  // Currency conversion state
  const [currency, setCurrency] = useState('USD');
  const [exchangeRate, setExchangeRate] = useState(1);
  const [_userCountry, setUserCountry] = useState('US');

  // Refs to prevent infinite loops in scroll handler
  const hasMoreRef = useRef(true);
  const topLoadingRef = useRef(false);
  const currentPageRef = useRef(0);
  const initialLoadingRef = useRef(true);
  const isLoadingPageRef = useRef(false); // Prevent multiple simultaneous requests
  const ketcherIframeRef = useRef(null);
  const isSearchActiveRef = useRef(false);
  const lastSearchQueryRef = useRef("");
  const lastFromIdRef = useRef(0);
  const searchTypeRef = useRef(searchType);
  const pageSizeRef = useRef(pageSize);
  const similarityThresholdRef = useRef(similarityThreshold);
  const molWeightMinRef = useRef(molWeightMin);
  const molWeightMaxRef = useRef(molWeightMax);
  const browseControllerRef = useRef(null);
  const browseRequestIdRef = useRef(0);
  const searchControllerRef = useRef(null);
  const searchRequestIdRef = useRef(0);
  const messageTimerRef = useRef(null);
  const clipboardTimerRef = useRef(null);
  const resultDownloadControllerRef = useRef(null);
  const [resultDownloadKind, setResultDownloadKind] = useState('');

  const navigate = useNavigate();

  const showMessage = (text, type = 'success', duration = 4000) => {
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    setMessage(text);
    setMessageType(type);
    if (duration > 0) {
      messageTimerRef.current = window.setTimeout(() => {
        setMessage('');
        setMessageType('');
        messageTimerRef.current = null;
      }, duration);
    }
  };

  const showClipboardConfirmation = () => {
    if (clipboardTimerRef.current) window.clearTimeout(clipboardTimerRef.current);
    setShowClipboardPopup(true);
    clipboardTimerRef.current = window.setTimeout(() => {
      setShowClipboardPopup(false);
      clipboardTimerRef.current = null;
    }, 3000);
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

  useEffect(() => {
    lastSearchQueryRef.current = lastSearchQuery;
    lastFromIdRef.current = lastFromId;
    searchTypeRef.current = searchType;
    pageSizeRef.current = pageSize;
    similarityThresholdRef.current = similarityThreshold;
    molWeightMinRef.current = molWeightMin;
    molWeightMaxRef.current = molWeightMax;
  }, [lastSearchQuery, lastFromId, searchType, pageSize, similarityThreshold, molWeightMin, molWeightMax]);

  useEffect(() => () => {
    browseControllerRef.current?.abort();
    searchControllerRef.current?.abort();
    resultDownloadControllerRef.current?.abort();
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    if (clipboardTimerRef.current) window.clearTimeout(clipboardTimerRef.current);
  }, []);

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

  // Function to fetch molecules from /asinex/all/x_10
  const fetchAllMolecules = async (page = 0, append = false, requestedPageSize = pageSizeRef.current) => {
    // Only the infinite-scroll path needs this guard — it fires from a scroll handler
    // and would otherwise queue the same page repeatedly. A fresh (non-append) load
    // must never be blocked by it: that path aborts whatever is in flight and replaces
    // it, so returning early here left the catalog permanently empty whenever the
    // mount effect ran twice (its first request aborted, its second one swallowed).
    if (append && isLoadingPageRef.current) {
      return;
    }

    if (!append) browseControllerRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++browseRequestIdRef.current;
    browseControllerRef.current = controller;
    isLoadingPageRef.current = true;
    try {
      if (!append) {
        // Keep the empty state hidden for the entire first request. The catalog can
        // legitimately take a few seconds to answer; an empty array during that
        // window is not an empty catalog.
        setCatalogSettled(false);
        setInitialLoading(true);
        setTopLoading(true);
        setTopError("");
      }
      
      const token = getAuthToken();
      const res = await fetchWithGatewayRetry(
        API_CONFIG.buildApiUrl(`/asinex/all/${page}_${requestedPageSize}`),
        {
          method: "GET",
          signal: controller.signal,
          headers: {
            'accept': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
        }
      );

      if (!res.ok) {
        throw new Error(describeUpstreamHttpError(res.status, res.statusText));
      }
      
      const result = await res.json();
      // Aborting a fetch does not guarantee that a response already handed to the
      // browser stops resolving. Never let an older refresh/page response overwrite
      // the request that is currently visible.
      if (browseControllerRef.current !== controller || requestId !== browseRequestIdRef.current) {
        return;
      }
      const resultRows = catalogRowsFromResponse(result);
      const formattedMolecules = resultRows.map(normalizeCatalogMolecule);
      
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
      if (formattedMolecules.length < requestedPageSize) {
        setHasMore(false);
      } else {
        setHasMore(true);
      }
      
      setCurrentPage(page);
      
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (browseControllerRef.current !== controller || requestId !== browseRequestIdRef.current) return;
      setTopError(`Failed to fetch molecules: ${err.message}`);
      console.error('Error fetching molecules:', err);
    } finally {
      if (browseControllerRef.current === controller && requestId === browseRequestIdRef.current) {
        browseControllerRef.current = null;
        setTopLoading(false);
        if (!append) {
          setInitialLoading(false);
          setCatalogSettled(true);
        }
        isLoadingPageRef.current = false;
      }
    }
  };

  const handleSearch = async () => {
    browseControllerRef.current?.abort();
    // Invalidate any response that was already past fetch cancellation before
    // starting the newer search request.
    browseRequestIdRef.current += 1;
    searchControllerRef.current?.abort();
    // A search replaces the initial browse request. Settle that browse lifecycle
    // immediately so its stale aborted finally block cannot leave the page believing
    // it is still waiting forever.
    setInitialLoading(false);
    setCatalogSettled(true);
    setTopLoading(false);
    isLoadingPageRef.current = false;
    const controller = new AbortController();
    const requestId = ++searchRequestIdRef.current;
    searchControllerRef.current = controller;
    isSearchActiveRef.current = false;
    setIsSearchActive(false);
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
      const token = getAuthToken();
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

      // A new search always starts at the beginning. setLastFromId(0) above is
      // asynchronous, so reading lastFromId here reused the previous query's cursor.
      const fromId = 0;

      // Prepare request body with pagination parameters
      const requestBody = {
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
      const res = await fetchWithGatewayRetry(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'accept': '*/*',
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(requestBody)
      });
      
      const responseText = await res.text();
      if (!res.ok) {
        throw new Error(describeUpstreamHttpError(res.status, res.statusText, responseText));
      }
      const result = responseText.trim() ? JSON.parse(responseText) : [];
      if (searchControllerRef.current !== controller || requestId !== searchRequestIdRef.current) {
        return;
      }
      const resultRows = catalogRowsFromResponse(result);
      const formattedMolecules = resultRows.map(normalizeCatalogMolecule);
      setTopMolecules(formattedMolecules);
      setSelectedMolecules(new Set());
      setHasMore(formattedMolecules.length >= pageSize);

      if (formattedMolecules.length > 0) {
        const maxId = Math.max(...formattedMolecules.map((molecule) => {
          const id = molecule.ASINEX_ID || '0';
          return Number.parseInt(id, 10) || 0;
        }));
        setLastFromId(maxId);
      }
      isSearchActiveRef.current = true;
      setIsSearchActive(true);
      setLastSearchQuery(rawQuery);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (searchControllerRef.current !== controller || requestId !== searchRequestIdRef.current) return;
      setSearchError(`Search failed: ${err.message}`);
    } finally {
      if (searchControllerRef.current === controller && requestId === searchRequestIdRef.current) {
        searchControllerRef.current = null;
        setSearchLoading(false);
      }
    }
  };

  // Function to load more search results (for pagination during scroll)
  const loadMoreSearchResults = async () => {
    const activeSearch = isSearchActiveRef.current;
    const query = lastSearchQueryRef.current;
    if (!activeSearch || !query || searchControllerRef.current) return;

    const controller = new AbortController();
    const requestId = searchRequestIdRef.current;
    searchControllerRef.current = controller;
    setTopLoading(true);
    
    try {
      const token = getAuthToken();
      const rawQuery = query.trim();
      const activeSearchType = searchTypeRef.current;
      const activePageSize = pageSizeRef.current;
      const activeThreshold = similarityThresholdRef.current;
      const activeMolWeightMin = molWeightMinRef.current;
      const activeMolWeightMax = molWeightMaxRef.current;

      // Map UI searchType to API method names
      const methodMap = {
        similarity: 'similarity',
        substructure: 'substructure',
        structure: 'structure',
        bas: 'bas',
        molweight: 'mw',
        mw: 'mw'
      };
      const method = methodMap[activeSearchType] || 'similarity';

      // Prepare request body with pagination parameters
      const requestBody = {
        fromId: lastFromIdRef.current,
        pageSize: activePageSize
      };

      // Add method-specific parameters
      if (activeSearchType === 'bas') {
        requestBody.bas = rawQuery;
      } else if (activeSearchType === 'similarity') {
        requestBody.smiles = rawQuery;
        requestBody.threshold = activeThreshold;
      } else if (activeSearchType === 'molweight' || activeSearchType === 'mw') {
        requestBody.smiles = rawQuery;
        requestBody.mwFrom = activeMolWeightMin;
        requestBody.mwTo = activeMolWeightMax;
      } else {
        requestBody.smiles = rawQuery;
      }

      // POST to /api4/{method} with JSON body
      const url = API_CONFIG.buildApiUrl(`/api4/${method}`);
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'accept': '*/*',
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!res.ok) {
        throw new Error(describeUpstreamHttpError(res.status, res.statusText));
      }
      
      const responseText = await res.text();
      const result = responseText.trim() ? JSON.parse(responseText) : [];
      if (searchControllerRef.current !== controller || requestId !== searchRequestIdRef.current) {
        return;
      }
      
      // Check if response fromId matches request fromId (meaning we've hit the end)
      if (result.fromId !== undefined && result.fromId === lastFromIdRef.current) {
        setHasMore(false);
        return;
      }
      
      const resultRows = catalogRowsFromResponse(result);
      const formattedMolecules = resultRows.map(normalizeCatalogMolecule);

      if (formattedMolecules.length > 0) {
        // Append to existing molecules
        setTopMolecules(prev => [...prev, ...formattedMolecules]);
        
        // Update lastFromId to the maximum id_number from the response for next page
        if (formattedMolecules.length > 0) {
          const maxId = Math.max(...formattedMolecules.map(m => {
            const id = m.ASINEX_ID || '0';
            return Number.parseInt(id, 10) || 0;
          }));
          lastFromIdRef.current = maxId;
          setLastFromId(maxId);
        }
        
        // Check if we have more data
        if (formattedMolecules.length < activePageSize) {
          setHasMore(false);
        }
      } else {
        setHasMore(false);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (searchControllerRef.current !== controller || requestId !== searchRequestIdRef.current) return;
      console.error('Failed to load more search results:', err);
      setHasMore(false);
    } finally {
      if (searchControllerRef.current === controller && requestId === searchRequestIdRef.current) {
        searchControllerRef.current = null;
        setTopLoading(false);
      }
    }
  };

  const handleSimulation = async () => {
    // Check all required inputs before discarding the previous result.
    if (!searchCode) {
      setSimError("Please search for a molecule first to get the SMILES code for docking");
      return;
    }
    if (!simPdbId) {
      setSimError("Please provide a PDB ID before starting docking");
      return;
    }
    const _searchSmiles = searchCode.replace(',', ';').trim();
    clearViewerStorage();
    setSimLoading(true);
    setSimError("");
    setSimResult(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 11 * 60 * 1000);
    try {
      const token = getAuthToken();
      
      // Create JSON payload
      const requestBody = {
        pdbid: simPdbId,
        smiles: encodeURIComponent(_searchSmiles)
      };
      
      // This page navigates to authenticated artifact URLs and only needs the
      // durable handle. Avoid transferring the full PDB/SDF response just to
      // discard it and fetch those artifacts again on the result page.
      const res = await fetch(API_CONFIG.buildApiUrl('/simulation?includeResult=false'), {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      const result = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          throw new Error(result?.error || describeUpstreamHttpError(res.status, '', '', 'docking'));
        }
        throw new Error(result?.error || `Simulation failed (HTTP ${res.status})`);
      }

      clearDiffDockStorage();
      setSimResult(result);

    } catch (err) {
      if (err.name === 'AbortError') {
        setSimError('Docking is taking longer than expected and was stopped after 11 minutes. No result was returned.');
      } else {
        setSimError(`Failed to simulate: ${err.message}`);
      }
    } finally {
      window.clearTimeout(timeout);
      setSimLoading(false);
    }
  };
    const clearDiffDockStorage = () => {
      localStorage.removeItem('diffdock_protein');
      localStorage.removeItem('diffdock_ligand');
      localStorage.removeItem('diffdock_ligand_position');
    }
  const handleDiffDock = async () => {
    const ligand_file_type = "sdf";
    // Check if we have both PDB ID and Ligand ID
    if (!diffDockPdbId) {
      setDiffDockError("Please provide a PDB ID for DiffDock");
      return;
    }
    
    // Prefer the explicit ligand field; drawing/search text remains a useful fallback.
    const ligandId = diffDockLigandId.trim() || searchCode.trim();

    if (!ligandId) {
      setDiffDockError("Please provide a Ligand ID for DiffDock or search for a molecule");
      return;
    }
    
    clearViewerStorage();
    clearDiffDockStorage();
    setDiffDockLoading(true);
    setDiffDockError("");
    setDiffDockResult(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 11 * 60 * 1000);
    try {
      const token = getAuthToken();
      
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
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.error || `HTTP ${res.status}: ${res.statusText}`);
      if (!result || result.status === 'failed') {
        throw new Error(result?.details || 'DiffDock returned no usable pose');
      }
      setDiffDockResult(result);
      showMessage('DiffDock simulation completed successfully!');
    } catch (err) {
      if (err.name === 'AbortError') {
        setDiffDockError('DiffDock is taking longer than expected and was stopped after 11 minutes. No result was returned.');
      } else {
        setDiffDockError(`Failed to run DiffDock: ${err.message}`);
      }
    } finally {
      window.clearTimeout(timeout);
      setDiffDockLoading(false);
    }
  };

  // Redirect to Molstar3D when simulation results are available
  useEffect(() => {
    if (simResult && simResult.simulationKey) {
      const pdbLabel = normalizePdbId(simPdbId);
      // Show the public RCSB entry (waters, crystal ligands, default assembly)
      // in Molstar. Docking still used the stripped receptor; Download Sanitized
      // PDB remains the prepared file from /api/sanitizedpdb.
      const pdbUrl = rcsbPdbDownloadUrl(pdbLabel)
        || API_CONFIG.buildApiUrl(`/sanitizedpdb/${simResult.simulationKey}`);
      // Match the legacy result handoff: the reduced SDF supplies the clickable
      // SMILES/score rows, while the selected pose is fetched separately below.
      const sdfUrl = API_CONFIG.buildApiUrl(`/sanitizedminimalsdf/${simResult.simulationKey}`);
      const pdbName = `PDB ${pdbLabel || String(simPdbId).trim().toUpperCase()} · Simulation result`;
      
      // Store URLs, navigate, and only THEN look up the IP.
      //
      // This used to `await fetch('https://api.ipify.org')` before navigating, with no
      // timeout and no abort. A third-party outage or a slow DNS answer therefore left the
      // user staring at a finished simulation for as long as the request took to give up —
      // potentially forever. The IP is diagnostic metadata; it is not worth one second of
      // the user's time, let alone an unbounded number.
      const storeSimulationData = () => {
        // Store URLs in localStorage and navigate to Molstar3D
        localStorage.setItem('molstar_pdb_url', pdbUrl);
        localStorage.setItem('molstar_pdb_name', pdbName);
        localStorage.setItem('molstar_sdf_url', sdfUrl);
        localStorage.setItem('molstar_simulation_key', simResult.simulationKey);
        if (pdbLabel) {
          localStorage.setItem('molstar_display_pdb_id', pdbLabel);
        } else {
          localStorage.removeItem('molstar_display_pdb_id');
        }
        // Drop any protein left over from opening a share link (`?pdb=…`). That key
        // outlives the view that set it, and the viewer used to prefer it over this
        // run's own protein — so every simulation after one such link rendered the
        // wrong structure, and the pose vanished because it belongs to a different
        // coordinate frame. Never re-store molstar_pdb_code for a simulation run:
        // the authenticated molstar_pdb_url is authoritative; sticky codes caused 1cx7.
        localStorage.removeItem('molstar_pdb_code');
        
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
          userIp: null,
          timestamp: new Date().toISOString()
        };
        
        // Store updated dictionary
        localStorage.setItem('molstar_simulation_pairs', JSON.stringify(simulationPairs));

        // Query + one-shot flag + TTL stamp: molstar3d auto-loads on handoff /
        // deep link, and restores from localStorage for ~5 minutes on bare nav.
        markViewerHandoff();
        const handoffParams = new URLSearchParams({
          simulation: simResult.simulationKey,
          pdb: String(simPdbId || '').trim(),
        });
        navigate(`/dashboard/molstar3d?${handoffParams.toString()}`);

        // Fire-and-forget, after navigation, with a hard 5s ceiling. Re-reads the dictionary
        // before writing because the user may have started another simulation by now.
        fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) })
          .then((r) => (r.ok ? r.json() : null))
          .then((ipData) => {
            if (!ipData?.ip) return;
            try {
              const pairs = JSON.parse(localStorage.getItem('molstar_simulation_pairs') || '{}');
              if (pairs[simResult.simulationKey]) {
                pairs[simResult.simulationKey].userIp = ipData.ip;
                localStorage.setItem('molstar_simulation_pairs', JSON.stringify(pairs));
              }
            } catch (err) {
              console.error('Failed to record IP for simulation:', err);
            }
          })
          .catch((ipErr) => console.error('Failed to fetch IP address:', ipErr));
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
      localStorage.setItem('diffdock_ligand_id', diffDockLigandId.trim() || searchCode.trim());
      localStorage.setItem('diffdock_timestamp', new Date().toISOString());
      
      // Extract and store protein and ligand data for Molstar3D
      if (diffDockResult.protein) {
        localStorage.setItem('diffdock_protein', diffDockResult.protein);
      }
      if (diffDockResult.ligand) {
        localStorage.setItem('diffdock_ligand', diffDockResult.ligand);
      }
      // Keep the submitted ligand as a preview fallback because DiffDock pose SDFs
      // generally contain coordinates but no SMILES property.
      localStorage.setItem('diffdock_ligand_input', diffDockLigandId.trim() || searchCode.trim());
      const firstPose = Array.isArray(diffDockResult.ligand_positions)
        ? diffDockResult.ligand_positions.find((pose) => typeof pose === 'string' && pose.trim())
        : null;
      if (firstPose) {
        localStorage.setItem('diffdock_ligand_position', firstPose);
      }
      // Name the Molstar tree entry after the receptor. Without this the iframe falls
      // back to a blob URL / host label (e.g. app.pyxis…) instead of 44HP.
      const pdbLabel = String(diffDockPdbId || '').trim().toUpperCase();
      if (pdbLabel) {
        localStorage.setItem('molstar_pdb_name', `PDB ${pdbLabel} · DiffDock`);
      }
      // DiffDock owns this view; drop AutoDock share-link sticky codes so a prior
      // ?pdb=1cx7 cannot outrank the receptor that was just docked.
      localStorage.removeItem('molstar_pdb_code');
      localStorage.removeItem('molstar_display_pdb_id');
      localStorage.removeItem('molstar_pdb_url');
      localStorage.removeItem('molstar_sdf_url');
      localStorage.removeItem('molstar_simulation_key');
      if (diffDockResult.position_confidence && diffDockResult.position_confidence.length > 0) {
        // Index 0, to match the pose stored above. DiffDock returns both arrays ranked
        // best-first and index-aligned: in every captured production response
        // (deploy/box/diffdock/reference/) position_confidence is strictly descending —
        // a 100-pose run ran -0.10 down to -4.89. Reading the LAST element, as this did,
        // labelled the best pose with the worst pose's confidence.
        const confidenceScore = diffDockResult.position_confidence[0];
        if (confidenceScore !== null && confidenceScore !== undefined) {
          localStorage.setItem('diffdock_confidence_score', confidenceScore.toString());
        }
      }
      
      // Query + one-shot flag + TTL stamp (~5 min bare-nav restore).
      // Do not pass ?pdb= here: that path is the RCSB/share-link loader and would
      // overwrite DiffDock's in-memory receptor handoff.
      markViewerHandoff();
      navigate('/dashboard/molstar3d?diffdock=1');
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
            loadMoreSearchResults();
          } else {
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
    if (!molecule || !price) return;
    const priceNum = typeof price === 'number' ? price : Number(price) || 0;
    const cartItem = {
      name: molecule.BRUTTO_FORMULA || molecule.formula || molecule.SMILES_STRING || molecule.smiles || molecule.ASINEX_ID || 'Molecule',
      amount,
      price: priceNum,
      pricePerMg: priceNum, // for compatibility with dashboard-navbar
      totalPrice: priceNum, // Do not multiply by amount - just use the price as is
      id: molecule.ASINEX_ID || molecule.id || Math.random().toString(36).slice(2),
      catalogId: molecule.BAS_CODE || molecule.bas_code || molecule.basCode || molecule.ASINEX_ID || molecule.id_number || molecule.id,
      smiles: molecule.SMILES_STRING || molecule.smiles || '',
      formula: molecule.BRUTTO_FORMULA || molecule.formula || '',
    };
    const updatedCart = [...cart, cartItem];
    setCart(updatedCart);
    saveCartToStorage(updatedCart);
    showMessage(`Added ${amount} mg of ${cartItem.name} to cart`);
  };

  // Hover preview functions
  const handleMouseEnter = (smiles, event, type) => {
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
    // Try different possible field names for SMILES
    const possibleFields = [
      'SMILES_STRING', 'SMILES', 'smiles', 'canonical_smiles', 
      'Canonical_SMILES', 'smi', 'structure', 'mol_smiles'
    ];
    
    for (const field of possibleFields) {
      if (mol[field] && typeof mol[field] === 'string' && mol[field].trim() !== '') {
        const smiles = mol[field].trim();
        // Basic SMILES validation - should contain typical SMILES characters
        if (smiles.length > 1 && /[A-Za-z0-9[\]()@=#+\-\\/\\\\]/.test(smiles)) {
          return smiles;
        }
      }
    }
    
    return null;
  };

  // Helper function to format numeric values to 4 decimal places
  const formatNumericValue = (value) => {
    if (value === null || value === undefined || value === "N/A" || value === "") {
      return "N/A";
    }
    
    const numValue = parseFloat(value);
    if (Number.isNaN(numValue)) {
      return "N/A";
    }
    
    // Format to 4 decimal places and remove trailing zeros
    return parseFloat(numValue.toFixed(6)).toString();
  };

  // Helper function to convert and format price with currency
  const formatPriceWithCurrency = (priceUSD) => {
    if (!priceUSD || priceUSD === "N/A") return "N/A";
    
    const numPrice = parseFloat(priceUSD);
    if (Number.isNaN(numPrice)) return "N/A";
    
    const convertedPrice = numPrice * exchangeRate;
    return formatPrice(convertedPrice, currency);
  };

  const moleculeSelectionId = (molecule, index) => molecule.ASINEX_ID || molecule.id || `molecule-${index}`;

  // Handle checkbox selection
  const handleCheckboxChange = (molecule, index, isChecked) => {
    const moleculeId = moleculeSelectionId(molecule, index);
    
    setSelectedMolecules(prev => {
      const newSelected = new Set(prev);
      if (isChecked) {
        newSelected.add(moleculeId);
      } else {
        newSelected.delete(moleculeId);
      }
      
      // Update search box with concatenated SMILES for all selected molecules
      const selectedSmiles = [];
      topMolecules.forEach((mol, molIndex) => {
        const id = moleculeSelectionId(mol, molIndex);
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
      
      topMolecules.forEach((mol, index) => {
        const moleculeId = moleculeSelectionId(mol, index);
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
    const selectedCount = topMolecules.filter((mol, index) => {
      const moleculeId = moleculeSelectionId(mol, index);
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

  // /api/sanitized* require a bearer token. A same-origin <a href> cannot send
  // Authorization, so these used to open a 401 JSON tab after a successful dock.
  const RESULT_DOWNLOAD_TIMEOUT_MS = 15_000;
  const downloadAuthedSimulationFile = async (kind) => {
    if (!simResult?.simulationKey || resultDownloadKind) return;
    const endpoint = kind === 'pdb'
      ? `/sanitizedpdb/${simResult.simulationKey}`
      : `/sanitizedminimalsdf/${simResult.simulationKey}`;
    const filename = kind === 'pdb'
      ? `${simResult.simulationKey}.pdb`
      : `${simResult.simulationKey}.sdf`;
    resultDownloadControllerRef.current?.abort();
    const controller = new AbortController();
    resultDownloadControllerRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, RESULT_DOWNLOAD_TIMEOUT_MS);
    setResultDownloadKind(kind);
    try {
      const token = getAuthToken();
      const response = await fetch(API_CONFIG.buildApiUrl(endpoint), {
        signal: controller.signal,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!response.ok) {
        throw new Error(`Could not download ${kind.toUpperCase()} (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      if (err.name === 'AbortError') {
        if (timedOut) showMessage('Download timed out. Try again.', 'error');
        return;
      }
      showMessage(err.message || 'Download failed', 'error');
    } finally {
      window.clearTimeout(timeoutId);
      if (resultDownloadControllerRef.current === controller) {
        resultDownloadControllerRef.current = null;
        setResultDownloadKind('');
      }
    }
  };

  const handleCopySmiles = async () => {
    if (ketcherIframeRef.current) {
      try {
        const ketcher = ketcherIframeRef.current.contentWindow.ketcher;
        if (ketcher) {
          const smiles = await ketcher.getSmiles();
          if (smiles) {
            await copyToClipboard(smiles);
            setSearchCode(smiles); // Also update the search box
            showClipboardConfirmation();
          } else {
            showMessage("Draw a molecule before copying its SMILES.", "error");
          }
        } else {
          showMessage("The molecule editor is still loading. Please try again.", "error");
        }
      } catch (err) {
        console.error("Failed to get SMILES from Ketcher:", err);
        showMessage("SMILES could not be copied. Make sure a molecule is drawn.", "error");
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col pt-4 pb-4 bg-gray-50 w-full px-2 sm:px-4">
      {message && (
        <div className="fixed right-4 top-20 z-[70] w-[min(28rem,calc(100vw-2rem))]" role="status" aria-live="polite">
          <Alert
            color={messageType === "error" ? "red" : "green"}
            dismissible
            onClose={() => setMessage('')}
          >
            {message}
          </Alert>
        </div>
      )}
      {/* Hover Preview Tooltip */}
      {hoveredPreview && (
        <div 
          className="fixed z-50 bg-white border-2 border-gray-300 rounded-lg p-3"
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
                // Retry the same structure with PubChem's simpler size parameter. Never
                // strip SMILES characters here: that can display a different molecule.
                if (!e.target.getAttribute('data-fallback-attempted')) {
                  e.target.setAttribute('data-fallback-attempted', '1');
                  e.target.src = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(hoveredPreview.smiles)}/PNG?image_size=small`;
                  return;
                }
                
                // Final fallback - show text message
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
          <div className="flex flex-col gap-3 mb-2 w-full p-4 bg-brand-50 rounded-lg border border-brand-200 molecular-weight-range">
            <Typography variant="small" color="blue-gray" className="font-semibold">
              Molecular Weight Range:
            </Typography>
            
            <div className="flex items-center gap-4 w-full">
              {/* Min value display */}
              <div className="flex items-center justify-center min-w-[80px] px-3 py-1 bg-brand-600 text-white rounded-lg font-bold text-lg">
                {parseFloat(molWeightMin).toFixed(2)}
              </div>
              
              {/* Dual range slider container */}
              <div className="flex-1 relative" style={{ minWidth: '200px' }}>
                {/* Background track */}
                <div className="absolute w-full h-2 bg-brand-200 rounded-lg" style={{ top: '50%', transform: 'translateY(-50%)' }}></div>
                
                {/* Active range highlight */}
                <div 
                  className="absolute h-2 bg-brand-600 rounded-lg"
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
              <div className="flex items-center justify-center min-w-[80px] px-3 py-1 bg-brand-600 text-white rounded-lg font-bold text-lg">
                {parseFloat(molWeightMax).toFixed(2)}
              </div>
            </div>
            
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
              onClick={handleSearch}
              disabled={searchLoading || !searchCode.trim() || selectedMolecules.size > 1}
              className="flex items-center gap-3 px-6 py-3 text-lg font-semibold whitespace-nowrap bg-brand-500 text-white focus:opacity-[0.85] active:opacity-[0.85]"
            >
              {searchLoading ? <Spinner className="h-5 w-5" /> : <CloudIcon className="h-5 w-5" />}
              {searchLoading ? 'Searching...' : 'Search'}
            </Button>
          </div>
   

          {/* Docking section */}
          <div className="w-full lg:w-1/2 flex flex-col gap-4 p-6 rounded-lg bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200 border border-blue-300 self-start">
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
                  {simLoading ? 'Simulating…' : 'Simulate'}
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
        <Card className="mb-6 !shadow-none" style={{ boxShadow: 'none' }} role="status" aria-live="polite">
          <CardBody className="text-center py-8">
            <div className="flex flex-col items-center gap-4">
              <Spinner className="h-8 w-8" color="blue" />
              <Typography variant="h6" color="blue-gray" className="mb-2">
                Docking in progress · {simElapsedSeconds}s elapsed
              </Typography>
              <Typography variant="small" color="gray" className="max-w-md">
                Docking can take a few minutes. Keep this tab open; the result viewer will open automatically when the stored artifacts are ready.
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
        <Card className="mb-6 !shadow-none" style={{ boxShadow: 'none' }}>
          <CardHeader
            variant="gradient"
            className="mb-4 grid h-12 place-items-center bg-transparent bg-gradient-to-tr from-brand-600 to-brand-400"
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
        <div id="editor" className="flex w-full flex-col gap-4 lg:flex-row">
          {/* Ketcher Editor - responsive primary pane */}
          <div className="min-w-0 flex-1 rounded-2xl border-2 border-blue-gray-200 bg-blue-gray-50 p-1.5 transition-colors focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-950 dark:focus-within:border-brand-500">
            <div className="overflow-hidden rounded-xl border border-blue-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <iframe
                ref={ketcherIframeRef}
                src="/ketcher/index.html"
                title="Ketcher 2D Chemical Editor"
                className="h-[clamp(28rem,63vh,42rem)] w-full border-0 bg-white dark:bg-slate-900"
                allowFullScreen
              />
            </div>
          </div>
          
          {/* Controls Panel - Half width */}
          <div id="controls-panel" className="flex min-w-0 w-full flex-col gap-4 rounded-lg bg-white p-4 dark:bg-slate-900 lg:w-1/2">
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
                onClick={handleSearch}
                disabled={searchLoading || !searchCode || selectedMolecules.size > 1}
                className="flex items-center justify-center gap-3 w-full bg-brand-500 text-white focus:opacity-[0.85] active:opacity-[0.85]"
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
                    {simLoading ? 'Simulating…' : 'Simulate'}
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
                    const nextPageSize = Number(e.target.value);
                    pageSizeRef.current = nextPageSize;
                    fetchAllMolecules(0, false, nextPageSize);
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
        <div id="results" className="w-full bg-slate-100 dark:bg-slate-900">
          {/* Header as a block element, not wrapping Card or div */}
          {/* <div className="mb-4">
            <Typography as="h5" variant="h5" color="blue-gray">Top {topMolecules.length} Molecules</Typography>
          </div> */}
          {(initialLoading || (topLoading && topMolecules.length === 0)) && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-4 py-3" role="status" aria-live="polite">
              <Spinner className="h-5 w-5 text-blue-500" />
              <Typography color="blue-gray">Loading catalog molecules...</Typography>
            </div>
          )}
          {topError && (
            <Alert color="red" className="mb-4">{topError}</Alert>
          )}
          {!initialLoading && !topError && topMolecules.length > 0 && (
            <Card className="mb-4 max-h-[min(70vh,44rem)] overflow-auto">
              <CardBody className="p-0">
                <table className="w-full text-left">
                  <thead className="sticky top-0 z-10 bg-white">
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
                            onChange={(e) => handleCheckboxChange(mol, idx, e.target.checked)}
                              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                            />
                          </td>
                          <td className="p-2">{idx + 1}</td>
                          {searchType === "similarity" && (
                            <td className="p-2 font-bold text-blue-600" title={mol.SIMILARITY ? `Similarity: ${mol.SIMILARITY}` : "N/A"}>
                              {mol.SIMILARITY !== null && mol.SIMILARITY !== undefined ? parseFloat(mol.SIMILARITY).toFixed(3) : "N/A"}
                            </td>
                          )}
                        <td className="p-0">
                          <button
                            type="button"
                            className="w-full p-2 text-left hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800"
                            title={mol.ASINEX_ID ? String(mol.ASINEX_ID).replace(/^ASN/i, "") : "N/A"}
                            onClick={() => setSearchCode(mol.ASINEX_ID ? String(mol.ASINEX_ID).replace(/^ASN/i, "") : "")}
                            onMouseEnter={(e) => handleMouseEnter(extractSmiles(mol), e, "mcule ID")}
                            onMouseLeave={handleMouseLeave}
                            onFocus={(e) => handleMouseEnter(extractSmiles(mol), e, "mcule ID")}
                            onBlur={handleMouseLeave}
                          >
                            {(mol.ASINEX_ID ? String(mol.ASINEX_ID).replace(/^ASN/i, "") : "N/A").toString().slice(0,moleculeLimit)}{(mol.ASINEX_ID ? String(mol.ASINEX_ID).replace(/^ASN/i, "") : "N/A").toString().length > moleculeLimit ? '...' : ''}
                          </button>
                        </td>
                        <td className="p-0">
                          <button
                            type="button"
                            className="w-full p-2 text-left hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800"
                            title={mol.IUPAC_NAME || "N/A"}
                            onClick={() => setSearchCode(mol.IUPAC_NAME || "")}
                            onMouseEnter={(e) => handleMouseEnter(extractSmiles(mol), e, "IUPAC Name")}
                            onMouseLeave={handleMouseLeave}
                            onFocus={(e) => handleMouseEnter(extractSmiles(mol), e, "IUPAC Name")}
                            onBlur={handleMouseLeave}
                          >
                            {(mol.IUPAC_NAME || "N/A").toString().slice(0,moleculeLimit)}{(mol.IUPAC_NAME || "N/A").toString().length > moleculeLimit ? '...' : ''}
                          </button>
                        </td>
                        <td className="p-0 font-mono text-xs">
                          <button
                            type="button"
                            className="w-full p-2 text-left hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800"
                            title={mol.SMILES_STRING || mol.SMILES || mol.smiles || "N/A"}
                            onClick={async () => {
                              const smiles = mol.SMILES_STRING || mol.SMILES || mol.smiles || "";
                              setSearchCode(smiles);
                              if (!smiles) return;
                              try {
                                await copyToClipboard(smiles);
                                showClipboardConfirmation();
                              } catch (err) {
                                console.error("Failed to copy SMILES:", err);
                                showMessage("SMILES could not be copied.", "error");
                              }
                            }}
                            onMouseEnter={(e) => handleMouseEnter(extractSmiles(mol), e, "SMILES")}
                            onMouseLeave={handleMouseLeave}
                            onFocus={(e) => handleMouseEnter(extractSmiles(mol), e, "SMILES")}
                            onBlur={handleMouseLeave}
                          >
                            {(mol.SMILES_STRING || mol.SMILES || mol.smiles || "N/A").toString().slice(0,moleculeLimit)}{(mol.SMILES_STRING || mol.SMILES || mol.smiles || "N/A").toString().length > moleculeLimit ? '...' : ''}
                          </button>
                        </td>
                        <td className="p-0 font-mono text-xs">
                          <button
                            type="button"
                            className="w-full p-2 text-left hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800"
                            title={mol.INCHI || "N/A"}
                            onClick={async () => {
                              const inchi = mol.INCHI || "";
                              setSearchCode(inchi);
                              if (!inchi || inchi === "N/A") return;
                              try {
                                await copyToClipboard(inchi);
                                showClipboardConfirmation();
                              } catch (err) {
                                console.error("Failed to copy InChI:", err);
                                showMessage("InChI could not be copied.", "error");
                              }
                            }}
                            onMouseEnter={(e) => handleMouseEnter(extractSmiles(mol), e, "InChI")}
                            onMouseLeave={handleMouseLeave}
                            onFocus={(e) => handleMouseEnter(extractSmiles(mol), e, "InChI")}
                            onBlur={handleMouseLeave}
                          >
                            {(mol.INCHI || "N/A").toString().slice(0,moleculeLimit)}{(mol.INCHI || "N/A").toString().length > moleculeLimit ? '...' : ''}
                          </button>
                        </td>
                        <td className="p-0 font-mono text-xs">
                          <button
                            type="button"
                            className="w-full p-2 text-left hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800"
                            title={mol.INCHIKEY || "N/A"}
                            onClick={() => setSearchCode(mol.INCHIKEY || "")}
                            onMouseEnter={(e) => handleMouseEnter(extractSmiles(mol), e, "InChIKey")}
                            onMouseLeave={handleMouseLeave}
                            onFocus={(e) => handleMouseEnter(extractSmiles(mol), e, "InChIKey")}
                            onBlur={handleMouseLeave}
                          >
                            {(mol.INCHIKEY || "N/A").toString().slice(0,moleculeLimit)}{(mol.INCHIKEY || "N/A").toString().length > moleculeLimit ? '...' : ''}
                          </button>
                        </td>
                        <td className="p-2" title={mol.BRUTTO_FORMULA || "N/A"}>{(mol.BRUTTO_FORMULA || "N/A").toString().slice(0,moleculeLimit)}{(mol.BRUTTO_FORMULA || "N/A").toString().length > moleculeLimit ? '...' : ''}</td>
                        <td className="p-2" title={formatNumericValue(mol.MW_STRUCTURE)}>{formatNumericValue(mol.MW_STRUCTURE).toString().slice(0,moleculeLimit)}{formatNumericValue(mol.MW_STRUCTURE).toString().length > moleculeLimit ? '...' : ''}</td>
                        <td className="p-2" title={formatNumericValue(mol.AVAILABLE_MG)}>{formatNumericValue(mol.AVAILABLE_MG).toString().slice(0,moleculeLimit)}{formatNumericValue(mol.AVAILABLE_MG).toString().length > moleculeLimit ? '...' : ''}</td>
                        <td className="p-0" title={mol.PRICE_1MG ? formatPriceWithCurrency(mol.PRICE_1MG) : "-"}>
                          <button type="button" disabled={!mol.PRICE_1MG} className="group w-full p-2 text-left hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-default dark:hover:bg-slate-800" onClick={() => addToCart(mol, 1, mol.PRICE_1MG)} aria-label={mol.PRICE_1MG ? `Add 1 mg to cart for ${formatPriceWithCurrency(mol.PRICE_1MG)}` : "1 mg unavailable"}>
                            <span>{(mol.PRICE_1MG ? formatPriceWithCurrency(mol.PRICE_1MG) : "-").toString().slice(0,moleculeLimit)}{(mol.PRICE_1MG ? formatPriceWithCurrency(mol.PRICE_1MG) : "-").toString().length > moleculeLimit ? '...' : ''}</span>
                            {mol.PRICE_1MG && <ShoppingCartIcon className="ml-2 inline-block h-5 w-5 text-brand-600 opacity-70 group-hover:opacity-100" aria-hidden="true" />}
                          </button>
                        </td>
                        <td className="p-0" title={mol.PRICE_5MG ? formatPriceWithCurrency(mol.PRICE_5MG) : "-"}>
                          <button type="button" disabled={!mol.PRICE_5MG} className="group w-full p-2 text-left hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-default dark:hover:bg-slate-800" onClick={() => addToCart(mol, 5, mol.PRICE_5MG)} aria-label={mol.PRICE_5MG ? `Add 5 mg to cart for ${formatPriceWithCurrency(mol.PRICE_5MG)}` : "5 mg unavailable"}>
                            <span>{(mol.PRICE_5MG ? formatPriceWithCurrency(mol.PRICE_5MG) : "-").toString().slice(0,moleculeLimit)}{(mol.PRICE_5MG ? formatPriceWithCurrency(mol.PRICE_5MG) : "-").toString().length > moleculeLimit ? '...' : ''}</span>
                            {mol.PRICE_5MG && <ShoppingCartIcon className="ml-2 inline-block h-5 w-5 text-brand-600 opacity-70 group-hover:opacity-100" aria-hidden="true" />}
                          </button>
                        </td>
                        <td className="p-0" title={mol.PRICE_10MG ? formatPriceWithCurrency(mol.PRICE_10MG) : "-"}>
                          <button type="button" disabled={!mol.PRICE_10MG} className="group w-full p-2 text-left hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-default dark:hover:bg-slate-800" onClick={() => addToCart(mol, 10, mol.PRICE_10MG)} aria-label={mol.PRICE_10MG ? `Add 10 mg to cart for ${formatPriceWithCurrency(mol.PRICE_10MG)}` : "10 mg unavailable"}>
                            <span>{(mol.PRICE_10MG ? formatPriceWithCurrency(mol.PRICE_10MG) : "-").toString().slice(0,moleculeLimit)}{(mol.PRICE_10MG ? formatPriceWithCurrency(mol.PRICE_10MG) : "-").toString().length > moleculeLimit ? '...' : ''}</span>
                            {mol.PRICE_10MG && <ShoppingCartIcon className="ml-2 inline-block h-5 w-5 text-brand-600 opacity-70 group-hover:opacity-100" aria-hidden="true" />}
                          </button>
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
          {(!isSearchActive ? catalogSettled : !searchLoading) && !initialLoading && !topLoading && !topError && !searchError && topMolecules.length === 0 && (
            <div className="text-center py-8" role="status" aria-live="polite">
              <Typography variant="small" color="gray">
                {queryType === "text"
                  ? isSearchActive
                    ? "No molecules matched this search. Try another query or adjust the search options."
                    : "Enter a molecule identifier or structure above, then select Search."
                  : "No catalog molecules are available right now."}
              </Typography>
            </div>
          )}
        </div>
      {showClipboardPopup && (
        <Alert color="green" className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 w-fit px-6 py-3 text-center">
          Ctrl+V into Draw molecule
        </Alert>
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
        <Card className="mb-6 !shadow-none" style={{ boxShadow: 'none' }}>
          <CardHeader
            variant="gradient"
            className="mb-4 grid h-12 place-items-center"
          >
            <Typography variant="h6" color="black" className="dark:text-slate-50">
              Simulation Result
            </Typography>
          </CardHeader>
          <CardBody>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border bg-white p-4 font-mono text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              {JSON.stringify(simResult, null, 2)}
            </pre>
            {simResult.simulationKey && (
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={Boolean(resultDownloadKind)}
                  className="inline-block rounded border border-blue-500 px-4 py-2 text-blue-500 transition hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-slate-800"
                  onClick={() => downloadAuthedSimulationFile('pdb')}
                >
                  {resultDownloadKind === 'pdb' ? 'Downloading PDB…' : 'Download Sanitized PDB'}
                </button>
                <button
                  type="button"
                  disabled={Boolean(resultDownloadKind)}
                  className="inline-block rounded border border-brand-500 px-4 py-2 text-brand-500 transition hover:bg-brand-50 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-slate-800"
                  onClick={() => downloadAuthedSimulationFile('sdf')}
                >
                  {resultDownloadKind === 'sdf' ? 'Downloading SDF…' : 'Download Sanitized SDF'}
                </button>
              </div>
            )}
          </CardBody>
        </Card>
      )}
      {diffDockLoading && (
        <Card className="mb-6 !shadow-none" style={{ boxShadow: 'none' }}>
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
        <Card className="mb-6 !shadow-none" style={{ boxShadow: 'none' }}>
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
