// Particle system: dust, smoke, sparks, muzzle flash — all GPU-friendly points.
// Uses a single InstancedMesh with a small quad geometry, baked sun colour for shading.
import * as THREE from '../vendor/three.module.min.js';
import { COUNTS, CULL } from './config.js';
import { bakeSun, sunlitMaterial, sunlitGeometry } from './shading.js';

const _dummy = new THREE.Object3D();

const PARTICLE_TYPES = {
  DUST: 0,      // wheel dust behind cars
  SMOKE: 1,     // exhaust, burning
  SPARK: 2,     // gunfire impact
  FLASH: 3,     // muzzle flash
  DEBRIS: 4,    // explosion bits
};

const TYPE_LIFETIME = {
  [PARTICLE_TYPES.DUST]: { min: 0.3, max: 0.8 },
  [PARTICLE_TYPES.SMOKE]: { min: 1.0, max: 2.5 },
  [PARTICLE_TYPES.SPARK]: { min: 0.1, max: 0.3 },
  [PARTICLE_TYPES.FLASH]: { min: 0.03, max: 0.08 },
  [PARTICLE_TYPES.DEBRIS]: { min: 0.5, max: 1.5 },
};

const TYPE_SIZE = {
  [PARTICLE_TYPES.DUST]: { min: 0.3, max: 0.6 },
  [PARTICLE_TYPES.SMOKE]: { min: 0.8, max: 1.8 },
  [PARTICLE_TYPES.SPARK]: { min: 0.08, max: 0.15 },
  [PARTICLE_TYPES.FLASH]: { min: 1.2, max: 2.0 },
  [PARTICLE_TYPES.DEBRIS]: { min: 0.2, max: 0.4 },
};

const TYPE_COLOR = {
  [PARTICLE_TYPES.DUST]: 0xc9bfab,
  [PARTICLE_TYPES.SMOKE]: 0x3a3f44,
  [PARTICLE_TYPES.SPARK]: 0xffaa00,
  [PARTICLE_TYPES.FLASH]: 0xfff8e0,
  [PARTICLE_TYPES.DEBRIS]: 0x6b5d4a,
};

const TYPE_GRAVITY = {
  [PARTICLE_TYPES.DUST]: -0.5,
  [PARTICLE_TYPES.SMOKE]: -1.2,  // rises
  [PARTICLE_TYPES.SPARK]: 9.8,
  [PARTICLE_TYPES.FLASH]: 0,
  [PARTICLE_TYPES.DEBRIS]: 9.8,
};

const TYPE_DRAG = {
  [PARTICLE_TYPES.DUST]: 3.0,
  [PARTICLE_TYPES.SMOKE]: 1.5,
  [PARTICLE_TYPES.SPARK]: 5.0,
  [PARTICLE_TYPES.FLASH]: 0,
  [PARTICLE_TYPES.DEBRIS]: 2.0,
};

function makeParticleGeometry() {
  // Small billboard quad, baked with sun lighting
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  return bakeSun(geo);
}

let sharedGeometry = null;

