import { z } from 'zod';
import { callPlatform, MissingTokenError } from './platform-client.js';

const seg = (value) => encodeURIComponent(String(value));

// Declarative tool table. Each entry maps a Claude-facing tool onto one ChemBench
// platform endpoint via request(args) -> { method, path, query, body }. A single
// generic handler (registerTools) drives all of them, so the transport +
// token-forwarding path is proven once and shared.
export const TOOLS = [
  {
    name: 'platform_health',
    title: 'Platform health',
    description:
      'Check whether the ChemBench scientific microservices (GROMACS, glioblastoma predictor) are reachable and healthy.',
    inputSchema: {},
    request: () => ({ method: 'GET', path: '/api/platform/health' }),
  },
  {
    name: 'list_datasets',
    title: 'List Tanimoto datasets',
    description: 'List the compound datasets available for Tanimoto similarity, exact, and substructure search.',
    inputSchema: {},
    request: () => ({ method: 'GET', path: '/tanimoto/v1/datasets' }),
  },
  {
    name: 'similarity_search',
    title: 'Tanimoto similarity search',
    description:
      'Find compounds similar to a query molecule by Tanimoto fingerprint similarity. Returns ranked hits above the threshold.',
    inputSchema: {
      smiles: z.string().describe('Query molecule as a SMILES string.'),
      threshold: z.number().min(0).max(1).optional().describe('Minimum Tanimoto similarity (0-1).'),
      dataset_id: z.string().optional().describe('Restrict the search to a specific dataset id.'),
      limit: z.number().int().positive().optional().describe('Maximum number of hits to return.'),
    },
    request: ({ smiles, threshold, dataset_id, limit }) => ({
      method: 'GET',
      path: '/tanimoto/v1/search/similarity',
      query: { smiles, threshold, dataset_id, limit },
    }),
  },
  {
    name: 'exact_search',
    title: 'Exact structure search',
    description: 'Find compounds that exactly match a query molecule (canonical structure match).',
    inputSchema: {
      smiles: z.string().describe('Query molecule as a SMILES string.'),
      dataset_id: z.string().optional().describe('Restrict the search to a specific dataset id.'),
    },
    request: ({ smiles, dataset_id }) => ({
      method: 'GET',
      path: '/tanimoto/v1/search/exact',
      query: { smiles, dataset_id },
    }),
  },
  {
    name: 'substructure_search',
    title: 'Substructure search',
    description: 'Find compounds that contain the query molecule as a substructure.',
    inputSchema: {
      smiles: z.string().describe('Query substructure as a SMILES/SMARTS string.'),
      dataset_id: z.string().optional().describe('Restrict the search to a specific dataset id.'),
      limit: z.number().int().positive().optional().describe('Maximum number of hits to return.'),
    },
    request: ({ smiles, dataset_id, limit }) => ({
      method: 'GET',
      path: '/tanimoto/v1/search/substructure',
      query: { smiles, dataset_id, limit },
    }),
  },
  {
    name: 'generate_molecules',
    title: 'Generate molecules (MolMIM)',
    description:
      'Generate novel drug-like molecules around a seed compound using NVIDIA MolMIM (CMA-ES optimization toward QED). Consumes one simulation token.',
    inputSchema: {
      smiles: z.string().describe('Seed molecule as a SMILES string.'),
      min_similarity: z.number().min(0).max(1).optional().describe('Minimum similarity to the seed (default 0.3).'),
      num_molecules: z.number().int().positive().optional().describe('Number of molecules to generate (default 30).'),
    },
    request: ({ smiles, min_similarity, num_molecules }) => ({
      method: 'POST',
      path: '/api/generate-molecules',
      body: { smiles, minSimilarity: min_similarity, numMolecules: num_molecules },
    }),
  },
  {
    name: 'predict_protein_structure',
    title: 'Predict structure (OpenFold3)',
    description:
      'Predict a biomolecular complex structure (protein / DNA / RNA / ligand) with NVIDIA OpenFold3. Consumes one simulation token. Pass the OpenFold3 request payload as `request`.',
    inputSchema: {
      request: z
        .record(z.any())
        .describe('OpenFold3 request body (sequences, ligands, and options) forwarded verbatim to the predictor.'),
    },
    request: ({ request }) => ({ method: 'POST', path: '/api/openfold3/predict', body: request }),
  },
  {
    name: 'dock_ligand',
    title: 'Dock ligand (DiffDock)',
    description:
      'Predict the binding pose of a ligand against a protein using DiffDock. Consumes one simulation token.',
    inputSchema: {
      protein: z.string().describe('Target protein (PDB text or an identifier the platform accepts).'),
      ligand: z.string().describe('Ligand structure (SDF/MOL text or SMILES).'),
      ligand_file_type: z.string().optional().describe("Ligand format, e.g. 'sdf' (default) or 'smiles'."),
    },
    request: ({ protein, ligand, ligand_file_type }) => ({
      method: 'POST',
      path: '/api/diffdock/generate',
      body: { protein, ligand, ligandFileType: ligand_file_type },
    }),
  },
  {
    name: 'search_asinex',
    title: 'Search Asinex catalog',
    description: 'Search the Asinex compound catalog by all / id / exact / substructure.',
    inputSchema: {
      search_type: z.enum(['all', 'id', 'exact', 'substructure']).describe('Which Asinex search to run.'),
      id: z.string().optional().describe('Page id (for `all` / `substructure`).'),
      page_size: z.number().int().positive().optional().describe('Page size (for `all` / `substructure`).'),
      id_number: z.string().optional().describe('Asinex id number (for `id` search).'),
      smiles: z.string().optional().describe('Query SMILES (for `exact` / `substructure`).'),
    },
    request: ({ search_type, id, page_size, id_number, smiles }) => ({
      method: 'POST',
      path: '/api/asinex/search',
      body: { searchType: search_type, id, pageSize: page_size, id_number, smiles },
    }),
  },
  {
    name: 'predict_glioblastoma',
    title: 'Predict glioblastoma response',
    description:
      'Run the glioblastoma predictor microservice. Pass the predictor request payload as `request`.',
    inputSchema: {
      request: z.record(z.any()).describe('Glioblastoma predictor request body, forwarded verbatim.'),
    },
    request: ({ request }) => ({ method: 'POST', path: '/api/glioblastoma/predict', body: request }),
  },
  {
    name: 'run_gromacs_workflow',
    title: 'Run GROMACS workflow',
    description:
      'Start a molecular dynamics workflow on the GROMACS microservice. Returns a job you can poll with get_gromacs_job.',
    inputSchema: {
      workflow: z.string().describe('Workflow identifier to run (e.g. a named MD pipeline).'),
      parameters: z.record(z.any()).optional().describe('Workflow parameters, forwarded verbatim as the request body.'),
    },
    request: ({ workflow, parameters }) => ({
      method: 'POST',
      path: `/api/gromacs/workflows/${seg(workflow)}`,
      body: parameters || {},
    }),
  },
  {
    name: 'get_gromacs_job',
    title: 'Get GROMACS job',
    description: 'Fetch the status and results of a previously started GROMACS workflow job.',
    inputSchema: {
      job_id: z.string().describe('Job id returned by run_gromacs_workflow.'),
    },
    request: ({ job_id }) => ({ method: 'GET', path: `/api/gromacs/jobs/${seg(job_id)}` }),
  },
  {
    name: 'get_admet_results',
    title: 'Get ADMET results',
    description: 'Fetch ADMET (absorption, distribution, metabolism, excretion, toxicity) results for a simulation.',
    inputSchema: {
      simulation_key: z.string().describe('The simulation key to fetch ADMET results for.'),
    },
    request: ({ simulation_key }) => ({ method: 'GET', path: `/api/simulation/${seg(simulation_key)}/admet` }),
  },
  {
    name: 'search_molecule_prices',
    title: 'Search molecule pricing',
    description: 'Search the molecule pricing catalog by free-text query, SMILES, or formula.',
    inputSchema: {
      query: z.string().optional().describe('Free-text query (id, IUPAC name, InChI, InChIKey, or SMILES).'),
      smiles: z.string().optional().describe('Filter by SMILES string.'),
      formula: z.string().optional().describe('Filter by molecular formula.'),
      limit: z.number().int().positive().optional().describe('Maximum results (default 10).'),
      skip: z.number().int().min(0).optional().describe('Results to skip for pagination (default 0).'),
    },
    request: ({ query, smiles, formula, limit, skip }) => ({
      method: 'GET',
      path: '/api/mol-price/search',
      query: { query, smiles, formula, limit, skip },
    }),
  },
];

function textResult(payload, isError) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: Boolean(isError),
  };
}

// Registers every tool in TOOLS on an McpServer. `getToken` resolves the caller's
// ChemBench token for the current invocation (per-request header for HTTP, env for
// stdio), so the same tool definitions serve both transports.
export function registerTools(server, getToken) {
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      async (args) => {
        try {
          const { method, path, query, body } = tool.request(args || {});
          const { ok, status, data } = await callPlatform({ method, path, query, body, token: getToken() });
          if (!ok) {
            return textResult({ error: `ChemBench platform returned HTTP ${status}`, response: data }, true);
          }
          return textResult(data, false);
        } catch (error) {
          if (error instanceof MissingTokenError) {
            return textResult({ error: error.message }, true);
          }
          return textResult({ error: 'Tool execution failed', details: error.message }, true);
        }
      },
    );
  }
}
