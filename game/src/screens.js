// The full-screen menus: the start screen that names the city, the pause menu that lists
// every control, and the wasted screen shown when the player goes down.

import { AVENUE_NAME, CITY_NAME, CITY_TAGLINE, DISTRICTS, GANG_NAME, RADIO_STATION } from './config.js';
import { beginDesign } from './hud.js';

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

export function drawTitle(ctx, cssWidth, cssHeight, ratio, elapsed) {
  ctx.save();
  beginDesign(ctx, cssWidth, cssHeight, ratio);

  const scrim = ctx.createLinearGradient(0, 0, 0, 720);
  scrim.addColorStop(0, 'rgba(8, 16, 26, 0.72)');
  scrim.addColorStop(0.5, 'rgba(8, 16, 26, 0.28)');
  scrim.addColorStop(1, 'rgba(8, 16, 26, 0.82)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, 1280, 720);

  const left = 92;
  const base = 470;

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd166';
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.letterSpacing = '7px';
  ctx.fillText('AN OPEN COASTAL CITY', left, base - 150);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 96px system-ui, sans-serif';
  ctx.fillText(CITY_NAME.toUpperCase(), left, base - 46);

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '400 24px system-ui, sans-serif';
  ctx.fillText(CITY_TAGLINE, left, base + 2);

  ctx.fillStyle = '#ffd166';
  ctx.fillRect(left, base + 28, 220, 3);

  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '500 16px system-ui, sans-serif';
  ctx.fillText(`${AVENUE_NAME} \u00b7 ${DISTRICTS.core.name} \u00b7 ${RADIO_STATION}`, left, base + 62);
  ctx.fillText(`Traffic on the avenue, a crowd on the kerb, the ${GANG_NAME} on Cannery Row.`, left, base + 90);
  ctx.fillText('Steal a car, take a job, and try to lose the police.', left, base + 118);

  const pulse = 0.55 + 0.45 * Math.sin(elapsed * 3.2);
  ctx.fillStyle = `rgba(255, 209, 102, ${pulse.toFixed(3)})`;
  ctx.font = '800 24px system-ui, sans-serif';
  ctx.fillText('PRESS ENTER TO PLAY', left, base + 190);

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '500 14px system-ui, sans-serif';
  ctx.fillText('WASD walk \u00b7 mouse look \u00b7 click to fire \u00b7 F to take a car \u00b7 Esc pauses', left, base + 224);

  ctx.restore();
}

export function drawPause(ctx, cssWidth, cssHeight, ratio, state) {
  ctx.save();
  beginDesign(ctx, cssWidth, cssHeight, ratio);

  ctx.fillStyle = 'rgba(8, 14, 22, 0.7)';
  ctx.fillRect(0, 0, 1280, 720);

  const w = 620;
  const h = 470;
  const x = (1280 - w) / 2;
  const y = (720 - h) / 2;

  ctx.fillStyle = 'rgba(14, 22, 32, 0.94)';
  roundRect(ctx, x, y, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 209, 102, 0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd166';
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.letterSpacing = '5px';
  ctx.fillText('PAUSED', x + 36, y + 52);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 34px system-ui, sans-serif';
  ctx.fillText(CITY_NAME, x + 36, y + 96);

  const rows = [
    ['W A S D', 'walk, or drive and steer'],
    ['Q / E', 'turn on the spot'],
    ['Shift', 'sprint'],
    ['Mouse', 'look around (click to lock)'],
    ['Left click', 'fire the pistol'],
    ['F', 'get into or out of a car'],
    ['Space', 'handbrake in a car'],
    ['R', 'respawn on Kestrel Avenue'],
    ['Esc', 'resume'],
  ];
  rows.forEach((row, i) => {
    const rowY = y + 146 + i * 32;
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 209, 102, 0.85)';
    ctx.fillText(row[0], x + 36, rowY);
    ctx.font = '500 15px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
    ctx.fillText(row[1], x + 200, rowY);
  });

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText(`$${state.money.toLocaleString('en-US')}`, x + w - 36, y + 96);
  ctx.fillText(`Wanted ${state.wanted} / 5`, x + w - 36, y + 120);

  ctx.restore();
}

export function drawWasted(ctx, cssWidth, cssHeight, ratio, timer) {
  ctx.save();
  beginDesign(ctx, cssWidth, cssHeight, ratio);
  const alpha = Math.min(0.86, 0.3 + (3.4 - timer) * 0.22);
  ctx.fillStyle = `rgba(70, 6, 10, ${alpha.toFixed(3)})`;
  ctx.fillRect(0, 0, 1280, 720);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff5a5a';
  ctx.font = '900 110px system-ui, sans-serif';
  ctx.letterSpacing = '10px';
  ctx.fillText('WASTED', 640, 350);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '600 20px system-ui, sans-serif';
  ctx.fillText('The medics patch you up on Kestrel Avenue \u2014 record cleared', 640, 400);
  ctx.restore();
}
