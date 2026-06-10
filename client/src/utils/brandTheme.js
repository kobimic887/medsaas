// Pure brand-theme derivation utility.
//
// Converts a company's four-colour palette (primary/accent/light/dark) into a
// 50..900 shade scale of RGB channel-triplet strings ("r g b") consumed by the
// --brand-* CSS variables. No DOM, no React — pure functions only.
//
// Conventions mirror utils/companyBranding.js: a frozen default export, named
// pure functions, and the same hex validation (HEX_COLOR / normalizeBrandHex)
// rather than duplicating it loosely.

const HEX_COLOR = /^#[0-9A-F]{6}$/;

// Tailwind shade keys, lightest (50) to darkest (900).
const SHADE_KEYS = Object.freeze([
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
]);

// Material Design green channel triplets — the exact colours withMT renders for
// green-* today. Deliberately duplicated from the :root block in tailwind.css so
// that no-JS first paint and the writer's reset path share one source of truth.
export const DEFAULT_BRAND_SCALE = Object.freeze({
  50: "232 245 233",
  100: "200 230 201",
  200: "165 214 167",
  300: "129 199 132",
  400: "102 187 106",
  500: "76 175 80",
  600: "67 160 71",
  700: "56 142 60",
  800: "46 125 50",
  900: "27 94 32",
});

// Reuse companyBranding.js validation semantics: trim + uppercase, must match
// a 6-digit hex. Returns the normalized hex or null.
export function normalizeBrandHex(value) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return HEX_COLOR.test(normalized) ? normalized : null;
}

// Parse a validated hex into [r, g, b] integers, or null when invalid.
function hexToRgb(hex) {
  const normalized = normalizeBrandHex(hex);
  if (!normalized) return null;
  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ];
}

function clampChannel(value) {
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > 255) return 255;
  return rounded;
}

function channelsToString([r, g, b]) {
  return `${clampChannel(r)} ${clampChannel(g)} ${clampChannel(b)}`;
}

// Linear interpolation between two [r,g,b] tuples. t in [0,1]: 0 => a, 1 => b.
function mixRgb(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// hex -> "r g b" channel string. Returns null on invalid input so callers can
// fall back without a try/catch.
export function hexToChannels(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? channelsToString(rgb) : null;
}

// Per-shade interpolation recipe.
//   - 500 is the primary anchor; 600 is the primary->dark midpoint (the common
//     "hover" weight withMT renders).
//   - 50..400 interpolate from primary toward light (lighter tints).
//   - 600..900 interpolate from primary toward dark (deeper shades), with 700
//     biased by accent so the hover/active step picks up the accent colour.
//   - factors are tuned to roughly track the Material Design green spacing.
//
// Each entry: [endpoint, t] where endpoint is one of the resolved palette
// tuples and t is the mix ratio from primary toward that endpoint. accent is a
// special endpoint used only for 700.
function shadeRecipe(key, primary, accent, light, dark) {
  switch (key) {
    case "50":
      return mixRgb(primary, light, 0.92);
    case "100":
      return mixRgb(primary, light, 0.78);
    case "200":
      return mixRgb(primary, light, 0.58);
    case "300":
      return mixRgb(primary, light, 0.38);
    case "400":
      return mixRgb(primary, light, 0.18);
    case "500":
      return primary;
    case "600":
      return mixRgb(primary, dark, 0.18);
    case "700":
      // hover/active step: lean primary->accent, then a touch toward dark.
      return mixRgb(mixRgb(primary, accent, 0.5), dark, 0.2);
    case "800":
      return mixRgb(primary, dark, 0.58);
    case "900":
      return mixRgb(primary, dark, 0.82);
    default:
      return primary;
  }
}

// Derive a full 50..900 channel-triplet scale from a four-colour palette.
// Returns DEFAULT_BRAND_SCALE unchanged when the palette is missing or any of
// the four colours fails hex validation (THEME-04 / T-03-02: never inject raw
// untrusted values, never throw).
export function deriveBrandScale(palette) {
  if (!palette || typeof palette !== "object") {
    return DEFAULT_BRAND_SCALE;
  }

  const primary = hexToRgb(palette.primary);
  const accent = hexToRgb(palette.accent);
  const light = hexToRgb(palette.light);
  const dark = hexToRgb(palette.dark);

  if (!primary || !accent || !light || !dark) {
    return DEFAULT_BRAND_SCALE;
  }

  const scale = {};
  for (const key of SHADE_KEYS) {
    scale[key] = channelsToString(shadeRecipe(key, primary, accent, light, dark));
  }
  return scale;
}
