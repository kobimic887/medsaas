import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { brotliCompress, constants, gzip } from 'node:zlib';

const compressBr = promisify(brotliCompress), compressGzip = promisify(gzip);
export async function precompressPublicAssets(outputDirectory) {
const directory = path.resolve(outputDirectory);
let files = 0, originalBytes = 0, brotliBytes = 0;
async function visit(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) { await visit(file); continue; }
    if (!entry.isFile() || !/\.(?:js|css|svg|wasm)$/.test(entry.name) || (await stat(file)).size < 1024) continue;
    const original = await readFile(file);
    const [br, gz] = await Promise.all([
      compressBr(original, { params: { [constants.BROTLI_PARAM_QUALITY]: 7 } }),
      compressGzip(original, { level: 7 }),
    ]);
    await writeFile(`${file}.br`, br);
    await writeFile(`${file}.gz`, gz);
    files++; originalBytes += original.length; brotliBytes += br.length;
  }
}
for (const folder of ['assets', 'ketcher/static']) {
  try { await visit(path.join(directory, folder)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
console.log(JSON.stringify({ directory, files, originalBytes, brotliBytes }));
return { files, originalBytes, brotliBytes };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await precompressPublicAssets(process.argv[2] || 'client/dist');
}
