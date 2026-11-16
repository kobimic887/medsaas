// Pyxis SAR Explorer is a separate desktop program (a modified, GPL-licensed version of
// DataWarrior with Pyxis additions). It is built and published from its own repository;
// this application only links to it. Nothing here runs on, or is served by, the app host.

export const SAR_EXPLORER_REPOSITORY_URL = "https://github.com/kobimic887/pyxis-sar-explorer";
export const SAR_EXPLORER_RELEASES_URL = `${SAR_EXPLORER_REPOSITORY_URL}/releases`;

// Release files keep the same names from version to version, so that
// `${SAR_EXPLORER_RELEASES_URL}/latest/download/<file>` always resolves to the newest
// installer. A release is published (first: pyxis-v1.0.0), so buttons download directly.
// Set this to false only if the releases are withdrawn: a direct link is a 404 without
// one, while the releases page is valid either way.
export const SAR_EXPLORER_DIRECT_DOWNLOADS = true;

// Current macOS no longer offers "Open" from the right-click menu for unsigned apps;
// the confirmation moved to System Settings. Older versions still use the right-click.
const MAC_FIRST_START = "macOS refuses the first start because the app is not code-signed: open System Settings, Privacy & Security, and choose Open Anyway. On macOS 14 and earlier, right-click the app and choose Open.";

export const SAR_EXPLORER_INSTALLERS = [
  {
    id: "windows",
    label: "Windows",
    detail: "64-bit installer (.msi)",
    file: "Pyxis-SAR-Explorer-windows-x64.msi",
    firstStart: "Windows SmartScreen warns on first start because the installer is not code-signed: choose More info, then Run anyway.",
  },
  {
    id: "macos-arm64",
    label: "macOS (Apple silicon)",
    detail: "M-series Macs (.dmg)",
    file: "Pyxis-SAR-Explorer-macos-arm64.dmg",
    firstStart: MAC_FIRST_START,
  },
  {
    id: "macos-x64",
    label: "macOS (Intel)",
    detail: "Intel Macs (.dmg)",
    file: "Pyxis-SAR-Explorer-macos-x64.dmg",
    firstStart: MAC_FIRST_START,
  },
  {
    id: "linux",
    label: "Linux",
    detail: "Debian/Ubuntu package (.deb)",
    file: "Pyxis-SAR-Explorer-linux-x64.deb",
    firstStart: "Install with your package manager, for example: sudo apt install ./Pyxis-SAR-Explorer-linux-x64.deb",
  },
];

/** Where the button for one installer leads. */
export function sarExplorerDownloadUrl(installer, direct = SAR_EXPLORER_DIRECT_DOWNLOADS) {
  return direct
    ? `${SAR_EXPLORER_RELEASES_URL}/latest/download/${installer.file}`
    : SAR_EXPLORER_RELEASES_URL;
}

/**
 * Best guess of the visitor's installer from what the browser reports, or null.
 * A Mac cannot be told apart reliably (Apple silicon browsers also report "Intel"),
 * so both Mac installers are offered and neither is singled out unless the browser
 * says which architecture it runs on.
 */
export function detectSarExplorerInstaller({ platform = "", userAgent = "", architecture = "" } = {}) {
  const text = `${platform} ${userAgent}`.toLowerCase();
  if (/android|iphone|ipad|ipod/.test(text)) return null;
  if (text.includes("win")) return "windows";
  if (text.includes("mac")) {
    const arch = String(architecture).toLowerCase();
    if (arch === "arm") return "macos-arm64";
    if (arch === "x86") return "macos-x64";
    return null;
  }
  if (text.includes("linux") || text.includes("x11")) return "linux";
  return null;
}
