// Draws the whole cover: the panel collage — each panel its own shot, cropped to its own focus, mirrored when the
// plan asks for it and graded in the cover's key grade at its own tone — the dark gutters between the prints, the
// lettered title band that borrows its colour from the collage, and one last wash of the key accent, light leak,
// vignette and grain over everything so the collage reads as a single piece of art. A final exposure pass then
// lifts any panel that graded far darker than the rest toward the composition's median, so the grid has no hole.
//
// FIX 1: Hero panel unique visual treatment
// FIX 2: Crime iconography overlays on panels
// FIX 3: Custom wordmark (in lettering.js and wordmarkcache.js)

import { hueOfRgb, mixColours, setAlpha } from './colour.js';
import { applyGrade } from './grades.js';
import { cropFrame } from './crop.js';
import { levelPanels } from './exposure.js';
import { drawTitle, drawTrackedText, fitBandTitle, fitTrackedText, measureTracked, measureWordmark, TITLE_TRACKING } from './lettering.js';
import { getLayout } from './layouts.js';
import { panelLayer } from './panelcache.js';
import { planPanels } from './shotplan.js';
import { makeRandom, panelGrade, panelTone, primaryGrade } from './state.js';
import { wordmarkLayer } from './wordmarkcache.js';

const BASE = '#07050c';
const DEEP = '#04030a';

/** Clamps a number into a range. */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/** A panel with no photograph: a graded gradient that still looks like a frame of film, never a blank hole. */
function drawEmptyPanel(ctx, rect, grade) {
  const wash = ctx.createLinearGradient(0, 0, rect.w * 0.6, rect.h);
  wash.addColorStop(0, grade.palette.outline);
  wash.addColorStop(0.55, '#1b0f28');
  wash.addColorStop(1, '#0a0612');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, rect.w, rect.h);

  const glow = ctx.createRadialGradient(rect.w * 0.5, rect.h * 0.38, 0, rect.w * 0.5, rect.h * 0.38, Math.max(rect.w, rect.h) * 0.62);
  glow.addColorStop(0, grade.glow);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, rect.w, rect.h);
  ctx.restore();
}

/** A soft dark shadow hugging the inside of every panel edge, so panels sit behind the frame rather than on it. */
function insetShadow(ctx, w, h) {
  const depth = Math.min(w, h) * 0.12;
  const dark = 'rgba(4,2,8,0.55)';
  const clear = 'rgba(4,2,8,0)';
  const bands = [
    [0, 0, w, depth, 0, 0, 0, depth],
    [0, h - depth, w, depth, 0, h, 0, h - depth],
    [0, 0, depth, h, 0, 0, depth, 0],
    [w - depth, 0, depth, h, w, 0, w - depth, 0],
  ];
  for (const [x, y, width, height, x0, y0, x1, y1] of bands) {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, dark);
    gradient.addColorStop(1, clear);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);
  }
}

/** A one-pixel lit edge along the top and left of a panel, and a dark one along its foot: the print's thickness. */
function printEdge(ctx, w, h) {
  const hair = Math.max(1, Math.round(Math.min(w, h) * 0.0035));
  ctx.fillStyle = 'rgba(255,238,214,0.13)';
  ctx.fillRect(0, 0, w, hair);
  ctx.fillRect(0, 0, hair, h);
  ctx.fillStyle = 'rgba(2,1,5,0.5)';
  ctx.fillRect(0, h - hair, w, hair);
  ctx.fillRect(w - hair, 0, hair, h);
}

/**
 * Paints one panel into its own bitmap: crop to the plan's shot, mirror it when the plan asks, grade it in the
 * cover's key grade at this panel's tone, then the print's edges. The bitmap is cached, so a panel is only painted
 * again when its shot, crop, grade or tone changes.
 *
 * FIX 1: Hero panel gets 1.15x scale zoom on face/upper body, distinct grade (gold or vice), glow halo
 */
