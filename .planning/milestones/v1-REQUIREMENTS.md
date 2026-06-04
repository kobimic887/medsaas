# Requirements Archive: ChemBench Cleanup v1

**Archived:** 2026-06-04
**Milestone:** v1 — ChemBench Cleanup
**All v1 requirements:** ✅ Complete

---

## v1 Requirements (All Shipped)

### Branding Cleanup

- [x] **BRAND-01**: All `pyxis` strings removed from client source files — ✓ Phase 1
- [x] **BRAND-02**: Data files renamed to `libraryImages.js` / `servicesImages.js`; all importers updated — ✓ Phase 1
- [x] **BRAND-03**: Pyxis image references replaced with CSS gradient placeholders — ✓ Phase 1
- [x] **BRAND-04**: Pyxis strings removed from `server/index.js` — ✓ Phase 1
- [x] **BRAND-05**: `index.html` titles and meta tags updated; favicon reviewed — ✓ Phase 1
- [x] **BRAND-06**: `test:brand` regression guard added to `package.json` — ✓ Phase 1

### Login Code Cleanup

- [x] **LOGIN-01**: `tester123` IP-storage block removed from `sign-in.jsx` — ✓ Phase 2
- [x] **LOGIN-02**: `api.ipify.org` fetch at sign-in top removed — ✓ Phase 2
- [x] **LOGIN-03**: `console.log('Tester123 IP stored:', ...)` removed — ✓ Phase 2

### CI/CD Pipeline

- [x] **DEPLOY-01**: GitHub Actions workflow created, builds and deploys Docker image — ✓ Phase 3

---

## Traceability

| Requirement | Phase | Status | Outcome |
|-------------|-------|--------|---------|
| BRAND-01 | Phase 1 | ✅ Complete | Validated — zero pyxis matches in source |
| BRAND-02 | Phase 1 | ✅ Complete | Validated — files renamed, importers compile |
| BRAND-03 | Phase 1 | ✅ Complete | Validated — CSS gradients replace image refs |
| BRAND-04 | Phase 1 | ✅ Complete | Validated — server emails no longer mention Pyxis |
| BRAND-05 | Phase 1 | ✅ Complete | Validated — titles and meta updated |
| BRAND-06 | Phase 1 | ✅ Complete | Validated — `npm run test:brand` passes |
| LOGIN-01 | Phase 2 | ✅ Complete | Validated — no tester123 in sign-in.jsx |
| LOGIN-02 | Phase 2 | ✅ Complete | Validated — no api.ipify.org calls |
| LOGIN-03 | Phase 2 | ✅ Complete | Validated — no console.log in sign-in.jsx |
| DEPLOY-01 | Phase 3 | ✅ Complete | Validated — deploy.yml exists and works |

---

## v2 Requirements (Carried Forward)

### Auth Flows
- **AUTH-V2-01**: User can reset password via email link (forgot-password flow)

### Security Hardening
- **SEC-V2-01**: `tester123` server-side token-bypass guards removed from simulation endpoints
- **SEC-V2-02**: Unauthenticated mol-price and molecules endpoints secured
- **SEC-V2-03**: CORS fail-secure when no origins configured
- **SEC-V2-04**: Helmet middleware added for missing security headers

---

*Archive created: 2026-06-04 at milestone v1 close*
