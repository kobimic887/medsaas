import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from 'path';

export default defineConfig({
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
    'process.env': {},
    global: 'window',
  },
  optimizeDeps: {
    exclude: ['.git']
  },
  server: {
    host:'0.0.0.0',
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
});
