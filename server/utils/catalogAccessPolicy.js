import { Router } from 'express';

// Retirement is unconditional. A saved company URL or environment variable is
// configuration data, not permission to restore a supplier network dependency.
const RETIRED_CATALOG_PATH = /^\/(?:api\/(?:asinex|api4|exact|all|id|shop)|api4)(?:\/|$)/i;

export function isRetiredCatalogPath(path) {
  return RETIRED_CATALOG_PATH.test(String(path || ''));
}

export function refuseRetiredCatalog(_req, res) {
  return res.status(503).json({
    code: 'CATALOG_RETIRED',
    error: 'The supplier catalog and molecule checkout are unavailable. Use Pyxis Stock, Macrocycles (RPX / VPX), or Open compounds to search. Credit packs remain available.',
    availableSources: ['stock', 'macrocycles', 'open'],
  });
}

export function createRetiredCatalogRouter({ middleware = [] } = {}) {
  const router = Router();
  const refusal = Router();
  refusal.use(...middleware, refuseRetiredCatalog);
  router.use((req, res, next) => {
    if (isRetiredCatalogPath(req.path)) return refusal(req, res, next);
    return next();
  });
  return router;
}

// Match the DNS label boundary: asinex.com and its subdomains, including a
// trailing DNS dot. Unrelated hosts containing the word are not blocked.
export function isRetiredSupplierUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/\.+$/, '');
    return hostname === 'asinex.com' || hostname.endsWith('.asinex.com');
  } catch {
    return false;
  }
}

export function refuseRetiredScientificProvider(res) {
  return res.status(503).json({
    code: 'SUPPLIER_PROVIDER_RETIRED',
    error: 'This scientific service still points to the retired supplier. Configure a Pyxis compute service before running it. No credits were charged.',
  });
}
