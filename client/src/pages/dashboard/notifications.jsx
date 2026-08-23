import React from "react";
import {
  Typography,
  Alert,
  Card,
  CardHeader,
  CardBody,
  Chip,
  Spinner,
} from "@material-tailwind/react";
import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { API_CONFIG, getAuthToken } from "@/utils/constants";

const NOTIFICATIONS_FETCH_TIMEOUT_MS = 15_000;

export function Notifications() {
  const [_showAlerts, _setShowAlerts] = React.useState({
    blue: true,
    green: true,
    orange: true,
    red: true,
  });
  const [_showAlertsWithIcon, _setShowAlertsWithIcon] = React.useState({
    blue: true,
    green: true,
    orange: true,
    red: true,
  });
  const [activities, setActivities] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const activityControllerRef = React.useRef(null);
  const activityTimeoutRef = React.useRef(null);
  
  const _alerts = ["gray", "green", "orange", "red"];
  
  // Informational messages array
  const infoMessages = [
    "Run docking from the Simulation tab, then inspect every ranked pose in Simulation Results.",
    "Use Deep Similarity to search the molecular corpus by exact match, similarity, or substructure.",
    "Literature Search queries PubMed without using simulation credits.",
    "Plans & Credits shows available execution-credit options."
  ];

  // Function to fetch activities from API
  const fetchActivities = async () => {
    activityControllerRef.current?.abort();
    window.clearTimeout(activityTimeoutRef.current);
    const controller = new AbortController();
    activityControllerRef.current = controller;
    let timedOut = false;
    activityTimeoutRef.current = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, NOTIFICATIONS_FETCH_TIMEOUT_MS);
    try {
      setLoading(true);
      setError(null);
      const token = getAuthToken();
      const response = await fetch(API_CONFIG.buildApiUrl('/activity'), {
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Handle the specific API response format with users, projects, and simulations
      let activitiesArray = [];
      
      if (data) {
        // Extract simulations as activities (most recent activity)
        if (data.simulations && Array.isArray(data.simulations)) {
          activitiesArray = data.simulations.map(sim => ({
            type: 'simulation',
            message: `Simulation by ${sim.username || sim.user?.username || 'Unknown'} - PDB: ${sim.pdbid}`,
            username: sim.username || sim.user?.username,
            pdbid: sim.pdbid,
            simulationKey: sim.simulationKey,
            timestamp: sim.timestamp,
            id: sim._id
          }));
        }
        
        // Add projects as activities
        if (data.projects && Array.isArray(data.projects)) {
          const projectActivities = data.projects.map(project => ({
            type: 'project',
            message: `Project "${project.name} Created" by ${project.userid}`,
            username: project.userid,
            projectName: project.name,
            timestamp: project.createdAt,
            id: project._id
          }));
          activitiesArray = [...activitiesArray, ...projectActivities];
        }
        
        // Sort by timestamp (most recent first), handle null timestamps
        activitiesArray.sort((a, b) => {
          const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return timeB - timeA;
        });
        
        // Limit to most recent 20 activities
        activitiesArray = activitiesArray.slice(0, 20);
      }
      
      setActivities(activitiesArray);
    } catch (err) {
      if (err.name === 'AbortError') {
        if (timedOut) setError('Request timed out');
        return;
      }
      console.error('Error fetching activities:', err);
      setError(err.message);
    } finally {
      window.clearTimeout(activityTimeoutRef.current);
      if (activityControllerRef.current === controller) {
        activityControllerRef.current = null;
        setLoading(false);
      }
    }
  };

  // Fetch activities on component mount
  React.useEffect(() => {
    fetchActivities();
    return () => {
      activityControllerRef.current?.abort();
      window.clearTimeout(activityTimeoutRef.current);
    };
  }, []);

  // Function to get chip color based on activity type or status
  const getActivityChipColor = (activity) => {
    if (activity.type) {
      switch (activity.type.toLowerCase()) {
        case 'simulation':
          return 'blue';
        case 'project':
          return 'green';
        case 'user':
          return 'purple';
        case 'success':
        case 'completed':
          return 'green';
        case 'warning':
        case 'pending':
          return 'amber';
        case 'error':
        case 'failed':
          return 'red';
        case 'info':
        case 'started':
          return 'blue';
        default:
          return 'gray';
      }
    }
    return 'blue';
  };

  // Function to format timestamp
  const _formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="mx-auto my-20 flex max-w-screen-lg flex-col gap-8">
      {/* Latest Activities Card */}
      <Card className="border border-blue-gray-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <CardHeader
          color="transparent"
          floated={false}
          shadow={false}
          className="m-0 bg-white p-4 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between">
            <Typography variant="h5" color="blue-gray" className="dark:text-slate-50">
              Latest Activities
            </Typography>
            <button
              type="button"
              className="text-sm font-medium text-blue-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-blue-300"
              onClick={fetchActivities}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
        </CardHeader>
        <CardBody className="bg-white p-4 dark:bg-slate-900">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8">
              <Spinner className="h-4 w-4" />
              <Typography variant="small" color="gray" className="dark:text-slate-400">
                Loading activities...
              </Typography>
            </div>
          ) : error ? (
            <Alert color="red" className="mb-4">
              <Typography variant="small">
                Error loading activities: {error}
              </Typography>
            </Alert>
          ) : !Array.isArray(activities) || activities.length === 0 ? (
            <Typography variant="small" color="gray" className="py-8 text-center dark:text-slate-400">
              No activities found.
            </Typography>
          ) : (
            <div className="flex flex-wrap gap-2">
              {activities.map((activity, index) => {
                const fullText = activity.message || `Activity ${index + 1}`;
                const shortText = fullText.length > 50 ? fullText.slice(0, 50) + '…' : fullText;
                return (
                  <Chip
                    key={activity.id || index}
                    value={shortText}
                    color={getActivityChipColor(activity)}
                    variant="ghost"
                    size="sm"
                    // Material Tailwind's ghost variant pairs dark text with a pale
                    // tint, which assumes a light card. On the dark dashboard the
                    // tint stays dark and the text stays dark with it: measured
                    // text-blue-900 (rgb 13,71,161) on rgba(33,150,243,.2), which is
                    // unreadable. Every activity was effectively invisible.
                    //
                    // Styled by an explicit rule in tailwind.css rather than utility
                    // classes: `dark:!text-slate-100` lands in the class attribute but
                    // Tailwind never emits a rule for it here, so the computed colour
                    // stayed rgb(13,71,161). The colour coding is not lost — it lives
                    // in the background tint, which stays per-status.
                    className="max-w-md cb-activity-chip"
                    title={fullText}
                  />
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Information Tips Card */}
      <Card className="border border-blue-gray-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <CardHeader
          color="transparent"
          floated={false}
          shadow={false}
          className="m-0 bg-white p-4 dark:bg-slate-900"
        >
          <Typography variant="h5" color="blue-gray" className="dark:text-slate-50">
            Tips & Information
          </Typography>
        </CardHeader>
        <CardBody className="bg-white p-4 dark:bg-slate-900">
          <div className="flex flex-col gap-3">
            {infoMessages.map((message, index) => (
              <Alert
                key={index}
                color="blue"
                variant="ghost"
                // Same dark-mode problem as the activity chips above: ghost keeps
                // its dark foreground while the tint goes dark, so every tip was
                // unreadable on the dashboard's default theme.
                className="border border-blue-200 dark:border-slate-700 cb-activity-chip"
                icon={<InformationCircleIcon className="h-5 w-5" />}
              >
                <Typography variant="small" className="font-medium">
                  {message}
                </Typography>
              </Alert>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* System Information Card 
      <Card>
        <CardHeader
          color="transparent"
          floated={false}
          shadow={false}
          className="m-0 p-4"
        >
          <Typography variant="h5" color="blue-gray">
            System Information
          </Typography>
        </CardHeader>
        <CardBody className="flex flex-col gap-4 p-4">
          {alerts.map((color) => (
            <Alert
              key={color}
              open={showAlerts[color]}
              color={color}
              onClose={() => setShowAlerts((current) => ({ ...current, [color]: false }))}
            >
              A simple {color} alert with an <a href="#">example link</a>. Give
              it a click if you like.
            </Alert>
          ))}
        </CardBody>
      </Card>
   */}
    </div>
  );
}

export default Notifications;
