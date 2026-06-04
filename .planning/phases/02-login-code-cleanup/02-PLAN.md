---
phase: 2
plan: 1
wave: 1
autonomous: true
files_modified:
  - client/src/pages/auth/sign-in.jsx
task_count: 3
requirements:
  - LOGIN-01
  - LOGIN-02
  - LOGIN-03
---

# Phase 2 — Plan 1: Login Code Cleanup

## Objective

Remove all debug-era IP-fetching and tester-bypass code from `sign-in.jsx`.
The sign-in page must contain no reference to `tester123`, `api.ipify.org`,
IP storage logic, or console leaks. A developer reading the file encounters
only clean, production-appropriate auth logic.

## Tasks

### Task 1: Remove client-side IP fetch (LOGIN-02)

Delete the `api.ipify.org` fetch block at the top of `handleSubmit` (lines 22–30)
and remove `ip_address: userIp` from the POST body. The server already receives
`req.ip` — this browser-side fetch is redundant and spoofable.

### Task 2: Remove tester123 IP-storage block (LOGIN-01 + LOGIN-03)

Delete the `if (username === "tester123")` block (lines 54–67) including:
- the `sessionStorage.setItem('tester123_ip', ...)` call
- the `sessionStorage.setItem('tester123_login_time', ...)` call
- the `console.log('Tester123 IP stored:', ...)` production leak

### Task 3: Verify clean state

Run `npm run check` to confirm the file compiles. Run `npm run test:brand` to
confirm no regressions. Verify no `console.log` remains in `sign-in.jsx`.

## Must-Haves

- `sign-in.jsx` contains no reference to `tester123`, `api.ipify.org`, IP storage
- No `console.log` in `sign-in.jsx`
- `npm run check` passes
