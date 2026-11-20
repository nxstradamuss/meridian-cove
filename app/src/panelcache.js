// A cache of finished panel bitmaps.
//
// Painting a panel is the most expensive thing the cover does: the photograph, the grade's blend passes and the
// print's edges all happen at the panel's full pixel size. But a panel only changes when its photograph, its shot,
// its crop, its grade or its tone changes — so each finished panel is kept as a bitmap and blitted on the next
// paint. Dragging a panel re-renders that one panel; typing a caption re-renders none of them.

const LIMIT = 12;
const layers = new Map();

/** A key that changes exactly when the pixels of the panel would change. */
function keyFor(panel, rect, grade, tone, photo) {
  return [
    photo?.id ?? 'none',
    panel.focusX?.toFixed(4), panel.focusY?.toFixed(4),
    panel.zoom, panel.anchorX, panel.anchorY, panel.flip ? 1 : 0,
    rect.w, rect.h, grade.id, panel.hero ? 1 : 0,
    tone?.shift ?? 0, tone?.heat ?? 1, tone?.depth ?? 0,
  ].join('|');
}

/**
 * Returns a canvas holding the finished panel, painting it only when the key changed. `paint` is called with the
 * panel-sized context and must fill the whole of it.
 */
export function panelLayer(panel, rect, grade, tone, photo, paint) {
  const key = keyFor(panel, rect, grade, tone, photo);
  const hit = layers.get(key);
  if (hit) {
    // Refresh the entry's place in the queue, so a panel in use is never the one evicted.
    layers.delete(key);
    layers.set(key, hit);
    return hit;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.w));
  canvas.height = Math.max(1, Math.round(rect.h));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  paint(ctx, canvas.width, canvas.height);

  layers.set(key, canvas);
  while (layers.size > LIMIT) {
    const oldest = layers.keys().next().value;
    layers.delete(oldest);
  }
  return canvas;
}

/** Empties the cache, for a document whose photos were all replaced. */
export function clearPanelLayers() {
  layers.clear();
}
