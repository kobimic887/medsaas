export const MAX_LIGAND_FILE_SIZE_BYTES = 2 * 1024 * 1024;

export const readFileAsBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const base64 = value.includes(",") ? value.split(",")[1] : value;
      resolve(base64 || "");
    };
    reader.onerror = () => reject(new Error("Unable to read ligand file"));
    reader.readAsDataURL(file);
  });

export async function buildLigandUploadPayload(file) {
  const contentBase64 = await readFileAsBase64(file);
  return {
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    contentBase64,
  };
}
