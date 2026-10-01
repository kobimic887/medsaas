// This writable database is separate from the immutable linker collection. It
// contains private uploaded queries and results, never public catalog rows.
import { Database } from 'bun:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function createJobStore(path, { maxBytes = 128 * 1024 * 1024, maxJobBytes = 16 * 1024 * 1024 } = {}) {
  if (path === null) return null; // Explicit test-only opt-out.
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path, { create: true });
  chmodSync(path, 0o600);
  // FULL auto-vacuum returns deleted pages to disk. DELETE avoids an unbounded
  // WAL; each throttled checkpoint is one atomic, synchronous transaction.
  db.exec('PRAGMA auto_vacuum = FULL; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL,
    finished_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL,
    payload TEXT NOT NULL, bytes INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS jobs_finished ON jobs(finished_ms);`);
  const put = db.query('INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,state=excluded.state,finished_ms=excluded.finished_ms,updated_ms=excluded.updated_ms,payload=excluded.payload,bytes=excluded.bytes');
  const remove = db.query('DELETE FROM jobs WHERE id = ?');
  const total = db.query('SELECT coalesce(sum(bytes),0) AS bytes FROM jobs');
  const trimBytes = () => {
    let bytes = total.get().bytes;
    const removed = [];
    if (bytes <= maxBytes) return removed;
    for (const row of db.query('SELECT id,bytes FROM jobs WHERE finished_ms > 0 ORDER BY finished_ms ASC,id ASC').all()) {
      if (bytes <= maxBytes) break;
      remove.run(row.id); bytes -= row.bytes; removed.push(row.id);
    }
    if (bytes > maxBytes) throw new Error('Active linker jobs exceed the history storage budget.');
    return removed;
  };
  const saveTransaction = db.transaction((job, payload, bytes) => {
    put.run(job.id, job.owner, job.state, job.finishedMs || 0, Date.now(), payload, bytes);
    return trimBytes();
  });
  return {
    path,
    load() { return db.query('SELECT payload FROM jobs ORDER BY updated_ms ASC').all().map((row) => JSON.parse(row.payload)); },
    save(job) {
      const payload = JSON.stringify(job), bytes = Buffer.byteLength(payload);
      if (bytes > maxJobBytes) throw new Error('The linker search exceeds the per-job history storage budget.');
      return saveTransaction(job, payload, bytes);
    },
    remove(id) { remove.run(id); },
    prune({ now = Date.now(), ttlMs, retainPerOwner, retainTotal }) {
      return db.transaction(() => {
        const removed = [], owners = new Map(); let kept = 0;
        for (const row of db.query('SELECT id,owner,finished_ms FROM jobs WHERE finished_ms > 0 ORDER BY finished_ms DESC,id DESC').all()) {
          const count = (owners.get(row.owner) || 0) + 1; owners.set(row.owner, count);
          if (now - row.finished_ms > ttlMs || count > retainPerOwner || ++kept > retainTotal) { remove.run(row.id); removed.push(row.id); }
        }
        return removed.concat(trimBytes());
      })();
    },
    close() { db.close(); },
  };
}
