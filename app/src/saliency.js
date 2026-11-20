// Finds the subject of a photograph so a crop never cuts a face off. The image is shrunk into a 48 x 48 offscreen
// canvas, each cell is scored by how much it differs from its neighbours (luminance gradient) and by how much colour
// it holds, with a mild bias towards the centre of the frame; the focus point is the centroid of the strongest
// cluster. Flat sky and flat water score near zero, faces and busy subjects score high. Never throws.

const GRID = 48;

function blankCanvas(size) {
  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  return null;
}

/** The image's own width and height, whatever kind of drawable was handed in. */
function imageSize(image) {
  const width = image.naturalWidth || image.videoWidth || image.width || 0;
  const height = image.naturalHeight || image.videoHeight || image.height || 0;
  return { width, height };
}

/**
 * Returns the subject's position as {x, y} in 0..1 of the photo. Falls back to the upper-middle of the frame,
 * where a standing person's face usually is, when the image cannot be read at all.
 */
export function findFocus(image) {
  const fallback = { x: 0.5, y: 0.4 };
  try {
    const { width, height } = imageSize(image);
    if (!image || !width || !height) return fallback;

    const canvas = blankCanvas(GRID);
    if (!canvas) return fallback;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallback;

    ctx.clearRect(0, 0, GRID, GRID);
    ctx.drawImage(image, 0, 0, GRID, GRID);
    const { data } = ctx.getImageData(0, 0, GRID, GRID);

    // Luminance and chroma per cell.
    const luma = new Float32Array(GRID * GRID);
    const chroma = new Float32Array(GRID * GRID);
    for (let i = 0; i < GRID * GRID; i += 1) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      chroma[i] = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    }

    // Gradient magnitude against the four neighbours, plus a mild centre bias.
    const score = new Float32Array(GRID * GRID);
    let total = 0;
    let peak = 0;
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const i = y * GRID + x;
        const left = luma[y * GRID + Math.max(0, x - 1)];
        const right = luma[y * GRID + Math.min(GRID - 1, x + 1)];
        const up = luma[Math.max(0, y - 1) * GRID + x];
        const down = luma[Math.min(GRID - 1, y + 1) * GRID + x];
        const edge = Math.abs(right - left) + Math.abs(down - up);
        const nx = (x + 0.5) / GRID - 0.5;
        const ny = (y + 0.5) / GRID - 0.5;
        const distance = Math.sqrt(nx * nx + ny * ny) / 0.7071;
        const centreBias = 1 - 0.45 * distance;
        const value = (edge * (1 + 1.6 * chroma[i])) * centreBias;
        score[i] = value;
        total += value;
        if (value > peak) peak = value;
      }
    }
    if (total <= 0 || peak <= 0) return fallback;

    // Keep the hot cells: anything past 60% of the peak, weighted by how far past it is.
    const floor = peak * 0.6;
    let weightSum = 0;
    let wx = 0;
    let wy = 0;
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const i = y * GRID + x;
        if (score[i] <= floor) continue;
        const weight = score[i] - floor;
        weightSum += weight;
        wx += (x + 0.5) * weight;
        wy += (y + 0.5) * weight;
      }
    }
    if (weightSum <= 0) return fallback;

    const x = wx / weightSum / GRID;
    const y = wy / weightSum / GRID;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
    return { x: Math.min(0.92, Math.max(0.08, x)), y: Math.min(0.92, Math.max(0.08, y)) };
  } catch {
    return fallback;
  }
}
