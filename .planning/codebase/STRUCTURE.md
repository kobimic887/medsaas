# Directory Structure

_Generated: 2026-06-03_

## Root

```
medsaas/                        # Repo root
├── package.json                # Workspace scripts (install:all, dev, start, check, services:*)
├── docker-compose.yml          # MongoDB, RabbitMQ, and optional science/worker services
├── Dockerfile                  # Container build for the unified server+client
├── start.sh                    # Shell script: build + start (Linux/macOS)
├── start-prod.sh               # Production variant of start.sh
├── CLAUDE.md                   # Project instructions for Claude
├── README.md                   # Project documentation
├── REPOS.md                    # Related repositories reference
├── .env.example                # Template for required environment variables
├── client/                     # Vite + React 18 frontend
├── server/                     # Express API server
├── services/                   # Optional Docker-based scientific microservices
├── packages/                   # Upstream UI reference template
├── legacy/                     # Archived standalone chemistry API (not used)
└── scripts/                    # Dev tooling scripts
```

---

## `client/`

```
client/
├── package.json                # Frontend dependencies
├── vite.config.js              # Vite config (envDir: '..', path alias @→src, dev proxy)
├── tailwind.config.cjs         # Tailwind CSS configuration
├── postcss.config.cjs          # PostCSS config
├── index.html                  # HTML entry point
├── public/                     # Static assets served verbatim
│   ├── img/                    # Images (logo, etc.)
│   ├── css/                    # Static CSS overrides
│   ├── ketcher/                # Ketcher 2D structure editor (bundled static)
│   ├── molstar/                # Molstar 3D viewer (bundled static)
│   └── pdbs/                   # Sample PDB structure files
└── src/
    ├── main.jsx                # React app bootstrap (providers, BrowserRouter)
    ├── App.jsx                 # Top-level router (dashboard/auth/main layouts)
    ├── routes.jsx              # All route definitions for all layouts
    ├── tailwind.css            # Tailwind base imports
    ├── styles/                 # Additional CSS files
    ├── pages/                  # Page components organized by layout
    │   ├── dashboard/          # Authenticated app pages
    │   │   ├── index.js        # Barrel export
    │   │   ├── controlpanel.jsx
    │   │   ├── simulation.jsx
    │   │   ├── molstar3d.jsx
    │   │   ├── dashboardhome.jsx
    │   │   ├── company-admin.jsx   # adminOnly: true
    │   │   ├── generate-molecules.jsx
    │   │   ├── protein-folding.jsx
    │   │   ├── gromacs-md.jsx
    │   │   ├── glioblastoma-predict.jsx
    │   │   ├── deep-similarity.jsx
    │   │   ├── moleculeviewer.jsx
    │   │   ├── paidplans.jsx
    │   │   ├── profile.jsx
    │   │   └── notifications.jsx
    │   ├── auth/               # Public auth pages
    │   │   ├── index.js
    │   │   ├── sign-in.jsx
    │   │   └── sign-up.jsx
    │   └── main/               # Public marketing pages
    │       ├── index.js
    │       ├── mainhome.jsx
    │       ├── services.jsx
    │       ├── about-us.jsx
    │       ├── contact-us.jsx
    │       ├── insights.jsx
    │       ├── paidplansdescription.jsx
    │       └── blog.jsx
    ├── layouts/                # Layout wrappers consumed by App.jsx
    │   ├── index.js            # Barrel export
    │   ├── dashboard.jsx       # Sidenav + top navbar + footer shell
    │   ├── auth.jsx            # Minimal auth shell
    │   └── mainpage.jsx        # Marketing site shell with MainNavbar
    ├── widgets/                # Shared UI primitives
    │   ├── layout/             # Chrome components
    │   │   ├── index.js
    │   │   ├── sidenav.jsx     # Left sidebar with route-based nav links
    │   │   ├── dashboard-navbar.jsx
    │   │   ├── navbar.jsx      # Auth page navbar
    │   │   ├── main-navbar.jsx # Marketing site navbar
    │   │   └── footer.jsx
    │   ├── cards/              # Card UI components
    │   │   ├── index.js
    │   │   ├── statistics-card.jsx
    │   │   ├── profile-info-card.jsx
    │   │   └── message-card.jsx
    │   └── charts/             # Chart components
    │       ├── index.js
    │       └── statistics-chart.jsx
    ├── components/             # Molecule visualization components
    │   ├── MoleculeDrawer.jsx
    │   ├── OCLMoleculeViewer.jsx
    │   ├── ProfessionalMoleculeViewer.jsx
    │   ├── SimpleMoleculeViewer.jsx
    │   └── DisabledOCLViewer.jsx
    ├── context/                # React context providers
    │   ├── index.jsx           # MaterialTailwindControllerProvider (sidenav UI state)
    │   ├── auth.jsx            # AuthProvider + useAuth hook
    │   ├── blog.jsx            # Blog context
    │   └── CartContext.jsx     # Shopping cart context
    ├── hooks/                  # Custom React hooks
    │   └── useBranding.js      # Resolves brandName from user's company or platform fallback
    ├── config/                 # Frontend config (not secrets)
    │   └── branding.js         # getBrandName(), getPlatformName() (client-side)
    ├── configs/                # Chart and UI configuration
    │   ├── index.js
    │   └── charts-config.js
    ├── data/                   # Static mock/seed data for UI
    │   ├── index.js
    │   ├── statistics-cards-data.js
    │   ├── statistics-charts-data.js
    │   ├── projects-table-data.js
    │   ├── authors-table-data.js
    │   ├── conversations-data.js
    │   ├── orders-overview-data.js
    │   ├── platform-settings-data.js
    │   ├── projects-data.js
    │   ├── pyxisImages.js
    │   └── pyxisServicesImages.js
    └── utils/                  # Frontend utilities
        ├── api.js              # getApiBaseUrl(), apiRequest()
        ├── constants.js        # getAuthToken() and other constants
        └── algo/               # Algorithm utilities (molecule-related)
```

