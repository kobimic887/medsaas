import { useLocation, Link } from "react-router-dom";
import {
  Navbar,
  Typography,
  Button,
  IconButton,
  Breadcrumbs,
  Input,
  Menu,
  MenuHandler,
  MenuList,
  MenuItem,
  Avatar,
} from "@material-tailwind/react";
import {
  UserCircleIcon,
  Cog6ToothIcon,
  BellIcon,
  ClockIcon,
  CreditCardIcon,
  Bars3Icon,
} from "@heroicons/react/24/solid";
import {
  useMaterialTailwindController,
  setOpenConfigurator,
  setOpenSidenav,
} from "@/context";
import { useAuth } from "@/context/auth";

export function MainNavbar() {
  const [controller, dispatch] = useMaterialTailwindController();
  const { fixedNavbar, openSidenav } = controller;
  const { pathname } = useLocation();
  const [layout, page] =  pathname.split("/").filter((el) => el !== "");
  const { isLoggedIn, logout, user, isAdmin } = useAuth();

  return (
    <Navbar
      color={fixedNavbar ? "white" : "transparent"}
      className={`rounded-xl transition-all ${
        fixedNavbar
          ? "sticky top-4 z-40 py-3 shadow-md shadow-blue-gray-500/5"
          : "px-0 py-1"
      }`}
      fullWidth
      blurred={fixedNavbar}
    >
      <div className="flex flex-col-reverse justify-between gap-6 md:flex-row md:items-center">
        <div className="capitalize bg-gray rounded-lg px-8 py-2">
          { <Typography variant="h6" >
          <svg xmlns="http://www.w3.org/2000/svg" width="211" height="40" viewBox="0 0 211 40" fill="none">
            <path d="M90.3999 10C90.3999 4.5 94.8999 0 100.4 0C105.9 0 110.4 4.5 110.4 10C110.4 15.5 105.9 20 100.4 20C94.8999 20.1 90.3999 15.6 90.3999 10Z" fill="#B4B239"></path>
            <path d="M99.6002 13.9999L102.4 10.8999L102 10.9999H94.2002V9.0999H102L102.4 9.1999L99.6002 6.0999L101 4.8999L105.6 9.9999L101 15.1999L99.6002 13.9999Z" fill="white"></path>
            <path d="M122.2 16.4V14.9C122.1 15.9 121.6 16.4 120.7 16.4H119.2C118.4 16.4 117.6 16.1 117 15.5C116.4 14.9 116.1 14.2 116.1 13.4V8.79995C116.1 7.99995 116.4 7.29995 117 6.59995C117.6 5.99995 118.3 5.69995 119.2 5.69995H122.3V2.69995H125.3V16.4H122.2ZM119.6 7.79995C119.3 8.09995 119.1 8.49995 119.1 8.89995V13.5C119.1 13.9 119.2 14.3 119.6 14.6C119.9 14.9 120.3 15.1 120.7 15.1C121.1 15.1 121.5 15 121.8 14.6C122.1 14.3 122.3 14 122.3 13.5V7.39995H120.8C120.3 7.29995 119.9 7.39995 119.6 7.79995Z" fill="#B4B239"></path>
            <path d="M128.5 16.4001V5.80005H131.5V16.5H128.5M128.5 4.30005V2.80005H131.5V4.30005H128.5Z" fill="#B4B239"></path>
            <path d="M137.8 16.4001C135.8 16.4001 134.7 15.4001 134.7 13.3001H136.2C136.3 14.3001 136.8 14.8001 137.6 14.8001C138.1 14.8001 138.6 14.7001 138.8 14.5001C139.1 14.3001 139.2 14.0001 139.2 13.5001C139.2 13.1001 138.5 12.5001 137 11.7001C135.8 11.1001 135.1 10.5001 134.9 10.1001C134.7 9.7001 134.6 9.2001 134.6 8.7001C134.6 7.8001 134.9 7.1001 135.5 6.5001C136.1 5.9001 136.8 5.6001 137.7 5.6001H139.2C141.1 5.6001 142.1 6.6001 142.3 8.7001H140.9C140.8 7.7001 140.3 7.2001 139.5 7.2001C139 7.2001 138.5 7.3001 138.3 7.5001C138 7.7001 137.9 8.0001 137.9 8.4001C137.9 8.8001 138.6 9.4001 140.1 10.2001C141.3 10.8001 142 11.4001 142.2 11.8001C142.4 12.2001 142.5 12.7001 142.5 13.2001C142.5 14.0001 142.2 14.8001 141.6 15.4001C141 16.0001 140.3 16.3001 139.4 16.3001H137.8" fill="#B4B239"></path>
            <path d="M148.1 16.4C147.3 16.4 146.5 16.1 145.9 15.5C145.3 14.9 145 14.2 145 13.4V8.79995C145 7.99995 145.3 7.29995 145.9 6.59995C146.5 5.99995 147.2 5.69995 148.1 5.69995H149.6C151.5 5.69995 152.5 6.69995 152.7 8.79995H151.2C151.1 7.79995 150.6 7.29995 149.7 7.29995C149.3 7.29995 148.9 7.39995 148.6 7.69995C148.3 7.99995 148.1 8.39995 148.1 8.79995V13.4C148.1 13.8 148.3 14.2 148.6 14.5C148.9 14.8 149.3 15 149.7 15C150.6 15 151.1 14.5 151.2 13.5H152.7C152.6 15.5 151.5 16.6 149.6 16.6H148.1" fill="#B4B239"></path>
            <path d="M158.4 16.4C157.6 16.4 156.8 16.1 156.2 15.5C155.6 14.9 155.3 14.2 155.3 13.4V8.79995C155.3 7.99995 155.6 7.29995 156.2 6.59995C156.8 5.99995 157.5 5.69995 158.4 5.69995H161.5C162.3 5.69995 163 5.99995 163.7 6.59995C164.3 7.19995 164.6 7.89995 164.6 8.69995V13.2999C164.6 14.0999 164.3 14.8 163.7 15.4C163.1 16 162.4 16.2999 161.5 16.2999H158.4M158.9 7.79995C158.6 8.09995 158.4 8.49995 158.4 8.89995V13.5C158.4 13.9 158.6 14.3 158.9 14.6C159.2 14.9 159.6 15.1 160 15.1C160.4 15.1 160.8 15 161.1 14.6C161.4 14.3 161.6 14 161.6 13.5V8.89995C161.6 8.49995 161.4 8.09995 161.1 7.79995C160.8 7.49995 160.4 7.39995 160 7.39995C159.5 7.29995 159.2 7.39995 158.9 7.79995Z" fill="#B4B239"></path>
            <path d="M167.9 16.4V5.79995H170.9V14.9H172.4C172.8 14.9 173.2 14.8 173.5 14.4C173.8 14.1 174 13.7999 174 13.2999V5.69995H177V11.2C177 12.6 176.5 13.8 175.5 14.9C174.5 15.9 173.3 16.4 171.8 16.4H167.9Z" fill="#B4B239"></path>
            <path d="M183 16.4C182.2 16.4 181.4 16.1 180.8 15.5C180.2 14.9 179.9 14.2 179.9 13.4V8.79995C179.9 7.99995 180.2 7.29995 180.8 6.59995C181.4 5.99995 182.1 5.69995 183 5.69995H186.1C186.9 5.69995 187.6 5.99995 188.3 6.59995C188.9 7.19995 189.2 7.89995 189.2 8.79995V11.7999H182.9V13.2999C182.9 13.6999 183.1 14.1 183.4 14.4C183.7 14.7 184.1 14.7999 184.5 14.7999H186C187 14.7999 187.5 14.2999 187.5 13.2999H189C188.8 15.2999 187.7 16.4 186 16.4H183ZM183.4 7.79995C183.1 8.09995 182.9 8.39995 182.9 8.89995V10.4H186V8.89995C186 8.49995 185.8 8.09995 185.5 7.79995C185.2 7.49995 184.8 7.39995 184.4 7.39995C184.1 7.29995 183.7 7.39995 183.4 7.79995Z" fill="#B4B239"></path>
            <path d="M192 16.4V5.79995H195V8.79995C195.1 7.79995 195.4 6.99995 196 6.49995C196.5 5.99995 197.2 5.69995 198.1 5.69995H199.6V8.69995H196.5C196.1 8.69995 195.7 8.89995 195.4 9.09995C195.1 9.39995 194.9 9.79995 194.9 10.2V16.2999H192" fill="#B4B239"></path>
            <path d="M204.6 21C202.8 21 201.8 20.0001 201.5 17.9001H203C203.1 18.9001 203.6 19.4001 204.5 19.4001H206C206.4 19.4001 206.8 19.2 207.1 19C207.4 18.7 207.6 18.4001 207.6 17.9001V14.9001C207.5 15.9001 207 16.4001 206.1 16.4001H204.6C203.8 16.4001 203 16.1 202.4 15.5C201.8 14.9 201.5 14.2001 201.5 13.4001V5.80005H204.5V13.4001C204.5 13.8001 204.7 14.2 205 14.5C205.3 14.8 205.7 15 206.1 15C206.5 15 206.9 14.9 207.2 14.5C207.5 14.2 207.7 13.9001 207.7 13.4001V5.80005H210.7V18C210.7 18.8 210.4 19.5 209.8 20.1C209.2 20.7 208.5 21 207.7 21H204.6Z" fill="#B4B239"></path>
            <path d="M0 39.9V16.5H10.4C11.8 16.5 13 17 14.1 18C15.1 19 15.6 20.2 15.6 21.7V24.3C15.6 25.7 15.1 26.9 14.1 28C13.1 29 11.9 29.5 10.4 29.5H5.2V39.9H0ZM5.2 26.9H7.8C8.5 26.9 9.1 26.6 9.6 26.1C10.1 25.6 10.4 25 10.4 24.3V21.7C10.4 21 10.1 20.4 9.6 19.9C9.1 19.4 8.5 19.1 7.8 19.1H5.2V26.9Z" fill="#888888"></path>
            <path d="M25.4002 39.9V29.5C21.9002 29.1 20.2002 27.4 20.2002 24.3V16.5H25.4002V24.3C25.4002 25 25.7002 25.6 26.2002 26.1C26.7002 26.6 27.3002 26.9 28.0002 26.9C28.7002 26.9 29.3002 26.6 29.8002 26.1C30.3002 25.6 30.6002 25 30.6002 24.3V16.5H35.8002V24.3C35.8002 27.4 34.1002 29.1 30.6002 29.5V39.9H25.4002Z" fill="#888888"></path>
            <path d="M41.8999 39.9V33.4C41.8999 30.3 43.5999 28.6 47.0999 28.2C43.5999 27.8 41.8999 26.1 41.8999 23V16.5H47.0999V24.3C47.0999 25 47.3999 25.6 47.8999 26.1C48.3999 26.6 48.9999 26.9 49.7999 26.9C50.4999 26.9 51.0999 26.6 51.5999 26.1C52.0999 25.6 52.3999 25 52.3999 24.3V16.5H57.5999V23C57.5999 26.1 55.8999 27.8 52.3999 28.2C55.8999 28.6 57.5999 30.4 57.5999 33.4V39.9H52.3999V32.1C52.3999 31.4 52.0999 30.8 51.5999 30.3C51.0999 29.8 50.4999 29.5 49.7999 29.5C49.0999 29.5 48.4999 29.8 47.8999 30.3C47.3999 30.8 47.0999 31.4 47.0999 32.1V39.9H41.8999Z" fill="#888888"></path>
            <path d="M65.2998 39.9V16.5H70.4998V39.9H65.2998Z" fill="#888888"></path>
            <path d="M89.9999 21.6999H87.3999C87.1999 19.9999 86.3999 19.0999 84.8999 19.0999C83.9999 19.0999 83.2999 19.2999 82.7999 19.7999C82.2999 20.1999 82.0999 20.8999 82.0999 21.7999C82.0999 22.4999 82.3999 23.0999 82.8999 23.5999L88.3999 29.7999C89.3999 30.8999 89.8999 32.1999 89.8999 33.4999V34.7999C89.8999 36.1999 89.3999 37.3999 88.3999 38.4999C87.3999 39.4999 86.1999 39.9999 84.6999 39.9999H82.0999C80.3999 39.9999 79.0999 39.5999 78.1999 38.6999C77.2999 37.7999 76.8999 36.4999 76.8999 34.7999H79.4999C79.4999 34.9999 79.4999 35.0999 79.4999 35.1999C79.4999 35.8999 79.7999 36.4999 80.2999 36.7999C80.7999 37.1999 81.4999 37.2999 82.0999 37.2999C82.9999 37.2999 83.6999 37.0999 84.0999 36.5999C84.4999 36.1999 84.6999 35.4999 84.6999 34.5999C84.6999 33.8999 84.3999 33.2999 83.8999 32.7999L78.3999 26.5999C77.3999 25.4999 76.8999 24.1999 76.8999 22.8999V21.5999C76.8999 20.1999 77.3999 18.9999 78.3999 17.8999C79.3999 16.8999 80.5999 16.3999 82.0999 16.3999H84.6999C88.0999 16.4999 89.7999 18.1999 89.9999 21.6999Z" fill="#888888"></path>
          </svg>
          </Typography> }
        </div>
        <div className="flex items-center">
          <div className="mr-auto md:mr-4 md:w-56">
            <Input label="Search" />
          </div>
          <IconButton
            variant="text"
            color="blue-gray"
            className="grid xl:hidden"
            onClick={() => setOpenSidenav(dispatch, !openSidenav)}
          >
            <Bars3Icon strokeWidth={3} className="h-6 w-6 text-blue-gray-500" />
          </IconButton>
          <Link to="/main/mainHome">
            <Button
              variant="text"
              color="blue-gray"
              className="hidden items-center gap-1 px-4 xl:flex normal-case text-2xl"
            >
              Discover Libraries
            </Button>
          </Link>
          <Link to="/main/services">
            <Button
              variant="text"
              color="blue-gray"
              className="hidden items-center gap-1 px-4 xl:flex normal-case text-2xl"
            >
              Services
            </Button>
          </Link>
          <Link to="/main/about-us">
            <Button
              variant="text"
              color="blue-gray"
              className="hidden items-center gap-1 px-4 xl:flex normal-case text-2xl"
            >
              About us
            </Button>
          </Link>
          <Link to="/main/contact-us">
            <Button
              variant="text"
              color="blue-gray"
              className="hidden items-center gap-1 px-4 xl:flex normal-case text-2xl"
            >
              Contact Us
            </Button>
          </Link>
          <Link to="/main/insights">
            <Button
              variant="text"
              color="blue-gray"
              className="hidden items-center gap-1 px-4 xl:flex normal-case text-2xl"
            >
              Insights
            </Button>
          </Link>
          <Link to="/main/blog">
            <Button
              variant="text"
              color="blue-gray"
              className="hidden items-center gap-1 px-4 xl:flex normal-case text-2xl"
            >
              Blog
            </Button>
          </Link>
           <Link to="/main/paidplansdescription">
            <Button
              variant="text"
              color="blue-gray"
              className="hidden items-center gap-1 px-4 xl:flex normal-case text-2xl"
            >
              Paid Plans
            </Button>
          </Link>
          {isLoggedIn() ? (
            <Menu>
              <MenuHandler>
                <Button
                  variant="text"
                  color="blue-gray"
                  className="hidden items-center gap-1 px-4 xl:flex normal-case text-2xl"
                >
                  <UserCircleIcon className="h-5 w-5 text-blue-gray-500" />
                  {user?.email || "User"}
                </Button>
              </MenuHandler>
              <MenuList>
                {isAdmin() && (
                  <MenuItem>
                    <Link to="/dashboard/controlpanel" className="w-full">
                      Admin Dashboard
                    </Link>
                  </MenuItem>
                )}
                <MenuItem onClick={logout}>Sign Out</MenuItem>
              </MenuList>
            </Menu>
          ) : (
            <Link to="/auth/sign-in">
              <Button
                variant="text"
                color="blue-gray"
                className="hidden items-center gap-1 px-4 xl:flex normal-case text-2xl"
              >
                <UserCircleIcon className="h-5 w-5 text-blue-gray-500" />
                Sign In
              </Button>
              <IconButton
                variant="text"
                color="blue-gray"
                className="grid xl:hidden"
              >
                <UserCircleIcon className="h-5 w-5 text-blue-gray-500" />
              </IconButton>
            </Link>
          )}

          <Menu>
            <MenuHandler>
              <IconButton variant="text" color="blue-gray">
                <BellIcon className="h-5 w-5 text-blue-gray-500" />
              </IconButton>
            </MenuHandler>
            <MenuList className="w-max border-0">
              <MenuItem disabled>No notifications</MenuItem>
            </MenuList>
          </Menu>
          <IconButton
            variant="text"
            color="blue-gray"
            onClick={() => setOpenConfigurator(dispatch, true)}
          >
            <Cog6ToothIcon className="h-5 w-5 text-blue-gray-500" />
          </IconButton>
        </div>
      </div>
    </Navbar>
  );
}

MainNavbar.displayName = "/src/widgets/layout/main-navbar.jsx";

export default MainNavbar;
