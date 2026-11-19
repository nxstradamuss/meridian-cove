// Builds the three.js world from the generated city: sky, roads with lane paint,
// instanced buildings and window bands, street furniture, the coast and the two
// landmarks, plus the distance culling that keeps the draw set small as the player moves.
//
// Everything here is drawn with baked light: the sun never moves, so its shading lives in
// vertex colours (shading.js) and its building shadows in one flat mesh (shadows.js). No
// light rig, no shadow map, no per-fragment lighting — which is what makes this city
// animate in software rendering.

import * as THREE from '../vendor/three.module.min.js';
import { COAST, CULL, GRID, PALETTE, SKY } from './config.js';
import { makeRng } from './random.js';
import { bakeSun, sunlitGeometry, sunlitMaterial } from './shading.js';
import { buildGroundShadows, cullGroundShadows } from './shadows.js';
import { mergeBoxes } from './models.js';

const _dummy = new THREE.Object3D();

function instanced(geometry, material, count, opts = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(count, 1));
  mesh.instanceMatrix.setUsage(opts.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
  mesh.frustumCulled = false;
  if (count === 0) mesh.count = 0;
  return mesh;
}

function canvasTexture(width, height, draw, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (opts.smooth === false) {
    // A stretched gradient gains nothing from mipmaps or anisotropy, and in software
    // rendering the sampler's extra taps across a full-screen quad are very expensive.
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 1;
  } else {
    texture.anisotropy = 2;
  }
  return texture;
}

// One placed copy of a shared geometry: position, scale, yaw and a tint.
function piece(x, y, z, sx, sy, sz, rotY, color) {
  _dummy.position.set(x, y, z);
  _dummy.rotation.set(0, rotY || 0, 0);
  _dummy.scale.set(sx, sy, sz);
  _dummy.updateMatrix();
  return {
    x,
    z,
    matrix: _dummy.matrix.clone(),
    rgb: color === undefined ? null : new THREE.Color(color),
  };
}

// A batch of placed copies plus the bookkeeping the culler needs to rewrite it.
function makeSet(scene, geometry, material, items, opts = {}) {
  const mesh = instanced(geometry, material, items.length, opts);
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.matrix);
    if (it.rgb) mesh.setColorAt(i, it.rgb);
  });
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = opts.name || 'set';
  scene.add(mesh);
  return { mesh, items, sort: opts.sort === true };
}

export function buildWorld(city) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY.fogColor);
  scene.fog = new THREE.Fog(SKY.fogColor, SKY.fogNear, SKY.fogFar);

  const sets = [];

  addSkyBackdrop(scene);
  addGround(scene);
  const shadows = buildGroundShadows(city.buildings);
  scene.add(shadows);
  addRoads(scene, city, sets);
  addSidewalks(scene, city, sets);
  addPlazas(scene, city);
  addBuildings(scene, city, sets);
  addStreetFurniture(scene, city, sets);
  addCoast(scene, city, sets);
  addHelipad(scene, city.landmarks.helipad);
  addPoliceStation(scene, city.landmarks.police);

  const cullAt = { x: Infinity, z: Infinity };

  return {
    scene,
    sets,
    // Parks whole batches of geometry that sit beyond the fog-derived radius. Only runs
    // when the player has moved a real distance, so it never costs anything per frame.
    cull(state) {
      const x = state.player.x;
      const z = state.player.z;
      if (Math.abs(x - cullAt.x) < CULL.step && Math.abs(z - cullAt.z) < CULL.step) return false;
      cullAt.x = x;
      cullAt.z = z;
      const r2 = CULL.radius * CULL.radius;
      for (const set of sets) cullSet(set, x, z, r2);
      cullGroundShadows(shadows, x, z, CULL.shadowRadius);
      return true;
    },
  };
}

