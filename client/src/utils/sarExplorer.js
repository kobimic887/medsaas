// Pyxis SAR Explorer is a separate desktop program (a modified, GPL-licensed version of
// DataWarrior with Pyxis additions). It is built and published from its own repository;
// this application only links to it. Nothing here runs on, or is served by, the app host.

export const SAR_EXPLORER_REPOSITORY_URL = "https://github.com/kobimic887/pyxis-sar-explorer";
export const SAR_EXPLORER_RELEASES_URL = `${SAR_EXPLORER_REPOSITORY_URL}/releases`;

// Release files keep the same names from version to version, so that
// `${SAR_EXPLORER_RELEASES_URL}/latest/download/<file>` always resolves to the newest
// installer. That URL is a 404 until the first release exists. Flip this to true in the
// same change that confirms a release is published; until then every button opens the
// releases page, which is valid with or without a release.
export const SAR_EXPLORER_DIRECT_DOWNLOADS = false;

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
    firstStart: "macOS warns on first start because the app is not code-signed: right-click the app and choose Open.",
  },
  {
    id: "macos-x64",
    label: "macOS (Intel)",
    detail: "Intel Macs (.dmg)",
    file: "Pyxis-SAR-Explorer-macos-x64.dmg",
    firstStart: "macOS warns on first start because the app is not code-signed: right-click the app and choose Open.",
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
