import React, { useState, useRef, useEffect } from "react";
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
    // Initialize RDKit with improved error handling
    const initRDKit = async () => {
      try {
        setRdkitStatus('loading');
        console.log('Attempting to initialize RDKit...');
        
        if (window.initRDKitModule) {
          const rdkit = await window.initRDKitModule();
          rdkitRef.current = rdkit;
          setRdkitReady(true);
          setRdkitStatus('ready');
          console.log('RDKit initialized successfully');
        } else {
          console.warn('RDKit module not available');
          setRdkitStatus('error');
        }
      } catch (error) {
        console.error('Failed to load RDKit:', error);
        console.log('Will use PubChem fallback for molecular structure generation');
        setRdkitReady(false);
        setRdkitStatus('error');
      } finally {
        // Always initialize the 3D viewer regardless of RDKit status
        setTimeout(initializeViewer, 500);
      }
    };

    // Add delay to ensure DOM is ready
    setTimeout(initRDKit, 1000);
  }, []);

  // Check for DiffDock results from localStorage
  useEffect(() => {
    const checkDiffDockResult = () => {
      try {
        const diffDockResultStr = localStorage.getItem('diffdock_result');
        const diffDockPdbId = localStorage.getItem('diffdock_pdb_id');
        const diffDockLigandId = localStorage.getItem('diffdock_ligand_id');
        
        if (diffDockResultStr) {
          console.log('DiffDock result found in localStorage');
          const diffDockData = JSON.parse(diffDockResultStr);
          console.log('DiffDock data:', diffDockData);
          console.log('PDB ID:', diffDockPdbId);
          console.log('Ligand ID:', diffDockLigandId);
          
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
          
          console.log('Found structure data:', !!structureData);
          console.log('Found SMILES data:', smilesData);
          
          if (structureData) {
            // If we have structure data, render it directly
            console.log('Rendering structure data...');
            setCurrentSmiles(diffDockLigandId || 'DiffDock Result');
            
            setTimeout(() => {
              if (viewer3dRef.current) {
                try {
                  viewer3dRef.current.clear();
                  // Try different format types
                  const formats = ['sdf', 'pdb', 'mol'];
                  let rendered = false;
                  
                  for (const format of formats) {
                    try {
                      viewer3dRef.current.addModel(structureData, format);
                      viewer3dRef.current.setStyle({}, getStyleConfig());
                      viewer3dRef.current.zoomTo();
                      viewer3dRef.current.render();
                      rendered = true;
                      console.log(`Successfully rendered as ${format}`);
                      break;
                    } catch (e) {
                      console.log(`Failed to render as ${format}:`, e.message);
                      viewer3dRef.current.clear();
                    }
                  }
                  
                  if (!rendered) {
                    setError('Could not render DiffDock structure data');
                  }
                } catch (err) {
                  console.error('Error rendering:', err);
                  setError(`Failed to render DiffDock result: ${err.message}`);
                }
              } else {
                console.error('Viewer not initialized');
                setError('3D viewer not initialized');
              }
            }, 1500);
          } else if (smilesData) {
            // If we have SMILES, use the existing visualization function
            console.log('Using SMILES:', smilesData);
            setSmilesInput(smilesData);
            setTimeout(() => {
              visualizeMolecule();
            }, 1500);
          } else {
            // No recognizable data format
            console.error('DiffDock result does not contain recognizable structure data');
            console.log('Available keys:', Object.keys(diffDockData));
            setError('DiffDock result does not contain structure data. Check console for details.');
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
    
    // Check after a delay to ensure viewer is initialized
    setTimeout(checkDiffDockResult, 2000);
  }, []);

  const initializeViewer = () => {
    if (viewerRef.current && window.$3Dmol) {
      viewer3dRef.current = window.$3Dmol.createViewer(viewerRef.current, {
        backgroundColor: backgroundColor,
        antialias: true,
        width: "100%",
        height: "100%",
      });
    }
  };

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

  const visualizeMolecule = async () => {
    if (!smilesInput.trim()) {
      setError("Please enter a SMILES string");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      let molData = null;
      
      // Try RDKit.js first if available
      if (rdkitReady && rdkitRef.current) {
        try {
          console.log('Processing SMILES with RDKit...');
          const mol = rdkitRef.current.get_mol(smilesInput);
          if (mol && mol.is_valid() !== 0) {
            molData = mol.get_molblock();
            setCurrentSmiles(smilesInput);
            mol.delete();
            console.log('Successfully processed with RDKit');
          } else {
            console.log('RDKit could not process this SMILES, trying PubChem...');
            if (mol) mol.delete(); // Clean up invalid molecule
          }
        } catch (rdkitError) {
          console.log('RDKit processing failed:', rdkitError.message);
          console.log('Falling back to PubChem...');
        }
      } else {
        console.log('RDKit not ready, using PubChem directly...');
      }

      // Fallback to PubChem if RDKit failed or unavailable
      if (!molData) {
        console.log('Fetching structure from PubChem...');
        
        try {
          // Try to get CID from SMILES
          const cidResponse = await fetch(
            `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smilesInput)}/cids/JSON`
          );
          
          if (cidResponse.ok) {
            const cidData = await cidResponse.json();
            const cid = cidData.IdentifierList.CID[0];
            
            // Try to get 3D structure
            const sdfResponse = await fetch(
              `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=3d`
            );
            
            if (sdfResponse.ok) {
              molData = await sdfResponse.text();
              setCurrentSmiles(smilesInput);
              console.log('Successfully fetched 3D structure from PubChem');
            } else {
              // Try 2D structure as fallback
              const sdf2dResponse = await fetch(
                `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF`
              );
              
              if (sdf2dResponse.ok) {
                molData = await sdf2dResponse.text();
                setCurrentSmiles(smilesInput);
                console.log('Successfully fetched 2D structure from PubChem');
              }
            }
          }
        } catch (pubchemError) {
          console.error('PubChem API error:', pubchemError);
          // Try alternative approach using NCI CACTUS
          try {
            const response = await fetch(
              `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(smilesInput)}/sdf`
            );
            if (response.ok) {
              molData = await response.text();
              setCurrentSmiles(smilesInput);
              console.log('Successfully fetched structure from NCI CACTUS');
            }
          } catch (cactusError) {
            console.error('CACTUS API error:', cactusError);
          }
        }
      }

      if (!molData) {
        throw new Error("Could not generate 3D structure for this molecule. Please check the SMILES string or try a different molecule.");
      }

      // Render the molecule
      if (viewer3dRef.current) {
        viewer3dRef.current.clear();
        viewer3dRef.current.addModel(molData, "sdf");
        viewer3dRef.current.setStyle({}, getStyleConfig());
        viewer3dRef.current.zoomTo();
        viewer3dRef.current.render();
      }

    } catch (error) {
      console.error('Visualization error:', error);
      setError(`Failed to visualize molecule: ${error.message}`);
    } finally {
      setIsLoading(false);
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
    let mimeType = "text/plain";

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
  };

  return (
    <div className="mt-12">
      <div className="mb-12 grid gap-y-10 gap-x-6 md:grid-cols-1">
        <Card>
          <CardHeader variant="gradient" color="gray" className="mb-8 p-6">
            <Typography variant="h6" color="white">
              <BeakerIcon className="inline w-5 h-5 mr-2" />
              Molecular Viewer - 3D Visualization Platform
            </Typography>
          </CardHeader>
          <CardBody className="px-6 pt-0 pb-6">
            <Tabs value={activeTab}>
              <TabsHeader>
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
                <TabPanel value="visualizer" className="p-0 pt-4">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Input Panel */}
                    <div className="lg:col-span-1 space-y-4">
                      <div>
                        <Typography variant="h6" className="mb-2" as="div">
                          SMILES Input
                        </Typography>
                        <Input
                          size="lg"
                          label="Enter SMILES string"
                          value={smilesInput}
                          onChange={(e) => setSmilesInput(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && visualizeMolecule()}
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
                          onClick={visualizeMolecule}
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
                        >
                          <TrashIcon className="w-4 h-4" />
                        </IconButton>
                        
                        <IconButton
                          size="sm"
                          variant="outlined"
                          onClick={toggleFullscreen}
                          title="Toggle fullscreen"
                        >
                          <ArrowsPointingOutIcon className="w-4 h-4" />
                        </IconButton>
                        
                        <IconButton
                          size="sm"
                          variant="outlined"
                          onClick={() => exportMolecule("smiles")}
                          title="Export SMILES"
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
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
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
                    <div className="lg:col-span-2">
                      <div 
                        ref={viewerRef}
                        className="w-full h-96 lg:h-[500px] border border-gray-200 rounded-lg bg-white relative overflow-hidden"
                        style={{ backgroundColor: backgroundColor }}
                      >
                        {!currentSmiles && (
                          <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                            <div className="text-center">
                              <BeakerIcon className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                              <Typography variant="h6" color="gray" as="div">
                                Enter a SMILES string to visualize
                              </Typography>
                              <Typography variant="small" color="gray" as="div">
                                3D molecular structure will appear here
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
                      <Card key={index} className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setExampleMolecule(mol.smiles)}>
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
                      </Card>
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
                      It supports various molecular representations and can export structures in multiple formats.
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