// Rewrites a set's instance buffers in place so only the near copies are drawn.
function cullSet(set, px, pz, r2) {
  const items = set.items;
  const mesh = set.mesh;
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    const dx = it.x - px;
    const dz = it.z - pz;
    it.d2 = dx * dx + dz * dz;
  }
  // Big solid batches are drawn nearest first: the depth test then throws away the
  // fragments of everything standing behind a building, which is most of a city.
  if (set.sort) items.sort((a, b) => a.d2 - b.d2);
  let n = 0;
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (it.d2 > r2) continue;
    mesh.setMatrixAt(n, it.matrix);
    if (it.rgb) mesh.setColorAt(n, it.rgb);
    n += 1;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// The sky: a clear colour below the backdrop, and one open cylinder carrying the whole
// gradient as vertex colours. A cylinder costs 56 triangles and no texture fetch; a dome
// costs a rasterised sphere, and a full-screen gradient texture costs a sampler across
// every pixel of the frame.
const SKY_RAMP = [
  [-40, 0xffdfb8],
  [40, 0xffd2a4],
  [130, 0xb6d2e6],
  [280, 0x5f9dd2],
  [560, 0x2a72ba],
  [900, 0x18549c],
];

function addSkyBackdrop(scene) {
  const radius = 1450;
  const height = 1000;
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 24, 1, true);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const low = new THREE.Color();
  const high = new THREE.Color();
  const out = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i) + 240;
    let band = 0;
    while (band < SKY_RAMP.length - 2 && y > SKY_RAMP[band + 1][0]) band += 1;
    const [y0, c0] = SKY_RAMP[band];
    const [y1, c1] = SKY_RAMP[band + 1];
    const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
    low.setHex(c0);
    high.setHex(c1);
    out.copy(low).lerp(high, t);
    colors[i * 3] = out.r;
    colors[i * 3 + 1] = out.g;
    colors[i * 3 + 2] = out.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  }));
  mesh.position.y = 240;
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  scene.add(mesh);
}

function addGround(scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3600, 3600),
    new THREE.MeshBasicMaterial({ color: 0xa89b88 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.name = 'ground';
  scene.add(ground);
}

function addRoads(scene, city, sets) {
  const total = GRID.span * 2 + GRID.roadWidth;

  const roads = [];
  for (const line of city.roadsX) roads.push(piece(line.x, 0.05, 0, GRID.roadWidth, 0.1, total));
  for (const line of city.roadsZ) roads.push(piece(0, 0.05, line.z, total, 0.1, GRID.roadWidth));
  // Roads are long strips, so they are never culled: their centres are far from most of
  // their own surface. One instanced mesh of 22 boxes is cheaper than the bookkeeping.
  const roadMesh = instanced(
    sunlitGeometry('box'),
    sunlitMaterial({ color: PALETTE.road }),
    roads.length,
    { name: 'roads' },
  );
  roads.forEach((item, i) => roadMesh.setMatrixAt(i, item.matrix));
  scene.add(roadMesh);

  // Lane paint: white dashes on the cross streets, a double yellow line on the avenue.
  const paint = [];
  for (const line of city.roadsX) {
    const avenue = line.x === 0;
    for (let z = -GRID.span + 4; z < GRID.span - 4; z += 14) {
      if (avenue) {
        paint.push(piece(line.x - 0.5, 0.115, z, 0.3, 0.02, 6.4, 0, PALETTE.paintYellow));
        paint.push(piece(line.x + 0.5, 0.115, z, 0.3, 0.02, 6.4, 0, PALETTE.paintYellow));
      } else {
        paint.push(piece(line.x, 0.115, z, 0.34, 0.02, 5.0, 0, PALETTE.paint));
      }
    }
  }
  for (const line of city.roadsZ) {
    for (let x = -GRID.span + 4; x < GRID.span - 4; x += 14) {
      paint.push(piece(x, 0.115, line.z, 5.0, 0.02, 0.34, 0, PALETTE.paint));
    }
  }
  // Zebra crossings where the avenue meets every cross street.
  for (const line of city.roadsZ) {
    for (const side of [-8.5, 8.5]) {
      for (let x = -5.4; x <= 5.4; x += 2.4) {
        paint.push(piece(x, 0.115, line.z + side, 0.8, 0.02, 3.0, 0, PALETTE.paint));
      }
      for (let z = -5.4; z <= 5.4; z += 2.4) {
        paint.push(piece(side, 0.115, line.z + z, 3.0, 0.02, 0.8, 0, PALETTE.paint));
      }
    }
  }
  sets.push(makeSet(
    scene, sunlitGeometry('quad'), sunlitMaterial({ color: 0xffffff }), paint, { name: 'paint' },
  ));
}

// A pale joint grid for the pavement, tiled across every slab. Without it a 48-unit block
// of pavement is one flat colour filling the bottom third of a street-level frame; the
// joints and the faint grain give the eye a scale to read the city against.
function pavingTexture() {
  const texture = canvasTexture(128, 128, (ctx, w, h) => {
    const rng = makeRng(5150);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i += 1) {
      const v = Math.round(rng.range(226, 255));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 3), rng.range(1, 3));
    }
    ctx.strokeStyle = 'rgba(146, 139, 126, 0.75)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Eight joints across a 48-unit block: paving about six metres square.
  texture.repeat.set(8, 8);
  return texture;
}

