import React from "react";
import { Card, CardHeader, CardBody, Typography, Chip } from "@material-tailwind/react";
import { ArrowDownTrayIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/solid";
import {
  SAR_EXPLORER_DIRECT_DOWNLOADS,
  SAR_EXPLORER_INSTALLERS,
  SAR_EXPLORER_RELEASES_URL,
  SAR_EXPLORER_REPOSITORY_URL,
  detectSarExplorerInstaller,
  sarExplorerDownloadUrl,
} from "@/utils/sarExplorer";

// What the desktop program adds for SAR work. Kept to what it actually does; see the
// program's own README for the methods behind each item.
const FEATURES = [
  ["SAR Overview", "One step from an opened SD-file to R-groups, a scaffold tree and a swap summary."],
  ["Scaffold tree", "Scaffolds arranged from small and common to large and rare, with molecule counts and statistics of any value column."],
  ["R-group grid", "Substituents at one position against another for one scaffold, coloured by value, with missing combinations shown."],
  ["Substituent pairs and swaps", "Molecules that differ at one position, and which exchange goes with which change of a value."],
  ["Your own core", "Analyse collections without a common ring system, such as amino acids, around a core you draw."],
  ["Reports", "Tables and the scaffold tree exported to Word with structure pictures."],
  ["Linked views and locked columns", "Keep key columns in view while scrolling, and let a selection in one plot decide what another shows."],
  ["Built-in example and quick start", "A public COX-2 inhibitor set from ChEMBL and a short guide inside the program, so you can try everything before loading your own data."],
];

const cardClass = "border border-blue-gray-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100";
const mutedClass = "dark:text-slate-400";

export function SarExplorer() {
  // Read once on mount: the browser's platform does not change while the page is open.
  const [suggested, setSuggested] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const basic = { platform: navigator.platform, userAgent: navigator.userAgent };
    setSuggested(detectSarExplorerInstaller(basic));
    // Only Chromium tells Apple silicon from Intel; elsewhere both Mac builds stay offered.
    navigator.userAgentData?.getHighEntropyValues?.(["architecture"])
      .then((values) => {
        if (!cancelled) setSuggested(detectSarExplorerInstaller({ ...basic, architecture: values?.architecture }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="mt-12 mb-8 flex flex-col gap-6">
      <Card className={cardClass}>
        <CardHeader floated={false} shadow={false} className="rounded-none bg-white pb-2 dark:bg-slate-900">
          <Typography variant="h5" color="blue-gray" className="dark:text-slate-100">
            Pyxis SAR Explorer
          </Typography>
          <Typography variant="small" color="gray" className={`mt-1 ${mutedClass}`}>
            A desktop program for scaffold and structure–activity analysis of your own compound
            tables. It runs on your computer: your structures and data are not uploaded, and no
            simulation credits are used.
          </Typography>
        </CardHeader>
        <CardBody className="bg-white pt-4 dark:bg-slate-900">
          <ul className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map(([title, text]) => (
              <li key={title} className="rounded-lg border border-blue-gray-50 p-3 dark:border-slate-800">
                <Typography variant="small" className="font-semibold text-blue-gray-900 dark:text-slate-100">
                  {title}
                </Typography>
                <Typography variant="small" color="gray" className={mutedClass}>
                  {text}
                </Typography>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card className={cardClass}>
        <CardHeader floated={false} shadow={false} className="rounded-none bg-white pb-2 dark:bg-slate-900">
          <Typography variant="h6" color="blue-gray" className="dark:text-slate-100">
            Download
          </Typography>
          <Typography variant="small" color="gray" className={`mt-1 ${mutedClass}`}>
            {SAR_EXPLORER_DIRECT_DOWNLOADS
              ? "Each button downloads the newest installer for that system."
              : "Installers are published on the project's releases page. Each button opens that page; pick the file named below for your system."}
          </Typography>
        </CardHeader>
        <CardBody className="bg-white pt-4 dark:bg-slate-900">
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="sar-explorer-installers">
            {SAR_EXPLORER_INSTALLERS.map((installer) => (
              <li
                key={installer.id}
                className="flex flex-col gap-2 rounded-lg border border-blue-gray-50 p-3 dark:border-slate-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <Typography variant="small" className="font-semibold text-blue-gray-900 dark:text-slate-100">
                    {installer.label}
                  </Typography>
                  {suggested === installer.id ? (
                    <Chip size="sm" variant="ghost" value="Your system" className="cb-activity-chip" />
                  ) : null}
                </div>
                <Typography variant="small" color="gray" className={mutedClass}>
                  {installer.detail}
                </Typography>
                <a
                  href={sarExplorerDownloadUrl(installer)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-fit items-center gap-2 rounded-lg bg-blue-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                >
                  <ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" />
                  {SAR_EXPLORER_DIRECT_DOWNLOADS ? `Download for ${installer.label}` : `Get the ${installer.label} installer`}
                </a>
                <Typography variant="small" color="gray" className={`break-all font-mono text-xs ${mutedClass}`}>
                  {installer.file}
                </Typography>
                <Typography variant="small" color="gray" className={`text-xs ${mutedClass}`}>
                  {installer.firstStart}
                </Typography>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card className={cardClass}>
        <CardBody className="bg-white dark:bg-slate-900">
          <Typography variant="small" color="gray" className={mutedClass}>
            Pyxis SAR Explorer is a modified version of DataWarrior (© Thomas Sander and Idorsia
            Pharmaceuticals Ltd.) and is free software under the GNU General Public License,
            version 3. Its complete source code, the list of what Pyxis changed, and a five-minute
            walk-through are in the project repository.
          </Typography>
          <div className="mt-3 flex flex-wrap gap-4">
            <a
              href={SAR_EXPLORER_REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300"
            >
              Source code and documentation
              <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href={SAR_EXPLORER_RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300"
            >
              All releases
              <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default SarExplorer;
