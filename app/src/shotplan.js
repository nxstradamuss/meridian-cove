// The shot plan: which photograph fills each panel, from where in that photograph it is cut, how far in it is
// magnified, whether it is mirrored, and which colour grade it wears.
//
// The photographs are dealt so that every supplied photo appears once before any of them comes round again, and
// the hero panel (the biggest, and in `vice` the tallest) takes the first photo, which the caller supplies as the
// strongest one. Once the whole list has been used the deal starts again from the first photo, so the extra
// panels come back to the hero photograph before they reach for anyone else and the cast stays tight — the
// strongest photo carries the most panels. One photo must never simply repeat across the panels: when a
// photograph does come round a second time it is given a different shot — a wide of the whole scene, a hero of
// the face with headroom, a close crop at the brow, a detail low on the body, a low angle with air beneath the
// subject — at a clearly different magnification, centred on a different part of the frame, and mirrored, so two
// panels of the same person never read as the same crop twice.
//
// Colour is planned as one story, not five, and that story is neon: of the two cool grades — `neon` and `vice` —
// the one whose accent hue sits furthest from the hero photograph's own dominant hue becomes the key, so the grade
// transforms the photograph instead of blending into it. Each panel is then dealt a member of that grade's narrow
// family — grades inside 45 degrees of the key's accent, or the key grade itself moved ±12 and ±24 degrees, with
// heat and depth varying. Two touching panels never wear the same member. Everything is derived from the state's
// seeded generator, so a document always plans the same way.

import { gradeFamily, keyGradeForHue } from './grades.js';
import { getLayout } from './layouts.js';
import { dominantHue, NEUTRAL_HUE } from './photoHue.js';
import { makeRandom } from './state.js';

/** The five framings a panel can take. A sixth variant is any of these drawn mirrored (`flip`). */
export const SHOT_TYPES = ['wide', 'hero', 'close', 'detail', 'low'];

/** A short name for the editor's panel readout. */
export const SHOT_LABELS = {
  wide: 'Wide',
  hero: 'Hero',
  close: 'Close',
  detail: 'Detail',
  low: 'Low angle',
};

/**
 * How each shot is framed. `zoom` multiplies the cover fit, `dx` / `dy` nudge the crop off the subject (in photo
 * coordinates), `anchor` is where the crop's centre lands inside the panel. The five magnifications are all at
 * least ZOOM_APART from one another, so even a photograph used in every panel never repeats a crop.
 */
const SHOT_SPECS = {
  wide: { zoom: 1, dx: 0, dy: 0, anchorX: 0.5, anchorY: 0.5 },
  hero: { zoom: 1.35, dx: 0, dy: -0.05, anchorX: 0.5, anchorY: 0.56 },
  close: { zoom: 2.2, dx: 0, dy: -0.02, anchorX: 0.5, anchorY: 0.5 },
  detail: { zoom: 2.6, dx: 0.07, dy: 0.13, anchorX: 0.52, anchorY: 0.58 },
  low: { zoom: 1.75, dx: 0, dy: 0, anchorX: 0.5, anchorY: 0.36 },
};

/** How far apart two uses of one photo must be magnified before they stop reading as the same crop. */
const ZOOM_APART = 0.35;
/** How far a second use of a photo is stepped across the frame from the first, in photo coordinates. */
const REPEAT_SHIFT_X = 0.16;
const REPEAT_SHIFT_Y = 0.1;

/** Where the subject sits in a photo: the saliency pass's answer, or the upper-middle of the frame. */
function subjectOf(state, photoIndex) {
  const photo = state.photos[photoIndex];
  const focus = photo && photo.focus;
  if (focus && Number.isFinite(focus.x) && Number.isFinite(focus.y)) return focus;
  return { x: 0.5, y: 0.42 };
}

/**
 * How much of the photograph a panel actually shows, as a fraction of its width and height, for a given zoom. A
 * tall panel showing a narrow slice cannot be stepped as far as a wide one before the subject ends up jammed
 * against a panel edge.
 */
