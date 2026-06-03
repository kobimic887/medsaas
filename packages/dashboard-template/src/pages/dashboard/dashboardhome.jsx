import React from "react";
import {
  Typography,
  Card,
  CardHeader,
  CardBody,
  IconButton,
  Menu,
  MenuHandler,
  MenuList,
  MenuItem,
  Avatar,
  Tooltip,
  Progress,
  Spinner,
  Alert,
} from "@material-tailwind/react";
import {
  EllipsisVerticalIcon,
  ArrowUpIcon,
} from "@heroicons/react/24/outline";
import { StatisticsCard } from "@/widgets/cards";
import { StatisticsChart } from "@/widgets/charts";
import {
  statisticsCardsData,
  statisticsChartsData,
  projectsTableData,
  ordersOverviewData,
} from "@/data";
import { CheckCircleIcon, ClockIcon } from "@heroicons/react/24/solid";
import { Link } from "react-router-dom";
import { API_CONFIG } from "@/utils/constants";


export function DashboardHome() {
  const [activityData, setActivityData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [molPriceStats, setMolPriceStats] = React.useState(null);
  const [molPriceStatsError, setMolPriceStatsError] = React.useState(null);
  const [molPriceStatsLoading, setMolPriceStatsLoading] = React.useState(false);

  // Function to fetch activities from API
  const fetchActivities = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('auth_token');
      const response = await fetch(API_CONFIG.buildApiUrl('/activity'), {
        headers: {
          "Content-Type": "application/json",
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setActivityData(data);
    } catch (err) {
      console.error('Error fetching activities:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch activities on component mount
  React.useEffect(() => {
    fetchActivities();
  }, []);

  // Fetch molecule price stats
  React.useEffect(() => {
    const fetchMolPriceStats = async () => {
      setMolPriceStatsLoading(true);
      setMolPriceStatsError(null);
      try {
        const response = await fetch(API_CONFIG.buildApiUrl('/mol-price-stats'), {
          headers: { 'accept': 'application/json' }
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        setMolPriceStats(data);
      } catch (err) {
        setMolPriceStatsError(err.message);
      } finally {
        setMolPriceStatsLoading(false);
      }
    };
    fetchMolPriceStats();
  }, []);

  // Generate statistics from API data
  const generateStatistics = () => {
    if (!activityData) return [];
    
    const totalUsers = activityData.users ? activityData.users.length : 0;
    const totalProjects = activityData.projects ? activityData.projects.length : 0;
    const totalSimulations = activityData.simulations ? activityData.simulations.length : 0;
    
    // Calculate recent simulations (last 7 days)
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const recentSimulations = activityData.simulations ? 
      activityData.simulations.filter(sim => new Date(sim.timestamp) > oneWeekAgo).length : 0;

    return [
      {
        color: "gray",
        icon: CheckCircleIcon,
        title: "Total Simulations",
        value: totalSimulations.toString(),
        footer: {
          color: "text-green-500",
          value: `+${recentSimulations}`,
          label: "this week"
        }
      },
      {
        color: "gray", 
        icon: CheckCircleIcon,
        title: "Active Projects",
        value: totalProjects.toString(),
        footer: {
          color: "text-blue-500",
          value: "100%",
          label: "active"
        }
      },
      {
        color: "gray",
        icon: CheckCircleIcon, 
        title: "Registered Users",
        value: totalUsers.toString(),
        footer: {
          color: "text-green-500",
          value: "+3",
          label: "this month"
        }
      },
      {
        color: "gray",
        icon: CheckCircleIcon,
        title: "Success Rate",
        value: "94%",
        footer: {
          color: "text-green-500",
          value: "+2%",
          label: "from last month"
        }
      }
    ];
  };

  // Generate projects table data from API
  const generateProjectsData = () => {
    if (!activityData || !activityData.projects) return [];
    
    return activityData.projects.map((project, index) => {
      // Find simulations for this project
      const projectSimulations = activityData.simulations ? 
        activityData.simulations.filter(sim => sim.user?.username === project.userid) : [];
      
      // Calculate completion based on simulation count (mock logic)
      const completion = Math.min(100, projectSimulations.length * 25);
      
      return {
        img: "/img/logo-ct.png", // Default project image
        name: project.name,
        members: [
          {
            img: "/img/team-1.jpeg",
            name: project.userid
          }
        ],
        budget: `${projectSimulations.length} simulations`,
        completion: completion
      };
    });
  };

  // Generate recent activities overview
  const generateOverviewData = () => {
    if (!activityData) return [];
    
    const activities = [];
    
    // Add recent simulations
    if (activityData.simulations) {
      const recentSims = activityData.simulations.slice(0, 3);
      recentSims.forEach(sim => {
        activities.push({
          icon: CheckCircleIcon,
          color: "text-blue-500",
          title: `Simulation by ${sim.user?.username || 'Unknown'}`,
          description: `PDB: ${sim.pdbid} - ${new Date(sim.timestamp).toLocaleDateString()}`
        });
      });
    }
    
    // Add recent projects
    if (activityData.projects) {
      const recentProjects = activityData.projects.slice(0, 2);
      recentProjects.forEach(project => {
        activities.push({
          icon: CheckCircleIcon,
          color: "text-green-500", 
          title: `Project: ${project.name}`,
          description: `Created by ${project.userid} - ${new Date(project.createdAt).toLocaleDateString()}`
        });
      });
    }
    
    return activities.slice(0, 5); // Limit to 5 items
  };

  const statisticsData = generateStatistics();
  const projectsData = generateProjectsData();
  const overviewData = generateOverviewData();
  return (
    <div className="mt-12">
      {error && (
        <Alert color="red" className="mb-6">
          <Typography variant="small">
            Error loading dashboard data: {error}
          </Typography>
        </Alert>
      )}
      
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12">
          <Spinner className="h-6 w-6" />
          <Typography variant="small" color="gray">
            Loading dashboard data...
          </Typography>
        </div>
      ) : (
        <>
          <div className="mb-12 grid gap-y-10 gap-x-6 md:grid-cols-2 xl:grid-cols-4">
            {statisticsData.map(({ icon, title, footer, ...rest }) => (
              <StatisticsCard
                key={title}
                {...rest}
                title={title}
                icon={React.createElement(icon, {
                  className: "w-6 h-6 text-white",
                })}
                footer={
                  <Typography className="font-normal text-blue-gray-600">
                    <strong className={footer.color}>{footer.value}</strong>
                    &nbsp;{footer.label}
                  </Typography>
                }
              />
            ))}
          </div>
          <div className="mb-6 grid grid-cols-1 gap-y-12 gap-x-6 md:grid-cols-2 xl:grid-cols-3">
            {statisticsChartsData.map((props) => (
              <StatisticsChart
                key={props.title}
                {...props}
                footer={
                  <Typography
                    variant="small"
                    className="flex items-center font-normal text-blue-gray-600"
                  >
                    <ClockIcon strokeWidth={2} className="h-4 w-4 text-blue-gray-400" />
                    &nbsp;{props.footer}
                  </Typography>
                }
              />
            ))}
          </div>
          <div className="mb-4 grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card className="overflow-hidden xl:col-span-2 border border-blue-gray-100 shadow-sm">
              <CardHeader
                floated={false}
                shadow={false}
                color="transparent"
                className="m-0 flex items-center justify-between p-6"
              >
                <div>
                  <Typography variant="h6" color="blue-gray" className="mb-1">
                    Projects
                  </Typography>
                  <Typography
                    variant="small"
                    className="flex items-center gap-1 font-normal text-blue-gray-600"
                  >
                    <CheckCircleIcon strokeWidth={3} className="h-4 w-4 text-blue-gray-200" />
                    <strong>{projectsData.length} active</strong> projects
                  </Typography>
                </div>
                <Menu placement="left-start">
                  <MenuHandler>
                    <IconButton size="sm" variant="text" color="blue-gray">
                      <EllipsisVerticalIcon
                        strokeWidth={3}
                        fill="currenColor"
                        className="h-6 w-6"
                      />
                    </IconButton>
                  </MenuHandler>
                  <MenuList>
                    <MenuItem>Refresh</MenuItem>
                    <MenuItem>View All</MenuItem>
                    <MenuItem>Export Data</MenuItem>
                  </MenuList>
                </Menu>
              </CardHeader>
              <CardBody className="overflow-x-scroll px-0 pt-0 pb-2">
                <table className="w-full min-w-[640px] table-auto">
                  <thead>
                    <tr>
                      {["project", "owner", "simulations", "progress"].map(
                        (el) => (
                          <th
                            key={el}
                            className="border-b border-blue-gray-50 py-3 px-6 text-left"
                          >
                            <Typography
                              variant="small"
                              className="text-[11px] font-medium uppercase text-blue-gray-400"
                            >
                              {el}
                            </Typography>
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {projectsData.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="py-8 text-center">
                          <Typography variant="small" color="gray">
                            No projects found
                          </Typography>
                        </td>
                      </tr>
                    ) : (
                      projectsData.map(
                        ({ img, name, members, budget, completion }, key) => {
                          const className = `py-3 px-5 ${
                            key === projectsData.length - 1
                              ? ""
                              : "border-b border-blue-gray-50"
                          }`;

                          return (
                            <tr key={name}>
                              <td className={className}>
                                <div className="flex items-center gap-4">
                                  <Avatar src={img} alt={name} size="sm" />
                                  <Typography
                                    variant="small"
                                    color="blue-gray"
                                    className="font-bold"
                                  >
                                    {name}
                                  </Typography>
                                </div>
                              </td>
                              <td className={className}>
                                {members.map(({ img, name }, key) => (
                                  <Tooltip key={name} content={name}>
                                    <Avatar
                                      src={img}
                                      alt={name}
                                      size="xs"
                                      variant="circular"
                                      className={`cursor-pointer border-2 border-white ${
                                        key === 0 ? "" : "-ml-2.5"
                                      }`}
                                    />
                                  </Tooltip>
                                ))}
                              </td>
                              <td className={className}>
                                <Typography
                                  variant="small"
                                  className="text-xs font-medium text-blue-gray-600"
                                >
                                  {budget}
                                </Typography>
                              </td>
                              <td className={className}>
                                <div className="w-10/12">
                                  <Typography
                                    variant="small"
                                    className="mb-1 block text-xs font-medium text-blue-gray-600"
                                  >
                                    {completion}%
                                  </Typography>
                                  <Progress
                                    value={completion}
                                    variant="gradient"
                                    color={completion === 100 ? "green" : "blue"}
                                    className="h-1"
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        }
                      )
                    )}
                  </tbody>
                </table>
              </CardBody>
            </Card>
            <Card className="border border-blue-gray-100 shadow-sm">
              <CardHeader
                floated={false}
                shadow={false}
                color="transparent"
                className="m-0 p-6"
              >
                <Typography variant="h6" color="blue-gray" className="mb-2">
                  Recent Activity
                </Typography>
                <Typography
                  variant="small"
                  className="flex items-center gap-1 font-normal text-blue-gray-600"
                >
                  <ArrowUpIcon
                    strokeWidth={3}
                    className="h-3.5 w-3.5 text-green-500"
                  />
                  <strong>{overviewData.length}</strong> recent activities
                </Typography>
              </CardHeader>
              <CardBody className="pt-0">
                {overviewData.length === 0 ? (
                  <Typography variant="small" color="gray" className="text-center py-4">
                    No recent activity
                  </Typography>
                ) : (
                  overviewData.map(
                    ({ icon, color, title, description }, key) => (
                      <div key={title + key} className="flex items-start gap-4 py-3">
                        <div
                          className={`relative p-1 after:absolute after:-bottom-6 after:left-2/4 after:w-0.5 after:-translate-x-2/4 after:bg-blue-gray-50 after:content-[''] ${
                            key === overviewData.length - 1
                              ? "after:h-0"
                              : "after:h-4/6"
                          }`}
                        >
                          {React.createElement(icon, {
                            className: `!w-5 !h-5 ${color}`,
                          })}
                        </div>
                        <div>
                          <Typography
                            variant="small"
                            color="blue-gray"
                            className="block font-medium"
                          >
                            {title}
                          </Typography>
                          <Typography
                            as="span"
                            variant="small"
                            className="text-xs font-medium text-blue-gray-500"
                          >
                            {description}
                          </Typography>
                        </div>
                      </div>
                    )
                  )
                )}
              </CardBody>
            </Card>
          </div>
          <div className="mb-8">
            <Typography variant="h6" color="blue-gray" className="mb-2">Molecule Price Stats</Typography>
            {molPriceStatsLoading ? (
              <div className="flex items-center gap-2 py-2">
                <Spinner className="h-5 w-5" />
                <Typography variant="small" color="gray">Loading molecule price stats...</Typography>
              </div>
            ) : molPriceStatsError ? (
              <Alert color="red" className="mb-2">
                <Typography variant="small">Error: {molPriceStatsError}</Typography>
              </Alert>
            ) : molPriceStats ? (
              <Card className="mb-2 p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

export default DashboardHome;
