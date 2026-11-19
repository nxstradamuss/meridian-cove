// The player on foot: a small articulated figure built from boxes with a walk cycle,
// plus acceleration, friction, building and water collision, and respawn.

import * as THREE from '../vendor/three.module.min.js';
import { CAMERA, PLAYER, PLAYER_MARK } from './config.js';
import { clamp, pushOutOfRect, turnToward, wrapAngle } from './geometry.js';
import { bakeSun } from './shading.js';

const SKIN = 0xd8a37a;

// The city has no lights — the sun is baked into vertex colours — so the player is drawn
// with the same baked shading as everything else instead of a lit material that would
// render black.
function shade(color) {
  return new THREE.MeshBasicMaterial({ color, vertexColors: true });
}

export function createPlayerModel(scene) {
  const group = new THREE.Group();

  const shirt = shade(0x2f7f86);
  const trousers = shade(0x2b3242);
  const skin = shade(SKIN);
  const hair = shade(0x3a2a1e);
  const shoe = shade(0x1a1c20);

  const torso = box(0.62, 0.72, 0.36, shirt);
  torso.position.y = 1.16;
  group.add(torso);

  const shoulders = box(0.68, 0.16, 0.38, shirt);
  shoulders.position.y = 1.48;
  group.add(shoulders);

  const head = box(0.36, 0.38, 0.34, skin);
  head.position.y = 1.72;
  group.add(head);

  const cap = box(0.4, 0.12, 0.38, hair);
  cap.position.y = 1.92;
  group.add(cap);

  const armPivots = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.4, 1.44, 0);
    const arm = box(0.15, 0.6, 0.17, shirt);
    arm.position.y = -0.3;
    pivot.add(arm);
    const hand = box(0.15, 0.14, 0.17, skin);
    hand.position.y = -0.64;
    pivot.add(hand);
    group.add(pivot);
    armPivots.push(pivot);
  }

  const legPivots = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.16, 0.86, 0);
    const leg = box(0.2, 0.72, 0.22, trousers);
    leg.position.y = -0.36;
    pivot.add(leg);
    const boot = box(0.22, 0.12, 0.32, shoe);
    boot.position.set(0, -0.76, 0.04);
    pivot.add(boot);
    group.add(pivot);
    legPivots.push(pivot);
  }

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.05, 20),
    new THREE.MeshBasicMaterial({
      map: blobTexture(), transparent: true, opacity: 0.42, depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.07;
  shadow.renderOrder = 2;

  // The player marker: a flat magenta ring under the feet, in a colour nothing else in
  // the city uses, and a solid arrow on the ground showing which way the figure faces.
  // Both hang off the player group, so they follow the walk, the pavement height and the
  // heading without any extra bookkeeping.
  const markerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.5, 26).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: PLAYER_MARK, side: THREE.DoubleSide, fog: false,
    }),
  );
  markerRing.position.y = 0.16;
  markerRing.renderOrder = 3;
  group.add(markerRing);

  const markerArrow = new THREE.Mesh(
    arrowGeometry(),
    new THREE.MeshBasicMaterial({
      color: PLAYER_MARK, side: THREE.DoubleSide, fog: false,
    }),
  );
  markerArrow.position.set(0, 0.17, 1.7);
  markerArrow.renderOrder = 3;
  group.add(markerArrow);

  scene.add(group);
  scene.add(shadow);

  function place(city, player) {
    const y = surfaceHeight(city, player.x, player.z);
    group.position.set(player.x, y, player.z);
    group.rotation.y = player.heading;
    shadow.position.set(player.x, y + 0.07, player.z);
  }

  function step(dt, player, intent, city, effects) {
    const turn = (intent.turn || 0) * CAMERA.turnSpeed * dt;
    player.heading = wrapAngle(player.heading + turn + (intent.look || 0));

    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    const rx = -fz;
    const rz = fx;
    const forward = intent.forward || 0;
    const strafe = intent.strafe || 0;
    const speed = intent.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;

    let wishX = fx * forward + rx * strafe;
    let wishZ = fz * forward + rz * strafe;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }
    const moving = wishLen > 0.01;

    if (moving) {
      player.vx += (wishX * speed - player.vx) * Math.min(1, PLAYER.accel * dt);
      player.vz += (wishZ * speed - player.vz) * Math.min(1, PLAYER.accel * dt);
    } else {
      const damp = Math.max(0, 1 - PLAYER.friction * dt);
      player.vx *= damp;
      player.vz *= damp;
    }

    player.x += player.vx * dt;
    player.z += player.vz * dt;
    collide(player, city);

    const groundSpeed = Math.hypot(player.vx, player.vz);
    player.phase += groundSpeed * dt * 1.85;
    const stride = clamp(groundSpeed / PLAYER.walkSpeed, 0, 1.35);

    const swing = Math.sin(player.phase) * 0.62 * stride;
    legPivots[0].rotation.x = swing;
    legPivots[1].rotation.x = -swing;
    armPivots[0].rotation.x = -swing * 0.8;
    armPivots[1].rotation.x = swing * 0.8;

    const bob = Math.abs(Math.sin(player.phase)) * 0.06 * stride;
    const lean = stride * 0.1;
    group.position.set(
      player.x,
      surfaceHeight(city, player.x, player.z) + bob,
      player.z,
    );
    group.rotation.y = player.heading;
    torso.rotation.x = lean;
    shoulders.rotation.x = lean;

    const shadowY = surfaceHeight(city, player.x, player.z) + 0.07;
    shadow.position.set(player.x, shadowY, player.z);
    shadow.scale.setScalar(1 + bob * 1.2);

    if (effects && stride > 0.45 && Math.sin(player.phase) > 0.94) {
      effects.dust(player.x, player.z);
    }
  }

  return { group, shadow, place, step };
}

function box(w, h, d, material) {
  return new THREE.Mesh(bakeSun(new THREE.BoxGeometry(w, h, d)), material);
}

// A flat triangle lying on the ground, pointing along +z, so the player's facing reads
// from above even when the figure itself is a few pixels tall.
function arrowGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.62, 0, -0.15,
    0.62, 0, -0.15,
    0, 0, 1.15,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 1, 0, 0, 1, 0, 0, 1, 0,
  ], 3));
  geometry.computeBoundingSphere();
  return geometry;
}

// Sidewalks stand 0.36 above the roadway; the model stands on whichever is underfoot.
function surfaceHeight(city, x, z) {
  if (!city) return 0;
  for (const block of city.blocks) {
    if (Math.abs(x - block.cx) <= 24 && Math.abs(z - block.cz) <= 24) return 0.36;
  }
  return 0;
}

function collide(player, city) {
  for (const rect of city.collisions) {
    const fixed = pushOutOfRect(player.x, player.z, PLAYER.radius, rect);
    if (fixed) {
      if (fixed.x !== player.x) player.vx *= 0.15;
      if (fixed.z !== player.z) player.vz *= 0.15;
      player.x = fixed.x;
      player.z = fixed.z;
    }
  }
  const b = city.bounds;
  player.x = clamp(player.x, b.minX, b.maxX);
  player.z = clamp(player.z, b.minZ, b.maxZ);
}

function blobTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(20,16,12,0.85)');
  gradient.addColorStop(0.65, 'rgba(20,16,12,0.35)');
  gradient.addColorStop(1, 'rgba(20,16,12,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
