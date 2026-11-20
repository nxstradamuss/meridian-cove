// Fixed scenes for screenshots: `?shot=cover` shows the cover alone, `?shot=editor` shows the whole page with the
// photos loaded. The query also carries `photos` (a comma-separated list), `photo`, `caption`, `kicker`,
// `subtitle`, `layout`, `grade`, `seed` and `size` (`size=1080x1350`). `window.__shotReady` is set only
// once the finished cover has actually been painted.

/** Parses a `WxH` size string, returning null when it is not one. */
function parseSize(value) {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** The sample photos a scene asks for: `photos=pier,boulevard` wins, then `photo=pier`, then the default. */
function parsePhotos(query) {
  const list = (query.get('photos') ?? query.get('photo') ?? 'pier')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  return list.length ? list : ['pier'];
}

/** Waits two animation frames so the canvas is composited, and for webfonts if the browser has any. */
async function nextPaint() {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch {
    // A browser without the Font Loading API has nothing to wait for.
  }
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

/**
 * Runs a screenshot scene. `api` supplies the editor's own controls: setSize, setLayout, setGrade, setCaption,
 * loadPhotos and render.
 */
export async function runShot(shot, query, api) {
  document.body.classList.add(`shot-${shot}`);
  document.body.classList.add('is-shot');

  const size = parseSize(query.get('size'));
  if (size) api.setSize(size.w, size.h);

  const layout = query.get('layout');
  if (layout) api.setLayout(layout);

  const grade = query.get('grade');
  if (grade) api.setGrade(grade);

  const seed = Number(query.get('seed'));
  if (Number.isFinite(seed) && seed > 0) api.setSeed(seed);

  api.setCaption({
    title: query.get('caption') ?? undefined,
    kicker: query.get('kicker') ?? undefined,
    subtitle: query.get('subtitle') ?? undefined,
  });

  await api.loadPhotos(parsePhotos(query));
  
  // FIX 3: Set shotName for hero cover suffix detection
  if (shot === 'cover') {
    api.setShotName('cover');
  }
  
  api.render();
  await nextPaint();
  window.__shotReady = true;
}
