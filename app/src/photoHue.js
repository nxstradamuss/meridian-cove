// The hue a photograph already has.
//
// The key grade of a cover is chosen by comparing the hero photograph's own dominant hue with the accent hues of
// the two neon grades, and taking the one furthest away, so the grading carries the picture over to cyan and
// magenta instead of being laid over it in a colour it already had. The measurement is taken once per image on a
// 32 x 32 reduction: every cell votes for its hue, weighted by how saturated and how bright it is, because a
// saturated mid-tone is what the eye reads as "the colour" of a frame — a dark corner or a blown highlight is not.

import { hueOfRgb } from './colour.js';

const GRID = 32;
/** The hue of a photograph with no colour in it at all, or of a cover with no photograph yet: warm amber. */
export const NEUTRAL_HUE = 28;

const remembered = new WeakMap();

function blankCanvas(size) {
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      return canvas;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  } catch {
    // Fall through to the caller's fallback.
  }
  return null;
}

/** The image's own width and height, whatever kind of drawable was handed in. */
function imageSize(image) {
  return {
    width: image?.naturalWidth || image?.videoWidth || image?.width || 0,
    height: image?.naturalHeight || image?.videoHeight || image?.height || 0,
  };
}

/**
 * Returns the dominant hue of a photograph in degrees 0..360, or NEUTRAL_HUE when the image cannot be read or
 * holds no colour worth naming. Cached per image, so a redraw does not measure the same photograph again.
 */
export function dominantHue(image) {
  if (!image || typeof image !== 'object') return NEUTRAL_HUE;
  const hit = remembered.get(image);
  if (hit !== undefined) return hit;

  const { width, height } = imageSize(image);
  if (!width || !height) return NEUTRAL_HUE;

  let hue = NEUTRAL_HUE;
  try {
    const canvas = blankCanvas(GRID);
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.clearRect(0, 0, GRID, GRID);
      ctx.drawImage(image, 0, 0, GRID, GRID);
      const { data } = ctx.getImageData(0, 0, GRID, GRID);

      // A 24-bucket hue histogram, each bucket carrying the saturation-weighted vote of its cells. The buckets are
      // summed as vectors, so a photograph split between two neighbouring hues still yields one sensible answer.
      let weight = 0;
      let x = 0;
      let y = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = (max - min) / 255;
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        if (sat < 0.16 || lum < 0.1 || lum > 0.96) continue;
        const vote = sat * sat * (0.4 + lum);
        const radians = (hueOfRgb(r, g, b) * Math.PI) / 180;
        x += Math.cos(radians) * vote;
        y += Math.sin(radians) * vote;
        weight += vote;
      }
      if (weight > 0.02 && (Math.abs(x) > 1e-6 || Math.abs(y) > 1e-6)) {
        const degrees = (Math.atan2(y, x) * 180) / Math.PI;
        hue = (degrees + 360) % 360;
      }
    }
  } catch {
    hue = NEUTRAL_HUE;
  }

  remembered.set(image, hue);
  return hue;
}