function addSidewalks(scene, city, sets) {
  // Parks and plazas are grass and stone, so they keep a plain material; only the
  // pavement carries the joint grid.
  const paving = pavingTexture();
  const slabs = [];
  const grounds = [];
  for (const block of city.blocks) {
    const item = piece(
      block.cx, 0.18, block.cz, GRID.blockSize, 0.36, GRID.blockSize, 0,
      block.parks ? PALETTE.lawn : block.kind === 'plaza' ? 0xddcdae : PALETTE.sidewalk,
    );
    if (block.parks || block.kind === 'plaza') grounds.push(item);
    else slabs.push(item);
  }
  sets.push(makeSet(
    scene, sunlitGeometry('box'), sunlitMaterial({ color: 0xffffff, map: paving }), slabs,
    { name: 'sidewalks' },
  ));
  if (grounds.length) {
    sets.push(makeSet(
      scene, sunlitGeometry('box'), sunlitMaterial({ color: 0xffffff }), grounds,
      { name: 'grounds' },
    ));
  }

  if (city.ponds.length) {
    const ponds = city.ponds.map((pond) => piece(pond.x, 0.34, pond.z, pond.r, 0.12, pond.r));
    sets.push(makeSet(
      scene,
      new THREE.CylinderGeometry(1, 1, 1, 16),
      new THREE.MeshBasicMaterial({ color: 0x2f7f96 }),
      ponds,
      { name: 'ponds' },
    ));
  }
}

