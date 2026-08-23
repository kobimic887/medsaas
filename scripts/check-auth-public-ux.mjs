import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Public/auth UX for the live product: 84 pyxis-web :5174 (nginx :443 →
// 127.0.0.1:5174 since 2026-08-23). Vite :5173 is rollback only — do not
// retarget these checks at that tree.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const signIn = read("client/src/pages/auth/sign-in.jsx");
const signUp = read("client/src/pages/auth/sign-up.jsx");
const authShell = read("client/src/components/AuthShell.jsx");
const authLayout = read("client/src/layouts/auth.jsx");
const mainLayout = read("client/src/layouts/mainpage.jsx");
const clientIndex = read("client/index.html");
const branding = read("client/src/config/branding.js");
const mainHome = read("client/src/pages/main/mainhome.jsx");
const navbar = read("client/src/widgets/layout/main-navbar.jsx");
const blog = read("client/src/pages/main/blog.jsx");
const blogContext = read("client/src/context/blog.jsx");
const authContext = read("client/src/context/auth.jsx");
const viewerStorage = read("client/src/utils/viewerStorage.js");
const resultsPage = read("client/src/pages/dashboard/molstar3d.jsx");
const signupServer = read("server/index.js");

const checks = [
  ["public document title is the platform-name placeholder, not the Vite Macrocycles tab",
    clientIndex.includes("<title>%VITE_PLATFORM_NAME%</title>")
    && !clientIndex.includes("Pyxis-Discovery")
    && !clientIndex.includes("Macrocycles")],
  ["client brand fallback is Pyxis Discovery", branding.includes("|| 'Pyxis Discovery'")],
  ["public pages do not advertise dress rehearsal",
    !clientIndex.includes("dress rehearsal")
    && !mainHome.includes("dress rehearsal")
    && !authShell.includes("dress rehearsal")
    && !signIn.includes("dress rehearsal")],
  ["auth screens share one lightweight shell", signIn.includes('from "@/components/AuthShell"') && signUp.includes('from "@/components/AuthShell"')],
  ["auth layout exposes a skip link to main content", authLayout.includes("SkipLink") && authLayout.includes('id="main-content"')],
  ["marketing layout exposes a skip link to main content", mainLayout.includes("SkipLink") && mainLayout.includes('id="main-content"')],
  ["the auth brand links back to the public home", authShell.includes('to="/main/mainHome"')],
  ["sign-up no longer pulls in Material Tailwind", !signUp.includes("@material-tailwind/react")],
  ["sign-in requests abort on route exit", signIn.includes("requestControllerRef.current?.abort()")],
  ["sign-up requests abort on route exit", signUp.includes("requestControllerRef.current?.abort()")],
  ["sign-in tolerates non-JSON API failures", signIn.includes("res.json().catch(() => ({}))")],
  ["sign-up tolerates non-JSON API failures", signUp.includes("response.json().catch(() => ({}))")],
  ["sign-in fields expose autofill semantics", signIn.includes('autoComplete="username"') && signIn.includes('autoComplete="current-password"')],
  ["sign-up fields expose autofill semantics", ["email", "username", "new-password", "organization"].every((value) => signUp.includes(`autoComplete="${value}"`))],
  ["auth forms expose their busy state", signIn.includes("aria-busy={loading}") && signUp.includes("aria-busy={loading}")],
  ["public navigation exposes maintained sections", ["Services", "About", "Insights", "Plans", "Contact"].every((label) => navbar.includes(`label: "${label}"`))],
  ["mobile navigation identifies its expanded state", navbar.includes("aria-expanded={mobileOpen}") && navbar.includes('aria-controls="main-mobile-navigation"')],
  ["signed-in mobile users can reach the dashboard", navbar.includes('to="/dashboard/controlpanel"') && navbar.includes("Sign Out")],
  ["legacy blog bookmarks route to maintained Insights", blog.includes('<Navigate to="/main/insights" replace />')],
  ["blog context no longer fabricates published posts", !blogContext.includes("samplePosts") && !blogContext.includes("Welcome to Our Blog")],
  ["public pages do not eagerly initialize RDKit", !clientIndex.includes("window.loadRDKit().then")],
  ["marketing home contains no invented usage totals", !mainHome.includes("Labs Onboarded") && !mainHome.includes("Simulations Run") && !mainHome.includes("1M+")],
  ["marketing home omits unverified template claims", ["1B enumerated", "Revenue analytics", "growing network", "Score: 9.2", "ΔG: −8.4"].every((claim) => !mainHome.includes(claim))],
  ["the first signup account is the company owner", signupServer.includes("const userRole = existingCompanyUsers === 0 ? 'owner' : 'member';")],
  ["owners are recognized as dashboard admins", authContext.includes('role === "owner" || role === "admin"')],
  ["demo sessions cannot open company-admin chrome", authContext.includes('if (user?.demo) return false;')],
  ["demo JWTs cannot call company-admin APIs", signupServer.includes("Demo sessions cannot manage company settings")],
  ["sign-in requests have a hard timeout", signIn.includes("AUTH_FETCH_TIMEOUT_MS") && signIn.includes("Request timed out. Please try again.")],
  ["sign-up requests have a hard timeout", signUp.includes("AUTH_FETCH_TIMEOUT_MS") && signUp.includes("Request timed out. Please try again.")],
  ["viewer storage includes every result key", viewerStorage.includes("'molstar_simulation_pairs'") && viewerStorage.includes("'diffdock_ligand_input'") && viewerStorage.includes("'molstar_display_pdb_id'")],
  ["account changes clear stale result files", authContext.includes("if (accountChanged) clearViewerStorage()") && authContext.includes("clearViewerStorage();\n    setUser(null)")],
  ["simulation results require a PDB, not an SDF bundle", resultsPage.includes("if (simulationKey && !pdbUrl && !displayPdbId)") && resultsPage.includes("clearViewerStorage()")],
  ["PDB share links clear old authenticated result keys", resultsPage.includes("if (!simulationParam)") && resultsPage.includes("localStorage.removeItem('molstar_simulation_key')")],
  ["empty results explain how to start", resultsPage.includes('No docking results yet. Run a simulation to see poses here.')],
];

const failures = checks.filter(([, passed]) => !passed).map(([label]) => label);
if (failures.length) {
  console.error("Auth/public UX regression check failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ Auth/public UX check passed (${checks.length} invariants)`);
