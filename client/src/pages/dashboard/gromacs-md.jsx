import { useEffect, useRef, useState } from "react";
import { Typography, Button, Input, Textarea } from "@material-tailwind/react";
import { API_CONFIG, getAuthToken } from "@/utils/constants";

const GromacsMd = () => {
  const [workflow, setWorkflow] = useState("pdb2gmx");
  const [payload, setPayload] = useState('{\n  "pdb_file": "protein.pdb",\n  "force_field": "oplsaa",\n  "water": "spce",\n  "output_prefix": "processed"\n}');
  const [jobId, setJobId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const requestControllerRef = useRef(null);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  const callApi = async (path, method = "GET", body) => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const token = getAuthToken();
      const response = await fetch(API_CONFIG.buildApiUrl(path), {
        method,
        signal: controller.signal,
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
      if (err.name === "AbortError") return;
      setError(err.message);
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setLoading(false);
      }
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
    <div className="w-full space-y-8 rounded bg-white p-6 shadow dark:bg-slate-900 dark:text-slate-100">
      <div>
        <Typography variant="h4" color="blue-gray" className="dark:text-slate-50">
          GROMACS Molecular Dynamics
        </Typography>
        <Typography className="mt-2 text-gray-600 dark:text-slate-300">
          Run GROMACS workflows through the integrated gromacs-api service (upload files via the service docs at port 8001).
        </Typography>
      </div>

      <div className="flex flex-wrap gap-3">
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

      <form onSubmit={runWorkflow} className="max-w-3xl space-y-4">
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
        className="flex max-w-xl items-end gap-3"
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
        <pre className="max-h-96 overflow-auto rounded bg-gray-50 p-4 text-sm dark:bg-slate-950 dark:text-slate-200">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
};

export default GromacsMd;
