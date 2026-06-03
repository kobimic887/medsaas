import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from 'path';

export default defineConfig({
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
      'Content-Security-Policy': "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: data: https://js.stripe.com https://cdn.jsdelivr.net https://api.nepcha.com https://3dmol.csb.pitt.edu https://unpkg.com; worker-src 'self' blob: data:"
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001', // Use IPv4 instead of localhost
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
        return /^[^.\/]/.test(id);
      },
      output: {
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