function addPlazas(scene, city) {
  for (const plaza of city.plazas) {
    const basin = new THREE.Mesh(
      bakeSun(new THREE.CylinderGeometry(plaza.fountain.r, plaza.fountain.r, 0.7, 20)),
      sunlitMaterial({ color: 0xc9bda6 }),
    );
    basin.position.set(plaza.fountain.x, 0.55, plaza.fountain.z);
    scene.add(basin);

    const water = new THREE.Mesh(
      new THREE.CircleGeometry(plaza.fountain.r - 0.9, 18),
      new THREE.MeshBasicMaterial({ color: 0x2f8fa8 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(plaza.fountain.x, 0.92, plaza.fountain.z);
    scene.add(water);

    const jet = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.7, 2.6, 8),
      new THREE.MeshBasicMaterial({ color: 0xe8f4f8, transparent: true, opacity: 0.75 }),
    );
    jet.position.set(plaza.fountain.x, 2.1, plaza.fountain.z);
    scene.add(jet);
  }
}

function addBuildings(scene, city, sets) {
  const body = sunlitGeometry('box');
  const bodyMaterial = sunlitMaterial({ color: 0xffffff });
  const roofColor = { glass: PALETTE.glassRoof, warm: PALETTE.warmRoof, mid: PALETTE.midRoof };
  const bandColor = { glass: PALETTE.bandGlass, warm: PALETTE.bandWarm, mid: PALETTE.bandMid };
  const palettes = { glass: PALETTE.glass, warm: PALETTE.warm, mid: PALETTE.mid };

  // One batch for every lower block, one for every stepped upper block, one for the roof
  // caps and one for the window bands: four draw calls for the whole downtown, whatever
  // the seed builds. Colours ride on the instances.
  const lower = [];
  const upper = [];
  const roofs = [];
  const bands = [];
  const counts = { glass: 0, warm: 0, mid: 0 };

  for (const building of city.buildings) {
    const key = building.palette;
    const palette = palettes[key];
    const colour = new THREE.Color(building.color || palette[counts[key] % palette.length]);
    counts[key] += 1;

    const base = building.base === undefined ? building.h : Math.min(building.base, building.h);
    lower.push(piece(building.x, base / 2, building.z, building.w, base, building.d, 0, colour));

    const step = building.upper || null;
    if (step && building.h - base > 2) {
      const top = building.h - base;
      upper.push(piece(
        building.x, base + top / 2, building.z, step.w, top, step.d, 0,
        // The upper block reads as the same building, a shade lighter where the sun
        // catches the exposed terrace edge.
        colour.clone().multiplyScalar(1.06),
      ));
    }

    // Only the buildings tall enough to show a roof from street level carry a cap.
    if (building.h > 26) {
      const capW = (step ? step.w : building.w) + 0.7;
      const capD = (step ? step.d : building.d) + 0.7;
      roofs.push(piece(building.x, building.h + 0.4, building.z, capW, 1, capD, 0, roofColor[key]));
    }

    const gap = building.bandGap || 12;
    // Window bands on the wide base, spaced by this building's own rhythm.
    const lowCount = Math.max(2, Math.min(12, Math.round((base - 2.8) / gap)));
    for (let k = 0; k < lowCount; k += 1) {
      const y = 1.4 + ((base - 2.8) * (k + 0.5)) / lowCount;
      bands.push(piece(
        building.x, y, building.z, building.w + 0.5, 0.55, building.d + 0.5, 0, bandColor[key],
      ));
    }
    // And a couple on the setback block, which is what makes the step read as a tower.
    if (step) {
      const top = building.h - base;
      const highCount = Math.max(1, Math.min(3, Math.round((top - 2) / gap)));
      for (let k = 0; k < highCount; k += 1) {
        const y = base + 1.2 + ((top - 2.4) * (k + 0.5)) / highCount;
        bands.push(piece(
          building.x, y, building.z, step.w + 0.5, 0.5, step.d + 0.5, 0, bandColor[key],
        ));
      }
    }
  }

  sets.push(makeSet(scene, body, bodyMaterial, lower, { name: 'buildings', sort: true }));
  if (upper.length) {
    sets.push(makeSet(scene, body, bodyMaterial, upper, { name: 'buildings-step', sort: true }));
  }
  sets.push(makeSet(scene, sunlitGeometry('quad'), bodyMaterial, roofs, { name: 'roofs' }));
  sets.push(makeSet(scene, body, bodyMaterial, bands, { name: 'bands', sort: true }));

  addRooftopDetails(scene, city, sets);
}

function addRooftopDetails(scene, city, sets) {
  const tanks = city.buildings.filter((b) => b.roof === 'tank');
  if (tanks.length) {
    const items = tanks.map((b) => piece(b.x, b.h + 2.4, b.z, 1, 1, 1, 0, 0x9a8f7e));
    sets.push(makeSet(
      scene, sunlitGeometry('cylinder'), sunlitMaterial({ color: 0xffffff }), items,
      { name: 'tanks' },
    ));
  }
  const gardens = city.buildings.filter((b) => b.roof === 'garden');
  if (gardens.length) {
    const items = gardens.map((b) => piece(
      b.x, b.h + 0.9, b.z, b.w * 0.74, 0.6, b.d * 0.74, 0, PALETTE.lawn,
    ));
    sets.push(makeSet(
      scene, sunlitGeometry('box'), sunlitMaterial({ color: 0xffffff }), items,
      { name: 'gardens' },
    ));
  }
}

function addStreetFurniture(scene, city, sets) {
  const poles = city.lamps.map((lamp) => piece(lamp.x, 3.6, lamp.z, 0.22, 7.2, 0.22, 0, PALETTE.lampPost));
  const heads = city.lamps.map((lamp) => piece(
    lamp.x + Math.sin(lamp.rot) * 0.55, 7.25, lamp.z + Math.cos(lamp.rot) * 0.55,
    1.05, 0.3, 0.55, lamp.rot, 0xf6efd8,
  ));
  sets.push(makeSet(scene, sunlitGeometry('box'), sunlitMaterial({ color: 0xffffff }), poles, { name: 'lamps' }));
  sets.push(makeSet(scene, sunlitGeometry('quad'), sunlitMaterial({ color: 0xffffff }), heads, { name: 'lamp-heads' }));

  addStreetClutter(scene, city, sets);

  const trees = city.trees.filter((t) => t.kind === 'round');
  if (trees.length) {
    const trunks = trees.map((tree) => piece(
      tree.x, 1.6 * tree.scale, tree.z, tree.scale, tree.scale, tree.scale, tree.spin, PALETTE.treeTrunk,
    ));
    const crowns = trees.map((tree, i) => piece(
      tree.x, 4.7 * tree.scale, tree.z, tree.scale, tree.scale * 0.86, tree.scale, tree.spin,
      PALETTE.treeLeaf[i % PALETTE.treeLeaf.length],
    ));
    sets.push(makeSet(scene, sunlitGeometry('post'), sunlitMaterial({ color: 0xffffff }), trunks, { name: 'trunks' }));
    sets.push(makeSet(scene, sunlitGeometry('crown'), sunlitMaterial({ color: 0xffffff }), crowns, { name: 'crowns' }));
  }
}

// Street furniture on the kerb: hydrants, bins, benches and planters, all generated by
// city.js and drawn here as five instanced meshes. The pavement has something on it at
// every few metres, which is most of what makes a street read as inhabited.
const PROP_LOOK = {
  hydrant: {
    colour: 0xc0392b,
    parts: [
      { w: 0.36, h: 0.55, d: 0.36, y: 0.28 },
      { w: 0.5, h: 0.14, d: 0.5, y: 0.62 },
      { w: 0.2, h: 0.16, d: 0.2, y: 0.76 },
    ],
  },
  bin: {
    colour: 0x3c4a3e,
    parts: [
      { w: 0.68, h: 0.92, d: 0.68, y: 0.46 },
      { w: 0.78, h: 0.1, d: 0.78, y: 0.97 },
    ],
  },
  bench: {
    colour: 0x8a6a45,
    parts: [
      { w: 1.9, h: 0.12, d: 0.62, y: 0.46 },
      { w: 1.9, h: 0.44, d: 0.1, z: -0.26, y: 0.7 },
      { w: 0.14, h: 0.42, d: 0.5, x: -0.8, y: 0.23 },
      { w: 0.14, h: 0.42, d: 0.5, x: 0.8, y: 0.23 },
    ],
  },
  planter: {
    colour: 0xb2a795,
    parts: [{ w: 1.4, h: 0.6, d: 1.4, y: 0.3 }],
  },
};
const PLANTER_LEAF = { w: 1.16, h: 0.42, d: 1.16, y: 0.78 };

function addStreetClutter(scene, city, sets) {
  const props = city.props || [];
  if (!props.length) return;

  const geometry = {};
  for (const kind of Object.keys(PROP_LOOK)) {
    geometry[kind] = mergeBoxes(PROP_LOOK[kind].parts);
  }
  const leafGeometry = mergeBoxes([PLANTER_LEAF]);

  const items = { hydrant: [], bin: [], bench: [], planter: [] };
  const leaves = [];
  for (const prop of props) {
    const look = PROP_LOOK[prop.kind];
    if (!look) continue;
    // Every prop stands on the pavement, which is 0.36 above the roadway.
    items[prop.kind].push(piece(prop.x, 0.36, prop.z, 1, 1, 1, prop.rot, look.colour));
    if (prop.kind === 'planter') {
      leaves.push(piece(prop.x, 0.36, prop.z, 1, 1, 1, prop.rot, 0x4f7f3a));
    }
  }

  for (const kind of Object.keys(items)) {
    if (!items[kind].length) continue;
    sets.push(makeSet(
      scene, geometry[kind], sunlitMaterial({ color: 0xffffff }), items[kind],
      { name: `props-${kind}` },
    ));
  }
  if (leaves.length) {
    sets.push(makeSet(
      scene, leafGeometry, sunlitMaterial({ color: 0xffffff }), leaves, { name: 'props-planter-leaf' },
    ));
  }
}

function addCoast(scene, city, sets) {
  const sandWidth = COAST.sandEndX - COAST.shoreX;
  const sand = new THREE.Mesh(
    bakeSun(new THREE.BoxGeometry(sandWidth, 0.5, 660)),
    sunlitMaterial({ color: PALETTE.sand }),
  );
  sand.position.set(COAST.shoreX + sandWidth / 2, 0.2, 0);
  scene.add(sand);

  const wet = new THREE.Mesh(
    bakeSun(new THREE.BoxGeometry(18, 0.52, 660)),
    sunlitMaterial({ color: PALETTE.wetSand }),
  );
  wet.position.set(COAST.sandEndX - 9, 0.21, 0);
  scene.add(wet);

  const shimmer = canvasTexture(128, 128, (ctx, w, h) => {
    const rng = makeRng(7717);
    ctx.fillStyle = '#1b6f88';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i += 1) {
      const y = rng.range(0, h);
      const len = rng.range(8, 46);
      const x = rng.range(0, w);
      ctx.strokeStyle = `rgba(214, 246, 255, ${rng.range(0.04, 0.16).toFixed(3)})`;
      ctx.lineWidth = rng.range(0.6, 2.2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y + rng.range(-1.5, 1.5));
      ctx.stroke();
    }
  });
  shimmer.wrapS = THREE.RepeatWrapping;
  shimmer.wrapT = THREE.RepeatWrapping;
  shimmer.repeat.set(28, 64);

  const waterWidth = COAST.waterEndX - COAST.waterStartX;
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(waterWidth, 2600),
    new THREE.MeshBasicMaterial({ color: PALETTE.water, map: shimmer }),
  );
  water.name = 'water';
  water.rotation.x = -Math.PI / 2;
  water.position.set(COAST.waterStartX + waterWidth / 2, 0.12, 0);
  scene.add(water);

  const docks = city.coast.docks.map((dock) => piece(dock.x, 0.6, dock.z, dock.w, 0.5, dock.d, 0, 0x9a7f5c));
  if (docks.length) {
    sets.push(makeSet(scene, sunlitGeometry('box'), sunlitMaterial({ color: 0xffffff }), docks, { name: 'docks' }));
  }

  const hulls = city.coast.boats.map((boat) => piece(boat.x, 0.7, boat.z, 2.8, 1.1, boat.length, boat.rot, boat.color));
  const cabins = city.coast.boats.map((boat) => piece(
    boat.x, 1.5, boat.z - 0.6, 1.9, 0.9, boat.length * 0.42, boat.rot, 0xdce6ea,
  ));
  if (hulls.length) {
    sets.push(makeSet(scene, sunlitGeometry('box'), sunlitMaterial({ color: 0xffffff }), hulls, { name: 'boats' }));
    sets.push(makeSet(scene, sunlitGeometry('box'), sunlitMaterial({ color: 0xffffff }), cabins, { name: 'boat-cabins' }));
  }

  const palmTrunks = city.palms.map((palm) => piece(
    palm.x, palm.height / 2, palm.z, 1, palm.height, 1, palm.spin, PALETTE.palmTrunk,
  ));
  const palmCrowns = city.palms.map((palm) => piece(
    palm.x + palm.lean * palm.height, palm.height + 0.3, palm.z, 1, 1, 1, palm.spin, PALETTE.palmLeaf,
  ));
  if (palmTrunks.length) {
    sets.push(makeSet(scene, sunlitGeometry('palmTrunk'), sunlitMaterial({ color: 0xffffff }), palmTrunks, { name: 'palm-trunks' }));
    sets.push(makeSet(scene, sunlitGeometry('palmCrown'), sunlitMaterial({ color: 0xffffff }), palmCrowns, { name: 'palm-crowns' }));
  }
}

