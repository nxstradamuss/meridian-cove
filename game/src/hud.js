// The heads-up display, painted on the 2D canvas in a fixed 1280x720 design space and
// scaled uniformly to the window. Every panel is inset at least 26 design pixels from the
// edge, so nothing is clipped at any window shape.
//
// It carries the five things the player needs at a glance: a real minimap of the street
// grid with blips, the wanted badge, health, cash and the active mission objective, plus
// a clock and a speedometer while driving.

import { CITY_NAME, DISTRICTS, RADIO_STATION } from './config.js';

const DESIGN_W = 1280;
const DESIGN_H = 720;
const INSET = 26;
const PANEL = 'rgba(10, 16, 24, 0.62)';
const EDGE = 'rgba(255, 255, 255, 0.16)';
const GOLD = '#ffd166';
const WHITE = '#ffffff';
const MAP_SCALE = 1.25;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function panel(ctx, x, y, w, h, r = 10) {
  ctx.fillStyle = PANEL;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function label(ctx, text, x, y, size, color = GOLD, spacing = 3, align = 'left') {
  ctx.save();
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function clockText(seconds) {
  const total = Math.floor(seconds) % 86400;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function star(ctx, cx, cy, radius, filled) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = GOLD;
    ctx.fill();
  } else {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }
}

export function beginDesign(ctx, cssWidth, cssHeight, ratio) {
  const scale = Math.min(cssWidth / DESIGN_W, cssHeight / DESIGN_H);
  const offsetX = (cssWidth - DESIGN_W * scale) / 2;
  const offsetY = (cssHeight - DESIGN_H * scale) / 2;
  ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * offsetX, ratio * offsetY);
  return scale;
}

export function drawHud(ctx, cssWidth, cssHeight, ratio, state) {
  ctx.save();
  beginDesign(ctx, cssWidth, cssHeight, ratio);

  drawCash(ctx, state);
  drawClock(ctx, state);
  drawObjective(ctx, state);
  drawWanted(ctx, state);
  drawHealth(ctx, state);
  drawMinimap(ctx, state);
  if (state.driving) drawSpeedometer(ctx, state);
  drawPrompt(ctx, state);
  drawBanner(ctx, state);
  drawHurt(ctx, state);

  ctx.restore();
}

function drawCash(ctx, state) {
  panel(ctx, INSET, INSET, 250, 70);
  label(ctx, 'CASH', INSET + 18, INSET + 24, 11);
  ctx.fillStyle = WHITE;
  ctx.font = '800 30px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`$${state.money.toLocaleString('en-US')}`, INSET + 18, INSET + 56);
}

function drawClock(ctx, state) {
  const x = INSET + 250 + 14;
  panel(ctx, x, INSET, 168, 70);
  ctx.fillStyle = WHITE;
  ctx.font = '800 28px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(clockText(state.clock), x + 16, INSET + 36);
  label(ctx, RADIO_STATION.toUpperCase(), x + 16, INSET + 56, 10, 'rgba(255,209,102,0.85)', 2);
}

