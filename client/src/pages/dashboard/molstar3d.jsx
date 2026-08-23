import { Button, Card, CardBody, CardHeader, Chip, Typography } from "@material-tailwind/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_CONFIG, getAuthToken } from "@/utils/constants";
import {
  clearViewerStorage,
  clearViewerHandoffFlag,
  normalizePdbId,
  peekViewerLoadIntent,
  rcsbPdbDownloadUrl,
  readDisplayPdbId,
  stampViewerResultSaved,
} from "@/utils/viewerStorage";

// The /api/sanitized* endpoints require a bearer token. Every same-origin 401 is
// treated by the global interceptor as a dead session, so a bare fetch() here did
// not merely fail to render — it signed the user out the moment this page opened.
// Keep every call to our own API going through this.
const authedFetch = (url, init = {}) => {
  const token = getAuthToken();
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
};

// Upstream DiffDock responses can contain either literal escaped newlines or a
// backslash immediately before each newline. Normalize both forms before handing
// structure text to Molstar or the SDF parser.
const normalizeStructureText = (text = '') => String(text)
  .replace(/\\\r?\n/g, '\n')
  .replace(/\\n/g, '\n')
  .replace(/\r\n/g, '\n');

const decodeStructureIdentifier = (value) => {
  try {
    return decodeURIComponent(String(value).trim());
  } catch {
    return String(value).trim();
  }
};

/** DiffDock confidence is higher-is-better (typically about -2 to +1). */
function diffDockConfidenceChip(score) {
  if (score >= 0) return { value: 'High Confidence', color: 'green' };
  if (score >= -1.5) return { value: 'Medium Confidence', color: 'amber' };
  return { value: 'Low Confidence', color: 'red' };
}

