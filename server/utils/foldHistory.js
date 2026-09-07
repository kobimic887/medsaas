// Folding-history contract helpers (shared by the storage adapters and routes).
//
// Predictions are private to the submitting user. Company membership alone must
// never grant access, so the ownership filter is deliberately CONJUNCTIVE —
// unlike the OR-based simulation_logs tenant filter, which exists for legacy
// dual-shape rows and must NOT be reused here:
//
//   ownerUserId      === the submitting user's stable id
//   AND ownerCompanyId === the submitting user's company (or null when the
//                         user has no company — never omit the tenancy clause,
//                         or a row could broaden access by accident)
//
// A same-company peer fails the first clause; a cross-company user fails the
// second. Reads/rename/delete/blob access all go through the same conjunction,
// and non-owners get a uniform 404 (no existence oracle).

export const FOLD_NAME_MAX = 120;
export const FOLD_STRUCTURES_MAX = 20;
export const FOLD_STRUCTURE_TEXT_MAX_BYTES = 3 * 1024 * 1024; // 3 MB per blob
export const FOLD_RUN_TEXT_MAX_BYTES = 20 * 1024 * 1024; // 20 MB per run
export const FOLD_LIST_PAGE_SIZE_DEFAULT = 8;
export const FOLD_LIST_PAGE_SIZE_MAX = 20;

/** Stable identity for a prediction owner. Prefers the JWT userId. */
export function ownerIdentity(user) {
  if (!user) return null;
  const userId = typeof user.userId === "string" && user.userId ? user.userId : null;
  const username = typeof user.username === "string" && user.username ? user.username : null;
  if (!userId && !username) return null;
  return {
    userId: userId || `user:${username}`,
    username,
    companyId: user.companyId && typeof user.companyId === "string" ? user.companyId : null,
  };
}

/** Strict conjunctive filter. Returns null when the caller has no identity. */
export function buildOwnerFilter(user) {
  const identity = ownerIdentity(user);
  if (!identity) return null;
  return {
    ownerUserId: identity.userId,
    ownerCompanyId: identity.companyId,
  };
}

/** True when the run belongs to this user under the conjunctive rule. */
export function isOwner(identity, run) {
  if (!identity || !run) return false;
  return (
    run.ownerUserId === identity.userId &&
    (run.ownerCompanyId || null) === identity.companyId
  );
}

/** Normalise a page/pageSize pair; returns { page, pageSize }. */
export function clampPagination(pageRaw, pageSizeRaw) {
  const page = Number.isFinite(Number(pageRaw)) && Number(pageRaw) >= 1 ? Math.floor(Number(pageRaw)) : 1;
  const parsedSize = Number.isFinite(Number(pageSizeRaw)) ? Math.floor(Number(pageSizeRaw)) : FOLD_LIST_PAGE_SIZE_DEFAULT;
  const pageSize = Math.min(Math.max(parsedSize, 1), FOLD_LIST_PAGE_SIZE_MAX);
  return { page, pageSize };
}

/** Safe, case-insensitive "does name/entity summary contain q" match. */
export function matchesSearch(run, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  if (String(run.name || "").toLowerCase().includes(q)) return true;
  if (String(run.entitySummary || "").toLowerCase().includes(q)) return true;
  return false;
}

/** One-line entity summary used in list rows: "A protein (46 aa), B DNA (12 nt)". */
export function summarizeEntities(entities) {
  if (!Array.isArray(entities) || entities.length === 0) return "";
  return entities
    .map((e) => {
      const label =
        e.type === "protein" ? "protein" : e.type === "dna" ? "DNA" : e.type === "rna" ? "RNA" : "ligand";
      const unit = e.type === "protein" ? "aa" : e.type === "ligand" ? "atoms" : "nt";
      const length = Number.isFinite(Number(e.length)) ? Number(e.length) : "?";
      return `${e.id} ${label} (${length} ${unit})`;
    })
    .join(", ");
}

/** Validate a save payload before anything is persisted. Returns { ok } or throws. */
export function validateSavePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw Object.assign(new Error("Missing history payload."), { status: 400 });
  }
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) {
    throw Object.assign(new Error("Give this prediction a name."), { status: 400, code: "FOLD_NAME_REQUIRED" });
  }
  if (name.length > FOLD_NAME_MAX) {
    throw Object.assign(new Error(`Name must be ${FOLD_NAME_MAX} characters or fewer.`), {
      status: 400,
      code: "FOLD_NAME_TOO_LONG",
    });
  }
  const structures = Array.isArray(payload.structures) ? payload.structures : [];
  if (!structures.length) {
    throw Object.assign(new Error("Nothing to save — the run has no structures."), {
      status: 400,
      code: "FOLD_NO_STRUCTURES",
    });
  }
  if (structures.length > FOLD_STRUCTURES_MAX) {
    throw Object.assign(new Error(`A run can hold at most ${FOLD_STRUCTURES_MAX} structures.`), {
      status: 400,
      code: "FOLD_TOO_MANY_STRUCTURES",
    });
  }
  let totalBytes = 0;
  for (const s of structures) {
    if (!s || typeof s.text !== "string") {
      throw Object.assign(new Error("A structure is missing its coordinate text."), {
        status: 400,
        code: "FOLD_STRUCTURE_INVALID",
      });
    }
    const bytes = Buffer.byteLength(s.text, "utf8");
    if (bytes > FOLD_STRUCTURE_TEXT_MAX_BYTES) {
      throw Object.assign(new Error("A single structure exceeds the size limit and was not saved."), {
        status: 413,
        code: "FOLD_STRUCTURE_TOO_LARGE",
      });
    }
    totalBytes += bytes;
  }
  if (totalBytes > FOLD_RUN_TEXT_MAX_BYTES) {
    throw Object.assign(new Error("This run exceeds the total storage limit and was not saved."), {
      status: 413,
      code: "FOLD_RUN_TOO_LARGE",
    });
  }
  return true;
}

/** Small list-row projection — never includes coordinate blobs or raw scores. */
export function serializeRunMeta(run) {
  if (!run) return null;
  return {
    runId: run.runId,
    name: run.name,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt || run.createdAt,
    provider: run.provider,
    providerVersion: run.providerVersion || null,
    source: run.source,
    demo: run.demo === true,
    requestId: run.requestId || null,
    outputFormat: run.outputFormat,
    entitySummary: run.entitySummary || "",
    structureCount: Array.isArray(run.structures) ? run.structures.length : 0,
    scoreKeys: run.scoreKeys || [],
  };
}