// The rooftop helipad: a dark deck, a white ring, and an H built from three boxes.
function addHelipad(scene, helipad) {
  if (!helipad) return;
  const group = new THREE.Group();

  const deck = new THREE.Mesh(
    bakeSun(new THREE.CylinderGeometry(helipad.padRadius, helipad.padRadius, 0.6, 24)),
    sunlitMaterial({ color: PALETTE.helipad }),
  );
  deck.position.set(helipad.x, helipad.deckY, helipad.z);
  group.add(deck);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(helipad.padRadius - 1.6, helipad.padRadius - 0.6, 24),
    new THREE.MeshBasicMaterial({ color: 0xf4f1e6, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(helipad.x, helipad.deckY + 0.33, helipad.z);
  group.add(ring);

  const white = new THREE.MeshBasicMaterial({ color: 0xf7f4ea });
  const barGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (const bar of [
    { x: -2.3, z: 0, sx: 0.9, sz: 6.4 },
    { x: 2.3, z: 0, sx: 0.9, sz: 6.4 },
    { x: 0, z: 0, sx: 3.7, sz: 0.9 },
  ]) {
    const mesh = new THREE.Mesh(barGeometry, white);
    mesh.scale.set(bar.sx, 0.08, bar.sz);
    mesh.position.set(helipad.x + bar.x, helipad.deckY + 0.35, helipad.z + bar.z);
    group.add(mesh);
  }

  const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  const lampGeometry = new THREE.BoxGeometry(0.6, 0.3, 0.6);
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
    lamp.position.set(
      helipad.x + Math.cos(angle) * (helipad.padRadius - 0.4),
      helipad.deckY + 0.35,
      helipad.z + Math.sin(angle) * (helipad.padRadius - 0.4),
    );
    group.add(lamp);
  }
  scene.add(group);
}

function addPoliceStation(scene, police) {
  if (!police) return;
  const group = new THREE.Group();

  const walls = new THREE.Mesh(
    bakeSun(new THREE.BoxGeometry(police.w, police.h, police.d)),
    sunlitMaterial({ color: PALETTE.policeWall }),
  );
  walls.position.set(police.x, police.h / 2, police.z);
  group.add(walls);

  const band = new THREE.Mesh(
    bakeSun(new THREE.BoxGeometry(police.w + 0.5, 1.1, police.d + 0.5)),
    sunlitMaterial({ color: PALETTE.policeTrim }),
  );
  band.position.set(police.x, 3.4, police.z);
  group.add(band);

  const signTexture = canvasTexture(512, 96, (ctx, w, h) => {
    ctx.fillStyle = '#22344f';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8c05a';
    ctx.fillRect(0, h - 9, w, 9);
    ctx.fillRect(0, 0, w, 6);
    ctx.fillStyle = '#f5f2e8';
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MERIDIAN COVE POLICE', w / 2, h / 2 - 2);
  });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(police.sign.w, police.sign.h),
    new THREE.MeshBasicMaterial({ map: signTexture }),
  );
  sign.position.set(police.sign.x, police.sign.y, police.sign.z);
  sign.rotation.y = -Math.PI / 2;
  group.add(sign);

  const forecourt = new THREE.Mesh(
    bakeSun(new THREE.BoxGeometry(police.forecourt.w, 0.1, police.forecourt.d)),
    sunlitMaterial({ color: 0xbdb4a4 }),
  );
  forecourt.position.set(police.forecourt.x, 0.4, police.forecourt.z);
  group.add(forecourt);

  scene.add(group);
}
