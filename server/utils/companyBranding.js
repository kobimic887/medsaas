import sharp from 'sharp';
import { Vibrant } from 'node-vibrant/node';

export const MAX_LOGO_UPLOAD_BYTES = 5 * 1024 * 1024;

export const DEFAULT_BRAND_PALETTE = Object.freeze({
  primary: '#B4B239',
  accent: '#8E8C2D',
  light: '#E9E8C4',
  dark: '#484716'
});

const MAX_LOGO_PIXELS = 16_000_000;
const MAX_LOGO_DIMENSION = 1024;
const HEX_COLOR = /^#[0-9A-F]{6}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ALLOWED_TYPES = new Map([
  ['image/png', new Set(['.png'])],
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/jpg', new Set(['.jpg', '.jpeg'])],
  ['image/svg+xml', new Set(['.svg'])]
]);
const FORMAT_BY_TYPE = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/jpg', 'jpeg'],
  ['image/svg+xml', 'svg']
]);
const PALETTE_FIELDS = ['primary', 'accent', 'light', 'dark'];

function normalizedHex(value) {
  const candidate = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return HEX_COLOR.test(candidate) ? candidate : null;
}

function extensionFor(fileName) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

function decodeStrictBase64(value) {
  if (!value || value.length % 4 !== 0 || !BASE64.test(value)) {
    throw new Error('logoUpload.contentBase64 must be valid base64');
  }

  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 0) {
    throw new Error('Logo upload content is empty');
  }
  return decoded;
}

function hexToRgb(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16)
  ];
}

function rgbToHex(channels) {
  return `#${channels
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function mixHex(color, target, targetWeight) {
  const sourceRgb = hexToRgb(color);
  const targetRgb = hexToRgb(target);
  return rgbToHex(sourceRgb.map(
    (channel, index) => channel * (1 - targetWeight) + targetRgb[index] * targetWeight
  ));
}

function deriveAccent(primary) {
  return mixHex(primary, '#000000', 0.22);
}

function deriveLight(primary) {
  return mixHex(primary, '#FFFFFF', 0.68);
}

function deriveDark(primary, accent) {
  return mixHex(accent || primary, '#000000', 0.5);
}

function binaryToBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Buffer.isBuffer(value.buffer)) return value.buffer;
  if (typeof value.value === 'function') {
    const rawValue = value.value(true);
    if (Buffer.isBuffer(rawValue) || rawValue instanceof Uint8Array) {
      return Buffer.from(rawValue);
    }
  }
  return null;
}

export function normalizeBrandPalette(rawPalette = {}, fallback = DEFAULT_BRAND_PALETTE) {
  const normalizedFallback = {};
  for (const field of PALETTE_FIELDS) {
    normalizedFallback[field] = normalizedHex(fallback?.[field]) || DEFAULT_BRAND_PALETTE[field];
  }

  const normalized = {};
  for (const field of PALETTE_FIELDS) {
    if (rawPalette?.[field] === undefined || rawPalette?.[field] === null || rawPalette?.[field] === '') {
      normalized[field] = normalizedFallback[field];
      continue;
    }
    const value = normalizedHex(rawPalette[field]);
    if (!value) {
      throw new Error(`${field} must be a color in #RRGGBB format`);
    }
    normalized[field] = value;
  }
  return normalized;
}

export async function parseAndNormalizeLogoUpload(rawUpload) {
  if (!rawUpload || typeof rawUpload !== 'object' || Array.isArray(rawUpload)) {
    throw new Error('logoUpload must be an object');
  }

  const fileName = typeof rawUpload.fileName === 'string' ? rawUpload.fileName.trim() : '';
  const contentType = typeof rawUpload.contentType === 'string'
    ? rawUpload.contentType.trim().toLowerCase()
    : '';
  const contentBase64 = typeof rawUpload.contentBase64 === 'string'
    ? rawUpload.contentBase64.trim()
    : '';

  if (!fileName) throw new Error('logoUpload.fileName is required');
  if (!ALLOWED_TYPES.has(contentType)) {
    throw new Error('Choose a PNG, JPG, or SVG logo');
  }
  if (!ALLOWED_TYPES.get(contentType).has(extensionFor(fileName))) {
    throw new Error('Logo file extension does not match its content type');
  }
  if (Number(rawUpload.sizeBytes) > MAX_LOGO_UPLOAD_BYTES) {
    throw new Error('Logo must be 5 MB or smaller');
  }

  const decoded = decodeStrictBase64(contentBase64);
  if (decoded.length > MAX_LOGO_UPLOAD_BYTES) {
    throw new Error('Logo must be 5 MB or smaller');
  }
  if (
    rawUpload.sizeBytes !== undefined
    && (!Number.isInteger(Number(rawUpload.sizeBytes)) || Number(rawUpload.sizeBytes) !== decoded.length)
  ) {
    throw new Error('logoUpload.sizeBytes does not match the decoded file size');
  }

  let image;
  let metadata;
  let normalized;
  try {
    image = sharp(decoded, {
      failOn: 'error',
      limitInputPixels: MAX_LOGO_PIXELS
    });
    metadata = await image.metadata();
    if (metadata.format !== FORMAT_BY_TYPE.get(contentType)) {
      throw new Error('Logo content does not match its declared file type');
    }
    normalized = await image
      .rotate()
      .resize({
        width: MAX_LOGO_DIMENSION,
        height: MAX_LOGO_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true
      })
      .png()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new Error(`Logo image is invalid: ${error.message}`);
  }

  return {
    fileName: fileName.slice(0, 255).replace(/\.[^.]+$/, '.png'),
    contentType: 'image/png',
    sizeBytes: normalized.data.length,
    width: normalized.info.width,
    height: normalized.info.height,
    data: normalized.data,
    updatedAt: new Date()
  };
}

export async function extractBrandPalette(buffer) {
  const pngBuffer = binaryToBuffer(buffer);
  if (!pngBuffer?.length) {
    throw new Error('A normalized logo buffer is required for palette extraction');
  }

  const palette = await Vibrant.from(pngBuffer).getPalette();
  const swatches = Object.values(palette)
    .filter((swatch) => swatch && normalizedHex(swatch.hex) && Number.isFinite(swatch.population))
    .map((swatch) => ({
      hex: normalizedHex(swatch.hex),
      population: swatch.population
    }))
    .sort((left, right) => right.population - left.population);

  if (swatches.length === 0) {
    throw new Error('No usable colors were found in the logo');
  }

  const primary = swatches[0].hex;
  const accent = swatches.find((swatch) => swatch.hex !== primary)?.hex || deriveAccent(primary);
  return {
    primary,
    accent,
    light: deriveLight(primary),
    dark: deriveDark(primary, accent)
  };
}

export function serializeCompanyBranding(company) {
  const savedBranding = company?.branding || {};
  const palette = normalizeBrandPalette(savedBranding.palette || {});
  const logoData = binaryToBuffer(savedBranding.logo?.data);
  const logo = logoData?.length
    ? {
        fileName: savedBranding.logo.fileName || 'company-logo.png',
        contentType: 'image/png',
        sizeBytes: Number(savedBranding.logo.sizeBytes) || logoData.length,
        width: Number(savedBranding.logo.width) || null,
        height: Number(savedBranding.logo.height) || null,
        updatedAt: savedBranding.logo.updatedAt || savedBranding.updatedAt || null,
        dataUrl: `data:image/png;base64,${logoData.toString('base64')}`
      }
    : null;

  return {
    palette,
    logo,
    isCustom: Boolean(savedBranding.palette || logo),
    updatedAt: savedBranding.updatedAt || null
  };
}