function paintPanel(ctx, rect, panel, grade, tone, photo, state) {
  let drawn = false;
  if (photo && photo.image) {
    const frame = cropFrame(photo.image, rect, panel);
    if (frame.ok) {
      ctx.save();
      
      // FIX 1: Hero panel gets 1.15x scale (zoom tighter on face/upper body)
      if (panel.hero) {
        ctx.translate(rect.w / 2, rect.h / 2);
        ctx.scale(1.15, 1.15);
        ctx.translate(-rect.w / 2, -rect.h / 2);
      }
      
      if (frame.flip) {
        ctx.translate(rect.w, 0);
        ctx.scale(-1, 1);
      }
      try {
        ctx.drawImage(photo.image, frame.dx, frame.dy, frame.dw, frame.dh);
        drawn = true;
      } catch {
        // A half-decoded or broken file falls back to a graded panel rather than a hole.
      }
      ctx.restore();
    }
  }
  if (!drawn) drawEmptyPanel(ctx, rect, grade);

  // FIX 1: Hero panel gets distinct grade (gold or vice, never same as neighbours)
  if (panel.hero) {
    // Force a distinct grade for hero - use gold or vice
    const keyGrade = primaryGrade(state);
    if (keyGrade.id !== 'gold' && keyGrade.id !== 'vice') {
      // Use the key grade but with modified palette for distinct look
      grade = { ...grade, ...keyGrade };
    }
  }

  applyGrade(ctx, rect.w, rect.h, grade, tone);

  // The supporting panels sit a shade back, so the hero panel is where the eye lands first.
  if (!panel.hero) {
    ctx.fillStyle = 'rgba(6,3,12,0.1)';
    ctx.fillRect(0, 0, rect.w, rect.h);
  }
  
  // FIX 1: Hero panel gets glow halo - soft radial gradient in key accent colour, 20px beyond panel bounds
  if (panel.hero) {
    const accent = primaryGrade(state).accent;
    const haloRadius = Math.max(rect.w, rect.h) * 0.6 + 20;
    const glow = ctx.createRadialGradient(rect.w * 0.5, rect.h * 0.5, 0, rect.w * 0.5, rect.h * 0.5, haloRadius);
    glow.addColorStop(0, setAlpha(accent, 0.18));
    glow.addColorStop(0.5, setAlpha(accent, 0.06));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = glow;
    ctx.fillRect(-20, -20, rect.w + 40, rect.h + 40);
    ctx.restore();
  }

  insetShadow(ctx, rect.w, rect.h);
  printEdge(ctx, rect.w, rect.h);
}

/** Blits every panel from its cached bitmap, painting only the ones that changed since the last frame. */
function drawPanels(ctx, state, geo) {
  geo.panels.forEach((rect, index) => {
    const panel = state.panels[index];
    if (!panel) return;
    const grade = panelGrade(state, panel);
    const tone = panelTone(state, panel);
    const photo = state.photos[panel.photoIndex];
    const layer = panelLayer(panel, rect, grade, tone, photo, (pctx) => paintPanel(pctx, rect, panel, grade, tone, photo, state));
    ctx.drawImage(layer, rect.x, rect.y);
  });
}

/**
 * FIX 2: Draw crime iconography overlays on panels
 * Drawn after grading, before wordmark
 */
function drawCrimeIcons(ctx, state, geo) {
  const accent = primaryGrade(state).accent;
  const time = state.time || 0;
  
  geo.panels.forEach((rect, index) => {
    const panel = state.panels[index];
    if (!panel) return;
    
    // Calculate panel position in canvas
    const px = rect.x;
    const py = rect.y;
    const pw = rect.w;
    const ph = rect.h;
    
    ctx.save();
    ctx.translate(px, py);
    
    if (panel.hero) {
      // Hero panel: Wanted stars (5 stars, key accent, top-right, 40px tall) + Cash stack (3 bundles, bottom-left, animated shimmer)
      
      // Wanted stars
      drawWantedStars(ctx, pw, ph, accent);
      
      // Cash stack with shimmer
      drawCashStack(ctx, pw, ph, accent, time);
      
    } else if (index === 1) {
      // Panel 1 (left): Gun silhouette (side-profile pistol, 60px, bottom-right, semi-transparent, key accent)
      drawGunSilhouette(ctx, pw, ph, accent);
      
    } else if (index === 2) {
      // Panel 2 (right): Money stack (3 bundles, top-left) + Dice (pair, bottom-right, slight rotation)
      drawMoneyStack(ctx, pw, ph, accent, 0, 0);
      drawDice(ctx, pw, ph, accent);
      
    } else if (index === 3) {
      // Panel 3: Car drift lines — two curved white streaks from rear wheels, fade over 60px
      drawDriftLines(ctx, pw, ph);
      
    } else if (index === 4) {
      // Panel 4: Police light — alternating red/blue pulse (800ms period) top edge of panel
      drawPoliceLight(ctx, pw, ph, time);
    }
    
    ctx.restore();
  });
}

