// The crowd. Everyone walks the perimeter of a block on the pavement, sometimes stops at
// a corner, runs away from gunfire and from anything moving fast enough to hit them.
// The whole crowd is one InstancedMesh; the walk cycle lives per person as a bob, a roll
// and a body scale.

import * as THREE from '../vendor/three.module.min.js';
import { COUNTS, GRID } from './config.js';
import { clamp, pushOutOfRect, wrapAngle } from './geometry.js';
import { makeRng } from './random.js';
import { createPersonBatch } from './models.js';
import { makeOccluder } from './framing.js';

const PED_COLORS = [
  0xe0d3b8, 0xc25a44, 0x3f6f86, 0xd8b04a, 0x5d6b4a, 0x8a5f8f, 0xd8d8d8,
  0x2f4a6b, 0xb8543f, 0x4f7f6b, 0xe8c27a, 0x6a4f3f,
];

// People walk this far in from the kerb, leaving room for the lamp posts.
const WALK_INSET = 2.4;
// The pavement slab stands 0.36 above the roadway (see scene3d.js addSidewalks).
const PAVEMENT = 0.36;

const HALF = GRID.blockSize / 2 - WALK_INSET;
const SIDE = HALF * 2;
const PERIMETER = SIDE * 4;
const MAX_PEDS = COUNTS.peds + 16;

// Bodies run a little over life size: at 1.12 to 1.47 a person still reads as a person
// when the finished 1280x720 frame is shrunk to a thumbnail, and the range keeps the tall
// and the short of the crowd visibly different instead of one uniform column of clones.
const BODY_MIN = 1.12;
const BODY_SPREAD = 0.35;

function bodyScale(rng) {
  return BODY_MIN + rng.next() * BODY_SPREAD;
}

// The four corners of a block's walking perimeter, in the order the walk visits them.
function blockCorners(block) {
  return [
    { x: block.cx - HALF, z: block.cz - HALF },
    { x: block.cx + HALF, z: block.cz - HALF },
    { x: block.cx + HALF, z: block.cz + HALF },
    { x: block.cx - HALF, z: block.cz + HALF },
  ];
}

// A point on the perimeter at normalised distance t, plus the heading along the walk.
function perimeterAt(block, t) {
  const points = blockCorners(block);
  let travelled = (((t % 1) + 1) % 1) * PERIMETER;
  for (let i = 0; i < 4; i += 1) {
    if (travelled <= SIDE) {
      const a = points[i];
      const b = points[(i + 1) % 4];
      const f = travelled / SIDE;
      return {
        x: a.x + (b.x - a.x) * f,
        z: a.z + (b.z - a.z) * f,
        rot: Math.atan2(b.x - a.x, b.z - a.z),
      };
    }
    travelled -= SIDE;
  }
  return { x: block.cx, z: block.cz, rot: 0 };
}