function visibleFraction(rect, photo, zoom) {
  const image = photo?.image;
  const iw = image?.naturalWidth || image?.width || 0;
  const ih = image?.naturalHeight || image?.height || 0;
  if (!rect || !iw || !ih) return null;
  const scale = Math.max(rect.w / iw, rect.h / ih) * Math.max(1, zoom);
  return { w: rect.w / (iw * scale), h: rect.h / (ih * scale) };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/** Keeps a value inside a range. */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/** Two rectangles are neighbours when they share an edge across the gutter. */
function touching(a, b) {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
  const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
  return (gapX <= 18 && overlapY > 0) || (gapY <= 18 && overlapX > 0);
}

/**
 * The photograph a slot shows. The deal walks the panel order — the hero first, then the rest in reading order —
 * and hands out the supplied photographs in the order they were supplied, starting over at the first one when the
 * list runs out. Every photo therefore appears once before any of them is reused, and the extras come back to the
 * strongest photo (the one supplied first) before they reach for the second, so the cast stays tight rather than
 * growing one more stranger per panel. A reuse is re-framed and mirrored further down, never repeated as a crop.
 *
 * FIX 1: Hero panel (slot 0) ALWAYS uses photo 0 (the first/strongest photo).
 * Other panels get the remaining photos in order, never the hero photo again.
 */
function photoForSlot(slot, photoCount) {
  if (!photoCount) return -1;
  if (slot === 0) return 0; // Hero panel always gets photo 0
  // Other panels: photos 1, 2, 3... (wrapping if needed, but never photo 0 again)
  return ((slot - 1) % Math.max(1, photoCount - 1)) + 1;
}

/** For every panel, the indices of the panels it touches. */
export function panelNeighbours(rects) {
  return rects.map((rect, index) => rects
    .map((other, otherIndex) => (otherIndex === index ? -1 : otherIndex))
    .filter((otherIndex) => otherIndex >= 0 && touching(rect, rects[otherIndex])));
}

/**
 * Deals the framing for one use of a photograph. `worn` holds the framings this photograph already wears in the
 * plan: the five framings are used before any of them repeats, and a second use is given a magnification clearly
 * away from every earlier one, so two panels showing the same photo never read as the same crop twice.
 */
function dealShot(worn, photoIndex, preferred) {
  const used = new Set(worn.map((entry) => entry.type));
  const choose = (type) => {
    worn.push({ type, zoom: SHOT_SPECS[type].zoom });
    return type;
  };
  if (preferred && !used.has(preferred)) return choose(preferred);

  // The rotation starts at a different framing per photo, so two people in the same collage are not framed alike.
  const offset = (photoIndex * 2) % SHOT_TYPES.length;
  const rotation = SHOT_TYPES.map((_, step) => SHOT_TYPES[(offset + step) % SHOT_TYPES.length]);
  const fresh = rotation.filter((type) => !used.has(type));
  const apart = fresh.find((type) => worn.every((entry) => Math.abs(SHOT_SPECS[type].zoom - entry.zoom) >= ZOOM_APART));
  if (apart) return choose(apart);
  if (fresh.length) return choose(fresh[0]);

  // Every framing has been worn: take the one whose magnification is furthest from the last use.
  const last = worn[worn.length - 1].zoom;
  const furthest = rotation.reduce((best, type) => (
    Math.abs(SHOT_SPECS[type].zoom - last) > Math.abs(SHOT_SPECS[best].zoom - last) ? type : best
  ), rotation[0]);
  return choose(furthest);
}

/**
 * Paints the plan into `state.panels` and returns it. The plan is a pure function of the state: the same document
 * plans the same shots every time. A panel the user has dragged keeps the focus they gave it.
 */
export function planPanels(state) {
  const width = Math.max(1, Math.round(state.size?.w ?? 1080));
  const height = Math.max(1, Math.round(state.size?.h ?? 1080));
  const geo = getLayout(state.layout, width, height);
  const rects = geo.panels;
  const count = rects.length;
  const photoCount = state.photos.length;
  const previous = Array.isArray(state.panels) ? state.panels : [];
  const random = makeRandom((Number(state.seed) || 1) + count * 977 + photoCount * 131);
  const neighbours = panelNeighbours(rects);

  // The biggest panel is the hero: in `vice` that is the centre column, which is also the tallest frame on the
  // poster. It gets the first photograph supplied, the strongest framing and the most saturated grade.
  const byArea = rects
    .map((rect, index) => ({ index, area: rect.w * rect.h, height: rect.h }))
    .sort((a, b) => (b.area - a.area) || (b.height - a.height) || (a.index - b.index));
  const heroIndex = byArea[0].index;

  // The deal order: the hero panel first, so the caller's strongest photograph lands in the biggest frame, then
  // every other panel in reading order. Photographs are dealt so hero always gets photo 0, others get 1,2,3...
  const order = [heroIndex];
  for (let index = 0; index < count; index += 1) {
    if (index !== heroIndex) order.push(index);
  }

  const panels = new Array(count);
  const worn = new Map(); // photo index -> the framings this plan has already given it
  const focusHistory = new Map(); // photo index -> where each earlier use is centred

  for (let slot = 0; slot < count; slot += 1) {
    const index = order[slot];
    const isHero = index === heroIndex;
    const photoIndex = photoForSlot(slot, photoCount);
    const subject = photoCount ? subjectOf(state, photoIndex) : { x: 0.5, y: 0.42 };

    let history = null;
    if (photoCount) {
      if (!worn.has(photoIndex)) worn.set(photoIndex, []);
      history = worn.get(photoIndex);
    }
    const repeat = Boolean(history && history.length);
    
    // FIX 1: Hero panel gets 'hero' shot type (1.15x scale via zoom in cover.js)
    // Other panels get close, detail, low, flipped so they read as supporting cast
    let type;
    if (isHero) {
      type = 'hero';
      // Mark hero panel for special treatment in cover.js
    } else {
      type = history ? dealShot(history, photoIndex, null) : 'wide';
    }
    const spec = SHOT_SPECS[type] ?? SHOT_SPECS.wide;

    // A mirror on some supporting panels; the hero is never mirrored, so the poster keeps one anchor. A second
    // use of a photograph is always mirrored, so the same person never faces the same way twice.
    const flip = !isHero && (repeat || random() < 0.45);

    // A hair of seeded jitter keeps two collages from looking machine-stamped, without moving the shot's identity.
    const jitterX = (random() - 0.5) * 0.05;
    const jitterY = (random() - 0.5) * 0.04;

    let focusX;
    let focusY;
    if (type === 'wide') {
      focusX = 0.5 + jitterX * 0.2;
      focusY = 0.5;
    } else if (type === 'low') {
      focusX = clamp01(subject.x + jitterX * 0.5);
      focusY = 0.62;
    } else {
      focusX = clamp01(subject.x + spec.dx + jitterX);
      focusY = clamp01(subject.y + spec.dy + jitterY);
    }

    // A second use is stepped across the frame from the first, so the two panels show different parts of the
    // scene rather than the same crop twice. The step is limited to what the crop can give — the subject stays a
    // quarter of the way clear of the panel edge — and the side that ends up furthest from every earlier use
    // wins, so a photograph used three times never lands twice on the same framing.
    const earlier = photoCount ? (focusHistory.get(photoIndex) ?? []) : [];
    if (earlier.length) {
      const shown = visibleFraction(rects[index], state.photos[photoIndex], spec.zoom);
      const roomX = shown ? shown.w * 0.25 : REPEAT_SHIFT_X;
      const roomY = shown ? shown.h * 0.22 : REPEAT_SHIFT_Y;
      const stepX = Math.min(REPEAT_SHIFT_X, roomX);
      const stepY = Math.min(REPEAT_SHIFT_Y, roomY);
      const options = [1, -1].map((direction) => {
        const x = clamp(focusX + direction * stepX, subject.x - roomX, subject.x + roomX);
        const y = clamp(focusY + direction * stepY, subject.y - roomY, subject.y + roomY);
        const distance = Math.min(...earlier.map((point) => Math.hypot(point.x - x, point.y - y)));
        return { x: clamp01(x), y: clamp01(y), distance };
      });
      const best = options[1].distance > options[0].distance ? options[1] : options[0];
      focusX = best.x;
      focusY = best.y;
    }
    if (photoCount) {
      if (!focusHistory.has(photoIndex)) focusHistory.set(photoIndex, []);
      focusHistory.get(photoIndex).push({ x: focusX, y: focusY });
    }

    panels[index] = {
      photoIndex,
      shot: type,
      zoom: spec.zoom,
      focusX,
      focusY,
      faceX: subject.x,
      faceY: subject.y,
      anchorX: spec.anchorX,
      anchorY: spec.anchorY,
      flip,
      gradeIndex: 0,
      gradeShift: 0,
      gradeHeat: 1,
      gradeDepth: 0,
      hero: isHero,
      manual: false,
    };
  }

  // Colour: one grade for the whole cover, and it is always one of the two neon grades. The one whose accent hue
  // sits furthest from the hue the hero photograph already has wins, so the grading carries the picture over to
  // cyan and magenta rather than agreeing with it. Every panel is then dealt a member of that grade's family — the
  // same colour story a few degrees cooler or warmer, hotter or deeper — so the collage varies in intensity and
  // never in hue family. A member is only ever repeated where two panels do not touch.
  const heroPhoto = photoCount ? state.photos[0] : null;
  const keyGrade = keyGradeForHue(heroPhoto ? dominantHue(heroPhoto.image) : NEUTRAL_HUE);
  const family = gradeFamily(keyGrade);

  const memberOf = new Array(count).fill(-1);
  const memberUse = new Array(family.length).fill(0);
  if (count) {
    memberOf[heroIndex] = 0;
    memberUse[0] += 1;
  }

  for (const { index } of byArea) {
    if (memberOf[index] >= 0) continue;
    const taken = new Set(neighbours[index].map((other) => memberOf[other]).filter((value) => value >= 0));
    // The key's own member belongs to the hero, so the other panels draw from the neighbours of the key only.
    let pool = [];
    for (let slot = 1; slot < family.length; slot += 1) if (!taken.has(slot)) pool.push(slot);
    if (!pool.length) pool = [1 + (index % Math.max(1, family.length - 1))];
    // The least-worn members still free: that keeps one plate hot, one muted and one deep across the collage.
    const fewest = Math.min(...pool.map((slot) => memberUse[slot]));
    const spread = pool.filter((slot) => memberUse[slot] === fewest);
    const pick = spread[Math.floor(random() * spread.length) % spread.length];
    memberOf[index] = pick;
    memberUse[pick] += 1;
  }

  for (let index = 0; index < count; index += 1) {
    const member = family[Math.max(0, memberOf[index])] ?? family[0];
    panels[index].gradeIndex = member.gradeIndex;
    panels[index].gradeShift = member.shift;
    panels[index].gradeHeat = member.heat;
    panels[index].gradeDepth = member.depth;
  }

  // Keep a focus the user dragged onto a panel that still shows the same photo.
  for (let index = 0; index < count; index += 1) {
    const before = previous[index];
    if (before && before.manual && before.photoIndex === panels[index].photoIndex) {
      panels[index].focusX = before.focusX;
      panels[index].focusY = before.focusY;
      panels[index].manual = true;
    }
  }

  state.panels = panels;
  return panels;
}

/** A fresh seed, so the editor's reshuffle walks through different compositions of the same document. */
export function nextSeed(seed) {
  const value = (Number(seed) || 1) >>> 0;
  return ((value * 1664525) + 1013904223) >>> 0;
}

/** Re-plans the cover with a new seed and drops any hand-placed focus, so the reshuffle is a real reshuffle. */
export function reshufflePlan(state) {
  state.seed = nextSeed(state.seed);
  for (const panel of state.panels ?? []) panel.manual = false;
  return planPanels(state);
}

/** Drops hand-placed focus so a layout or size change re-frames every panel from scratch. */
export function resetFocus(state) {
  for (const panel of state.panels ?? []) panel.manual = false;
  return state;
}