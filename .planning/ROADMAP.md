# Roadmap: ChemBench Cleanup v1

**Project:** ChemBench Cleanup v1
**Granularity:** Coarse
**Total Phases:** 3
**Requirement Coverage:** 8/8 v1 requirements mapped

---

## Phases

- [ ] **Phase 1: Branding Cleanup** - Remove all Pyxis Discovery branding from client source and server
- [ ] **Phase 2: Login Code Cleanup** - Remove debug-era IP-fetching and tester bypass code from sign-in
- [ ] **Phase 3: CI/CD Pipeline** - Create GitHub Actions to build a Docker image of the application on merge to main

---

## Phase Details

### Phase 1: Branding Cleanup
**Goal**: No file in the codebase references "Pyxis" or Pyxis-named assets — labs and customers see only ChemBench
**Depends on**: Nothing (first phase)
**Requirements**: BRAND-01, BRAND-02, BRAND-03, BRAND-04
**Success Criteria** (what must be TRUE):
  1. Searching the client source tree for "pyxis" (case-insensitive) returns zero matches
  2. `pyxisImages.js` and `pyxisServicesImages.js` files no longer exist; `libraryImages.js` and `servicesImages.js` exist in their place and all importers compile without errors
  3. The About Us page renders without broken image references — background areas show CSS gradients, not 404 image requests
  4. Sending a test email via the server produces a subject line and body with no "Pyxis Discovery" text
**Plans**: TBD

### Phase 2: Login Code Cleanup
**Goal**: The sign-in page contains no debug-specific logic, no client-side IP fetching, and no console leaks
**Depends on**: Phase 1
**Requirements**: LOGIN-01, LOGIN-02, LOGIN-03
**Success Criteria** (what must be TRUE):
  1. `sign-in.jsx` contains no reference to `tester123`, `api.ipify.org`, or IP storage logic
  2. Signing in as any user produces no `console.log` output visible in browser DevTools
  3. A developer reading `sign-in.jsx` encounters no code paths conditioned on a hardcoded username
**Plans**: TBD

### Phase 3: CI/CD Pipeline
**Goal**: The repository automatically builds a Docker image on merges to the main branch via GitHub Actions.
**Depends on**: Phase 2
**Requirements**: DEPLOY-01
**Success Criteria** (what must be TRUE):
  1. A `.github/workflows/docker-build.yml` file exists and is valid.
  2. The workflow successfully builds the `medsaas` Docker image based on the `Dockerfile`.
  3. Any code changes made in Phase 1 and 2 do not break the Docker build.
**Plans**: TBD

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Branding Cleanup | 1/1 | Not started | - |
| 2. Login Code Cleanup | 0/1 | Not started | - |
| 3. CI/CD Pipeline | 0/1 | Not started | - |

---

*Roadmap created: 2026-06-03*
