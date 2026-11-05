// Normal/full-staging history is durable Atlas data, never the demo Map.
// One bounded document keeps metadata and coordinates atomic. List projections
// exclude coordinates; every operation includes BOTH user and company ownership.
import crypto from 'node:crypto';
import { BSON } from 'mongodb';
import { buildOwnerFilter, clampPagination, ownerIdentity, serializeRunMeta, summarizeEntities, validateSavePayload, finiteFoldScores } from './foldHistory.js';

export class FoldMongoStore {
  constructor(getCollection) {
    this.getCollection = getCollection;
    this.indexReady = null;
  }

  async collection() {
    const collection = this.getCollection();
    this.indexReady ||= Promise.all([
      collection.createIndex({ runId: 1 }, { unique: true }),
      collection.createIndex({ ownerUserId: 1, ownerCompanyId: 1, createdAt: -1, runId: -1 }),
    ]).catch(error => { this.indexReady = null; throw error; });
    await this.indexReady;
    return collection;
  }

  owner(user) {
    const filter = buildOwnerFilter(user);
    if (!filter) throw Object.assign(new Error('Authentication required.'), { status: 401 });
    return filter;
  }

  async create({ user, payload }) {
    const owner = this.owner(user);
    validateSavePayload(payload);
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    const structures = payload.structures.map((s, index) => ({
      name: typeof s.name === 'string' ? s.name.slice(0, 200) : `${runId}-${index}`,
      format: s.format === 'mmcif' ? 'mmcif' : 'pdb', text: s.text, scores: finiteFoldScores(s.scores),
    }));
    const entities = Array.isArray(payload.request?.entities) ? payload.request.entities : [];
    const run = {
      ...owner, runId, name: payload.name.trim(), createdAt: now, updatedAt: now,
      ownerUsername: ownerIdentity(user).username,
      provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
      providerVersion: typeof payload.providerVersion === 'string' ? payload.providerVersion : null,
      source: typeof payload.source === 'string' ? payload.source : 'live-predict',
      demo: payload.demo === true,
      requestId: typeof payload.request?.requestId === 'string' ? payload.request.requestId : null,
      outputFormat: structures[0].format,
      entities, entitySummary: summarizeEntities(entities),
      structures: structures.map(({ text, ...meta }) => meta), blobs: structures,
      scoreKeys: Array.isArray(payload.scoreKeys) ? payload.scoreKeys : [],
    };
    // MongoDB's document ceiling is 16 MiB; fail before inserting anything.
    if (BSON.calculateObjectSize(run) > 15 * 1024 * 1024) {
      throw Object.assign(new Error('This run exceeds the storage limit and was not saved.'), { status: 413, code: 'FOLD_RUN_TOO_LARGE' });
    }
    await (await this.collection()).insertOne(run);
    return serializeRunMeta(run);
  }

  async list({ user, pageRaw, pageSizeRaw, search }) {
    const filter = this.owner(user);
    const { page, pageSize } = clampPagination(pageRaw, pageSizeRaw);
    const query = String(search || '').trim().slice(0, 200);
    if (query) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ name: { $regex: escaped, $options: 'i' } }, { entitySummary: { $regex: escaped, $options: 'i' } }];
    }
    const collection = await this.collection();
    const [rows, total] = await Promise.all([
      collection.find(filter, { projection: { blobs: 0, entities: 0 } }).sort({ createdAt: -1, runId: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      collection.countDocuments(filter),
    ]);
    return { items: rows.map(serializeRunMeta), total, page, pageSize };
  }

  async get({ user, runId }) {
    const run = await (await this.collection()).findOne({ ...this.owner(user), runId: String(runId) });
    if (!run) return null;
    return { ...serializeRunMeta(run), entities: run.entities, requestId: run.requestId,
      blobs: run.structures, structuresWithText: run.blobs };
  }

  async rename({ user, runId, name }) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || trimmed.length > 120) throw Object.assign(new Error('Name must contain 1–120 characters.'), { status: 400 });
    const run = await (await this.collection()).findOneAndUpdate(
      { ...this.owner(user), runId: String(runId) },
      { $set: { name: trimmed, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after', projection: { blobs: 0, entities: 0 } },
    );
    return serializeRunMeta(run);
  }

  async remove({ user, runId }) {
    const result = await (await this.collection()).deleteOne({ ...this.owner(user), runId: String(runId) });
    return result.deletedCount === 1;
  }
}
