import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const serverEnvPath = path.join(root, 'server', '.env');

// Configuration is operator-owned. Startup must not manufacture environment
// files or suggest a local database instead of the approved Atlas target.
if (!fs.existsSync(envPath) && !fs.existsSync(serverEnvPath) && !process.env.MONGODB_URI) {
  console.warn('API configuration is missing: use the approved Atlas connection through MONGODB_URI or an operator-managed environment file. No configuration files were created.');
}

console.log('');
console.log('Pyxis Discovery development');
console.log('  Web:  http://localhost:5173  (open this in the browser)');
console.log('  API:  proxied from the web app — no VITE_API_HOSTNAME needed');
console.log('  API data: configured MongoDB Atlas; no local Mongo or RabbitMQ startup is required.');
console.log('');
