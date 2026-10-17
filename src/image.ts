// Image helpers: downscale in the browser before sending to Gemma, for speed.

const MAX_SIDE = 1280;
const JPEG_QUALITY = 0.85;

export interface PreparedImage {
  /** Base64 JPEG without the data: prefix, as Ollama expects. */
  base64: string;
  width: number;
  height: number;
  bytes: number;
}

export async function prepareImage(source: Blob): Promise<PreparedImage> {
  // createImageBitmap applies EXIF orientation by default in current browsers.
  const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode the photo."))),
      "image/jpeg",
      JPEG_QUALITY,
    ),
  );
  const base64 = await blobToBase64(blob);
  return { base64, width, height, bytes: blob.size };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the photo."));
    reader.readAsDataURL(blob);
  });
}

export async function fetchSample(): Promise<Blob> {
  const res = await fetch(`${import.meta.env.BASE_URL}sample-khata.jpg`);
  if (!res.ok) throw new Error("Sample page not found.");
  return res.blob();
}
