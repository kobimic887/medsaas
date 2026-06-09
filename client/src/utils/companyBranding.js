export const MAX_LOGO_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const DEFAULT_BRAND_PALETTE = Object.freeze({
  primary: "#B4B239",
  accent: "#8E8C2D",
  light: "#E9E8C4",
  dark: "#484716",
});

const HEX_COLOR = /^#[0-9A-F]{6}$/;
const MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
]);

function getExtension(fileName = "") {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.includes(",") ? value.split(",")[1] : value);
    };
    reader.onerror = () => reject(new Error("Unable to read the selected logo."));
    reader.readAsDataURL(file);
  });
}

export function normalizeBrandHex(value) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return HEX_COLOR.test(normalized) ? normalized : null;
}

export function isValidBrandHex(value) {
  return normalizeBrandHex(value) !== null;
}

export async function buildLogoUploadPayload(file) {
  if (!file) {
    throw new Error("Choose a PNG, JPG, or SVG logo.");
  }
  if (file.size > MAX_LOGO_FILE_SIZE_BYTES) {
    throw new Error("Logo must be 5 MB or smaller.");
  }

  const extension = getExtension(file.name);
  const expectedType = MIME_BY_EXTENSION.get(extension);
  const suppliedType = (file.type || "").toLowerCase();
  const acceptedTypes = expectedType === "image/jpeg"
    ? new Set(["image/jpeg", "image/jpg"])
    : new Set([expectedType]);
  if (!expectedType || (suppliedType && !acceptedTypes.has(suppliedType))) {
    throw new Error("Choose a PNG, JPG, or SVG logo.");
  }

  const contentBase64 = await readFileAsBase64(file);
  if (!contentBase64) {
    throw new Error("Unable to read the selected logo.");
  }

  return {
    fileName: file.name,
    contentType: expectedType,
    sizeBytes: file.size,
    contentBase64,
  };
}
