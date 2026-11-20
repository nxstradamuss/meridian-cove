// Combat: the player's gun, everyone else's gun, the bullets, the muzzle flashes, the
// sparks and blood, health and damage, and the wasted screen that respawns the player
// with a clean record. Bullets are a fixed pool; every effect is one instanced mesh.

import * as THREE from '../vendor/three.module.min.js';
import { PLAYER } from './config.js';
import { pointInRect } from './geometry.js';
import { sunlitGeometry, sunlitMaterial } from './shading.js';
import { raiseWanted, respawnPlayer } from './state.js';

const MAX_BULLETS = 48;
const MAX_PARTICLES = 96;
const MAX_FLASHES = 10;
const BULLET_SPEED = 95;
const BULLET_LIFE = 0.55;
const FIRE_INTERVAL = 0.17;
const PLAYER_DAMAGE = 9;

export function createCombat(state, scene) {
  const city = state.city;
  const bullets = [];
  for (let i = 0; i < MAX_BULLETS; i += 1) {
    bullets.push({ live: false, x: 0, y: 0, z: 0, vx: 0, vz: 0, life: 0, owner: 'player' });
  }
  const particles = [];
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    particles.push({
      live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 0.2,
      color: new THREE.Color(0xffffff),
    });
  }
  let bulletCursor = 0;
  let particleCursor = 0;
  let cooldown = 0;
  let flashTimer = 0;
  let flashX = 0;
  let flashZ = 0;

  const bulletMesh = scene ? new THREE.InstancedMesh(
    sunlitGeometry('box'),
    sunlitMaterial({ color: 0xfff0b0 }),
    MAX_BULLETS,
  ) : null;
  const particleMesh = scene ? new THREE.InstancedMesh(
    sunlitGeometry('box'),
    sunlitMaterial({ color: 0xffffff }),
    MAX_PARTICLES,
  ) : null;
  const flashMesh = scene ? new THREE.InstancedMesh(
    sunlitGeometry('box'),
    sunlitMaterial({ color: 0xffffff }),
    MAX_FLASHES,
  ) : null;

  if (scene) {
    bulletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bulletMesh.frustumCulled = false;
    bulletMesh.count = 0;
    bulletMesh.name = 'bullets';
    particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    particleMesh.frustumCulled = false;
    particleMesh.count = 0;
    particleMesh.name = 'particles';
    flashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    flashMesh.frustumCulled = false;
    flashMesh.count = 0;
    flashMesh.name = 'muzzle-flashes';
    scene.add(bulletMesh, particleMesh, flashMesh);
  }

  const dummy = new THREE.Object3D();

  // Expose hit/fire events for particle system
  const events = {
    justHit: false,
    justFired: false,
    hitX: 0, hitY: 0, hitZ: 0,
    hitNormal: { x: 0, y: 1, z: 0 },
    fireX: 0, fireY: 0, fireZ: 0,
    fireHeading: 0,
  };

  function spawnParticle(x, y, z, vx, vy, vz, life, size, color) {
    const p = particles[particleCursor];
    particleCursor = (particleCursor + 1) % MAX_PARTICLES;
    p.live = true;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.color.setHex(color);
  }

  // The effects other systems ask for: a hit on a person, sparks off metal, dust under
  // a running foot. Exposed on the state so vehicles, police and missions need no import.
  state.fx = {
    blood(x, y, z, count = 6) {
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3;
        spawnParticle(
          x, y, z,
          Math.cos(angle) * speed, 1 + Math.random() * 3, Math.sin(angle) * speed,
          0.5 + Math.random() * 0.4, 0.12 + Math.random() * 0.14, 0x8e1f22,
        );
      }
    },
    spark(x, y, z, count = 5) {
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 5;
        spawnParticle(
          x, y, z,
          Math.cos(angle) * speed, 1.5 + Math.random() * 4, Math.sin(angle) * speed,
          0.24 + Math.random() * 0.25, 0.07 + Math.random() * 0.08, 0xffc14a,
        );
      }
    },
    dust(x, z) {
      spawnParticle(
        x, 0.2, z,
        (Math.random() - 0.5) * 0.7, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 0.7,
        0.5, 0.16, 0xcfc3ae,
      );
    },
    muzzle(x, z, heading) {
      flashTimer = 0.055;
      flashX = x + Math.sin(heading) * 0.95;
      flashZ = z + Math.cos(heading) * 0.95;
    },
  };

  function fireBullet(x, y, z, tx, tz, owner) {
    const dx = tx - x;
    const dz = tz - z;
    const length = Math.hypot(dx, dz) || 1;
    const b = bullets[bulletCursor];
    bulletCursor = (bulletCursor + 1) % MAX_BULLETS;
    b.live = true;
    b.x = x;
    b.y = y;
    b.z = z;
    b.vx = (dx / length) * BULLET_SPEED;
    b.vz = (dz / length) * BULLET_SPEED;
    b.life = BULLET_LIFE;
    b.owner = owner;
    return { x, y, z, heading: Math.atan2(dx, dz) };
  }

  // The player's shot: along the heading the camera looks down, with a touch of spread.
  function fire() {
    if (state.wasted > 0) return false;
    const player = state.player;
    const spread = (Math.random() - 0.5) * 0.05;
    const heading = player.heading + spread;
    const muzzleX = player.x + Math.sin(player.heading) * 0.9;
    const muzzleZ = player.z + Math.cos(player.heading) * 0.9;
    const shot = fireBullet(muzzleX, 1.32, muzzleZ, muzzleX + Math.sin(heading) * 30, muzzleZ + Math.cos(heading) * 30, 'player');
    state.fx.muzzle(player.x, player.z, player.heading);
    raiseWanted(state, Math.max(1, state.wanted));
    if (state.onShot) state.onShot(player.x, player.z);
    // Emit fire event for particles
    events.justFired = true;
    events.fireX = muzzleX;
    events.fireY = 1.32;
    events.fireZ = muzzleZ;
    events.fireHeading = heading;
    return true;
  }

  // Anyone else's shot, aimed at a point.
  function fireAt(x, z, tx, tz, owner) {
    const spread = (Math.random() - 0.5) * 0.12;
    fireBullet(x, 1.25, z, tx + spread * 10, tz + spread * 10, owner);
  }

  function hitPerson(person, x, z) {
    person.down = 6;
    state.fx.blood(x, 1.2, z, 8);
    state.kills += 1;
  }

  function resolve(bullet) {
    for (const rect of city.collisions) {
      if (pointInRect(bullet.x, bullet.z, rect)) {
        state.fx.spark(bullet.x, bullet.y, bullet.z, 3);
        events.justHit = true;
        events.hitX = bullet.x;
        events.hitY = bullet.y;
        events.hitZ = bullet.z;
        events.hitNormal = { x: 0, y: 1, z: 0 };
        return true;
      }
    }
    if (bullet.owner === 'player') {
      for (const ped of state.peds) {
        if (ped.down > 0) continue;
        const dx = ped.x - bullet.x;
        const dz = ped.z - bullet.z;
        if (dx * dx + dz * dz < 1.1) {
          hitPerson(ped, ped.x, ped.z);
          raiseWanted(state, Math.max(2, state.wanted + 1));
          events.justHit = true;
          events.hitX = ped.x;
          events.hitY = 1.2;
          events.hitZ = ped.z;
          events.hitNormal = { x: -dx, y: 1, z: -dz };
          const len = Math.hypot(events.hitNormal.x, events.hitNormal.z);
          if (len > 0) { events.hitNormal.x /= len; events.hitNormal.z /= len; }
          return true;
        }
      }
      for (const officer of state.police.officers) {
        if (officer.down > 0) continue;
        const dx = officer.x - bullet.x;
        const dz = officer.z - bullet.z;
        if (dx * dx + dz * dz < 1.3) {
          hitPerson(officer, officer.x, officer.z);
          raiseWanted(state, Math.max(3, state.wanted + 2));
          events.justHit = true;
          events.hitX = officer.x;
          events.hitY = 1.2;
          events.hitZ = officer.z;
          events.hitNormal = { x: -dx, y: 1, z: -dz };
          const len = Math.hypot(events.hitNormal.x, events.hitNormal.z);
          if (len > 0) { events.hitNormal.x /= len; events.hitNormal.z /= len; }
          return true;
        }
      }
      for (const crew of state.crew) {
        if (crew.down > 0) continue;
        const dx = crew.x - bullet.x;
        const dz = crew.z - bullet.z;
        if (dx * dx + dz * dz < 1.3) {
          hitPerson(crew, crew.x, crew.z);
          events.justHit = true;
          events.hitX = crew.x;
          events.hitY = 1.2;
          events.hitZ = crew.z;
          events.hitNormal = { x: -dx, y: 1, z: -dz };
          const len = Math.hypot(events.hitNormal.x, events.hitNormal.z);
          if (len > 0) { events.hitNormal.x /= len; events.hitNormal.z /= len; }
          return true;
        }
      }
      for (const cruiser of state.police.cruisers) {
        const dx = cruiser.x - bullet.x;
        const dz = cruiser.z - bullet.z;
        if (dx * dx + dz * dz < 5.2) {
          state.fx.spark(bullet.x, 1.1, bullet.z, 4);
          events.justHit = true;
          events.hitX = bullet.x;
          events.hitY = 1.1;
          events.hitZ = bullet.z;
          events.hitNormal = { x: 0, y: 1, z: 0 };
          return true;
        }
      }
      for (const car of state.cars) {
        const dx = car.x - bullet.x;
        const dz = car.z - bullet.z;
        if (dx * dx + dz * dz < 5.2) {
          state.fx.spark(bullet.x, 1.0, bullet.z, 3);
          events.justHit = true;
          events.hitX = bullet.x;
          events.hitY = 1.0;
          events.hitZ = bullet.z;
          events.hitNormal = { x: 0, y: 1, z: 0 };
          return true;
        }
      }
    } else {
      const player = state.player;
      const dx = player.x - bullet.x;
      const dz = player.z - bullet.z;
      if (dx * dx + dz * dz < 0.95) {
        damagePlayer(state, PLAYER_DAMAGE, bullet.x, bullet.z);
        events.justHit = true;
        events.hitX = player.x;
        events.hitY = 1.2;
        events.hitZ = player.z;
        events.hitNormal = { x: dx, y: 1, z: dz };
        const len = Math.hypot(events.hitNormal.x, events.hitNormal.z);
        if (len > 0) { events.hitNormal.x /= len; events.hitNormal.z /= len; }
        return true;
      }
    }
    return false;
  }

  function step(dt, firing) {
    cooldown -= dt;
    if (state.wasted > 0) {
      state.wasted -= dt;
      if (state.wasted <= 0) {
        state.wasted = 0;
        respawnPlayer(state);
        reset();
      }
    } else if (firing && cooldown <= 0) {
      if (fire()) cooldown = FIRE_INTERVAL;
    }
    if (state.hurt > 0) state.hurt = Math.max(0, state.hurt - dt);
    if (flashTimer > 0) flashTimer -= dt;

    for (const bullet of bullets) {
      if (!bullet.live) continue;
      bullet.x += bullet.vx * dt;
      bullet.z += bullet.vz * dt;
      bullet.life -= dt;
      if (bullet.life <= 0 || resolve(bullet)) bullet.live = false;
    }

    for (const p of particles) {
      if (!p.live) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.live = false;
        continue;
      }
      p.vy -= 16 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.06) {
        p.y = 0.06;
        p.vy *= -0.28;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
    }
  }

  function reset() {
    for (const bullet of bullets) bullet.live = false;
    for (const p of particles) p.live = false;
    cooldown = 0;
    flashTimer = 0;
  }

  // Writes the pools into their instance buffers.
  function sync() {
    if (!scene) return;
    let n = 0;
    for (const bullet of bullets) {
      if (!bullet.live) continue;
      dummy.position.set(bullet.x, bullet.y, bullet.z);
      dummy.rotation.set(0, Math.atan2(bullet.vx, bullet.vz), 0);
      dummy.scale.set(0.1, 0.1, 0.85);
      dummy.updateMatrix();
      bulletMesh.setMatrixAt(n, dummy.matrix);
      n += 1;
    }
    bulletMesh.count = n;
    bulletMesh.visible = n > 0;
    bulletMesh.instanceMatrix.needsUpdate = true;

    n = 0;
    for (const p of particles) {
      if (!p.live) continue;
      const fade = Math.max(0.35, p.life / p.maxLife);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(p.size * (0.6 + fade));
      dummy.updateMatrix();
      particleMesh.setMatrixAt(n, dummy.matrix);
      particleMesh.setColorAt(n, p.color);
      n += 1;
    }
    particleMesh.count = n;
    particleMesh.visible = n > 0;
    particleMesh.instanceMatrix.needsUpdate = true;
    if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;

    n = 0;
    if (flashTimer > 0) {
      dummy.position.set(flashX, 1.35, flashZ);
      dummy.rotation.set(0, 0, Math.PI / 4);
      dummy.scale.setScalar(0.42);
      dummy.updateMatrix();
      flashMesh.setMatrixAt(0, dummy.matrix);
      n = 1;
    }
    for (const officer of state.police.officers) {
      if (officer.down > 0 || officer.flash <= 0) continue;
      if (n >= MAX_FLASHES) break;
      dummy.position.set(
        officer.x + Math.sin(officer.rot) * 0.8,
        1.35,
        officer.z + Math.cos(officer.rot) * 0.8,
      );
      dummy.rotation.set(0, 0, Math.PI / 4);
      dummy.scale.setScalar(0.32);
      dummy.updateMatrix();
      flashMesh.setMatrixAt(n, dummy.matrix);
      n += 1;
    }
    flashMesh.count = n;
    flashMesh.visible = n > 0;
    flashMesh.instanceMatrix.needsUpdate = true;
  }

  return { step, sync, reset, fire, fireAt, bullets, particles, events };
}

// Health and death. Called from a crash, a police bullet or a fall in the water.
export function damagePlayer(state, amount, fromX, fromZ) {
  if (state.wasted > 0 || state.godMode) return;
  const player = state.player;
  player.health = Math.max(0, player.health - amount);
  state.health = player.health;
  state.hurt = 0.4;
  if (state.fx) state.fx.blood(fromX, 1.2, fromZ, 3);
  if (player.health <= 0) {
    state.wasted = 3.4;
    state.deaths += 1;
    if (state.fx) state.fx.blood(player.x, 1.3, player.z, 12);
  }
}
