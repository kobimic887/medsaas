import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import {
  createJobPoller, isActiveJob, isCompleteJob, jobStatusLabel, markJobUnfollowable, pickRecentJob, pickResumableJob, pollFailureMessage, progressOf,
  UNAVAILABLE_JOB_MESSAGE,
} from '../client/src/utils/linkFragmentsJobs.js';
import { linkFragmentsRequest } from '../client/src/utils/linkFragmentsRequest.js';

const job = (state, examined, total, extra = {}) => ({ id: 'j1', state, complete: state === 'completed' && examined === total, partial: !(state === 'completed' && examined === total), progress: { totalPairs: total, examinedPairs: examined, conformersExamined: examined, validPlacements: 2, distanceWindow: { lo: 4, hi: 6 } }, results: [], ...extra });

// 1. Labels: only a service-complete, fully examined scan is called complete.
assert.equal(jobStatusLabel(job('completed', 4681, 4681)).detail, 'Complete search: all 4,681 distance-compatible pairs examined.');
assert.equal(jobStatusLabel(job('completed', 4681, 4681)).tone, 'success');
for (const [state, examined, total, expected] of [['queued', 0, 100, /Queued/], ['running', 50, 100, /partial/i], ['canceled', 40, 100, /Canceled/], ['failed', 40, 100, /failed/i], ['canceled', 100, 100, /Canceled/], ['failed', 100, 100, /failed/i]]) {
  const label = jobStatusLabel(job(state, examined, total, { error: state === 'failed' ? { code: 'WORKER_CRASHED', message: 'Worker stopped.' } : null }));
  assert.match(`${label.title} ${label.detail}`, expected);
  assert.doesNotMatch(`${label.title} ${label.detail}`, /complete search|all .* examined/i, `${state} is never labelled complete`);
}
const lying = { ...job('completed', 99, 100), complete: true };
assert.equal(isCompleteJob(lying), false, 'a complete flag without every pair examined is still partial');
assert.match(jobStatusLabel(lying).title, /Partial/);
assert.match(jobStatusLabel({ ...job('canceled', 100, 100), complete: true }).title, /Canceled/, 'canceled with a stray complete flag stays canceled');
assert.match(jobStatusLabel(job('failed', 3, 10, { error: { message: 'Index unreadable.' } })).detail, /^Index unreadable\. Stopped with 3 of 10/);
assert.equal(progressOf(job('running', 999999, 1000000)).percent, 99.9, 'an unfinished scan never rounds to 100 %');
assert.equal(progressOf(job('canceled', 100, 100)).percent, 99.9);
assert.equal(progressOf(job('completed', 0, 0)).percent, 100, 'an empty distance window completes at 100 %');
assert.equal(progressOf(job('running', 150, 100)).examined, 100);
assert.equal(pickResumableJob([job('completed', 1, 1, { id: 'a', createdAt: '2026-09-30T10:00:00Z' }), job('running', 1, 2, { id: 'b', createdAt: '2026-09-30T09:00:00Z' }), job('queued', 0, 2, { id: 'c', createdAt: '2026-09-30T11:00:00Z' })]).id, 'c');
assert.equal(pickResumableJob([job('canceled', 1, 2)]), null);
assert.equal(pickResumableJob(undefined), null);
// Regression: a scan that finished while the user was elsewhere can be reopened.
const history = [
  job('completed', 1, 1, { id: 'old', createdAt: '2026-09-30T08:00:00Z', finishedAt: '2026-09-30T08:30:00Z' }),
  job('canceled', 1, 2, { id: 'new', createdAt: '2026-09-30T07:00:00Z', finishedAt: '2026-09-30T09:00:00Z' }),
  job('running', 1, 2, { id: 'live', createdAt: '2026-09-30T10:00:00Z' }),
];
assert.equal(pickRecentJob(history).id, 'new', 'newest by finish time, running jobs excluded');
assert.match(jobStatusLabel(pickRecentJob(history)).title, /Canceled/, 'a reopened partial scan keeps its partial label');
assert.equal(pickRecentJob([job('running', 1, 2)]), null);
assert.equal(pickRecentJob(null), null);

