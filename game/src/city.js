// Generates Meridian Cove from a seed: the block grid, the road graph, every building
// footprint and height, the two landmark blocks, the parks, the beach and the marina.

import {
  AVENUE_NAME, COAST, DISTRICTS, GRID, HEIGHTS, STREETS_X, STREETS_Z, WORLD_LIMIT,
} from './config.js';
import { makeRng } from './random.js';
import { clamp } from './geometry.js';

const LINE_COUNT = GRID.columns + 1;
const HALF_BLOCK = GRID.blockSize / 2;

// The two blocks that carry a landmark, chosen so both front Kestrel Avenue.
const HELIPAD_BLOCK = { cx: -30, cz: 150 };
const POLICE_BLOCK = { cx: 30, cz: 210 };
// The avenue opens into a palm plaza at its southern entrance: open ground that keeps
// the downtown skyline readable from street level instead of walling it off.
const PLAZA_BLOCKS = [{ cx: -30, cz: 270 }, { cx: 30, cz: 270 }];

export function buildCity(seed) {
  const rng = makeRng(seed);
  const xs = [];
  const zs = [];
  for (let k = 0; k < LINE_COUNT; k += 1) {
    const x = -GRID.span + k * GRID.pitch;
    xs.push({ x, name: STREETS_X[k] });
    zs.push({ z: x, name: STREETS_Z[k] });
  }

  const graph = buildRoadGraph(xs, zs);
  const blocks = [];
  const buildings = [];
  const collisions = [];
  const trees = [];
  const lamps = [];
  const ponds = [];
  const plazas = [];
  const palms = [];
  const props = [];
  const landmarks = {};

  for (let i = 0; i < GRID.columns; i += 1) {
    for (let j = 0; j < GRID.columns; j += 1) {
      const cx = -GRID.span + GRID.pitch * (i + 0.5);
      const cz = -GRID.span + GRID.pitch * (j + 0.5);
      const district = districtOf(cx, cz);
      const block = {
        i, j, cx, cz, district, kind: 'lots', parks: false,
        x0: cx - HALF_BLOCK, x1: cx + HALF_BLOCK,
        z0: cz - HALF_BLOCK, z1: cz + HALF_BLOCK,
      };

      if (cx === HELIPAD_BLOCK.cx && cz === HELIPAD_BLOCK.cz) {
        block.kind = 'helipad';
        landmarks.helipad = addHelipadBlock(block, buildings, collisions);
      } else if (cx === POLICE_BLOCK.cx && cz === POLICE_BLOCK.cz) {
        block.kind = 'police';
        landmarks.police = addPoliceBlock(block, buildings, collisions);
      } else if (PLAZA_BLOCKS.some((p) => p.cx === cx && p.cz === cz)) {
        block.kind = 'plaza';
        plazas.push(makePlaza(block, rng, palms));
      } else if (shouldBePark(block, rng)) {
        block.kind = 'park';
        block.parks = true;
        ponds.push(makePond(block, rng, ponds.length));
        scatterParkTrees(block, rng, trees, ponds[ponds.length - 1]);
      } else {
        addLots(block, rng, buildings, collisions);
      }

      if (block.kind !== 'park' && block.kind !== 'plaza') addSidewalkTrees(block, rng, trees);
      blocks.push(block);
    }
  }

  addLamps(lamps);
  addStreetClutter(rng, lamps, props);
  const coast = buildCoast(rng, trees, palms);
  const spawn = { x: 3.2, z: 282, heading: Math.PI };
  const blockSummary = summariseBlocks(blocks, buildings);

  const city = {
    seed,
    name: 'Meridian Cove',
    avenue: AVENUE_NAME,
    roadsX: xs,
    roadsZ: zs,
    blocks,
    buildings,
    collisions,
    trees,
    lamps,
    props,
    ponds,
    plazas,
    palms,
    landmarks,
    coast,
    graph,
    // The same graph under the name the traffic and police systems use.
    roads: graph,
    spawn,
    blockSummary,
    bounds: {
      minX: -WORLD_LIMIT,
      maxX: COAST.waterStartX - 3,
      minZ: -WORLD_LIMIT,
      maxZ: WORLD_LIMIT,
    },
    stats: {
      buildings: buildings.length,
      towers: buildings.filter((b) => b.h >= HEIGHTS.towerMin).length,
      glass: buildings.filter((b) => b.palette === 'glass').length,
      blocks: blocks.length,
      parks: blocks.filter((b) => b.parks).length,
    },
  };
  city.viewpoint = findViewpoint(city);
  return city;
}

