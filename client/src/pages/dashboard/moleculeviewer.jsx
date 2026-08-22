import { useState, useRef, useEffect } from "react";

/**
 * Load 3Dmol.js on demand, from our own origin.
 *
 * It used to be a plain <script> in index.html pointing at
 * `https://3dmol.csb.pitt.edu/build/3Dmol-min.js`. Two problems with that. It is
 * 524 KB downloaded on *every* page — sign-in included — while this component is
 * the only thing in the app that touches `window.$3Dmol`. And it is a university
 * web server with no version in the URL: when that host is slow or down, the
 * molecule viewer is simply broken, and the version can change underneath us
 * without warning.
 *
 * Now vendored at client/public/3dmol (v2.5.2, license text alongside it) and
 * fetched only when the viewer actually mounts. Served from our own origin it
 * gets the same gzip and long-lived caching as everything else.
 */
let threeDmolPromise = null;
function load3Dmol() {
  if (window.$3Dmol) return Promise.resolve(window.$3Dmol);
  if (threeDmolPromise) return threeDmolPromise;
  threeDmolPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/3dmol/3Dmol-min.js';
    script.async = true;
    script.onload = () => {
      if (window.$3Dmol) resolve(window.$3Dmol);
      else reject(new Error('3Dmol loaded but did not define window.$3Dmol'));
    };
    script.onerror = () => reject(new Error('Failed to load /3dmol/3Dmol-min.js'));
    document.head.appendChild(script);
  }).catch((error) => {
    // Clear the cache so a later mount can retry rather than reusing the rejection.
    threeDmolPromise = null;
    throw error;
  });
  return threeDmolPromise;
}
import {
  Card,
  CardHeader,
  CardBody,
  Typography,
  Input,
  Button,
  Select,
  Option,
  IconButton,
  Tabs,
  TabsHeader,
  TabsBody,
  Tab,
  TabPanel,
} from "@material-tailwind/react";
import {
  PlayIcon,
  ArrowsPointingOutIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  Cog6ToothIcon,
  EyeIcon,
  BeakerIcon,
  CheckIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

export function MoleculeViewer() {
  const [smilesInput, setSmilesInput] = useState("CCO");
  const [currentSmiles, setCurrentSmiles] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("visualizer");
  const [representationStyle, setRepresentationStyle] = useState("stick");
  const [colorScheme, setColorScheme] = useState("default");
  const [backgroundColor, setBackgroundColor] = useState("white");
  
  const viewerRef = useRef(null);
  const viewer3dRef = useRef(null);
  const pendingMolDataRef = useRef(null);
  const visualizationControllerRef = useRef(null);
  const rdkitRef = useRef(null);
  const [rdkitReady, setRdkitReady] = useState(false);
  const [rdkitStatus, setRdkitStatus] = useState('loading'); // 'loading', 'ready', 'error'

  // Predefined molecule examples
  const exampleMolecules = [
    { name: "Ethanol", smiles: "CCO", category: "Simple" },
    { name: "Caffeine", smiles: "CN1C=NC2=C1C(=O)N(C(=O)N2C)C", category: "Alkaloid" },
    { name: "Aspirin", smiles: "CC(=O)OC1=CC=CC=C1C(=O)O", category: "Drug" },
    { name: "Ibuprofen", smiles: "CC(C)CC1=CC=C(C=C1)C(C)C(=O)O", category: "Drug" },
    { name: "Benzene", smiles: "C1=CC=CC=C1", category: "Aromatic" },
    { name: "Glucose", smiles: "C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O)O)O)O)O", category: "Sugar" },
    { name: "Cholesterol", smiles: "CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C", category: "Steroid" },
    { name: "Morphine", smiles: "CN1CC[C@]23C4C1CC5=C2C(=C(C=C5)O)O[C@H]3[C@H](C=C4)O", category: "Alkaloid" },
  ];

  // Representation styles
  const representationStyles = [
    { value: "stick", label: "Stick" },
    { value: "sphere", label: "Space-filling" },
    { value: "cartoon", label: "Cartoon" },
    { value: "line", label: "Line" },
    { value: "cross", label: "Cross" },
  ];

  // Color schemes
  const colorSchemes = [
    { value: "default", label: "CPK Colors" },
    { value: "carbon", label: "Carbon Gray" },
    { value: "chainHetatm", label: "Chain Colors" },
    { value: "amino", label: "Amino Colors" },
    { value: "residue", label: "Residue Colors" },
  ];

  useEffect(() => {
    let cancelled = false;

    // 3Dmol and RDKit are independent. Waiting for RDKit before starting the
    // viewer made the entire page inherit RDKit's load time and failure mode.
    const initViewer = async () => {
      try {
        const threeDmol = await load3Dmol();
        if (cancelled || !viewerRef.current) return;
        viewer3dRef.current = threeDmol.createViewer(viewerRef.current, {
          backgroundColor,
          antialias: true,
          width: "100%",
          height: "100%",
        });
        if (pendingMolDataRef.current) {
          const pending = pendingMolDataRef.current;
          pendingMolDataRef.current = null;
          renderStructure(pending.data, pending.formats);
        }
      } catch (viewerError) {
        if (!cancelled) {
          console.error('3D viewer unavailable:', viewerError);
          setError('The 3D viewer could not load. Reload the page and try again.');
        }
      }
    };

    const initRDKit = async () => {
      try {
        setRdkitStatus('loading');

        // window.loadRDKit is the loader in client/index.html. It used to be called
        // window.initRDKitModule — the same name RDKit_minimal.js assigns — so this
        // call resolved against the wrapper or the bundle depending on which script
        // landed second. Renaming removed the collision.
        const load = window.loadRDKit || window.initRDKitModule;
        if (typeof load === 'function') {
          const rdkit = await load();
          if (cancelled) return;
          rdkitRef.current = rdkit;
          setRdkitReady(true);
          setRdkitStatus('ready');
        } else {
          if (!cancelled) setRdkitStatus('error');
        }
      } catch (rdkitError) {
        if (!cancelled) {
          console.warn('RDKit unavailable; using remote structure fallback:', rdkitError);
          setRdkitReady(false);
          setRdkitStatus('error');
        }
      }
    };

    initViewer();
    initRDKit();

    return () => {
      cancelled = true;
      visualizationControllerRef.current?.abort();
      visualizationControllerRef.current = null;
      viewer3dRef.current?.clear();
      viewer3dRef.current = null;
    };
  }, []);

  // Check for DiffDock results from localStorage
  useEffect(() => {
    const checkDiffDockResult = () => {
      try {
        const diffDockResultStr = localStorage.getItem('diffdock_result');
        const diffDockLigandId = localStorage.getItem('diffdock_ligand_id');
        
        if (diffDockResultStr) {
          const diffDockData = JSON.parse(diffDockResultStr);
          
          // Try multiple possible keys for structure data
          let structureData = null;
          let smilesData = null;
          
          // Check all possible structure formats
          if (diffDockData.sdf) structureData = diffDockData.sdf;
          else if (diffDockData.structure) structureData = diffDockData.structure;
          else if (diffDockData.pdb) structureData = diffDockData.pdb;
          else if (diffDockData.mol) structureData = diffDockData.mol;
          else if (diffDockData.result && typeof diffDockData.result === 'string') structureData = diffDockData.result;
          
          // Check for SMILES
          if (diffDockData.smiles) smilesData = diffDockData.smiles;
          else if (diffDockData.ligand_smiles) smilesData = diffDockData.ligand_smiles;
          else if (diffDockData.ligand) smilesData = diffDockData.ligand;
          
          if (structureData) {
            setCurrentSmiles(diffDockLigandId || 'DiffDock Result');
            renderStructure(structureData, ['sdf', 'pdb', 'mol']);
          } else if (smilesData) {
            setSmilesInput(smilesData);
            visualizeMolecule(smilesData);
          } else {
            setError('The saved DiffDock result does not contain recognizable structure data.');
          }
          
          // Clear the localStorage after loading
          localStorage.removeItem('diffdock_result');
          localStorage.removeItem('diffdock_pdb_id');
          localStorage.removeItem('diffdock_ligand_id');
          localStorage.removeItem('diffdock_timestamp');
        }
      } catch (error) {
        console.error('Error loading DiffDock result:', error);
        setError(`Error loading DiffDock result: ${error.message}`);
      }
    };
    
    checkDiffDockResult();
  }, []);

  const getStyleConfig = () => {
    const baseStyle = {};
    
    switch (representationStyle) {
      case "stick":
        baseStyle.stick = { radius: 0.15, colorscheme: colorScheme };
        baseStyle.sphere = { scale: 0.25, colorscheme: colorScheme };
        break;
      case "sphere":
        baseStyle.sphere = { scale: 0.4, colorscheme: colorScheme };
        break;
      case "line":
        baseStyle.line = { colorscheme: colorScheme };
        break;
      case "cross":
        baseStyle.cross = { radius: 0.1, colorscheme: colorScheme };
        break;
      case "cartoon":
        baseStyle.cartoon = { colorscheme: colorScheme };
        break;
      default:
        baseStyle.stick = { radius: 0.15, colorscheme: colorScheme };
    }
    
    return baseStyle;
  };

  const renderStructure = (molData, formats = ['sdf']) => {
    if (!viewer3dRef.current) {
      pendingMolDataRef.current = { data: molData, formats };
      return false;
    }
    for (const format of formats) {
      try {
        viewer3dRef.current.clear();
        viewer3dRef.current.addModel(molData, format);
        viewer3dRef.current.setStyle({}, getStyleConfig());
        viewer3dRef.current.zoomTo();
        viewer3dRef.current.render();
        return true;
      } catch (renderError) {
        console.warn(`Could not render molecular data as ${format}:`, renderError);
      }
    }
    viewer3dRef.current.clear();
    viewer3dRef.current.render();
    setError('The molecular structure was returned but could not be rendered.');
    return false;
  };

  const visualizeMolecule = async (requestedInput = smilesInput) => {
    const requestedSmiles = typeof requestedInput === 'string'
      ? requestedInput.trim()
      : smilesInput.trim();
    if (!requestedSmiles) {
      setError("Please enter a SMILES string");
      return;
    }

    visualizationControllerRef.current?.abort();
    const controller = new AbortController();
    visualizationControllerRef.current = controller;
    const timeoutId = window.setTimeout(() => {
      controller.abort(new DOMException('Structure lookup timed out', 'TimeoutError'));
    }, 15000);

    setIsLoading(true);
    setError("");

    try {
      let molData = null;
      
      // Try RDKit.js first if available
      if (rdkitReady && rdkitRef.current) {
        try {
          const mol = rdkitRef.current.get_mol(requestedSmiles);
          if (mol && mol.is_valid() !== 0) {
            molData = mol.get_molblock();
            mol.delete();
          } else {
            if (mol) mol.delete(); // Clean up invalid molecule
          }
        } catch (rdkitError) {
          console.warn('RDKit could not process this SMILES; trying PubChem:', rdkitError);
        }
      }

      // Fallback to PubChem if RDKit failed or unavailable
      if (!molData) {
        try {
          // Try to get CID from SMILES
          const cidResponse = await fetch(
            `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(requestedSmiles)}/cids/JSON`,
            { signal: controller.signal }
          );
          
          if (cidResponse.ok) {
            const cidData = await cidResponse.json();
            const cid = cidData.IdentifierList.CID[0];
            
            // Try to get 3D structure
            const sdfResponse = await fetch(
              `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=3d`,
              { signal: controller.signal }
            );
            
            if (sdfResponse.ok) {
              molData = await sdfResponse.text();
            } else {
              // Try 2D structure as fallback
              const sdf2dResponse = await fetch(
                `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF`,
                { signal: controller.signal }
              );
              
              if (sdf2dResponse.ok) {
                molData = await sdf2dResponse.text();
              }
            }
          }
        } catch (pubchemError) {
          if (pubchemError.name === 'AbortError' || pubchemError.name === 'TimeoutError') {
            throw pubchemError;
          }
          console.warn('PubChem lookup failed; trying NCI CACTUS:', pubchemError);
        }

        // PubChem can return a normal non-2xx response for a valid molecule it
        // does not contain, so CACTUS is a fallback for both HTTP and network failures.
        if (!molData) {
          try {
            const response = await fetch(
              `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(requestedSmiles)}/sdf`,
              { signal: controller.signal }
            );
            if (response.ok) {
              molData = await response.text();
            }
          } catch (cactusError) {
            if (cactusError.name === 'AbortError' || cactusError.name === 'TimeoutError') {
              throw cactusError;
            }
            console.warn('NCI CACTUS lookup failed:', cactusError);
          }
        }
      }

      if (!molData) {
        throw new Error("Could not generate 3D structure for this molecule. Please check the SMILES string or try a different molecule.");
      }

      setCurrentSmiles(requestedSmiles);
      renderStructure(molData);

    } catch (error) {
      if (error.name === 'AbortError') return;
      if (error.name === 'TimeoutError') {
        setError('The structure lookup timed out. Check the SMILES and try again.');
      } else {
        console.error('Visualization error:', error);
        setError(`Failed to visualize molecule: ${error.message}`);
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (visualizationControllerRef.current === controller) {
        visualizationControllerRef.current = null;
        setIsLoading(false);
      }
    }
  };

  const updateVisualization = () => {
    if (viewer3dRef.current && currentSmiles) {
      viewer3dRef.current.setStyle({}, getStyleConfig());
      viewer3dRef.current.setBackgroundColor(backgroundColor);
      viewer3dRef.current.render();
    }
  };

  useEffect(() => {
    updateVisualization();
  }, [representationStyle, colorScheme, backgroundColor]);

  const exportMolecule = (format) => {
    if (!currentSmiles) {
      setError("No molecule to export. Please visualize a molecule first.");
      return;
    }

    let content = "";
    let filename = "";
    const mimeType = "text/plain";

    switch (format) {
      case "smiles":
        content = currentSmiles;
        filename = "molecule.smi";
        break;
      case "png":
        // For PNG export, we'd need to capture the canvas
        if (viewer3dRef.current) {
          const canvas = viewer3dRef.current.getCanvas();
          canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "molecule.png";
            a.click();
            URL.revokeObjectURL(url);
          });
          return;
        }
        break;
      default:
        return;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearViewer = () => {
    visualizationControllerRef.current?.abort();
    visualizationControllerRef.current = null;
    pendingMolDataRef.current = null;
    setIsLoading(false);
    setSmilesInput("");
    setCurrentSmiles("");
    setError("");
    if (viewer3dRef.current) {
      viewer3dRef.current.clear();
      viewer3dRef.current.render();
    }
  };

  const toggleFullscreen = () => {
    if (viewerRef.current) {
      if (!document.fullscreenElement) {
        viewerRef.current.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    }
  };

  const setExampleMolecule = (smiles) => {
    setSmilesInput(smiles);
    setActiveTab('visualizer');
    visualizeMolecule(smiles);
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] py-2">
      <div className="w-full">
        <Card
          shadow={false}
          className="overflow-hidden rounded-2xl border border-blue-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900"
        >
          <CardHeader
            floated={false}
            shadow={false}
            className="m-0 rounded-none border-b border-blue-gray-100 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <Typography variant="h6" color="blue-gray" className="flex items-center gap-2 dark:text-slate-100">
              <BeakerIcon className="h-5 w-5 text-brand-600 dark:text-brand-300" aria-hidden="true" />
              Molecular Viewer
            </Typography>
            <Typography variant="small" color="gray" className="mt-1 dark:text-slate-400">
              Generate and inspect an interactive 3D structure from a SMILES string.
            </Typography>
          </CardHeader>
          <CardBody className="p-4 sm:p-5">
            <Tabs value={activeTab}>
              <TabsHeader className="rounded-lg bg-blue-gray-50/70 p-1 dark:bg-slate-800">
                <Tab value="visualizer" onClick={() => setActiveTab("visualizer")}>
                  <EyeIcon className="w-5 h-5 mr-2" />
                  Visualizer
                </Tab>
                <Tab value="examples" onClick={() => setActiveTab("examples")}>
                  <BeakerIcon className="w-5 h-5 mr-2" />
                  Examples
                </Tab>
                <Tab value="settings" onClick={() => setActiveTab("settings")}>
                  <Cog6ToothIcon className="w-5 h-5 mr-2" />
                  Settings
                </Tab>
              </TabsHeader>
              <TabsBody>
                <TabPanel value="visualizer" className="p-0 pt-3">
                  <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,2fr)]">
                    {/* Input Panel */}
                    <div className="min-w-0 space-y-4">
                      <div>
                        <Typography variant="h6" className="mb-2" as="div">
                          SMILES Input
                        </Typography>
                        <Input
                          size="lg"
                          label="Enter SMILES string"
                          value={smilesInput}
                          onChange={(e) => setSmilesInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && visualizeMolecule()}
                        />
                        
                        {/* RDKit Status Indicator */}
                        <div className="flex items-center gap-2 mt-2">
                          {rdkitStatus === 'loading' && (
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                              <span className="text-sm text-gray-600">Loading RDKit...</span>
                            </div>
                          )}
                          {rdkitStatus === 'ready' && (
                            <div className="flex items-center gap-2">
                              <CheckIcon className="w-4 h-4 text-green-500" />
                              <span className="text-sm text-green-600">RDKit ready</span>
                            </div>
                          )}
                          {rdkitStatus === 'error' && (
                            <div className="flex items-center gap-2">
                              <ExclamationTriangleIcon className="w-4 h-4 text-orange-500" />
                              <span className="text-sm text-orange-600">Using fallback mode</span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          color="blue"
                          onClick={() => visualizeMolecule()}
                          disabled={isLoading}
                          className="flex items-center gap-2"
                        >
                          <PlayIcon className="w-4 h-4" />
                          {isLoading ? "Processing..." : "Visualize"}
                        </Button>
                        
                        <IconButton
                          size="sm"
                          variant="outlined"
                          onClick={clearViewer}
                          title="Clear viewer"
                          aria-label="Clear viewer"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </IconButton>
                        
                        <IconButton
                          size="sm"
                          variant="outlined"
                          onClick={toggleFullscreen}
                          title="Toggle fullscreen"
                          aria-label="Toggle fullscreen"
                        >
                          <ArrowsPointingOutIcon className="w-4 h-4" />
                        </IconButton>
                        
                        <IconButton
                          size="sm"
                          variant="outlined"
                          onClick={() => exportMolecule("smiles")}
                          title="Export SMILES"
                          aria-label="Export SMILES"
                        >
                          <ArrowDownTrayIcon className="w-4 h-4" />
                        </IconButton>
                      </div>

                      {error && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                          <Typography variant="small" color="red" as="div">
                            {error}
                          </Typography>
                        </div>
                      )}

                      {currentSmiles && (
                        <div className="bg-brand-50 border border-brand-200 rounded-lg p-3">
                          <Typography variant="small" className="font-medium" as="div">
                            Current molecule:
                          </Typography>
                          <Typography variant="small" className="font-mono text-xs break-all" as="div">
                            {currentSmiles}
                          </Typography>
                        </div>
                      )}
                    </div>

                    {/* 3D Viewer Panel */}
                    <div className="min-w-0">
                      <div
                        ref={viewerRef}
                        className="relative z-0 h-[clamp(22rem,48vh,31rem)] w-full overflow-hidden rounded-xl border border-blue-gray-200 bg-white dark:border-slate-700"
                        style={{ backgroundColor: backgroundColor }}
                      >
                        {!currentSmiles && (
                          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50/95 px-6 text-center dark:bg-slate-950/95">
                            <div>
                              <BeakerIcon className="mx-auto mb-4 h-12 w-12 text-blue-gray-300 dark:text-slate-600" aria-hidden="true" />
                              <Typography variant="h6" color="blue-gray" as="div" className="dark:text-slate-200">
                                Your molecular workspace is ready
                              </Typography>
                              <Typography variant="small" color="gray" as="div" className="mx-auto mt-1 max-w-sm dark:text-slate-400">
                                Enter a SMILES string on the left and select Visualize to render its 3D structure here.
                              </Typography>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </TabPanel>

                <TabPanel value="examples" className="p-0 pt-4">
                  <Typography variant="h6" className="mb-4" as="div">
                    Example Molecules
                  </Typography>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {exampleMolecules.map((mol, index) => (
                      <button
                        type="button"
                        key={index}
                        className="rounded-xl border border-blue-gray-100 bg-white text-left transition-colors hover:border-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500"
                        onClick={() => setExampleMolecule(mol.smiles)}
                        aria-label={`Visualize ${mol.name}`}
                      >
                        <CardBody className="p-4">
                          <Typography variant="h6" className="mb-1" as="div">
                            {mol.name}
                          </Typography>
                          <Typography variant="small" color="gray" className="mb-2" as="div">
                            {mol.category}
                          </Typography>
                          <Typography variant="small" className="font-mono text-xs break-all bg-gray-100 p-2 rounded" as="div">
                            {mol.smiles}
                          </Typography>
                        </CardBody>
                      </button>
                    ))}
                  </div>
                </TabPanel>

                <TabPanel value="settings" className="p-0 pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <Typography variant="h6" className="mb-3" as="div">
                        Representation Style
                      </Typography>
                      <Select
                        value={representationStyle}
                        onChange={(value) => setRepresentationStyle(value)}
                      >
                        {representationStyles.map((style) => (
                          <Option key={style.value} value={style.value}>
                            {style.label}
                          </Option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <Typography variant="h6" className="mb-3" as="div">
                        Color Scheme
                      </Typography>
                      <Select
                        value={colorScheme}
                        onChange={(value) => setColorScheme(value)}
                      >
                        {colorSchemes.map((scheme) => (
                          <Option key={scheme.value} value={scheme.value}>
                            {scheme.label}
                          </Option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <Typography variant="h6" className="mb-3" as="div">
                        Background Color
                      </Typography>
                      <Select
                        value={backgroundColor}
                        onChange={(value) => setBackgroundColor(value)}
                      >
                        <Option value="white">White</Option>
                        <Option value="black">Black</Option>
                        <Option value="#f0f0f0">Light Gray</Option>
                        <Option value="#333333">Dark Gray</Option>
                      </Select>
                    </div>
                  </div>

                  <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                    <Typography variant="h6" className="mb-2" as="div">
                      About this Viewer
                    </Typography>
                    <Typography variant="small" color="gray" as="div">
                      This molecular viewer uses 3Dmol.js for 3D visualization and RDKit.js for SMILES processing. 
                      It supports several molecular representations and exports the selected SMILES string.
                      For molecules not available through RDKit, we fallback to PubChem's 3D structure service.
                    </Typography>
                  </div>
                </TabPanel>
              </TabsBody>
            </Tabs>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default MoleculeViewer;
