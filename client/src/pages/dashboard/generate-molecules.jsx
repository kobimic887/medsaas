import { useEffect, useRef, useState } from "react";
import { API_CONFIG, getAuthToken } from "@/utils/constants";

const showStructurePreviewFallback = (event, smiles) => {
  const image = event.currentTarget;
  if (!image.dataset.fallbackAttempted) {
    image.dataset.fallbackAttempted = "true";
    image.src = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/PNG?image_size=small`;
    return;
  }

  image.style.display = "none";
  if (image.nextElementSibling) image.nextElementSibling.style.display = "flex";
};

const GenerateMolecules = () => {
  // State for form inputs
  const [smiles, setSmiles] = useState("");
  const [minSimilarity, setMinSimilarity] = useState(0.7);
  const [numMolecules, setNumMolecules] = useState(10);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const requestControllerRef = useRef(null);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResults(null);
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      const token = getAuthToken();
      const response = await fetch(API_CONFIG.buildApiUrl("/generate-molecules"), {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          smiles,
          minSimilarity,
          numMolecules,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.details?.detail ||
            data?.details ||
            data?.error ||
            `Molecule generation failed (HTTP ${response.status})`
        );
      }

      // Normalize results into an array of SMILES strings when possible
      let molecules = [];
      if (Array.isArray(data)) {
        molecules = data;
      } else if (data?.molecules && Array.isArray(data.molecules)) {
        molecules = data.molecules;
      } else if (data?.molecules && typeof data.molecules === 'string') {
        try {
          const parsed = JSON.parse(data.molecules);
          if (Array.isArray(parsed)) molecules = parsed;
        } catch (_e) {
          // keep as string fallback
          molecules = [data.molecules];
        }
      } else if (data?.results && Array.isArray(data.results)) {
        molecules = data.results;
      } else if (data?.results && typeof data.results === 'string') {
        try {
          const parsed = JSON.parse(data.results);
          if (Array.isArray(parsed)) molecules = parsed;
        } catch (_e) {
          molecules = [data.results];
        }
      } else if (data?.smiles) {
        molecules = Array.isArray(data.smiles) ? data.smiles : [data.smiles];
      } else if (typeof data === "string") {
        molecules = [data];
      } else {
        // Fallback: stringify full response
        molecules = [JSON.stringify(data)];
      }

      setResults(molecules);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  return (
    <div className="w-full rounded bg-white p-6 shadow dark:bg-slate-900 dark:text-slate-100">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-2xl font-bold mb-4">Generate Molecules</h2>
          <div className="mb-4 text-sm text-gray-700 dark:text-slate-300">
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
              <label className="block font-medium mb-1" htmlFor="gen-smiles">SMILES</label>
              <input
                id="gen-smiles"
                type="text"
                value={smiles}
                onChange={(e) => setSmiles(e.target.value)}
                className="w-full rounded border px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                placeholder="Enter SMILES string"
                required
              />
            </div>
            <div>
              <label className="block font-medium mb-1" htmlFor="gen-min-similarity">Minimum Similarity</label>
              <input
                id="gen-min-similarity"
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={minSimilarity}
                onChange={(e) => setMinSimilarity(parseFloat(e.target.value))}
                className="w-full rounded border px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                required
              />
            </div>
            <div>
              <label className="block font-medium mb-1" htmlFor="gen-num-molecules">Number of Molecules</label>
              <input
                id="gen-num-molecules"
                type="number"
                min="1"
                max="100"
                value={numMolecules}
                onChange={(e) => setNumMolecules(parseInt(e.target.value, 10))}
                className="w-full rounded border px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                required
              />
            </div>
            <button
              type="submit"
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              disabled={loading}
            >
              {loading ? "Generating…" : "Generate"}
            </button>
          </form>
          {error && <div className="mt-4 text-red-600">Error: {error}</div>}
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-3">Results</h3>
          {loading && !results && <div className="text-sm text-gray-500 dark:text-slate-400">Waiting for results…</div>}
          {!loading && results && results.length === 0 && (
            <div className="text-sm text-gray-500 dark:text-slate-400">No molecules returned.</div>
          )}

          <div className="overflow-x-auto">
            {results && results.length > 0 && (typeof results[0] === 'object' && (results[0].sample || results[0].smiles || results[0].score !== undefined)) ? (
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Structure</th>
                     <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Score</th>  
                     <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-slate-400">SMILES</th>                 
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white dark:divide-slate-700 dark:bg-slate-900">
                  {results.map((item, idx) => {
                    const smilesStr = (item && (item.sample || item.smiles)) || (typeof item === 'string' ? item : JSON.stringify(item));
                    const score = item && (item.score ?? item.scoring ?? item.value);
                    const imgUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smilesStr)}/PNG?record_type=2d&image_size=200x150`;
                    return (
                      <tr key={`row-${idx}`}>
                        <td className="px-4 py-3 align-top">
                          <div className="overflow-hidden rounded border border-gray-300 bg-white dark:border-slate-700 dark:bg-slate-800" style={{ width: '200px', height: '150px' }}>
                            <img
                              src={imgUrl}
                              alt={`Generated molecule ${idx + 1} structure`}
                              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                              onError={(event) => showStructurePreviewFallback(event, smilesStr)}
                            />
                            <div className="flex items-center justify-center bg-gray-50 text-gray-500 text-sm w-full h-full" style={{ display: 'none' }}>
                              <div className="text-center">
                                <div>Structure Preview</div>
                                <div className="text-xs mt-1">Service Unavailable</div>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top tabular-nums">{score !== undefined && score !== null ? Number(score).toFixed(4) : '-'}</td>                
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
                    <div key={`${idx}-${smilesStr}`} className="flex items-center gap-3 rounded border p-2 dark:border-slate-700">
                      <div className="overflow-hidden rounded border border-gray-300 bg-white dark:border-slate-700 dark:bg-slate-800" style={{ width: '200px', height: '150px' }}>
                        <img
                          src={imgUrl}
                          alt={`Generated molecule ${idx + 1} structure`}
                          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                          onError={(event) => showStructurePreviewFallback(event, smilesStr)}
                        />
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
