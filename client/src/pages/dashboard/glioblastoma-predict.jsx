import { useEffect, useRef, useState } from "react";
import { Typography, Button, Input, Textarea } from "@material-tailwind/react";
import { API_CONFIG, getAuthToken } from "@/utils/constants";

const GlioblastomaPredict = () => {
  const [smiles, setSmiles] = useState("");
  const [batchSmiles, setBatchSmiles] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const requestControllerRef = useRef(null);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  const predict = async (endpoint, body) => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const token = getAuthToken();
      const response = await fetch(API_CONFIG.buildApiUrl(endpoint), {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || data.details || "Prediction failed");
      }
      setResult(data);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err.message);
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setLoading(false);
      }
    }
  };

  const handleSingle = (e) => {
    e.preventDefault();
    predict("/glioblastoma/predict", { smiles });
  };

  const handleBatch = (e) => {
    e.preventDefault();
    const smilesList = batchSmiles
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    predict("/glioblastoma/batch-predict", { smiles_list: smilesList });
  };

  return (
    <div className="w-full space-y-8 rounded bg-white p-6 shadow dark:bg-slate-900 dark:text-slate-100">
      <div>
        <Typography variant="h4" color="blue-gray" className="dark:text-slate-50">
          Glioblastoma Drug Sensitivity
        </Typography>
        <Typography className="mt-2 text-gray-600 dark:text-slate-300">
          Predict glioblastoma drug sensitivity from SMILES via the integrated glioblastoma-predictor service.
        </Typography>
      </div>

      <form onSubmit={handleSingle} className="max-w-2xl space-y-4">
        <Typography variant="h6" className="dark:text-slate-100">Single compound</Typography>
        <Input label="SMILES" value={smiles} onChange={(e) => setSmiles(e.target.value)} />
        <Button type="submit" disabled={loading || !smiles}>
          {loading ? "Predicting..." : "Predict sensitivity"}
        </Button>
      </form>

      <form onSubmit={handleBatch} className="max-w-2xl space-y-4">
        <Typography variant="h6" className="dark:text-slate-100">Batch (one SMILES per line)</Typography>
        <Textarea
          label="SMILES list"
          rows={6}
          value={batchSmiles}
          onChange={(e) => setBatchSmiles(e.target.value)}
        />
        <Button type="submit" color="blue" disabled={loading || !batchSmiles.trim()}>
          {loading ? "Predicting..." : "Batch predict"}
        </Button>
      </form>

      {error && (
        <Typography color="red" className="font-medium">
          {error}
        </Typography>
      )}

      {result && (
        <pre className="max-h-96 overflow-auto rounded bg-gray-50 p-4 text-sm dark:bg-slate-950 dark:text-slate-200">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
};

export default GlioblastomaPredict;
