// COMPAT-01 spike (throwaway/reference — nothing here is wired into server/).
//
// Proves node-vibrant + sharp install and extract a STRUCTURED palette
// (dominant + accent hex) under Bun on linux/arm64 inside oven/bun:1.3.14-slim.
// Mirrors the single-purpose shape of 05-rdkit.ts:
//   init dependency -> exercise on known input -> assert valid -> exit(1) on
//   failure -> print results (versions + sample output) to stdout.
//
// node-vibrant v4: the package root export intentionally throws; the Node build
// is imported via the `node-vibrant/node` subpath. Its image decoder is jimp
// (PNG/JPEG, NOT SVG), so the SVG path is probed via sharp rasterization (D-04).
import sharp from "sharp";
import { Vibrant } from "node-vibrant/node";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HEX = /^#[0-9a-fA-F]{6}$/;
const isHex = (s: unknown): s is string => typeof s === "string" && HEX.test(s);

type Sw = { name: string; hex: string; population: number };

// node-vibrant returns up to 6 named swatches (Vibrant/Muted/Light*/Dark*), ANY
// of which may be null. Do NOT hardcode names: keep non-null swatches with a
// valid hex, sorted most-populous first. dominant = [0], accent = [1].
function structured(palette: Record<string, unknown>): Sw[] {
  return Object.entries(palette)
    .map(([name, sw]) => {
      const s = sw as { hex?: unknown; population?: unknown } | null;
      return s && isHex(s.hex) && typeof s.population === "number"
        ? { name, hex: s.hex, population: s.population }
        : null;
    })
    .filter((s): s is Sw => s !== null)
    .sort((a, b) => b.population - a.population);
}

const rgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

console.log("=== COMPAT-01: node-vibrant + sharp compatibility spike ===");
console.log("sharp.versions:", JSON.stringify(sharp.versions));

// (1) Synthesize a raster PNG with sharp: vertical bands spanning hue AND
// luminance/saturation so >=2 named swatches reliably populate. No binary
// fixture is committed — this also exercises sharp's encode path.
const BAND_W = 50;
const H = 100;
const BANDS = ["#1e3a8a", "#f59e0b", "#10b981", "#fce7f3", "#111827"];
const W = BAND_W * BANDS.length;
const raw = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b] = rgb(BANDS[Math.floor(x / BAND_W)]);
    const i = (y * W + x) * 3;
    raw[i] = r;
    raw[i + 1] = g;
    raw[i + 2] = b;
  }
}
const rasterPath = join(tmpdir(), "vibrant-spike-raster.png");
await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toFile(rasterPath);
console.log("synthesized raster fixture:", rasterPath);

// (2)(3) Extract a structured palette from the raster (node-vibrant decodes the
// PNG via jimp). This is the GO/NO-GO gate.
const rasterPalette = await Vibrant.from(rasterPath).getPalette();
const sw = structured(rasterPalette as unknown as Record<string, unknown>);
console.log("populated swatches:", JSON.stringify(sw));

// (4) Assert non-empty + >=2 valid swatches. <2 from a VALID raster is a fixture
// problem to fix (adjust colours), NOT a NO-GO verdict.
if (sw.length < 2) {
  console.error(
    `RASTER FAIL: <2 populated swatches from a valid raster (got ${sw.length}). ` +
      "Fix the synthesized fixture colours — this is NOT a NO-GO verdict.",
  );
  process.exit(1);
}
const dominant = sw[0].hex;
const accent = sw[1].hex;
if (!isHex(dominant) || !isHex(accent)) {
  console.error("RASTER FAIL: invalid dominant/accent hex", { dominant, accent });
  process.exit(1);
}

// (5) Print the structured palette as readable hex (visible in container logs).
console.log(`RASTER PALETTE: { dominant: "${dominant}", accent: "${accent}" }`);
console.log(
  "RASTER PALETTE JSON:",
  JSON.stringify({ dominant, accent, swatches: sw.map((s) => ({ [s.name]: s.hex })) }),
);

// (6) SVG -> palette PROBE (D-04: probe, NOT a gate). node-vibrant's node
// decoder is jimp (no SVG), so probe the Phase-2-relevant path: sharp (libvips)
// rasterizes the SVG, then extract a palette. Record success/failure either way;
// never exit non-zero here.
try {
  const svgPng = join(tmpdir(), "vibrant-spike-svg.png");
  await sharp("fixtures/logo.svg").png().toFile(svgPng);
  const svgPalette = await Vibrant.from(svgPng).getPalette();
  const ssw = structured(svgPalette as unknown as Record<string, unknown>);
  if (ssw.length >= 1) {
    console.log(
      "SVG PROBE: OK (sharp rasterized SVG -> palette):",
      JSON.stringify(ssw.slice(0, 3).map((s) => ({ [s.name]: s.hex }))),
    );
  } else {
    console.log("SVG PROBE: FAILED no populated swatches after rasterization");
  }
} catch (e) {
  console.log("SVG PROBE: FAILED", (e as Error).message);
}

console.log("=== spike OK: raster path proven under Bun/arm64 ===");
