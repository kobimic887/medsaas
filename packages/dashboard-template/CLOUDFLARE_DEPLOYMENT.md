# Cloudflare Pages Deployment Guide

## API Proxy Function

This project includes a Cloudflare Pages function to handle API calls and bypass CORS restrictions when deployed.

### Files Added:

1. **`functions/api-proxy.js`** - Cloudflare Pages function that proxies calls to `api.chemtest.tech:3000`
2. **`public/_headers`** - CORS headers configuration for Cloudflare Pages
3. **`wrangler.toml`** - Cloudflare Pages configuration

### How It Works:

- **Development**: Uses `http://localhost:3002/api-proxy` (Node.js server)
- **Production**: Uses `/api-proxy` (Cloudflare Pages function)

The React component automatically detects the environment and uses the appropriate endpoint.

### Deployment:

1. Connect your repository to Cloudflare Pages
2. Set build command: `npm run build`
3. Set build output directory: `dist`
4. Deploy

The Cloudflare Pages function will automatically handle CORS and proxy API calls to the external service.

### Testing:

After deployment, the API Test tab will automatically work without CORS issues, fetching data from `api.chemtest.tech:3000` through the Cloudflare Pages function proxy.
