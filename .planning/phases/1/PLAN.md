# Phase 1: Branding Cleanup Plan

## Context
The goal of this phase is to remove all Pyxis Discovery branding from the client source and server, replacing it with "ChemBench". This ensures that labs and customers see only ChemBench. 

**Important Consideration**: We will be adding a GitHub Actions workflow in Phase 3 to automatically build the application via Docker. Therefore, any renaming or file modifications in this phase (e.g. `Dockerfile`, `package.json`, or environment variables) MUST preserve Docker build compatibility.

## Steps

### Step 1: Rename Image Data Files and Update Imports
- **Action**: Rename `client/src/data/pyxisImages.js` to `client/src/data/libraryImages.js`.
- **Action**: Rename `client/src/data/pyxisServicesImages.js` to `client/src/data/servicesImages.js`.
- **Action**: Rename equivalent files in `packages/dashboard-template/src/data/` if they exist.
- **Action**: Update all imports and references in the client tree (`about-us.jsx`, `services.jsx`, `mainhome.jsx`, etc.) to use the newly named files and exported variables (`libraryImages`, `servicesImages`).

### Step 2: Fix Image References on the About Us Page
- **Action**: Modify `client/src/pages/main/about-us.jsx` (and its counterpart in `packages/dashboard-template`) to remove broken image references.
- **Action**: Specifically, replace background styles using `url('/img/pyxis-hero.jpg')` with simple CSS gradients (e.g., `linear-gradient(rgba(0,0,0,0.5),rgba(0,0,0,0.5))`).
- **Action**: Remove or replace `<img>` tags pointing to missing `pyxis-team.jpeg` or `pyxis-lab.jpeg` to prevent 404s.

### Step 3: Replace Text in the Client Source Tree
- **Action**: Search and replace all literal strings containing "Pyxis Discovery", "Pyxis", or "pyxis-discovery.com" with "ChemBench" and "chembench.com" in all `client/` and `packages/dashboard-template/` files.
- **Action**: Ensure brand names passed as props (e.g., `brandName="Pyxis Discovery"`) are updated to `brandName="ChemBench"`.
- **Action**: Update API hostname constants (e.g., in `utils/api.js`, `utils/constants.js`) to use the new domain.

### Step 4: Replace Text in Server and Legacy APIs
- **Action**: Update `server/index.js` to ensure no "Pyxis Discovery" text exists, especially in email subject lines and bodies.
- **Action**: Update `legacy/chem-beo-api/index.js`, `utils/emailService.js`, and `utils/emailTemplates.js` to remove "Pyxis" references from email templates, URLs, and logs.
- **Action**: Update SSL certificate paths in `legacy/chem-beo-api/utils/sslUtils.js` if necessary, or at least abstract the "pyxis" hardcoding.

### Step 5: Update HTML Metadata and Assets (BRAND-05)
- **Action**: Update `<title>` tags and meta properties in `client/index.html` and `packages/dashboard-template/index.html` from "Pyxis Discovery" to "ChemBench".
- **Action**: Review `favicon.png` or `favicon.ico` for Pyxis branding and ensure it's replaced or noted for replacement.
- **Action**: Update copyright years/footer text in HTML and React components to reflect the current year and "ChemBench".

### Step 6: Add Brand Regression Test (BRAND-06)
- **Action**: Add a new script to the root `package.json` called `"test:brand"`. This script should use `grep` or `findstr` to search the codebase for "pyxis" (case-insensitive) and fail (exit code > 0) if it finds any matches.
- **Action**: Run `npm run test:brand` locally to ensure it correctly catches the remaining Pyxis text during development.

### Step 7: Final Pass and Verification
- **Action**: Run a codebase-wide case-insensitive search for "pyxis" (or rely on the new `test:brand` script).
- **Action**: Clean up remaining references in non-code files like `REPOS.md`, `README.md`, and Python scripts (e.g., `services/admet/admetsendtopyxis.py`).
- **Action**: Ensure the project builds successfully and the client UI compiles without errors.