function drawObjective(ctx, state) {
  const mission = state.mission;
  if (!mission) return;
  const x = 470;
  const w = 500;
  panel(ctx, x, INSET, w, 78);
  ctx.fillStyle = GOLD;
  ctx.fillRect(x, INSET + 10, 4, 58);

  label(ctx, mission.title ? mission.title.toUpperCase() : CITY_NAME.toUpperCase(), x + 18, INSET + 26, 11, GOLD, 2);
  ctx.fillStyle = WHITE;
  ctx.font = '600 19px system-ui, sans-serif';
  ctx.textAlign = 'left';
  const text = mission.objective || '';
  // maxWidth keeps a long objective inside the panel instead of running off the frame edge
  ctx.fillText(text.length > 52 ? `${text.slice(0, 51)}\u2026` : text, x + 18, INSET + 56, w - 36);

  if (mission.marker) {
    const distance = Math.round(Math.hypot(
      mission.marker.x - state.player.x,
      mission.marker.z - state.player.z,
    ));
    ctx.fillStyle = 'rgba(255, 209, 102, 0.9)';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${distance} m`, x + w - 16, INSET + 26);
  }
}

function drawWanted(ctx, state) {
  const w = 270;
  const h = 96;
  const x = DESIGN_W - INSET - w;
  panel(ctx, x, INSET, w, h, 12);
  ctx.strokeStyle = state.wanted > 0 ? 'rgba(255, 209, 102, 0.85)' : EDGE;
  ctx.lineWidth = state.wanted > 0 ? 2 : 1.5;
  roundRect(ctx, x, INSET, w, h, 12);
  ctx.stroke();

  label(ctx, 'WANTED', x + 20, INSET + 26, 12, 'rgba(255,255,255,0.72)', 4);
  ctx.textAlign = 'right';
  ctx.fillStyle = state.wanted > 0 ? GOLD : 'rgba(255,255,255,0.45)';
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.fillText(`${state.wanted} / 5`, x + w - 18, INSET + 26);

  for (let i = 0; i < 5; i += 1) {
    star(ctx, x + 34 + i * 50, INSET + 62, 16, i < state.wanted);
  }
}

function drawHealth(ctx, state) {
  const h = 98;
  const y = DESIGN_H - INSET - h;
  panel(ctx, INSET, y, 300, h);
  label(ctx, 'HEALTH', INSET + 18, y + 28, 11);

  const ratio = Math.max(0, Math.min(1, state.health / 100));
  const barX = INSET + 18;
  const barY = y + 42;
  const barW = 264;
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  roundRect(ctx, barX, barY, barW, 18, 9);
  ctx.fill();
  ctx.fillStyle = ratio > 0.5 ? '#5fd18b' : ratio > 0.25 ? '#ffd166' : '#ff6b6b';
  roundRect(ctx, barX, barY, Math.max(10, barW * ratio), 18, 9);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${Math.round(state.health)}`, barX + 6, barY + 60);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(state.driving ? 'IN A CAR' : 'ON FOOT', barX + barW, barY + 60);
}

function drawSpeedometer(ctx, state) {
  const h = 98;
  const y = DESIGN_H - INSET - 98 - 12 - h;
  panel(ctx, INSET, y, 300, h);
  label(ctx, 'SPEED', INSET + 18, y + 28, 11);
  const value = `${Math.round(state.speed)}`;
  ctx.fillStyle = WHITE;
  ctx.font = '800 44px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(value, INSET + 18, y + 78);
  const valueWidth = ctx.measureText(value).width;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.fillText('KM/H', INSET + 18 + valueWidth + 12, y + 78);
  ctx.textAlign = 'right';
  ctx.fillStyle = state.driving.speed < -0.4 ? '#ff9f6b' : GOLD;
  ctx.font = '700 16px system-ui, sans-serif';
  ctx.fillText(state.driving.speed < -0.4 ? 'R' : 'D', INSET + 300 - 18, y + 44);
}