// Regression: a job the page can no longer follow must become terminal locally,
// otherwise the query form stays locked behind a 'running' job forever.
const running = job('running', 40, 100, { results: [{ id: '1-2-3' }] });
const gone = markJobUnfollowable(running, pollFailureMessage({ status: 404 }));
assert.equal(gone.state, 'failed'); assert.equal(gone.local, true); assert.equal(isActiveJob(gone), false, 'form unlocks');
assert.equal(gone.error.message, 'This search is no longer available on the scientific service; results shown are partial.');
assert.equal(gone.error.message, UNAVAILABLE_JOB_MESSAGE);
assert.deepEqual(gone.results, running.results, 'last known partial products stay visible');
const goneLabel = jobStatusLabel(gone);
assert.match(goneLabel.title, /No longer followed · partial/); assert.match(goneLabel.detail, /no longer available.*40 of 100/);
assert.doesNotMatch(`${goneLabel.title} ${goneLabel.detail}`, /complete search/i);
assert.match(pollFailureMessage({ status: 503, message: 'Link Fragments is temporarily unavailable.' }), /^Stopped following this search \(Link Fragments is temporarily unavailable\.\); results shown are partial\.$/);
const finished = job('completed', 10, 10);
assert.equal(markJobUnfollowable(finished), finished, 'a terminal job is never rewritten');
assert.equal(markJobUnfollowable(null), null);
const page = readFileSync(new URL('../client/src/pages/dashboard/link-fragments.jsx', import.meta.url), 'utf8');
assert(page.includes('setJob(previous => markJobUnfollowable(previous, pollFailureMessage(failure)))'), 'fatal poll errors end the local job');
assert(/failure\.status === 404\) \{[^}]*poller\.current\.stop\(\);\s*setJob\(previous => previous\?\.id === id \? markJobUnfollowable\(previous\)/.test(page), 'cancel 404 ends the local job');
assert(page.includes('pickResumableJob(jobs)') && !page.includes('pickRecentJob(jobs)'), 'fresh page resumes active scans only; finished searches open from Home');
assert(page.includes("failure.code === 'LINK_FRAGMENTS_OWNER_BUSY'") && page.includes('resumeLatestJob(ownerBusy.jobId)'), 'owner-busy shows the running job with progress and Cancel');

