import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_CONFIG, getAuthToken } from '@/utils/constants';
import { isActiveJob, isCompleteJob, jobStatusLabel, progressOf } from '@/utils/linkFragmentsJobs';
import { linkFragmentsRequest } from '@/utils/linkFragmentsRequest';

const date = value => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Date unavailable' : parsed.toLocaleString();
};
const atom = value => typeof value === 'number' ? value : value?.atom;
function queryLabel(job) {
  const atoms = job.query?.attachments?.map(atom);
  return atoms?.length === 2 ? `Atoms ${atoms[0]} + ${atoms[1]}${job.query?.receptorReport ? ' · receptor' : ''}` : 'Two-fragment search';
}

export function LinkFragmentHistory() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const controller = useRef(null);
  async function refresh() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true); setError('');
    try {
      const data = await linkFragmentsRequest(API_CONFIG.buildApiUrl('/link-fragments/jobs'), {
        controller: request, token: getAuthToken(), timeout: 15000,
      });
      if (controller.current === request && !request.signal.aborted) setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
    } catch (failure) {
      if (controller.current === request && failure.name !== 'AbortError') setError(failure.message);
    } finally {
      if (controller.current === request) setLoading(false);
    }
  }
  useEffect(() => { refresh(); return () => controller.current?.abort(); }, []);
  const shown = jobs.filter(job => filter === 'all' || (filter === 'active' ? isActiveJob(job) : filter === 'complete' ? isCompleteJob(job) : !isActiveJob(job) && !isCompleteJob(job)));
  return (
    <section id="linker-history" aria-labelledby="linker-history-heading" className="mb-8 scroll-mt-24 rounded-xl border border-blue-gray-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="linker-history-heading" className="text-lg font-semibold text-blue-gray-900 dark:text-white">Linker searches</h2>
        <div className="flex gap-4 text-sm font-semibold">
          <button type="button" onClick={refresh} disabled={loading} className="underline disabled:opacity-50">Refresh searches</button>
          <Link to="/dashboard/link-fragments" className="text-brand-600 underline dark:text-brand-200">New linker search</Link>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Automatically saved for up to 30 days.</p>
      {loading && <p role="status" className="mt-4 text-sm dark:text-slate-200">Loading searches…</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">Could not load linker searches: {error}</p>}
      {!loading && !error && (
        <>
          {jobs.length > 0 && <fieldset className="mt-4 flex flex-wrap gap-2" aria-label="Filter linker searches">
            {[['all', 'All'], ['active', 'Running'], ['complete', 'Complete'], ['partial', 'Stopped / partial']].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-full border px-3 py-1 text-xs ${filter === value ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200'}`}>{label}</button>)}
          </fieldset>}
          {shown.length ? <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-700">
            {shown.map(job => <li key={job.id}>
              <Link to={`/dashboard/link-fragments?job=${encodeURIComponent(job.id)}`} className="flex flex-wrap items-center justify-between gap-3 rounded px-2 py-3 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800" aria-label={`Open linker search from ${date(job.createdAt)}`}>
                <div><p className="text-sm font-medium dark:text-white">{date(job.createdAt)}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{queryLabel(job)}</p></div>
                <div className="text-right"><p className="text-sm dark:text-slate-200">{jobStatusLabel(job).title}</p>{isActiveJob(job) && <p className="text-xs text-slate-500 dark:text-slate-300">{progressOf(job).percent.toFixed(1)}%</p>}</div>
              </Link>
            </li>)}
          </ul> : <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">{jobs.length ? 'No searches in this filter.' : 'Your linker searches will appear here.'}</p>}
        </>
      )}
    </section>
  );
}
