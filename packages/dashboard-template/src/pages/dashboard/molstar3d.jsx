import React, { useEffect, useRef, useState } from "react";
import { Card, CardHeader, CardBody, Typography, Button, Chip } from "@material-tailwind/react";
import { useNavigate } from "react-router-dom";
import { API_CONFIG } from "@/utils/constants";

export function Molstar3D() {
  const molstarRef = useRef(null);
  const navigate = useNavigate();
  const [sdfData, setSdfData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState(''); // 'success', 'error', or ''
  const [moleculePrices, setMoleculePrices] = useState({}); // Store prices by SMILES
  const [cart, setCart] = useState([]); // Shopping cart state

  // Function to parse SDF data
  const parseSdfData = (sdfText) => {
    const molecules = sdfText.split('$$$$').filter(entry => entry.trim());
    
    return molecules.map((molecule, index) => {
      const lines = molecule.split('\n');
      const properties = {};
      
      // Extract properties from SDF format
      let currentProperty = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Look for property headers like >  <PROPERTY_NAME>
        if (line.startsWith('>') && line.includes('<') && line.includes('>')) {
          const match = line.match(/<([^>]+)>/);
          if (match) {
            currentProperty = match[1];
          }
        } else if (currentProperty && line && !line.startsWith('>')) {
          // This is the value for the current property
          properties[currentProperty] = line;
          currentProperty = null;
        }
      }
      
      // Extract the molecule name/ID from the first line
      const moleculeName = lines[0]?.trim() || `Molecule ${index + 1}`;
      
      return {
        id: index + 1,
        name: moleculeName,
        model: properties.MODEL || 'N/A',
        torsdo: properties.TORSDO || 'N/A',
        score: properties.SCORE || 'N/A',
        ligand_id: properties.ligand_id || 'N/A',
        original_smiles: properties.original_smiles || 'N/A',
        smiles: properties.smiles || 'N/A'
      };
    });
  };

  // Function to load SDF data from URL
  const loadSdfData = async (url) => {
    try {
      console.log('Loading SDF data from URL:', url);
      setIsLoading(true);
      const response = await fetch(url);
      if (response.ok) {
        const sdfText = await response.text();
        const parsedData = parseSdfData(sdfText);
        setSdfData(parsedData);
        console.log('SDF data loaded:', parsedData.length, 'molecules');
        
        // Fetch prices for all molecules
        fetchAllMoleculePrices(parsedData);
      } else {
        console.error('Failed to load SDF data:', response.status);
      }
    } catch (error) {
      console.error('Error loading SDF data:', error);
    } finally {
      setIsLoading(false);
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

  // Function to fetch prices for all molecules
  const fetchAllMoleculePrices = async (molecules) => {
    const pricePromises = molecules.map(async (molecule) => {
      if (molecule.smiles !== 'N/A') {
        const price = await fetchMoleculePrice(molecule.smiles);
        return { smiles: molecule.smiles, price };
      }
      return { 
        smiles: molecule.smiles, 
        price: {
          id: 'No SMILES',
          name: 'N/A',
          availableMg: 0,
          price1mg: 100,
          price2mg: 100,
          price5mg: 100,
          price10mg: 100
        }
      };
    });

    const priceResults = await Promise.all(pricePromises);
    const priceMap = {};
    priceResults.forEach(result => {
      priceMap[result.smiles] = result.price;
    });
    
    setMoleculePrices(priceMap);
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

  const addToCart = (molecule, amount, priceInfo) => {
    const cartItem = {
      id: `${molecule.smiles}_${Date.now()}`,
      smiles: molecule.smiles,
      name: molecule.name,
      score: molecule.score,
      amount: amount,
      pricePerMg: priceInfo?.price1mg || 100,
      totalPrice: priceInfo?.price1mg || 100, // Do not multiply by amount - just use the price as is
      moleculeId: priceInfo?.id || 'N/A',
      availableMg: priceInfo?.availableMg || 0,
      addedAt: new Date().toISOString()
    };

    const updatedCart = [...cart, cartItem];
    setCart(updatedCart);
    saveCartToStorage(updatedCart);
    
    setMessage(`Added ${amount}mg of ${molecule.name} to cart`);
    setMessageType('success');
    setTimeout(() => {
      setMessage('');
      setMessageType('');
    }, 3000);
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

  // Build a blob URL from text content so Molstar can load inline structures
  const createObjectUrlFromString = (content, mimeType = 'text/plain') => {
    if (!content) return null;
    const blob = new Blob([content], { type: mimeType });
    return URL.createObjectURL(blob);
  };

  useEffect(() => {
    // Clear any localhost URLs from localStorage on component mount
    const clearLocalhostUrls = () => {
      const pdbUrl = localStorage.getItem('molstar_pdb_url');
      const sdfUrl = localStorage.getItem('molstar_sdf_url');
      
      if (pdbUrl && pdbUrl.includes('localhost')) {
        console.log('Clearing localhost PDB URL:', pdbUrl);
        localStorage.removeItem('molstar_pdb_url');
      }
      
      if (sdfUrl && sdfUrl.includes('localhost')) {
        console.log('Clearing localhost SDF URL:', sdfUrl);
        localStorage.removeItem('molstar_sdf_url');
      }
    };
    
    clearLocalhostUrls();
    
    // Check for checkout status and simulation data from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const checkoutStatus = urlParams.get('checkout');
    const sessionId = urlParams.get('session_id');
    const pdbParam = urlParams.get('pdb');
    const simulationParam = urlParams.get('simulation');
    
    // Auto-load SDF file if parameters are present
    if (pdbParam && simulationParam) {
      const sdfUrl = API_CONFIG.buildApiUrl(`/sanitizedminimalsdf/${simulationParam}`);
      console.log('Auto-loading SDF with URL:', sdfUrl);
      loadSdfData(sdfUrl);
    }

    // Auto-load PDB file from RCSB if pdb parameter is present
    if (pdbParam) {
      const pdbUrl = `https://files.rcsb.org/download/${pdbParam}.pdb`;
      console.log('Auto-loading PDB from RCSB:', pdbUrl);
      
      // Store the URLs and PDB code in localStorage
      localStorage.setItem('molstar_pdb_url', pdbUrl);
      localStorage.setItem('molstar_pdb_code', pdbParam);
      if (simulationParam) {
        localStorage.setItem('molstar_simulation_key', simulationParam);
      }
      
      // Load PDB into Molstar after iframe is ready
      const loadPdbWhenReady = () => {
        if (molstarRef.current) {
          setTimeout(() => {
            console.log('Loading PDB structure from RCSB:', pdbUrl);
            molstarRef.current.contentWindow.postMessage({
              type: 'loadStructureFromUrl',
              url: pdbUrl,
              format: 'pdb'
            }, '*');
            
            // Collapse Molstar main menu
            setTimeout(() => {
              if (molstarRef.current && molstarRef.current.contentWindow) {
                molstarRef.current.contentWindow.eval(`
                  (function() {
                    var btn = document.querySelector('.msp-btn.msp-btn-icon.msp-btn-link-toggle-off.msp-transparent-bg');
                    if (btn) { btn.click(); setTimeout(() => btn.click(), 100); }
                  })();
                `);
              }
            }, 700);
          }, 2000);
        }
      };

      // If iframe is already loaded, load immediately
      if (molstarRef.current) {
        loadPdbWhenReady();
      } else {
        // Wait for iframe to load
        setTimeout(loadPdbWhenReady, 3000);
      }
    }

    // Handle checkout status
    if (checkoutStatus === 'success') {
      setMessage('Payment successful! Your molecule order has been processed.');
      setMessageType('success');
      // Clear the cart after successful checkout
      localStorage.removeItem('moleculeCart');
      setCart([]);
      
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      
      setTimeout(() => {
        setMessage('');
        setMessageType('');
      }, 8000);
    } else if (checkoutStatus === 'cancel') {
      setMessage('Checkout was cancelled. Your cart items are still saved.');
      setMessageType('error');
      
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      
      setTimeout(() => {
        setMessage('');
        setMessageType('');
      }, 5000);
    }
    
    // Load cart from storage on component mount
    loadCartFromStorage();
    
    let pdbUrl = localStorage.getItem('molstar_pdb_url');
    let sdfUrl = localStorage.getItem('molstar_sdf_url');
    const simulationKey = localStorage.getItem('molstar_simulation_key');
    const pdbCode = localStorage.getItem('molstar_pdb_code');
    const diffdockProtein = localStorage.getItem('diffdock_protein');
    const diffdockLigand = localStorage.getItem('diffdock_ligand');
    const diffdockLigandPosition = localStorage.getItem('diffdock_ligand_position');
    const diffdockProteinUrl = createObjectUrlFromString(diffdockProtein, 'chemical/x-pdb');
    const diffdockLigandUrl = createObjectUrlFromString(diffdockLigand, 'chemical/x-mdl-molfile');
    const diffdockLigandPositionUrl = createObjectUrlFromString(diffdockLigandPosition, 'chemical/x-mdl-molfile');

    console.log('localStorage URLs:', { pdbUrl, sdfUrl, simulationKey, pdbCode });

    // If we have a PDB code, always use RCSB URL
    if (pdbCode) {
      const newPdbUrl = `https://files.rcsb.org/download/${pdbCode}.pdb`;
      console.log('Rebuilding PDB URL from RCSB:', pdbCode, '->', newPdbUrl);
      localStorage.setItem('molstar_pdb_url', newPdbUrl);
      pdbUrl = newPdbUrl;
    }

    // Load SDF data if URL is available
    if (sdfUrl) {
      // Check if the URL is using localhost and rebuild it if necessary
      if ( simulationKey) {
        const newSdfUrl = API_CONFIG.buildApiUrl(`/sanitizedminimalsdf/${simulationKey}`);
        console.log('Rebuilding localhost SDF URL:', sdfUrl, '->', newSdfUrl);
        localStorage.setItem('molstar_sdf_url', newSdfUrl);
        loadSdfData(newSdfUrl);
      } else {
        console.log('Loading SDF from localStorage URL:', sdfUrl);
        loadSdfData(sdfUrl);
      }
    }

    
    // Load cart from storage
    const savedCart = loadCartFromStorage();

    // Listen for messages from Molstar iframe
    const handleMessage = (event) => {
      if (event.data.type === 'smilesLoaded') {
        setMessage(`Successfully loaded ${event.data.name || 'molecule'} into Molstar viewer`);
        setMessageType('success');
        setTimeout(() => {
          setMessage('');
          setMessageType('');
        }, 3000);
      } else if (event.data.type === 'smilesLoadError') {
        setMessage(`Failed to load molecule: ${event.data.error}`);
        setMessageType('error');
        setTimeout(() => {
          setMessage('');
          setMessageType('');
        }, 5000);
      }
    };

    window.addEventListener('message', handleMessage);

    const loadDiffDockStructures = () => {
      if (!molstarRef.current) return;
      const target = molstarRef.current.contentWindow;
      target.postMessage({ type: 'clearStructure' }, '*');
      if (diffdockProteinUrl) {
        console.log('Loading DiffDock protein from blob URL');
        target.postMessage({
          type: 'loadStructureFromUrl',
          url: diffdockProteinUrl,
          format: 'pdb'
        }, '*');
      }
      if (diffdockLigandPositionUrl) {
        console.log('Loading DiffDock ligand with positioning from blob URL');
        // Small delay to ensure protein is in place before ligand overlays
        setTimeout(() => {
          target.postMessage({
            type: 'loadStructureFromUrl',
            url: diffdockLigandPositionUrl,
            format: 'mol'
          }, '*');
        }, 500);
      }

      // Collapse Molstar main menu by toggling twice
      setTimeout(() => {
        if (molstarRef.current && molstarRef.current.contentWindow) {
          molstarRef.current.contentWindow.eval(`
            (function() {
              var btn = document.querySelector('.msp-btn.msp-btn-icon.msp-btn-link-toggle-off.msp-transparent-bg');
              if (btn) { btn.click(); setTimeout(() => btn.click(), 100); }
            })();
          `);
        }
      }, 700);
    };

    const loadDefaultStructures = () => {
      if (!molstarRef.current || !pdbUrl) return;
      const target = molstarRef.current.contentWindow;
      console.log('Loading PDB structure:', pdbUrl);
      target.postMessage({
        type: 'loadStructureFromUrl',
        url: pdbUrl,
        format: 'pdb'
      }, '*');
      setTimeout(() => {
        if (molstarRef.current && molstarRef.current.contentWindow) {
          molstarRef.current.contentWindow.eval(`
            (function() {
              var btn = document.querySelector('.msp-btn.msp-btn-icon.msp-btn-link-toggle-off.msp-transparent-bg');
              if (btn) { btn.click(); setTimeout(() => btn.click(), 100); }
            })();
          `);
        }
      }, 700);
    };

    const handleIframeLoad = () => {
      // Wait a bit more for Molstar to fully initialize
      setTimeout(() => {
        if (!molstarRef.current) return;
        if (diffdockProteinUrl || diffdockLigandPositionUrl) {
          loadDiffDockStructures();
        } else if (pdbUrl && sdfUrl && simulationKey) {
          loadDefaultStructures();
        }
      }, 2000);
    };

    if (molstarRef.current) {
      molstarRef.current.addEventListener('load', handleIframeLoad);
    }

    // If iframe is already loaded, try to load structures immediately
    if (molstarRef.current && molstarRef.current.contentWindow && (diffdockProteinUrl || diffdockLigandPositionUrl || (pdbUrl && sdfUrl && simulationKey))) {
      handleIframeLoad();
    }

    return () => {
      if (molstarRef.current) {
        molstarRef.current.removeEventListener('load', handleIframeLoad);
      }
      window.removeEventListener('message', handleMessage);
      if (diffdockProteinUrl) URL.revokeObjectURL(diffdockProteinUrl);
      if (diffdockLigandUrl) URL.revokeObjectURL(diffdockLigandUrl);
      if (diffdockLigandPositionUrl) URL.revokeObjectURL(diffdockLigandPositionUrl);
    };
  }, []);

  const handleBackToSimulation = () => {
    navigate('/dashboard/simulation');
  };

  const loadPDBStructure = () => {
    let pdbUrl = localStorage.getItem('molstar_pdb_url');
    const pdbCode = localStorage.getItem('molstar_pdb_code');
    
    // If we have a PDB code, always use RCSB URL
    if (pdbCode) {
      const newPdbUrl = `https://files.rcsb.org/download/${pdbCode}.pdb`;
      console.log('Loading PDB from RCSB:', newPdbUrl);
      localStorage.setItem('molstar_pdb_url', newPdbUrl);
      pdbUrl = newPdbUrl;
    }
    
    if (pdbUrl && molstarRef.current) {
      console.log('Manually loading PDB:', pdbUrl);
      molstarRef.current.contentWindow.postMessage({
        type: 'loadStructureFromUrl',
        url: pdbUrl,
        format: 'pdb'
      }, '*');
    setTimeout(() => {
              if (molstarRef.current && molstarRef.current.contentWindow) {
                molstarRef.current.contentWindow.eval(`
                  (function() {
                    var btn = document.querySelector('.msp-btn.msp-btn-icon.msp-btn-link-toggle-off.msp-transparent-bg');
                    if (btn) { btn.click(); setTimeout(() => btn.click(), 100); }
                  })();
                `);
              }
            }, 700); // Delay to ensure PDB is loaded and UI is ready
    }
  };
const HideMenu =()=>{
        

    };
  const loadSDFStructure = () => {
    const sdfUrl = localStorage.getItem('molstar_sdf_url');
    if (sdfUrl && molstarRef.current) {
      console.log('Manually loading SDF:', sdfUrl);
      molstarRef.current.contentWindow.postMessage({
        type: 'loadStructureFromUrl',
        url: sdfUrl,
        format: 'sdf'
      }, '*');     
      setTimeout(() => {
              if (molstarRef.current && molstarRef.current.contentWindow) {
                molstarRef.current.contentWindow.eval(`
                  (function() {
                    var btn = document.querySelector('.msp-btn.msp-btn-icon.msp-btn-link-toggle-off.msp-transparent-bg');
                    if (btn) { btn.click(); setTimeout(() => btn.click(), 100); }
                  })();
                `);
              }
            }, 700); // Delay to ensure PDB is loaded and UI is ready
      // Also reload the SDF data for the table
      loadSdfData(sdfUrl);
    }
  };

  // Function to load SMILES structure into Molstar
  const loadSmilesIntoMolstar = async (smiles, moleculeName) => {
    const simulationKey = localStorage.getItem('molstar_simulation_key');
    molstarRef.current.contentWindow.clearStructure();
    loadPDBStructure();
    if (molstarRef.current && smiles && smiles !== 'N/A' && simulationKey) {
      setMessage(`Loading SDF for ${moleculeName} into Molstar viewer...`);
      setMessageType('info');

      //clear previously load sdf
      molstarRef.current.contentWindow.postMessage({ type: 'clearSdfStructure' }, '*');
      try {
        const sdfSpecUrl = API_CONFIG.buildApiUrl(`/sanitizedspecificsdf/${simulationKey}/${encodeURIComponent(smiles)}`);
        const response = await fetch(sdfSpecUrl);
        if (response.ok) {
          const sdfText = await response.text();
          // Send SDF data to Molstar iframe
          molstarRef.current.contentWindow.postMessage({
            type: 'loadStructureFromUrl',
            url: sdfSpecUrl,
            format: 'sdf'
          }, '*');
           setTimeout(() => {
              if (molstarRef.current && molstarRef.current.contentWindow) {
                molstarRef.current.contentWindow.eval(`
                  (function() {
                    var btn = document.querySelector('.msp-btn.msp-btn-icon.msp-btn-link-toggle-off.msp-transparent-bg');
                    if (btn) { btn.click(); setTimeout(() => btn.click(), 100); }
                  })();
                `);
              }
            }, 700); // Delay to ensure PDB is loaded and UI is ready
          setMessage(`Loaded SDF for ${moleculeName}`);
          setMessageType('success');
        } else {
          setMessage(`Failed to fetch SDF for ${moleculeName}`);
          setMessageType('error');
        }
      } catch (error) {
        setMessage(`Error loading SDF for ${moleculeName}`);
        setMessageType('error');
      }
      setTimeout(() => {
        setMessage('');
        setMessageType('');
      }, 3000);
    }
  };

  const loadTestSDF = () => {
    // For testing, we'll load a sample SDF file
    const testSdfUrl = '/pdbs/sample-docking-results.sdf';
    loadSdfData(testSdfUrl);
  };

  // Function to send SMILES to Molstar for visualization
  const sendSmilesToMolstar = (smiles) => {
    if (molstarRef.current && smiles && smiles !== 'N/A') {
      console.log('Sending SMILES to Molstar:', smiles);
      molstarRef.current.contentWindow.postMessage({
        type: 'loadSmilesStructure',
        smiles: smiles
      }, '*');
    }
  };

  // Function to download molecule as SDF file
  const downloadMoleculeAsSDF = async (molecule, event) => {
    // Stop event propagation to prevent row click
    event.stopPropagation();
    
    const simulationKey = localStorage.getItem('molstar_simulation_key');
    const smiles = molecule.smiles;
    
    if (!smiles || smiles === 'N/A') {
      setMessage('No SMILES data available for this molecule');
      setMessageType('error');
      setTimeout(() => {
        setMessage('');
        setMessageType('');
      }, 3000);
      return;
    }

    if (!simulationKey) {
      setMessage('No simulation key found. Cannot fetch SDF data.');
      setMessageType('error');
      setTimeout(() => {
        setMessage('');
        setMessageType('');
      }, 3000);
      return;
    }

    try {
      setMessage(`Downloading SDF for ${molecule.name}...`);
      setMessageType('info');

      // Fetch the SDF data from the API
      const sdfSpecUrl = API_CONFIG.buildApiUrl(`/sanitizedspecificsdf/${simulationKey}/${encodeURIComponent(smiles)}`);
      const response = await fetch(sdfSpecUrl);
      
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
        
        setMessage(`Successfully downloaded ${filename}`);
        setMessageType('success');
        setTimeout(() => {
          setMessage('');
          setMessageType('');
        }, 3000);
      } else {
        throw new Error(`Failed to fetch SDF: ${response.status}`);
      }
    } catch (error) {
      console.error('Error downloading SDF:', error);
      setMessage(`Failed to download SDF: ${error.message}`);
      setMessageType('error');
      setTimeout(() => {
        setMessage('');
        setMessageType('');
      }, 5000);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Main Molstar Card */}
      <div className="flex-1 flex flex-col">
        <Card className="relative bg-clip-border rounded-xl bg-white text-gray-700 shadow-md m-4 flex-1 flex flex-col" style={{ minHeight: '85vh' }}>
          <CardHeader
            variant="gradient"
            color="blue"
            className="mb-4 grid h-16 place-items-center flex-shrink-0"
          >
            <div className="flex items-center justify-between w-full px-4">
              <Typography variant="h5" color="white">
                Molstar 3D Structure Viewer
              </Typography>
              <div className="flex items-center gap-2">
                {cart.length > 0 && (
                  <div className="flex items-center gap-2 bg-white bg-opacity-20 rounded-lg px-3 py-1">
                    <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/>
                    </svg>
                    <Typography variant="small" color="white" className="font-medium">
                      {getCartItemCount()} items | ${getCartTotal()}
                    </Typography>
                  </div>
                )}
                <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outlined"
                  color="white"
                  onClick={loadPDBStructure}
                  className="border-white text-white hover:bg-white hover:text-blue-500"
                >
                  Load PDB
                </Button>
                <Button
                  size="sm"
                  variant="outlined"
                  color="white"
                  onClick={loadSDFStructure}
                  className="border-white text-white hover:bg-white hover:text-blue-500"
                >
                  Load SDF
                </Button>
                <Button
                  size="sm"
                  variant="outlined"
                  color="white"
                  onClick={loadTestSDF}
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
            <div className="px-4 pb-2">
              <div className={`p-3 rounded-lg flex items-center gap-2 ${
                messageType === 'info' ? 'bg-blue-50 border border-blue-200' : 
                messageType === 'success' ? 'bg-green-50 border border-green-200' : 
                messageType === 'error' ? 'bg-red-50 border border-red-200' : 
                'bg-gray-50 border border-gray-200'
              }`}>
                {messageType === 'info' && (
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                )}
                <Typography variant="small" className={
                  messageType === 'info' ? 'text-blue-700' : 
                  messageType === 'success' ? 'text-green-700' : 
                  messageType === 'error' ? 'text-red-700' : 
                  'text-gray-700'
                }>
                  {message}
                </Typography>
              </div>
            </div>
          )}

          {/* Molstar Iframe - Double Height */}
          <CardBody className="p-0 flex-1" style={{ minHeight: '800px' }}>
            <iframe
              ref={molstarRef}
              src="/molstar/index.html"
              className="w-full h-full border-0"
              title="Molstar 3D Viewer"
              style={{ minHeight: '800px' }}
            />
          </CardBody>
        </Card>
      </div>
      
      {/* DiffDock Results Section - Shows when DiffDock data is present */}
      <div className="flex-shrink-0" id="diffDockResultsSection" style={{ display: localStorage.getItem('diffdock_protein') || localStorage.getItem('diffdock_ligand_position') ? 'block' : 'none' }}>
        <Card className="mx-4 mb-4">
          <div className="p-6 bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <Typography variant="h6" color="purple" className="font-semibold">
                DiffDock Protein-Ligand Docking Results
              </Typography>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Confidence Score */}
              {localStorage.getItem('diffdock_confidence_score') && (
                <div className="p-4 bg-white rounded-lg border border-purple-200 shadow-sm">
                  <Typography variant="small" color="gray" className="font-medium mb-2">
                    Confidence Score
                  </Typography>
                  <div className="flex items-center gap-3">
                    <Typography variant="h5" color="purple" className="font-bold">
                      {parseFloat(localStorage.getItem('diffdock_confidence_score')).toFixed(4)}
                    </Typography>
                    <Chip
                      value={parseFloat(localStorage.getItem('diffdock_confidence_score')) < -8 ? 'High Confidence' : 'Medium Confidence'}
                      variant="ghost"
                      color={parseFloat(localStorage.getItem('diffdock_confidence_score')) < -8 ? 'green' : 'amber'}
                      size="sm"
                    />
                  </div>
                </div>
              )}
              
              {/* PDB ID */}
              {localStorage.getItem('diffdock_pdb_id') && (
                <div className="p-4 bg-white rounded-lg border border-purple-200 shadow-sm">
                  <Typography variant="small" color="gray" className="font-medium mb-2">
                    Protein (PDB ID)
                  </Typography>
                  <Typography variant="small" color="blue-gray" className="font-mono">
                    {localStorage.getItem('diffdock_pdb_id')}
                  </Typography>
                </div>
              )}
              
              {/* Ligand ID */}
              {localStorage.getItem('diffdock_ligand_id') && (
                <div className="p-4 bg-white rounded-lg border border-purple-200 shadow-sm">
                  <Typography variant="small" color="gray" className="font-medium mb-2">
                    Ligand ID
                  </Typography>
                  <Typography variant="small" color="blue-gray" className="font-mono">
                    {localStorage.getItem('diffdock_ligand_id')}
                  </Typography>
                </div>
              )}
              
              {/* Timestamp */}
              {localStorage.getItem('diffdock_timestamp') && (
                <div className="p-4 bg-white rounded-lg border border-purple-200 shadow-sm">
                  <Typography variant="small" color="gray" className="font-medium mb-2">
                    Generated
                  </Typography>
                  <Typography variant="small" color="blue-gray" className="font-mono text-xs">
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
      
      {/* SDF Results Table - Always Below the iframe */}
      <div className="flex-shrink-0" id="dockResultsSection" style={{ display: localStorage.getItem('diffdock_protein') || localStorage.getItem('diffdock_ligand_position') ? 'none' : 'block' }}>
        {sdfData.length > 0 && (
          <Card className="mx-4 mb-4">
            <div className="p-4 bg-white max-h-96 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <Typography variant="h6" color="blue-gray">
                    Docking Results - Click on any row to load the molecule into the 3D viewer
                  </Typography>       
                </div>
                {isLoading && (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <Typography variant="small" color="gray">
                      Loading...
                    </Typography>
                  </div>
                )}
                <Chip
                  value={`Best of ${sdfData.length} molecules`}
                  variant="gradient"
                  color="blue"
                  size="sm"
                />
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full min-w-max table-auto text-left">
                  <thead>
                    <tr>
                      <th className="border-b border-blue-gray-100 bg-blue-gray-50 p-3">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none">
                          ID
                        </Typography>
                      </th>           
                      <th className="border-b border-blue-gray-100 bg-blue-gray-50 p-3">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none">
                          Score
                        </Typography>
                      </th>
                      <th className="border-b border-blue-gray-100 bg-blue-gray-50 p-3 hidden">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none">
                          Price
                        </Typography>
                      </th>
                      <th className="border-b border-blue-gray-100 bg-blue-gray-50 p-3 hidden">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none">
                          Cart
                        </Typography>
                      </th>
                      <th className="border-b border-blue-gray-100 bg-blue-gray-50 p-3">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none">
                          SMILES
                        </Typography>
                      </th>
                      <th className="border-b border-blue-gray-100 bg-blue-gray-50 p-3">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none">
                          Actions
                        </Typography>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sdfData
                      .filter((molecule, index, self) => {
                        // Filter for unique molecules based on SMILES
                        return index === self.findIndex(m => m.smiles === molecule.smiles && m.smiles !== 'N/A');
                      })
                      .sort((a, b) => parseFloat(a.score) - parseFloat(b.score)) // Sort by score (most negative first)                     
                      .map((molecule, index) => {
                      const isLast = index === 1; // Only 2 items, so last is index 1
                      const classes = isLast ? "p-3" : "p-3 border-b border-blue-gray-50";
                      const scoreValue = parseFloat(molecule.score);
                      const scoreColor = scoreValue < -7 ? "green" : scoreValue < -5 ? "amber" : "red";
                      
                      return (
                        <tr 
                          key={molecule.id} 
                          className="hover:bg-blue-gray-50 transition-colors cursor-pointer"
                          onClick={() => loadSmilesIntoMolstar(molecule.smiles, molecule.name)}
                          title={`Click to load ${molecule.name} into Molstar viewer`}
                        >
                          <td className={classes}>
                            <Typography variant="small" color="blue-gray" className="font-medium">
                              {molecule.id}
                            </Typography>
                          </td>
                         
                         
                          <td className={classes}>
                            <Chip
                              value={molecule.score}
                              variant="ghost"
                              color={scoreColor}
                              size="sm"
                              className="font-mono"
                            />
                          </td>
                          
                          <td className={`${classes} hidden`}>
                            <div className="flex flex-col gap-1">
                              {typeof moleculePrices[molecule.smiles] === 'object' && moleculePrices[molecule.smiles]?.price1mg ? (
                                <>
                                  <Typography variant="small" color="blue-gray" className="font-medium text-xs">
                                    ID: {moleculePrices[molecule.smiles].id}
                                  </Typography>
                                  <Typography variant="small" color="green" className="font-bold text-xs">
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
                          
                          <td className={`${classes} hidden`} onClick={(e) => e.stopPropagation()}>
                            {/* Cart content hidden */}
                          </td>
                  
                          <td className={classes}>
                            <Typography variant="small" color="blue-gray" className="font-mono text-xs max-w-xs truncate" title={molecule.smiles}>
                              {molecule.smiles}
                            </Typography>
                          </td>
                          
                          <td className={classes} onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="outlined"
                              color="blue"
                              className="flex items-center gap-1 text-xs px-2 py-1"
                              onClick={(e) => downloadMoleculeAsSDF(molecule, e)}
                              title="Download molecule as SDF file"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Save SDF
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
        
        {/*  Wish List Display */}
        {cart.length > 0 && (
          <Card className="mx-4 mb-4">
            <div className="p-4 bg-white">
              <div className="flex items-center justify-between mb-4">
                <Typography variant="h6" color="blue-gray">
                  Wish List
                </Typography>
                <div className="flex items-center gap-4">
                  <Typography variant="small" color="gray">
                    {getCartItemCount()} items
                  </Typography>
                  <Typography variant="h6" color="green">
                    Total: ${getCartTotal()}
                  </Typography>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full min-w-max table-auto text-left">
                  <thead>
                    <tr>
                      <th className="border-b border-blue-gray-100 bg-blue-gray-50 p-3">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none">
                          Molecule
                        </Typography>
                      </th>
                      <th className="border-b border-blue-gray-100 bg-blue-gray-50 p-3">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none">
                          Amount
                        </Typography>
                      </th>
                      <th className="border-b border-blue-gray-100 bg-blue-gray-50 p-3">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none">
                          Price/mg
                        </Typography>
                      </th>
                      <th className="border-b border-blue-gray-100 bg-blue-gray-50 p-3">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none">
                          Total
                        </Typography>
                      </th>
                      <th className="border-b border-blue-gray-100 bg-blue-gray-50 p-3">
                        <Typography variant="small" color="blue-gray" className="font-bold leading-none">
                          Actions
                        </Typography>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item, index) => {
                      const isLast = index === cart.length - 1;
                      const classes = isLast ? "p-3" : "p-3 border-b border-blue-gray-50";
                      
                      return (
                        <tr key={item.id}>
                          <td className={classes}>
                            <div className="flex flex-col">
                              <Typography variant="small" color="blue-gray" className="font-medium">
                                {item.name}
                              </Typography>
                              <Typography variant="small" color="gray" className="text-xs">
                                ID: {item.moleculeId}
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
                            <Typography variant="small" color="green" className="font-bold">
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
          <Card className="mx-4 mb-4">
            <div className="p-4 bg-white">
              <div className="text-center py-8">
                <Typography variant="small" color="gray">
                  No SDF data available. Click "Test SDF" or load an SDF file to see docking results.
                </Typography>
              </div>
            </div>
          </Card>
        )}
        
        {/* Loading State */}
        {isLoading && (
          <Card className="mx-4 mb-4">
            <div className="p-4 bg-white">
              <div className="flex items-center justify-center gap-2 py-8">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <Typography variant="small" color="gray">
                  Loading SDF data...
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
