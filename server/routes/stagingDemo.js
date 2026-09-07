// Staging/demo router (mounted ONLY when PYXIS_DEMO_MODE=true).
//
// Guarantees of this router:
//   - Demo mode is server-controlled. Real paid execution (NVIDIA folding /
//     MolMIM, DiffDock/Asinex docking, simulation, Stripe checkout, email) is
//     refused with 403 DEMO_MODE_DISABLED even if a browser calls the endpoint
//     by hand — and /api/openfold3/predict is answered from the server-side
//     fixture with NO outbound call and no production NVIDIA credentials.
//   - Auth uses the same 401-only-for-dead-session rule and verifies against
//     the staging server's OWN JWT secret (never the production secret), so
//     production tokens are rejected here and staging tokens are rejected by
//     production.
//   - All /api paths that fall through this router are answered with
//     503 DEMO_MODE_UNAVAILABLE instead of silently reaching the Mongo-backed
//     API, because the demo process has no database.
//
// The history endpoints enforce the folding HISTORY CONTRACT (conjunctive
// owner filter, small list rows, bounded blobs, 404 for non-owners) against the
// in-process demo store. Persistent storage across restarts is NOT provided
// here — no separate approved database exists, and production Atlas is
// off-limits — so the UI labels history as demo-only.

import { Router } from "express";
import jwt from "jsonwebtoken";
import { buildFixtureFoldResponse } from "../utils/foldFixture.js";
import { demoStore } from "../utils/foldDemoStore.js";

const DEMO_IDENTITY = Object.freeze({
  userId: "staging-tester-1",
  username: "pyxis-staging-tester",
  email: "staging-tester@pyxis-discovery.test",
  companyId: null, // explicitly company-less: history is scoped with companyId null
  companyName: null,
  role: "member",
  demo: true,
});

// Outbound/billing/paid endpoints that must never run in demo mode. Exact and
// prefix matches only — a prefix like "/api/simulation" must NOT swallow
// "/api/simulation-logs", which is a read endpoint that should fall through to
// the 503 catch-all instead.
const REFUSED_EXACT = [
  "/create-checkout-session",
  "/create-checkout-session-onetime",
  "/api/claim-trial",
  "/api/generate-molecules", // NVIDIA MolMIM
  "/api/simulation",
  "/api/shop",
  "/send-email",
];
const REFUSED_PREFIXES = [
  "/api/billing/",
  "/api/diffdock/",
  "/api/gromacs",
  "/api/glioblastoma",
  "/api/admet",
  "/api/api4/",
  "/api4/",
  "/tanimoto/",
];

function isRefusedPath(path) {
  if (REFUSED_EXACT.includes(path)) return true;
  return REFUSED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function createStagingDemoRouter({ jwtSecret, jwtExpiresIn = "7d" }) {
  const router = Router();

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

