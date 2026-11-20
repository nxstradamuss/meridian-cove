// A cache of finished wordmark bitmaps.
//
// The wordmark is the most expensive thing the cover draws: a heavy condensed face painted glyph by glyph through
// a soft glow, a hard drop shadow, two keylines and a clipped gradient fill — a few hundred glyph rasterisations
// per frame. None of that changes while the caption, the type size and the grade stay the same, so the finished
// block is kept as a bitmap and blitted. Dragging a panel, reshuffling the collage or editing the kicker no longer
// re-rasterises the title.
//
// FIX 3: Added isHeroCover to cache key for suffix handling

const LIMIT = 4;
const layers = new Map();

/** Room around the block for the keyline, the forward lean and the glow, as a fraction of the type size. */
const PAD = 0.62;

/**
 * Returns a bitmap holding one wordmark block, painting it only on a cache miss. `key` must change exactly when
 * the pixels would; `width` and `height` are the block's measured size. `paint` is handed a context and the
 * bitmap's size, and must draw the block centred in it — so the caller can blit the bitmap centred on the point
 * the type belongs at.
 */
export function wordmarkLayer(key, size, width, height, paint) {
  const hit = layers.get(key);
  if (hit) {
    // Refresh the entry's place in the queue, so a block in use is never the one evicted.
    layers.delete(key);
    layers.set(key, hit);
    return hit;
  }

  const pad = Math.ceil(Math.max(8, size) * PAD);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width + pad * 2));
  canvas.height = Math.max(1, Math.ceil(height + pad * 2));
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx, canvas.width, canvas.height);

  layers.set(key, canvas);
  while (layers.size > LIMIT) layers.delete(layers.keys().next().value);
  return canvas;
}

/** Empties the cache, for a document whose type has all changed at once. */
export function clearWordmarkLayers() {
  layers.clear();
}