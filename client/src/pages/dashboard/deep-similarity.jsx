import { useEffect, useRef, useState } from "react";
import {
  Card,
  CardBody,
  CardHeader,
  Typography,
  Button,
  Input,
  Spinner,
  Alert,
} from "@material-tailwind/react";
import {
  AdjustmentsHorizontalIcon,
  BeakerIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
// getAuthToken reads access_token first and falls back to auth_token. Reading
// auth_token directly worked only because sign-in happens to write both keys —
// and a miss here does not fail softly: /tanimoto/* is authenticated, so a
// request with no bearer token gets a same-origin 401, which the global
// interceptor treats as a dead session and signs the user out.
import { API_CONFIG, getAuthToken } from "@/utils/constants";

export function DeepSimilarity() {
  const [searchType, setSearchType] = useState("exact");
  const [searchQuery, setSearchQuery] = useState("");
  const [threshold, setThreshold] = useState(0.5);
  const [fingerprintType, setFingerprintType] = useState("morgan");
  const [similarityMetric, setSimilarityMetric] = useState("tanimoto");
  const [datasets, setDatasets] = useState([]);
  const [datasetId, setDatasetId] = useState("");
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [datasetsError, setDatasetsError] = useState("");
  const [datasetAttempt, setDatasetAttempt] = useState(0);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // idle | ok | empty | error
  const [searchStatus, setSearchStatus] = useState("idle");
  const [searchedFor, setSearchedFor] = useState("");
  const searchControllerRef = useRef(null);

  useEffect(() => () => searchControllerRef.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    setDatasetsLoading(true);
    setDatasetsError("");
    const token = getAuthToken();
    fetch(API_CONFIG.buildUrl("/tanimoto/v1/datasets"), {
      signal: controller.signal,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !Array.isArray(data?.datasets)) {
        throw new Error("Could not load datasets. You can still search all datasets.");
      }
      if (!controller.signal.aborted) setDatasets(data.datasets);
    }).catch(() => {
      if (!controller.signal.aborted) {
        setDatasetsError("Could not load datasets. You can still search all datasets.");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setDatasetsLoading(false);
    });
    return () => controller.abort();
  }, [datasetAttempt]);

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query) return;

    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;

    setLoading(true);
    setError("");
    setResults([]);
    setSearchStatus("idle");
    setSearchedFor(query);

    try {
      let url = "";
      const token = getAuthToken();
      const smiles = encodeURIComponent(query);

      if (searchType === "exact") {
        url = API_CONFIG.buildUrl(`/tanimoto/v1/search/exact?smiles=${smiles}`);
      } else if (searchType === "similarity") {
        url = API_CONFIG.buildUrl(`/tanimoto/v1/search/similarity?smiles=${smiles}&threshold=${threshold}&fingerprint_type=${fingerprintType}&similarity_metric=${similarityMetric}`);
      } else if (searchType === "substructure") {
        url = API_CONFIG.buildUrl(`/tanimoto/v1/search/substructure?smiles=${smiles}`);
      }

      if (datasetId) url += `&dataset_id=${encodeURIComponent(datasetId)}`;

      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || `Search failed (HTTP ${res.status})`);
      }

      if (controller.signal.aborted) return;
      const rows = data?.results || [];
      setResults(rows);
      setSearchStatus(rows.length > 0 ? "ok" : "empty");
    } catch (err) {
      if (controller.signal.aborted || err.name === "AbortError") return;
      setError(err.message);
      setSearchStatus("error");
    } finally {
      if (searchControllerRef.current === controller) {
        searchControllerRef.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] py-2">
      <Card shadow={false} className="w-full overflow-hidden rounded-2xl border border-blue-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900">
        <CardHeader
          floated={false}
          shadow={false}
          className="m-0 rounded-none border-b border-blue-gray-100 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-start gap-4">
            <div className="mt-0.5 rounded-xl bg-brand-100 p-2.5 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <BeakerIcon className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <Typography variant="h5" color="blue-gray" className="text-xl font-semibold dark:text-slate-100">
                Deep Similarity Search
              </Typography>
              <Typography variant="small" color="gray" className="mt-1 max-w-3xl font-normal leading-relaxed dark:text-slate-400">
                Search the molecular corpus by exact match, structural similarity, or substructure.
              </Typography>
            </div>
          </div>
        </CardHeader>

        <CardBody className="space-y-5 p-5 sm:p-6">
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-blue-gray-700 dark:text-slate-300">Dataset</span>
              <select
                aria-label="Dataset"
                value={datasetId}
                disabled={datasetsLoading}
                onChange={(event) => {
                  searchControllerRef.current?.abort();
                  searchControllerRef.current = null;
                  setLoading(false);
                  setDatasetId(event.target.value);
                  setResults([]);
                  setError("");
                  setSearchStatus("idle");
                }}
                className="min-h-11 w-full rounded-lg border border-blue-gray-200 bg-white px-3 text-sm text-blue-gray-800 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="">All datasets</option>
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={String(dataset.id)}>
                    {dataset.name}{Number.isFinite(dataset.row_count) ? ` (${dataset.row_count.toLocaleString()} compounds)` : ""}
                  </option>
                ))}
              </select>
            </label>
            {datasetsLoading && <p role="status" className="text-sm text-blue-gray-500">Loading datasets…</p>}
            {datasetsError && (
              <div role="alert" className="text-sm text-red-600 dark:text-red-400">
                {datasetsError}{" "}
                <button type="button" className="underline" onClick={() => setDatasetAttempt((attempt) => attempt + 1)}>Retry</button>
              </div>
            )}
            {!datasetsLoading && !datasetsError && datasets.length === 0 && (
              <p className="text-sm text-blue-gray-500">No datasets are available yet.</p>
            )}
          </div>
          <form
            className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_10rem_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              handleSearch();
            }}
          >
            <div className="min-w-0">
              <Input
                label="Search query (SMILES)"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="!border-blue-gray-200 dark:!border-slate-700"
                labelProps={{ className: "dark:before:border-slate-700 dark:after:border-slate-700" }}
              />
            </div>
            <label className="flex min-h-11 flex-col justify-center rounded-lg border border-blue-gray-200 px-3 dark:border-slate-700">
              <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-gray-500 dark:text-slate-500">
                Search mode
              </span>
              <select
                aria-label="Search mode"
                value={searchType}
                onChange={(event) => setSearchType(event.target.value)}
                className="w-full bg-transparent text-sm font-medium text-blue-gray-800 outline-none dark:text-slate-200"
              >
                <option value="exact">Exact</option>
                <option value="similarity">Similarity</option>
                <option value="substructure">Substructure</option>
              </select>
            </label>
            <Button
              type="submit"
              disabled={loading || !searchQuery.trim()}
              className="flex min-h-11 items-center justify-center gap-2 bg-brand-500 px-6 text-white hover:bg-brand-600"
            >
              {loading ? <Spinner className="h-4 w-4" /> : <MagnifyingGlassIcon className="h-4 w-4" />}
              {loading ? "Searching" : "Search"}
            </Button>
          </form>

          {searchType === "similarity" && (
            <section className="rounded-xl border border-blue-gray-100 bg-blue-gray-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/50" aria-label="Similarity options">
              <div className="mb-3 flex items-center gap-2">
                <AdjustmentsHorizontalIcon className="h-4 w-4 text-blue-gray-500 dark:text-slate-400" aria-hidden="true" />
                <Typography variant="small" color="blue-gray" className="font-semibold dark:text-slate-200">
                  Similarity options
                </Typography>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(12rem,1fr)]">
                <label className="block">
                  <div className="mb-1 flex items-center justify-between text-xs font-medium text-blue-gray-600 dark:text-slate-400">
                    <span>Threshold</span>
                    <span className="rounded-md bg-white px-2 py-0.5 font-semibold text-blue-gray-800 dark:bg-slate-800 dark:text-slate-200">{threshold.toFixed(1)}</span>
                  </div>
                  <input
                    aria-label="Similarity threshold"
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.1"
                    value={threshold}
                    onChange={(event) => setThreshold(parseFloat(event.target.value))}
                    className="h-2 w-full cursor-pointer accent-brand-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-blue-gray-600 dark:text-slate-400">Fingerprint</span>
                  <select
                    value={fingerprintType}
                    onChange={(event) => setFingerprintType(event.target.value)}
                    className="h-10 w-full rounded-lg border border-blue-gray-200 bg-white px-3 text-sm text-blue-gray-800 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <option value="morgan">Morgan (ECFP4)</option>
                    <option value="maccs">MACCS</option>
                    <option value="feat_morgan">Feature Morgan (FCFP4)</option>
                    <option value="atom_pair">Atom Pair</option>
                    <option value="torsion">Topological Torsion</option>
                    <option value="rdkit">RDKit</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-blue-gray-600 dark:text-slate-400">Metric</span>
                  <select
                    value={similarityMetric}
                    onChange={(event) => setSimilarityMetric(event.target.value)}
                    className="h-10 w-full rounded-lg border border-blue-gray-200 bg-white px-3 text-sm text-blue-gray-800 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <option value="tanimoto">Tanimoto</option>
                    <option value="dice">Dice</option>
                  </select>
                </label>
              </div>
            </section>
          )}

          {error && <Alert color="red" className="border border-red-200 dark:border-red-900/60">{error}</Alert>}

          {searchStatus === "idle" && !loading && (
            <div className="rounded-xl border border-dashed border-blue-gray-200 bg-blue-gray-50/40 px-5 py-10 text-center dark:border-slate-700 dark:bg-slate-950/30">
              <SparklesIcon className="mx-auto h-8 w-8 text-blue-gray-400 dark:text-slate-500" aria-hidden="true" />
              <Typography variant="h6" color="blue-gray" className="mt-3 dark:text-slate-200">Ready to search</Typography>
              <Typography variant="small" color="gray" className="mt-1 dark:text-slate-400">
                Enter a valid SMILES query above to explore the corpus.
              </Typography>
            </div>
          )}

          {searchStatus === "ok" && (
            <div className="flex items-center justify-between border-b border-blue-gray-100 pb-3 dark:border-slate-800">
              <Typography variant="small" color="blue-gray" className="font-medium dark:text-slate-300">
                {results.length} result{results.length !== 1 ? "s" : ""}
              </Typography>
              <Typography variant="small" color="gray" className="dark:text-slate-500">Ranked by your selected search mode</Typography>
            </div>
          )}

          {searchStatus === "empty" && (
            <Alert color="amber" className="border border-amber-200 dark:border-amber-900/60">
              No matches for <span className="font-mono font-semibold">{searchedFor}</span>. The query parsed successfully, but nothing in the catalogue matched it.
              {searchType === "similarity" && " Try lowering the similarity threshold."}
            </Alert>
          )}

          {results.length > 0 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {results.map((item, index) => (
                <article key={`${item.molecule_id}-${index}`} className="min-w-0 rounded-xl border border-blue-gray-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="flex items-start justify-between gap-3">
                    <Typography variant="small" color="blue-gray" className="truncate font-semibold dark:text-slate-200">
                      {item.molecule_id || "Molecule"}
                    </Typography>
                    {item.similarity !== undefined && item.similarity !== null && (
                      <span className="shrink-0 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-bold text-brand-800 dark:bg-brand-500/15 dark:text-brand-300">
                        {(item.similarity * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <code className="mt-3 block max-h-16 overflow-auto break-all rounded-lg bg-blue-gray-50 px-3 py-2 text-xs leading-relaxed text-blue-gray-700 dark:bg-slate-900 dark:text-slate-300">
                    {item.canonical_smiles || "No canonical SMILES returned"}
                  </code>
                  {(item.metadata?.compound_id || item.metadata?.molecular_formula || item.metadata?.monoisotopic_mass || item.metadata?.activity_score) && (
                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-blue-gray-100 pt-3 text-xs dark:border-slate-800">
                      {item.metadata?.compound_id && <div><dt className="text-blue-gray-500 dark:text-slate-500">Compound</dt><dd className="truncate font-medium text-blue-gray-800 dark:text-slate-300">{item.metadata.compound_id}</dd></div>}
                      {item.metadata?.molecular_formula && <div><dt className="text-blue-gray-500 dark:text-slate-500">Formula</dt><dd className="truncate font-medium text-blue-gray-800 dark:text-slate-300">{item.metadata.molecular_formula}</dd></div>}
                      {item.metadata?.monoisotopic_mass && <div><dt className="text-blue-gray-500 dark:text-slate-500">Mass</dt><dd className="truncate font-medium text-blue-gray-800 dark:text-slate-300">{item.metadata.monoisotopic_mass}</dd></div>}
                      {item.metadata?.activity_score && <div><dt className="text-blue-gray-500 dark:text-slate-500">Activity</dt><dd className="truncate font-medium text-blue-gray-800 dark:text-slate-300">{item.metadata.activity_score}</dd></div>}
                    </dl>
                  )}
                </article>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default DeepSimilarity;