// The map: the street grid around the player as light lines on a dark plate, building
// footprints as faint blocks, the coast, and blips for the player, the police and the
// active mission. North is up and the player is an arrow showing the heading.
function drawMinimap(ctx, state) {
  const size = 236;
  const x = DESIGN_W - INSET - size;
  const y = DESIGN_H - INSET - size;
  panel(ctx, x, y, size, size, 14);

  const inner = 8;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const k = MAP_SCALE;
  const half = (size / 2 - inner) / k;
  const px = state.player.x;
  const pz = state.player.z;
  const city = state.city;

  ctx.save();
  roundRect(ctx, x + inner, y + inner, size - inner * 2, size - inner * 2, 10);
  ctx.clip();

  ctx.fillStyle = 'rgba(26, 38, 52, 0.85)';
  ctx.fillRect(x + inner, y + inner, size - inner * 2, size - inner * 2);

  const mapX = (wx) => cx + (wx - px) * k;
  const mapY = (wz) => cy + (wz - pz) * k;

  // The sea and the sand east of the grid.
  const waterX = mapX(city.coast.shoreX);
  if (waterX < x + size) {
    ctx.fillStyle = 'rgba(64, 156, 190, 0.35)';
    ctx.fillRect(waterX, y + inner, x + size - waterX, size - inner * 2);
  }
  const sandX = mapX(city.coast.sandEndX);
  if (sandX < x + size) {
    ctx.fillStyle = 'rgba(226, 204, 158, 0.28)';
    ctx.fillRect(sandX, y + inner, x + size - sandX, size - inner * 2);
  }

  // Building footprints: only the ones inside the map window.
  ctx.fillStyle = 'rgba(210, 226, 240, 0.16)';
  for (const b of city.buildings) {
    if (Math.abs(b.x - px) > half + b.w || Math.abs(b.z - pz) > half + b.d) continue;
    ctx.fillRect(mapX(b.x - b.w / 2), mapY(b.z - b.d / 2), b.w * k, b.d * k);
  }

  // The road grid: wide light lines, so the grid reads even when the frame is shrunk.
  ctx.strokeStyle = 'rgba(226, 236, 245, 0.42)';
  ctx.lineWidth = 12 * k;
  ctx.beginPath();
  for (const line of city.roadsX) {
    if (Math.abs(line.x - px) > half) continue;
    ctx.moveTo(mapX(line.x), y + inner);
    ctx.lineTo(mapX(line.x), y + size - inner);
  }
  for (const line of city.roadsZ) {
    if (Math.abs(line.z - pz) > half) continue;
    ctx.moveTo(x + inner, mapY(line.z));
    ctx.lineTo(x + size - inner, mapY(line.z));
  }
  ctx.stroke();

  // Park blocks get a little green so the grid is not uniform.
  ctx.fillStyle = 'rgba(120, 180, 120, 0.3)';
  for (const block of city.blocks) {
    if (!block.parks) continue;
    if (Math.abs(block.cx - px) > half + 24 || Math.abs(block.cz - pz) > half + 24) continue;
    ctx.fillRect(mapX(block.cx - 22), mapY(block.cz - 22), 44 * k, 44 * k);
  }

  // Blips.
  for (const cruiser of state.police.cruisers) {
    ctx.fillStyle = '#ff5a5a';
    ctx.beginPath();
    ctx.arc(mapX(cruiser.x), mapY(cruiser.z), 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const officer of state.police.officers) {
    if (officer.down > 0) continue;
    ctx.fillStyle = '#6ab0ff';
    ctx.beginPath();
    ctx.arc(mapX(officer.x), mapY(officer.z), 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (state.mission && state.mission.marker) {
    const mx = mapX(state.mission.marker.x);
    const my = mapY(state.mission.marker.z);
    const clampedX = Math.max(x + 14, Math.min(x + size - 14, mx));
    const clampedY = Math.max(y + 14, Math.min(y + size - 14, my));
    ctx.fillStyle = GOLD;
    ctx.save();
    ctx.translate(clampedX, clampedY);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  }

  // The player: a white arrow pointing where they face.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-state.player.heading + Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(6.5, 7);
  ctx.lineTo(0, 4);
  ctx.lineTo(-6.5, 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(20, 28, 38, 0.8)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  ctx.restore();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x + inner, y + inner, size - inner * 2, size - inner * 2, 10);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '700 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', x + size - 18, y + 20);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText(districtName(state), x + size / 2, y + size - 12);
}

function districtName(state) {
  let best = 'core';
  let bestDistance = Infinity;
  const px = state.player.x;
  const pz = state.player.z;
  for (const block of state.city.blockSummary) {
    const d = (block.cx - px) ** 2 + (block.cz - pz) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = block.district;
    }
  }
  return DISTRICTS[best].name.toUpperCase();
}

function drawPrompt(ctx, state) {
  if (!state.prompt) return;
  const w = 300;
  const x = (DESIGN_W - w) / 2;
  const y = DESIGN_H - INSET - 52;
  ctx.fillStyle = 'rgba(10, 16, 24, 0.74)';
  roundRect(ctx, x, y, w, 46, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 209, 102, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = GOLD;
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillText(state.prompt, x + w / 2, y + 29);
}

function drawBanner(ctx, state) {
  if (!state.banner) return;
  const banner = state.banner;
  const alpha = Math.min(1, banner.time / 0.6);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(8, 14, 22, 0.6)';
  roundRect(ctx, DESIGN_W / 2 - 260, 150, 520, 96, 12);
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.font = '800 34px system-ui, sans-serif';
  ctx.fillText(banner.title, DESIGN_W / 2, 194);
  ctx.fillStyle = WHITE;
  ctx.font = '600 17px system-ui, sans-serif';
  ctx.fillText(banner.sub, DESIGN_W / 2, 224);
  ctx.restore();
}

function drawHurt(ctx, state) {
  if (!state.hurt || state.hurt <= 0) return;
  const strength = Math.min(0.55, state.hurt * 1.2);
  const gradient = ctx.createRadialGradient(DESIGN_W / 2, DESIGN_H / 2, 240, DESIGN_W / 2, DESIGN_H / 2, 720);
  gradient.addColorStop(0, 'rgba(150, 20, 20, 0)');
  gradient.addColorStop(1, `rgba(150, 20, 20, ${strength.toFixed(3)})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
}
