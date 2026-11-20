// Wires the editor: drop photos, pick a layout, a size, a grade and a caption, drag inside a panel to reposition its
// crop, reshuffle the composition, and export the PNG. Every change paints through one requestAnimationFrame, so a
// drag or a burst of typing never queues up a render per event. A `?shot=` query turns the page into a fixed scene
// for a screenshot instead (./shots.js).

import { drawCover } from './cover.js';
import { dragFocus } from './crop.js';
import { GRADES } from './grades.js';
import { getLayout, LAYOUT_HINTS, LAYOUT_IDS, LAYOUT_NAMES } from './layouts.js';
import { findFocus } from './saliency.js';
import { addPhoto, createState, removePhoto, setGrade, setLayout, setSize, setShotName, SIZES } from './state.js';
import { planPanels, reshufflePlan, SHOT_LABELS } from './shotplan.js';
import { runShot } from './shots.js';

const canvas = document.getElementById('cover');
const overlay = document.getElementById('overlay');
const frame = document.getElementById('frame');
const statusEl = document.getElementById('status');
const hudEl = document.getElementById('hud');
const panelCountEl = document.getElementById('panel-count');
const photoCountEl = document.getElementById('photo-count');
const thumbsEl = document.getElementById('thumbs');
const dropEl = document.getElementById('drop');
const photoInput = document.getElementById('photo');
const captionInput = document.getElementById('caption');
const kickerInput = document.getElementById('kicker');
const subtitleInput = document.getElementById('subtitle');
const layoutRow = document.getElementById('layouts');
const gradeRow = document.getElementById('grades');
const sizeRow = document.getElementById('sizes');
const customW = document.getElementById('custom-w');
const customH = document.getElementById('custom-h');
const customApply = document.getElementById('custom-apply');
const reshuffleButton = document.getElementById('reshuffle');
const exportButton = document.getElementById('export');
const sampleButtons = Array.from(document.querySelectorAll('[data-sample]'));

const state = createState();
let selected = -1;
let dragging = null;
let lastRedrawMs = 0;