export function createParticleSystem(scene, capacity = COUNTS.particles) {
  if (!sharedGeometry) sharedGeometry = makeParticleGeometry();

  const material = sunlitMaterial({
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.InstancedMesh(sharedGeometry, material, Math.max(1, capacity));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
  scene.add(mesh);

  // Per-particle data arrays
  const positions = new Float32Array(capacity * 3);
  const velocities = new Float32Array(capacity * 3);
  const lifetimes = new Float32Array(capacity);
  const maxLifetimes = new Float32Array(capacity);
  const sizes = new Float32Array(capacity);
  const types = new Uint8Array(capacity);
  const active = new Uint8Array(capacity);

  let cursor = 0;
  let count = 0;

  function spawn(x, y, z, vx, vy, vz, type, lifetimeMult = 1, sizeMult = 1) {
    const idx = cursor;
    const tl = TYPE_LIFETIME[type];
    const sz = TYPE_SIZE[type];

    positions[idx * 3] = x;
    positions[idx * 3 + 1] = y;
    positions[idx * 3 + 2] = z;
    velocities[idx * 3] = vx;
    velocities[idx * 3 + 1] = vy;
    velocities[idx * 3 + 2] = vz;

    const life = tl.min + Math.random() * (tl.max - tl.min);
    lifetimes[idx] = life * lifetimeMult;
    maxLifetimes[idx] = life * lifetimeMult;

    sizes[idx] = (sz.min + Math.random() * (sz.max - sz.min)) * sizeMult;
    types[idx] = type;
    active[idx] = 1;

    cursor = (cursor + 1) % capacity;
    if (count < capacity) count++;
  }

  // Wheel dust: behind rear wheels of moving cars
  function emitDust(x, z, heading, speed) {
    if (speed < 4) return;
    const count = Math.min(3, Math.floor(speed / 5));
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    // Behind the car
    const bx = x - sin * 2.2;
    const bz = z - cos * 2.2;
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 0.8;
      const vx = -sin * (speed * 0.3 + Math.random() * 2) + spread;
      const vz = -cos * (speed * 0.3 + Math.random() * 2) + spread;
      spawn(bx, 0.15, bz, vx, Math.random() * 0.5, vz, PARTICLE_TYPES.DUST, 1, 0.5 + speed * 0.05);
    }
  }

  // Exhaust smoke from cars
  function emitSmoke(x, z, heading, intensity = 1) {
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    const ex = x - sin * 2.5;
    const ez = z - cos * 2.5;
    spawn(ex, 0.5, ez,
      -sin * 0.5 + (Math.random() - 0.5) * 0.3,
      0.8 + Math.random() * 0.5,
      -cos * 0.5 + (Math.random() - 0.5) * 0.3,
      PARTICLE_TYPES.SMOKE, intensity, 0.7 + intensity * 0.3);
  }

  // Gunfire sparks at impact point
  function emitSparks(x, y, z, normal) {
    const count = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const spread = 1.5;
      spawn(x, y, z,
        normal.x * 2 + (Math.random() - 0.5) * spread,
        Math.abs(normal.y) * 3 + Math.random() * 2,
        normal.z * 2 + (Math.random() - 0.5) * spread,
        PARTICLE_TYPES.SPARK, 0.5, 1);
    }
  }

  // Muzzle flash at gun position
  function emitFlash(x, y, z, heading) {
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    const fx = x + sin * 0.8;
    const fy = y + 1.5;
    const fz = z + cos * 0.8;
    spawn(fx, fy, fz, 0, 0, 0, PARTICLE_TYPES.FLASH, 0.3, 1.5);
  }

  // Explosion debris
  function emitDebris(x, y, z, force = 1) {
    const count = 8 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * Math.PI * 0.5;
      const speed = 5 + Math.random() * 10 * force;
      spawn(x, y + 1, z,
        Math.cos(angle) * Math.cos(pitch) * speed,
        Math.sin(pitch) * speed,
        Math.sin(angle) * Math.cos(pitch) * speed,
        PARTICLE_TYPES.DEBRIS, force, force);
    }
  }

  function step(dt, cameraX, cameraZ) {
    if (count === 0) return;

    const cullR2 = (CULL.radius + 50) ** 2;
    let alive = 0;

    for (let i = 0; i < count; i++) {
      if (!active[i]) continue;

      lifetimes[i] -= dt;
      if (lifetimes[i] <= 0) {
        active[i] = 0;
        continue;
      }

      const t = 1 - lifetimes[i] / maxLifetimes[i];
      const type = types[i];
      const grav = TYPE_GRAVITY[type];
      const drag = TYPE_DRAG[type];

      // Physics
      velocities[i * 3] *= 1 - drag * dt;
      velocities[i * 3 + 1] += grav * dt;
      velocities[i * 3 + 2] *= 1 - drag * dt;

      positions[i * 3] += velocities[i * 3] * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;

      // Ground collision for debris/sparks
      if ((type === PARTICLE_TYPES.DEBRIS || type === PARTICLE_TYPES.SPARK) && positions[i * 3 + 1] < 0.05) {
        positions[i * 3 + 1] = 0.05;
        velocities[i * 3 + 1] *= -0.3;
        velocities[i * 3] *= 0.5;
        velocities[i * 3 + 2] *= 0.5;
      }

      // Cull far particles
      const dx = positions[i * 3] - cameraX;
      const dz = positions[i * 3 + 2] - cameraZ;
      if (dx * dx + dz * dz > cullR2) {
        active[i] = 0;
        continue;
      }

      // Update instance matrix
      const scale = sizes[i] * (type === PARTICLE_TYPES.SMOKE || type === PARTICLE_TYPES.FLASH ? (1 + t * 2) : 1);
      const alpha = 1 - t;
      _dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      _dummy.scale.set(scale, scale, scale);
      _dummy.updateMatrix();
      mesh.setMatrixAt(alive, _dummy.matrix);
      mesh.setColorAt(alive, new THREE.Color(TYPE_COLOR[type]).multiplyScalar(alpha));
      alive++;
    }

    mesh.count = alive;
    mesh.visible = alive > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    count = alive;
  }

  return {
    mesh,
    step,
    emitDust,
    emitSmoke,
    emitSparks,
    emitFlash,
    emitDebris,
    get capacity() { return capacity; },
    get count() { return count; },
  };
}