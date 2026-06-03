# Requirements: ChemBench Cleanup v1

**Defined:** 2026-06-03
**Core Value:** Labs and their customers never see any trace of the old Pyxis branding, and the login code is clean enough that the next developer isn't confused by debug special-cases.

## v1 Requirements

### Branding Cleanup

- [ ] **BRAND-01**: All `pyxis` strings removed from client source files (data file exports, import references, comments)
- [ ] **BRAND-02**: Data files renamed from `pyxisImages.js` / `pyxisServicesImages.js` to `libraryImages.js` / `servicesImages.js`; all importers updated
- [ ] **BRAND-03**: Pyxis image filenames (`pyxis-hero.jpg`, `pyxis-team.jpeg`, `pyxis-lab.jpeg`) replaced in `about-us.jsx` with CSS gradient placeholders — no new image assets added
- [ ] **BRAND-04**: Pyxis strings removed from `server/index.js` (email subject ~line 4821, JSDoc example ~line 4861)
- [ ] **BRAND-05**: Update `index.html` files (titles, meta tags) and verify `favicon.png` to remove Pyxis references
- [ ] **BRAND-06**: Add a `test:brand` script to `package.json` to prevent future regressions by failing if "pyxis" is found

### Login Code Cleanup

- [ ] **LOGIN-01**: `tester123`-specific IP-storage block removed from `sign-in.jsx` (success handler lines 55–67)
- [ ] **LOGIN-02**: Duplicate `api.ipify.org` fetch at sign-in top removed (lines 22–30) — IP logging moved to server-side only
- [ ] **LOGIN-03**: `console.log('Tester123 IP stored:', ...)` production leak removed

### CI/CD Pipeline

- [ ] **DEPLOY-01**: GitHub Actions workflow created to automatically build a Docker image of the application on merge to main. All code changes in prior phases must maintain Docker compatibility.

## v2 Requirements

### Auth Flows

- **AUTH-V2-01**: User can reset password via email link (forgot-password flow wired up end-to-end)

### Security Hardening

- **SEC-V2-01**: `tester123` server-side token-bypass guards removed from simulation endpoints
- **SEC-V2-02**: Unauthenticated mol-price and molecules endpoints secured with `authenticateToken`
- **SEC-V2-03**: CORS fail-secure when no origins configured
- **SEC-V2-04**: Helmet middleware added for missing security headers

## Out of Scope

| Feature | Reason |
|---------|--------|
| Forgot password flow | Explicitly deferred by user — build separately |
| Dead code removal (legacy/, packages/) | Bigger structural change — separate milestone |
| Security hardening (JWT, CORS, helmet, ReDoS) | Real security work — separate focused milestone |
| New image assets | Using CSS gradients as placeholders |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BRAND-01 | Phase 1 | Pending |
| BRAND-02 | Phase 1 | Pending |
| BRAND-03 | Phase 1 | Pending |
| BRAND-04 | Phase 1 | Pending |
| BRAND-05 | Phase 1 | Pending |
| BRAND-06 | Phase 1 | Pending |
| LOGIN-01 | Phase 2 | Pending |
| LOGIN-02 | Phase 2 | Pending |
| LOGIN-03 | Phase 2 | Pending |
| DEPLOY-01 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 10 total
- Mapped to phases: 10
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-03*
*Last updated: 2026-06-03 after initial definition*
