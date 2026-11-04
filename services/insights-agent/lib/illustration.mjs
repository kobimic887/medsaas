// Original editorial artwork, generated locally without a paid image service or
// third-party figure rights. This is a conceptual loop, never an atom/bond diagram
// or a claim about the paper's molecular structures or experimental findings.
import { deflateSync } from 'node:zlib';

const WIDTH = 1200;
const HEIGHT = 630;
export const ILLUSTRATION_ALT = 'Conceptual macrocycle illustration: a closed loop with alternative conformations.';
export const ILLUSTRATION_CAPTION = 'Original conceptual illustration of a macrocycle. Not a molecular structure, binding pose or experimental result.';

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function chunk(name, bytes) {
  const type = Buffer.from(name);
  const content = Buffer.concat([type, bytes]);
  let crc = 0xffffffff;
  for (const byte of content) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length, 0);
  content.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

/** A 1200×630 PNG suitable for both the Insights card and the inline figure. */
export function macrocycleIllustration(pmid) {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  const navy = [0, 6, 55];
  const olive = [180, 178, 57];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = (y * WIDTH + x) * 3;
      const shade = Math.round(250 - 8 * x / WIDTH);
      pixels[index] = shade;
      pixels[index + 1] = shade;
      pixels[index + 2] = Math.max(230, shade - 7);
    }
  }
  function dot(cx, cy, radius, color, opacity = 1) {
    for (let y = Math.max(0, Math.floor(cy - radius - 1)); y <= Math.min(HEIGHT - 1, Math.ceil(cy + radius + 1)); y += 1) {
      for (let x = Math.max(0, Math.floor(cx - radius - 1)); x <= Math.min(WIDTH - 1, Math.ceil(cx + radius + 1)); x += 1) {
        const coverage = Math.min(1, Math.max(0, radius + 0.5 - Math.hypot(x - cx, y - cy))) * opacity;
        const index = (y * WIDTH + x) * 3;
        for (let c = 0; c < 3; c += 1) pixels[index + c] = Math.round(pixels[index + c] * (1 - coverage) + color[c] * coverage);
      }
    }
  }
  const phase = Number(String(pmid).slice(-3)) / 997;
  function loop(cx, cy, scale, offset, color, opacity, thickness) {
    for (let step = 0; step <= 1500; step += 1) {
      const t = step / 1500 * 2 * Math.PI;
      const r = scale * (1 + 0.12 * Math.cos(3 * t + phase + offset) + 0.055 * Math.sin(5 * t - offset));
      dot(cx + r * Math.cos(t), cy + 0.81 * r * Math.sin(t), thickness, color, opacity);
    }
  }
  // Faint orbit-like loops provide context without masquerading as scientific data.
  loop(390, 320, 210, 0.5, olive, 0.22, 2);
  loop(390, 320, 198, 0, navy, 1, 13);
  loop(875, 270, 119, 1.6, olive, 1, 9);
  loop(875, 350, 119, 2.6, navy, 0.30, 6);
  for (let i = 0; i < 3; i += 1) dot(664 + i * 23, 315, 4, olive);
  // Brand accent below the composition; no model-generated lettering.
  for (let x = 85; x < 1115; x += 1) dot(x, 560, 1, olive, 0.7);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 2; // RGB
  const scanlines = Buffer.alloc(HEIGHT * (WIDTH * 3 + 1));
  for (let y = 0; y < HEIGHT; y += 1) pixels.copy(scanlines, y * (WIDTH * 3 + 1) + 1, y * WIDTH * 3, (y + 1) * WIDTH * 3);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
