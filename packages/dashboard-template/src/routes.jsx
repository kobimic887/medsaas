import {
  HomeIcon,
  UserCircleIcon,
  InformationCircleIcon,
  ServerStackIcon,
  RectangleStackIcon,
  CogIcon,
  BeakerIcon,
  Square2StackIcon,
  CubeTransparentIcon,
  CloudIcon,
  ArrowPathIcon
} from "@heroicons/react/24/solid";
import {
  DashboardHome,
  Profile,
  Notifications,
  PaidPlans,
  ControlPanel,
  Simulation,
  MoleculeViewer,
  Molstar3D,
  GenerateMolecules,
  ProteinFolding,
  } from "@/pages/dashboard";
import { DeepSimilarity } from "@/pages/dashboard";
import {
  MainHome,  
  Services,
  AboutUs,
  ContactUs,
  Insights,
  PaidPlansDescription,
  Blog
} from "@/pages/main";

import { SignIn, SignUp } from "@/pages/auth";
import { EyeIcon, GiftIcon } from "@heroicons/react/24/outline";

const icon = {
  className: "w-5 h-5 text-inherit",
};

export const routes = [
  {
    title: "main",
    layout: "main",
    pages: [
      {
          hideFromMenu: true,
        icon: <ServerStackIcon {...icon} />,
        name: "mainHome",
        path: "/mainHome",
        element: <MainHome />,
      },
      {
          hideFromMenu: true,
        icon: <ServerStackIcon {...icon} />,
        name: "services",
        path: "/services",
        element: <Services />,
      },
      {
          hideFromMenu: true,
        icon: <ServerStackIcon {...icon} />,
        name: "about-us",
        path: "/about-us",
        element: <AboutUs />,
      },
      {
          hideFromMenu: true,
        icon: <ServerStackIcon {...icon} />,
        name: "contact-us",
        path: "/contact-us",
        element: <ContactUs />,
      },
      {
          hideFromMenu: true,
        icon: <ServerStackIcon {...icon} />,
        name: "insights",
        path: "/insights",
        element: <Insights />,
      },
      {
          hideFromMenu: true,
        icon: <ServerStackIcon {...icon} />,
        name: "paidplansdescription",
        path: "/paidplansdescription",
        element: <PaidPlansDescription />,
      },
      {
          hideFromMenu: true,
        icon: <ServerStackIcon {...icon} />,
        name: "blog",
        path: "/blog",
        element: <Blog />,
      },
    ],
  },
  {
    layout: "dashboard",
    pages: [      {
        icon: <CogIcon {...icon} />,
        name: "control panel",
        path: "/controlpanel",
        element: <ControlPanel />,
      },
      {
        icon: <EyeIcon {...icon} />,
        name: "simulation",
        path: "/simulation",
        element: <Simulation />,
      },
            {
        icon: <CubeTransparentIcon {...icon} />,
        name: "simulation results",
        path: "/molstar3d",
        element: <Molstar3D />,
      },
      
      {
        icon: <HomeIcon {...icon} />,
        name: "dashboard",
        path: "/dashboardHome",
        element: <DashboardHome />,
      },

      {
          hideFromMenu: true,
        icon: <UserCircleIcon {...icon} />,
        name: "profile",
        path: "/profile",
        element: <Profile />,
      },
      {
        icon: <InformationCircleIcon {...icon} />,
        name: "notifications",
        path: "/notifications",
        element: <Notifications />,
      },
      {
        icon: <GiftIcon {...icon} />,
        name: "paidplans",
        path: "/paidplans",
        element: <PaidPlans />,
      },

      {
        icon: <BeakerIcon {...icon} />,
        name: "RdKit Visualiser",
        path: "/moleculeviewer",
        element: <MoleculeViewer />,
      },      
      {
        icon: <CloudIcon {...icon} />,
        name: "MOLMIM Generate Molecules",
        path: "/generate-molecules",
        element: <GenerateMolecules />,
      },
       {
        icon: <Square2StackIcon {...icon} />,
        name: "Protein Folding",
        path: "/protein-folding",
        element: <ProteinFolding />,
      },
      {
        icon: <ArrowPathIcon {...icon} />,
        name: "deep similarity",
        path: "/deep-similarity",
        element: <DeepSimilarity />,
      },
    ],
  },
  {
    layout: "auth",
    pages: [
      {
        icon: <ServerStackIcon {...icon} />,
        name: "sign in",
        path: "/sign-in",
        element: <SignIn />,
        hideFromMenu: true,
      },
      {        
        icon: <RectangleStackIcon {...icon} />,
        name: "sign up",
        path: "/sign-up",
        element: <SignUp />,
        hideFromMenu: true,
      },
    ],
  },
];

export default routes;

/*
AcademicCapIcon
AdjustmentsHorizontalIcon
ArrowDownIcon
ArrowPathIcon
BeakerIcon
BellIcon
BoltIcon
BookmarkIcon
BriefcaseIcon
BuildingLibraryIcon
CakeIcon
CalendarIcon
CameraIcon
ChartBarIcon
ChatBubbleLeftIcon
CheckCircleIcon
ChevronDownIcon
CircleStackIcon
ClipboardIcon
ClockIcon
CloudIcon
CodeBracketIcon
CogIcon
CubeTransparentIcon
CurrencyDollarIcon
DevicePhoneMobileIcon
DocumentIcon
EnvelopeIcon
ExclamationCircleIcon
EyeIcon
FaceSmileIcon
FlagIcon
GiftIcon
GlobeAltIcon
HandThumbUpIcon
HeartIcon
HomeIcon
IdentificationIcon
InboxIcon
InformationCircleIcon
KeyIcon
LightBulbIcon
LinkIcon
LockClosedIcon
MagnifyingGlassIcon
MapIcon
MegaphoneIcon
MinusIcon
MoonIcon
NewspaperIcon
PaintBrushIcon
PaperAirplaneIcon
PauseIcon
PencilIcon
PhoneIcon
PhotoIcon
PlayIcon
PlusIcon
PowerIcon
PresentationChartBarIcon
PrinterIcon
PuzzlePieceIcon
QrCodeIcon
QuestionMarkCircleIcon
RectangleStackIcon
RocketLaunchIcon
RssIcon
ScaleIcon
ScissorsIcon
ServerStackIcon
ShareIcon
ShieldCheckIcon
ShoppingCartIcon
SignalIcon
SparklesIcon
SpeakerWaveIcon
Square2StackIcon
StarIcon
StopIcon
SunIcon
SwatchIcon
TableCellsIcon
TagIcon
TicketIcon
TrashIcon
TrophyIcon
TruckIcon
TvIcon
UserCircleIcon
UserGroupIcon
UserIcon
VariableIcon
VideoCameraIcon
ViewColumnsIcon
WalletIcon
WifiIcon
WindowIcon
WrenchIcon
XMarkIcon
*/