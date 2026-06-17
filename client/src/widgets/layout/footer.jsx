import PropTypes from "prop-types";
import { Typography } from "@material-tailwind/react";
import { HeartIcon } from "@heroicons/react/24/solid";

export function Footer({ brandName, brandLink, routes }) {
  const year = new Date().getFullYear();

  return (
    <footer className="fixed bottom-0 left-0 z-50 w-full bg-gray-100 py-2 shadow-md dark:border-t dark:border-slate-800 dark:bg-slate-950/95 dark:text-slate-300 dark:shadow-black/30">
      <div className="flex w-full flex-wrap items-center justify-center gap-6 px-2 md:justify-between">
        <Typography variant="small" className="font-normal text-inherit">
          &copy; {year}, made with{" "}
          <HeartIcon className="-mt-0.5 inline-block h-3.5 w-3.5 text-red-600" /> by{" "}
          <a
            href={brandLink}
            target="_blank"
            className="font-bold transition-colors hover:text-blue-500 dark:hover:text-brand-300" rel="noopener"
          >
            {brandName}
          </a>{" "}
          for a better web.
        </Typography>
        <ul className="flex items-center gap-4">
          {routes.map(({ name, path }) => (
            <li key={name}>
              <Typography
                as="a"
                href={path}
                target="_blank"
                variant="small"
                className="px-1 py-0.5 font-normal text-inherit transition-colors hover:text-blue-500 dark:hover:text-brand-300"
              >
                {name}
              </Typography>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}

Footer.defaultProps = {
  brandName: "Outwize inc",
  brandLink: "https://outwize.tech/",
  routes: [
    { name: "Outwize inc", path: "https://outwize.tech/" },
    { name: "About Us", path: "https://outwize.tech/" },
    { name: "Blog", path: "https://outwize.tech/blog" },
    { name: "License", path: "https://outwize.tech//license" },
  ],
};

Footer.propTypes = {
  brandName: PropTypes.string,
  brandLink: PropTypes.string,
  routes: PropTypes.arrayOf(PropTypes.object),
};

Footer.displayName = "/src/widgets/layout/footer.jsx";

export default Footer;
