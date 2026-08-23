import React from "react";
import {
  Typography,
  Card,
  CardHeader,
  CardBody,
  Spinner,
  Alert,
} from "@material-tailwind/react";
import { ArrowUpIcon } from "@heroicons/react/24/outline";
import { StatisticsCard } from "@/widgets/cards";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { API_CONFIG, getAuthToken } from "@/utils/constants";

const DASHBOARD_FETCH_TIMEOUT_MS = 15_000;

export function DashboardHome() {
  const [activityData, setActivityData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [molPriceStats, setMolPriceStats] = React.useState(null);
  const [molPriceStatsError, setMolPriceStatsError] = React.useState(null);
  const [molPriceStatsLoading, setMolPriceStatsLoading] = React.useState(false);

  const fetchActivities = async (signal, didTimeout) => {
    try {
      setLoading(true);
      setError(null);
      const token = getAuthToken();
      const response = await fetch(API_CONFIG.buildApiUrl("/activity"), {
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      setActivityData(await response.json());
    } catch (err) {
      if (err.name === "AbortError") {
        if (didTimeout?.()) setError("Request timed out");
        return;
      }
      console.error("Error fetching activities:", err);
      setError(err.message);
    } finally {
      if (!signal?.aborted || didTimeout?.()) setLoading(false);
    }
  };

  React.useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DASHBOARD_FETCH_TIMEOUT_MS);
    fetchActivities(controller.signal, () => timedOut);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    const fetchMolPriceStats = async () => {
      setMolPriceStatsLoading(true);
      setMolPriceStatsError(null);
      try {
        const response = await fetch(API_CONFIG.buildApiUrl("/mol-price-stats"), {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        setMolPriceStats(await response.json());
      } catch (err) {
        if (err.name === "AbortError") return;
        setMolPriceStatsError(err.message);
      } finally {
        if (!controller.signal.aborted) setMolPriceStatsLoading(false);
      }
    };
    fetchMolPriceStats();
    return () => controller.abort();
  }, []);

  const generateStatistics = () => {
    if (!activityData) return [];

    const totalUsers = activityData.counts?.users ?? activityData.users?.length ?? 0;
    const totalProjects = activityData.counts?.projects ?? activityData.projects?.length ?? 0;
    const totalSimulations = activityData.counts?.simulations ?? activityData.simulations?.length ?? 0;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const recentSimulations = activityData.simulations
      ? activityData.simulations.filter((sim) => new Date(sim.timestamp) > oneWeekAgo).length
      : 0;

    return [
      {
        color: "gray",
        icon: CheckCircleIcon,
        title: "Total Simulations",
        value: totalSimulations.toString(),
        footer: { color: "text-green-500", value: `+${recentSimulations}`, label: "this week" },
      },
      {
        color: "gray",
        icon: CheckCircleIcon,
        title: "Registered Users",
        value: totalUsers.toString(),
        footer: { color: "text-blue-gray-700 dark:text-slate-300", value: "Active", label: "workspace members" },
      },
      {
        color: "gray",
        icon: CheckCircleIcon,
        title: "Projects",
        value: totalProjects.toString(),
        footer: { color: "text-blue-gray-700 dark:text-slate-300", value: "Saved", label: "in this workspace" },
      },
    ];
  };

  const generateOverviewData = () => {
    if (!activityData?.simulations) return [];

    return activityData.simulations.slice(0, 5).map((simulation) => ({
      icon: CheckCircleIcon,
      color: "text-blue-500",
      title: `Docking run · ${simulation.pdbid || "Unknown receptor"}`,
      description: new Date(simulation.timestamp).toLocaleString(),
    }));
  };

  const statisticsData = generateStatistics();
  const overviewData = generateOverviewData();

  return (
    <div className="mt-12">
      {error && (
        <Alert color="red" className="mb-6">
          <Typography variant="small">Error loading dashboard data: {error}</Typography>
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12">
          <Spinner className="h-6 w-6" />
          <Typography variant="small" color="gray">Loading dashboard data...</Typography>
        </div>
      ) : (
        <>
          <div className="mb-12 grid gap-x-6 gap-y-10 md:grid-cols-2 xl:grid-cols-3">
            {statisticsData.map(({ icon, title, footer, ...rest }) => (
              <StatisticsCard
                key={title}
                {...rest}
                title={title}
                icon={React.createElement(icon, { className: "h-6 w-6 text-white" })}
                footer={(
                  <Typography className="font-normal text-blue-gray-600 dark:text-slate-400">
                    <strong className={footer.color}>{footer.value}</strong>&nbsp;{footer.label}
                  </Typography>
                )}
              />
            ))}
          </div>

          <Card className="mb-8 border border-blue-gray-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
            <CardHeader floated={false} shadow={false} color="transparent" className="m-0 p-6">
              <Typography variant="h6" color="blue-gray" className="mb-2 dark:text-slate-50">
                Recent Activity
              </Typography>
              <Typography
                variant="small"
                className="flex items-center gap-1 font-normal text-blue-gray-600 dark:text-slate-400"
              >
                <ArrowUpIcon strokeWidth={3} className="h-3.5 w-3.5 text-green-500" />
                <strong>{overviewData.length}</strong> recent simulations
              </Typography>
            </CardHeader>
            <CardBody className="pt-0">
              {overviewData.length === 0 ? (
                <Typography variant="small" color="gray" className="py-4 text-center">
                  No recent simulation activity
                </Typography>
              ) : (
                overviewData.map(({ icon, color, title, description }, key) => (
                  <div key={title + key} className="flex items-start gap-4 py-3">
                    <div
                      className={`relative p-1 after:absolute after:-bottom-6 after:left-2/4 after:w-0.5 after:-translate-x-2/4 after:bg-blue-gray-50 after:content-[''] dark:after:bg-slate-800 ${
                        key === overviewData.length - 1 ? "after:h-0" : "after:h-4/6"
                      }`}
                    >
                      {React.createElement(icon, { className: `!h-5 !w-5 ${color}` })}
                    </div>
                    <div>
                      <Typography variant="small" color="blue-gray" className="block font-medium dark:text-slate-100">
                        {title}
                      </Typography>
                      <Typography as="span" variant="small" className="text-xs font-medium text-blue-gray-500 dark:text-slate-400">
                        {description}
                      </Typography>
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>

          <div className="mb-8">
            <Typography variant="h6" color="blue-gray" className="mb-2 dark:text-slate-50">
              Molecule Price Stats
            </Typography>
            {molPriceStatsLoading ? (
              <div className="flex items-center gap-2 py-2">
                <Spinner className="h-5 w-5" />
                <Typography variant="small" color="gray">Loading molecule price stats...</Typography>
              </div>
            ) : molPriceStatsError ? (
              <Alert color="red" className="mb-2">
                <Typography variant="small">Error: {molPriceStatsError}</Typography>
              </Alert>
            ) : molPriceStats && Object.keys(molPriceStats).length > 0 ? (
              <Card className="mb-2 border border-blue-gray-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <Typography variant="small" color="blue-gray"><strong>Total Molecules:</strong> {molPriceStats.totalMolecules}</Typography>
                    <Typography variant="small" color="blue-gray"><strong>Avg Price (1mg):</strong> ${molPriceStats.avgPrice1mg}</Typography>
                    <Typography variant="small" color="blue-gray"><strong>Max Price (1mg):</strong> ${molPriceStats.maxPrice1mg}</Typography>
                    <Typography variant="small" color="blue-gray"><strong>Min Price (1mg):</strong> ${molPriceStats.minPrice1mg}</Typography>
                  </div>
                  <div>
                    <Typography variant="small" color="blue-gray"><strong>Avg Molecular Weight:</strong> {molPriceStats.avgMolecularWeight}</Typography>
                    <Typography variant="small" color="blue-gray"><strong>Max Molecular Weight:</strong> {molPriceStats.maxMolecularWeight}</Typography>
                    <Typography variant="small" color="blue-gray"><strong>Min Molecular Weight:</strong> {molPriceStats.minMolecularWeight}</Typography>
                    <Typography variant="small" color="blue-gray"><strong>Total Available (mg):</strong> {molPriceStats.totalAvailableMg}</Typography>
                  </div>
                </div>
              </Card>
            ) : (
              <div className="rounded-xl border border-dashed border-blue-gray-200 bg-blue-gray-50/40 px-5 py-6 dark:border-slate-700 dark:bg-slate-950/30">
                <Typography variant="small" color="blue-gray" className="font-medium dark:text-slate-300">
                  Catalog statistics are unavailable in this environment.
                </Typography>
                <Typography variant="small" color="gray" className="mt-1 dark:text-slate-500">
                  Molecule search and docking remain available; this summary appears when the local price collection has data.
                </Typography>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default DashboardHome;
