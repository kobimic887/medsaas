import {
  HomeIcon,
  InformationCircleIcon,
  ServerStackIcon,
  CogIcon,
  BeakerIcon,
  Square2StackIcon,
  CubeTransparentIcon,
  CloudIcon,
  ArrowPathIcon,
  BuildingOfficeIcon,
  CreditCardIcon,
  BookOpenIcon
} from "@heroicons/react/24/solid";
import { lazy } from "react";

// Every page is loaded on demand. Eagerly importing them here — which is what the
// barrel files in pages/*/index.js encourage — put all 24 pages, the whole
// Material Tailwind surface and apexcharts into one 2.0 MB entry chunk, which every
// visitor downloaded in full before seeing the sign-in form. They are split per
// route instead; the Suspense boundaries live in the three layouts.
//
// Import the page modules directly, NOT through "@/pages/dashboard". A barrel
// re-exports all fourteen siblings, so lazy() through it would pull the entire
// directory into the first chunk that touched it and undo the split silently.
// Every page file has a default export, so no interop shim is needed.
const DashboardHome = lazy(() => import("@/pages/dashboard/dashboardhome"));
const Notifications = lazy(() => import("@/pages/dashboard/notifications"));
const ControlPanel = lazy(() => import("@/pages/dashboard/controlpanel"));
const CompanyAdmin = lazy(() => import("@/pages/dashboard/company-admin"));
const Simulation = lazy(() => import("@/pages/dashboard/simulation"));
const MoleculeViewer = lazy(() => import("@/pages/dashboard/moleculeviewer"));
const Molstar3D = lazy(() => import("@/pages/dashboard/molstar3d"));
const Literature = lazy(() => import("@/pages/dashboard/literature"));
const GenerateMolecules = lazy(() => import("@/pages/dashboard/generate-molecules"));
const ProteinFolding = lazy(() => import("@/pages/dashboard/protein-folding"));
const GromacsMd = lazy(() => import("@/pages/dashboard/gromacs-md"));
const GlioblastomaPredict = lazy(() => import("@/pages/dashboard/glioblastoma-predict"));
const DeepSimilarity = lazy(() => import("@/pages/dashboard/deep-similarity"));


const MainHome = lazy(() => import("@/pages/main/mainhome"));
const Services = lazy(() => import("@/pages/main/services"));
const AboutUs = lazy(() => import("@/pages/main/about-us"));
const ContactUs = lazy(() => import("@/pages/main/contact-us"));
const Insights = lazy(() => import("@/pages/main/insights"));
const PaidPlansDescription = lazy(() => import("@/pages/main/paidplansdescription"));
const Blog = lazy(() => import("@/pages/main/blog"));
const SignIn = lazy(() => import("@/pages/auth/sign-in"));
const SignUp = lazy(() => import("@/pages/auth/sign-up"));
const PaidPlans = lazy(() => import("@/pages/dashboard/paidplans"));

import { EyeIcon } from "@heroicons/react/24/outline";

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
        icon: <BuildingOfficeIcon {...icon} />,
        name: "admin panel",
        path: "/company-admin",
        element: <CompanyAdmin />,
        adminOnly: true,
      },
      {
        icon: <InformationCircleIcon {...icon} />,
        name: "notifications",
        path: "/notifications",
        element: <Notifications />,
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
      {
        icon: <ServerStackIcon {...icon} />,
        name: "GROMACS MD",
        path: "/gromacs-md",
        element: <GromacsMd />,
        hideFromMenu: true,
      },
      {
        icon: <BeakerIcon {...icon} />,
        name: "Glioblastoma predict",
        path: "/glioblastoma-predict",
        element: <GlioblastomaPredict />,
        hideFromMenu: true,
      },
      {
        icon: <BookOpenIcon {...icon} />,
        name: "literature",
        path: "/literature",
        element: <Literature />,
      },
      {
        icon: <CreditCardIcon {...icon} />,
        name: "Plans & Credits",
        path: "/paid-plans",
        element: <PaidPlans />,
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
        icon: <ServerStackIcon {...icon} />,
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
