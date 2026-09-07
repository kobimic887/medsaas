// Staging/demo router (mounted ONLY when PYXIS_DEMO_MODE=true).
//
// Guarantees of this router:
//   - Demo mode is server-controlled. Real billing, purchases, email, and paid
//     scientific execution that is NOT explicitly enabled stays refused with
//     403 DEMO_MODE_DISABLED even if a browser calls the endpoint by hand.
//     /api/openfold3/predict is answered from the server-side fixture with NO
//     outbound call and no production NVIDIA credentials.
//   - Simulation is usable for owner testing and mirrors production:
//       * catalog browse + BAS/structure/substructure/similarity/molecular-
//         weight search proxy the same read-only external ASINEX catalog
//         production uses (ASINEX_API_BASE),
//       * /api/simulation and /api/diffdock/generate forward to the real
//         docking providers (ASINEX_DOCKING_API_URL / DIFFDOCK_API_URL) — real,
//         paid execution, authorized for the synthetic demo account,
//       * runs and their coordinate blobs are kept in an in-process store with
//         simulation_logs ownership semantics (resets on restart — labelled as
//         temporary demo history),
//       * /api/stock-search/* honestly reports STOCK_SEARCH_UNAVAILABLE because
//         the stock-compound dataset is provisioned by the separate Simulation
//         stock deployment, never a silent Asinex fallback.
//   - Auth uses the same 401-only-for-dead-session rule and verifies against
//     the staging server's OWN JWT secret (never the production secret), so
//     production tokens are rejected here and staging tokens are rejected by
//     production.
//   - All /api paths that fall through this router are answered with
//     503 DEMO_MODE_UNAVAILABLE instead of silently reaching the Mongo-backed
//     API, because the demo process has no database.
//
// The folding history endpoints enforce the folding HISTORY CONTRACT (conjunctive
// owner filter, small list rows, bounded blobs, 404 for non-owners) against the
// in-process demo store. Persistent storage across restarts is NOT provided
// here — no separate approved database exists, and production Atlas is
// off-limits — so the UI labels history as demo-only.

import { Router } from "express";
import jwt from "jsonwebtoken";
import { buildFixtureFoldResponse } from "../utils/foldFixture.js";
import { demoStore } from "../utils/foldDemoStore.js";
import { createDemoSimStore } from "../utils/demoSimStore.js";

// Outbound/paid/unsupported endpoints that stay blocked in demo mode. Exact and
// prefix matches only — a prefix like "/api/simulation/" must NOT swallow
// "/api/simulation-logs" (a read endpoint) or the registered
// "/api/simulation" docking route.
const REFUSED_EXACT = [
  "/create-checkout-session",
  "/create-checkout-session-onetime",
  "/api/claim-trial",
  "/api/generate-molecules", // NVIDIA MolMIM
  "/api/shop",
  "/send-email",
];
const REFUSED_PREFIXES = [
  "/api/billing/",
  "/api/gromacs",
  "/api/glioblastoma",
  "/api/admet",
  "/api/diffdock/", // generate_file and any other DiffDock sub-path stay off
  "/api/simulation/", // simulation sub-resources (e.g. ADMET, results by key)
  "/api/api4/", // only the registered /api4 methods below are proxied
  "/api4/",
  "/tanimoto/",
];