function districtOf(cx, cz) {
  const m = Math.max(Math.abs(cx), Math.abs(cz));
  if (m <= 100) return 'core';
  if (cx >= 210) return 'shore';
  if (m <= 200) return 'midtown';
  return 'outer';
}

// Roughly one block in eleven becomes a park, never in the glass core and never
// right on the avenue, so the canyon stays dense.
function shouldBePark(block, rng) {
  if (block.district === 'core') return false;
  if (Math.abs(block.cx) < 70) return false;
  return rng.chance(0.11);
}

function addLots(block, rng, buildings, collisions) {
  const core = block.district === 'core';
  const lots = core ? 2 : 3;
  const usable = GRID.blockSize - GRID.sidewalkInset * 2;
  const cell = usable / lots;
  const m = Math.max(Math.abs(block.cx), Math.abs(block.cz));
  const closeness = clamp(1 - (m - 100) / 170, 0, 1);

  for (let a = 0; a < lots; a += 1) {
    for (let b = 0; b < lots; b += 1) {
      if (rng.chance(core ? 0.05 : 0.12)) continue;
      const x = block.cx - usable / 2 + cell * (a + 0.5);
      const z = block.cz - usable / 2 + cell * (b + 0.5);
      const w = Math.max(4.5, cell - rng.range(2.2, 4.6));
      const d = Math.max(4.5, cell - rng.range(2.2, 4.6));

      let h;
      let palette;
      if (core) {
        // The core rises toward the north like a ridge, so the southern edge of
        // downtown is lower and the skyline reads with sky above it. The roll splits
        // the ridge into towers, mid-rise gaps and the odd spike, so no two neighbours
        // end at the same height.
        const northness = clamp((60 - block.cz) / 150, 0, 1);
        const ridge = 70 + northness * (HEIGHTS.towerMax - 70);
        const roll = rng.next();
        if (roll < 0.13) {
          h = rng.range(HEIGHTS.midMin, 38);
        } else if (roll < 0.31) {
          h = rng.range(38, HEIGHTS.towerMin);
        } else if (roll < 0.9) {
          h = rng.range(HEIGHTS.towerMin, ridge);
        } else {
          h = rng.range(ridge, ridge * 1.1 + 8);
        }
        palette = rng.chance(0.88) ? 'glass' : 'mid';
      } else if (block.district === 'midtown') {
        h = rng.range(13, 24) + closeness * rng.range(2, 16);
        palette = rng.weighted({ glass: 0.45, mid: 0.33, warm: 0.22 });
      } else if (block.district === 'shore') {
        h = rng.range(7, 16);
        palette = rng.weighted({ warm: 0.84, mid: 0.16 });
      } else {
        h = rng.range(HEIGHTS.lowMin, 18);
        palette = rng.weighted({ warm: 0.72, mid: 0.28 });
      }

      // Two true supertalls just north of the crossing anchor the skyline.
      if (Math.abs(block.cx) === 30 && block.cz === -30 && a === 0 && b === 0) {
        h = rng.range(104, 122);
        palette = 'glass';
      }

      // A stepped setback: a narrower upper block stacked on the wider base. It is drawn
      // from the same instanced body mesh as everything else, so the variety costs one
      // extra draw call for the whole city rather than one mesh per tower.
      const stepShare = core ? 0.58 : block.district === 'midtown' ? 0.34 : 0.16;
      const stepped = h >= 26 && rng.chance(stepShare);
      const crown = stepped ? clamp(rng.range(7, 22), 5, h * 0.42) : 0;

      buildings.push({
        x, z, w, d, h: Math.round(h * 10) / 10,
        // The height of the wide lower block; `h` stays the roof of the whole building.
        base: Math.round((h - crown) * 10) / 10,
        upper: stepped
          ? { w: Math.round(w * rng.range(0.5, 0.68) * 10) / 10, d: Math.round(d * rng.range(0.5, 0.68) * 10) / 10 }
          : null,
        // Window bands are spaced per building, so no two towers share a rhythm.
        bandGap: rng.pick([6.5, 8, 10.5, 13, 16, 20]),
        palette,
        roof: pickRoof(palette, rng),
        district: block.district,
        block: `${block.i}:${block.j}`,
      });
      collisions.push({ x, z, w: w + 0.7, d: d + 0.7 });
    }
  }
}

