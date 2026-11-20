// The Vice City colour grades. Each grade is a stack of compositing passes over the photograph already drawn in the
// panel: a duotone pass in `color` blend mode (which keeps the photograph's light and swaps its hue), then gradients
// in overlay / soft-light / screen / multiply / color-dodge. The grade's `filter` is applied by the caller as the
// photograph is drawn, so the saturation and contrast of the source are part of the same single draw instead of a
// second pass over the pixels.
//
// A grade is worn in a *tone*: the same recipe with its hues moved a few degrees round the wheel and its washes run
// hotter or deeper. That is what lets one cover use one grade five times and still show variety — variety of
// intensity, not of hue family. The light is not part of any grade: every panel ends with the same sun and the same
// vignette (see `sharedLight`), so the prints read as one photograph cut into pieces.

import { formatColour, hueGap, hueOfColour, parseColour, rotateColour, setAlpha } from './colour.js';

/** Fills the panel with a paint (a gradient, usually) under a blend mode. */
function paint(ctx, w, h, style, mode = 'source-over', alpha = 1) {
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = style;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * Recolours the panel: `color` blend takes the hue and saturation of the paint and keeps the photograph's
 * luminance, which is what turns an ordinary snapshot into a poster's two-colour print.
 */
function duotone(ctx, w, h, style, alpha) {
  paint(ctx, w, h, style, 'color', alpha);
}

/** A vertical or diagonal gradient built from [offset, colour] stops. */
function linear(ctx, x0, y0, x1, y1, stops) {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [offset, colour] of stops) gradient.addColorStop(offset, colour);
  return gradient;
}

/** A radial glow built from [offset, colour] stops. */
function radial(ctx, cx, cy, inner, outer, stops) {
  const gradient = ctx.createRadialGradient(cx, cy, Math.max(0, inner), cx, cy, Math.max(inner + 1, outer));
  for (const [offset, colour] of stops) gradient.addColorStop(offset, colour);
  return gradient;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * A band of light lying across the frame: wide, thin, and brightest in the middle, the smear a row of signs leaves
 * in the air. It is a radial glow squashed to a fraction of its height, so it reads as a horizontal streak rather
 * than another round lamp, and it is screened over the photograph so it lights the panel instead of covering it.
 */
function bloomBand(ctx, w, h, cx, cy, spread, colour, tone) {
  const ink = parseColour(colour);
  const peak = clamp01(ink.a);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = tone.a(1);
  ctx.translate(w * cx, h * cy);
  ctx.scale(1, 0.12);
  const band = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, w * spread));
  band.addColorStop(0, tone.c(setAlpha(ink, peak)));
  band.addColorStop(0.42, tone.c(setAlpha(ink, peak * 0.45)));
  band.addColorStop(1, tone.c(setAlpha(ink, 0)));
  ctx.fillStyle = band;
  ctx.fillRect(-w * 1.5, -h * 12, w * 3, h * 24);
  ctx.restore();
}

/**
 * The two-ink print, as a true gradient map: every pixel's own luminance is looked up in a ramp built from `stops`
 * — [position, colour] pairs running from the shadow ink through whatever the grade wants in the middle to the
 * highlight ink — so a dark pixel comes out the shadow colour and a lit pixel the highlight, wherever they sit in
 * the frame. That is what lets the shadows be cyan and the light pink at the same time; a wash laid over the panel
 * cannot do it, because a wash has no idea which pixels are dark. `rightStops`, when given, is a second ramp that
 * the print runs into from the left edge to the right, which is how the vice grade gets pink on one side of the
 * frame and turquoise on the other while both sides keep the same shadow ink. `gamma` lifts or sinks the middle of
 * the ramp. The panel bitmap is cached by its caller, so the pixels are walked only when the shot, the crop or the
 * grade actually changes.
 */
