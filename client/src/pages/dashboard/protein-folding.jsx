import { useEffect, useRef, useState } from "react";
import ProteinFoldViewer from "@/components/ProteinFoldViewer";
import FoldHistoryPanel from "@/components/folding/FoldHistoryPanel";
import { buildFoldRequest, foldStructures } from "@/utils/openfold";
import { API_CONFIG, getAuthToken } from "@/utils/constants";
import { withAppBase } from "@/utils/appEnv";
import { FOLDING_INPUT_SAMPLES, FOLDING_STRUCTURE_SAMPLES } from "@/data/foldingSamples";

const ENTITY_COLORS = {
  protein: { border: "border-blue-400", bg: "bg-blue-50 dark:bg-blue-950/40", label: "bg-blue-500", text: "Protein" },
  dna: { border: "border-green-400", bg: "bg-green-50 dark:bg-green-950/40", label: "bg-green-500", text: "DNA" },
  rna: { border: "border-orange-400", bg: "bg-orange-50 dark:bg-orange-950/40", label: "bg-orange-500", text: "RNA" },
  ligand: { border: "border-purple-400", bg: "bg-purple-50 dark:bg-purple-950/40", label: "bg-purple-500", text: "Ligand" },
};

const CHAIN_IDS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const MAX_MSA_TO_SAVE = 200_000; // keep saved history small: skip giant alignments on reuse

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

/** Shape a sample/manifest entity into a full form entity. */
function materializeEntity(entity) {
  const type = String(entity?.type || "protein");
  const id = String(entity?.id || getNextChainId([])).toUpperCase().slice(0, 1) || "A";
  const out = createEntity(type, id);
  if (type === "protein") {
    out.sequence = entity.sequence || "";
    const msaCsv = (entity.msaCsv || "").trim();
    // A custom alignment that was too large to store is never re-enabled
    // empty on reuse — that would make the next submit fail validation.
    if (entity.msaEnabled && msaCsv) {
      out.msaEnabled = true;
      out.msaCsv = msaCsv;
    }
  } else if (type === "dna" || type === "rna") {
    out.sequence = entity.sequence || "";
  } else if (type === "ligand") {
    out.ligandMode = entity.ligandMode === "smiles" ? "smiles" : "ccd";
    out.ccdCode = entity.ccdCode || "";
    out.smiles = entity.smiles || "";
  }
  return out;
}

function entityTypeLabel(entity) {
  return ENTITY_COLORS[entity.type]?.text || entity.type;
}

function entityLengthLabel(entity) {
  if (entity.type === "protein") return `${(entity.sequence || "").length} aa`;
  if (entity.type === "dna" || entity.type === "rna") return `${(entity.sequence || "").length} nt`;
  if (entity.type === "ligand") {
    const value = entity.ligandMode === "ccd" ? entity.ccdCode : entity.smiles;
    return value ? value.length : "—";
  }
  return "";
}

function summarizeEntities(entities) {
  return entities.map((e) => `${e.id} ${entityTypeLabel(e).toLowerCase()} (${entityLengthLabel(e)})`).join(", ");
}

function apiHeaders(jsonBody) {
  const token = getAuthToken();
  return {
    ...(jsonBody ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

const FINITE_SCORE_LABELS = [
  ["confidence_score", "Confidence"],
  ["complex_plddt_score", "Complex pLDDT"],
  ["ptm_score", "pTM"],
  ["iptm_score", "ipTM"],
];

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    }, { once: true });
  });
}