function pickRoof(palette, rng) {
  if (palette === 'glass') return 'flat';
  if (palette === 'warm') return rng.weighted({ flat: 0.58, terra: 0.24, tank: 0.18 });
  return rng.weighted({ flat: 0.68, garden: 0.32 });
}

function addHelipadBlock(block, buildings, collisions) {
  const w = 28;
  const d = 28;
  const h = 72;
  buildings.push({
    x: block.cx, z: block.cz, w, d, h,
    palette: 'glass', roof: 'helipad', district: block.district,
    special: 'helipad', color: 0xd7e4ea, block: `${block.i}:${block.j}`,
  });
  collisions.push({ x: block.cx, z: block.cz, w: w + 0.7, d: d + 0.7 });
  return {
    x: block.cx, z: block.cz, w, d, h,
    padRadius: 11,
    deckY: h + 0.35,
    label: 'COBALT PAD',
  };
}

function addPoliceBlock(block, buildings, collisions) {
  const w = 32;
  const d = 44;
  const h = 13.5;
  const x = block.cx + 8;
  const z = block.cz;
  buildings.push({
    x, z, w, d, h,
    palette: 'mid', roof: 'flat', district: block.district,
    special: 'police', color: 0xe4dccb, block: `${block.i}:${block.j}`,
  });
  collisions.push({ x, z, w: w + 0.7, d: d + 0.7 });
  return {
    x, z, w, d, h,
    sign: { x: x - w / 2 - 0.15, y: 9.2, z, w: 15, h: 2.6 },
    forecourt: { x: block.cx - 14, z, w: 14, d: 40 },
    bays: [-9, 0, 9],
  };
}

function makePond(block, rng, index) {
  return {
    x: block.cx + rng.range(-7, 7),
    z: block.cz + rng.range(-7, 7),
    r: rng.range(6.5, 9.5),
    index,
  };
}

function makePlaza(block, rng, palms) {
  for (let n = 0; n < 8; n += 1) {
    const angle = (n / 8) * Math.PI * 2 + 0.4;
    palms.push({
      x: block.cx + Math.cos(angle) * 16,
      z: block.cz + Math.sin(angle) * 16,
      height: rng.range(8, 12.5),
      lean: rng.range(-0.07, 0.07),
      spin: rng.range(0, 6.28),
    });
  }
  return {
    x: block.cx,
    z: block.cz,
    w: GRID.blockSize,
    d: GRID.blockSize,
    fountain: { x: block.cx, z: block.cz, r: 6.5 },
  };
}

function scatterParkTrees(block, rng, trees, pond) {
  for (let n = 0; n < 14; n += 1) {
    const x = block.cx + rng.range(-18, 18);
    const z = block.cz + rng.range(-18, 18);
    if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 2.5) continue;
    trees.push({ x, z, scale: rng.range(0.85, 1.35), kind: 'round', spin: rng.range(0, 6.28) });
  }
}

