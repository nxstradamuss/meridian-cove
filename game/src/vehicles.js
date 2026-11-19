// Cars the player can steal and drive. They sit at the kerb until F puts the player
// behind the wheel, then accelerate, brake, reverse, steer (tightly at low speed, wide at
// high speed), lay skid marks, hit buildings and water, and hurt the player when they
// crash into something. While driving, the player's pose becomes the car's pose, so the
// third-person camera and the world culler follow the car for free.

import * as THREE from '../vendor/three.module.min.js';
import { COAST } from './config.js';
import { clamp, pushOutOfRect, wrapAngle } from './geometry.js';
import { createCarBatch } from './models.js';
import { sunlitGeometry } from './shading.js';
import { damagePlayer } from './combat.js';
import { raiseWanted } from './state.js';

const MAX_CARS = 16;
const MAX_MARKS = 160;
const ACCEL = 11;
const BRAKE = 20;
const REVERSE_MAX = 9;
const TOP_SPEED = 31;
const CAR_RADIUS = 1.25;

// Kerbside bays down both sides of the avenue, plus two on the cross streets. The first
// one is the gold coupe a mission asks for; the player starts a few steps from it.
const BAYS = [
  { x: -5.0, z: 272, heading: Math.PI, color: 0xd9a53a, tag: 'coupe' },
  { x: 5.0, z: 250, heading: 0, color: 0x2f5f8a },
  { x: -5.0, z: 232, heading: Math.PI, color: 0xb8443c },
  { x: 5.0, z: 206, heading: 0, color: 0xe4ded0 },
  { x: -5.0, z: 186, heading: Math.PI, color: 0x3f6b4a },
  { x: 5.0, z: 158, heading: 0, color: 0x8f9298 },
  { x: -5.0, z: 138, heading: Math.PI, color: 0xc4553f },
  { x: 5.0, z: 110, heading: 0, color: 0x6d7f9a },
  { x: -5.0, z: 90, heading: Math.PI, color: 0xe0a23c },
  { x: 5.0, z: 62, heading: 0, color: 0xa8c4cc },
  { x: -5.0, z: 42, heading: Math.PI, color: 0x2b2f36 },
  { x: 5.0, z: 14, heading: 0, color: 0xd8d3c6 },
  { x: -64, z: 6, heading: Math.PI / 2, color: 0xb8443c },
  { x: -124, z: 6, heading: Math.PI / 2, color: 0x2f5f8a },
];

