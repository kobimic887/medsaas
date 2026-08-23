import PropTypes from "prop-types";
import { Typography } from "@material-tailwind/react";

export function Footer({ brandName, brandLink, routes }) {
  const year = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-blue-gray-100 bg-gray-100/90 py-3 dark:border-slate-800 dark:bg-slate-950/95 dark:text-slate-300">
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
          <span className="mx-2 text-blue-gray-400 dark:text-slate-600" aria-hidden="true">·</span>
          <span>made with <span aria-hidden="true">❤️</span><span className="sr-only"> love </span> by{" "}</span>
          <a
            href="https://outwize.tech/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold transition-colors hover:text-blue-500 dark:hover:text-brand-300"
          >
            Outwize inc
          </a>
        </Typography>
        <ul className="flex items-center gap-4">
          {routes.map(({ name, path }) => (
            <li key={name}>
              <Typography
                as="a"
                href={path}
                target="_blank"
                rel="noopener noreferrer"
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

// Keep Pyxis as the product attribution and navigation target. Outwize's separate
// credit below preserves the original design attribution without making the old
// template's unrelated About/Blog routes part of the current footer.
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
