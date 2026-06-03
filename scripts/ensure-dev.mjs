import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log('Created .env from .env.example');
  } else {
    console.warn('Warning: no .env or .env.example found at project root.');
  }
} else {
  const envText = fs.readFileSync(envPath, 'utf8');
  if (/VITE_API_HOSTNAME\s*=\s*(?!localhost|127\.0\.0\.1)/m.test(envText)) {
    console.warn(
      'Tip: remove VITE_API_HOSTNAME from .env for local dev — the app uses same-origin /api proxy on :5173.'
    );
  }
}

console.log('');
console.log('MedSaaS dev');
console.log('  Web:  http://localhost:5173  (open this in the browser)');
console.log('  API:  proxied from the web app — no VITE_API_HOSTNAME needed');
console.log('  Run:  npm run services:up  (Mongo + RabbitMQ) before signup/simulations');
console.log('');
