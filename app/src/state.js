// The cover document. Everything the drawing needs lives here: the loaded photos, the panels that show them, the
// caption, the layout, the optional global grade and the export size. All variety comes from a seeded generator, so
// the same document always paints the same pixels. The panels' shots are not decided here — shotplan.js owns that —
// this module only keeps the document and the lists the editor builds its controls from.

import { getGrade, GRADES, makeTone } from './grades.js';
import { getLayout, LAYOUT_IDS } from './layouts.js';

export const DEFAULT_CAPTION = {
  title: 'Sunset Heist',
  subtitle: 'Coming Soon',
  kicker: 'A Neon Crime Saga',
};

export const DEFAULT_SIZE = { w: 1080, h: 1080 };

/** The three post sizes the app exports, plus the label each one wears in the editor. */
export const SIZES = [
  { id: 'square', w: 1080, h: 1080, label: '1:1', hint: '1080 x 1080' },
  { id: 'portrait', w: 1080, h: 1350, label: '4:5', hint: '1080 x 1350' },
  { id: 'landscape', w: 1920, h: 1080, label: '16:9', hint: '1920 x 1080' },
];

/** A small deterministic generator (mulberry32). Same seed, same numbers, every run and every machine. */
export function makeRandom(seed = 1) {
  let state = (Number(seed) || 1) >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many panels a layout asks for at a given size. */
export function panelCount(layout, size) {
  return getLayout(layout, size.w, size.h).panels.length;
}

/** A panel with no shot decided yet; shotplan.js fills in the photograph, the framing and the grade. */
function blankPanel() {
  return {
    photoIndex: -1,
    shot: 'wide',
    zoom: 1,
    focusX: 0.5,
    focusY: 0.42,
    faceX: 0.5,
    faceY: 0.42,
    anchorX: 0.5,
    anchorY: 0.5,
    flip: false,
    gradeIndex: 0,
    gradeShift: 0,
    gradeHeat: 1,
    gradeDepth: 0,
    hero: false,
    manual: false,
  };
}

/** Grows or trims the panel list to match the layout. The shots themselves are the plan's job. */
export function syncPanels(state) {
  const wanted = panelCount(state.layout, state.size);
  while (state.panels.length < wanted) state.panels.push(blankPanel());
  if (state.panels.length > wanted) state.panels.length = wanted;
  return state;
}

/** A fresh cover document. */
export function createState(overrides = {}) {
  const layout = LAYOUT_IDS.includes(overrides.layout) ? overrides.layout : 'vice';
  const state = {
    photos: [],
    panels: [],
    caption: { ...DEFAULT_CAPTION, ...(overrides.caption || {}) },
    layout,
    grade: overrides.grade ?? null,
    size: { ...DEFAULT_SIZE, ...(overrides.size || {}) },
    seed: overrides.seed ?? 20261119,
    shotName: overrides.shotName ?? null, // FIX 3: track which shot for hero cover suffix
  };
  syncPanels(state);
  return state;
}

/** A copy safe to hand to a renderer or an undo stack; the photo images are shared, not copied. */
export function cloneState(state) {
  return {
    photos: state.photos.slice(),
    panels: state.panels.map((panel) => ({ ...panel })),
    caption: { ...state.caption },
    layout: state.layout,
    grade: state.grade,
    size: { ...state.size },
    seed: state.seed,
  };
}

// Every photo gets an id of its own, so a panel bitmap can be cached against the exact photo it was cut from.
let photoSerial = 0;

/** Adds a loaded photo and returns its index. The plan spreads it across the panels on the next draw. */
export function addPhoto(state, image, name = 'photo', focus = null) {
  photoSerial += 1;
  state.photos.push({ id: `p${photoSerial}`, image, name, focus, url: '' });
  return state.photos.length - 1;
}

/** Removes a photo; the plan re-spreads the rest across the panels on the next draw. */
export function removePhoto(state, index) {
  if (index < 0 || index >= state.photos.length) return state;
  state.photos.splice(index, 1);
  for (const panel of state.panels) panel.manual = false;
  return state;
}

/** Switches layout, keeping as many photos and grades as the new panel count allows. */
export function setLayout(state, layout) {
  if (!LAYOUT_IDS.includes(layout)) return state;
  state.layout = layout;
  syncPanels(state);
  for (const panel of state.panels) panel.manual = false;
  return state;
}

/** Switches export size, re-measuring the panels for the new aspect. */
export function setSize(state, w, h) {
  state.size = { w: Math.round(w), h: Math.round(h) };
  syncPanels(state);
  for (const panel of state.panels) panel.manual = false;
  return state;
}

/** Sets the shot name for hero cover suffix detection. */
export function setShotName(state, name) {
  state.shotName = name;
  return state;
}

/** A global grade override, or null to let each panel wear its own. */
export function setGrade(state, grade) {
  state.grade = grade && getGrade(grade) ? grade : null;
  return state;
}

/** The grade the type and the frame borrow their colour from: the override, else the hero panel's. */
export function primaryGrade(state) {
  if (state.grade) return getGrade(state.grade);
  const hero = state.panels.find((panel) => panel.hero) ?? state.panels[0];
  return getGrade(GRADES[(hero?.gradeIndex ?? 0) % GRADES.length]?.id ?? 'sunset');
}

/** The grade a panel wears, honouring the global override. */
export function panelGrade(state, panel) {
  if (state.grade) return getGrade(state.grade);
  return getGrade(GRADES[(panel?.gradeIndex ?? 0) % GRADES.length]?.id ?? 'sunset');
}

/**
 * The tone a panel wears. The plan deals each panel a member of the key grade's family, so the panels differ in hue
 * by no more than a few degrees and in heat and depth by a good deal. A grade the user has fixed by hand is worn
 * straight, with no family variation at all.
 */
export function panelTone(state, panel) {
  if (state.grade) return makeTone();
  return makeTone({
    shift: panel?.gradeShift ?? 0,
    heat: panel?.gradeHeat ?? 1,
    depth: panel?.gradeDepth ?? 0,
  });
}