---

## `server/`

```
server/
├── package.json                # Server dependencies (express, mongodb, stripe, etc.)
├── index.js                    # ENTIRE Express app: middleware, all routes, helpers (5821 lines, ESM)
├── routes/
│   └── scientificServices.js   # Express Router: GROMACS + Glioblastoma proxy routes
├── config/
│   └── branding.js             # getBrandName(), getPlatformName() (server-side, reads PLATFORM_NAME env)
└── utils/
    ├── emailService.js         # sendTitanEmail() via Titan Mail SMTP
    ├── emailTemplates.js       # generateVerificationEmailHTML()
    ├── emailDebug.js           # validateEmailCredentials(), getTitanMailHelp()
    └── rabbitMQUtils.js        # createAdmetTask(), getQueueStatus(), rabbitMQHealthCheck()
```

---

## `services/`

```
services/
├── admet/                      # ADMET prediction worker (Python, Docker)
│   ├── amqpadmet.py            # RabbitMQ consumer: receives tasks, runs prediction, POSTs results back
│   ├── admentpred.py           # ADMET prediction logic
│   ├── admetsendtopyxis.py     # Result callback to Express
│   ├── admet_ai/               # admet-ai library integration
│   ├── Dockerfile
│   └── requirements.txt
├── gromacs-api/                # GROMACS molecular dynamics (Python Flask, Docker)
│   ├── app.py                  # Flask REST API wrapping GROMACS workflow
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── requirements.txt
│   ├── templates_*.mdp         # GROMACS simulation parameter templates
│   └── env.example
└── glioblastoma-predictor/     # Glioblastoma ML prediction (Python Flask, Docker)
    ├── app.py                  # Flask REST API
    ├── Dockerfile
    ├── docker-compose.yml
    └── requirements.txt
```

---

## `packages/`

```
packages/
└── dashboard-template/         # Upstream Material Tailwind dashboard UI reference
    ├── src/                    # Original template source (not imported by the app)
    ├── public/
    └── functions/              # Firebase functions (unused)
```

This is a reference/upstream template only. It is not imported by `client/` or `server/`.

---

## `legacy/`

```
legacy/
└── chem-beo-api/               # Archived standalone chemistry API
    └── utils/                  # Not used by any current code
```

---

## Key Config Files

| File | Purpose |
|------|---------|
| `.env` (root, gitignored) | Runtime secrets and config for both server and client |
| `.env.example` (root) | Template listing all required and optional env vars |
| `client/vite.config.js` | Vite dev server, path alias `@`, `envDir: '..'`, proxy rules |
| `client/tailwind.config.cjs` | Tailwind CSS theme configuration |
| `docker-compose.yml` (root) | MongoDB, RabbitMQ, GROMACS, Glioblastoma, ADMET worker |
| `package.json` (root) | Workspace-level npm scripts for development and production |
| `server/package.json` | Server dependencies and `dev`/`start:unified` scripts |
| `client/package.json` | Client dependencies |

---

## Where to Add New Code

**New dashboard page:**
1. Create component at `client/src/pages/dashboard/<page-name>.jsx`
2. Export from `client/src/pages/dashboard/index.js`
3. Add route entry in `client/src/routes.jsx` under `layout: "dashboard"`

**New API endpoint:**
- Add handler in `server/index.js` following the pattern: `app.<method>('/api/<route>', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => { ... })`
- For scientific service proxies: add to `server/routes/scientificServices.js`

**New shared UI widget:**
- Add to appropriate `client/src/widgets/<cards|charts|layout>/` subdirectory
- Export from the `index.js` barrel in that directory

**New server utility:**
- Add to `server/utils/<name>.js` and import at the top of `server/index.js`

**New scientific microservice:**
- Create `services/<service-name>/` with Dockerfile and app entry point
- Add Docker Compose service to `docker-compose.yml`
- Add proxy routes to `server/routes/scientificServices.js`

**Environment variables:**
- Add to `.env.example` with documentation
- Reference from `server/index.js` at startup (add to `REQUIRED_ENV` array if mandatory)
