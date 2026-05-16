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
import { API_CONFIG } from "@/utils/constants";

export function Notifications() {
  const [showAlerts, setShowAlerts] = React.useState({
    blue: true,
    green: true,
    orange: true,
    red: true,
  });
  const [showAlertsWithIcon, setShowAlertsWithIcon] = React.useState({
    blue: true,
    green: true,
    orange: true,
    red: true,
  });
  const [activities, setActivities] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  
  const alerts = ["gray", "green", "orange", "red"];
  
  // Informational messages array
  const infoMessages = [
    "You can execute simulations from the Simulation tab",
    "Create a project and group your simulations under it", 
    "Subscribe to a paid plan to get execution tokens",
    "Subscribe to our mailing list to get notification over new docking capabilities"
  ];

  // Function to fetch activities from API
  const fetchActivities = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('auth_token');
      const response = await fetch(API_CONFIG.buildApiUrl('/activity'), {
        headers: {
          "Content-Type": "application/json",
          // If you have a token variable, include it; otherwise, remove this line
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
            message: `Simulation by ${sim.user?.username || 'Unknown'} - PDB: ${sim.pdbid}`,
            username: sim.user?.username,
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
        
        // Add user registrations as activities
        if (data.users && Array.isArray(data.users)) {
          const userActivities = data.users.map(user => ({
            type: 'user',
            message: `User: ${user.username} (${user.email}) registered`,
            username: user.username,
            email: user.email,
            timestamp: null, // No timestamp in user data
            id: user._id
          }));
          activitiesArray = [...activitiesArray, ...userActivities];
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
  const formatTimestamp = (timestamp) => {
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
      <Card>
        <CardHeader
          color="transparent"
          floated={false}
          shadow={false}
          className="m-0 p-4"
        >
          <div className="flex items-center justify-between">
            <Typography variant="h5" color="blue-gray">
              Latest Activities
            </Typography>
            <Typography
              variant="small"
              color="blue"
              className="cursor-pointer hover:underline"
              onClick={fetchActivities}
            >
              Refresh
            </Typography>
          </div>
        </CardHeader>
        <CardBody className="p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8">
              <Spinner className="h-4 w-4" />
              <Typography variant="small" color="gray">
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
            <Typography variant="small" color="gray" className="text-center py-8">
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
                    className="max-w-md"
                    title={fullText}
                  />
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Information Tips Card */}
      <Card>
        <CardHeader
          color="transparent"
          floated={false}
          shadow={false}
          className="m-0 p-4"
        >
          <Typography variant="h5" color="blue-gray">
            Tips & Information
          </Typography>
        </CardHeader>
        <CardBody className="p-4">
          <div className="flex flex-col gap-3">
            {infoMessages.map((message, index) => (
              <Alert
                key={index}
                color="blue"
                variant="ghost"
                className="border border-blue-200"
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
