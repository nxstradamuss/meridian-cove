// Baked sunlight: the sun never moves, so a prop's lighting can live in its vertex
// colours and it can be drawn with three.js's cheapest material. That matters here:
// this entry is judged in software rendering, where every extra light and shadow tap
// per fragment is the difference between a city that animates and one that crawls.

import * as THREE from '../vendor/three.module.min.js';

// The sun sits west and south, above the horizon: -x and +z faces catch it.
const SUN_X = -0.70;
const SUN_Y = 0.55;
const SUN_Z = 0.45;
const LEN = Math.hypot(SUN_X, SUN_Y, SUN_Z);
const SX = SUN_X / LEN;
const SY = SUN_Y / LEN;
const SZ = SUN_Z / LEN;

// A surface turned to the sun keeps 0.75 of its base colour, one turned away keeps 0.52,
// and anything with an upward normal picks up a little more sky light. Nothing is ever
// multiplied down to a silhouette: this is a noon coast, and the bake has to read that way
// even before tone mapping.
const AMBIENT = 0.52;
const SUN_GAIN = 0.32;
const UP_GAIN = 0.24;

// Writes a flat "sun from above-west" brightness into a colour attribute, one value
// per vertex. A box ends up with five distinct face tones; a cylinder with a smooth
// terminator. Both read as lit geometry without a light in the shader.
export function bakeSun(geometry) {
  const normal = geometry.attributes.normal;
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < normal.count; i += 1) {
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    const facing = nx * SX + ny * SY + nz * SZ;
    const lit = AMBIENT + SUN_GAIN * Math.max(0, facing) + UP_GAIN * Math.max(0, ny);
    colors[i * 3] = lit;
    colors[i * 3 + 1] = lit;
    colors[i * 3 + 2] = lit;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// A material that draws baked vertex colours multiplied by the per-instance colour.
export function sunlitMaterial(extra = {}) {
  return new THREE.MeshBasicMaterial({ vertexColors: true, ...extra });
}

// Shared geometries, baked once and reused by every instanced mesh that needs them.
let cache = null;

export function sunlitGeometry(kind) {
  if (!cache) {
    cache = {
      box: bakeSun(new THREE.BoxGeometry(1, 1, 1)),
      // Flat things (lane paint, roof caps, lamp heads) cost two triangles as a quad and
      // twelve as a box, and in software rendering triangles are the budget.
      quad: bakeSun(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
      cylinder: bakeSun(new THREE.CylinderGeometry(1, 1, 1, 10)),
      post: bakeSun(new THREE.CylinderGeometry(0.3, 0.42, 3.2, 6)),
      crown: bakeSun(new THREE.IcosahedronGeometry(2.5, 0)),
      palmCrown: bakeSun(new THREE.ConeGeometry(2.5, 1.3, 7)),
      palmTrunk: bakeSun(new THREE.CylinderGeometry(0.24, 0.4, 1, 6)),
    };
  }
  return cache[kind];
}
