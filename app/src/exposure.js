// Panel exposure levelling.
//
// The collage is graded panel by panel, and each panel wears its grade at its own tone, so one plate can end up a
// good deal darker than the rest and read as a hole punched in the grid rather than a print. Once the frame is
// finished, the mean luminance of every panel is read back off the canvas, the composition's median is taken, and
// any panel sitting clearly under it is lifted toward that median: a multiplicative exposure gain on the panel's
// own pixels (a `lighter` blend of the panel over itself, which is arithmetically the same thing as a
// `brightness()` multiplier), then a whisper of `screen` in the panel's own mean colour to pick its shadows up.
// Both passes scale the channels together, so only luminance moves — the hue, and the hue family the grade was
// planned in, stay exactly where the shot plan put them.

/** The grid each panel is averaged down to when its luminance is read. */
const CELL = 12;
/** A panel this far under the median is left alone: the grid is allowed a little natural variation. */
const DARK_BY = 0.012;
/** The most the brightness gain ever reaches, so a lift can never blow a plate out. */
const MAX_GAIN = 1.24;
/** How hard the gain leans on the shortfall. Below one, the panel is brought toward the median, not past it. */
const GAIN_SLOPE = 1.05;
/** The strongest screen veil laid over a lifted panel. */
const MAX_VEIL = 0.05;
/** How far into a panel the measurement looks, so the print's edges and the gutters stay out of the average. */
const INSET = 0.06;

/** A scratch canvas holding every panel averaged down to one cell each, so the whole read is one readback. */
let strip = null;
/** A second scratch canvas, the size of the largest panel, for lifting one panel at a time. */
let lift = null;

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/** Reads every panel's mean colour and mean luminance off the finished canvas. */
function measurePanels(canvas, panels) {
  if (typeof document === 'undefined' || !canvas) return null;
  if (!strip) strip = document.createElement('canvas');
  strip.width = CELL;
  strip.height = CELL * panels.length;
  const sctx = strip.getContext('2d', { willReadFrequently: true });
  if (!sctx) return null;
  sctx.clearRect(0, 0, strip.width, strip.height);

  panels.forEach((rect, index) => {
    const sx = rect.x + rect.w * INSET;
    const sy = rect.y + rect.h * INSET;
    const sw = Math.max(1, rect.w * (1 - INSET * 2));
    const sh = Math.max(1, rect.h * (1 - INSET * 2));
    sctx.drawImage(canvas, sx, sy, sw, sh, 0, index * CELL, CELL, CELL);
  });

  const { data } = sctx.getImageData(0, 0, CELL, CELL * panels.length);
  const cells = [];
  for (let index = 0; index < panels.length; index += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    const start = index * CELL * CELL * 4;
    for (let i = start; i < start + CELL * CELL * 4; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const n = CELL * CELL;
    r /= n;
    g /= n;
    b /= n;
    cells.push({ rgb: [r, g, b], lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 });
  }
  return cells;
}

/** The middle value: half the panels sit under it and half over it, which is the exposure the grid agrees on. */
function medianOf(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Lifts one panel in place: the exposure gain, then the screen veil in its own mean colour.
 *
 * The gain is applied by laying the panel's own pixels back over themselves in `lighter` at `gain - 1`: the
 * arithmetic is `c + (gain - 1) * c`, which is exactly `c * gain` — a plain brightness multiplier, channel for
 * channel, so the hue cannot move. It is the same result as a `brightness()` filter, and it is one blend of the
 * panel rather than a filtered re-render of it, which keeps a redraw inside a frame.
 */
function liftPanel(ctx, canvas, rect, gain, veil, rgb) {
  if (!lift) lift = document.createElement('canvas');
  if (lift.width !== rect.w || lift.height !== rect.h) {
    lift.width = Math.max(1, rect.w);
    lift.height = Math.max(1, rect.h);
  }
  const sctx = lift.getContext('2d');
  if (!sctx) return false;
  sctx.clearRect(0, 0, rect.w, rect.h);
  sctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, gain - 1);
  ctx.drawImage(lift, rect.x, rect.y);
  ctx.restore();

  if (veil > 0.001) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = veil;
    ctx.fillStyle = `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }
  return true;
}

/**
 * Evens the panels out. Measures the finished panels, finds the composition's median luminance, and lifts any
 * panel more than a hair under it with a brightness gain and a screen veil in the panel's own colour. Returns a
 * report of what it measured and what it changed, so the editor or a probe can check the grid; returns null when
 * the canvas cannot be read.
 */
export function levelPanels(ctx, canvas, panels) {
  if (!panels || !panels.length) return null;
  try {
    const before = measurePanels(canvas, panels);
    if (!before) return null;
    const median = medianOf(before.map((cell) => cell.lum));
    const lifted = [];

    panels.forEach((rect, index) => {
      const cell = before[index];
      const deficit = median - cell.lum;
      if (deficit <= DARK_BY) return;
      const gain = Math.min(MAX_GAIN, 1 + (deficit / Math.max(0.05, median)) * GAIN_SLOPE);
      const veil = clamp(deficit * 0.3, 0, MAX_VEIL);
      if (gain <= 1.001 && veil <= 0.001) return;
      if (liftPanel(ctx, canvas, rect, gain, veil, cell.rgb)) {
        lifted.push({ index, gain, veil, before: cell.lum });
      }
    });

    const after = measurePanels(canvas, panels);
    return {
      median,
      before: before.map((cell) => cell.lum),
      after: after ? after.map((cell) => cell.lum) : null,
      lifted,
    };
  } catch {
    // A canvas the browser will not let us read keeps the frame as it was painted.
    return null;
  }
}
