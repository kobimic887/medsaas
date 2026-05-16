import React, { useState } from "react";
import { API_CONFIG } from "@/utils/constants";
const GenerateMolecules = () => {
  // State for form inputs
  const [smiles, setSmiles] = useState("");
  const [minSimilarity, setMinSimilarity] = useState(0.7);
  const [numMolecules, setNumMolecules] = useState(10);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch(API_CONFIG.buildApiUrl("/generate-molecules"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smiles,
          minSimilarity,
          numMolecules,
        }),
      });
      if (!response.ok) throw new Error("API error");
      const data = await response.json();

      // Normalize results into an array of SMILES strings when possible
      let molecules = [];
      if (Array.isArray(data)) {
        molecules = data;
      } else if (data.molecules && Array.isArray(data.molecules)) {
        molecules = data.molecules;
      } else if (data.molecules && typeof data.molecules === 'string') {
        try {
          const parsed = JSON.parse(data.molecules);
          if (Array.isArray(parsed)) molecules = parsed;
        } catch (e) {
          // keep as string fallback
          molecules = [data.molecules];
        }
      } else if (data.results && Array.isArray(data.results)) {
        molecules = data.results;
      } else if (data.results && typeof data.results === 'string') {
        try {
          const parsed = JSON.parse(data.results);
          if (Array.isArray(parsed)) molecules = parsed;
        } catch (e) {
          molecules = [data.results];
        }
      } else if (data.smiles) {
        molecules = Array.isArray(data.smiles) ? data.smiles : [data.smiles];
      } else if (typeof data === "string") {
        molecules = [data];
      } else {
        // Fallback: stringify full response
        molecules = [JSON.stringify(data)];
      }

      setResults(molecules);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 w-full bg-white rounded shadow">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-2xl font-bold mb-4">Generate Molecules</h2>
          <div className="mb-4 text-sm text-gray-700">
            <strong>Description:</strong>
            <p className="mt-2">
              MolMIM generates a random sample of new molecules in SMILES
              format by sampling from the latent space around the point
              corresponding to the given seed molecule. MolMIM performs
              optimization with the CMA-ES algorithm in the model’s latent
              space and samples molecules with improved values of the desired
              scoring function.
            </p>

            <p className="mt-2">
              MolMIM is a latent variable model developed by NVIDIA that is
              trained in an unsupervised manner over a large-scale dataset of
              molecules in the form of SMILES strings. MolMIM utilizes
              transformer architecture to learn an informative fixed-size
              latent space using Mutual Information Machine (MIM) learning.
              MIM is a learning framework for a latent variable model which
              promotes informative and clustered latent codes. MolMIM can be
              used for sampling novel molecules from the model’s latent space.
            </p>

            <p className="mt-2">
              <strong>Reference(s):</strong>
              <br />
              Improving Small Molecule Generation using Mutual Information
              Machine
              <br />
              MIM: Mutual Information Machine
              <br />
              The CMA Evolution Strategy: A Comparing Review
            </p>

            <p className="mt-2">
              <strong>Model Architecture:</strong>
              <br />
              Architecture Type: Encoder-Decoder
              <br />
              Architecture: Perceiver encoder, Transformer decoder
              <br />
              MolMIM utilizes a Perceiver encoder architecture which outputs a
              fixed-size representation, where molecules of various lengths are
              mapped into a latent space. MolMIM’s decoder architecture is a
              Transformer. Both encoder and decoder contain 6 layers with a
              hidden size of 512, 8 attention heads, and a feed-forward
              dimension of 2048. Total number of parameters in MolMIM is
              65.2M. The model was trained with A-MIM learning.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block font-medium mb-1">SMILES</label>
              <input
                type="text"
                value={smiles}
                onChange={(e) => setSmiles(e.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="Enter SMILES string"
                required
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Minimum Similarity</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={minSimilarity}
                onChange={(e) => setMinSimilarity(parseFloat(e.target.value))}
                className="w-full border rounded px-3 py-2"
                required
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Number of Molecules</label>
              <input
                type="number"
                min="1"
                max="100"
                value={numMolecules}
                onChange={(e) => setNumMolecules(parseInt(e.target.value))}
                className="w-full border rounded px-3 py-2"
                required
              />
            </div>
            <button
              type="submit"
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              disabled={loading}
            >
              {loading ? "Generating..." : "Generate"}
            </button>
          </form>
          {error && <div className="mt-4 text-red-600">Error: {error}</div>}
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-3">Results</h3>
          {loading && !results && <div className="text-sm text-gray-500">Waiting for results...</div>}
          {!loading && results && results.length === 0 && (
            <div className="text-sm text-gray-500">No molecules returned.</div>
          )}

          <div className="overflow-x-auto">
            {results && results.length > 0 && (typeof results[0] === 'object' && (results[0].sample || results[0].smiles || results[0].score !== undefined)) ? (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Structure</th>
                     <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Score</th>  
                     <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">SMILES</th>                 
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {results.map((item, idx) => {
                    const smilesStr = (item && (item.sample || item.smiles)) || (typeof item === 'string' ? item : JSON.stringify(item));
                    const score = item && (item.score ?? item.scoring ?? item.value);
                    const imgUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smilesStr)}/PNG?record_type=2d&image_size=200x150`;
                    return (
                      <tr key={`row-${idx}`}>
                        <td className="px-4 py-3 align-top">
                          <div className="border border-gray-300 rounded overflow-hidden bg-white" style={{ width: '200px', height: '150px' }}>
                            <img
                              src={imgUrl}
                              alt={`structure-${idx}`}
                              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                              onError={(e) => {
                                // Retry logic for failed image loads (400 status)
                                const maxRetries = 5;
                                let retryCount = parseInt(e.target.getAttribute('data-retry-count') || '0', 10);
                                if (!e.target.getAttribute('data-retry-timer')) {
                                  e.target.setAttribute('data-retry-timer', '1');
                                }
                                // Only retry for 400 status images (PubChem returns blank PNG)
                                if (retryCount < maxRetries) {
                                  setTimeout(() => {
                                    retryCount++;
                                    e.target.setAttribute('data-retry-count', retryCount);
                                    // Try reloading the image
                                    e.target.src = `${imgUrl}?retry=${retryCount}`;
                                  }, 1000);
                                  return;
                                }
                                // Fallback logic after retries
                                if (!e.target.getAttribute('data-fallback-attempted')) {
                                  e.target.setAttribute('data-fallback-attempted', '1');
                                  const simplifiedSmiles = smilesStr.replace(/[^\w\[\]()@=#+\-\/\\]/g, '');
                                  if (simplifiedSmiles !== smilesStr) {
                                    e.target.src = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(simplifiedSmiles)}/PNG?record_type=2d&image_size=200x150`;
                                    return;
                                  }
                                }
                                if (e.target.getAttribute('data-fallback-attempted') === '1') {
                                  e.target.setAttribute('data-fallback-attempted', '2');
                                  e.target.src = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smilesStr)}/PNG?image_size=small`;
                                  return;
                                }
                                e.target.style.display = 'none';
                                if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                              }}
                            />
                            <div className="flex items-center justify-center bg-gray-50 text-gray-500 text-sm w-full h-full" style={{ display: 'none' }}>
                              <div className="text-center">
                                <div>Structure Preview</div>
                                <div className="text-xs mt-1">Service Unavailable</div>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">{score !== undefined && score !== null ? Number(score).toFixed(4) : '-'}</td>                
                        <td className="px-4 py-3 align-top break-words" style={{maxWidth: '40%'}}>{smilesStr}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <div className="space-y-3">
                {results && results.map((smi, idx) => {
                  const smilesStr = typeof smi === 'string' ? smi : (smi.smiles || JSON.stringify(smi));
                  const imgUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smilesStr)}/PNG?record_type=2d&image_size=200x150`;
                  return (
                    <div key={`${idx}-${smilesStr}`} className="flex items-center gap-3 border rounded p-2">
                      <div className="border border-gray-300 rounded overflow-hidden bg-white" style={{ width: '200px', height: '150px' }}>
                        <img src={imgUrl} alt={`structure-${idx}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => {
                          // Retry logic for failed image loads (400 status)
                          const maxRetries = 5;
                          let retryCount = parseInt(e.target.getAttribute('data-retry-count') || '0', 10);
                          if (!e.target.getAttribute('data-retry-timer')) {
                            e.target.setAttribute('data-retry-timer', '1');
                          }
                          if (retryCount < maxRetries) {
                            setTimeout(() => {
                              retryCount++;
                              e.target.setAttribute('data-retry-count', retryCount);
                              e.target.src = `${imgUrl}?retry=${retryCount}`;
                            }, 1000);
                            return;
                          }
                          // Fallback logic after retries
                          if (!e.target.getAttribute('data-fallback-attempted')) {
                            e.target.setAttribute('data-fallback-attempted', '1');
                            const simplifiedSmiles = smilesStr.replace(/[^\w\[\]()@=#+\-\/\\]/g, '');
                            if (simplifiedSmiles !== smilesStr) {
                              e.target.src = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(simplifiedSmiles)}/PNG?record_type=2d&image_size=200x150`;
                              return;
                            }
                          }
                          if (e.target.getAttribute('data-fallback-attempted') === '1') {
                            e.target.setAttribute('data-fallback-attempted', '2');
                            e.target.src = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smilesStr)}/PNG?image_size=small`;
                            return;
                          }
                          e.target.style.display = 'none';
                          if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                        }} />
                        <div className="flex items-center justify-center bg-gray-50 text-gray-500 text-sm w-full h-full" style={{ display: 'none' }}>
                          <div className="text-center">
                            <div>Structure Preview</div>
                            <div className="text-xs mt-1">Service Unavailable</div>
                          </div>
                        </div>
                      </div>
                      <div className="text-sm break-words">{smilesStr}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GenerateMolecules;