function inkMap(ctx, w, h, stops, rightStops, gamma = 1) {
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));
  const curve = Math.min(4, Math.max(0.2, gamma));

  // One 256-entry ramp per side, interpolated between that side's stops.
  const buildRamp = (list) => {
    const inks = list
      .map(([at, colour]) => ({ at: clamp01(at), ink: parseColour(colour) }))
      .sort((first, second) => first.at - second.at);
    const ramp = new Uint8ClampedArray(256 * 3);
    if (!inks.length) return ramp;
    for (let step = 0; step < 256; step += 1) {
      const t = Math.pow(step / 255, curve);
      let index = 0;
      while (index < inks.length - 2 && t > inks[index + 1].at) index += 1;
      const from = inks[index];
      const to = inks[Math.min(inks.length - 1, index + 1)];
      const span = Math.max(1e-6, to.at - from.at);
      const k = clamp01((t - from.at) / span);
      ramp[step * 3] = from.ink.r + (to.ink.r - from.ink.r) * k;
      ramp[step * 3 + 1] = from.ink.g + (to.ink.g - from.ink.g) * k;
      ramp[step * 3 + 2] = from.ink.b + (to.ink.b - from.ink.b) * k;
    }
    return ramp;
  };
  const left = buildRamp(stops);
  const right = rightStops ? buildRamp(rightStops) : left;

  let image = null;
  try {
    image = ctx.getImageData(0, 0, width, height);
  } catch {
    return; // A canvas the browser will not let us read keeps the photograph as it was drawn.
  }
  const { data } = image;
  const pixels = Math.max(1, data.length / 4);

  // Levels: the picture's own 2nd and 98th percentile of luminance become the ends of the ramp, so a flat or hazy
  // photograph still reaches both inks. Without this a low-contrast crop sits in the middle of the ramp and the
  // whole panel comes out one flat violet, which is exactly the wash this grade is trying to get away from.
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    histogram[Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])] += 1;
  }
  const cut = Math.max(1, Math.round(pixels * 0.02));
  let low = 0;
  let high = 255;
  let seen = 0;
  for (let step = 0; step < 256; step += 1) {
    seen += histogram[step];
    if (seen >= cut) { low = step; break; }
  }
  seen = 0;
  for (let step = 255; step >= 0; step -= 1) {
    seen += histogram[step];
    if (seen >= cut) { high = step; break; }
  }
  const span = Math.max(8, high - low);

  for (let i = 0; i < data.length; i += 4) {
    const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const step = Math.round(Math.pow(clamp01((luminance - low) / span), curve) * 255) * 3;
    const column = (i / 4) % width;
    const across = width > 1 ? column / (width - 1) : 0;
    data[i] = left[step] + (right[step] - left[step]) * across;
    data[i + 1] = left[step + 1] + (right[step + 1] - left[step + 1]) * across;
    data[i + 2] = left[step + 2] + (right[step + 2] - left[step + 2]) * across;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * A tone is how a grade is worn: `shift` moves every hue in the recipe this many degrees, `heat` scales every
 * wash's strength, and `depth` sinks the shadows. `c()` returns the tone's version of a colour, `a()` its version
 * of an alpha. Tones are immutable, so one can be handed round freely.
 */
export function makeTone(options = {}) {
  const shift = Number.isFinite(options.shift) ? options.shift : 0;
  const heat = Number.isFinite(options.heat) ? options.heat : 1;
  const depth = Number.isFinite(options.depth) ? clamp01(options.depth) : 0;
  const memory = new Map();

  return {
    shift,
    heat,
    depth,
    /** The tone's version of a colour: the hue moved, the alpha untouched (the pass alpha carries the heat). */
    c(colour) {
      if (!shift) return typeof colour === 'string' ? colour : formatColour(colour);
      const key = typeof colour === 'string' ? colour : formatColour(colour);
      const hit = memory.get(key);
      if (hit) return hit;
      const toned = formatColour(rotateColour(colour, shift));
      memory.set(key, toned);
      return toned;
    },
    /** The tone's version of a pass alpha. */
    a(alpha) {
      return clamp01(alpha * heat);
    },
  };
}

/** The neutral tone: the grade exactly as it is written, worn at full heat. */
export const NEUTRAL_TONE = makeTone();

// 1. Sunset: magenta in the sky, amber climbing out of the horizon, the water left cool so the heat reads hotter.
function sunset(ctx, w, h, tone) {
  paint(ctx, w, h, linear(ctx, 0, h * 0.1, 0, h, [
    [0, tone.c('rgba(255,96,32,0)')],
    [0.4, tone.c('rgba(255,132,44,0.32)')],
    [0.78, tone.c('rgba(255,178,72,0.56)')],
    [1, tone.c('rgba(255,216,124,0.66)')],
  ]), 'overlay', tone.a(0.95));
  paint(ctx, w, h, linear(ctx, 0, 0, 0, h * 0.62, [
    [0, tone.c('rgba(214,24,120,0.6)')],
    [0.5, tone.c('rgba(168,26,110,0.2)')],
    [1, tone.c('rgba(0,0,0,0)')],
  ]), 'soft-light', tone.a(1));
  paint(ctx, w, h, radial(ctx, w * 0.5, h * 1.02, 0, Math.max(w, h) * 0.8, [
    [0, tone.c('rgba(255,206,120,0.78)')],
    [0.4, tone.c('rgba(255,140,50,0.3)')],
    [1, tone.c('rgba(255,90,20,0)')],
  ]), 'screen', tone.a(0.85));
  paint(ctx, w, h, linear(ctx, 0, 0, 0, h, [
    [0, tone.c('rgba(38,10,48,0.4)')],
    [0.5, tone.c('rgba(0,0,0,0)')],
    [1, tone.c('rgba(70,14,26,0.22)')],
  ]), 'multiply', tone.a(1));
}

// 2. Neon: hot pink light in the highlights, electric cyan down in the shadows, and the streak of a night street's
// signs lying across the frame at the height of the lamp.
function neon(ctx, w, h, tone) {
  // The street's light, laid on the photograph first: a hot pink lamp up in the top right where the signs are, and
  // the bloom those signs smear across the frame. Lighting the plate before it is printed is what keeps the shadows
  // cyan — a pink glow added after the print would wash its red straight down into them.
  paint(ctx, w, h, radial(ctx, w * 0.74, h * 0.14, 0, Math.max(w, h) * 0.8, [
    [0, tone.c('rgba(255,64,208,0.6)')],
    [0.5, tone.c('rgba(255,40,180,0.2)')],
    [1, tone.c('rgba(255,40,180,0)')],
  ]), 'screen', tone.a(0.95));
  bloomBand(ctx, w, h, 0.62, 0.2, 0.7, 'rgba(255,110,232,0.32)', tone);

  // The print: two inks keyed to the light now in the plate — deep teal in the shadows, electric cyan through the
  // lower mids, violet where the inks cross, hot magenta up in the light. Shadows come out cyan and lit skin comes
  // out pink whatever the photograph was, which is what makes it read as neon instead of as a filter.
  inkMap(ctx, w, h, [
    [0, tone.c('#01101c')],
    [0.26, tone.c('#023a52')],
    [0.44, tone.c('#0f93c4')],
    [0.6, tone.c('#6a2ee0')],
    [0.76, tone.c('#ff2f9e')],
    [0.9, tone.c('#ff6cc4')],
    [1, tone.c('#ffc2e6')],
  ], null, 0.95);

  // The wet street: cyan multiplied into the foot of the print, so the pavement cools without the shadows lifting.
  paint(ctx, w, h, linear(ctx, 0, h * 0.52, 0, h, [
    [0, tone.c('rgba(0,130,255,0)')],
    [1, tone.c('rgba(0,150,255,0.34)')],
  ]), 'multiply', tone.a(1));
}

// 3. Dusk: deep violet and indigo, cool and moody.
function dusk(ctx, w, h, tone) {
  duotone(ctx, w, h, linear(ctx, 0, 0, 0, h, [
    [0, tone.c('#9a6bff')],
    [0.48, tone.c('#4c3cb8')],
    [1, tone.c('#141a5e')],
  ]), tone.a(0.44));
  paint(ctx, w, h, radial(ctx, w * 0.3, h * 0.02, 0, Math.max(w, h) * 0.86, [
    [0, tone.c('rgba(160,132,255,0.5)')],
    [0.5, tone.c('rgba(96,66,205,0.16)')],
    [1, tone.c('rgba(40,20,120,0)')],
  ]), 'screen', tone.a(0.85));
  paint(ctx, w, h, linear(ctx, 0, h * 0.5, 0, h, [
    [0, tone.c('rgba(0,0,0,0)')],
    [1, tone.c('rgba(88,44,190,0.28)')],
  ]), 'overlay', tone.a(0.8));
  paint(ctx, w, h, linear(ctx, 0, 0, 0, h, [
    [0, tone.c('rgba(30,20,80,0.25)')],
    [0.6, tone.c('rgba(0,0,0,0)')],
    [1, tone.c('rgba(10,10,50,0.35)')],
  ]), 'multiply', tone.a(1));
}

// 4. Gold: amber and honey, high warmth, the blacks lifted into a faded film print.
function gold(ctx, w, h, tone) {
  paint(ctx, w, h, linear(ctx, 0, 0, 0, h, [
    [0, tone.c('rgba(120,84,30,0.3)')],
    [1, tone.c('rgba(255,196,110,0.42)')],
  ]), 'screen', tone.a(0.55));
  paint(ctx, w, h, linear(ctx, 0, 0, w * 0.3, h, [
    [0, tone.c('rgba(255,214,132,0.52)')],
    [0.55, tone.c('rgba(230,158,60,0.28)')],
    [1, tone.c('rgba(160,88,20,0.4)')],
  ]), 'overlay', tone.a(0.9));
  paint(ctx, w, h, radial(ctx, w * 0.66, h * 0.24, 0, Math.max(w, h) * 0.64, [
    [0, tone.c('rgba(255,240,186,0.52)')],
    [1, tone.c('rgba(255,190,90,0)')],
  ]), 'screen', tone.a(0.65));
  paint(ctx, w, h, linear(ctx, 0, 0, 0, h, [
    [0, tone.c('rgba(90,60,20,0.22)')],
    [0.55, tone.c('rgba(0,0,0,0)')],
    [1, tone.c('rgba(120,70,10,0.26)')],
  ]), 'multiply', tone.a(1));
}

// 5. Vice: pink from the west, turquoise from the east, a hard split across the frame, and two bloom bands lying
// where the signs are.
function vice(ctx, w, h, tone) {
  duotone(ctx, w, h, linear(ctx, 0, 0, w, 0, [
    [0, tone.c('#ff2f8e')],
    [0.34, tone.c('#ff2f8e')],
    [0.48, tone.c('#c02ad8')],
    [0.62, tone.c('#00b6e6')],
    [1, tone.c('#00ecec')],
  ]), tone.a(0.64));
  paint(ctx, w, h, linear(ctx, 0, 0, w, h, [
    [0, tone.c('rgba(255,60,140,0.56)')],
    [0.46, tone.c('rgba(255,60,140,0)')],
    [1, tone.c('rgba(0,224,232,0.56)')],
  ]), 'soft-light', tone.a(0.95));
  paint(ctx, w, h, radial(ctx, w * 0.12, h * 0.12, 0, Math.max(w, h) * 0.6, [
    [0, tone.c('rgba(255,80,150,0.58)')],
    [1, tone.c('rgba(255,60,140,0)')],
  ]), 'screen', tone.a(0.7));
  paint(ctx, w, h, radial(ctx, w, h, 0, Math.max(w, h) * 0.62, [
    [0, tone.c('rgba(0,226,232,0.5)')],
    [1, tone.c('rgba(0,200,220,0)')],
  ]), 'screen', tone.a(0.65));
  // Two streaks: the pink of the west side and the turquoise of the east, each at its own height.
  bloomBand(ctx, w, h, 0.28, 0.16, 0.6, 'rgba(255,86,168,0.46)', tone);
  bloomBand(ctx, w, h, 0.74, 0.34, 0.56, 'rgba(0,224,236,0.42)', tone);
  paint(ctx, w, h, linear(ctx, 0, 0, 0, h, [
    [0, tone.c('rgba(40,4,50,0.3)')],
    [0.55, tone.c('rgba(0,0,0,0)')],
    [1, tone.c('rgba(0,40,60,0.24)')],
  ]), 'multiply', tone.a(1));
}

// 6. Noir: desaturated, cold blue, the blacks dropped out of the frame.
function noir(ctx, w, h, tone) {
  duotone(ctx, w, h, linear(ctx, 0, 0, 0, h, [
    [0, tone.c('#a8c8ec')],
    [0.55, tone.c('#5c7797')],
    [1, tone.c('#22314a')],
  ]), tone.a(0.34));
  paint(ctx, w, h, linear(ctx, 0, 0, 0, h, [
    [0, tone.c('rgba(60,96,140,0.4)')],
    [0.5, tone.c('rgba(30,52,86,0.22)')],
    [1, tone.c('rgba(10,20,40,0.5)')],
  ]), 'multiply', tone.a(1));
  paint(ctx, w, h, radial(ctx, w * 0.5, h * 0.38, 0, Math.max(w, h) * 0.6, [
    [0, tone.c('rgba(150,190,235,0.3)')],
    [1, tone.c('rgba(60,90,140,0)')],
  ]), 'screen', tone.a(0.7));
}

/**
 * The named grades. `accent`, `glow` and `palette` are what the lettering and the title band borrow, so a cover's
 * type always belongs to the grade under it. `heat` is how saturated the grade is, which is what the shot plan
 * reads when it hands the hero panel the strongest colour.
 */
export const GRADES = [
  {
    id: 'sunset',
    name: 'Sunset',
    hint: 'Magenta sky into amber heat',
    accent: '#ff8a3d',
    glow: 'rgba(255,120,40,0.60)',
    heat: 0.86,
    filter: 'saturate(1.3) contrast(1.06)',
    palette: { top: '#fff6da', mid: '#ffc247', bottom: '#ff8f1f', outline: '#2b0710' },
    apply: sunset,
  },
  {
    id: 'neon',
    name: 'Neon',
    hint: 'Cyan shadows, hot pink light',
    accent: '#ff4fd8',
    sun: '#4fe4ff',
    glow: 'rgba(255,70,210,0.62)',
    heat: 1,
    filter: 'saturate(1.56) contrast(1.14) hue-rotate(-6deg)',
    palette: { top: '#fff0fb', mid: '#ff7ac8', bottom: '#ff2f9e', outline: '#04161f' },
    apply: neon,
  },
  {
    id: 'dusk',
    name: 'Dusk',
    hint: 'Violet and indigo',
    accent: '#9b86ff',
    glow: 'rgba(120,90,255,0.55)',
    heat: 0.62,
    filter: 'saturate(1.08) contrast(1.1) brightness(0.96)',
    palette: { top: '#f2eeff', mid: '#b9a6ff', bottom: '#6b46e0', outline: '#0d0730' },
    apply: dusk,
  },
  {
    id: 'gold',
    name: 'Gold',
    hint: 'Honey light, faded blacks',
    accent: '#ffcc55',
    glow: 'rgba(255,190,70,0.55)',
    heat: 0.78,
    filter: 'sepia(0.24) saturate(1.26) contrast(1.02) brightness(1.05)',
    palette: { top: '#fffbe6', mid: '#ffd479', bottom: '#c8861a', outline: '#2a1606' },
    apply: gold,
  },
  {
    id: 'vice',
    name: 'Vice',
    hint: 'Pink and turquoise',
    accent: '#ff6fa8',
    sun: '#6ff0ff',
    glow: 'rgba(255,90,160,0.62)',
    heat: 1,
    filter: 'saturate(1.5) contrast(1.1)',
    palette: { top: '#fff4e2', mid: '#ffb1c9', bottom: '#ff4f92', outline: '#04161f' },
    apply: vice,
  },
  {
    id: 'noir',
    name: 'Noir',
    hint: 'Cold, desaturated, heavy',
    accent: '#bcd8ef',
    glow: 'rgba(150,190,225,0.45)',
    heat: 0.12,
    filter: 'saturate(0.1) contrast(1.26) brightness(1.02)',
    palette: { top: '#ffffff', mid: '#cfe0f0', bottom: '#93aec6', outline: '#04070d' },
    apply: noir,
  },
];

export const GRADE_IDS = GRADES.map((grade) => grade.id);

/** Looks a grade up by id, falling back to the first one. */
export function getGrade(id) {
  return GRADES.find((grade) => grade.id === id) ?? GRADES[0];
}

/** The grades the shot plan chooses between: the colourful ones. The desaturated grade is the editor's to apply. */
const AUTO_GRADE_IDS = ['sunset', 'vice', 'gold', 'dusk', 'neon'];

export const AUTO_GRADES = AUTO_GRADE_IDS.map((id) => getGrade(id));

/** The two cool, magenta grades a cover may be keyed in: the neon night, and the vice pink-and-turquoise split. */
const NEON_GRADE_IDS = ['neon', 'vice'];

export const NEON_GRADES = NEON_GRADE_IDS.map((id) => getGrade(id));

/**
 * The key grade for a cover. A cover is graded neon-first: the candidates are `neon` and `vice`, the two grades
 * that put cyan in the shadows and magenta in the light, and the one whose accent hue sits *furthest* from `hue` —
 * the hero photograph's own dominant hue — wins. Taking the far one is what makes the grade a transformation: a
 * warm amber photograph is carried all the way over to magenta and cyan instead of being nudged a few degrees
 * toward a grade that was already almost its own colour. The whole cover is graded in this one grade, so the
 * choice decides the colour story for every panel and for the title band.
 */
export function keyGradeForHue(hue) {
  const target = Number.isFinite(hue) ? ((hue % 360) + 360) % 360 : 28;
  let best = NEON_GRADES[0];
  let bestGap = -1;
  for (const grade of NEON_GRADES) {
    const gap = hueGap(target, hueOfColour(grade.accent));
    if (gap > bestGap) {
      best = grade;
      bestGap = gap;
    }
  }
  return best;
}

/** How far round the wheel a grade may sit from the key and still belong to the same colour story. */
const FAMILY_ARC = 45;
/** How many plates a cover is graded in. */
export const FAMILY_SIZE = 5;
/** How the family's members differ in intensity: one hot, one muted, one deep, and two in between. */
const FAMILY_HEAT = [1, 0.86, 0.94, 0.72, 1.04];
const FAMILY_DEPTH = [0.04, 0.16, 0.3, 0.1, 0.42];

/**
 * The family a cover is graded in, the key grade first. Members are the other colourful grades whose accent hue
 * already sits inside FAMILY_ARC degrees of the key's — the same colour story told in a different print — and then,
 * when that set is too small, the key grade itself moved ±12 and ±24 degrees round the wheel. No member is ever a
 * complement of the key. Each member carries its own heat and depth, so the family varies in intensity rather than
 * in hue family.
 */
export function gradeFamily(keyGrade) {
  const keyHue = hueOfColour(keyGrade.accent);
  const members = [];
  const add = (grade, shift) => {
    if (members.length >= FAMILY_SIZE) return;
    const slot = members.length;
    members.push({
      gradeIndex: Math.max(0, GRADES.findIndex((entry) => entry.id === grade.id)),
      id: grade.id,
      shift,
      heat: FAMILY_HEAT[slot],
      depth: FAMILY_DEPTH[slot],
    });
  };

  add(keyGrade, 0);

  const near = AUTO_GRADES
    .filter((grade) => grade.id !== keyGrade.id)
    .map((grade) => ({ grade, gap: hueGap(keyHue, hueOfColour(grade.accent)) }))
    .filter((entry) => entry.gap <= FAMILY_ARC)
    .sort((a, b) => a.gap - b.gap);
  for (const { grade } of near) add(grade, 0);

  for (const shift of [-12, 12, -24, 24]) add(keyGrade, shift);
  return members;
}

/** Where the light stands, in fractions of a panel. One sun for the whole cover, up and to the right. */
const SUN = { x: 0.68, y: 0.26 };

/** The corner darkening every panel ends with. Same shape everywhere, tinted with the grade's own shadow colour. */
function vignette(ctx, w, h, strength, colour) {
  const { r, g, b } = parseColour(colour);
  const tint = `${r},${g},${b}`;
  const cx = w * 0.5;
  const cy = h * 0.46;
  const inner = Math.min(w, h) * 0.3;
  const outer = Math.hypot(w, h) * 0.62;
  const gradient = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  gradient.addColorStop(0, `rgba(${tint},0)`);
  gradient.addColorStop(0.55, `rgba(${tint},${(strength * 0.18).toFixed(3)})`);
  gradient.addColorStop(0.82, `rgba(${tint},${(strength * 0.55).toFixed(3)})`);
  gradient.addColorStop(1, `rgba(${tint},${strength.toFixed(3)})`);
  paint(ctx, w, h, gradient);
}

/**
 * The light every panel shares: a glow falling from the same point in the frame (so all the prints are lit from the
 * same side), a multiply wash for the deeper tones, and the one vignette shape. The glow is the grade's own `sun`
 * when it names one — the neon grades light the frame with a cool street lamp rather than a warm one — and its
 * accent otherwise. Because the shape never varies, five panels read as one photograph rather than five grades.
 */
function sharedLight(ctx, w, h, grade, tone) {
  const accent = grade.sun ?? grade.accent;
  paint(ctx, w, h, radial(ctx, w * SUN.x, h * SUN.y, 0, Math.max(w, h) * 0.9, [
    [0, tone.c(setAlpha(accent, 0.2))],
    [0.42, tone.c(setAlpha(accent, 0.08))],
    [1, tone.c(setAlpha(accent, 0))],
  ]), 'screen', tone.a(0.9));

  if (tone.depth > 0.001) {
    paint(ctx, w, h, linear(ctx, 0, 0, 0, h, [
      [0, tone.c(setAlpha(grade.palette.outline, tone.depth * 0.24))],
      [0.55, tone.c(setAlpha(grade.palette.outline, 0))],
      [1, tone.c(setAlpha(grade.palette.outline, tone.depth * 0.36))],
    ]), 'multiply', 1);
  }

  vignette(ctx, w, h, 0.5 + tone.depth * 0.45, grade.palette.outline);
}

/**
 * Grades a panel that already holds its photograph: the grade's own passes, then the shared light. `tone` decides
 * how the grade is worn; leaving it out wears it straight.
 */
export function applyGrade(ctx, w, h, grade, tone) {
  const chosen = typeof grade === 'string' ? getGrade(grade) : (grade ?? GRADES[0]);
  const worn = tone ?? NEUTRAL_TONE;
  chosen.apply(ctx, w, h, worn);
  sharedLight(ctx, w, h, chosen, worn);
}
