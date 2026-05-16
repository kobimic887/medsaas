import {
  Card,
  CardBody,
  CardHeader,
  CardFooter,
  Avatar,
  Typography,
  Tabs,
  TabsHeader,
  Tab,
  Switch,
  Tooltip,
  Button,
  Spinner,
  Alert,
} from "@material-tailwind/react";
import {
  HomeIcon,
  ChatBubbleLeftEllipsisIcon,
  Cog6ToothIcon,
  PencilIcon,
} from "@heroicons/react/24/solid";
import { Link } from "react-router-dom";
import { ProfileInfoCard, MessageCard } from "@/widgets/cards";
import { platformSettingsData, conversationsData, projectsData } from "@/data";
import React from "react";
import { API_CONFIG } from "@/utils/constants";

export function Profile() {
  const [userProfile, setUserProfile] = React.useState(null);
  const [userProjects, setUserProjects] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  // Function to fetch user profile and related data
  const fetchUserProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('auth_token');
      
      // First, get activity data to extract user info
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
      
      // Try to get current user from token or find user from activity data
      let currentUser = null;
      
      // Try to decode token to get username (basic approach)
      if (token) {
        try {
          const tokenPayload = JSON.parse(atob(token.split('.')[1]));
          const username = tokenPayload.username;
          
          // Find user in the users array
          if (data.users && Array.isArray(data.users)) {
            currentUser = data.users.find(user => user.username === username);
          }
        } catch (tokenError) {
          console.warn('Could not decode token:', tokenError);
        }
      }
      
      // If no user found from token, use the first user as fallback
      if (!currentUser && data.users && data.users.length > 0) {
        currentUser = data.users[0];
      }
      
      if (currentUser) {
        setUserProfile(currentUser);
        
        // Get user's projects
        if (data.projects && Array.isArray(data.projects)) {
          const userProjects = data.projects.filter(project => 
            project.userid === currentUser.username
          );
          setUserProjects(userProjects);
        }
      } else {
        throw new Error('No user profile found');
      }
      
    } catch (err) {
      console.error('Error fetching user profile:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch profile on component mount
  React.useEffect(() => {
    fetchUserProfile();
  }, []);

  // Generate user display name
  const getDisplayName = () => {
    if (!userProfile) return 'Loading...';
    return userProfile.username || 'Unknown User';
  };

  // Generate user role/title
  const getUserRole = () => {
    if (!userProfile) return 'Loading...';
    return 'Researcher'; // Default role, could be enhanced with actual role data
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 mt-8">
        <Spinner className="h-6 w-6" />
        <Typography variant="small" color="gray">
          Loading profile...
        </Typography>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-8">
        <Alert color="red" className="mb-6">
          <Typography variant="small">
            Error loading profile: {error}
          </Typography>
        </Alert>
      </div>
    );
  }
  return (
    <>
      <div className="relative mt-8 h-72 w-full overflow-hidden rounded-xl bg-[url('/img/background-image.png')] bg-cover	bg-center">
        <div className="absolute inset-0 h-full w-full bg-gray-900/75" />
      </div>
      <Card className="mx-3 -mt-16 mb-6 lg:mx-4 border border-blue-gray-100">
        <CardBody className="p-4">
          <div className="mb-10 flex items-center justify-between flex-wrap gap-6">
            <div className="flex items-center gap-6">
              <Avatar
                src="/img/bruce-mars.jpeg"
                alt="bruce-mars"
                size="xl"
                variant="rounded"
                className="rounded-lg shadow-lg shadow-blue-gray-500/40"
              />
              <div>
                <Typography variant="h5" color="blue-gray" className="mb-1">
                  {getDisplayName()}
                </Typography>
                <Typography
                  variant="small"
                  className="font-normal text-blue-gray-600"
                >
                  {getUserRole()}
                </Typography>
              </div>
            </div>
            <div className="w-96">
              <Tabs value="app">
                <TabsHeader>
                  <Tab value="app">
                    <HomeIcon className="-mt-1 mr-2 inline-block h-5 w-5" />
                    App
                  </Tab>
                  <Tab value="message">
                    <ChatBubbleLeftEllipsisIcon className="-mt-0.5 mr-2 inline-block h-5 w-5" />
                    Message
                  </Tab>
                  <Tab value="settings">
                    <Cog6ToothIcon className="-mt-1 mr-2 inline-block h-5 w-5" />
                    Settings
                  </Tab>
                </TabsHeader>
              </Tabs>
            </div>
          </div>
          <div className="gird-cols-1 mb-12 grid gap-12 px-4 lg:grid-cols-2 xl:grid-cols-3">
            <div>
              <Typography variant="h6" color="blue-gray" className="mb-3">
                Platform Settings
              </Typography>
              <div className="flex flex-col gap-12">
                {platformSettingsData.map(({ title, options }) => (
                  <div key={title}>
                    <Typography className="mb-4 block text-xs font-semibold uppercase text-blue-gray-500">
                      {title}
                    </Typography>
                    <div className="flex flex-col gap-6">
                      {options.map(({ checked, label }) => (
                        <Switch
                          key={label}
                          id={label}
                          label={label}
                          defaultChecked={checked}
                          labelProps={{
                            className: "text-sm font-normal text-blue-gray-500",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <ProfileInfoCard
              title="Profile Information"
              description={`Hi, I'm ${getDisplayName()}, a researcher using the molecular simulation platform. Passionate about drug discovery and computational chemistry.`}
              details={{
                "username": userProfile?.username || "N/A",
                email: userProfile?.email || "N/A",
                "user id": userProfile?._id || "N/A",
                projects: `${userProjects.length} active projects`,
                social: (
                  <div className="flex items-center gap-4">
                    <i className="fa-brands fa-github text-gray-700" />
                    <i className="fa-brands fa-linkedin text-blue-500" />
                    <i className="fa-brands fa-twitter text-blue-400" />
                  </div>
                ),
              }}
              action={
                <Tooltip content="Edit Profile">
                  <PencilIcon className="h-4 w-4 cursor-pointer text-blue-gray-500" />
                </Tooltip>
              }
            />
            <div>
              <Typography variant="h6" color="blue-gray" className="mb-3">
                Platform Settings
              </Typography>
              <ul className="flex flex-col gap-6">
                {conversationsData.map((props) => (
                  <MessageCard
                    key={props.name}
                    {...props}
                    action={
                      <Button variant="text" size="sm">
                        reply
                      </Button>
                    }
                  />
                ))}
              </ul>
            </div>
          </div>
          <div className="px-4 pb-4">
            <Typography variant="h6" color="blue-gray" className="mb-2">
              My Projects
            </Typography>
            <Typography
              variant="small"
              className="font-normal text-blue-gray-500"
            >
              {userProjects.length > 0 ? `${userProjects.length} active projects` : 'No projects found'}
            </Typography>
            <div className="mt-6 grid grid-cols-1 gap-12 md:grid-cols-2 xl:grid-cols-4">
              {userProjects.length === 0 ? (
                <div className="col-span-full text-center py-8">
                  <Typography variant="small" color="gray">
                    No projects found. Create your first project to get started!
                  </Typography>
                </div>
              ) : (
                userProjects.map((project) => (
                  <Card key={project._id} color="transparent" shadow={false}>
                    <CardHeader
                      floated={false}
                      color="gray"
                      className="mx-0 mt-0 mb-4 h-64 xl:h-40"
                    >
                      <div className="h-full w-full bg-gradient-to-r from-blue-400 to-blue-600 flex items-center justify-center">
                        <Typography variant="h4" color="white">
                          {project.name.charAt(0).toUpperCase()}
                        </Typography>
                      </div>
                    </CardHeader>
                    <CardBody className="py-0 px-1">
                      <Typography
                        variant="small"
                        className="font-normal text-blue-gray-500"
                      >
                        Project
                      </Typography>
                      <Typography
                        variant="h5"
                        color="blue-gray"
                        className="mt-1 mb-2"
                      >
                        {project.name}
                      </Typography>
                      <Typography
                        variant="small"
                        className="font-normal text-blue-gray-500"
                      >
                        Created: {new Date(project.createdAt).toLocaleDateString()}
                      </Typography>
                    </CardBody>
                    <CardFooter className="mt-6 flex items-center justify-between py-0 px-1">
                      <Link to="/dashboard/simulation">
                        <Button variant="outlined" size="sm">
                          view project
                        </Button>
                      </Link>
                      <div>
                        <Tooltip content={userProfile?.username}>
                          <Avatar
                            src="/img/team-1.jpeg"
                            alt={userProfile?.username}
                            size="xs"
                            variant="circular"
                            className="cursor-pointer border-2 border-white"
                          />
                        </Tooltip>
                      </div>
                    </CardFooter>
                  </Card>
                ))
              )}
              {/* Show static projects as examples if user has projects */}
              {userProjects.length > 0 && projectsData.slice(0, 2).map(
                ({ img, title, description, tag, route, members }) => (
                  <Card key={title} color="transparent" shadow={false}>
                    <CardHeader
                      floated={false}
                      color="gray"
                      className="mx-0 mt-0 mb-4 h-64 xl:h-40"
                    >
                      <img
                        src={img}
                        alt={title}
                        className="h-full w-full object-cover opacity-50"
                      />
                    </CardHeader>
                    <CardBody className="py-0 px-1">
                      <Typography
                        variant="small"
                        className="font-normal text-blue-gray-400"
                      >
                        {tag} (Example)
                      </Typography>
                      <Typography
                        variant="h5"
                        color="blue-gray"
                        className="mt-1 mb-2 opacity-60"
                      >
                        {title}
                      </Typography>
                      <Typography
                        variant="small"
                        className="font-normal text-blue-gray-400"
                      >
                        {description}
                      </Typography>
                    </CardBody>
                    <CardFooter className="mt-6 flex items-center justify-between py-0 px-1">
                      <Button variant="outlined" size="sm" disabled>
                        example
                      </Button>
                      <div>
                        {members.slice(0, 2).map(({ img, name }, key) => (
                          <Tooltip key={name} content={name}>
                            <Avatar
                              src={img}
                              alt={name}
                              size="xs"
                              variant="circular"
                              className={`cursor-pointer border-2 border-white opacity-60 ${
                                key === 0 ? "" : "-ml-2.5"
                              }`}
                            />
                          </Tooltip>
                        ))}
                      </div>
                    </CardFooter>
                  </Card>
                )
              )}
            </div>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

export default Profile;