// A row of street trees down the kerb of every third block edge.
function addSidewalkTrees(block, rng, trees) {
  if (!rng.chance(0.34)) return;
  const along = block.cx + rng.range(-12, 12);
  const side = rng.sign();
  trees.push({
    x: along,
    z: block.cz + side * (HALF_BLOCK - 1.6),
    scale: rng.range(0.7, 1.0),
    kind: 'round',
    spin: rng.range(0, 6.28),
  });
}

function addLamps(lamps) {
  for (let z = -288; z <= 288; z += 26) {
    lamps.push({ x: -7.4, z, rot: Math.PI / 2 });
    lamps.push({ x: 7.4, z, rot: -Math.PI / 2 });
  }
  for (let x = -288; x <= 288; x += 34) {
    if (Math.abs(x) < 12) continue;
    lamps.push({ x, z: -7.4, rot: 0 });
    lamps.push({ x, z: 7.4, rot: Math.PI });
  }
}

// Street furniture: hydrants, bins, benches and planters on the kerb, so the pavement has
// something on it besides poles. Every prop is a few boxes, drawn from one instanced mesh
// per kind, and the whole list is generated here so the scene builder only has to draw it.
const PROP_KINDS = ['hydrant', 'bin', 'bench', 'planter', 'bin', 'planter', 'hydrant', 'bench'];

function addStreetClutter(rng, lamps, props) {
  const nearLamp = (x, z, radius) => lamps.some(
    (lamp) => Math.abs(lamp.x - x) < radius && Math.abs(lamp.z - z) < radius,
  );

  // Both kerbs of Kestrel Avenue, between the lamp posts, the length of the street.
  for (let z = -276; z <= 276; z += 11.5) {
    for (const side of [-1, 1]) {
      const x = side * 7.15 + rng.range(-0.3, 0.3);
      const pz = z + rng.range(-2.4, 2.4);
      if (nearLamp(x, pz, 1.9)) continue;
      props.push({
        x,
        z: pz,
        rot: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        kind: rng.pick(PROP_KINDS),
      });
    }
  }

  // The same treatment down Cannery Row, where the crew job plays out.
  for (let x = -234; x <= -66; x += 11) {
    for (const side of [-1, 1]) {
      const px = x + rng.range(-2.2, 2.2);
      const z = 60 + side * 6.7;
      if (nearLamp(px, z, 1.9)) continue;
      props.push({ x: px, z, rot: side > 0 ? Math.PI : 0, kind: rng.pick(PROP_KINDS) });
    }
  }
}

function buildCoast(rng, trees, palms) {
  for (let n = 0; n < 54; n += 1) {
    palms.push({
      x: rng.range(COAST.shoreX + 8, COAST.sandEndX - 14),
      z: rng.range(-292, 292),
      height: rng.range(7, 12),
      lean: rng.range(-0.12, 0.12),
      spin: rng.range(0, 6.28),
    });
  }
  const docks = [];
  const boats = [];
  const dockX0 = COAST.waterStartX + 6;
  const dockX1 = COAST.waterStartX + 62;
  for (let z = COAST.marinaZ0; z <= COAST.marinaZ1; z += 34) {
    docks.push({ x: (dockX0 + dockX1) / 2, z, w: dockX1 - dockX0, d: 6 });
    for (let side = -1; side <= 1; side += 2) {
      if (rng.chance(0.25)) continue;
      boats.push({
        x: dockX0 + rng.range(10, 46),
        z: z + side * 5.4,
        rot: rng.chance(0.5) ? 0 : Math.PI,
        length: rng.range(5.5, 9),
        color: rng.pick([0xf4f2ea, 0xe8e2d2, 0xcfd8dd, 0xf0d7b6]),
      });
    }
  }
  for (let n = 0; n < 10; n += 1) {
    trees.push({
      x: rng.range(COAST.shoreX + 4, COAST.shoreX + 20),
      z: rng.range(-290, 290),
      scale: rng.range(0.9, 1.2),
      kind: 'round',
      spin: rng.range(0, 6.28),
    });
  }
  return { docks, boats, shoreX: COAST.shoreX, sandEndX: COAST.sandEndX };
}

