import React, { useState } from "react";
import { Typography, Button, Input, Textarea } from "@material-tailwind/react";
import { API_CONFIG, getAuthToken } from "@/utils/constants";

const GlioblastomaPredict = () => {
  const [smiles, setSmiles] = useState("");
  const [batchSmiles, setBatchSmiles] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const predict = async (endpoint, body) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const token = getAuthToken();
      const response = await fetch(API_CONFIG.buildApiUrl(endpoint), {
        method: "POST",
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
      setError(err.message);
    } finally {
      setLoading(false);
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
    <div className="p-6 w-full bg-white rounded shadow space-y-8">
      <div>
        <Typography variant="h4" color="blue-gray">
          Glioblastoma Drug Sensitivity
        </Typography>
        <Typography className="mt-2 text-gray-600">
          Predict glioblastoma drug sensitivity from SMILES via the integrated glioblastoma-predictor service.
        </Typography>
      </div>

      <form onSubmit={handleSingle} className="space-y-4 max-w-2xl">
        <Typography variant="h6">Single compound</Typography>
        <Input label="SMILES" value={smiles} onChange={(e) => setSmiles(e.target.value)} />
        <Button type="submit" disabled={loading || !smiles}>
          {loading ? "Predicting..." : "Predict sensitivity"}
        </Button>
      </form>

      <form onSubmit={handleBatch} className="space-y-4 max-w-2xl">
        <Typography variant="h6">Batch (one SMILES per line)</Typography>
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
        <pre className="bg-gray-50 p-4 rounded text-sm overflow-auto max-h-96">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
};

export default GlioblastomaPredict;
