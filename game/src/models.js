// Procedural low-poly models and the instanced batches that draw them.
//
// Every repeated object in the game — pedestrians, crew, traffic cars, police cruisers,
// the cars the player can steal — is one InstancedMesh written in place each frame. The
// geometry here is built once from boxes and baked with the fixed sun (shading.js), so a
// figure costs a handful of triangles and no texture at all.

import * as THREE from '../vendor/three.module.min.js';
import { bakeSun, sunlitGeometry, sunlitMaterial } from './shading.js';

const _dummy = new THREE.Object3D();

function instanced(geometry, material, count) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
  return mesh;
}

// Concatenates boxes into one non-indexed geometry so a person is a single instance.
// Each part is { w, h, d, x, y, z }; the result carries baked vertex colours.
export function mergeBoxes(parts) {
  const positions = [];
  const normals = [];
  let total = 0;
  for (const part of parts) {
    const geometry = new THREE.BoxGeometry(part.w, part.h, part.d).toNonIndexed();
    geometry.translate(part.x || 0, part.y || 0, part.z || 0);
    const position = geometry.attributes.position.array;
    const normal = geometry.attributes.normal.array;
    positions.push(position);
    normals.push(normal);
    total += position.length;
  }
  const merged = new THREE.BufferGeometry();
  const positionOut = new Float32Array(total);
  const normalOut = new Float32Array(total);
  let offset = 0;
  for (let i = 0; i < positions.length; i += 1) {
    positionOut.set(positions[i], offset);
    normalOut.set(normals[i], offset);
    offset += positions[i].length;
  }
  merged.setAttribute('position', new THREE.BufferAttribute(positionOut, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normalOut, 3));
  merged.computeBoundingSphere();
  return bakeSun(merged);
}

// A standing figure 1.84 units tall: legs, torso, shoulders, head and two arms.
let personGeometry = null;

export function figureGeometry() {
  if (!personGeometry) {
    personGeometry = mergeBoxes([
      { w: 0.46, h: 0.86, d: 0.34, y: 0.43 },
      { w: 0.58, h: 0.66, d: 0.38, y: 1.19 },
      { w: 0.84, h: 0.14, d: 0.4, y: 1.46 },
      { w: 0.32, h: 0.32, d: 0.3, y: 1.68 },
      { w: 0.15, h: 0.62, d: 0.17, x: -0.34, y: 1.14 },
      { w: 0.15, h: 0.62, d: 0.17, x: 0.34, y: 1.14 },
    ]);
  }
  return personGeometry;
}