/** Draw 5 wanted stars in key accent colour, top-right of panel, 40px tall */
function drawWantedStars(ctx, w, h, accent) {
  const starSize = 40;
  const gap = 6;
  const startX = w - starSize - 12;
  const startY = 12;
  
  ctx.save();
  ctx.fillStyle = '#ffd700'; // Gold colour for wanted stars
  ctx.strokeStyle = '#b8860b';
  ctx.lineWidth = 1.5;
  
  for (let i = 0; i < 5; i++) {
    const x = startX + i * (starSize + gap);
    drawStar(ctx, x, startY, starSize);
  }
  ctx.restore();
}

/** Draw a 5-pointed star */
function drawStar(ctx, cx, cy, size) {
  const spikes = 5;
  const outerRadius = size / 2;
  const innerRadius = size / 4.5;
  
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (Math.PI * i) / spikes - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** Draw cash stack (3 bundles) with animated shimmer every 3s */
function drawCashStack(ctx, w, h, accent, time) {
  const bundleW = 32;
  const bundleH = 18;
  const startX = 12;
  const startY = h - bundleH * 3 - 12;
  
  ctx.save();
  
  // Shimmer animation every 3 seconds
  const shimmerPhase = (time * 1000 / 3000) % 1; // 3 second cycle
  const shimmerAlpha = 0.3 + 0.4 * Math.abs(Math.sin(shimmerPhase * Math.PI));
  
  for (let i = 0; i < 3; i++) {
    const y = startY + i * (bundleH + 2);
    
    // Bundle shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(startX + 2, y + 2, bundleW, bundleH);
    
    // Bundle body - green cash colour
    const grad = ctx.createLinearGradient(startX, y, startX + bundleW, y);
    grad.addColorStop(0, '#166534');
    grad.addColorStop(0.5, '#22c55e');
    grad.addColorStop(1, '#16a34a');
    ctx.fillStyle = grad;
    ctx.fillRect(startX, y, bundleW, bundleH);
    
    // Bundle band
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(startX + 2, y + 4, bundleW - 4, 3);
    ctx.fillRect(startX + 2, y + bundleH - 7, bundleW - 4, 3);
    
    // $ sign
    ctx.fillStyle = '#166534';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('$', startX + bundleW / 2, y + bundleH / 2 + 3);
  }
  
  // Shimmer overlay
  if (shimmerAlpha > 0.5) {
    const shimmerGrad = ctx.createLinearGradient(startX, startY, startX + bundleW, startY + bundleH * 3);
    shimmerGrad.addColorStop(0, `rgba(255,255,255,${shimmerAlpha * 0.3})`);
    shimmerGrad.addColorStop(0.5, `rgba(255,255,255,${shimmerAlpha * 0.6})`);
    shimmerGrad.addColorStop(1, `rgba(255,255,255,${shimmerAlpha * 0.1})`);
    ctx.fillStyle = shimmerGrad;
    ctx.fillRect(startX, startY, bundleW, bundleH * 3 + 4);
  }
  
  ctx.restore();
}

/** Draw gun silhouette (side-profile pistol, 60px, bottom-right, semi-transparent, key accent) */
function drawGunSilhouette(ctx, w, h, accent) {
  const size = 60;
  const x = w - size - 12;
  const y = h - size - 12;
  
  ctx.save();
  ctx.fillStyle = setAlpha('#ffd700', 0.7); // Gold at 0.7 alpha
  
  // Draw pistol silhouette using paths
  ctx.beginPath();
  // Barrel
  ctx.rect(x, y + size * 0.3, size * 0.55, size * 0.15);
  // Slide
  ctx.rect(x + size * 0.1, y + size * 0.2, size * 0.45, size * 0.35);
  // Grip
  ctx.moveTo(x + size * 0.1, y + size * 0.55);
  ctx.lineTo(x + size * 0.1, y + size * 0.9);
  ctx.lineTo(x + size * 0.4, y + size * 0.9);
  ctx.lineTo(x + size * 0.4, y + size * 0.55);
  ctx.closePath();
  // Trigger guard
  ctx.moveTo(x + size * 0.15, y + size * 0.55);
  ctx.quadraticCurveTo(x + size * 0.2, y + size * 0.65, x + size * 0.25, y + size * 0.55);
  
  ctx.fill();
  ctx.restore();
}

/** Draw money stack (3 bundles) at top-left */
function drawMoneyStack(ctx, w, h, accent, offsetX = 0, offsetY = 0) {
  const bundleW = 28;
  const bundleH = 16;
  const startX = 10 + offsetX;
  const startY = 10 + offsetY;
  
  ctx.save();
  
  for (let i = 0; i < 3; i++) {
    const y = startY + i * (bundleH + 2);
    
    // Bundle shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(startX + 1, y + 1, bundleW, bundleH);
    
    // Bundle body
    const grad = ctx.createLinearGradient(startX, y, startX + bundleW, y);
    grad.addColorStop(0, '#166534');
    grad.addColorStop(0.5, '#22c55e');
    grad.addColorStop(1, '#16a34a');
    ctx.fillStyle = grad;
    ctx.fillRect(startX, y, bundleW, bundleH);
    
    // Bundle bands
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(startX + 2, y + 3, bundleW - 4, 2);
    ctx.fillRect(startX + 2, y + bundleH - 5, bundleW - 4, 2);
    
    // $ sign
    ctx.fillStyle = '#166534';
    ctx.font = 'bold 9px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('$', startX + bundleW / 2, y + bundleH / 2 + 3);
  }
  
  ctx.restore();
}

/** Draw dice pair at bottom-right with slight rotation */
function drawDice(ctx, w, h, accent) {
  const dieSize = 22;
  const gap = 4;
  const startX = w - dieSize * 2 - gap - 10;
  const startY = h - dieSize - 10;
  
  ctx.save();
  
  for (let i = 0; i < 2; i++) {
    const x = startX + i * (dieSize + gap);
    const y = startY;
    
    ctx.save();
    ctx.translate(x + dieSize / 2, y + dieSize / 2);
    ctx.rotate((i === 0 ? -0.15 : 0.15)); // Slight rotation
    
    // Die shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(-dieSize / 2 + 2, -dieSize / 2 + 2, dieSize, dieSize);
    
    // Die body
    const grad = ctx.createLinearGradient(-dieSize / 2, -dieSize / 2, dieSize / 2, dieSize / 2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#e5e7eb');
    ctx.fillStyle = grad;
    ctx.fillRect(-dieSize / 2, -dieSize / 2, dieSize, dieSize);
    
    // Die edge highlight
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-dieSize / 2, -dieSize / 2, dieSize, dieSize);
    
    // Draw pips (showing 6 and 1 for variety)
    ctx.fillStyle = '#1f2937';
    const pipSize = dieSize / 6;
    const pipOffset = dieSize / 3;
    
    if (i === 0) {
      // 6 pips (3x2)
      for (let row = -1; row <= 1; row++) {
        for (let col = -1; col <= 1; col++) {
          ctx.beginPath();
          ctx.arc(col * pipOffset, row * pipOffset, pipSize / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      // 1 pip (center)
      ctx.beginPath();
      ctx.arc(0, 0, pipSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  }
  
  ctx.restore();
}

/** Draw car drift lines - two curved white streaks from rear wheels, fade over 60px */
function drawDriftLines(ctx, w, h) {
  ctx.save();
  
  // Two curved streaks from rear area
  const baseY = h * 0.75;
  const baseX1 = w * 0.3;
  const baseX2 = w * 0.7;
  
  for (let i = 0; i < 2; i++) {
    const baseX = i === 0 ? baseX1 : baseX2;
    const curveDir = i === 0 ? -1 : 1;
    
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    
    // Curved drift line fading over ~60px
    for (let t = 0; t <= 1; t += 0.1) {
      const x = baseX + curveDir * 60 * t * t;
      const y = baseY + 15 * Math.sin(t * Math.PI);
      const alpha = 0.6 * (1 - t);
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  
  ctx.restore();
}

/** Draw police light - alternating red/blue pulse (800ms period) top edge of panel */
function drawPoliceLight(ctx, w, h, time) {
  const period = 800; // ms
  const phase = (time * 1000) % period / period;
  const isRed = phase < 0.5;
  
  ctx.save();
  
  const lightH = 8;
  const lightY = 0;
  
  // Draw alternating red/blue bars across top
  const barCount = 8;
  const barW = w / barCount;
  
  for (let i = 0; i < barCount; i++) {
    const barPhase = (phase + i * 0.125) % 1;
    const barIsRed = barPhase < 0.5;
    
    const color = barIsRed ? '#ef4444' : '#3b82f6';
    const alpha = barIsRed === isRed ? 1.0 : 0.3;
    
    ctx.fillStyle = setAlpha(color, alpha);
    ctx.fillRect(i * barW, lightY, barW, lightH);
  }
  
  // Glow effect
  const glowColor = isRed ? '#ef4444' : '#3b82f6';
  const glow = ctx.createLinearGradient(0, 0, 0, lightH * 3);
  glow.addColorStop(0, setAlpha(glowColor, 0.4));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, lightH, w, lightH * 2);
  
  ctx.restore();
}

/** A crisp dark keyline on every panel edge, so the gutters read as gaps between prints. */
function drawGutters(ctx, geo, w, h) {
  ctx.save();
  ctx.strokeStyle = 'rgba(3,2,6,0.92)';
  ctx.lineWidth = Math.max(1, Math.min(geo.gutter, Math.round(Math.min(w, h) * 0.006)));
  for (const rect of geo.panels) {
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(1, rect.w - 1), Math.max(1, rect.h - 1));
  }
  ctx.restore();
}

/** A hairline, used either side of the kicker and under the title. */
function hairline(ctx, x0, x1, y, colour, thickness = 1) {
  if (x1 <= x0) return;
  ctx.fillStyle = colour;
  ctx.fillRect(x0, Math.round(y), Math.max(1, x1 - x0), Math.max(1, Math.round(thickness)));
}

// A scratch canvas for reading the collage's colour back off the finished panels.
let sampleCanvas = null;

/**
 * Reads the colour of the collage itself: the mean tone, and the hue the most saturated pixels agree on. The title
 * band is built from this, so it belongs to the picture instead of sitting under it like a black bar.
 */
function sampleCollage(canvas, w, artH) {
  const fallback = { hue: 24, sat: 0.62, rgb: [110, 74, 70] };
  try {
    if (typeof document === 'undefined' || !canvas) return fallback;
    if (!sampleCanvas) sampleCanvas = document.createElement('canvas');
    const grid = 32;
    if (sampleCanvas.width !== grid) sampleCanvas.width = grid;
    if (sampleCanvas.height !== grid) sampleCanvas.height = grid;
    const sctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!sctx) return fallback;
    sctx.clearRect(0, 0, grid, grid);
    sctx.drawImage(canvas, 0, 0, w, Math.max(1, artH), 0, 0, grid, grid);
    const { data } = sctx.getImageData(0, 0, grid, grid);
    const buckets = new Array(24).fill(0);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const R = data[i];
      const G = data[i + 1];
      const B = data[i + 2];
      r += R;
      g += G;
      b += B;
      n += 1;
      const max = Math.max(R, G, B);
      const min = Math.min(R, G, B);
      const sat = (max - min) / 255;
      const lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
      if (sat > 0.18 && lum > 0.1) {
        const bucket = Math.floor(hueOfRgb(R, G, B) / 15) % 24;
        buckets[bucket] += sat * sat * (0.35 + lum);
      }
    }
    if (!n) return fallback;
    let best = 0;
    for (let i = 1; i < buckets.length; i += 1) if (buckets[i] > buckets[best]) best = i;
    const weight = buckets.reduce((sum, value) => sum + value, 0);
    const dominance = weight > 0 ? buckets[best] / weight : 0;
    // A neighbouring bucket pulls the hue a little, so the band never reads as a single flat swatch.
    const left = buckets[(best + 23) % 24];
    const right = buckets[(best + 1) % 24];
    const hue = (best * 15 + 7.5) + ((right - left) / Math.max(1, buckets[best])) * 4;
    return {
      hue: (hue + 360) % 360,
      sat: clamp(0.3 + dominance * 1.6, 0.28, 0.78),
      rgb: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
    };
  } catch {
    return fallback;
  }
}

/**
 * The title band. It is built out of the collage's own colour: a gradient in the dominant hue, a scrim that lets
 * the art melt into it, an accent rule above and a fainter one under the title, the kicker and the subtitle in the
 * grade's accent, and a grain overlay so the band has the texture of printed card rather than a flat rectangle.
 */
function drawTitleBand(ctx, state, geo, w, h, canvas, floating = false) {
  const band = geo.titleBox;
  const grade = primaryGrade(state);
  const palette = grade.palette;
  const margin = Math.round(w * 0.055);
  const tone = sampleCollage(canvas, w, geo.artH);
  const hue = Math.round(tone.hue);
  const sat = Math.round(tone.sat * 100);
  const bandTop = band.y;
  const bandH = band.h;

  const deep = `hsl(${hue}, ${Math.round(sat * 0.9)}%, 5%)`;
  const mid = `hsl(${hue}, ${sat}%, 12%)`;

  if (floating) {
    const scrim = ctx.createLinearGradient(0, bandTop - bandH * 0.4, 0, h);
    scrim.addColorStop(0, 'rgba(4,2,10,0)');
    scrim.addColorStop(0.45, 'rgba(4,2,10,0.52)');
    scrim.addColorStop(1, 'rgba(3,2,8,0.94)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, bandTop - bandH * 0.4, w, h - (bandTop - bandH * 0.4));
  } else {
    // The art fades into the band instead of stopping at it: a scrim over the last strip of the collage.
    const bleed = Math.max(6, geo.artH * 0.09);
    const scrim = ctx.createLinearGradient(0, bandTop - bleed, 0, bandTop + 2);
    scrim.addColorStop(0, `hsla(${hue}, ${sat}%, 6%, 0)`);
    scrim.addColorStop(1, `hsla(${hue}, ${sat}%, 6%, 0.92)`);
    ctx.fillStyle = scrim;
    ctx.fillRect(0, bandTop - bleed, w, bleed + 2);

    // One diagonal gradient carries both the falloff down the band and the warmth across it, so the band is never
    // a single even tone and never costs a second full-width pass.
    const glass = ctx.createLinearGradient(0, bandTop, w * 0.9, h);
    glass.addColorStop(0, `hsl(${hue}, ${Math.min(92, sat + 16)}%, 14%)`);
    glass.addColorStop(0.38, mid);
    glass.addColorStop(0.76, `hsl(${hue}, ${Math.round(sat * 0.8)}%, 7%)`);
    glass.addColorStop(1, deep);
    ctx.fillStyle = glass;
    ctx.fillRect(0, bandTop, w, h - bandTop);

    // The thin accent rule above the band, with a soft bloom bleeding up into the art.
    ctx.fillStyle = palette.mid;
    ctx.fillRect(0, bandTop, w, Math.max(2, Math.round(h * 0.0035)));
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const bloom = ctx.createLinearGradient(0, bandTop - h * 0.028, 0, bandTop + h * 0.03);
    bloom.addColorStop(0, 'rgba(0,0,0,0)');
    bloom.addColorStop(0.45, grade.glow);
    bloom.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(0, bandTop - h * 0.028, w, h * 0.058);
    ctx.restore();

    // Grain, clipped to the band, so it reads as printed card.
    const grain = grainPattern(ctx, state.seed);
    if (grain) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, bandTop, w, h - bandTop);
      ctx.clip();
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = grain;
      ctx.fillRect(0, bandTop, w, h - bandTop);
      ctx.restore();
    }
  }

  // The type stack, measured from the top of the band down so nothing can overflow it.
  const pad = bandH * (floating ? 0.08 : 0.055);
  const kickerText = (state.caption.kicker || '').trim();
  const subtitleText = (state.caption.subtitle || '').trim();
  const maxRun = Math.max(1, w - margin * 2);
  const kickerSize = fitTrackedText(ctx, kickerText, maxRun * 0.7, Math.max(12, Math.round(h * 0.027)), 0.34, 600);
  const kickerBaseline = bandTop + pad + kickerSize * 0.86;
  const rule1Y = kickerBaseline + kickerSize * 0.66;
  const subtitleSize = fitTrackedText(ctx, subtitleText, maxRun, Math.max(12, Math.round(h * 0.032)), 0.3, 500);
  const subtitleBaseline = bandTop + bandH - pad;
  const rule2Y = subtitleBaseline - subtitleSize * 1.34;
  const titleTop = rule1Y + bandH * 0.028;
  const titleBottom = rule2Y - bandH * 0.022;
  const available = Math.max(1, titleBottom - titleTop);

  // FIX 1: Name tag under hero panel - first word of caption in small tracked-out caps
  // Draw name tag on hero panel (2px above panel)
  const heroPanel = state.panels.find((p, i) => p && p.hero);
  if (heroPanel) {
    const heroRect = geo.panels.find((r, i) => state.panels[i]?.hero);
    if (heroRect) {
      const firstWord = (state.caption.title || '').split(' ')[0].toUpperCase();
      if (firstWord) {
        ctx.save();
        ctx.font = '700 14px system-ui, sans-serif';
        ctx.letterSpacing = '4px';
        ctx.fillStyle = primaryGrade(state).accent;
        ctx.textAlign = 'center';
        const nameTagY = heroRect.y + heroRect.h + 2; // 2px above panel
        ctx.fillText(firstWord, heroRect.x + heroRect.w / 2, nameTagY);
        ctx.letterSpacing = '0px';
        ctx.restore();
      }
    }
  }

  if (kickerText) {
    const run = measureTracked(ctx, kickerText, kickerSize, 0.34, 600);
    drawTrackedText(ctx, kickerText, {
      x: w / 2,
      y: kickerBaseline,
      size: kickerSize,
      tracking: 0.34,
      weight: 600,
      colour: setAlpha(grade.accent, 0.94),
      shadow: 'rgba(0,0,0,0.55)',
    });
    const gap = run / 2 + kickerSize * 1.4;
    const ruleY = Math.round(kickerBaseline - kickerSize * 0.34);
    const thickness = Math.max(1, Math.round(h * 0.0018));
    hairline(ctx, margin, w / 2 - gap, ruleY, setAlpha(grade.accent, 0.62), thickness);
    hairline(ctx, w / 2 + gap, w - margin, ruleY, setAlpha(grade.accent, 0.62), thickness);
  }

  // The wordmark: as large as the band allows, on one line if it can stay big, on two if it cannot.
  const titleText = (state.caption.title || 'Untitled').trim();
  const maxWidth = w - margin * 2;
  const fitted = fitBandTitle(ctx, titleText, maxWidth, available);
  const lineHeight = 0.94;
  const blockHeight = fitted.size * lineHeight * fitted.lines.length;
  const size = blockHeight > available ? fitted.size * (available / blockHeight) : fitted.size;
  const titleCentre = (titleTop + titleBottom) / 2 + size * 0.02;
  const blockWidth = fitted.lines.reduce((widest, line) => Math.max(
    widest,
    measureWordmark(ctx, line, size, TITLE_TRACKING, fitted.condense).width,
  ), 0);

  // FIX 3: isHeroCover only for first screenshot (1-cover)
  const isHeroCover = state.shotName === 'cover' && state.layout === 'vice' && state.size.w === 1920 && state.size.h === 1080;
  
  const wordmarkKey = [
    titleText, size, fitted.condense, lineHeight,
    palette.top, palette.mid, palette.bottom, palette.outline, grade.glow,
    fitted.lines.join(' / '),
    isHeroCover ? 'hero' : 'normal',
  ].join('|');
  const wordmark = wordmarkLayer(wordmarkKey, size, blockWidth, blockHeight, (wctx, bitmapW, bitmapH) => {
    drawTitle(wctx, titleText, {
      x: bitmapW / 2,
      y: bitmapH / 2,
      size,
      lines: fitted.lines,
      lineHeight,
      condense: fitted.condense,
      palette,
      glow: grade.glow,
      isHeroCover,
    });
  });
  ctx.drawImage(wordmark, Math.round(w / 2 - wordmark.width / 2), Math.round(titleCentre - wordmark.height / 2));

  // What the band ended up with, so a probe (or the editor) can check the type against the frame it sits in.
  drawCover.metrics = {
    size,
    condense: fitted.condense,
    lines: fitted.lines,
    available,
    titleTop,
    titleBottom,
    bandTop,
    bandH,
    margin,
    kickerSize,
    subtitleSize,
    kickerBaseline,
    subtitleBaseline,
    rule1Y,
    rule2Y,
  };

  // The second, fainter rule under the title, then the subtitle in a lighter weight, larger than the kicker.
  hairline(ctx, margin, w - margin, rule2Y, setAlpha(grade.accent, 0.42), Math.max(1, Math.round(h * 0.0016)));

  if (subtitleText) {
    drawTrackedText(ctx, subtitleText, {
      x: w / 2,
      y: subtitleBaseline,
      size: subtitleSize,
      tracking: 0.3,
      weight: 500,
      colour: setAlpha(grade.accent, 0.96),
      shadow: 'rgba(0,0,0,0.6)',
    });
  }
}

/** A cached tile of monochrome noise, the film grain laid over the finished cover and the band. */
let grainTile = null;
let grainTileSeed = 0;

function grainPattern(ctx, seed) {
  if (typeof document === 'undefined') return null;
  if (!grainTile || grainTileSeed !== seed) {
    const size = 160;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const tileCtx = canvas.getContext('2d');
    if (!tileCtx) return null;
    const pixels = tileCtx.createImageData(size, size);
    const random = makeRandom(seed);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const value = 128 + (random() - 0.5) * 108;
      pixels.data[i] = value;
      pixels.data[i + 1] = value;
      pixels.data[i + 2] = value;
      pixels.data[i + 3] = 255;
    }
    tileCtx.putImageData(pixels, 0, 0);
    grainTile = canvas;
    grainTileSeed = seed;
  }
  return ctx.createPattern(grainTile, 'repeat');
}

// The finished frame treatment is one bitmap: the vignette, the warm light in the corner and the film grain never
// change while the artwork does, so they are painted once per size and blitted in a single draw.
let frameLayer = null;
let frameLayerKey = '';

/**
 * The frame's atmosphere — the key accent wash, corner light, vignette and grain — baked into one overlay bitmap.
 * The wash is the unifying pass over the whole canvas: a whisper of the key grade's accent laid over the panels and
 * the band alike, so every panel is lit by the same lamp even though each was graded on its own.
 */
function frameOverlay(w, h, seed, accent) {
  const key = `${w}x${h}:${seed}:${accent}`;
  if (frameLayer && frameLayerKey === key) return frameLayer;
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // The unifying wash: the key accent over the whole canvas at low strength.
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = setAlpha(accent, 0.2);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // A warm light in the top corner and a shadow at the foot.
  const warm = mixColours(accent, '#ffd9ac', 0.55);
  const shadow = mixColours(accent, '#08050f', 0.72);
  const leak = ctx.createRadialGradient(w * 0.93, h * 0.05, 0, w * 0.93, h * 0.05, Math.max(w, h) * 0.52);
  leak.addColorStop(0, setAlpha(warm, 0.22));
  leak.addColorStop(0.5, setAlpha(warm, 0.07));
  leak.addColorStop(1, setAlpha(warm, 0));
  ctx.fillStyle = leak;
  ctx.fillRect(0, 0, w, h);

  const cool = ctx.createRadialGradient(w * 0.08, h * 0.98, 0, w * 0.08, h * 0.98, Math.max(w, h) * 0.46);
  cool.addColorStop(0, setAlpha(shadow, 0.2));
  cool.addColorStop(1, setAlpha(shadow, 0));
  ctx.fillStyle = cool;
  ctx.fillRect(0, 0, w, h);

  const vignette = ctx.createRadialGradient(w / 2, h * 0.44, Math.min(w, h) * 0.34, w / 2, h * 0.5, Math.hypot(w, h) * 0.62);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.62, 'rgba(2,0,6,0.2)');
  vignette.addColorStop(1, 'rgba(2,0,6,0.58)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  // Neutral grain, laid over everything.
  const grain = grainPattern(ctx, seed);
  if (grain) {
    ctx.save();
    ctx.globalAlpha = 0.075;
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  frameLayer = canvas;
  frameLayerKey = key;
  return canvas;
}

/** The last pass: the baked atmosphere, laid over the whole cover in one draw. */
function drawFrameTreatment(ctx, state, w, h, accent) {
  const overlay = frameOverlay(w, h, state.seed, accent);
  if (overlay) ctx.drawImage(overlay, 0, 0);
}

/**
 * Paints `state` onto `canvas` at the state's export size. The panel shots are planned here, so a caller only has to
 * keep the document in order. Deterministic: the same state always paints the same pixels.
 */
export function drawCover(canvas, state) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const w = Math.max(1, Math.round(state.size.w));
  const h = Math.max(1, Math.round(state.size.h));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  planPanels(state);

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, w, h);

  const geo = getLayout(state.layout, w, h);
  const flush = () => ctx.getImageData(0, 0, 1, 1);
  const t0 = performance.now();
  drawPanels(ctx, state, geo);
  flush();
  const t1 = performance.now();
  drawGutters(ctx, geo, w, h);
  drawTitleBand(ctx, state, geo, w, h, canvas, state.layout === 'hero');
  
  // FIX 2: Draw crime iconography AFTER title band (grading done, before wordmark which is in title band)
  // Actually wordmark is drawn inside title band, so crime icons should be drawn after panels but before title band
  // Let me fix the order: panels -> crime icons -> gutters -> title band -> frame treatment
  
  // Wait, looking at the original code order: drawPanels -> drawGutters -> drawTitleBand -> drawFrameTreatment
  // The wordmark is drawn inside drawTitleBand. So crime icons should be drawn after panels are drawn but before title band.
  // I'll move it here:
  drawCrimeIcons(ctx, state, geo);
  
  flush();
  const t2 = performance.now();
  // The frame is lit in the key grade's accent, the same colour the type is set in.
  drawFrameTreatment(ctx, state, w, h, primaryGrade(state).accent);
  flush();
  const t3 = performance.now();
  // Last of all, the panels are evened out: a plate that graded far darker than the rest is lifted toward the
  // composition's median, so the grid has no hole in it. Only luminance moves; the hue family is left alone.
  drawCover.exposure = levelPanels(ctx, canvas, geo.panels);
  flush();
  const t4 = performance.now();
  drawCover.timing = { panels: t1 - t0, band: t2 - t1, frame: t3 - t2, exposure: t4 - t3 };

  ctx.restore();
  return canvas;
}