function buildRoadGraph(xs, zs) {
  const nodes = [];
  for (let i = 0; i < LINE_COUNT; i += 1) {
    for (let j = 0; j < LINE_COUNT; j += 1) {
      nodes.push({ x: xs[i].x, z: zs[j].z, i, j });
    }
  }
  const edges = [];
  const out = nodes.map(() => []);
  const push = (a, b, ax, az, bx, bz, avenue) => {
    const index = edges.length;
    edges.push({ a, b, ax, az, bx, bz, avenue });
    out[a].push(index);
  };
  for (let i = 0; i < LINE_COUNT; i += 1) {
    for (let j = 0; j < LINE_COUNT; j += 1) {
      const here = i * LINE_COUNT + j;
      const avenue = xs[i].x === 0;
      if (j < LINE_COUNT - 1) {
        const south = i * LINE_COUNT + (j + 1);
        push(here, south, xs[i].x, zs[j].z, xs[i].x, zs[j + 1].z, avenue);
        push(south, here, xs[i].x, zs[j + 1].z, xs[i].x, zs[j].z, avenue);
      }
      if (i < LINE_COUNT - 1) {
        const east = (i + 1) * LINE_COUNT + j;
        push(here, east, xs[i].x, zs[j].z, xs[i + 1].x, zs[j].z, false);
        push(east, here, xs[i + 1].x, zs[j].z, xs[i].x, zs[j].z, false);
      }
    }
  }
  return { nodes, edges, out };
}

function summariseBlocks(blocks, buildings) {
  const byBlock = new Map();
  for (const b of buildings) {
    if (!byBlock.has(b.block)) byBlock.set(b.block, []);
    byBlock.get(b.block).push(b);
  }
  return blocks.map((block) => {
    const list = byBlock.get(`${block.i}:${block.j}`) || [];
    const maxHeight = list.reduce((m, b) => Math.max(m, b.h), 0);
    const avgHeight = list.length
      ? list.reduce((s, b) => s + b.h, 0) / list.length
      : 0;
    const glass = list.filter((b) => b.palette === 'glass').length;
    return {
      cx: block.cx,
      cz: block.cz,
      district: block.district,
      districtName: DISTRICTS[block.district].name,
      kind: block.kind,
      count: list.length,
      maxHeight,
      avgHeight,
      glassRatio: list.length ? glass / list.length : 0,
    };
  });
}

// Scores a candidate viewpoint on the avenue: how much glass tower height sits in
// the forward cone at skyline distance, weighted toward the centre of frame. Towers
// closer than 70 units are ignored, because at that range they fill the frame instead
// of reading as a skyline.
export function findViewpoint(city) {
  const best = { score: -Infinity, x: 3.2, z: 282, heading: Math.PI };
  for (let z = 244; z <= 296; z += 2) {
    for (const offset of [-1.6, 0, 1.6]) {
      for (const turn of [-0.1, -0.05, 0, 0.05, 0.1]) {
        const heading = Math.PI + turn;
        const score = scoreView(city, 3.2 + offset, z, heading);
        if (score > best.score) {
          best.score = score;
          best.x = 3.2 + offset;
          best.z = z;
          best.heading = heading;
        }
      }
    }
  }
  return best;
}

function scoreView(city, px, pz, heading) {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  let score = 0;
  for (const b of city.buildings) {
    const dx = b.x - px;
    const dz = b.z - pz;
    const along = dx * fx + dz * fz;
    if (along < 90 || along > 420) continue;
    const lateral = Math.abs(dx * fz - dz * fx);
    if (lateral > 110) continue;
    const centring = 1 - lateral / 110;
    const band = Math.max(0, 1 - Math.abs(along - 210) / 240);
    const glassBonus = b.palette === 'glass' ? 1.4 : 1;
    score += b.h * centring * centring * band * glassBonus;
  }
  return score;
}