// 2. Poller state machine with manual timers.
function harness(responses) {
  const timers = []; const updates = []; const errors = []; const fetches = [];
  const poller = createJobPoller({
    interval: 1000, maxFailures: 3,
    schedule: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length - 1; },
    unschedule: id => { timers[id].cleared = true; },
    fetchJob: (id, controller) => {
      const next = responses.shift();
      fetches.push({ id, controller });
      return typeof next === 'function' ? next(controller) : next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    onUpdate: value => updates.push(value), onError: (error, info) => errors.push({ error, ...info }),
  });
  const pending = () => timers.filter(timer => !timer.cleared && !timer.ran);
  const fire = async () => { const timer = pending()[0]; assert(timer, 'a poll is scheduled'); timer.ran = true; timer.fn(); await flush(); };
  return { poller, timers, updates, errors, fetches, pending, fire };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
{
  const h = harness([job('queued', 0, 10), job('running', 5, 10), job('completed', 10, 10)]);
  h.poller.start('j1'); await flush();
  assert.equal(h.updates.length, 1); assert.equal(h.pending()[0].ms, 1000);
  await h.fire(); await h.fire();
  assert.deepEqual(h.updates.map(value => value.state), ['queued', 'running', 'completed']);
  assert.equal(h.pending().length, 0, 'terminal state stops polling');
  assert.equal(h.poller.jobId, null);
}
{
  let release;
  const h = harness([controller => new Promise(resolve => { release = resolve; controller.signal.addEventListener('abort', () => {}); })]);
  h.poller.start('j1');
  h.poller.stop();
  assert.equal(h.fetches[0].controller.signal.aborted, true, 'stop aborts the in-flight poll');
  release(job('running', 1, 10)); await flush();
  assert.equal(h.updates.length, 0, 'a late response after stop never updates state');
  assert.equal(h.pending().length, 0, 'and never schedules another poll');
}
{
  let releaseOld;
  const h = harness([() => new Promise(resolve => { releaseOld = resolve; }), { ...job('running', 2, 10), id: 'j2' }]);
  h.poller.start('j1');
  h.poller.start('j2'); await flush();
  releaseOld(job('completed', 10, 10)); await flush();
  assert.deepEqual(h.updates.map(value => value.id), ['j2'], 'a response for the previous job cannot overwrite the new one');
  assert.equal(h.poller.jobId, 'j2');
  h.poller.stop();
}
{
  const gone = Object.assign(new Error('Search job not found.'), { status: 404 });
  const h = harness([gone]);
  h.poller.start('j1'); await flush();
  assert.equal(h.errors[0].fatal, true); assert.equal(h.pending().length, 0, '404 stops polling');
}
// Page wiring: the poller's fatal onError ends the local job, for 404 and for repeated failures.
for (const failures of [[Object.assign(new Error('Search job not found.'), { status: 404 })], Array.from({ length: 3 }, () => Object.assign(new Error('down'), { status: 503 }))]) {
  let local = job('running', 5, 10);
  const timers = [];
  const poller = createJobPoller({
    interval: 1, maxFailures: 3, schedule: fn => { timers.push(fn); return timers.length; }, unschedule: () => {},
    fetchJob: () => Promise.reject(failures.shift()),
    onUpdate: value => { local = value; },
    onError: (failure, { fatal }) => { if (fatal) local = markJobUnfollowable(local, pollFailureMessage(failure)); },
  });
  poller.start('j1'); await flush();
  while (timers.length) { timers.shift()(); await flush(); }
  assert.equal(isActiveJob(local), false, 'the form unlocks after a fatal poll error');
  assert.equal(local.state, 'failed'); assert.equal(poller.jobId, null);
}
{
  const down = Object.assign(new Error('unavailable'), { status: 503 });
  const h = harness([down, job('running', 1, 10), down, down, down]);
  h.poller.start('j1'); await flush();
  assert.equal(h.errors[0].fatal, false); assert.equal(h.pending()[0].ms, 2000, 'transient errors back off');
  await h.fire();
  assert.equal(h.updates.length, 1); assert.equal(h.pending()[0].ms, 1000, 'success resets the backoff');
  await h.fire(); await h.fire(); await h.fire();
  assert.deepEqual(h.errors.map(error => error.fatal), [false, false, false, true], 'repeated failures eventually stop');
  assert.equal(h.pending().length, 0);
}
{
  const h = harness([{ ...job('running', 1, 10), id: 'other' }]);
  h.poller.start('j1'); await flush();
  assert.match(h.errors[0].error.message, /unexpected job/);
  h.poller.stop();
}
{
  const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const h = harness([aborted]);
  h.poller.start('j1'); await flush();
  assert.equal(h.errors.length, 0, 'aborts are silent');
}

// 3. Real HTTP lifecycle: create → poll partial results → cancel → canceled partial.
const state = { job: null, polls: 0, cancels: 0 };
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  res.setHeader('Content-Type', 'application/json');
  if (req.headers.authorization !== 'Bearer lifecycle-token') { res.statusCode = 401; return res.end('{}'); }
  if (req.method === 'POST' && req.url === '/jobs') {
    state.job = { ...job('queued', 0, 1000), id: '0b5f8f0e-6f4c-4c7e-9a51-3c1d2e4f5a6b', query: JSON.parse(body) };
    res.statusCode = 202; return res.end(JSON.stringify({ job: state.job }));
  }
  if (req.url === `/jobs/${state.job?.id}`) {
    state.polls++;
    if (state.job.state !== 'canceled') {
      const examined = Math.min(1000, state.polls * 150);
      state.job = { ...state.job, state: 'running', progress: { ...state.job.progress, examinedPairs: examined }, results: [{ id: `${state.polls}-1-2`, rank: 1, rmsd: 0.3 }] };
    }
    return res.end(JSON.stringify({ job: state.job }));
  }
  if (req.method === 'POST' && req.url === `/jobs/${state.job?.id}/cancel`) {
    state.cancels++;
    state.job = { ...state.job, state: 'canceled', complete: false, partial: true, finishedAt: new Date().toISOString() };
    return res.end(JSON.stringify({ job: state.job }));
  }
  res.statusCode = 404; res.end(JSON.stringify({ code: 'JOB_NOT_FOUND' }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, controller, body) => linkFragmentsRequest(base + path, { controller, token: 'lifecycle-token', body });
  const created = await call('/jobs', new AbortController(), { sdf: 'fixture', attachments: [1, { atom: 6, hydrogenAtom: 7 }], maxRmsd: 0.75, limit: 20 });
  const seen = [];
  let resolveTerminal;
  const terminal = new Promise(resolve => { resolveTerminal = resolve; });
  const poller = createJobPoller({ interval: 5, fetchJob: (id, controller) => call(`/jobs/${id}`, controller).then(data => data.job), onUpdate: value => { seen.push(value); if (value.state === 'canceled') resolveTerminal(value); }, onError: error => { throw error; } });
  poller.start(created.job.id);
  while (!seen.some(value => value.progress.examinedPairs >= 300)) await new Promise(resolve => setTimeout(resolve, 5));
  assert(seen.at(-1).results.length > 0, 'partial results arrive while running');
  assert.match(jobStatusLabel(seen.at(-1)).title, /partial/i);
  const canceled = await call(`/jobs/${created.job.id}/cancel`, new AbortController(), {});
  assert.equal(canceled.job.state, 'canceled');
  poller.start(created.job.id);
  const final = await terminal;
  await new Promise(resolve => setTimeout(resolve, 30));
  const pollsAfter = state.polls;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(state.polls, pollsAfter, 'polling stops after the terminal state');
  assert.equal(final.complete, false);
  const label = jobStatusLabel(final);
  assert.match(label.title, /Canceled/); assert.match(label.detail, /Results are partial/);
  assert.doesNotMatch(label.detail, /Complete search/);
  assert.deepEqual(state.job.query.attachments, [1, { atom: 6, hydrogenAtom: 7 }]);
  poller.stop();
  // Cancel of a job the service no longer has: 404 → local terminal state.
  const missing = await call('/jobs/11111111-2222-4333-8444-555555555555/cancel', new AbortController(), {}).catch(error => error);
  assert.equal(missing.status, 404);
  assert.equal(isActiveJob(markJobUnfollowable(job('running', 1, 10))), false);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
console.log('✓ Link Fragments jobs: honest labels, reopen finished scans, poll/stop/restart, stale-response guards, backoff, fatal-error unlock and real HTTP cancel lifecycle passed');