const ProteinFolding = () => {
  const [mode, setMode] = useState("single"); // "single" | "complex"
  const [requestId, setRequestId] = useState("prediction-1");
  const [runName, setRunName] = useState("");
  const [outputFormat, setOutputFormat] = useState("pdb");
  const [entities, setEntities] = useState([createEntity("protein", "A")]);
  const [addType, setAddType] = useState("protein");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sampleNotice, setSampleNotice] = useState("");

  const [result, setResult] = useState(null); // array of { text, format, name, scores }
  const [resultMeta, setResultMeta] = useState(null);
  const [selectedStructure, setSelectedStructure] = useState(0);
  const [showViewer, setShowViewer] = useState(false);

  // Save state is advisory only: a failed save NEVER discards a usable result.
  const [saveState, setSaveState] = useState("idle"); // idle|saving|saved|failed
  const [saveMessage, setSaveMessage] = useState("");
  const requestControllerRef = useRef(null);
  const cancelRequestedRef = useRef(false);

  // Server-owned environment facts (demo mode / history availability). Null on
  // the live product, where /api/staging/status does not exist.
  const [envStatus, setEnvStatus] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(API_CONFIG.buildApiUrl("/staging/status"), {
          signal: controller.signal,
          headers: apiHeaders(),
        });
        if (response.ok) {
          const data = await response.json();
          setEnvStatus(data.demo ? data : { demo: false, historyAvailable: false });
        } else {
          setEnvStatus({ demo: false, historyAvailable: false });
        }
      } catch {
        setEnvStatus({ demo: false, historyAvailable: false });
      } finally {
        // no further state depends on the probe completing
      }
    })();
    return () => {
      controller.abort();
      requestControllerRef.current?.abort();
    };
  }, []);

  const historyAvailable = envStatus?.historyAvailable === true;
  const isDemo = envStatus?.demo === true;

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

  // Switching the guided mode never clears typed inputs — it only changes the
  // guidance and the validation rules shown below the entity list.
  const resetEntitiesForMode = (nextMode) => {
    setMode(nextMode);
    setError(null);
  };

  // ---- Inline validation (before submission; inputs are never cleared) ------
  const formIssues = [];
  const seenIds = new Set();
  entities.forEach((entity, index) => {
    const id = String(entity.id || "").toUpperCase().trim();
    if (!id) {
      formIssues.push(`Chain ${index + 1} is missing a chain ID.`);
      return;
    }
    if (seenIds.has(id)) {
      formIssues.push(`Chain ID "${id}" is used more than once — each chain needs a unique ID.`);
    }
    seenIds.add(id);
    if (entity.type === "protein" || entity.type === "dna" || entity.type === "rna") {
      if (!(entity.sequence || "").trim()) {
        formIssues.push(`Chain ${id} (${entityTypeLabel(entity)}) has no sequence.`);
      } else if (entity.type === "protein" && entity.msaEnabled && !(entity.msaCsv || "").trim()) {
        formIssues.push(`Chain ${id}: custom alignment is enabled but empty.`);
      }
    } else if (entity.type === "ligand") {
      const value = (entity.ligandMode === "ccd" ? entity.ccdCode : entity.smiles || "").trim();
      if (!value) formIssues.push(`Chain ${id} (ligand) is missing its ${entity.ligandMode === "ccd" ? "CCD code" : "SMILES"}.`);
    }
  });
  if (mode === "single" && entities.length !== 1) {
    formIssues.push("Single-protein mode predicts exactly one protein chain — remove the extra chains or switch to “Complex prediction”.");
  }

  const submitSnapshot = () => ({
    requestId: requestId.trim() || "prediction",
    outputFormat,
    runName: runName.trim() || `${requestId.trim() || "prediction"}`,
    entities: entities.map((e) => {
      const copy = { ...e };
      if (copy.msaCsv && copy.msaCsv.length > MAX_MSA_TO_SAVE) copy.msaCsv = undefined;
      return copy;
    }),
  });

  const autosaveResult = async (structures, meta) => {
    if (!historyAvailable) {
      setSaveState("idle");
      return;
    }
    setSaveState("saving");
    setSaveMessage("");
    const payload = {
      name: meta.name,
      provider: meta.provider,
      providerVersion: meta.providerVersion || null,
      source: meta.source,
      demo: meta.demo === true,
      request: {
        requestId: meta.requestId,
        outputFormat: meta.outputFormat,
        entities: meta.entities || [],
      },
      structures: structures.map((s) => ({ name: s.name, format: s.format, text: s.text })),
      scoreKeys: meta.scoreKeys || [],
    };
    try {
      const response = await fetch(API_CONFIG.buildApiUrl("/folding-history"), {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        setSaveState("saved");
        setSaveMessage("Saved to your history.");
      } else {
        // The prediction itself succeeded — keep the result fully usable and
        // say exactly what happened. Never tell the user to rerun to save.
        setSaveState("failed");
        setSaveMessage(`Result is ready but could not be saved: ${body?.error || `HTTP ${response.status}`}`);
      }
    } catch (err) {
      setSaveState("failed");
      setSaveMessage(`Result is ready but could not be saved: ${err.message}`);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formIssues.length) {
      setError(formIssues.join(" "));
      return;
    }
    const snapshot = submitSnapshot();
    let body;
    try {
      body = buildFoldRequest(snapshot.entities, snapshot.requestId, snapshot.outputFormat);
    } catch (err) {
      setError(err.message);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setResultMeta(null);
    setShowViewer(false);
    setSelectedStructure(0);
    setSaveState("idle");
    setSaveMessage("");

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    cancelRequestedRef.current = false;

    try {
      if (isDemo) {
        // Demo only: a short cancellable pause so the loading/cancel states are
        // actually visible. No fake progress percentages — the spinner just
        // shows the request is in flight.
        try {
          await sleep(700 + Math.random() * 600, controller.signal);
        } catch (err) {
          if (err.name === "AbortError") {
            if (cancelRequestedRef.current) {
              setLoading(false);
              setError("Cancelled. This stopped the browser wait — on a live run a prediction already submitted to the service may still finish.");
            }
            return;
          }
          throw err;
        }
      }

      const response = await fetch(API_CONFIG.buildApiUrl("/openfold3/predict"), {
        method: "POST",
        signal: controller.signal,
        headers: apiHeaders(true),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.details?.detail || errData?.error || `HTTP error ${response.status}`);
      }
      const data = await response.json();
      if (controller.signal.aborted) return;
      const structures = foldStructures(data, body.inputs[0].output_format, body.request_id);
      if (!structures.length) {
        throw new Error("The service returned no predicted structures. Please retry or contact support.");
      }

      const demoOutput = data._pyxisDemo === true;
      const meta = {
        ...snapshot,
        demo: demoOutput,
        source: demoOutput ? "demo-predict" : "live-predict",
        provider: demoOutput ? "pyxis-staging-demo-fixture" : "openfold3-nvidia",
        providerVersion: demoOutput ? "1" : null,
        scoreKeys: FINITE_SCORE_LABELS.filter(([key]) => Number.isFinite(structures[0]?.scores?.[key])).map(([key]) => key),
      };
      setResult(structures);
      setResultMeta(meta);
      await autosaveResult(structures, meta);
    } catch (err) {
      if (err.name === "AbortError") {
        if (cancelRequestedRef.current) {
          setError("Cancelled. This stopped the browser wait — on a live run a prediction already submitted to the service may still finish.");
        }
        return;
      }
      setError(err.message);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleCancel = () => {
    cancelRequestedRef.current = true;
    requestControllerRef.current?.abort();
  };

  // ---- Sample inputs (guided presets) ---------------------------------------
  const loadInputSample = (sample) => {
    const nextEntities = sample.entities.map(materializeEntity);
    setMode(sample.mode === "single" ? "single" : "complex");
    setEntities(nextEntities);
    setRequestId(sample.requestId);
    setOutputFormat(sample.outputFormat || "pdb");
    setRunName(sample.name || "");
    setError(null);
    // A previous result (if any) is deliberately left untouched so the owner can
    // switch inputs without losing it.
    setSampleNotice(`Inputs loaded from the “${sample.title}” sample — nothing has been predicted. Your current result, if any, is unchanged.`);
  };

  // ---- Sample structures (viewer testing; NOT predictions) ------------------
  const loadStructureSample = async (sample) => {
    setLoading(true);
    setError(null);
    setSampleNotice("");
    try {
      const response = await fetch(withAppBase(`/folding-samples/${sample.fileName}`));
      if (!response.ok) throw new Error(`Could not load the sample structure (HTTP ${response.status}).`);
      const text = await response.text();
      if (!text.trim()) throw new Error("The sample structure file is empty.");
      const structures = [{ text, format: sample.format, name: sample.name, scores: {} }];
      const meta = {
        requestId: sample.id,
        outputFormat: sample.format,
        runName: sample.title,
        entities: [],
        demo: isDemo,
        source: "sample-structure",
        provider: "public-sample",
        providerVersion: "RCSB 1CRN",
        scoreKeys: [],
      };
      setResult(structures);
      setResultMeta(meta);
      setSelectedStructure(0);
      setShowViewer(false);
      setSaveState("idle");
      await autosaveResult(structures, meta);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ---- History reopen / reuse ------------------------------------------------
  const openHistoryRun = async (run) => {
    setLoading(true);
    setError(null);
    setSampleNotice("");
    try {
      const token = getAuthToken();
      const response = await fetch(API_CONFIG.buildApiUrl(`/folding-history/${run.runId}`), {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Could not open the run (HTTP ${response.status}).`);
      }
      const data = await response.json();
      const full = data.run;
      const structures = (full.structuresWithText || []).map((blob) => ({
        text: blob.text,
        format: blob.format,
        name: blob.name,
        scores: blob.scores || {},
      }));
      if (!structures.length) throw new Error("This saved run has no structures to display.");
      setResult(structures);
      setResultMeta({
        requestId: full.requestId,
        outputFormat: full.outputFormat,
        runName: full.name,
        entities: full.entities || [],
        demo: full.demo === true,
        source: full.source || "history",
        provider: full.provider,
        providerVersion: full.providerVersion,
        scoreKeys: full.scoreKeys || [],
        openedFromHistory: true,
      });
      setSelectedStructure(0);
      setShowViewer(false);
      setSaveState("saved");
      setSaveMessage("Opened from your saved history — no provider call was made and no prediction credit was used.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const reuseHistoryInputs = (run) => {
    // Starts a NEW editable request. The saved run stays untouched.
    const stored = Array.isArray(run.entities) && run.entities.length ? run.entities : null;
    const nextEntities = stored && stored.length ? stored.map(materializeEntity) : [createEntity("protein", "A")];
    setEntities(nextEntities);
    setMode(nextEntities.length === 1 && nextEntities[0].type === "protein" ? "single" : "complex");
    setRequestId(run.requestId || "prediction-1");
    setOutputFormat(run.outputFormat === "mmcif" ? "mmcif" : "pdb");
    setRunName(`${run.name} (copy)`);
    setError(null);
    setSaveState("idle");
    setSaveMessage("");
    setSampleNotice("Inputs copied into a new editable request. The saved run has not been changed — run a new prediction to save another result.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const currentStructure = result?.[selectedStructure];
  const handleDownload = () => {
    if (!currentStructure) return;
    const ext = currentStructure.format === "pdb" ? "pdb" : "cif";
    const blob = new Blob([currentStructure.text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentStructure.name}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resultIsExample = resultMeta?.source === "sample-structure" || resultMeta?.demo || resultMeta?.source === "demo-predict";
  const finiteScores = FINITE_SCORE_LABELS.filter(([key]) => Number.isFinite(currentStructure?.scores?.[key]));

  return (
    <div className="p-6 w-full rounded bg-white shadow dark:bg-slate-900 dark:text-slate-100">
      <h2 className="text-2xl font-bold mb-1">Protein Folding — OpenFold3</h2>
      <p className="mb-4 text-sm text-gray-600 dark:text-slate-400">
        Predict 3D structures of biomolecular complexes — single proteins, or complexes of
        proteins with DNA, RNA, ligands and additional chains — using NVIDIA NIM OpenFold3.
      </p>
      {isDemo && (
        <p role="note" className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <strong>Staging demo:</strong> “Predict” here returns a clearly-labelled demo fixture — no NVIDIA call, no credit, no cost.
          Sample structures below are example files for viewer testing.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ================= Left column: guided inputs ================= */}
        <div>
          {/* Mode guidance */}
          <fieldset className="mb-4">
            <legend className="text-sm font-medium mb-2">What are you predicting?</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className={`flex items-start gap-2 rounded-lg border-2 p-3 cursor-pointer ${mode === "single" ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40" : "border-gray-200 dark:border-slate-700"}`}>
                <input type="radio" name="fold-mode" className="mt-1" checked={mode === "single"} onChange={() => resetEntitiesForMode("single")} />
                <span>
                  <span className="block text-sm font-semibold">Single protein</span>
                  <span className="block text-xs text-gray-500 dark:text-slate-400">One protein chain — the fastest, simplest prediction.</span>
                </span>
              </label>
              <label className={`flex items-start gap-2 rounded-lg border-2 p-3 cursor-pointer ${mode === "complex" ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40" : "border-gray-200 dark:border-slate-700"}`}>
                <input type="radio" name="fold-mode" className="mt-1" checked={mode === "complex"} onChange={() => resetEntitiesForMode("complex")} />
                <span>
                  <span className="block text-sm font-semibold">Complex prediction</span>
                  <span className="block text-xs text-gray-500 dark:text-slate-400">Multiple chains: proteins, DNA, RNA and ligands together.</span>
                </span>
              </label>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
              {mode === "single"
                ? "Single-protein mode: one chain, any chain ID you like. Switch to Complex prediction to add DNA, RNA, ligands or a second protein chain."
                : "Complex mode: add the chains and molecules that assemble into the complex. Each chain needs a unique ID."}
            </p>
          </fieldset>

          {/* Sample inputs */}
          <div className="mb-5 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
            <p className="text-sm font-medium mb-2">Sample inputs to try</p>
            <div className="flex flex-wrap gap-2">
              {FOLDING_INPUT_SAMPLES.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => loadInputSample(sample)}
                  title={sample.summary}
                  className="rounded-full border border-brand-600 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:border-brand-500 dark:text-brand-300 dark:hover:bg-brand-950/40"
                >
                  {sample.title}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-400 dark:text-slate-500">
              These pre-fill the form — they are inputs, not results. Clicking one never predicts anything and never
              touches a result you already have.
            </p>
          </div>

          {sampleNotice && (
            <p role="status" className="mb-4 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
              {sampleNotice}
            </p>
          )}

          {/* Chain summary */}
          {entities.length > 0 && (
            <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">
              Chains: {summarizeEntities(entities)}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="pf-run-name">Run name <span className="text-gray-400 dark:text-slate-500">(history)</span></label>
                <input id="pf-run-name" type="text" value={runName} onChange={(e) => setRunName(e.target.value)} className="w-full border border-gray-300 rounded dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" placeholder="e.g. Crambin single chain" maxLength={120} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="pf-output-format">Output Format</label>
                <select id="pf-output-format" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} className="w-full border border-gray-300 rounded dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white dark:bg-slate-900">
                  <option value="pdb">PDB</option>
                  <option value="mmcif">mmCIF</option>
                </select>
              </div>
            </div>

            {/* Entities */}
            <div>
              <p className="block text-sm font-medium mb-2">
                Molecular Entities ({entities.length})
              </p>
              <div className="space-y-4">
                {entities.map((entity, idx) => {
                  const colors = ENTITY_COLORS[entity.type];
                  return (
                    <div key={idx} className={`border-2 ${colors.border} ${colors.bg} rounded-lg p-4 relative`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`${colors.label} text-white text-xs font-bold px-2 py-1 rounded`}>{colors.text}</span>
                          <span className="text-xs text-gray-500 dark:text-slate-400">{entityLengthLabel(entity)}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1">
                            <label className="text-xs font-medium text-gray-600 dark:text-slate-400" htmlFor={`pf-chain-${idx}`}>Chain ID:</label>
                            <input
                              id={`pf-chain-${idx}`}
                              type="text"
                              value={entity.id}
                              onChange={(e) => updateEntity(idx, "id", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 1))}
                              className="w-10 border border-gray-300 rounded dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 px-2 py-1 text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                              maxLength={1}
                              aria-label={`Chain ID for entity ${idx + 1}`}
                            />
                          </div>
                          {entities.length > 1 && (
                            <button type="button" onClick={() => removeEntity(idx)} className="text-red-400 hover:text-red-600 transition-colors" title="Remove entity" aria-label={`Remove chain ${entity.id || idx + 1}`}>
                              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>

                      {entity.type === "protein" && (
                        <>
                          <div className="mb-3">
                            <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1" htmlFor={`pf-aa-seq-${idx}`}>Amino Acid Sequence</label>
                            <textarea id={`pf-aa-seq-${idx}`} value={entity.sequence} onChange={(e) => updateEntity(idx, "sequence", e.target.value.replace(/\s/g, "").toUpperCase())} className="w-full border border-gray-300 rounded dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-400" rows={3} placeholder="e.g. MGREEPLNHVEAERQRREKLNQRFYALRAVVPNVSKMDKASLLGDAI…" />
                          </div>
                          <div className="mb-2">
                            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400 cursor-pointer">
                              <input type="checkbox" checked={entity.msaEnabled} onChange={(e) => updateEntity(idx, "msaEnabled", e.target.checked)} className="rounded" />
                              <span className="font-medium">Use a custom MSA alignment</span>
                            </label>
                          </div>
                          {!entity.msaEnabled && (
                            <p className="mb-2 text-xs text-gray-600 dark:text-slate-400">
                              Uses a <strong>query-only</strong> alignment: OpenFold3 aligns the single sequence you typed.
                              A <strong>custom alignment</strong> (below) adds related sequences and can improve prediction for
                              well-studied families, but is not required.
                            </p>
                          )}
                          {entity.msaEnabled && (
                            <div>
                              <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1" htmlFor={`pf-msa-${idx}`}>MSA Alignment (CSV format)</label>
                              <textarea id={`pf-msa-${idx}`} value={entity.msaCsv} onChange={(e) => updateEntity(idx, "msaCsv", e.target.value)} className="w-full border border-gray-300 rounded dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-400" rows={3} placeholder={"key,sequence\n-1,MGREEPLNHVEAERQR…"} />
                            </div>
                          )}
                        </>
                      )}

                      {(entity.type === "dna" || entity.type === "rna") && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1" htmlFor={`pf-na-seq-${idx}`}>
                            {entity.type === "dna" ? "DNA" : "RNA"} Sequence
                          </label>
                          <textarea id={`pf-na-seq-${idx}`} value={entity.sequence} onChange={(e) => updateEntity(idx, "sequence", e.target.value.replace(/\s/g, "").toUpperCase())} className="w-full border border-gray-300 rounded dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-400" rows={2} placeholder={entity.type === "dna" ? "e.g. AGGAACACGTGACCC" : "e.g. AGUUCGCAUGGCUAA"} />
                        </div>
                      )}

                      {entity.type === "ligand" && (
                        <>
                          <div className="flex gap-4 mb-3">
                            <label className="flex items-center gap-1 text-xs cursor-pointer">
                              <input type="radio" name={`ligand-mode-${idx}`} checked={entity.ligandMode === "ccd"} onChange={() => updateEntity(idx, "ligandMode", "ccd")} />
                              <span className="font-medium text-gray-600 dark:text-slate-400">CCD Code</span>
                            </label>
                            <label className="flex items-center gap-1 text-xs cursor-pointer">
                              <input type="radio" name={`ligand-mode-${idx}`} checked={entity.ligandMode === "smiles"} onChange={() => updateEntity(idx, "ligandMode", "smiles")} />
                              <span className="font-medium text-gray-600 dark:text-slate-400">SMILES</span>
                            </label>
                          </div>
                          {entity.ligandMode === "ccd" ? (
                            <div>
                              <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1" htmlFor={`pf-ccd-${idx}`}>CCD Code</label>
                              <input id={`pf-ccd-${idx}`} type="text" value={entity.ccdCode} onChange={(e) => updateEntity(idx, "ccdCode", e.target.value.toUpperCase())} className="w-full border border-gray-300 rounded dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400" placeholder="e.g. ATP" />
                            </div>
                          ) : (
                            <div>
                              <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1" htmlFor={`pf-smiles-${idx}`}>SMILES String</label>
                              <input id={`pf-smiles-${idx}`} type="text" value={entity.smiles} onChange={(e) => updateEntity(idx, "smiles", e.target.value)} className="w-full border border-gray-300 rounded dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400" placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O" />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {mode === "complex" && entities.length < 26 && (
                <div className="flex items-center gap-2 mt-4">
                  <label className="sr-only" htmlFor="pf-add-type">Entity type to add</label>
                  <select id="pf-add-type" value={addType} onChange={(e) => setAddType(e.target.value)} className="border border-gray-300 rounded dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="protein">Protein</option>
                    <option value="dna">DNA</option>
                    <option value="rna">RNA</option>
                    <option value="ligand">Ligand</option>
                  </select>
                  <button type="button" onClick={addEntity} className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm font-medium transition-colors dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                    Add chain
                  </button>
                </div>
              )}
            </div>

            {formIssues.length > 0 && (
              <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Check the inputs before predicting</p>
                <ul className="mt-1 list-inside list-disc text-sm text-amber-700 dark:text-amber-400">
                  {formIssues.map((issue, i) => <li key={i}>{issue}</li>)}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button type="submit" className="flex-1 bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed" disabled={loading}>
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg aria-hidden="true" className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {isDemo ? "Running demo prediction…" : "Predicting Structure…"}
                  </span>
                ) : (
                  isDemo ? "Run demo prediction (no NVIDIA call)" : "Predict Structure"
                )}
              </button>
              {loading && (
                <button type="button" onClick={handleCancel} className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                  Cancel
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 dark:text-slate-500">
              {isDemo
                ? "In this demo the request is answered locally with placeholder coordinates. Cancelling stops the browser wait — no service job exists to stop."
                : "Cancelling stops the browser wait only: a prediction already submitted to the service may still finish. A prediction can take a few minutes."}
            </p>
          </form>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
              <p className="text-sm font-medium text-red-700 dark:text-red-300">Error</p>
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* ================= Right column: results ================= */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Results</h3>

          {!loading && !result && !error && (
            <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center text-gray-400 dark:border-slate-700 dark:text-slate-500">
              <p className="text-sm">Set up your chains and click “Predict Structure” (or load a sample below) to get results.</p>
              <p className="text-xs mt-1">
                {isDemo
                  ? "In this demo environment predictions are local placeholder outputs, clearly labelled."
                  : "Prediction may take a few minutes depending on complexity."}
              </p>
            </div>
          )}

          {loading && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-8 text-center dark:border-blue-900 dark:bg-blue-950/40">
              <svg aria-hidden="true" className="animate-spin h-10 w-10 text-blue-500 mx-auto mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm font-medium text-blue-700 dark:text-blue-300" role="status">
                {isDemo ? "Preparing a demo result…" : "Predicting structure…"}
              </p>
              <p className="mt-1 text-xs text-blue-500 dark:text-blue-400" aria-live="polite">
                {isDemo ? "Local demo request — no provider, no credits." : "This may take several minutes. The model runs on NVIDIA DGX Cloud."}
              </p>
            </div>
          )}

          {result && currentStructure && (
            <div>
              {resultIsExample && (
                <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    {resultMeta?.source === "sample-structure" ? "EXAMPLE STRUCTURE — NOT A PREDICTION" : "DEMO OUTPUT — NOT A REAL PREDICTION"}
                  </p>
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    {resultMeta?.source === "sample-structure"
                      ? "This is a pre-existing example structure with recorded provenance (see below) for viewer testing. No provider produced it."
                      : "These placeholder coordinates were generated locally so you can test the interface. No NVIDIA call was made and no prediction was run."}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <span className="text-sm text-green-600 font-medium">
                  {resultMeta?.openedFromHistory ? "Opened from history" : resultMeta?.source === "sample-structure" ? "Sample loaded" : isDemo ? "Demo output ready" : "Prediction complete"}
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowViewer(true)} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">View in 3D</button>
                  <button type="button" onClick={handleDownload} className="flex items-center gap-1 bg-brand-600 text-white px-3 py-1.5 rounded text-sm hover:bg-brand-700 transition-colors">
                    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    Download .{currentStructure.format === "pdb" ? "pdb" : "cif"}
                  </button>
                </div>
              </div>

              {(saveState === "saved" || saveState === "failed") && saveMessage && (
                <p role="status" className={`mb-2 rounded px-3 py-2 text-xs ${saveState === "saved" ? "border border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300" : "border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"}`}>
                  {saveMessage}
                </p>
              )}
              {saveState === "saving" && (
                <p role="status" className="mb-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Saving to your history…
                </p>
              )}

              <div className="flex items-center gap-2 flex-wrap text-sm mb-2">
                <span>{result.length} model{result.length === 1 ? "" : "s"}</span>
                <span aria-hidden="true">·</span>
                <span>format: {currentStructure.format.toUpperCase()}</span>
                {finiteScores.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>confidence metrics returned</span>
                  </>
                )}
              </div>

              <label className="mb-3 block text-sm">Predicted structure
                <select aria-label="Predicted structure" value={selectedStructure} onChange={(event) => { setSelectedStructure(Number(event.target.value)); setShowViewer(false); }} className="ml-2 rounded border p-2 dark:bg-slate-900">
                  {result.map((structure, index) => <option key={`${structure.name}-${index}`} value={index}>{structure.name}</option>)}
                </select>
              </label>

              {finiteScores.length > 0 ? (
                <dl className="mb-2 grid grid-cols-2 gap-2 text-sm">
                  {finiteScores.map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{currentStructure.scores[key].toFixed(3)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">
                  No confidence metrics were returned with this structure.
                </p>
              )}
              <p className="mb-3 text-xs text-gray-600 dark:text-slate-400">
                Confidence scores describe how sure the model is about its own prediction — they are not a measured
                binding affinity, activity or stability value.
              </p>

              {showViewer && <ProteinFoldViewer key={currentStructure.name} structure={currentStructure} />}

              <details className="mb-3">
                <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-300">
                  Show coordinate text
                </summary>
                <pre className="mt-2 border border-gray-200 rounded-lg bg-gray-900 text-green-300 text-xs p-4 overflow-auto whitespace-pre font-mono dark:border-slate-700" style={{ maxHeight: "400px" }}>
                  {currentStructure.text}
                </pre>
              </details>

              {resultMeta?.provider && (
                <p className="mb-1 text-xs text-gray-400 dark:text-slate-500">
                  Provider: {resultMeta.provider === "public-sample" ? "public example structure" : resultMeta.provider}
                  {resultMeta.providerVersion ? ` (${resultMeta.providerVersion})` : ""}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ================= Sample structures (viewer testing) ================= */}
      <section aria-labelledby="fold-sample-structures" className="mt-6 rounded-xl border border-gray-200 p-4 dark:border-slate-700">
        <h3 id="fold-sample-structures" className="text-base font-semibold">Sample structures for viewer testing</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          Pre-existing example coordinate files (public RCSB entry 1CRN, crambin) in PDB and mmCIF — loaded instantly,
          clearly labelled as examples, and never presented as a new prediction.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {FOLDING_STRUCTURE_SAMPLES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => loadStructureSample(sample)}
              disabled={loading}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Load {sample.title}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-400 dark:text-slate-500">
          Source: <a href="https://www.rcsb.org/structure/1CRN" target="_blank" rel="noreferrer" className="underline">RCSB PDB 1CRN (crambin)</a> — example structure, not generated here.
        </p>
      </section>

      {/* ================= Saved history ================= */}
      {historyAvailable && (
        <FoldHistoryPanel
          onOpen={openHistoryRun}
          onReuse={reuseHistoryInputs}
        />
      )}
    </div>
  );
};

export default ProteinFolding;
