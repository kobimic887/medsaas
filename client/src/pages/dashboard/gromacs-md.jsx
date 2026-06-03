import React, { useState } from "react";
import { Typography, Button, Input, Textarea } from "@material-tailwind/react";
import { API_CONFIG, getAuthToken } from "@/utils/constants";

const GromacsMd = () => {
  const [workflow, setWorkflow] = useState("pdb2gmx");
  const [payload, setPayload] = useState('{\n  "pdb_file": "protein.pdb",\n  "force_field": "oplsaa",\n  "water": "spce",\n  "output_prefix": "processed"\n}');
  const [jobId, setJobId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const callApi = async (path, method = "GET", body) => {
    setLoading(true);
    setError(null);
    try {
      const token = getAuthToken();
      const response = await fetch(API_CONFIG.buildApiUrl(path), {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || data.details || "GROMACS request failed");
      }
      setResult(data);
      if (data.job_id) {
        setJobId(data.job_id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runWorkflow = (e) => {
    e.preventDefault();
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      setError("Workflow payload must be valid JSON");
      return;
    }
    callApi(`/gromacs/workflows/${workflow}`, "POST", parsed);
  };

  return (
    <div className="p-6 w-full bg-white rounded shadow space-y-8">
      <div>
        <Typography variant="h4" color="blue-gray">
          GROMACS Molecular Dynamics
        </Typography>
        <Typography className="mt-2 text-gray-600">
          Run GROMACS workflows through the integrated gromacs-api service (upload files via the service docs at port 8001).
        </Typography>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Button variant="outlined" disabled={loading} onClick={() => callApi("/gromacs/health")}>
          Health check
        </Button>
        <Button variant="outlined" disabled={loading} onClick={() => callApi("/gromacs/info")}>
          System info
        </Button>
        <Button variant="outlined" disabled={loading} onClick={() => callApi("/platform/health")}>
          Platform health
        </Button>
      </div>

      <form onSubmit={runWorkflow} className="space-y-4 max-w-3xl">
        <Input label="Workflow" value={workflow} onChange={(e) => setWorkflow(e.target.value)} />
        <Textarea label="JSON payload" rows={10} value={payload} onChange={(e) => setPayload(e.target.value)} />
        <Button type="submit" disabled={loading}>
          {loading ? "Running..." : "Run workflow"}
        </Button>
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (jobId) callApi(`/gromacs/jobs/${jobId}`);
        }}
        className="flex gap-3 items-end max-w-xl"
      >
        <Input label="Job ID" value={jobId} onChange={(e) => setJobId(e.target.value)} className="flex-1" />
        <Button type="submit" color="blue" disabled={loading || !jobId}>
          Poll job
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

export default GromacsMd;