export function createVehicles(state, scene) {
  const city = state.city;
  const vehicles = [];
  const batch = scene ? createCarBatch(scene, MAX_CARS, 'vehicles') : null;
  const marks = scene ? createSkidMarks(scene) : null;

  function spawnAll() {
    vehicles.length = 0;
    for (const bay of BAYS) {
      const color = new THREE.Color(bay.color);
      vehicles.push({
        x: bay.x,
        z: bay.z,
        heading: bay.heading,
        speed: 0,
        steer: 0,
        color,
        cabin: color.clone().multiplyScalar(0.32),
        parked: true,
        tag: bay.tag || null,
        bob: 0,
        skidTimer: 0,
      });
    }
    state.vehicles = vehicles;
  }

  function nearest(x, z, radius) {
    let best = null;
    let bestD2 = radius * radius;
    for (const car of vehicles) {
      const dx = car.x - x;
      const dz = car.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = car;
      }
    }
    return best;
  }

  function enter(state, car) {
    if (!car || state.driving) return false;
    car.parked = false;
    state.driving = car;
    state.player.x = car.x;
    state.player.z = car.z;
    state.player.heading = car.heading;
    return true;
  }

  function exit(state) {
    const car = state.driving;
    if (!car) return;
    const side = car.heading + Math.PI / 2;
    state.player.x = car.x + Math.sin(side) * 2.6;
    state.player.z = car.z + Math.cos(side) * 2.6;
    state.player.heading = car.heading;
    state.player.vx = 0;
    state.player.vz = 0;
    car.speed = 0;
    car.parked = true;
    state.driving = null;
    state.speed = 0;
  }

  // A building or the sea ends the run: bounce, damage and a spray of sparks.
  function collide(car, state) {
    let hit = false;
    for (const rect of city.collisions) {
      const fixed = pushOutOfRect(car.x, car.z, CAR_RADIUS, rect);
      if (!fixed) continue;
      car.x = fixed.x;
      car.z = fixed.z;
      hit = true;
    }
    if (car.x > COAST.waterStartX - 6) {
      car.x = COAST.waterStartX - 6;
      hit = true;
    }
    const b = city.bounds;
    if (car.x < b.minX + 1 || car.x > b.maxX - 1) {
      car.x = clamp(car.x, b.minX + 1, b.maxX - 1);
      hit = true;
    }
    if (car.z < b.minZ + 1 || car.z > b.maxZ - 1) {
      car.z = clamp(car.z, b.minZ + 1, b.maxZ - 1);
      hit = true;
    }
    if (!hit) return;
    const impact = Math.abs(car.speed);
    if (impact > 4) {
      damagePlayer(state, Math.min(38, impact * 1.7), car.x, car.z);
      state.fx.spark(car.x + Math.sin(car.heading) * 2, 0.8, car.z + Math.cos(car.heading) * 2, 6);
    }
    car.speed *= -0.22;
  }

  function bumpTraffic(car, state) {
    const others = state.cars;
    for (let i = 0; i < others.length; i += 1) {
      const other = others[i];
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 7.3) continue;
      const d = Math.sqrt(d2) || 1;
      const push = (2.7 - d) * 0.5;
      other.x += (dx / d) * push;
      other.z += (dz / d) * push;
      other.speed *= 0.35;
      if (Math.abs(car.speed) > 5) {
        damagePlayer(state, Math.min(14, Math.abs(car.speed) * 0.5), car.x, car.z);
        state.fx.spark((car.x + other.x) / 2, 0.9, (car.z + other.z) / 2, 4);
      }
      car.speed *= 0.6;
    }
  }

  function runOver(car, state) {
    if (Math.abs(car.speed) < 5) return;
    for (const ped of state.peds) {
      if (ped.down > 0) continue;
      const dx = ped.x - car.x;
      const dz = ped.z - car.z;
      if (dx * dx + dz * dz > 3.2) continue;
      ped.down = 6;
      state.fx.blood(ped.x, 1.1, ped.z, 10);
      raiseWanted(state, Math.max(2, state.wanted + 1));
      state.kills += 1;
      car.speed *= 0.85;
    }
  }

  function step(dt, intent, state) {
    const car = state.driving;
    if (car) {
      const throttle = intent.forward || 0;
      const steerIn = (intent.strafe || 0) + (intent.turn || 0) * 0.55;
      car.steer += (clamp(steerIn, -1, 1) - car.steer) * Math.min(1, dt * 9);

      if (throttle > 0) {
        car.speed += ACCEL * dt;
      } else if (throttle < 0) {
        car.speed -= (car.speed > 0.5 ? BRAKE : ACCEL * 0.7) * dt;
      } else {
        const drag = Math.abs(car.speed) * 0.85 + 1.2;
        car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), drag * dt);
      }
      if (intent.handbrake) {
        car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 26 * dt);
      }
      car.speed = clamp(car.speed, -REVERSE_MAX, TOP_SPEED);

      // Steering bites at walking pace and eases off as the car gains speed, so a slow
      // car turns inside its own length and a fast one carves a long arc.
      const bite = clamp(Math.abs(car.speed) / 3.5, 0, 1);
      const omega = car.steer * bite * (2.15 - Math.min(0.9, Math.abs(car.speed) * 0.03));
      car.heading = wrapAngle(car.heading + omega * Math.sign(car.speed || 1) * dt);

      car.x += Math.sin(car.heading) * car.speed * dt;
      car.z += Math.cos(car.heading) * car.speed * dt;

      collide(car, state);
      bumpTraffic(car, state);
      runOver(car, state);

      // Skid marks from the rear wheels while the tyres are being worked hard.
      const slipping = Math.abs(car.speed) > 7 && (Math.abs(car.steer) > 0.45 || intent.handbrake);
      car.skidTimer -= dt;
      if (slipping && car.skidTimer <= 0) {
        car.skidTimer = 0.035;
        const cos = Math.cos(car.heading);
        const sin = Math.sin(car.heading);
        for (const side of [-0.8, 0.8]) {
          if (marks) marks.drop(car.x + cos * side - sin * 1.5, car.z - sin * side - cos * 1.5, car.heading);
        }
      }

      state.player.x = car.x;
      state.player.z = car.z;
      state.player.heading = car.heading;
      state.player.vx = 0;
      state.player.vz = 0;
      state.speed = Math.abs(car.speed) * 3.6;
    } else {
      state.speed = 0;
      for (const other of vehicles) other.speed = 0;
    }
  }

  function sync() {
    if (!batch) return;
    batch.begin();
    for (const car of vehicles) batch.place(car.x, car.z, car.heading, car.color, car.cabin, null);
    batch.commit();
  }

  spawnAll();
  return { vehicles, step, sync, spawnAll, nearest, enter, exit };
}

// Skid marks: one instanced quad buffer, written as a ring so old marks disappear under
// new ones instead of growing the buffer.
function createSkidMarks(scene) {
  const mesh = new THREE.InstancedMesh(
    sunlitGeometry('quad'),
    new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x24282e }),
    MAX_MARKS,
  );
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = MAX_MARKS;
  mesh.name = 'skid-marks';
  const dummy = new THREE.Object3D();
  dummy.position.set(0, -50, 0);
  dummy.scale.setScalar(0.001);
  dummy.updateMatrix();
  for (let i = 0; i < MAX_MARKS; i += 1) mesh.setMatrixAt(i, dummy.matrix);
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  let cursor = 0;

  return {
    drop(x, z, rot) {
      dummy.position.set(x, 0.125, z);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.set(0.34, 1, 0.8);
      dummy.updateMatrix();
      mesh.setMatrixAt(cursor, dummy.matrix);
      cursor = (cursor + 1) % MAX_MARKS;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
