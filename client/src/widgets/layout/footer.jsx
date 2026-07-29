import PropTypes from "prop-types";
import { Typography } from "@material-tailwind/react";

export function Footer({ brandName, brandLink, routes }) {
  const year = new Date().getFullYear();

  return (
    <footer className="fixed bottom-0 left-0 z-50 w-full bg-gray-100 py-2 shadow-md dark:border-t dark:border-slate-800 dark:bg-slate-950/95 dark:text-slate-300 dark:shadow-black/30">
      <div className="flex w-full flex-wrap items-center justify-center gap-6 px-2 md:justify-between">
        <Typography variant="small" className="font-normal text-inherit">
          &copy; {year}{" "}
          <a
            href={brandLink}
            target="_blank"
            className="font-bold transition-colors hover:text-blue-500 dark:hover:text-brand-300" rel="noopener"
          >
            {brandName}
          </a>
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

// These defaults came from the Creative Tim template and were never changed, so
// every dashboard page footer credited "Outwize inc" and carried four outbound
// links to outwize.tech — including an "About Us" and a "Blog" that were not this
// product's. They now point at the real Pyxis marketing site, whose paths are the
// ones actually published at www.pyxis-discovery.com.
Footer.defaultProps = {
  brandName: "Pyxis Discovery",
  brandLink: "https://www.pyxis-discovery.com/",
  routes: [
    { name: "Pyxis Discovery", path: "https://www.pyxis-discovery.com/" },
    { name: "About Us", path: "https://www.pyxis-discovery.com/about-us/" },
    { name: "Insights", path: "https://www.pyxis-discovery.com/insights" },
    { name: "Contact", path: "https://www.pyxis-discovery.com/contact/" },
  ],
};

Footer.propTypes = {
  brandName: PropTypes.string,
  brandLink: PropTypes.string,
  routes: PropTypes.arrayOf(PropTypes.object),
};

Footer.displayName = "/src/widgets/layout/footer.jsx";

export default Footer;
