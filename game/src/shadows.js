// Bakes the sun's building shadows into flat meshes laid over the street.
//
// The sun never moves, so the shadow of every footprint is fixed. Building them once into
// a few chunked geometries costs a handful of draw calls and no shadow map at all, and
// unlike a shadow map it lands on the road, the sidewalks and the sand alike, which is
// where the eye looks for it. The sun sits west and south, so the shadows rake east and
// north across the avenue.
//
// Chunks exist because a blended overlay is expensive in software rendering: only the
// chunks near the player stay in the draw set.

import * as THREE from '../vendor/three.module.min.js';
import { SUN } from './config.js';

const CHUNK = 120;
const fan = [];
const hull = [];

export function buildGroundShadows(buildings) {
  const length = Math.hypot(SUN.dir[0], SUN.dir[1], SUN.dir[2]);
  const sx = SUN.dir[0] / length;
  const sy = SUN.dir[1] / length;
  const sz = SUN.dir[2] / length;
  // How far a point one unit up slides along the ground before it meets the street.
  const slideX = -sx / sy;
  const slideZ = -sz / sy;

  const cells = new Map();
  const points = [];
  for (const b of buildings) {
    if (b.h < SUN.shadowMinHeight) continue;
    const hw = b.w / 2;
    const hd = b.d / 2;
    // Long shadows are the point of a low sun, but their area is what costs: past a
    // certain length the shadow is a grey wedge nobody reads as a building anyway.
    const reach = Math.min(b.h, SUN.shadowReach);
    const ox = slideX * reach;
    const oz = slideZ * reach;
    points.length = 0;
    points.push(
      [b.x - hw, b.z - hd], [b.x + hw, b.z - hd],
      [b.x + hw, b.z + hd], [b.x - hw, b.z + hd],
      [b.x - hw + ox, b.z - hd + oz], [b.x + hw + ox, b.z - hd + oz],
      [b.x + hw + ox, b.z + hd + oz], [b.x - hw + ox, b.z + hd + oz],
    );
    // The lit ground is the convex hull of the footprint and its slide, so a fan from the
    // first hull point covers it exactly.
    convexHull(points, hull);
    const key = `${Math.floor(b.x / CHUNK)}:${Math.floor(b.z / CHUNK)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { x: Math.floor(b.x / CHUNK) * CHUNK + CHUNK / 2, z: Math.floor(b.z / CHUNK) * CHUNK + CHUNK / 2, tris: [] };
      cells.set(key, cell);
    }
    for (let i = 1; i < hull.length / 2 - 1; i += 1) {
      cell.tris.push(hull[0], hull[1], hull[i * 2], hull[i * 2 + 1], hull[i * 2 + 2], hull[i * 2 + 3]);
    }
  }

  const material = new THREE.MeshBasicMaterial({
    color: SUN.shadowColor,
    transparent: true,
    opacity: SUN.shadowOpacity,
    depthWrite: true,
    // Every shadow lies in the same plane, so a strict depth test lets the first one win
    // and rejects the rest: overlapping shadows blend once instead of four times.
    depthFunc: THREE.LessDepth,
    fog: true,
  });

  const group = new THREE.Group();
  group.name = 'sun-shadows';
  const chunks = [];
  for (const cell of cells.values()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cell.tris), 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = SUN.shadowY;
    mesh.renderOrder = 1;
    group.add(mesh);
    chunks.push({ mesh, x: cell.x, z: cell.z });
  }
  group.userData.chunks = chunks;
  return group;
}

// Keeps only the shadow chunks around the player in the draw set.
export function cullGroundShadows(group, px, pz, radius) {
  const chunks = group.userData.chunks;
  const r2 = radius * radius;
  for (const chunk of chunks) {
    const dx = chunk.x - px;
    const dz = chunk.z - pz;
    chunk.mesh.visible = dx * dx + dz * dz <= r2;
  }
}

// Andrew's monotone chain over at most eight points, writing flat x/z pairs into `out`.
function convexHull(points, out) {
  out.length = 0;
  const sorted = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  for (const p of lower.concat(upper)) out.push(p[0], p[1]);
}
