// Turns a panel's plan into the rectangle of photograph that is drawn inside it, and keeps the subject's face from
// being sliced by a panel edge. The same numbers are used to draw the panel and to work out how far a drag should
// move the crop, so dragging a panel and painting it can never disagree.

/** The subject stays at least this far inside every edge of its panel. */
export const FACE_MARGIN = 0.12;

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Places an image of `span` pixels inside a `size`-pixel panel so that `point` (0..1 of the image) lands at least
 * `margin` inside both edges, while still covering the panel completely.
 */
function placeAxis(offset, size, span, point, margin) {
  const coverLow = size - span;
  const coverHigh = 0;
  const insideLow = margin * size - point * span;
  const insideHigh = (1 - margin) * size - point * span;
  const low = Math.max(coverLow, insideLow);
  const high = Math.min(coverHigh, insideHigh);
  if (low <= high) return clamp(offset, low, high);
  // The two rules cannot both hold (a very wide zoom out): cover the panel, and let the margin give way.
  return insideLow > coverHigh ? coverHigh : coverLow;
}

/**
 * The drawn rectangle for `panel` inside `rect` (a panel in canvas pixels). `flip` mirrors the image across the
 * panel's vertical axis, so the returned offsets are measured in the mirrored frame.
 */
export function cropFrame(image, rect, panel) {
  const iw = image.naturalWidth || image.width || 0;
  const ih = image.naturalHeight || image.height || 0;
  const zoom = clamp(Number(panel?.zoom) || 1, 1, 4);
  const width = Math.max(1, rect.w);
  const height = Math.max(1, rect.h);
  if (!iw || !ih) return { dx: 0, dy: 0, dw: width, dh: height, scale: 1, flip: !!panel?.flip, ok: false };

  const scale = Math.max(width / iw, height / ih) * zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  const flip = !!panel?.flip;

  // A mirrored panel shows the photograph reversed, so the crop is positioned in mirrored coordinates.
  const focusX = clamp(flip ? 1 - (panel?.focusX ?? 0.5) : (panel?.focusX ?? 0.5), 0, 1);
  const focusY = clamp(panel?.focusY ?? 0.5, 0, 1);
  const anchorX = clamp(panel?.anchorX ?? 0.5, 0, 1);
  const anchorY = clamp(panel?.anchorY ?? 0.5, 0, 1);

  let dx = width * anchorX - focusX * dw;
  let dy = height * anchorY - focusY * dh;

  const faceX = clamp(flip ? 1 - (panel?.faceX ?? panel?.focusX ?? 0.5) : (panel?.faceX ?? panel?.focusX ?? 0.5), 0, 1);
  const faceY = clamp(panel?.faceY ?? panel?.focusY ?? 0.5, 0, 1);
  dx = placeAxis(dx, width, dw, faceX, FACE_MARGIN);
  dy = placeAxis(dy, height, dh, faceY, FACE_MARGIN);

  return { dx, dy, dw, dh, scale, flip, ok: true };
}

/**
 * Moves a panel's focus by a drag of (`dx`, `dy`) canvas pixels inside it, so the picture follows the pointer.
 * Returns the new focus in photo coordinates, already clamped to the photograph.
 */
export function dragFocus(image, rect, panel, dx, dy) {
  const frame = cropFrame(image, rect, panel);
  const dirX = frame.flip ? 1 : -1;
  const focusX = clamp((panel?.focusX ?? 0.5) + (dirX * dx) / Math.max(1, frame.dw), 0, 1);
  const focusY = clamp((panel?.focusY ?? 0.5) - dy / Math.max(1, frame.dh), 0, 1);
  return { focusX, focusY };
}
