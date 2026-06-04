# Milestones

## v1 — ChemBench Cleanup

**Shipped:** 2026-06-04
**Phases:** 3 | **Plans:** 3
**Requirements:** 10/10 satisfied

### Delivered

Removed all Pyxis Discovery branding, cleaned up debug-era code in the sign-in page, and established a GitHub Actions CI/CD deploy pipeline to an Oracle arm64 VPS.

### Key Accomplishments

1. Zero pyxis references in source — `npm run test:brand` guards future regressions
2. `sign-in.jsx` cleaned to 34 lines — no third-party IP calls, no hardcoded usernames, no console leaks
3. Native arm64 deploy pipeline via SSH/SCP — builds in ~30s with no QEMU or registry dependency
4. All 10 v1 requirements satisfied across 3 phases

### Git Range

`d71efdf` (feat: rebrand) → `0e82571` (docs: phase 3 tracking)

---

*Updated: 2026-06-04*
