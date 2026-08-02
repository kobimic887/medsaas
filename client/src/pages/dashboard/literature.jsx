import React from "react";
import {
  Card,
  CardHeader,
  CardBody,
  Typography,
  Input,
  Button,
  Alert,
  Spinner,
  Chip,
} from "@material-tailwind/react";
import { MagnifyingGlassIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/solid";
import { API_CONFIG, getAuthToken } from "@/utils/constants";

/**
 * PubMed literature search.
 *
 * Reads the same bearer token every other authed call uses. A same-origin 401 clears the
 * session, so the token has to be attached here rather than left to the browser.
 */
const authedFetch = (url) => {
  const token = getAuthToken();
  return fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
};

// Starting points rather than decoration: a chemist arriving here with nothing typed
// still gets to see what the page does in one click.
const EXAMPLE_QUERIES = [
  "glioblastoma temozolomide resistance",
  "EGFR inhibitor drug design",
  "molecular docking AutoDock validation",
];

export function Literature() {
  const [query, setQuery] = React.useState("");
  const [articles, setArticles] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  // idle | ok | empty so an empty result reads as "nothing matched" rather than as a
  // silent failure — the mistake the Tanimoto page used to make.
  const [status, setStatus] = React.useState("idle");
  const [searchedFor, setSearchedFor] = React.useState("");

  const runSearch = async (term) => {
    const trimmed = (term ?? query).trim();
    if (!trimmed) {
      setError("Enter something to search for");
      return;
    }
    setLoading(true);
    setError("");
    setArticles([]);
    setStatus("idle");
    setSearchedFor(trimmed);
    try {
      const response = await authedFetch(
        API_CONFIG.buildApiUrl(`/pubmed/search?q=${encodeURIComponent(trimmed)}&retmax=20`)
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || `Search failed (HTTP ${response.status})`);
      }
      setArticles(data?.articles || []);
      setTotal(data?.total || 0);
      setStatus((data?.articles || []).length > 0 ? "ok" : "empty");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-12 mb-8 flex flex-col gap-6">
      <Card className="border border-blue-gray-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <CardHeader floated={false} shadow={false} className="rounded-none bg-white dark:bg-slate-900">
          <Typography variant="h5" color="blue-gray" className="dark:text-slate-100">
            Literature Search
          </Typography>
          <Typography variant="small" color="gray" className="mt-1 dark:text-slate-400">
            Search PubMed for published work on a target, compound or disease. Free and
            unmetered — no simulation credits are used.
          </Typography>
        </CardHeader>
        <CardBody className="bg-white pt-0 dark:bg-slate-900">
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              runSearch();
            }}
          >            <div className="flex-1 literature-search-input">
              <Input
                label="Target, compound or disease"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                crossOrigin=""
              />
            </div>
            <Button
              type="submit"
              className="flex items-center justify-center gap-2"
              disabled={loading}
            >
              {loading ? <Spinner className="h-4 w-4" /> : <MagnifyingGlassIcon className="h-4 w-4" />}
              Search
            </Button>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Typography variant="small" color="gray" className="dark:text-slate-400">
              Try:
            </Typography>
            {EXAMPLE_QUERIES.map((example) => (
              <button
                key={example}
                type="button"
                className="rounded-full border border-blue-gray-100 px-3 py-1 text-xs text-blue-gray-700 hover:border-brand-400 hover:text-brand-700 dark:border-slate-700 dark:text-slate-300"
                onClick={() => {
                  setQuery(example);
                  runSearch(example);
                }}
              >
                {example}
              </button>
            ))}
          </div>

          {error && (
            <Alert color="red" className="mt-4">
              {error}
            </Alert>
          )}

          {status === "empty" && (
            <Alert color="blue" className="mt-4">
              No PubMed articles matched “{searchedFor}”. Try broader or fewer terms.
            </Alert>
          )}
        </CardBody>
      </Card>

      {status === "ok" && (
        <Card className="border border-blue-gray-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <CardHeader floated={false} shadow={false} className="rounded-none bg-white dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <Typography variant="h6" color="blue-gray" className="dark:text-slate-100">
                Results
              </Typography>
              <Chip
                value={`${articles.length} shown of ${total.toLocaleString()}`}
                size="sm"
                variant="ghost"
              />
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-4 pt-0">
            {articles.map((article) => (
              <div
                key={article.pmid}
                className="rounded-md border border-blue-gray-100 p-4 dark:border-slate-800"
              >
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 font-medium text-blue-gray-800 hover:text-brand-700 dark:text-slate-100"
                >
                  {article.title}
                  <ArrowTopRightOnSquareIcon className="mt-1 h-4 w-4 shrink-0 opacity-60" />
                </a>
                {article.authors.length > 0 && (
                  <Typography variant="small" color="gray" className="mt-1 dark:text-slate-400">
                    {article.authors.slice(0, 6).join(", ")}
                    {article.authors.length > 6 ? ", et al." : ""}
                  </Typography>
                )}
                <Typography variant="small" color="gray" className="mt-1 dark:text-slate-400">
                  {[article.journal, article.pubdate].filter(Boolean).join(" · ")}
                </Typography>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Chip value={`PMID ${article.pmid}`} size="sm" variant="ghost" />
                  {article.doi && (
                    <a
                      href={`https://doi.org/${article.doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-gray-600 underline hover:text-brand-700 dark:text-slate-400"
                    >
                      doi:{article.doi}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

Literature.displayName = "/src/pages/dashboard/literature.jsx";

export default Literature;