// DiffDock may return an SDF without SMILES properties. Keep catalog IDs from
// being sent to PubChem's SMILES endpoint, while still accepting short valid
// strings such as CCO. This deliberately allows only valid atom/syntax tokens;
// catalog IDs such as BAS123 contain an invalid bare `A` token and are rejected.
const isLikelySmiles = (value) => {
  const identifier = decodeStructureIdentifier(value);
  if (!identifier || identifier === 'N/A' || /\s/.test(identifier)) return false;
  return /^(?:(?:Cl|Br|[BCNOFPSIbcnsop])|\d|[()=#$@+\-./%\\\\]|\[[^\]]+\])+$/.test(identifier);
};

// The docking service returns structures, not raster thumbnails. Use PubChem for
// both SMILES and ligand identifiers (CCD/compound names), since DiffDock's pose
// SDF often has no SMILES property of its own.
const structureImageUrl = (value) => {
  const identifier = decodeStructureIdentifier(value);
  if (!identifier || identifier === 'N/A') return null;
  const encoded = encodeURIComponent(identifier);
  return isLikelySmiles(identifier)
    ? `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encoded}/PNG?record_type=2d&image_size=200x150`
    : `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encoded}/PNG?record_type=2d&image_size=200x150`;
};

export function Molstar3D() {
  const molstarRef = useRef(null);
  const navigate = useNavigate();
  // Results load from an explicit handoff (?simulation= / ?pdb= / ?diffdock= or
  // one-shot sessionStorage flag) or a localStorage bundle still within the
  // ~5 minute TTL. Bare visits after TTL stay idle.
  const shouldAutoLoad = peekViewerLoadIntent();
  const [sdfData, setSdfData] = useState([]);
  // A historical/direct result already has enough information to begin loading on
  // the first render. Starting false briefly showed the actively-wrong empty state
  // while the iframe and authenticated files were still starting up.
  const [isLoading, setIsLoading] = useState(shouldAutoLoad);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState(''); // 'success', 'error', or ''
  const [moleculePrices, setMoleculePrices] = useState({}); // Store prices by SMILES
  // Outcome of the last SDF load. 'empty' means the request succeeded but no pose
  // survived parsing — the failure mode that used to render as a blank panel.
  const [sdfStatus, setSdfStatus] = useState(shouldAutoLoad ? 'loading' : 'idle'); // 'idle' | 'loading' | 'ok' | 'empty' | 'error'
  // Post-TTL bare visits hide result chrome until a fresh handoff, Reload, or
  // Test SDF presents a workspace. Within TTL, chrome follows shouldAutoLoad.
  const [resultChromeVisible, setResultChromeVisible] = useState(shouldAutoLoad);
  const [cart, setCart] = useState([]); // Shopping cart state
  const viewerClearedRef = useRef(false);
  const viewerReadyRef = useRef(false);
  const pendingTestSdfRef = useRef(null);
  const resultRequestControllerRef = useRef(null);
  const resultRequestEpochRef = useRef(0);
  const testRequestControllerRef = useRef(null);
  const sdfDerivationEpochRef = useRef(0);
  const messageTimerRef = useRef(null);
  const iframeOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const shouldAutoLoadRef = useRef(shouldAutoLoad);

  const postToViewer = useCallback((message) => {
    molstarRef.current?.contentWindow?.postMessage(message, iframeOrigin);
  }, [iframeOrigin]);

  const showMessage = useCallback((text, type, durationMs = 0) => {
    if (messageTimerRef.current) {
      window.clearTimeout(messageTimerRef.current);
      messageTimerRef.current = null;
    }
    setMessage(text);
    setMessageType(type);
    if (durationMs > 0) {
      messageTimerRef.current = window.setTimeout(() => {
        setMessage('');
        setMessageType('');
        messageTimerRef.current = null;
      }, durationMs);
    }
  }, []);

  // Function to parse SDF data
  const parseSdfData = (sdfText, fallbackSmiles = '') => {
    const molecules = normalizeStructureText(sdfText).split('$$$$').filter(entry => entry.trim());

    return molecules.map((molecule, index) => {
      const lines = molecule.split('\n');
      const properties = {};
      let currentProperty = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('>') && line.includes('<') && line.includes('>')) {
          const match = line.match(/<([^>]+)>/);
          if (match) currentProperty = match[1].trim().toLowerCase();
        } else if (currentProperty && line && !line.startsWith('>')) {
          properties[currentProperty] = line;
          currentProperty = null;
        }
      }

      const usableFallbackSmiles = isLikelySmiles(fallbackSmiles) ? decodeStructureIdentifier(fallbackSmiles) : '';
      const smiles = properties.smiles
        || properties.smiles_string
        || properties.original_smiles
        || usableFallbackSmiles
        || 'N/A';
      const ligandId = properties.ligand_id || properties.ligandid || 'N/A';
      const moleculeName = properties.iupac_name
        || properties.name
        || (ligandId !== 'N/A' ? `Ligand ${ligandId}` : '')
        || (fallbackSmiles ? `Ligand ${fallbackSmiles}` : `Ligand ${index + 1}`);

      return {
        id: index + 1,
        name: moleculeName,
        model: properties.model || 'N/A',
        torsdo: properties.torsdo || properties.torsdof || 'N/A',
        score: properties.score || 'N/A',
        ligand_id: ligandId,
        original_smiles: properties.original_smiles || usableFallbackSmiles || 'N/A',
        smiles,
        title: lines[0]?.trim() || ''
      };
    });
  };

  // Function to load SDF data from URL
  // Parse SDF text into the pose table and kick off the price lookups.
  //
  // Split out from loadSdfData so a caller that has already fetched the SDF can reuse the
  // text instead of fetching the same URL a second time.
  const deriveSmilesFromSdf = async (sdfText) => {
    try {
      const load = window.loadRDKit || window.initRDKitModule;
      if (typeof load !== 'function') return '';
      const rdkit = await load();
      // RDKit's get_mol expects one mol block, while DiffDock can return many
      // pose records. The first non-empty record is enough to derive the shared
      // ligand identity used by previews and price lookups.
      const firstRecord = normalizeStructureText(sdfText)
        .split('$$$$')
        .find((record) => record.trim())
        || '';
      const mol = rdkit?.get_mol(firstRecord);
      if (!mol || mol.is_valid?.() === 0) {
        mol?.delete?.();
        return '';
      }
      const smiles = mol.get_smiles?.() || '';
      mol.delete?.();
      return smiles;
    } catch (error) {
      console.warn('Could not derive a SMILES preview from the returned SDF:', error);
      return '';
    }
  };

  const applySdfText = (sdfText, fallbackSmiles = '') => {
    const derivationEpoch = ++sdfDerivationEpochRef.current;
    const parsedData = parseSdfData(sdfText, fallbackSmiles);
    setSdfData(parsedData);
    setSdfStatus(parsedData.length > 0 ? 'ok' : 'empty');

    const missingSmiles = parsedData.some((molecule) => molecule.smiles === 'N/A');
    if (missingSmiles && sdfText) {
      // DiffDock's returned pose SDF commonly has no SMILES field. Derive one from
      // the actual returned molecule so previews work even when the user entered a
      // CCD/catalog ID that PubChem cannot resolve as a compound name.
      deriveSmilesFromSdf(sdfText).then((derivedSmiles) => {
        if (!derivedSmiles
          || viewerClearedRef.current
          || derivationEpoch !== sdfDerivationEpochRef.current) return;
        setSdfData((current) => current.map((molecule) => (
          molecule.smiles === 'N/A'
            ? { ...molecule, smiles: derivedSmiles, original_smiles: derivedSmiles }
            : molecule
        )));
        fetchAllMoleculePrices(parsedData.map((molecule) => (
          molecule.smiles === 'N/A'
            ? { ...molecule, smiles: derivedSmiles, original_smiles: derivedSmiles }
            : molecule
        )));
      });
      return;
    }

    // Fetch prices for all molecules
    fetchAllMoleculePrices(parsedData);
  };

  const loadSdfData = async (url, signal, requestEpoch) => {
    try {
      setIsLoading(true);
      const response = await authedFetch(url, { signal });
      if (viewerClearedRef.current || requestEpoch !== resultRequestEpochRef.current) return;
      if (response.ok) {
        const sdfText = await response.text();
        if (viewerClearedRef.current || requestEpoch !== resultRequestEpochRef.current) return;
        applySdfText(sdfText);
      } else if (requestEpoch === resultRequestEpochRef.current && !viewerClearedRef.current) {
        setSdfData([]);
        setSdfStatus('error');
        console.error('Failed to load SDF data:', response.status);
      }
    } catch (error) {
      if (error.name !== 'AbortError' && requestEpoch === resultRequestEpochRef.current && !viewerClearedRef.current) {
        setSdfData([]);
        setSdfStatus('error');
        console.error('Error loading SDF data:', error);
      }
    } finally {
      if (requestEpoch === resultRequestEpochRef.current && !viewerClearedRef.current) {
        setIsLoading(false);
      }
    }
  };

  // Function to fetch molecule price from API
  const fetchMoleculePrice = async (smiles) => {
    try {
      const encodedSmiles = encodeURIComponent(smiles);
      const response = await fetch(API_CONFIG.buildApiUrl(`/mol-price/search?smiles=${encodedSmiles}&limit=20`), {
        method: 'GET',
        headers: {
          'accept': '*/*'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // Handle the actual API response structure
        if (Array.isArray(data) && data.length > 0) {
          const molecule = data[0];
          
          // Extract price information from the response
          const priceInfo = {
            id: molecule.ASINEX_ID || 'N/A',
            name: molecule.IUPAC_NAME || 'N/A',
            availableMg: molecule.AVAILABLE_MG || 0,
            price1mg: molecule.PRICE_1MG || 100,
            price2mg: molecule.PRICE_2MG || 100,
            price5mg: molecule.PRICE_5MG || 100,
            price10mg: molecule.PRICE_10MG || 100
          };
          
          return priceInfo;
        } else {
          // Return default pricing when not found
          return {
            id: 'Not Found',
            name: 'N/A',
            availableMg: 0,
            price1mg: 100,
            price2mg: 100,
            price5mg: 100,
            price10mg: 100
          };
        }
      } else {
        console.error('Failed to fetch price for SMILES:', smiles);
        return {
          id: 'API Error',
          name: 'N/A',
          availableMg: 0,
          price1mg: 100,
          price2mg: 100,
          price5mg: 100,
          price10mg: 100
        };
      }
    } catch (error) {
      console.error('Error fetching price for SMILES:', smiles, error);
      return {
        id: 'Network Error',
        name: 'N/A',
        availableMg: 0,
        price1mg: 100,
        price2mg: 100,
        price5mg: 100,
        price10mg: 100
      };
    }
  };

  // Price lookups are secondary metadata. Deduplicate them and keep only a few
  // requests in flight so a full docking result cannot create a request storm.
  const fetchAllMoleculePrices = async (molecules) => {
    const smilesList = [...new Set(
      molecules.map((molecule) => molecule.smiles).filter((smiles) => smiles && smiles !== 'N/A')
    )];
    const priceMap = {};
    const concurrency = 4;

    for (let i = 0; i < smilesList.length; i += concurrency) {
      if (viewerClearedRef.current) return;
      const batch = smilesList.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(async (smiles) => ({
        smiles,
        price: await fetchMoleculePrice(smiles),
      })));
      results.forEach(({ smiles, price }) => {
        priceMap[smiles] = price;
      });
    }

    if (viewerClearedRef.current) return;
    setMoleculePrices(priceMap);
    setSdfData((current) => current.map((molecule) => {
      const catalogName = priceMap[molecule.smiles]?.name;
      return catalogName && catalogName !== 'N/A'
        ? { ...molecule, name: catalogName }
        : molecule;
    }));
  };

  // Shopping cart functions
  const loadCartFromStorage = () => {
    try {
      const savedCart = localStorage.getItem('moleculeCart');
      if (savedCart) {
        const parsedCart = JSON.parse(savedCart);
        setCart(parsedCart);
        return parsedCart;
      }
    } catch (error) {
      console.error('Error loading cart from storage:', error);
    }
    return [];
  };

  const saveCartToStorage = (cartData) => {
    try {
      localStorage.setItem('moleculeCart', JSON.stringify(cartData));
    } catch (error) {
      console.error('Error saving cart to storage:', error);
    }
  };

  const removeFromCart = (itemId) => {
    const updatedCart = cart.filter(item => item.id !== itemId);
    setCart(updatedCart);
    saveCartToStorage(updatedCart);
  };

  const getCartTotal = () => {
    return cart.reduce((total, item) => total + item.totalPrice, 0).toFixed(2);
  };

  const getCartItemCount = () => {
    return cart.length;
  };

  // Clearing the viewer has to drop the stored simulation/pdb keys too, or the next
  // effect run reloads exactly what was just cleared. Declared above the loader effect
  // because the iframe's own Clear button reports back through it.
  const handleClearViewer = useCallback(({ announce = true } = {}) => {
    viewerClearedRef.current = true;
    resultRequestEpochRef.current += 1;
    resultRequestControllerRef.current?.abort();
    testRequestControllerRef.current?.abort();
    pendingTestSdfRef.current = null;
    clearViewerStorage();
    setSdfData([]);
    setSdfStatus('idle');
    setIsLoading(false);
    setResultChromeVisible(false);
    setMoleculePrices({});
    if (announce) showMessage('Docking result cleared', 'success', 3000);
    postToViewer({ type: 'clearStructure' });
    window.history.replaceState({}, document.title, window.location.pathname);
  }, [postToViewer, showMessage]);

  useEffect(() => {
    // Clear any localhost URLs from localStorage on component mount
    const clearLocalhostUrls = () => {
      const pdbUrl = localStorage.getItem('molstar_pdb_url');
      const sdfUrl = localStorage.getItem('molstar_sdf_url');
      
      if (pdbUrl && pdbUrl.includes('localhost')) {
        localStorage.removeItem('molstar_pdb_url');
      }
      
      if (sdfUrl && sdfUrl.includes('localhost')) {
        localStorage.removeItem('molstar_sdf_url');
      }
    };
    
    clearLocalhostUrls();
    viewerClearedRef.current = false;
    clearViewerHandoffFlag();
    
    // Check for simulation data from URL parameters.
    const urlParams = new URLSearchParams(window.location.search);
    const pdbParam = urlParams.get('pdb');
    const simulationParam = urlParams.get('simulation');
    if (urlParams.has('checkout') || urlParams.has('session_id')) {
      urlParams.delete('checkout');
      urlParams.delete('session_id');
      const remainingQuery = urlParams.toString();
      window.history.replaceState(
        {},
        document.title,
        `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}`,
      );
    }

    // Load cart from storage on component mount
    loadCartFromStorage();

    let viewerReady = false;
    let structuresLoaded = false;
    let loadStructuresWhenReady = () => {};

    // Listen for messages from Molstar iframe
    const handleMessage = (event) => {
      if (event.origin !== iframeOrigin || event.source !== molstarRef.current?.contentWindow) return;
      const messageType = event.data?.type;
      if (!messageType) return;

      if (messageType === 'viewerReady') {
        viewerReady = true;
        viewerReadyRef.current = true;
        if (pendingTestSdfRef.current) {
          postToViewer({ type: 'loadDockingResult', ...pendingTestSdfRef.current });
          pendingTestSdfRef.current = null;
        }
        loadStructuresWhenReady();
      } else if (messageType === 'resultLoadError') {
        showMessage('The result files loaded, but the 3D viewer could not render them', 'error');
      } else if (messageType === 'smilesLoaded') {
        showMessage(`Successfully loaded ${event.data.name || 'molecule'} into Molstar viewer`, 'success', 3000);
      } else if (messageType === 'smilesLoadError') {
        showMessage(`Failed to load molecule: ${event.data.error}`, 'error', 5000);
      } else if (messageType === 'viewerClearedByUser') {
        // The iframe already emptied the plugin and said so in its own status line.
        handleClearViewer({ announce: false });
      }
    };

    window.addEventListener('message', handleMessage);

    const handleIframeLoad = () => {
      // The iframe replies only after Molstar.Viewer.create() has resolved. This
      // request also covers the rare case where its initial ready event raced the
      // parent's effect registration.
      postToViewer({ type: 'requestViewerReady' });
    };

    if (molstarRef.current) {
      molstarRef.current.addEventListener('load', handleIframeLoad);
    }

    // Bare Simulation Results with no fresh TTL bundle: calm empty workspace.
    // Reload PDB / Test SDF / Clear still work below.
    if (!shouldAutoLoadRef.current) {
      setIsLoading(false);
      setSdfStatus('idle');
      const alreadyLoadedIdle = (() => {
        try {
          return molstarRef.current?.contentDocument?.readyState === 'complete';
        } catch {
          return false;
        }
      })();
      if (alreadyLoadedIdle) handleIframeLoad();
      return () => {
        if (molstarRef.current) {
          molstarRef.current.removeEventListener('load', handleIframeLoad);
        }
        viewerReadyRef.current = false;
        pendingTestSdfRef.current = null;
        window.removeEventListener('message', handleMessage);
        if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
      };
    }

    // Auto-load PDB file from RCSB if pdb parameter is present
    if (pdbParam) {
      // A public PDB share link is not a simulation result. Remove any previous
      // authenticated result bundle first, but preserve the PDB URL we are about
      // to set so the share link still renders normally.
      if (!simulationParam) {
        localStorage.removeItem('molstar_sdf_url');
        localStorage.removeItem('molstar_pdb_name');
        localStorage.removeItem('molstar_simulation_key');
        localStorage.removeItem('molstar_simulation_pairs');
      }
      // Display the public RCSB entry for both share links and simulation
      // results. Docking still strips waters/HETATM for the engine; showing
      // that prepared file made 1CX7 lose HED/waters and made 44HP look like
      // two bare dimers. Do not write molstar_pdb_code: that sticky override
      // caused the 1cx7 bug when a later run already had molstar_pdb_url.
      //
      // Name the tree/sequence entry after the PDB id (e.g. 44HP), never the
      // truncated simulation key. Control-panel Open uses ?pdb=&simulation= and
      // used to overwrite the handoff label with `Simulation result · 3arc4wi…`.
      const pdbLabel = normalizePdbId(pdbParam) || String(pdbParam).trim().toUpperCase();
      const pdbUrl = rcsbPdbDownloadUrl(pdbParam)
        || (simulationParam ? API_CONFIG.buildApiUrl(`/sanitizedpdb/${simulationParam}`) : '');
      if (pdbUrl) localStorage.setItem('molstar_pdb_url', pdbUrl);
      if (normalizePdbId(pdbParam)) {
        localStorage.setItem('molstar_display_pdb_id', normalizePdbId(pdbParam));
      }
      localStorage.setItem(
        'molstar_pdb_name',
        simulationParam
          ? `PDB ${pdbLabel} · Simulation result`
          : `PDB ${pdbLabel}`,
      );
      localStorage.removeItem('molstar_pdb_code');
      if (simulationParam) {
        localStorage.setItem('molstar_simulation_key', simulationParam);
        localStorage.setItem(
          'molstar_sdf_url',
          API_CONFIG.buildApiUrl(`/sanitizedminimalsdf/${simulationParam}`),
        );
        stampViewerResultSaved();
      }

    }

    // Only a complete current-result bundle is loadable. Partial/stale keys can
    // otherwise make a brand-new account see fetch errors before it has run
    // anything. Clear the incomplete bundle and render the normal empty state.
    let pdbUrl = localStorage.getItem('molstar_pdb_url');
    const sdfUrl = localStorage.getItem('molstar_sdf_url');
    let simulationKey = localStorage.getItem('molstar_simulation_key');
    let displayPdbId = readDisplayPdbId(window.location.search);
    // A share link can legitimately provide only a public PDB URL. Only clear an
    // incomplete authenticated simulation bundle; never treat a PDB-only share link
    // as a broken result.
    if (simulationKey && !pdbUrl && !displayPdbId) {
      clearViewerStorage();
      pdbUrl = null;
      simulationKey = null;
      displayPdbId = '';
      setIsLoading(false);
      setResultChromeVisible(false);
    }
    const pdbCode = localStorage.getItem('molstar_pdb_code');
    const diffdockProtein = localStorage.getItem('diffdock_protein');
    const diffdockLigandPosition = localStorage.getItem('diffdock_ligand_position');
    const diffdockLigandInput = localStorage.getItem('diffdock_ligand_input') || '';
    const diffdockPdbId = String(localStorage.getItem('diffdock_pdb_id') || '').trim();
    // DiffDock is not stored in the AutoDock simulation collection, so its pose
    // must also feed the same result table/preview path. Its position SDF is the
    // docked geometry; the submitted ligand is the fallback preview identifier.
    if (diffdockPdbId) {
      localStorage.setItem('molstar_pdb_name', `PDB ${diffdockPdbId.toUpperCase()} · DiffDock`);
    }
    if (diffdockLigandPosition) {
      applySdfText(diffdockLigandPosition, diffdockLigandInput);
    }
    const resultRequestController = new AbortController();
    const resultRequestEpoch = ++resultRequestEpochRef.current;
    resultRequestControllerRef.current = resultRequestController;

    // Only fall back to RCSB when this view has no PDB of its own.
    //
    // This used to read "if we have a PDB code, ALWAYS use RCSB", and that one word
    // was the bug. `molstar_pdb_code` is written only by the share-link path
    // (`?pdb=…`), and localStorage keeps it forever. Running a simulation writes a
    // fresh `molstar_pdb_url` but never clears the old code, so every later run was
    // silently re-pointed at whatever protein was last opened by link — in practice
    // 1cx7 — no matter which protein was actually docked.
    //
    // It also hid the ligand. A run's pose is in its own protein's coordinate frame,
    // so drawing it against an unrelated structure puts it far outside the box and
    // out of view. Same protein, and it lands in the binding site as it should.
    if (pdbCode && !pdbUrl && !displayPdbId) {
      const newPdbUrl = rcsbPdbDownloadUrl(pdbCode);
      if (newPdbUrl) {
        localStorage.setItem('molstar_pdb_url', newPdbUrl);
        localStorage.setItem('molstar_display_pdb_id', normalizePdbId(pdbCode));
        pdbUrl = newPdbUrl;
        displayPdbId = normalizePdbId(pdbCode);
      }
    }

    const protectedPdb = Boolean(pdbUrl?.includes('/api/sanitized'));
    const pdbTextPromise = (!displayPdbId && protectedPdb)
      ? authedFetch(pdbUrl, { signal: resultRequestController.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const text = await response.text();
          if (!text.trim()) throw new Error('Empty PDB response');
          return text;
        })
        .catch((error) => {
          if (error.name === 'AbortError' || viewerClearedRef.current || resultRequestEpoch !== resultRequestEpochRef.current) return null;
          console.error('Could not fetch this run\'s protein:', error);
          showMessage('Could not load the protein for this result', 'error');
          return null;
        })
      : Promise.resolve(null);

    // The default 3D scene starts with the receptor. The reduced SDF is loaded into
    // the result table below; selecting a SMILES then fetches its matching pose and
    // sends receptor + pose to Molstar in one ordered command.
    const pdbLoadPromise = pdbTextPromise.finally(() => {
      if (!viewerClearedRef.current && resultRequestEpoch === resultRequestEpochRef.current) {
        setIsLoading(false);
      }
    });

    // Restore the legacy simulation-results behavior: /sanitizedminimalsdf supplies
    // the clickable SMILES rows. Fetch it in the parent so the protected endpoint
    // receives the bearer token; the iframe cannot authenticate this request itself.
    if (sdfUrl) {
      loadSdfData(sdfUrl, resultRequestController.signal, resultRequestEpoch);
    }

    
    // Load cart from storage
    const _savedCart = loadCartFromStorage();

    const loadDiffDockStructures = () => {
      if (resultRequestEpoch !== resultRequestEpochRef.current || viewerClearedRef.current || !molstarRef.current) return;
      // DiffDock echoes the protein with a literal backslash before each newline.
      // Send normalized text rather than a blob URL containing those escape bytes;
      // otherwise Molstar sees one malformed line and the ligand sits in an empty scene.
      const ligandLabel = diffdockLigandInput
        ? `Ligand ${diffdockLigandInput.length > 48 ? `${diffdockLigandInput.slice(0, 45)}…` : diffdockLigandInput}`
        : 'Docking pose';
      postToViewer({
        type: 'loadDockingResult',
        proteinText: normalizeStructureText(diffdockProtein || ''),
        proteinName: localStorage.getItem('molstar_pdb_name')
          || (diffdockPdbId ? `PDB ${diffdockPdbId.toUpperCase()}` : 'DiffDock protein'),
        sdfText: normalizeStructureText(diffdockLigandPosition || ''),
        ligandName: ligandLabel,
      }, iframeOrigin);
    };

    const loadDefaultStructures = async () => {
      if (viewerClearedRef.current || !molstarRef.current || (!pdbUrl && !displayPdbId)) return;
      if (displayPdbId) {
        if (!viewerClearedRef.current && resultRequestEpoch === resultRequestEpochRef.current) {
          setIsLoading(false);
        }
        // Same RCSB entry as "Load from PDB Database" — waters, crystal ligands,
        // and the default biological assembly. Docked poses overlay afterwards.
        postToViewer({
          type: 'loadDockingResult',
          proteinPdbId: displayPdbId,
          proteinName: localStorage.getItem('molstar_pdb_name') || 'Simulation PDB',
        }, iframeOrigin);
        return;
      }
      const [proteinText] = await Promise.all([pdbLoadPromise]);
      if (viewerClearedRef.current || resultRequestEpoch !== resultRequestEpochRef.current || !molstarRef.current) return;

      // Post only the receptor for an AutoDock result. The iframe still owns the
      // ordered load and camera framing, but no ligand/SDF is sent or rendered.
      postToViewer({
        type: 'loadDockingResult',
        proteinText,
        proteinUrl: protectedPdb ? null : pdbUrl,
        proteinName: localStorage.getItem('molstar_pdb_name') || 'Simulation PDB',
      }, iframeOrigin);
    };

    loadStructuresWhenReady = () => {
      if (resultRequestEpoch !== resultRequestEpochRef.current || !viewerReady || structuresLoaded || viewerClearedRef.current) return;
      structuresLoaded = true;
      if (diffdockProtein || diffdockLigandPosition) {
        loadDiffDockStructures();
      } else if (pdbUrl || displayPdbId) {
        loadDefaultStructures();
      }
    };

    // If iframe is already loaded, ask for the same explicit ready response.
    const alreadyLoaded = (() => {
      try {
        return molstarRef.current?.contentDocument?.readyState === 'complete';
      } catch {
        return false;
      }
    })();
    if (alreadyLoaded && (diffdockProtein || diffdockLigandPosition || pdbUrl || displayPdbId)) {
      handleIframeLoad();
    }

    return () => {
      if (molstarRef.current) {
        molstarRef.current.removeEventListener('load', handleIframeLoad);
      }
      resultRequestController.abort();
      if (resultRequestControllerRef.current === resultRequestController) {
        resultRequestControllerRef.current = null;
      }
      viewerReadyRef.current = false;
      pendingTestSdfRef.current = null;
      window.removeEventListener('message', handleMessage);
      if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    };
  }, [handleClearViewer, postToViewer, showMessage]);

  const handleBackToSimulation = () => {
    navigate('/dashboard/simulation');
  };

  const getProteinPayload = async () => {
    const displayPdbId = readDisplayPdbId(window.location.search);
    if (displayPdbId) {
      return { proteinPdbId: displayPdbId, proteinText: null, proteinUrl: null };
    }

    let pdbUrl = localStorage.getItem('molstar_pdb_url');
    const pdbCode = localStorage.getItem('molstar_pdb_code');

    // Only use a share-link PDB code when this view has no current run-specific URL.
    // A previous share link can leave this key in localStorage; preferring it here
    // would replace the current simulation receptor and hide its pose again.
    if (pdbCode && !pdbUrl) {
      const newPdbUrl = rcsbPdbDownloadUrl(pdbCode);
      if (newPdbUrl) {
        localStorage.setItem('molstar_pdb_url', newPdbUrl);
        pdbUrl = newPdbUrl;
      }
    }

    if (!pdbUrl || !molstarRef.current) return null;

    const needsAuth = pdbUrl.includes('/api/sanitized');

    try {
      if (needsAuth) {
        const response = await authedFetch(pdbUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const pdbText = await response.text();
        if (!pdbText.trim()) throw new Error('Empty PDB response');
        if (!molstarRef.current) return null;
        return { proteinText: pdbText, proteinUrl: null };
      }
      return { proteinText: null, proteinUrl: pdbUrl };
    } catch (error) {
      console.error('Could not manually load this protein:', error);
      showMessage('Could not load the protein for this result', 'error');
      return null;
    }
  };    // Manually retry the authenticated result PDB without loading the ligand/SDF.

  const reloadPdbStructure = async () => {
    if ((!localStorage.getItem('molstar_pdb_url') && !readDisplayPdbId(window.location.search)) || !molstarRef.current) return;

    viewerClearedRef.current = false;
    setResultChromeVisible(true);
    setIsLoading(true);
    try {
      const protein = await getProteinPayload();
      if (!protein || !molstarRef.current) throw new Error('Protein unavailable');
      postToViewer({
        type: 'loadDockingResult',
        ...protein,
        proteinName: localStorage.getItem('molstar_pdb_name') || 'Simulation PDB',
      }, iframeOrigin);
      showMessage('PDB reloaded', 'success', 3000);
    } catch (error) {
      console.error('Error reloading PDB structure:', error);
      showMessage('Failed to reload PDB structure', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Load the same public fixture used by the original viewer's TEST SDF action.
  // It gives a fresh page a useful receptor + pose workspace before a real run exists,
  // instead of leaving the Structure Tools panel empty and making the page look broken.
  const loadTestSdf = async () => {
    if (!molstarRef.current) return;

    // This is a fresh workspace, not a new simulation result. Drop stale result
    // metadata first so an older DiffDock run cannot hide the fixture table below.
    clearViewerStorage();
    const testRequestEpoch = ++resultRequestEpochRef.current;
    resultRequestControllerRef.current?.abort();
    testRequestControllerRef.current?.abort();
    const testRequestController = new AbortController();
    testRequestControllerRef.current = testRequestController;
    resultRequestControllerRef.current = testRequestController;
    viewerClearedRef.current = false;
    setResultChromeVisible(true);
    setIsLoading(true);
    setSdfStatus('loading');
    showMessage('Loading test protein and docking poses...', 'info');
    try {
      const [proteinResponse, sdfResponse] = await Promise.all([
        fetch('/pdbs/one.pdb', { signal: testRequestController.signal }),
        fetch('/pdbs/sample-docking-results.sdf', { signal: testRequestController.signal }),
      ]);
      if (!proteinResponse.ok || !sdfResponse.ok) {
        throw new Error('Test structure files are unavailable');
      }

      const [proteinText, sdfText] = await Promise.all([
        proteinResponse.text(),
        sdfResponse.text(),
      ]);
      if (testRequestEpoch !== resultRequestEpochRef.current || viewerClearedRef.current) return;
      const testPayload = { proteinText, sdfText };
      applySdfText(sdfText);
      if (viewerReadyRef.current) {
        postToViewer({ type: 'loadDockingResult', ...testPayload });
      } else {
        // The iframe can still be creating Molstar when the user clicks the
        // button. Queue the payload and flush it from the viewerReady handler.
        pendingTestSdfRef.current = testPayload;
      }
      if (testRequestEpoch === resultRequestEpochRef.current && !viewerClearedRef.current) {
        setIsLoading(false);
        showMessage('Test SDF loaded', 'success', 3000);
      }
    } catch (error) {
      if (error.name === 'AbortError' || testRequestEpoch !== resultRequestEpochRef.current || viewerClearedRef.current) return;
      console.error('Error loading test SDF:', error);
      setIsLoading(false);
      setSdfStatus('error');
      showMessage('Could not load the test SDF', 'error', 5000);
    } finally {
      if (testRequestControllerRef.current === testRequestController) {
        testRequestControllerRef.current = null;
      }
    }
  };

  // Function to load SMILES structure into Molstar
  const loadSmilesIntoMolstar = async (smiles, moleculeName) => {
    const simulationKey = localStorage.getItem('molstar_simulation_key');
    const diffdockPose = localStorage.getItem('diffdock_ligand_position');
    if (!molstarRef.current || !smiles || smiles === 'N/A') return;
    if (!simulationKey && diffdockPose) {
      const diffdockPdbId = String(localStorage.getItem('diffdock_pdb_id') || '').trim();
      postToViewer({
        type: 'loadDockingResult',
        proteinText: normalizeStructureText(localStorage.getItem('diffdock_protein') || ''),
        proteinName: localStorage.getItem('molstar_pdb_name')
          || (diffdockPdbId ? `PDB ${diffdockPdbId.toUpperCase()}` : 'DiffDock protein'),
        sdfText: normalizeStructureText(diffdockPose),
        ligandName: moleculeName || 'Docking pose',
      }, iframeOrigin);
      showMessage(`Loaded ${moleculeName} into Molstar viewer`, 'success', 3000);
      return;
    }
    if (!simulationKey) {
      showMessage('Open Viewer is available after a docking result is loaded.', 'info', 4000);
      return;
    }
    const protein = await getProteinPayload();
    if (protein) {
      showMessage(`Loading SDF for ${moleculeName} into Molstar viewer...`, 'info');

      try {
        const sdfSpecUrl = API_CONFIG.buildApiUrl(`/sanitizedspecificsdf/${simulationKey}/${encodeURIComponent(smiles)}`);
        const response = await authedFetch(sdfSpecUrl);
        if (response.ok) {
          const sdfText = await response.text();
          if (!sdfText.trim()) throw new Error('Empty SDF response');
          // One command reloads receptor + selected pose in order. The previous
          // clear/PDB/SDF message trio raced Molstar and relied on an unimplemented
          // clear-SDF command plus a 700 ms timing guess.
          postToViewer({
            type: 'loadDockingResult',
            ...protein,
            proteinName: localStorage.getItem('molstar_pdb_name') || 'Simulation PDB',
            sdfText,
            ligandName: moleculeName || 'Docking pose',
          }, iframeOrigin);
          showMessage(`Loaded SDF for ${moleculeName}`, 'success', 3000);
        } else {
          showMessage(`Failed to fetch SDF for ${moleculeName}`, 'error', 5000);
        }
      } catch (error) {
        console.error('Could not load the selected simulation pose:', error);
        showMessage(`Error loading SDF for ${moleculeName}`, 'error', 5000);
      }
    }
  };


  // Function to download molecule as SDF file
  const downloadMoleculeAsSDF = async (molecule, event) => {
    // Stop event propagation to prevent row click
    event.stopPropagation();

    const simulationKey = localStorage.getItem('molstar_simulation_key');
    const diffdockPose = localStorage.getItem('diffdock_ligand_position');
    const smiles = molecule.smiles;
    
    if (!smiles || smiles === 'N/A') {
      showMessage('No SMILES data available for this molecule', 'error', 3000);
      return;
    }

    if (!simulationKey && diffdockPose) {
      const blob = new Blob([normalizeStructureText(diffdockPose)], { type: 'chemical/x-mdl-sdfile' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${molecule.name.replace(/[^a-z0-9]/gi, '_')}_${molecule.id}.sdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      showMessage(`Successfully downloaded ${link.download}`, 'success', 3000);
      return;
    }

    if (!simulationKey) {
      showMessage('Save SDF is available after a docking result is loaded.', 'info', 4000);
      return;
    }

    try {
      showMessage(`Downloading SDF for ${molecule.name}...`, 'info');

      // Fetch the SDF data from the API
      const sdfSpecUrl = API_CONFIG.buildApiUrl(`/sanitizedspecificsdf/${simulationKey}/${encodeURIComponent(smiles)}`);
      const response = await authedFetch(sdfSpecUrl);

      if (response.ok) {
        const sdfText = await response.text();
        
        // Create a blob from the SDF text
        const blob = new Blob([sdfText], { type: 'chemical/x-mdl-sdfile' });
        
        // Create a download link
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        
        // Generate filename from molecule name and ID
        const filename = `${molecule.name.replace(/[^a-z0-9]/gi, '_')}_${molecule.id}.sdf`;
        link.download = filename;
        
        // Trigger download
        document.body.appendChild(link);
        link.click();
        
        // Clean up
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        
        showMessage(`Successfully downloaded ${filename}`, 'success', 3000);
      } else {
        throw new Error(`Failed to fetch SDF: ${response.status}`);
      }
    } catch (error) {
      console.error('Error downloading SDF:', error);
      showMessage(`Failed to download SDF: ${error.message}`, 'error', 5000);
    }
  };

  const hasPoseResult = resultChromeVisible && Boolean(
    localStorage.getItem('molstar_simulation_key')
      || localStorage.getItem('diffdock_ligand_position')
  );
  const loadedPdbName = resultChromeVisible
    ? localStorage.getItem('molstar_pdb_name')
    : null;

  const displayedMolecules = useMemo(() => {
    const seenSmiles = new Set();
    return [...sdfData]
      .sort((left, right) => {
        const leftScore = Number.parseFloat(left.score);
        const rightScore = Number.parseFloat(right.score);
        if (!Number.isFinite(leftScore)) return 1;
        if (!Number.isFinite(rightScore)) return -1;
        return leftScore - rightScore;
      })
      .filter((molecule) => {
        if (!molecule.smiles || molecule.smiles === 'N/A') return true;
        if (seenSmiles.has(molecule.smiles)) return false;
        seenSmiles.add(molecule.smiles);
        return true;
      });
  }, [sdfData]);

  return (
    <div className="min-h-[calc(100vh-8rem)] bg-gray-50 dark:bg-slate-950">
      {/* Main Molstar Card */}
      <div className="flex flex-col">
        <Card className="relative m-4 min-w-0 rounded-xl bg-white text-gray-700 shadow-md dark:bg-slate-900 dark:text-slate-100">
          <CardHeader
            variant="gradient"
            color="blue"
            className="!m-0 flex min-h-16 items-center rounded-b-none px-4 py-3"
          >
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <Typography variant="h5" color="white" className="text-balance">
                  Molstar 3D Structure Viewer
                </Typography>
                {loadedPdbName && (
                  <Typography variant="small" color="white" className="mt-1 truncate opacity-90">
                    {loadedPdbName}
                  </Typography>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                {cart.length > 0 && (
                  <div className="flex items-center gap-2 bg-white bg-opacity-20 rounded-lg px-3 py-1">
                    <svg aria-hidden="true" className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/>
                    </svg>
                    <Typography variant="small" color="white" className="font-medium">
                      {getCartItemCount()} items | ${getCartTotal()}
                    </Typography>
                  </div>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="outlined"
                  color="white"
                  onClick={reloadPdbStructure}
                  className="border-white text-white hover:bg-white hover:text-blue-500"
                >
                  Reload PDB
                </Button>
                <Button
                  size="sm"
                  variant="outlined"
                  color="white"
                  onClick={handleClearViewer}
                  className="border-white text-white hover:bg-white hover:text-blue-500"
                >
                  Clear Result
                </Button>
                <Button
                  size="sm"
                  variant="outlined"
                  color="white"
                  onClick={loadTestSdf}
                  className="border-white text-white hover:bg-white hover:text-blue-500"
                >
                  Test SDF
                </Button>
                <Button
                  size="sm"
                  variant="outlined"
                  color="white"
                  onClick={handleBackToSimulation}
                  className="border-white text-white hover:bg-white hover:text-blue-500"
                >
                  Back to Simulation
                </Button>
                </div>
              </div>
            </div>
          </CardHeader>
          
          {/* Message Display for SMILES Loading */}
          {message && (
            <div className="px-4 pb-2" role="status" aria-live="polite">
              <div className={`p-3 rounded-lg flex items-center gap-2 ${
                messageType === 'info' ? 'bg-blue-50 border border-blue-200 dark:bg-blue-950/50 dark:border-blue-800' :
                messageType === 'success' ? 'bg-green-50 border border-green-200 dark:bg-emerald-950/50 dark:border-emerald-800' :
                messageType === 'error' ? 'bg-red-50 border border-red-200 dark:bg-red-950/50 dark:border-red-800' :
                'bg-gray-50 border border-gray-200 dark:bg-slate-800 dark:border-slate-700'
              }`}>
                {messageType === 'info' && (
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                )}
                <Typography variant="small" className={
                  messageType === 'info' ? 'text-blue-700 dark:text-blue-200' :
                  messageType === 'success' ? 'text-green-700 dark:text-emerald-200' :
                  messageType === 'error' ? 'text-red-700 dark:text-red-200' :
                  'text-gray-700 dark:text-slate-200'
                }>
                  {message}
                </Typography>
              </div>
            </div>
          )}

          {/* Molstar Iframe - Double Height */}
          <CardBody className="h-[clamp(20rem,58vh,38rem)] min-h-0 overflow-hidden p-0 md:h-[clamp(24rem,68vh,52rem)]">
            <iframe
              ref={molstarRef}
              src="/molstar/index.html"
              className="block h-full min-h-0 w-full border-0"
              title="Molstar 3D Viewer"
            />
          </CardBody>
        </Card>
      </div>
      
      {/* DiffDock Results Section - Shows when DiffDock data is present */}
      <div className="flex-shrink-0" id="diffDockResultsSection" style={{ display: resultChromeVisible && (localStorage.getItem('diffdock_protein') || localStorage.getItem('diffdock_ligand_position')) ? 'block' : 'none' }}>
        <Card className="mx-4 mb-4 dark:bg-slate-900">
          <div className="rounded-lg border border-purple-200 bg-gradient-to-br from-purple-50 to-purple-100 p-6 dark:border-purple-800 dark:from-purple-950/40 dark:to-slate-900">
            <div className="flex items-center justify-between mb-4">
              <Typography variant="h6" color="purple" className="font-semibold dark:text-purple-200">
                DiffDock Protein-Ligand Docking Results
              </Typography>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Confidence Score */}
              {localStorage.getItem('diffdock_confidence_score') && (() => {
                const confidenceScore = parseFloat(localStorage.getItem('diffdock_confidence_score'));
                const confidenceChip = diffDockConfidenceChip(confidenceScore);
                return (
                <div className="rounded-lg border border-purple-200 bg-white p-4 shadow-sm dark:border-purple-800 dark:bg-slate-900">
                  <Typography variant="small" color="gray" className="font-medium mb-2 dark:text-slate-400">
                    Confidence Score
                  </Typography>
                  <div className="flex items-center gap-3">
                    <Typography variant="h5" color="purple" className="font-bold tabular-nums dark:text-purple-200">
                      {confidenceScore.toFixed(4)}
                    </Typography>
                    <Chip
                      value={confidenceChip.value}
                      variant="ghost"
                      color={confidenceChip.color}
                      size="sm"
                    />
                  </div>
                </div>
                );
              })()}
              
              {/* PDB ID */}
              {localStorage.getItem('diffdock_pdb_id') && (
                <div className="rounded-lg border border-purple-200 bg-white p-4 shadow-sm dark:border-purple-800 dark:bg-slate-900">
                  <Typography variant="small" color="gray" className="font-medium mb-2 dark:text-slate-400">
                    Protein (PDB ID)
                  </Typography>
                  <Typography variant="small" color="blue-gray" className="font-mono dark:text-slate-200">
                    {localStorage.getItem('diffdock_pdb_id')}
                  </Typography>
                </div>
              )}
              
              {/* Ligand ID */}
              {localStorage.getItem('diffdock_ligand_id') && (
                <div className="rounded-lg border border-purple-200 bg-white p-4 shadow-sm dark:border-purple-800 dark:bg-slate-900">
                  <Typography variant="small" color="gray" className="font-medium mb-2 dark:text-slate-400">
                    Ligand ID
                  </Typography>
                  <Typography variant="small" color="blue-gray" className="font-mono dark:text-slate-200">
                    {localStorage.getItem('diffdock_ligand_id')}
                  </Typography>
                </div>
              )}
              
              {/* Timestamp */}
              {localStorage.getItem('diffdock_timestamp') && (
                <div className="rounded-lg border border-purple-200 bg-white p-4 shadow-sm dark:border-purple-800 dark:bg-slate-900">
                  <Typography variant="small" color="gray" className="font-medium mb-2 dark:text-slate-400">
                    Generated
                  </Typography>
                  <Typography variant="small" color="blue-gray" className="font-mono text-xs dark:text-slate-200">
                    {new Date(localStorage.getItem('diffdock_timestamp')).toLocaleString()}
                  </Typography>
                </div>
              )}
            </div>
            
            <div className="mt-4 flex gap-2">
              <Button
                size="sm"
                variant="outlined"
                color="purple"
                onClick={handleBackToSimulation}
                className="text-sm"
              >
                Back to Simulation
              </Button>
            </div>
          </div>
        </Card>
      </div>
      
      {/* Ranked SDF results are useful for both AutoDock and DiffDock runs. The
          DiffDock metadata card remains above this section, while the same pose
          previews/table shows the actual returned result instead of hiding it. */}
      <div className="flex-shrink-0" id="dockResultsSection">
        {sdfData.length > 0 && (
          <>
            {/* Result previews were lost when the page was reduced to a text table.
                Keep these lightweight 2D thumbnails above the ranked poses: they
                make the result set scannable, while Open Viewer still loads the
                actual docked pose in the 3D workbench. */}
            <Card className="mx-4 mb-4 dark:bg-slate-900">
              <div className="bg-white p-4 dark:bg-slate-900">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Typography variant="h6" color="blue-gray" className="dark:text-slate-100">
                      Structure previews
                    </Typography>
                    <Typography variant="small" color="gray" className="dark:text-slate-400">
                      Preview a compound, then open its docked pose in Molstar.
                    </Typography>
                  </div>
                  <Chip
                    value={`${displayedMolecules.length} ${displayedMolecules.length === 1 ? 'result' : 'results'}`}
                    variant="ghost"
                    color="blue"
                    size="sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {displayedMolecules.slice(0, 8).map((molecule) => {                          const imageUrl = structureImageUrl(molecule.smiles !== 'N/A' ? molecule.smiles : molecule.original_smiles);
                    const scoreValue = Number.parseFloat(molecule.score);
                    return (
                      <button
                        key={`preview-${molecule.id}`}
                        type="button"
                        className="group overflow-hidden rounded-xl border border-blue-gray-100 bg-blue-gray-50 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-slate-700 dark:bg-slate-800"
                        onClick={() => loadSmilesIntoMolstar(molecule.smiles, molecule.name)}
                        title={`Open ${molecule.name} in Molstar`}
                      >
                        <div className="flex h-32 items-center justify-center bg-white p-2 dark:bg-slate-900">
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={`${molecule.name} structure`}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-contain transition duration-200 group-hover:scale-105"
                              onError={(event) => {
                                event.currentTarget.style.display = 'none';
                                event.currentTarget.nextElementSibling.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <span className="items-center justify-center text-xs text-blue-gray-400" style={{ display: imageUrl ? 'none' : 'flex' }}>
                            No preview
                          </span>
                        </div>
                        <div className="border-t border-blue-gray-100 p-2 dark:border-slate-700">
                          <div className="truncate text-xs font-medium text-blue-gray-800 dark:text-slate-100">{molecule.name}</div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-blue-gray-500 dark:text-slate-400">
                            <span>Pose {molecule.id}</span>
                            <span className="tabular-nums">{Number.isFinite(scoreValue) ? `${molecule.score} kcal/mol` : 'Score n/a'}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </Card>

            <Card className="mx-4 mb-4 dark:bg-slate-900">
            <div className="max-h-[min(32rem,70vh)] overflow-y-auto bg-white p-4 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <Typography variant="h6" color="blue-gray" className="dark:text-slate-100">
                    Docking Results — click a row or choose Open Viewer to load a pose
                  </Typography>       
                </div>
                {isLoading && (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <Typography variant="small" color="gray" className="dark:text-slate-400">
                      Loading…
                    </Typography>
                  </div>
                )}
                <Chip
                  value={(() => {
                    // The table de-duplicates on SMILES and keeps the best-scoring pose, so the
                    // row count is molecules, not poses. Saying "N molecules" for N poses of one
                    // compound was wrong every time.
                    const molecules = new Set(
                      sdfData.map((m) => m.smiles).filter((s) => s && s !== 'N/A')
                    ).size;
                    const poses = sdfData.length;
                    return `${molecules} ${molecules === 1 ? 'molecule' : 'molecules'} · best of ${poses} ${poses === 1 ? 'pose' : 'poses'}`;
                  })()}
                  variant="gradient"
                  color="blue"
                  size="sm"
                />
              </div>

              {/* At mobile widths and 200% zoom, a four-column table pushes the
                  primary actions off-screen. Preserve the same result fields and
                  controls as compact cards instead of asking users to discover a
                  horizontal scrollbar. */}
              <div className="space-y-3 md:hidden">
                {displayedMolecules.map((molecule) => {
                  const scoreValue = Number.parseFloat(molecule.score);
                  const hasScore = Number.isFinite(scoreValue);
                  return (
                    <article
                      key={`mobile-${molecule.id}`}
                      className="rounded-xl border border-blue-gray-100 bg-blue-gray-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Typography variant="small" color="gray" className="text-xs font-medium uppercase tracking-wide">
                            Result {molecule.id}
                          </Typography>
                          <Typography variant="small" color="blue-gray" className="mt-1 break-all font-mono text-xs dark:text-slate-200">
                            {molecule.smiles}
                          </Typography>
                        </div>
                        <Chip
                          value={hasScore ? `${molecule.score} kcal/mol` : molecule.score}
                          variant="ghost"
                          color={hasScore && scoreValue < -9 ? 'green' : hasScore && scoreValue < -7 ? 'amber' : 'blue-gray'}
                          size="sm"
                          className="shrink-0 font-mono tabular-nums"
                        />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button
                          size="sm"
                          variant="outlined"
                          color="blue"
                          className="w-full px-2 py-2 text-xs"
                          onClick={() => loadSmilesIntoMolstar(molecule.smiles, molecule.name)}
                          disabled={!hasPoseResult}
                          title={hasPoseResult ? 'Open this pose in Molstar' : 'Available after a docking result is loaded'}
                        >
                          {hasPoseResult ? 'Open Viewer' : 'Open Viewer after docking'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outlined"
                          color="blue"
                          className="flex w-full items-center justify-center gap-1 px-2 py-2 text-xs"
                          onClick={(event) => downloadMoleculeAsSDF(molecule, event)}
                          disabled={!hasPoseResult}
                          title={hasPoseResult ? 'Download this pose as SDF' : 'Available after a docking result is loaded'}
                        >
                          <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Save SDF
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-max table-auto text-left">
                  <thead>
                    <tr>
                      <th scope="col" className="border-b border-blue-gray-100 bg-blue-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none dark:text-slate-200">
                          ID
                        </Typography>
                      </th>           
                      <th scope="col" className="border-b border-blue-gray-100 bg-blue-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none dark:text-slate-200">
                          Score
                        </Typography>
                      </th>
                      <th scope="col" className="border-b border-blue-gray-100 bg-blue-gray-50 p-3 hidden">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none">
                          Price
                        </Typography>
                      </th>
                      <th scope="col" className="border-b border-blue-gray-100 bg-blue-gray-50 p-3 hidden">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none">
                          Cart
                        </Typography>
                      </th>
                      <th scope="col" className="border-b border-blue-gray-100 bg-blue-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none dark:text-slate-200">
                          SMILES
                        </Typography>
                      </th>
                      <th scope="col" className="border-b border-blue-gray-100 bg-blue-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none dark:text-slate-200">
                          Actions
                        </Typography>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedMolecules.map((molecule, index, rows) => {
                      const isLast = index === rows.length - 1;
                      const classes = isLast ? "p-3" : "p-3 border-b border-blue-gray-50 dark:border-slate-800";
                      const scoreValue = parseFloat(molecule.score);
                      const hasScore = Number.isFinite(scoreValue);
                      // Weak binding is a real result, not a failure. Red is what this UI uses for
                      // errors everywhere else, and every dock in production so far scores around
                      // -4.5, so the old thresholds painted every successful run as broken.
                      const scoreColor = !hasScore
                        ? "blue-gray"
                        : scoreValue < -9
                          ? "green"
                          : scoreValue < -7
                            ? "amber"
                            : "blue-gray";
                      const scoreLabel = !hasScore
                        ? null
                        : scoreValue < -9
                          ? "Strong"
                          : scoreValue < -7
                            ? "Moderate"
                            : "Weak";

                      return (
                        <tr 
                          key={molecule.id} 
                          className={`transition-colors focus-within:bg-blue-gray-50 ${hasPoseResult ? 'cursor-pointer hover:bg-blue-gray-50' : 'cursor-default opacity-90'}`}
                          onClick={hasPoseResult ? () => loadSmilesIntoMolstar(molecule.smiles, molecule.name) : undefined}
                          title={hasPoseResult ? `Load ${molecule.name} into Molstar viewer` : 'Run a docking workflow to enable pose actions'}
                        >
                          <td className={classes}>
                            <Typography variant="small" color="blue-gray" className="font-medium">
                              {molecule.id}
                            </Typography>
                          </td>
                         
                         
                          <td className={classes}>
                            <div className="flex items-center gap-2">
                              <Chip
                                value={hasScore ? `${molecule.score} kcal/mol` : molecule.score}
                                variant="ghost"
                                color={scoreColor}
                                size="sm"
                                className="font-mono tabular-nums"
                              />
                              {scoreLabel && (
                                <Typography variant="small" color="gray" className="text-xs">
                                  {scoreLabel}
                                </Typography>
                              )}
                            </div>
                          </td>
                          
                          <td className={`${classes} hidden`}>
                            <div className="flex flex-col gap-1">
                              {typeof moleculePrices[molecule.smiles] === 'object' && moleculePrices[molecule.smiles]?.price1mg ? (
                                <>
                                  <Typography variant="small" color="blue-gray" className="font-medium text-xs">
                                    ID: {moleculePrices[molecule.smiles].id}
                                  </Typography>
                                  <Typography variant="small" className="font-bold text-xs text-brand-500">
                                    1mg: ${moleculePrices[molecule.smiles].price1mg}
                                  </Typography>
                                  <Typography variant="small" color="gray" className="text-xs">
                                    Available: {moleculePrices[molecule.smiles].availableMg}mg
                                  </Typography>
                                </>
                              ) : (
                                <Typography variant="small" color="blue-gray" className="font-medium text-xs">
                                  {typeof moleculePrices[molecule.smiles] === 'string' 
                                    ? moleculePrices[molecule.smiles] 
                                    : 'Loading...'}
                                </Typography>
                              )}
                            </div>
                          </td>
                          
                          <td className={`${classes} hidden`}>
                            {/* Cart content hidden */}
                          </td>
                  
                          <td className={classes}>
                            <Typography variant="small" color="blue-gray" className="font-mono text-xs max-w-xs truncate" title={molecule.smiles}>
                              {molecule.smiles}
                            </Typography>
                          </td>
                          
                          <td className={`${classes} whitespace-nowrap`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                variant="outlined"
                                color="blue"
                                className="flex items-center gap-1 px-2 py-1 text-xs"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  loadSmilesIntoMolstar(molecule.smiles, molecule.name);
                                }}
                                disabled={!hasPoseResult}
                                title={hasPoseResult ? `Load ${molecule.name} into Molstar viewer` : 'Available after a docking result is loaded'}
                              >
                                {hasPoseResult ? 'Open Viewer' : 'Open Viewer after docking'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outlined"
                                color="blue"
                                className="flex items-center gap-1 px-2 py-1 text-xs"
                                onClick={(e) => downloadMoleculeAsSDF(molecule, e)}
                                disabled={!hasPoseResult}
                                title={hasPoseResult ? 'Download molecule as SDF file' : 'Available after a docking result is loaded'}
                              >
                                <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                Save SDF
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            </Card>
          </>
        )}
        
        {/*  Wish List Display */}
        {cart.length > 0 && (
          <Card className="mx-4 mb-4 dark:bg-slate-900">
            <div className="bg-white p-4 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">                  <Typography variant="h6" color="blue-gray" className="dark:text-slate-100">
                  Wish List
                </Typography>
                <div className="flex items-center gap-4">
                  <Typography variant="small" color="gray" className="dark:text-slate-400">
                    {getCartItemCount()} items
                  </Typography>
                  <Typography variant="h6" className="tabular-nums text-brand-500">
                    Total: ${getCartTotal()}
                  </Typography>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full min-w-max table-auto text-left">
                  <thead>
                    <tr>
                      <th scope="col" className="border-b border-blue-gray-100 bg-blue-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none dark:text-slate-200">
                          Molecule
                        </Typography>
                      </th>
                      <th scope="col" className="border-b border-blue-gray-100 bg-blue-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none dark:text-slate-200">
                          Amount
                        </Typography>
                      </th>
                      <th scope="col" className="border-b border-blue-gray-100 bg-blue-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none dark:text-slate-200">
                          Price/mg
                        </Typography>
                      </th>
                      <th scope="col" className="border-b border-blue-gray-100 bg-blue-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none dark:text-slate-200">
                          Total
                        </Typography>
                      </th>
                      <th scope="col" className="border-b border-blue-gray-100 bg-blue-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none dark:text-slate-200">
                          Actions
                        </Typography>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item, index) => {
                      const isLast = index === cart.length - 1;
                      const classes = isLast ? "p-3" : "p-3 border-b border-blue-gray-50 dark:border-slate-800";
                      const catalogId = item.catalogId || item.moleculeId || item.id || 'N/A';
                      
                      return (
                        <tr key={`${catalogId}-${index}`}>
                          <td className={classes}>
                            <div className="flex flex-col">
                              <Typography variant="small" color="blue-gray" className="font-medium">
                                {item.name}
                              </Typography>
                              <Typography variant="small" color="gray" className="text-xs">
                                ID: {catalogId}
                              </Typography>
                            </div>
                          </td>
                          <td className={classes}>
                            <Typography variant="small" color="blue-gray" className="font-medium">
                              {item.amount}mg
                            </Typography>
                          </td>
                          <td className={classes}>
                            <Typography variant="small" color="blue-gray" className="font-medium">
                              ${item.pricePerMg}
                            </Typography>
                          </td>
                          <td className={classes}>
                            <Typography variant="small" className="font-bold text-brand-500">
                              ${item.totalPrice.toFixed(2)}
                            </Typography>
                          </td>
                          <td className={classes}>
                            <Button
                              size="sm"
                              variant="outlined"
                              color="red"
                              onClick={() => removeFromCart(item.id)}
                              className="text-xs px-2 py-1"
                            >
                              Remove
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        )}
        
        {/* Loading/Empty State for SDF Data */}
        {!sdfData.length && !isLoading && (
          <Card className="mx-4 mb-4 dark:bg-slate-900">
            <div className="bg-white p-4 dark:bg-slate-900">
              <div className="text-center py-8">
                {sdfStatus === 'empty' ? (
                  <>
                    <Typography variant="small" color="red" className="font-medium">
                      The docking run returned no readable poses.
                    </Typography>
                    <Typography variant="small" color="gray" className="mt-1 dark:text-slate-400">
                      The result came back, but nothing in it could be parsed. Try the run again;
                      if it keeps happening the result format has changed and this is not your input.
                    </Typography>
                  </>
                ) : sdfStatus === 'error' ? (
                  <>
                    <Typography variant="small" color="red" className="font-medium">
                      Could not load the docking result.
                    </Typography>
                    <Typography variant="small" color="gray" className="mt-1 dark:text-slate-400">
                      The result file could not be fetched. Try the run again.
                    </Typography>
                  </>
                ) : (
                  <Typography variant="small" color="gray" className="dark:text-slate-400">
                    No docking results yet. Run a simulation to see poses here.
                  </Typography>
                )}
              </div>
            </div>
          </Card>
        )}
        
        {/* Loading State */}
        {isLoading && (
          <Card className="mx-4 mb-4 dark:bg-slate-900">
            <div className="bg-white p-4 dark:bg-slate-900">
              <div className="flex items-center justify-center gap-2 py-8">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <Typography variant="small" color="gray" className="dark:text-slate-400">
                  Loading SDF data…
                </Typography>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

export default Molstar3D;