function isRefusedPath(path) {
  if (REFUSED_EXACT.includes(path)) return true;
  return REFUSED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// --- Upstream helpers (same semantics as server/index.js, local to this
// router because demo mode must never import the Mongo-backed handlers). ------
const UPSTREAM_TIMEOUT_MS = 120000; // interactive catalog/search
const UPSTREAM_LONG_TIMEOUT_MS = 600000; // docking / diffdock jobs

function fetchWithTimeout(url, opts = {}) {
  const { timeoutMs = UPSTREAM_TIMEOUT_MS, ...rest } = opts;
  if (rest.signal) return fetch(url, rest);
  return fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
}

// An upstream 401 means the SERVER's credentials to that service failed —
// surface as 502 so it can never trip the client's same-origin-401 logout.
function relayUpstreamStatus(status) {
  return status === 401 ? 502 : status;
}

// Same defaults as server/index.js. Demo identity has no company, so there is
// no per-company override to read.
function ligandServiceConfig() {
  return {
    catalogApiBase: (process.env.ASINEX_API_BASE || "http://dev.asinex.com:58181").replace(/\/$/, ""),
    dockingApiUrl:
      process.env.ASINEX_DOCKING_API_URL || "https://services.asinex.com:8000/docking",
    diffdockApiUrl:
      process.env.DIFFDOCK_API_URL ||
      "https://services.asinex.com:58000/molecular-docking/diffdock/generate",
    sdfConverterUrl:
      process.env.SDF_CONVERTER_URL || "http://83.229.87.94:8001/convertSTR",
  };
}

function safeUpstreamUrl(url) {
  // Log upstream URLs without embedded credentials.
  return String(url || "").replace(/\/\/([^/@]+)@/, "//");
}

// Relay an upstream response verbatim (status/content-type/payload) the way the
// production Asinex proxies do — read-only catalog data, never cached or canned.
async function relayCatalogUpstream(res, upstreamUrl, init = {}) {
  try {
    const response = await fetchWithTimeout(upstreamUrl, {
      method: init.method || "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (response.status >= 500) {
      console.error(
        `[staging] asinex upstream status=${response.status} url=${safeUpstreamUrl(upstreamUrl)}`
      );
    }
    res.status(relayUpstreamStatus(response.status));
    if (response.headers.get("content-type")) {
      res.setHeader("Content-Type", response.headers.get("content-type"));
    }
    if (typeof data === "object") {
      res.json(data);
    } else {
      res.send(data);
    }
  } catch (error) {
    console.error(`[staging] asinex upstream error url=${safeUpstreamUrl(upstreamUrl)}:`, error.message || error);
    res.status(502).json({ error: "Failed to connect to Asinex API", details: error.message });
  }
}

function demoSimulationKey() {
  const key = Array.from({ length: 12 }, () =>
    Math.random().toString(36).charAt(2)
  ).join("");
  return key || "k".repeat(12); // Math.random edge fallback; matches prod length/characters
}

// --- SDF helpers, mirroring the production /api/sanitized* handlers ----------
function reduceToMinimalSdf(sdf) {
  const sdfBlocks = String(sdf || "").split("$$$$");
  const smilesMap = {};
  sdfBlocks.forEach((block) => {
    const lines = block.split("\n");
    let smiles = null;
    let score = null;
    lines.forEach((line) => {
      if (line.startsWith(">  <smiles>")) {
        smiles = lines[lines.indexOf(line) + 1]?.trim();
      }
      if (line.startsWith(">  <SCORE>")) {
        score = parseFloat(lines[lines.indexOf(line) + 1]?.trim());
      }
    });
    if (smiles) {
      if (!(smiles in smilesMap) || (score !== null && score < smilesMap[smiles].score)) {
        smilesMap[smiles] = { block, score };
      }
    }
  });
  const reducedSDF =
    Object.values(smilesMap).map((obj) => obj.block.trim()).join("\n$$$$\n") + "\n$$$$\n";
  return reducedSDF;
}

function extractSpecificSdfBlock(sdf, smiles) {
  const sdfBlocks = String(sdf || "").split("$$$$");
  const wanted = String(smiles || "").trim().toLowerCase();
  for (const block of sdfBlocks) {
    const lines = block.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const header = lines[i].toLowerCase();
      if (
        header.startsWith(">  <smiles_string>") ||
        header.startsWith(">  <smiles>")
      ) {
        const blockSmiles = lines[i + 1]?.trim();
        if (blockSmiles && blockSmiles.toLowerCase() === wanted) {
          return block.trim();
        }
      }
    }
  }
  return null;
}

const DEMO_IDENTITY = Object.freeze({
  userId: "staging-tester-1",
  username: "pyxis-staging-tester",
  email: "staging-tester@pyxis-discovery.test",
  companyId: null, // explicitly company-less: history is scoped with companyId null
  companyName: null,
  role: "member",
  demo: true,
});

export function createStagingDemoRouter({ jwtSecret, jwtExpiresIn = "7d" }) {
  const router = Router();
  const simStore = createDemoSimStore();

  const signDemoToken = () =>
    jwt.sign(
      { ...DEMO_IDENTITY, simulationTokens: 20, verified: true },
      jwtSecret,
      { expiresIn: jwtExpiresIn }
    );

  const demoUserResponse = (token) => ({
    message: "Staging demo session started",
    token,
    user: {
      username: DEMO_IDENTITY.username,
      email: DEMO_IDENTITY.email,
      companyId: DEMO_IDENTITY.companyId,
      companyName: DEMO_IDENTITY.companyName,
      role: DEMO_IDENTITY.role,
      simulationTokens: 20,
      verified: true,
      mustChangePassword: false,
      demo: true,
    },
  });

  // Auth: same semantics as server/index.js authenticateToken — 401 only when
  // the token itself is missing/expired/invalid (dead session), never for
  // authorization problems.
  function demoAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token provided" });
    try {
      req.user = jwt.verify(token, jwtSecret);
      next();
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  }

  // ---- Server status (drives client demo chrome) ---------------------------
  router.get("/api/staging/status", (_req, res) => {
    res.json({
      staging: true,
      demo: true,
      demoStorage: "in-process (resets on restart)",
      historyAvailable: true,
      provider: "fixture",
      providerLive: false,
      creditsEnabled: false,
      simulation: {
        enabled: true,
        catalog: "live-read-only-asinex",
        dockingProvider: "live",
        stockSearch: "unavailable",
        logsStorage: "in-process (resets on restart)",
      },
      samplesLabel:
        "Sample results are example structures (public/synthetic), not newly generated NVIDIA predictions.",
      ts: new Date().toISOString(),
    });
  });

  // ---- Demo sign-in (the “Proceed to demo” button) -------------------------
  router.get("/api/demo-session", (_req, res) => {
    res.json({ available: true });
  });
  router.post("/api/demo-session", (_req, res) => {
    res.json(demoUserResponse(signDemoToken()));
  });

  // ---- Shell stubs (no DB in demo mode) ------------------------------------
  router.post("/api/validate-token", demoAuth, (_req, res) => {
    res.json({ valid: true, user: { ...DEMO_IDENTITY, simulationTokens: 20, verified: true } });
  });
  router.get("/api/activity", demoAuth, (_req, res) => {
    res.json({
      counts: { users: 1, projects: 0, simulations: 0 },
      users: [{ username: DEMO_IDENTITY.username, role: DEMO_IDENTITY.role }],
      projects: [],
      simulations: [],
    });
  });

  // ---- Fixture prediction (never leaves the process) ------------------------
  router.post("/api/openfold3/predict", demoAuth, (req, res) => {
    const outputFormat = req.body?.inputs?.[0]?.output_format;
    try {
      const { response, entitySummary } = buildFixtureFoldResponse(req.body, outputFormat);
      response._pyxisEntitySummary = entitySummary;
      res.json(response);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message, code: status === 400 ? "FOLD_BAD_REQUEST" : undefined });
    }
  });

  // ---- Folding history (private, demo store) --------------------------------
  router.get("/api/folding-history", demoAuth, async (req, res) => {
    try {
      const result = await demoStore.list({
        user: req.user,
        pageRaw: req.query.page,
        pageSizeRaw: req.query.pageSize,
        search: req.query.search,
      });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  router.post("/api/folding-history", demoAuth, async (req, res) => {
    try {
      const meta = await demoStore.create({ user: req.user, payload: req.body });
      res.status(201).json({ run: meta });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
  });

  router.get("/api/folding-history/:runId", demoAuth, async (req, res) => {
    const run = await demoStore.get({ user: req.user, runId: req.params.runId });
    if (!run) return res.status(404).json({ error: "Run not found." });
    res.json({ run });
  });

  router.patch("/api/folding-history/:runId", demoAuth, async (req, res) => {
    try {
      const meta = await demoStore.rename({
        user: req.user,
        runId: req.params.runId,
        name: req.body?.name,
      });
      if (!meta) return res.status(404).json({ error: "Run not found." });
      res.json({ run: meta });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
  });

  router.delete("/api/folding-history/:runId", demoAuth, async (req, res) => {
    const removed = await demoStore.remove({ user: req.user, runId: req.params.runId });
    if (!removed) return res.status(404).json({ error: "Run not found." });
    res.json({ ok: true });
  });

  // Coordinate blob download, authorized through the owning run.
  router.get("/api/folding-history/:runId/blob/:index", demoAuth, async (req, res) => {
    const run = await demoStore.get({ user: req.user, runId: req.params.runId });
    if (!run) return res.status(404).json({ error: "Run not found." });
    const index = Number(req.params.index);
    const blob = run.structuresWithText?.[index];
    if (!blob) return res.status(404).json({ error: "Structure not found." });
    const ext = blob.format === "mmcif" ? "cif" : "pdb";
    const safeName = String(run.name || "prediction").replace(/[^a-zA-Z0-9._-]+/g, "_");
    res.setHeader("Content-Type", blob.format === "mmcif" ? "chemical/x-mmcif" : "chemical/x-pdb");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-${blob.name}.${ext}"`);
    res.send(blob.text);
  });

  // ---- Simulation: catalog browse + search (live read-only Asinex catalog) --
  // Mirrors the production wrapper endpoints so the Simulation page behaves
  // exactly as it does against production — same URL shapes, same payloads,
  // same passthrough of the upstream response (never canned results).
  router.get("/api/asinex/all/:id_:pageSize", demoAuth, async (req, res) => {
    const { id_, pageSize } = req.params;
    if (!id_ || !pageSize) {
      return res.status(400).json({ error: "_id, pageSize are all required" });
    }
    const { catalogApiBase } = ligandServiceConfig();
    const upstreamUrl = `${catalogApiBase}/api/all/${id_}_${String(pageSize).replace("_", "")}`;
    await relayCatalogUpstream(res, upstreamUrl);
  });

  router.get("/api/asinex/id/:id_number", demoAuth, async (req, res) => {
    const { id_number } = req.params;
    if (!id_number) return res.status(400).json({ error: "id_number is required" });
    const { catalogApiBase } = ligandServiceConfig();
    const upstreamUrl = `${catalogApiBase}/api/id/${encodeURIComponent(id_number)}`;
    try {
      const response = await fetchWithTimeout(upstreamUrl, {
        headers: { Accept: "application/json", "Content-Type": "application/json" },
      });
      if (response.status === 404) {
        return res.status(404).json({ error: "Molecule not found in Asinex database" });
      }
      if (!response.ok) {
        throw new Error(`Asinex API responded with status: ${response.status}`);
      }
      const data = await response.json();
      res.json({ source: "asinex", id: id_number, data });
    } catch (error) {
      console.error("[staging] Asinex id lookup failed:", error.message || error);
      res.status(500).json({ error: "Failed to fetch from Asinex API", details: error.message });
    }
  });

  // Control Panel "Show Price" — a read-only exact-SMILES catalog lookup.
  router.get("/api/asinex/exact/:smiles", demoAuth, async (req, res) => {
    const { smiles } = req.params;
    if (!smiles) return res.status(400).json({ error: "SMILES string is required" });
    const { catalogApiBase } = ligandServiceConfig();
    const upstreamUrl = `${catalogApiBase}/api/exact/${encodeURIComponent(smiles)}`;
    try {
      const response = await fetchWithTimeout(upstreamUrl, {
        headers: { Accept: "application/json", "Content-Type": "application/json" },
      });
      if (response.status === 404) {
        return res.status(404).json({ error: "No exact SMILES match found in Asinex database" });
      }
      if (!response.ok) {
        throw new Error(`Asinex API responded with status: ${response.status}`);
      }
      const data = await response.json();
      res.json({ source: "asinex", searchType: "exact", smiles, data });
    } catch (error) {
      console.error("[staging] Asinex exact lookup failed:", error.message || error);
      res.status(502).json({ error: "Failed to fetch from Asinex API", details: error.message });
    }
  });

  // Whitelisted /api4 search methods (same route names the Simulation page
  // uses). The query body is forwarded untouched so search genuinely runs
  // against the live catalog — no canned results, no invented scores.
  const API4_METHODS = new Set(["bas", "structure", "substructure", "similarity", "mw"]);
  router.post("/api/api4/:method", demoAuth, async (req, res) => {
    const { method } = req.params;
    if (!API4_METHODS.has(method)) {
      return res.status(400).json({ error: `Unsupported search method: ${method}` });
    }
    const { catalogApiBase } = ligandServiceConfig();
    const upstreamUrl = `${catalogApiBase}/api4/${method}`;
    await relayCatalogUpstream(res, upstreamUrl, {
      method: "POST",
      body: JSON.stringify(req.body || {}),
    });
  });

  // ---- Stock-compound search: honest STOCK_SEARCH_UNAVAILABLE --------------
  // The stock dataset is owned by the separate Simulation stock deployment;
  // this staging process has no STOCK_SEARCH_* config, so the status/similarity
  // contract answers 503 STOCK_SEARCH_UNAVAILABLE exactly like production does
  // when the dataset is unprovisioned — never a silent fallback to Asinex.
  const stockUnavailable = () => ({
    error:
      "Stock-compound search is not provisioned for this staging environment (the dataset is deployed by the separate Simulation stock service). Switch the source to the Asinex catalog.",
    code: "STOCK_SEARCH_UNAVAILABLE",
    reason:
      "the stock dataset is not provisioned on staging",
  });
  router.get("/api/stock-search/status", (_req, res) => {
    res.status(503).json({ ...stockUnavailable(), available: false });
  });
  router.get("/api/stock-search/similarity", (_req, res) => {
    res.status(503).json(stockUnavailable());
  });

  // ---- Simulation logs + artifact blobs (in-process store) ------------------
  router.get("/api/simulation-logs", demoAuth, (req, res) => {
    res.json(simStore.list(req.user));
  });

  function sendRunNotFound(res) {
    return res.status(404).json({ error: "Simulation result not found" });
  }

  router.get("/api/sanitizedpdb/:simulationKey", demoAuth, (req, res) => {
    const row = simStore.getByKey(req.user, req.params.simulationKey);
    if (!row || !row.result?.pdb) return sendRunNotFound(res);
    res.setHeader("Content-Disposition", `attachment; filename="${row.simulationKey || "simulation"}.pdb"`);
    res.setHeader("Content-Type", "chemical/x-pdb");
    res.send(String(row.result.pdb).replace(/\n/g, "\r\n"));
  });

  router.get("/api/sanitizedsdf/:simulationKey", demoAuth, (req, res) => {
    const row = simStore.getByKey(req.user, req.params.simulationKey);
    if (!row || !row.result?.sdf) return sendRunNotFound(res);
    res.setHeader("Content-Disposition", `attachment; filename="${row.simulationKey || "simulation"}.sdf"`);
    res.setHeader("Content-Type", "chemical/x-sdf");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(String(row.result.sdf).replace(/\n/g, "\r\n"));
  });

  router.get("/api/sanitizedminimalsdf/:simulationKey", demoAuth, (req, res) => {
    const row = simStore.getByKey(req.user, req.params.simulationKey);
    if (!row || !row.result?.sdf) return sendRunNotFound(res);
    const reducedSDF = reduceToMinimalSdf(row.result.sdf);
    res.setHeader("Content-Disposition", `attachment; filename="${row.simulationKey || "simulation"}.sdf"`);
    res.setHeader("Content-Type", "chemical/x-sdf");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(reducedSDF.replace(/\n/g, "\r\n"));
  });

  router.get("/api/sanitizedspecificsdf/:simulationKey/:smiles", demoAuth, (req, res) => {
    const row = simStore.getByKey(req.user, req.params.simulationKey);
    if (!row || !row.result?.sdf) return sendRunNotFound(res);
    const foundBlock = extractSpecificSdfBlock(row.result.sdf, req.params.smiles);
    if (!foundBlock) {
      return res.status(404).json({ error: "SMILES not found in SDF" });
    }
    res.setHeader("Content-Disposition", `attachment; filename="${row.simulationKey || "simulation"}_${req.params.smiles}.sdf"`);
    res.setHeader("Content-Type", "chemical/x-sdf");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(`${foundBlock.replace(/\n/g, "\r\n")}\r\n$$$$\r\n`);
  });

  // ---- Real docking: /api/simulation (AutoDock-style, POST) -----------------
  // Authorized to run against the live provider under the synthetic demo
  // account. No Mongo: credits are not charged (demo tokens are cosmetic), the
  // cache-hit and run record live in the in-process store, and the ownership
  // semantics of simulation_logs are preserved for the demo user.
  router.post("/api/simulation", demoAuth, async (req, res) => {
    const { pdbid, smiles } = req.body || {};
    if (!pdbid || !smiles) {
      return res.status(400).json({ error: "pdbid and smiles are required in request body" });
    }
    const cached = simStore.findExisting(req.user, pdbid, smiles);
    if (cached) {
      return res.json({ ...cached.result, simulationKey: cached.simulationKey });
    }
    const simulationKey = demoSimulationKey();
    const { dockingApiUrl } = ligandServiceConfig();
    let data;
    try {
      const response = await fetchWithTimeout(dockingApiUrl, {
        method: "POST",
        headers: { Accept: "application/json, text/plain, */*", "Content-Type": "application/json" },
        body: JSON.stringify({
          pdbID: pdbid,
          smiles: smiles === decodeURIComponent(smiles) ? encodeURIComponent(smiles) : smiles,
        }),
        timeoutMs: UPSTREAM_LONG_TIMEOUT_MS,
      });
      if (!response.ok) {
        throw new Error(`Docking service returned ${response.status}`);
      }
      data = await response.json();
    } catch (error) {
      console.error("[staging] docking upstream failed:", error.message || error);
      return res.status(502).json({ error: "Docking service is unavailable" });
    }
    simStore.save(req.user, { pdbid, smiles, result: data, simulationKey, method: "POST" });
    res.json({ ...data, simulationKey });
  });

  // ---- Real DiffDock: /api/diffdock/generate --------------------------------
  // Mirrors the production handler flow (RCSB protein, ligand-ID or SMILES
  // ligand with SDF conversion, escaped payload to the provider, raw-ligand
  // retry on parse failure) minus the Mongo credit charge. Runs against the
  // real provider under the synthetic demo account.
  router.post("/api/diffdock/generate", demoAuth, async (req, res) => {
    try {
      const { diffdockApiUrl, sdfConverterUrl } = ligandServiceConfig();
      const {
        protein,
        ligandFileType = "sdf",
        ligand,
        time_divisions = 20,
        steps = 18,
        save_trajectory = false,
        is_staged = false,
      } = req.body || {};

      if (!protein || !ligand) {
        return res.status(400).json({ error: "protein and ligand are required" });
      }

      let ligand_bytes;
      let ligand_raw;
      let protein_bytes;
      try {
        const pdbResponse = await fetchWithTimeout(
          `https://files.rcsb.org/download/${String(protein).toUpperCase()}.pdb`,
          { headers: { Accept: "text/plain" } }
        );
        if (!pdbResponse.ok) {
          return res.status(400).json({ error: `Failed to fetch protein PDB file: ${pdbResponse.statusText}` });
        }
        const pdbContent = await pdbResponse.text();
        const atomLines = pdbContent
          .split("\n")
          .filter((line) => line.startsWith("ATOM"))
          .join("\n");
        protein_bytes = atomLines.replace(/\n/g, "\\\n");

        if (String(ligand).length < 4) {
          // A ligand component ID — fetch the ideal SDF from RCSB.
          const sdfResponse = await fetchWithTimeout(
            `https://files.rcsb.org/ligands/download/${ligand}_ideal.sdf`,
            { headers: { Accept: "text/plain" } }
          );
          if (!sdfResponse.ok) {
            return res.status(400).json({ error: `Failed to fetch ligand SDF file: ${sdfResponse.statusText}` });
          }
          const sdfContent = await sdfResponse.text();
          const normalizedSdf = sdfContent.replace(/\r\n/g, "\n");
          const sdfWithDelimiter = normalizedSdf.includes("$$$$") ? normalizedSdf : `${normalizedSdf}\n$$$$\n`;
          ligand_raw = sdfWithDelimiter;
          ligand_bytes = sdfWithDelimiter.replace(/\n/g, "\\\n");
        } else {
          // A SMILES string — convert to SDF with the shared converter first.
          const sdfResponse = await fetchWithTimeout(sdfConverterUrl, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ smiles: ligand }),
            timeoutMs: UPSTREAM_TIMEOUT_MS,
          });
          if (!sdfResponse.ok) {
            return res.status(400).json({ error: `Failed to convert SMILES to SDF: ${sdfResponse.statusText}` });
          }
          const sdfJson = await sdfResponse.json();
          const sdfContent = sdfJson?.sdf;
          const normalizedSdf = String(sdfContent || "").replace(/\r\n/g, "\n");
          const sdfWithDelimiter = normalizedSdf.includes("$$$$") ? normalizedSdf : `${normalizedSdf}\n$$$$\n`;
          ligand_raw = sdfWithDelimiter;
          // Production mirrors the legacy provider quirk here: SMILES-branch
          // newlines are replaced with a literal backslash + "n" (not a real
          // newline). Keep byte parity with server/index.js.
          ligand_bytes = sdfWithDelimiter.replace(/\n/g, "\\n");
        }
      } catch (error) {
        return res.status(400).json({ error: `Failed to fetch protein PDB or ligand SDF file: ${error.message}` });
      }

      const makeDiffDockRequest = async (ligandPayload) => {
        const requestBody = {
          ligand: ligandPayload,
          ligand_file_type: ligandFileType,
          protein: protein_bytes,
          num_poses: 100,
          time_divisions,
          steps,
          save_trajectory,
          is_staged,
        };
        const response = await fetchWithTimeout(diffdockApiUrl, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          timeoutMs: UPSTREAM_LONG_TIMEOUT_MS,
        });
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
        return { response, data };
      };

      let { response, data } = await makeDiffDockRequest(ligand_bytes);
      const detailsMessage =
        typeof data === "object" && data !== null ? data.details : null;
      if (
        detailsMessage &&
        typeof detailsMessage === "string" &&
        detailsMessage.includes("Fail to read ligand molecule description") &&
        ligand_raw &&
        ligand_raw !== ligand_bytes
      ) {
        console.warn("[staging] DiffDock failed to parse escaped ligand; retrying with raw ligand content.");
        ({ response, data } = await makeDiffDockRequest(ligand_raw));
      }

      res.status(relayUpstreamStatus(response.status));
      if (response.headers.get("content-type")) {
        res.setHeader("Content-Type", response.headers.get("content-type"));
      }
      if (typeof data === "object") {
        res.json(data);
      } else {
        res.send(data);
      }
    } catch (error) {
      console.error("[staging] DiffDock proxy error:", error.message || error);
      res.status(500).json({ error: "Failed to connect to DiffDock API", details: error.message });
    }
  });

  // ---- Refuse paid/outbound execution in demo mode --------------------------
  router.use((req, res, next) => {
    const path = req.path || "";
    if (isRefusedPath(path)) {
      return res.status(403).json({
        error: "Disabled in this staging demo environment. Paid providers, billing and outbound scientific execution are switched off.",
        code: "DEMO_MODE_DISABLED",
      });
    }
    return next();
  });

  // Nothing else may silently fall through to the Mongo-backed API.
  router.all("/api/*", (_req, res) => {
    res.status(503).json({
      error: "This area is not available in the staging demo (no database).",
      code: "DEMO_MODE_UNAVAILABLE",
    });
  });

  return router;
}