// One instanced mesh of figures. Callers place every visible figure each frame and then
// commit; nothing is allocated per frame and nothing is drawn for an empty batch.
export function createPersonBatch(scene, capacity, name) {
  const mesh = instanced(figureGeometry(), sunlitMaterial({ color: 0xffffff }), capacity);
  mesh.name = name;
  scene.add(mesh);
  let cursor = 0;
  return {
    mesh,
    begin() {
      cursor = 0;
    },
    // bob lifts the figure while walking; lean rolls it into a sprint.
    place(x, z, rot, color, bob = 0, lean = 0, scale = 1) {
      if (cursor >= capacity) return;
      _dummy.position.set(x, bob, z);
      _dummy.rotation.set(0, rot, lean);
      _dummy.scale.set(scale, scale, scale);
      _dummy.updateMatrix();
      mesh.setMatrixAt(cursor, _dummy.matrix);
      mesh.setColorAt(cursor, color);
      cursor += 1;
    },
    commit() {
      mesh.count = cursor;
      mesh.visible = cursor > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}

// A car: bright body, dark glass cabin set back over the rear axle, a dark skirt that
// reads as wheels and shadow, and an optional livery stripe for police cruisers.
const CAR_BODY = { y: 0.62, w: 2.0, h: 0.72, d: 4.4, z: 0 };
const CAR_CABIN = { y: 1.26, w: 1.7, h: 0.6, d: 2.15, z: -0.3 };
const CAR_TRIM = { y: 0.26, w: 2.06, h: 0.34, d: 3.7, z: 0 };
const CAR_STRIPE = { y: 0.52, w: 2.04, h: 0.26, d: 3.2, z: 0 };

// Writes one scaled, yawed box straight into an instance buffer: no Matrix4 allocation.
//
// The buffer is column-major, as three.js Matrix4.elements is: elements 0-3 are the first
// column, 4-7 the second, 8-11 the third and 12-15 the translation. Writing the rows of the
// matrix instead puts the world position into the bottom row, which makes the shader divide
// by a position-dependent w: every car collapses into a screen-wide degenerate triangle
// whose interpolated view depth is enormous, so fog saturates the whole frame.
function setPart(mesh, index, x, z, cos, sin, part, y, color) {
  const m = mesh.instanceMatrix.array;
  const o = index * 16;
  // The cabin sits back along the car's own forward axis, so its offset rotates with it.
  const ox = sin * part.z;
  const oz = cos * part.z;
  m[o] = cos * part.w;
  m[o + 1] = 0;
  m[o + 2] = -sin * part.w;
  m[o + 3] = 0;
  m[o + 4] = 0;
  m[o + 5] = part.h;
  m[o + 6] = 0;
  m[o + 7] = 0;
  m[o + 8] = sin * part.d;
  m[o + 9] = 0;
  m[o + 10] = cos * part.d;
  m[o + 11] = 0;
  m[o + 12] = x + ox;
  m[o + 13] = y;
  m[o + 14] = z + oz;
  m[o + 15] = 1;
  if (color) mesh.setColorAt(index, color);
}

export function createCarBatch(scene, capacity, name) {
  const body = instanced(sunlitGeometry('box'), sunlitMaterial({ color: 0xffffff }), capacity);
  const cabin = instanced(sunlitGeometry('box'), sunlitMaterial({ color: 0xffffff }), capacity);
  const trim = instanced(sunlitGeometry('box'), sunlitMaterial({ color: 0x33383f }), capacity);
  const stripe = instanced(sunlitGeometry('box'), sunlitMaterial({ color: 0xffffff }), capacity);
  body.name = `${name}-body`;
  cabin.name = `${name}-cabin`;
  trim.name = `${name}-trim`;
  stripe.name = `${name}-stripe`;
  scene.add(body, cabin, trim, stripe);

  let cursor = 0;
  let stripes = 0;

  return {
    body,
    cabin,
    begin() {
      cursor = 0;
      stripes = 0;
    },
    // bodyColor, cabinColor and stripeColor are THREE.Color instances owned by the caller.
    place(x, z, rot, bodyColor, cabinColor, stripeColor) {
      if (cursor >= capacity) return;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      setPart(body, cursor, x, z, cos, sin, CAR_BODY, CAR_BODY.y, bodyColor);
      setPart(cabin, cursor, x, z, cos, sin, CAR_CABIN, CAR_CABIN.y, cabinColor);
      setPart(trim, cursor, x, z, cos, sin, CAR_TRIM, CAR_TRIM.y, null);
      if (stripeColor) {
        setPart(stripe, stripes, x, z, cos, sin, CAR_STRIPE, CAR_STRIPE.y, stripeColor);
        stripes += 1;
      }
      cursor += 1;
    },
    commit() {
      body.count = cursor;
      cabin.count = cursor;
      trim.count = cursor;
      stripe.count = stripes;
      body.visible = cursor > 0;
      cabin.visible = cursor > 0;
      trim.visible = cursor > 0;
      stripe.visible = stripes > 0;
      body.instanceMatrix.needsUpdate = true;
      cabin.instanceMatrix.needsUpdate = true;
      trim.instanceMatrix.needsUpdate = true;
      stripe.instanceMatrix.needsUpdate = true;
      if (body.instanceColor) body.instanceColor.needsUpdate = true;
      if (cabin.instanceColor) cabin.instanceColor.needsUpdate = true;
      if (stripe.instanceColor) stripe.instanceColor.needsUpdate = true;
    },
  };
}
