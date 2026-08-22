import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from 'path';

// Vite's JSX transform and React's package entry both key off NODE_ENV. Bun does
// not set NODE_ENV=production for `bun run build` the way npm does, so an unset
// ambient value produced app chunks that call jsxDEV while vendor-react shipped
// the production jsx-runtime where jsxDEV is void 0 — blank white screen on every
// route (seen on 84:5174 after the 2026-08-21 deploy). Force production for
// builds regardless of the shell.
export default defineConfig(({ command }) => {
  const nodeEnv =
    command === "build"
      ? "production"
      : (process.env.NODE_ENV || "development");
  if (command === "build") {
    process.env.NODE_ENV = "production";
  }

  return {
  envDir: '..',
  plugins: [
    {
      name: 'exclude-git-directory',
      enforce: 'pre',
      resolveId(id) {
        // Exclude anything in .git directory
        if (id.includes('.git' + path.sep) || id.includes('.git/')) {
          return { id, external: true };
        }
      },
      async transform(code, id) {
        // Prevent processing of .git files
        if (id.includes('.git' + path.sep) || id.includes('.git/')) {
          return '';
        }
      }
    },
    react(),
    {
      // index.html carries `%VITE_PLATFORM_NAME%` for the browser tab. Vite substitutes
      // `%VITE_*%` only when the variable is set, and leaves the literal placeholder in the
      // page when it is not — so an unset env var would ship a tab reading
      // "%VITE_PLATFORM_NAME%". Fill it in here so the fallback is a real name.
      //
      // The rest of the app resolves the brand through src/config/branding.js, which applies
      // the same default. This exists because index.html is static and cannot call it.
      name: 'platform-name-in-html',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) =>
          html.replaceAll('%VITE_PLATFORM_NAME%', (process.env.VITE_PLATFORM_NAME || '').trim() || 'Pyxis Discovery'),
      },
    },
  ],
  resolve: {
    alias: [{ find: "@", replacement: "/src" }],
  },
  define: {
    // `'process.env': {}` on its own also replaced `process.env.NODE_ENV`, so React's
    // `process.env.NODE_ENV !== 'production'` guard read `undefined` and every build —
    // including the one deployed to production — shipped the DEVELOPMENT react-dom.
    // That is not just size: StrictMode double-invokes effects in the dev build, so the
    // first request of every mount-fetch-with-AbortController page was aborted (the
    // Simulation catalog rendered "No catalog molecules are available right now").
    // The specific key must stay listed before the broad one.
    // Always use the command-derived nodeEnv above — never re-read process.env here,
    // or an unset ambient NODE_ENV under Bun recreates the jsxDEV/prod-React mismatch.
    'process.env.NODE_ENV': JSON.stringify(nodeEnv),
    // Kept because dependencies still read bare `process.env`.
    'process.env': {},
    global: 'window',
  },
  optimizeDeps: {
    exclude: ['.git']
  },
  server: {
    host:'0.0.0.0',
    // Vite 5.4+/6+/8 block unknown Host headers (DNS-rebinding guard). Public
    // legacy and local `vite`/`preview` both need the production hostname here;
    // without it some clients get "Blocked request. This host is not allowed."
    allowedHosts: ['app.pyxis-discovery.com', 'localhost', '127.0.0.1'],
    https: false,
    port: 5173,
    headers: {
      'Content-Security-Policy': "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: data: https://cdn.jsdelivr.net https://api.nepcha.com https://3dmol.csb.pitt.edu https://unpkg.com; worker-src 'self' blob: data:"
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
      '/tanimoto': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
      '/create-checkout-session': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
      '/create-checkout-session-onetime': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
    },
    watch: {
      ignored: ['**/.git/**', '**/node_modules/**', '**/.env*', '**/dist/**', '**/.git']
    },
    fs: {
      strict: true,
      allow: ['.'],
      deny: ['.git', '.git/**']
    }
  },
  build: {
    // Source maps are useful for local debugging but add roughly 98 MB to the
    // deploy artifact and expose the entire source tree to every browser. The
    // staging/prod server serves bundled assets, not source maps.
    sourcemap: false,
    rollupOptions: {
      external: (id) => {
        // Exclude .git directory and only externalize actual npm packages
        if (id.includes('.git' + path.sep) || id.includes('.git/')) return true;
        return false;
      },
      output: {
        // Split the dependencies that never change away from the app code that does.
        // Without this every deploy invalidates one monolithic chunk and returning
        // users re-download React, the whole Material Tailwind surface and apexcharts
        // to pick up a one-line fix. Grouped rather than one-chunk-per-package: a
        // hundred tiny requests is its own kind of slow.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('apexcharts')) return 'vendor-charts';
          if (id.includes('@material-tailwind')) return 'vendor-ui';
          if (id.includes('@heroicons')) return 'vendor-icons';
          if (id.includes('react-router')) return 'vendor-router';
          // react/react-dom last: the checks above would otherwise swallow
          // react-apexcharts and react-router-dom into this chunk.
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'vendor-react';
          }
          return 'vendor';
        },
        // Ensure .git files are never included in output
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.includes('.git')) {
            return '[name].[ext]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  }
};
});