/** Loads an image from a URL, resolving once it can be drawn. */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}`));
    image.src = url;
  });
}

/** Says something in the status line, brightly when it is good news. */
function say(message, good = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle('is-good', good);
}

/** Repaints the cover, the selection overlay and the readouts, and times the paint. */
function render() {
  const started = performance.now();
  drawCover(canvas, state);
  lastRedrawMs = performance.now() - started;
  drawOverlay();
  updateReadout();
  markSelected();
}

// One paint per animation frame at most: typing a caption must not queue a render for every keystroke.
let framePending = false;
function scheduleRender() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    render();
  });
}

/** The frame keeps the canvas's aspect, so the cover never distorts in the stage. */
function updateFrameAspect() {
  if (!frame) return;
  frame.style.setProperty('--aspect', String(state.size.w / state.size.h));
}

/** The panel count, the photo count and the last redraw time. */
function updateReadout() {
  const panels = state.panels.length;
  if (panelCountEl) panelCountEl.textContent = `${panels} panel${panels === 1 ? '' : 's'}`;
  if (photoCountEl) photoCountEl.textContent = String(state.photos.length);
  if (hudEl) {
    hudEl.textContent = `${panels} panels · ${state.photos.length} photo${state.photos.length === 1 ? '' : 's'} · `
      + `${state.size.w} × ${state.size.h} · redraw ${lastRedrawMs.toFixed(1)} ms`;
  }
  updateFrameAspect();
}

/** Highlights the chips that match the document. */
function markSelected() {
  const mark = (row, attribute, value) => {
    if (!row) return;
    for (const chip of row.children) chip.classList.toggle('is-on', chip.dataset[attribute] === String(value));
  };
  mark(layoutRow, 'layout', state.layout);
  mark(gradeRow, 'grade', state.grade ?? 'auto');
  mark(sizeRow, 'size', `${state.size.w}x${state.size.h}`);
  for (const button of sampleButtons) {
    const name = button.dataset.sample;
    button.classList.toggle('is-on', state.photos.some((photo) => photo.name === name));
  }
}

/** The little diagram of each layout that the chips wear. */
const LAYOUT_DIAGRAM = {
  vice: [[2, 1, 1, 2], [1, 1, 1, 1], [1, 2, 1, 1], [3, 1, 1, 1], [3, 2, 1, 1]],
  duo: [[1, 1, 1, 2], [2, 1, 1, 2]],
  triptych: [[1, 1, 1, 2], [2, 1, 1, 2], [3, 1, 1, 2]],
  hero: [[1, 1, 3, 2]],
};

/** Builds the small layout diagram used inside a chip. */
function buildDiagram(id) {
  const diagram = document.createElement('span');
  diagram.className = 'mini';
  for (const [column, row, spanX, spanY] of LAYOUT_DIAGRAM[id] ?? LAYOUT_DIAGRAM.hero) {
    const cell = document.createElement('i');
    cell.style.gridArea = `${row} / ${column} / ${row + spanY} / ${column + spanX}`;
    diagram.append(cell);
  }
  return diagram;
}

/** The four layout chips, the active one lit. */
function buildLayoutChips() {
  if (!layoutRow) return;
  for (const id of LAYOUT_IDS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.layout = id;
    chip.title = LAYOUT_HINTS[id] ?? LAYOUT_NAMES[id];
    chip.append(buildDiagram(id));
    const name = document.createElement('span');
    name.textContent = LAYOUT_NAMES[id];
    chip.append(name);
    chip.addEventListener('click', () => {
      setLayout(state, id);
      selected = -1;
      render();
    });
    layoutRow.append(chip);
  }
}

/** Auto plus every named grade, each chip wearing its own accent. */
function buildGradeChips() {
  if (!gradeRow) return;
  const auto = document.createElement('button');
  auto.type = 'button';
  auto.className = 'chip chip-grade';
  auto.dataset.grade = 'auto';
  auto.title = 'Let the shot plan choose a grade per panel';
  auto.textContent = 'Auto';
  auto.addEventListener('click', () => {
    setGrade(state, null);
    render();
  });
  gradeRow.append(auto);

  for (const grade of GRADES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip chip-grade';
    chip.dataset.grade = grade.id;
    chip.style.setProperty('--accent', grade.accent);
    chip.title = grade.hint;
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    const name = document.createElement('span');
    name.textContent = grade.name;
    chip.append(swatch, name);
    chip.addEventListener('click', () => {
      setGrade(state, grade.id);
      render();
    });
    gradeRow.append(chip);
  }
}

/** The three post sizes the app exports. */
function buildSizeChips() {
  if (!sizeRow) return;
  for (const size of SIZES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip chip-size';
    chip.dataset.size = `${size.w}x${size.h}`;
    const label = document.createElement('strong');
    label.textContent = size.label;
    const hint = document.createElement('span');
    hint.textContent = size.hint;
    chip.append(label, hint);
    chip.addEventListener('click', () => {
      setSize(state, size.w, size.h);
      if (customW) customW.value = String(size.w);
      if (customH) customH.value = String(size.h);
      selected = -1;
      render();
    });
    sizeRow.append(chip);
  }
}

/** The strip of loaded photos, each with a button that takes it out of the collage. */
function renderThumbs() {
  if (!thumbsEl) return;
  thumbsEl.replaceChildren();
  state.photos.forEach((photo, index) => {
    const cell = document.createElement('div');
    cell.className = 'thumb';
    const img = document.createElement('img');
    img.src = photo.url ?? '';
    img.alt = photo.name || `photo ${index + 1}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Remove ${photo.name || 'photo'}`;
    remove.addEventListener('click', () => {
      removePhoto(state, index);
      if (photo.url && photo.url.startsWith('blob:')) URL.revokeObjectURL(photo.url);
      selected = -1;
      renderThumbs();
      render();
    });
    cell.append(img, remove);
    thumbsEl.append(cell);
  });
  if (photoCountEl) photoCountEl.textContent = String(state.photos.length);
}

/** Draws the selection outline and the shot's name over the cover. Never part of the exported PNG. */
function drawOverlay() {
  if (!overlay) return;
  const w = canvas.width;
  const h = canvas.height;
  if (overlay.width !== w) overlay.width = w;
  if (overlay.height !== h) overlay.height = h;
  const ctx = overlay.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (selected < 0 || !state.panels[selected]) return;

  const geo = getLayout(state.layout, w, h);
  const rect = geo.panels[selected];
  if (!rect) return;
  const panel = state.panels[selected];
  const accent = GRADES[(panel.gradeIndex ?? 0) % GRADES.length]?.accent ?? '#ffb03a';
  const line = Math.max(2, Math.round(Math.min(w, h) * 0.0035));

  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = line;
  ctx.strokeRect(rect.x + line, rect.y + line, rect.w - line * 2, rect.h - line * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = Math.max(1, line * 0.4);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  // A small tag naming the shot, so the panel's framing is legible while it is being moved.
  const label = `${(SHOT_LABELS[panel.shot] ?? panel.shot).toUpperCase()}${panel.flip ? ' · MIRRORED' : ''}`;
  const size = Math.max(10, Math.round(Math.min(w, h) * 0.014));
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  const width = ctx.measureText(label).width + size * 1.1;
  const tagX = rect.x + line * 2;
  const tagY = rect.y + line * 2;
  ctx.fillStyle = 'rgba(8,6,12,0.82)';
  ctx.fillRect(tagX, tagY, width, size * 1.9);
  ctx.fillStyle = accent;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, tagX + size * 0.55, tagY + size * 0.97);
  ctx.restore();
}

/** The panel under a point in canvas pixels, or -1. */
function panelAt(x, y) {
  const geo = getLayout(state.layout, canvas.width, canvas.height);
  for (let index = 0; index < geo.panels.length; index += 1) {
    const rect = geo.panels[index];
    if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) return index;
  }
  return -1;
}

/** A pointer event in canvas pixels, whatever the canvas is scaled to on screen. */
function canvasPoint(event) {
  const box = canvas.getBoundingClientRect();
  const x = ((event.clientX - box.left) / Math.max(1, box.width)) * canvas.width;
  const y = ((event.clientY - box.top) / Math.max(1, box.height)) * canvas.height;
  return { x, y };
}

canvas.addEventListener('pointerdown', (event) => {
  const point = canvasPoint(event);
  const index = panelAt(point.x, point.y);
  selected = index;
  if (index >= 0) {
    dragging = { index, x: point.x, y: point.y };
    canvas.setPointerCapture?.(event.pointerId);
    say(`${SHOT_LABELS[state.panels[index]?.shot] ?? 'Panel'} selected — drag to reposition.`);
  } else {
    dragging = null;
  }
  render();
});

canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const point = canvasPoint(event);
  const panel = state.panels[dragging.index];
  const photo = panel ? state.photos[panel.photoIndex] : null;
  if (!panel || !photo) return;
  const geo = getLayout(state.layout, canvas.width, canvas.height);
  const rect = geo.panels[dragging.index];
  if (!rect) return;
  const moved = dragFocus(photo.image, rect, panel, point.x - dragging.x, point.y - dragging.y);
  panel.focusX = moved.focusX;
  panel.focusY = moved.focusY;
  panel.manual = true;
  dragging.x = point.x;
  dragging.y = point.y;
  scheduleRender();
});

const endDrag = () => { dragging = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

/** Loads one of the bundled sample photographs and adds it to the collage. */
async function addSample(name) {
  const image = await loadImage(`samples/${name}.jpg`);
  const index = addPhoto(state, image, name, findFocus(image));
  state.photos[index].url = `samples/${name}.jpg`;
  return image;
}

/** Replaces the collage's photos with the named samples, in order. */
async function loadPhotos(names) {
  state.photos.length = 0;
  for (const name of names) await addSample(name);
  selected = -1;
  renderThumbs();
  render();
}

/** Adds files the user dropped or chose, one at a time, and paints once they are all in. */
async function addFiles(fileList) {
  const files = Array.from(fileList ?? []).filter((file) => !file.type || file.type.startsWith('image/'));
  if (!files.length) return;
  let added = 0;
  for (const file of files) {
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      const index = addPhoto(state, image, file.name.replace(/\.[^.]+$/, ''), findFocus(image));
      state.photos[index].url = url;
      added += 1;
    } catch {
      URL.revokeObjectURL(url);
      say(`“${file.name}” is not an image this browser can read.`);
    }
  }
  if (added) {
    selected = -1;
    renderThumbs();
    render();
    say(`${added} photo${added === 1 ? '' : 's'} added.`, true);
  }
}

/** Sets one or more caption fields from a shot query; undefined leaves a field alone. */
function setCaption(fields = {}) {
  if (typeof fields === 'string') fields = { title: fields };
  const set = (input, value) => {
    if (value !== undefined && input) input.value = value;
  };
  if (fields.title !== undefined) state.caption.title = fields.title;
  if (fields.kicker !== undefined) state.caption.kicker = fields.kicker;
  if (fields.subtitle !== undefined) state.caption.subtitle = fields.subtitle;
  set(captionInput, fields.title);
  set(kickerInput, fields.kicker);
  set(subtitleInput, fields.subtitle);
}

/** A filename-safe version of the title. */
function slug(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Writes the cover to a PNG named for its title, layout and size. */
function exportPng() {
  drawCover(canvas, state);
  const name = `${slug(state.caption.title) || 'cover'}-${state.layout}-${state.size.w}x${state.size.h}.png`;
  canvas.toBlob((blob) => {
    if (!blob) {
      say('The browser could not encode the PNG.');
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    say(`Saved ${name}`, true);
  }, 'image/png');
}

// ---- build the controls ----------------------------------------------------

buildLayoutChips();
buildGradeChips();
buildSizeChips();

for (const button of sampleButtons) {
  button.addEventListener('click', () => {
    const name = button.dataset.sample;
    const existing = state.photos.findIndex((photo) => photo.name === name);
    if (existing >= 0) {
      removePhoto(state, existing);
      renderThumbs();
      render();
      return;
    }
    addSample(name)
      .then(() => {
        renderThumbs();
        render();
      })
      .catch(() => say('That sample could not be loaded.'));
  });
}

if (photoInput) {
  photoInput.addEventListener('change', (event) => {
    addFiles(event.target.files).finally(() => { photoInput.value = ''; });
  });
}

if (dropEl) {
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  for (const type of ['dragenter', 'dragover']) {
    dropEl.addEventListener(type, (event) => {
      stop(event);
      dropEl.classList.add('is-over');
    });
  }
  for (const type of ['dragleave', 'dragend']) {
    dropEl.addEventListener(type, () => dropEl.classList.remove('is-over'));
  }
  dropEl.addEventListener('drop', (event) => {
    stop(event);
    dropEl.classList.remove('is-over');
    addFiles(event.dataTransfer?.files);
  });
  // The whole page accepts a drop, so a photo dropped anywhere lands in the collage.
  window.addEventListener('dragover', stop);
  window.addEventListener('drop', (event) => {
    stop(event);
    addFiles(event.dataTransfer?.files);
  });
}

const bindText = (input, key) => {
  if (!input) return;
  input.addEventListener('input', () => {
    state.caption[key] = input.value;
    scheduleRender();
  });
};
bindText(captionInput, 'title');
bindText(kickerInput, 'kicker');
bindText(subtitleInput, 'subtitle');

/** Reads the custom size fields and applies them if they are sane. */
function applyCustomSize() {
  const w = Math.round(Number(customW?.value));
  const h = Math.round(Number(customH?.value));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 320 || h < 320 || w > 4096 || h > 4096) {
    say('A custom size needs a width and height between 320 and 4096.');
    return;
  }
  setSize(state, w, h);
  selected = -1;
  render();
}

if (customApply) customApply.addEventListener('click', applyCustomSize);
for (const input of [customW, customH]) {
  if (input) input.addEventListener('keydown', (event) => { if (event.key === 'Enter') applyCustomSize(); });
}

if (reshuffleButton) {
  reshuffleButton.addEventListener('click', () => {
    reshufflePlan(state);
    selected = -1;
    render();
    say('New composition — every panel re-framed.', true);
  });
}

if (exportButton) exportButton.addEventListener('click', exportPng);

// ---- start -----------------------------------------------------------------

// A small hook so a screenshot harness or a probe can read the document and time a repaint without touching the UI.
window.__coverDebug = { state, drawCover, canvas };

const query = new URLSearchParams(location.search);
const shot = query.get('shot');

if (shot) {
  runShot(shot, query, {
    loadPhotos,
    setCaption,
    setLayout: (id) => setLayout(state, id),
    setSize: (w, h) => setSize(state, w, h),
    setGrade: (id) => setGrade(state, id),
    setSeed: (value) => { state.seed = value; },
    render,
  }).catch((error) => {
    say(`Scene failed: ${error.message}`);
    window.__shotReady = true;
  });
} else {
  // The landing state is the ensemble, not one snapshot: four different people across the five panels.
  loadPhotos(['boulevard', 'braids', 'crown', 'smoke']).catch(() => say('Could not load the sample photos.'));
}