export function createPeds(state, scene) {
  const city = state.city;
  const rng = makeRng((state.seed ^ 0x51c0ffee) >>> 0);
  const peds = [];
  const batch = scene ? createPersonBatch(scene, MAX_PEDS, 'peds') : null;

  // The avenue is where the crowd has to read, so the blocks that front it are filled
  // first and the rest of the population spreads over downtown.
  const avenueBlocks = [];
  const otherBlocks = [];
  city.blocks.forEach((block, index) => {
    const onAvenue = Math.abs(block.cx) === 30 && block.cz >= -60 && block.cz <= 270;
    if (onAvenue) avenueBlocks.push(index);
    else if (Math.abs(block.cx) <= 210 && Math.abs(block.cz) <= 270) otherBlocks.push(index);
  });
  if (!avenueBlocks.length) avenueBlocks.push(0);
  if (!otherBlocks.length) otherBlocks.push(city.blocks.length - 1);

  function spawn(blockIndex, t) {
    const block = city.blocks[blockIndex];
    const color = new THREE.Color(rng.pick(PED_COLORS));
    const ped = {
      block: blockIndex,
      t,
      dir: rng.chance(0.5) ? 1 : -1,
      speed: rng.range(1.0, 1.9),
      phase: rng.range(0, 6.28),
      scale: bodyScale(rng),
      color,
      x: block.cx,
      z: block.cz,
      rot: 0,
      pause: 0,
      corner: Math.floor((((t % 1) + 1) % 1) * 4),
      flee: 0,
      stride: 0,
      down: 0,
      seed: rng.int(1, 0x7fffffff),
    };
    place(ped);
    return ped;
  }

  function place(ped) {
    const point = perimeterAt(city.blocks[ped.block], ped.t);
    ped.x = point.x;
    ped.z = point.z;
    ped.rot = ped.dir > 0 ? point.rot : wrapAngle(point.rot + Math.PI);
  }

  function spawnAll() {
    peds.length = 0;
    const avenueCount = Math.min(120, Math.round(COUNTS.peds * 0.72));
    const perBlock = Math.max(1, Math.ceil(avenueCount / avenueBlocks.length));
    const kerbSlots = Math.min(8, perBlock);

    // The avenue crowd walks the kerb that faces the road: the east side of a block west
    // of the avenue, the west side of a block east of it. Once those kerbs are full the
    // overflow goes to the opposite side of the same block.
    for (let i = 0; i < avenueCount; i += 1) {
      const blockIndex = avenueBlocks[i % avenueBlocks.length];
      const block = city.blocks[blockIndex];
      const slot = Math.floor(i / avenueBlocks.length);
      const kerb = block.cx > 0 ? 3 : 1;
      const onKerb = slot < kerbSlots;
      const side = onKerb ? kerb : (kerb + 2) % 4;
      const along = onKerb
        ? (slot + 0.5) / kerbSlots
        : (slot - kerbSlots + 0.5) / Math.max(1, perBlock - kerbSlots);
      const t = ((side + along) / 4 + rng.range(-0.008, 0.008) + 1) % 1;
      peds.push(spawn(blockIndex, t));
    }

    // Everyone else fills the remaining downtown blocks, anywhere on the perimeter.
    while (peds.length < COUNTS.peds) {
      peds.push(spawn(rng.pick(otherBlocks), rng.range(0, 1)));
    }
    state.peds = peds;
  }

  // Sends a ped along its pavement, away from a threat. Both ways round the block are
  // compared first, so nobody sprints into the gunfire.
  function fleeFrom(ped, threatX, threatZ, seconds) {
    const block = city.blocks[ped.block];
    const ahead = perimeterAt(block, ped.t + 0.02);
    const behind = perimeterAt(block, ped.t - 0.02);
    const aheadGap = Math.hypot(ahead.x - threatX, ahead.z - threatZ);
    const behindGap = Math.hypot(behind.x - threatX, behind.z - threatZ);
    ped.dir = aheadGap > behindGap ? 1 : -1;
    ped.flee = Math.max(ped.flee, seconds);
    ped.pause = 0;
  }

  // A gunshot clears the pavement: everyone close enough runs.
  function alert(x, z, radius) {
    const r2 = radius * radius;
    for (const ped of peds) {
      if (ped.down > 0) continue;
      const dx = ped.x - x;
      const dz = ped.z - z;
      if (dx * dx + dz * dz < r2) fleeFrom(ped, x, z, 2.6);
    }
  }

  // Anything on the street moving fast enough to hurt someone.
  function threats(state) {
    const fast = [];
    const collect = (car) => {
      if (Math.abs(car.speed) > 6) fast.push(car);
    };
    for (const car of state.cars) collect(car);
    if (state.vehicles) for (const car of state.vehicles) if (!car.parked) collect(car);
    return fast;
  }

  function step(dt, state) {
    const fast = threats(state);
    for (const ped of peds) {
      if (ped.down > 0) {
        ped.down -= dt;
        if (ped.down <= 0) {
          // Back on the pavement, somewhere else on the same block.
          ped.seed = (ped.seed * 1664525 + 1013904223) >>> 0;
          ped.t = (ped.seed % 1000) / 1000;
          ped.flee = 0;
          ped.pause = 0;
          place(ped);
        }
        continue;
      }

      for (const car of fast) {
        const dx = ped.x - car.x;
        const dz = ped.z - car.z;
        if (dx * dx + dz * dz < 64) {
          fleeFrom(ped, car.x, car.z, 1.8);
          break;
        }
      }

      if (ped.flee > 0) ped.flee -= dt;
      if (ped.pause > 0) ped.pause -= dt;

      const running = ped.flee > 0;
      const speed = running ? ped.speed * 2.7 : ped.speed;
      const moving = ped.pause <= 0;
      if (moving) {
        ped.t += (ped.dir * speed * dt) / PERIMETER;
        const corner = Math.floor((((ped.t % 1) + 1) % 1) * 4);
        if (corner !== ped.corner) {
          ped.corner = corner;
          // Some people wait at the kerb before crossing the mouth of the street.
          ped.seed = (ped.seed * 1103515245 + 12345) >>> 0;
          if ((ped.seed & 3) === 0) ped.pause = 1.1 + ((ped.seed >>> 8) % 100) / 60;
        }
      }
      ped.phase += dt * speed * (running ? 3.4 : 2.4);
      ped.stride += ((moving ? (running ? 1.5 : 1) : 0) - ped.stride) * Math.min(1, dt * 6);
      place(ped);
    }
  }

  function sync() {
    if (!batch) return;
    batch.begin();
    for (const ped of peds) {
      if (ped.down > 0) continue;
      const bob = Math.abs(Math.sin(ped.phase)) * 0.075 * ped.stride;
      const lean = Math.sin(ped.phase * 0.5) * 0.06 * ped.stride;
      // The pavement stands 0.36 above the roadway, so a figure walking it is lifted by
      // the same amount; otherwise it sinks to the knee in the slabs.
      batch.place(ped.x, ped.z, ped.rot, ped.color, PAVEMENT + bob, lean, ped.scale);
    }
    batch.commit();
  }

  // Staging: move the crowd onto pavements that fall inside the frame a staged scene is
  // about to capture. Both sides of the street are filled alternately so the kerbs the
  // camera looks down are the crowded ones, and the colours are re-dealt from the palette
  // so the crowd never reads as a column of one colour.
  function stageCrowd({ framer, count, near = 9, far = 150, gap = 2.4, margin = 0.92, avoid = [] }) {
    if (!framer || !count) return 0;
    const wanted = Math.min(count, peds.length);
    const blocked = makeOccluder(city, framer.eye);
    const left = [];
    const right = [];

    city.blocks.forEach((block, index) => {
      if (framer.distance(block.cx, block.cz) > far + 36) return;
      const steps = Math.max(14, Math.round(PERIMETER / 1.6));
      for (let s = 0; s < steps; s += 1) {
        const t = s / steps;
        const point = perimeterAt(block, t);
        if (!framer.inFrame(point.x, 1.0, point.z, margin)) continue;
        const d = framer.distance(point.x, point.z);
        if (d < near || d > far) continue;
        let skip = false;
        for (let a = 0; a < avoid.length; a += 1) {
          const spot = avoid[a];
          if (Math.hypot(point.x - spot.x, point.z - spot.z) < (spot.r || 2.4)) {
            skip = true;
            break;
          }
        }
        if (skip || blocked(point.x, point.z)) continue;
        const slot = { block: index, t, x: point.x, z: point.z, d };
        (point.x < 0 ? left : right).push(slot);
      }
    });

    left.sort((a, b) => a.d - b.d);
    right.sort((a, b) => a.d - b.d);

    // Nearest first, alternating sides, and never two people within `gap` of each other.
    const chosen = [];
    const take = (slot) => {
      if (!slot) return;
      for (const other of chosen) {
        if (Math.hypot(other.x - slot.x, other.z - slot.z) < gap) return;
      }
      chosen.push(slot);
    };
    for (let i = 0; i < Math.max(left.length, right.length) && chosen.length < wanted; i += 1) {
      take(right[i]);
      if (chosen.length >= wanted) break;
      take(left[i]);
    }

    for (let i = 0; i < chosen.length; i += 1) {
      const ped = peds[i];
      const slot = chosen[i];
      ped.block = slot.block;
      ped.t = slot.t;
      ped.dir = i % 2 === 0 ? 1 : -1;
      ped.speed = rng.range(1.0, 1.9);
      ped.phase = rng.range(0, 6.28);
      ped.pause = 0;
      ped.flee = 0;
      ped.down = 0;
      ped.stride = 0.7;
      ped.corner = Math.floor((((slot.t % 1) + 1) % 1) * 4);
      // A coprime stride through the palette: every staged person is a different colour
      // from their neighbours until the list wraps.
      ped.color = new THREE.Color(PED_COLORS[(i * 5 + 3) % PED_COLORS.length]);
      place(ped);
    }
    return chosen.length;
  }

  spawnAll();
  return { peds, step, sync, spawnAll, stageCrowd, alert, fleeFrom };
}

export function nearestPed(peds, x, z, radius) {
  let best = null;
  let bestD2 = radius * radius;
  for (const ped of peds) {
    if (ped.down > 0) continue;
    const dx = ped.x - x;
    const dz = ped.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = ped;
    }
  }
  return best;
}

export function clampToCity(city, x, z) {
  return {
    x: clamp(x, city.bounds.minX, city.bounds.maxX),
    z: clamp(z, city.bounds.minZ, city.bounds.maxZ),
  };
}

export function pushOut(city, x, z, radius) {
  for (const rect of city.collisions) {
    const fixed = pushOutOfRect(x, z, radius, rect);
    if (fixed) return fixed;
  }
  return null;
}
