import React, { useEffect, useRef, useState } from 'react';
import SmilesDrawer from 'smiles-drawer';

const ProfessionalMoleculeViewer = ({ 
  smiles = '', 
  width = 400, 
  height = 300,
  theme = 'light'
}) => {
  const canvasRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!smiles || !canvasRef.current) return;

    try {
      setError(null);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Clean the SMILES string
      const cleanSmiles = smiles.trim().replace(/\s+/g, '');
      console.log('ProfessionalMoleculeViewer attempting to parse:', cleanSmiles);
      
      // Configure SMILES drawer with more tolerant settings
      const drawer = new SmilesDrawer.Drawer({
        width: width,
        height: height,
        bondThickness: 2.0,
        bondLength: 15,
        shortBondLength: 0.8,
        bondSpacing: 0.18 * 15,
        atomVisualization: 'default',
        isomeric: false,  // Try without stereochemistry first
        debug: false,
        padding: 20.0,
        fontSizeLarge: 11,
        fontSizeSmall: 6,
        fontFamily: 'Arial, Helvetica, sans-serif',
        themes: {
          light: {
            C: '#909090',
            N: '#0000FF',
            O: '#FF0000',
            S: '#FFFF00',
            P: '#FFA500',
            F: '#00FF00',
            Cl: '#00FF00',
            Br: '#A52A2A',
            I: '#800080',
            H: '#FFFFFF'
          }
        }
      });

      // Parse SMILES and draw with better error handling
      try {
        SmilesDrawer.parse(cleanSmiles, function(tree) {
          try {
            // Apply coordinates and draw
            drawer.draw(tree, canvas, theme, false);
            console.log('Successfully rendered SMILES:', cleanSmiles);
          } catch (drawError) {
            console.error('Draw error:', drawError);
            throw drawError;
          }
        }, function(parseError) {
          console.error('SMILES parsing error for:', cleanSmiles, parseError);
          throw new Error('Parse failed: ' + parseError);
        });
      } catch (smilesError) {
        console.error('SmilesDrawer error:', smilesError);
        throw smilesError;
      }

    } catch (err) {
      console.error('ProfessionalMoleculeViewer error for SMILES:', smiles, err);
      setError('Cannot render: ' + smiles.substring(0, 20) + '...');
      
      // Draw error message
      const ctx = canvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#666';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Structure not available', width / 2, height / 2 - 10);
      ctx.fillText('SMILES: ' + smiles.substring(0, 15) + '...', width / 2, height / 2 + 10);
    }
  }, [smiles, width, height, theme]);

  if (!smiles) {
    return (
      <div 
        className="flex items-center justify-center bg-gray-50 border border-gray-300 rounded-lg"
        style={{ width, height }}
      >
        <p className="text-gray-500">Enter a SMILES to view the molecule</p>
      </div>
    );
  }

  return (
    <div className="molecule-viewer">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="border border-gray-300 rounded-lg bg-white"
        style={{ 
          width: `${width}px`, 
          height: `${height}px`,
          imageRendering: 'crisp-edges'
        }}
      />
      {error && (
        <div className="mt-2 text-red-600 text-sm">
          {error}
        </div>
      )}
    </div>
  );
};

export default ProfessionalMoleculeViewer;
