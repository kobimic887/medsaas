// Home search history ("search repository"): every successful Home search is
// remembered once per owner and distinct (collection, search type, queries).
// Re-running the same search updates its settings and recency instead of adding
// a duplicate. Every operation carries BOTH user and company ownership, the
// same conjunctive rule as folding history. Queries are the researcher's own
// structures/IDs; they are never shared across owners.
import crypto from 'node:crypto';
import { buildOwnerFilter, ownerIdentity } from './foldHistory.js';

// Owner request (2026-11): at most 100 distinct searches per user; the oldest-run entry drops first.
export const SEARCH_HISTORY_MAX_PER_OWNER = 100;
export const SEARCH_HISTORY_MAX_QUERIES = 20;
export const SEARCH_HISTORY_MAX_QUERY_LENGTH = 4000;
const MODES = new Set(['similarity', 'id', 'exact', 'substructure']);
const SINGLE_SOURCES = new Set(['stock', 'both', 'real', 'virtual', 'open']);
const MULTI_COLLECTIONS = new Set(['stock', 'smallvirtual', 'real', 'virtual']);

const invalid = (message) => Object.assign(new Error(message), { status: 400, code: 'SEARCH_HISTORY_INVALID' });

function validSource(source) {
  if (typeof source !== 'string') return false;
  if (SINGLE_SOURCES.has(source)) return true;
  if (!source.startsWith('multi:')) return false;
  const parts = source.slice(6).split(',');
  return parts.length >= 1 && parts.length <= 4 && new Set(parts).size === parts.length && parts.every((part) => MULTI_COLLECTIONS.has(part));
}

/** Normalised, validated record fields. Throws a 400 error for bad input. */
export function normalizeSearchRecord(payload) {
  if (!payload || typeof payload !== 'object') throw invalid('A search record is required.');
  const { source, mode } = payload;
  if (!validSource(source)) throw invalid('Unknown collection.');
  if (!MODES.has(mode)) throw invalid('Unknown search type.');
  if (!Array.isArray(payload.queries) || payload.queries.length === 0 || payload.queries.length > SEARCH_HISTORY_MAX_QUERIES) {
    throw invalid(`Provide 1–${SEARCH_HISTORY_MAX_QUERIES} queries.`);
  }
  const queries = payload.queries.map((query) => (typeof query === 'string' ? query.trim() : ''));
  if (queries.some((query) => !query || query.length > SEARCH_HISTORY_MAX_QUERY_LENGTH)) {
    throw invalid(`Each query must contain 1–${SEARCH_HISTORY_MAX_QUERY_LENGTH} characters.`);
  }
  const raw = payload.settings && typeof payload.settings === 'object' ? payload.settings : {};
  const settings = {};
  if (Number.isFinite(raw.threshold) && raw.threshold >= 0 && raw.threshold <= 1) settings.threshold = raw.threshold;
  for (const key of ['fingerprint', 'metric']) {
    if (typeof raw[key] === 'string' && /^[a-z_]{1,40}$/.test(raw[key])) settings[key] = raw[key];
  }
  if (typeof raw.openUseAi === 'boolean') settings.openUseAi = raw.openUseAi;
  // Identity ignores settings: one entry per distinct query in a collection/mode.
  const key = crypto.createHash('sha256').update(JSON.stringify([source, mode, queries])).digest('hex');
  return { key, source, mode, queries, settings };
}

function serialize(doc) {
  if (!doc) return null;
  return {
    searchId: doc.searchId,
    source: doc.source,
    mode: doc.mode,
    queries: doc.queries,
    settings: doc.settings || {},
    runCount: doc.runCount || 1,
    createdAt: doc.createdAt,
    lastRunAt: doc.lastRunAt,
  };
}

export class CompoundSearchStore {
  constructor(getCollection) {
    this.getCollection = getCollection;
    this.indexReady = null;
  }

  async collection() {
    const collection = this.getCollection();
    this.indexReady ||= Promise.all([
      collection.createIndex({ ownerUserId: 1, ownerCompanyId: 1, key: 1 }, { unique: true }),
      collection.createIndex({ searchId: 1 }, { unique: true }),
      collection.createIndex({ ownerUserId: 1, ownerCompanyId: 1, lastRunAt: -1 }),
    ]).catch((error) => { this.indexReady = null; throw error; });
    await this.indexReady;
    return collection;
  }

  owner(user) {
    const filter = buildOwnerFilter(user);
    if (!filter) throw Object.assign(new Error('Authentication required.'), { status: 401 });
    return filter;
  }

  async record({ user, payload }) {
    const owner = this.owner(user);
    const record = normalizeSearchRecord(payload);
    const now = new Date().toISOString();
    const collection = await this.collection();
    const filter = { ...owner, key: record.key };
    const update = {
      $set: { settings: record.settings, lastRunAt: now },
      $inc: { runCount: 1 },
      $setOnInsert: {
        ...owner, key: record.key, searchId: crypto.randomUUID(), ownerUsername: ownerIdentity(user).username,
        source: record.source, mode: record.mode, queries: record.queries, createdAt: now,
      },
    };
    let doc;
    try {
      doc = await collection.findOneAndUpdate(filter, update, { upsert: true, returnDocument: 'after' });
    } catch (error) {
      // Two concurrent first runs of one search race on the unique key; the
      // loser updates the winner's document.
      if (error?.code !== 11000) throw error;
      doc = await collection.findOneAndUpdate(filter, { $set: update.$set, $inc: update.$inc }, { returnDocument: 'after' });
    }
    if (doc?.runCount === 1) await this.prune(collection, owner);
    return serialize(doc);
  }

  // Keep each owner's history bounded; the least recently run entries go first.
  async prune(collection, owner) {
    const excess = (await collection.countDocuments(owner)) - SEARCH_HISTORY_MAX_PER_OWNER;
    if (excess <= 0) return;
    const stale = await collection.find(owner, { projection: { _id: 1 } }).sort({ lastRunAt: 1 }).limit(excess).toArray();
    if (stale.length) await collection.deleteMany({ ...owner, _id: { $in: stale.map((entry) => entry._id) } });
  }

  async list({ user, limitRaw, search }) {
    const filter = this.owner(user);
    const parsed = Math.floor(Number(limitRaw));
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 20;
    const text = String(search || '').trim().slice(0, 200);
    if (text) filter.queries = { $regex: text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const collection = await this.collection();
    const [rows, total] = await Promise.all([
      collection.find(filter).sort({ lastRunAt: -1, searchId: -1 }).limit(limit).toArray(),
      collection.countDocuments(filter),
    ]);
    return { items: rows.map(serialize), total, limit };
  }

  async remove({ user, searchId }) {
    const result = await (await this.collection()).deleteOne({ ...this.owner(user), searchId: String(searchId) });
    return result.deletedCount === 1;
  }
}
