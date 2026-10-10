import fs from 'node:fs';
import path from 'node:path';

export function acceptedAssetEncodings(header = '') {
  const qualities = new Map();
  for (const item of String(header).toLowerCase().split(',')) {
    const [name, ...parameters] = item.trim().split(';');
    const parameter = parameters.find(value => value.trim().startsWith('q='));
    const quality = parameter ? Number(parameter.trim().slice(2)) : 1;
    qualities.set(name, Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0);
  }
  return ['br', 'gzip'].map(encoding => ({ encoding, quality: qualities.get(encoding) ?? qualities.get('*') ?? 0 }))
    .filter(item => item.quality > 0).sort((a, b) => b.quality - a.quality).map(item => item.encoding);
}

// Only public compiled assets are eligible. API/auth and uploaded files cannot
// pass this boundary; encoded traversal and range requests use the normal route.
export function precompressedAssets(directory) {
  const root = path.resolve(directory);
  return (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) || req.headers.range
      || !/^\/(?:assets|ketcher\/static)\/[\w./-]+\.(?:js|css|svg|wasm)$/.test(req.path)
      || req.path.split('/').some(part => part === '..' || part === '.')) return next();
    const original = path.resolve(root, req.path.slice(1));
    if (!original.startsWith(`${root}${path.sep}`) || !fs.existsSync(original)) return next();
    for (const encoding of acceptedAssetEncodings(req.headers['accept-encoding'])) {
      const file = `${original}.${encoding === 'br' ? 'br' : 'gz'}`;
      if (!fs.existsSync(file)) continue;
      res.vary('Accept-Encoding');
      res.type(path.extname(original));
      res.setHeader('Content-Encoding', encoding);
      const hashed = /[.-][\w-]{8,}\.(?:js|css|svg|wasm)$/.test(original);
      return res.sendFile(file, { maxAge: hashed ? 31536000000 : 0, immutable: hashed }, error => {
        if (error) next(error);
      });
    }
    return next();
  };
}
