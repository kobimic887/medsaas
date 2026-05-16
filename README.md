# MedSaaS Unified App

This workspace now runs as a single app entrypoint:
- **Frontend**: `material-tailwind-dashboard-react`
- **Backend/API**: `chem_beo`
- **Runtime**: backend serves the built frontend bundle

## Run as one app

1. Install dependencies:
   - `npm run install:all`
2. Start unified app:
   - `npm start`

This command builds the frontend and starts the backend with static serving enabled.

## Required backend environment variables

In `chem_beo/.env` configure at least:
- `STRIPE_SECRET_KEY`
- `MONGODB_URI`
- `JWT_SECRET`
- `NVIDIA_MOLMIM_API_KEY`
- `NVIDIA_OPENFOLD_API_KEY`

Optional:
- `BASE_URL`
- `FRONTEND_URL`
- `PORT`
- `SSL_KEY_PATH`
- `SSL_CERT_PATH`
