import React, { useState } from "react";
import { API_CONFIG } from "@/utils/constants";

const ENTITY_COLORS = {
  protein: { border: "border-blue-400", bg: "bg-blue-50", label: "bg-blue-500", text: "Protein" },
  dna: { border: "border-green-400", bg: "bg-green-50", label: "bg-green-500", text: "DNA" },
  rna: { border: "border-orange-400", bg: "bg-orange-50", label: "bg-orange-500", text: "RNA" },
  ligand: { border: "border-purple-400", bg: "bg-purple-50", label: "bg-purple-500", text: "Ligand" },
};

const CHAIN_IDS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function getNextChainId(entities) {
  const used = new Set(entities.map((e) => e.id));
  return CHAIN_IDS.find((c) => !used.has(c)) || "A";
}

function createEntity(type, id) {
  const base = { type, id };
  if (type === "protein") return { ...base, sequence: "", msaEnabled: false, msaCsv: "" };
  if (type === "dna" || type === "rna") return { ...base, sequence: "" };
  if (type === "ligand") return { ...base, ligandMode: "ccd", ccdCode: "", smiles: "" };
  return base;
}

const ProteinFolding = () => {
  const [requestId, setRequestId] = useState("prediction-1");
  const [outputFormat, setOutputFormat] = useState("pdb");
  const [entities, setEntities] = useState([
    createEntity("protein", "A"),
    createEntity("dna", "B"),
    createEntity("dna", "C"),
  ]);
  const [addType, setAddType] = useState("protein");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const updateEntity = (index, field, value) => {
    setEntities((prev) => prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)));
  };

  const removeEntity = (index) => {
    setEntities((prev) => prev.filter((_, i) => i !== index));
  };

  const addEntity = () => {
    const id = getNextChainId(entities);
    setEntities((prev) => [...prev, createEntity(addType, id)]);
  };

  const buildRequestBody = () => {
    const molecules = entities.map((entity) => {
      const mol = { type: entity.type, id: entity.id };

      if (entity.type === "protein") {
        mol.sequence = entity.sequence;
        if (entity.msaEnabled && entity.msaCsv.trim()) {
          mol.msa = {
            main_db: {
              csv: {
                alignment: entity.msaCsv,
                format: "csv",
              },
            },
          };
        }
      } else if (entity.type === "dna" || entity.type === "rna") {
        mol.sequence = entity.sequence;
      } else if (entity.type === "ligand") {
        if (entity.ligandMode === "ccd") {
          mol.ccd_code = entity.ccdCode;
        } else {
          mol.smiles = entity.smiles;
        }
      }

      return mol;
    });

    return {
      request_id: requestId,
      inputs: [
        {
          input_id: requestId,
          molecules,
          output_format: outputFormat,
        },
      ],
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    const body = buildRequestBody();

    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(API_CONFIG.buildApiUrl("/openfold3/predict"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(
          errData?.details?.detail ||
            errData?.error ||
            `HTTP error ${response.status}`
        );
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getResultText = () => {
    if (!result) return "";
    if (typeof result === "string") return result;
    // The API may return the structure inside an output field or as nested JSON
    if (result.output) return typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);
    if (result.outputs && Array.isArray(result.outputs) && result.outputs.length > 0) {
      const out = result.outputs[0];
      if (out.output) return typeof out.output === "string" ? out.output : JSON.stringify(out.output, null, 2);
      if (out.pdb_string) return out.pdb_string;
      if (out.mmcif_string) return out.mmcif_string;
      return JSON.stringify(out, null, 2);
    }
    return JSON.stringify(result, null, 2);
  };

  const handleDownload = () => {
    const text = getResultText();
    const ext = outputFormat === "pdb" ? "pdb" : "cif";
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${requestId}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 w-full bg-white rounded shadow">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column - Input Form */}
        <div>
          <h2 className="text-2xl font-bold mb-2">Protein Folding - OpenFold3</h2>
          <p className="text-sm text-gray-600 mb-6">
            Predict 3D structures of biomolecular complexes (proteins, DNA, RNA, ligands) using
            NVIDIA NIM OpenFold3. OpenFold3 is a third-generation biomolecular foundation model
            and a PyTorch re-implementation of AlphaFold3.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Request ID + Output Format */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Request ID</label>
                <input
                  type="text"
                  value={requestId}
                  onChange={(e) => setRequestId(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="e.g. 5GNJ"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Output Format</label>
                <select
                  value={outputFormat}
                  onChange={(e) => setOutputFormat(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                >
                  <option value="pdb">PDB</option>
                  <option value="mmcif">mmCIF</option>
                </select>
              </div>
            </div>

            {/* Entities */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Molecular Entities ({entities.length})
              </label>

              <div className="space-y-4">
                {entities.map((entity, idx) => {
                  const colors = ENTITY_COLORS[entity.type];
                  return (
                    <div
                      key={idx}
                      className={`border-2 ${colors.border} ${colors.bg} rounded-lg p-4 relative`}
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between mb-3">
                        <span
                          className={`${colors.label} text-white text-xs font-bold px-2 py-1 rounded`}
                        >
                          {colors.text}
                        </span>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1">
                            <label className="text-xs font-medium text-gray-600">Chain ID:</label>
                            <input
                              type="text"
                              value={entity.id}
                              onChange={(e) =>
                                updateEntity(idx, "id", e.target.value.toUpperCase().slice(0, 1))
                              }
                              className="w-10 border border-gray-300 rounded px-2 py-1 text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                              maxLength={1}
                            />
                          </div>
                          {entities.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeEntity(idx)}
                              className="text-red-400 hover:text-red-600 transition-colors"
                              title="Remove entity"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-5 w-5"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Protein fields */}
                      {entity.type === "protein" && (
                        <>
                          <div className="mb-3">
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Amino Acid Sequence
                            </label>
                            <textarea
                              value={entity.sequence}
                              onChange={(e) => updateEntity(idx, "sequence", e.target.value.replace(/\s/g, ""))}
                              className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-400"
                              rows={3}
                              placeholder="e.g. MGREEPLNHVEAERQRREKLNQRFYALRAVVPNVSKMDKASLLGDAI..."
                              required
                            />
                          </div>
                          <div className="mb-2">
                            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={entity.msaEnabled}
                                onChange={(e) => updateEntity(idx, "msaEnabled", e.target.checked)}
                                className="rounded"
                              />
                              <span className="font-medium">Include MSA alignment (optional)</span>
                            </label>
                          </div>
                          {entity.msaEnabled && (
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">
                                MSA Alignment (CSV format)
                              </label>
                              <textarea
                                value={entity.msaCsv}
                                onChange={(e) => updateEntity(idx, "msaCsv", e.target.value)}
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-400"
                                rows={3}
                                placeholder={"key,sequence\n-1,MGREEPLNHVEAERQR..."}
                              />
                            </div>
                          )}
                        </>
                      )}

                      {/* DNA / RNA fields */}
                      {(entity.type === "dna" || entity.type === "rna") && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            {entity.type === "dna" ? "DNA" : "RNA"} Sequence
                          </label>
                          <textarea
                            value={entity.sequence}
                            onChange={(e) => updateEntity(idx, "sequence", e.target.value.replace(/\s/g, ""))}
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-400"
                            rows={2}
                            placeholder={
                              entity.type === "dna"
                                ? "e.g. AGGAACACGTGACCC"
                                : "e.g. AGUUCGCAUGGCUAA"
                            }
                            required
                          />
                        </div>
                      )}

                      {/* Ligand fields */}
                      {entity.type === "ligand" && (
                        <>
                          <div className="flex gap-4 mb-3">
                            <label className="flex items-center gap-1 text-xs cursor-pointer">
                              <input
                                type="radio"
                                name={`ligand-mode-${idx}`}
                                checked={entity.ligandMode === "ccd"}
                                onChange={() => updateEntity(idx, "ligandMode", "ccd")}
                              />
                              <span className="font-medium text-gray-600">CCD Code</span>
                            </label>
                            <label className="flex items-center gap-1 text-xs cursor-pointer">
                              <input
                                type="radio"
                                name={`ligand-mode-${idx}`}
                                checked={entity.ligandMode === "smiles"}
                                onChange={() => updateEntity(idx, "ligandMode", "smiles")}
                              />
                              <span className="font-medium text-gray-600">SMILES</span>
                            </label>
                          </div>
                          {entity.ligandMode === "ccd" ? (
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">
                                CCD Code
                              </label>
                              <input
                                type="text"
                                value={entity.ccdCode}
                                onChange={(e) => updateEntity(idx, "ccdCode", e.target.value.toUpperCase())}
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400"
                                placeholder="e.g. ATP"
                                required
                              />
                            </div>
                          ) : (
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">
                                SMILES String
                              </label>
                              <input
                                type="text"
                                value={entity.smiles}
                                onChange={(e) => updateEntity(idx, "smiles", e.target.value)}
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400"
                                placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O"
                                required
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add Entity */}
              {entities.length < 26 && (
                <div className="flex items-center gap-2 mt-4">
                  <select
                    value={addType}
                    onChange={(e) => setAddType(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="protein">Protein</option>
                    <option value="dna">DNA</option>
                    <option value="rna">RNA</option>
                    <option value="ligand">Ligand</option>
                  </select>
                  <button
                    type="button"
                    onClick={addEntity}
                    className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm font-medium transition-colors"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Add Entity
                  </button>
                </div>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Predicting Structure...
                </span>
              ) : (
                "Predict Structure"
              )}
            </button>
          </form>

          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700 font-medium">Error</p>
              <p className="text-sm text-red-600 mt-1">{error}</p>
            </div>
          )}
        </div>

        {/* Right Column - Results */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Prediction Results</h3>

          {!loading && !result && !error && (
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-12 w-12 mx-auto mb-3 opacity-50"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                />
              </svg>
              <p className="text-sm">
                Configure your molecular entities and click "Predict Structure" to get results.
              </p>
              <p className="text-xs mt-1">
                Prediction may take up to 5 minutes depending on complexity.
              </p>
            </div>
          )}

          {loading && (
            <div className="border border-blue-200 bg-blue-50 rounded-lg p-8 text-center">
              <svg
                className="animate-spin h-10 w-10 text-blue-500 mx-auto mb-3"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <p className="text-sm font-medium text-blue-700">Predicting structure...</p>
              <p className="text-xs text-blue-500 mt-1">
                This may take several minutes. The model is running on NVIDIA DGX Cloud.
              </p>
            </div>
          )}

          {result && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-green-600 font-medium">
                  Prediction complete
                </span>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Download .{outputFormat === "pdb" ? "pdb" : "cif"}
                </button>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <pre className="bg-gray-900 text-green-300 text-xs p-4 overflow-auto whitespace-pre font-mono" style={{ maxHeight: "600px" }}>
                  {getResultText()}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProteinFolding;
