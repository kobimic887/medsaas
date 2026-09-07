// Demo-mode folding-history store (staging runtime only).
//
// There is deliberately NO database on the staging/demo host: the production
// MongoDB Atlas is off-limits, and no separate approved database exists yet.
// This store keeps history inside the server process so the owner can walk the
// full save → list → reopen → download flow in a browser session. It enforces
// the same HISTORY CONTRACT (conjunctive owner filter, small list rows, blob
// limits, no silent deletion) as a future Mongo adapter would, but it is
// ephemeral: a staging service restart clears it. The UI says so.
//
// One bounded storage strategy: metadata + blobs live together in the demo
// store, each structure blob is capped, and a failed save persists nothing
// (no partial blob uploads survive a failed metadata write).

import crypto from "crypto";
import {
  buildOwnerFilter,
  clampPagination,
  isOwner,
  matchesSearch,
  ownerIdentity,
  serializeRunMeta,
  summarizeEntities,
  validateSavePayload,
} from "./foldHistory.js";

export class FoldDemoStore {
  constructor() {
    this.runs = new Map(); // runId -> full run record (meta + blobs)
  }

  /** Create a run. Throws 400/413 on invalid payloads; persists nothing then. */
  async create({ user, payload }) {
    validateSavePayload(payload);
    const identity = ownerIdentity(user);
    if (!identity) {
      throw Object.assign(new Error("Authenticated identity is missing."), { status: 401 });
    }
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    const structures = payload.structures.map((s) => ({
      name: typeof s.name === "string" ? s.name : `${runId}-structure`,
      format: s.format === "mmcif" ? "mmcif" : "pdb",
      text: s.text,
    }));
    const entities = Array.isArray(payload.request?.entities) ? payload.request.entities : [];
    const run = {
      runId,
      ownerUserId: identity.userId,
      ownerCompanyId: identity.companyId,
      ownerUsername: identity.username || null,
      name: String(payload.name).trim(),
      createdAt: now,
      updatedAt: now,
      provider: typeof payload.provider === "string" ? payload.provider : "unknown",
      providerVersion: typeof payload.providerVersion === "string" ? payload.providerVersion : null,
      source: typeof payload.source === "string" ? payload.source : "live-predict",
      demo: payload.demo === true,
      requestId: typeof payload.request?.requestId === "string" ? payload.request.requestId : null,
      outputFormat: structures[0]?.format === "mmcif" ? "mmcif" : "pdb",
      entities,
      entitySummary: summarizeEntities(entities),
      structures: structures.map(({ text, ...meta }) => meta), // meta without text
      blobs: structures, // text held separately from the meta projection
      scoreKeys: Array.isArray(payload.scoreKeys) ? payload.scoreKeys : [],
    };
    this.runs.set(runId, run);
    return serializeRunMeta(run);
  }

  /** Newest-first paginated list for one owner. Returns { items, page, pageSize, total }. */
  async list({ user, pageRaw, pageSizeRaw, search }) {
    const identity = ownerIdentity(user);
    if (!identity) {
      throw Object.assign(new Error("Authenticated identity is missing."), { status: 401 });
    }
    const { page, pageSize } = clampPagination(pageRaw, pageSizeRaw);
    const filter = buildOwnerFilter(user);
    const owned = [...this.runs.values()]
      .filter((run) => filter && run.ownerUserId === filter.ownerUserId && run.ownerCompanyId === filter.ownerCompanyId)
      .filter((run) => matchesSearch(run, search))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    const total = owned.length;
    const start = (page - 1) * pageSize;
    const items = owned.slice(start, start + pageSize).map(serializeRunMeta);
    return { items, page, pageSize, total };
  }

  /** Full run (meta + coordinate blobs) for the owner; null when not found/not owned. */
  async get({ user, runId }) {
    const identity = ownerIdentity(user);
    if (!identity) return null;
    const run = this.runs.get(String(runId || ""));
    if (!run || !isOwner(identity, run)) return null;
    return {
      ...serializeRunMeta(run),
      entities: run.entities || [],
      requestId: run.requestId,
      blobs: run.blobs.map(({ text, ...meta }) => meta),
      structuresWithText: run.blobs.map((b) => ({ ...b })),
    };
  }

  /** Rename the owner's run. Returns the new meta or null. */
  async rename({ user, runId, name }) {
    const identity = ownerIdentity(user);
    if (!identity) return null;
    const run = this.runs.get(String(runId || ""));
    if (!run || !isOwner(identity, run)) return null;
    const trimmed = String(name || "").trim();
    if (!trimmed) {
      throw Object.assign(new Error("Name cannot be empty."), { status: 400, code: "FOLD_NAME_REQUIRED" });
    }
    if (trimmed.length > 120) {
      throw Object.assign(new Error("Name must be 120 characters or fewer."), {
        status: 400,
        code: "FOLD_NAME_TOO_LONG",
      });
    }
    run.name = trimmed;
    run.updatedAt = new Date().toISOString();
    return serializeRunMeta(run);
  }

  /** Delete the owner's run. Returns true when deleted, false when not found/not owned. */
  async remove({ user, runId }) {
    const identity = ownerIdentity(user);
    if (!identity) return false;
    const run = this.runs.get(String(runId || ""));
    if (!run || !isOwner(identity, run)) return false;
    this.runs.delete(run.runId);
    return true;
  }
}

/** Shared instance for the staging process (single-process server). */
export const demoStore = new FoldDemoStore();
