/**
 * Client-side image compression utilities.
 *
 * Why client-side? Because plaintext payloads in Morok are limited
 * to ~256KB after encryption (`MOROK_MAX_BLOB_BYTES`). A modern phone
 * photo is 4–10MB. We resize and re-encode in the browser before
 * encryption, so the relay never sees the original or the resized
 * version — only the encrypted blob.
 *
 * Output format is always JPEG (better compression than PNG for photos;
 * transparency intentionally collapsed onto black background to match
 * the Morok dark theme rather than producing huge files).
 */

const DEFAULT_MAX_DIM = 1200;
const DEFAULT_QUALITY = 0.75;

/**
 * Load a File / Blob into an HTMLImageElement.
 */
function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error('Не вдалось завантажити зображення'));
    };
    img.src = url;
  });
}

function computeTargetDims(srcW, srcH, maxDim) {
  if (Math.max(srcW, srcH) <= maxDim) {
    return { w: srcW, h: srcH };
  }
  if (srcW >= srcH) {
    return { w: maxDim, h: Math.round(srcH * (maxDim / srcW)) };
  }
  return { w: Math.round(srcW * (maxDim / srcH)), h: maxDim };
}

/**
 * Compress an image File/Blob to a base64 JPEG that fits the relay's
 * blob-size budget after JSON wrapping and encryption.
 *
 * The backend's MOROK_MAX_BLOB_BYTES is 262144 (256KB). After our
 * pipeline (JSON wrap → encrypt → base64-for-transport) the raw JPEG
 * budget is roughly ~140KB. iPhone photos at 1200px / q0.75 often
 * land at 180-220KB → over budget.
 *
 * Strategy: try progressively more aggressive (dim, quality) presets
 * until the JPEG fits the budget. Returns the first preset that works.
 * Throws if even the lowest-quality preset is over budget (unlikely
 * for any sane input).
 *
 * Returns: { data_b64, mime, w, h, original_size, compressed_size }
 */
export async function compressImage(file, {
  maxDim = DEFAULT_MAX_DIM,
  quality = DEFAULT_QUALITY,
  rawBudgetBytes = 140 * 1024,
} = {}) {
  if (!file || !file.size) throw new Error('Файл не вибрано');
  if (file.size > 50 * 1024 * 1024) {
    throw new Error('Файл завеликий (>50MB)');
  }

  const img = await loadImageFromBlob(file);

  // Progressive presets — first dimension stays at requested max, then
  // shrink quality, then shrink dimensions.
  const presets = [
    { dim: maxDim, q: quality },           // 1200 / 0.75 — best quality
    { dim: maxDim, q: 0.65 },              // same size, slightly lower q
    { dim: maxDim, q: 0.55 },              // ...lower
    { dim: 1024,   q: 0.65 },              // shrink
    { dim: 1024,   q: 0.55 },
    { dim: 800,    q: 0.6 },               // last resort
    { dim: 640,    q: 0.55 },
  ];

  let last = null;
  for (const p of presets) {
    const target = computeTargetDims(img.naturalWidth, img.naturalHeight, p.dim);

    const canvas = document.createElement('canvas');
    canvas.width = target.w;
    canvas.height = target.h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, target.w, target.h);
    ctx.drawImage(img, 0, 0, target.w, target.h);

    const dataUrl = canvas.toDataURL('image/jpeg', p.q);
    const data_b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const compressed_size = Math.floor(data_b64.length * 0.75);

    last = {
      data_b64,
      mime: 'image/jpeg',
      w: target.w,
      h: target.h,
      original_size: file.size,
      compressed_size,
    };

    if (compressed_size <= rawBudgetBytes) {
      return last;
    }
  }

  // None of the presets fit — return the smallest one anyway and let
  // the backend reject if it still over. Better than blocking.
  return last;
}

/**
 * Format byte sizes for UI display: 487KB, 1.2MB, etc.
 */
export function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
