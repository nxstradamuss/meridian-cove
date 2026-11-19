// The police: a wanted level from 0 to 5, cruisers that spawn off-screen and drive the
// road graph at the player, ram and box in, officers who get out and shoot, and a level
// that decays once nobody has seen the player for a while. Higher levels send more cars
// and more officers.

import * as THREE from '../vendor/three.module.min.js';
import { createCarBatch, createPersonBatch } from './models.js';
import { clamp, lanePoint, pushOutOfRect, turnToward } from './geometry.js';
import { makeRng } from './random.js';
import { sunlitGeometry, sunlitMaterial } from './shading.js';
import { damagePlayer } from './combat.js';
import { raiseWanted } from './state.js';

const MAX_CRUISERS = 6;
const MAX_OFFICERS = 12;
const LIVERY = 0x1d3f6e;
const CRUISER_COLOR = 0xe8ecec;

export function createPolice(state, scene, combat) {
  const city = state.city;
  const edges = city.roads.edges;
  const cruisers = [];
  const officers = [];
  const rng = makeRng((state.seed ^ 0x7a11ce) >>> 0);

  const batch = scene ? createCarBatch(scene, MAX_CRUISERS, 'police') : null;
  const officerBatch = scene ? createPersonBatch(scene, MAX_OFFICERS, 'officers') : null;
  const lights = scene ? createLightBars(scene, MAX_CRUISERS) : null;
  const white = new THREE.Color(CRUISER_COLOR);
  const cabin = new THREE.Color(0x22282e);
  const livery = new THREE.Color(LIVERY);
  const navy = new THREE.Color(0x22385c);
  const pale = new THREE.Color(0xdfe4e6);

  state.police = { cruisers, officers };

  function cruiserAt(edgeIndex, t) {
    const edge = edges[edgeIndex];
    const point = lanePoint(edge.ax, edge.az, edge.bx, edge.bz, t, 3);
    return {
      edge: edgeIndex,
      t,
      x: point.x,
      z: point.z,
      rot: point.heading,
      speed: 0,
      length: Math.hypot(edge.bx - edge.ax, edge.bz - edge.az) || 1,
      mode: 'ram',
      dropped: false,
      ramCool: 0,
    };
  }

  // A road point 95 to 195 units away, preferably behind the player's shoulder.
  function spawnPoint(player) {
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const edgeIndex = rng.int(0, edges.length - 1);
      const t = rng.range(0.08, 0.92);
      const edge = edges[edgeIndex];
      const point = lanePoint(edge.ax, edge.az, edge.bx, edge.bz, t, 3);
      const dx = point.x - player.x;
      const dz = point.z - player.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 95 || distance > 195) continue;
      const ahead = (dx * fx + dz * fz) / (distance || 1);
      if (ahead > 0.35 && attempt < 18) continue;
      return { edgeIndex, t };
    }
    return null;
  }

  function spawnCruiser(player) {
    if (cruisers.length >= MAX_CRUISERS) return;
    const spot = spawnPoint(player);
    if (!spot) return;
    const cruiser = cruiserAt(spot.edgeIndex, spot.t);
    cruiser.mode = cruisers.length % 3 === 2 ? 'block' : 'ram';
    cruisers.push(cruiser);
  }

  function dropOfficers(cruiser) {
    const count = state.wanted >= 3 ? 2 : 1;
    for (let i = 0; i < count; i += 1) {
      if (officers.length >= MAX_OFFICERS) return;
      const side = cruiser.rot + (i === 0 ? Math.PI / 2 : -Math.PI / 2);
      let x = cruiser.x + Math.sin(side) * 2.4;
      let z = cruiser.z + Math.cos(side) * 2.4;
      for (const rect of city.collisions) {
        const fixed = pushOutOfRect(x, z, 0.5, rect);
        if (fixed) {
          x = fixed.x;
          z = fixed.z;
        }
      }
      officers.push({
        x,
        z,
        rot: cruiser.rot,
        down: 0,
        active: true,
        cooldown: 0.6 + rng.range(0, 0.8),
        flash: 0,
        phase: 0,
      });
    }
    cruiser.dropped = true;
  }

  // Drives the graph toward the player, then switches to a straight ram inside 26 units.
  function steer(cruiser, player, dt) {
    const dx = player.x - cruiser.x;
    const dz = player.z - cruiser.z;
    const distance = Math.hypot(dx, dz);
    const topSpeed = 17 + state.wanted * 1.6;

    if (distance < 26) {
      const desired = Math.atan2(dx, dz);
      cruiser.rot = turnToward(cruiser.rot, desired, 2.4 * dt);
      const goal = cruiser.mode === 'block' && distance < 15 ? 0 : topSpeed;
      const rate = goal > cruiser.speed ? 12 : 20;
      cruiser.speed += clamp(goal - cruiser.speed, -rate * dt, rate * dt);
    } else {
      const edge = edges[cruiser.edge];
      cruiser.t += (cruiser.speed * dt) / cruiser.length;
      if (cruiser.t >= 1) {
        cruiser.t -= 1;
        cruiser.edge = nextEdgeToward(city, cruiser.edge, player.x, player.z);
        cruiser.length = Math.hypot(
          edges[cruiser.edge].bx - edges[cruiser.edge].ax,
          edges[cruiser.edge].bz - edges[cruiser.edge].az,
        ) || 1;
      }
      const lane = lanePoint(
        edges[cruiser.edge].ax, edges[cruiser.edge].az,
        edges[cruiser.edge].bx, edges[cruiser.edge].bz,
        cruiser.t, 3,
      );
      cruiser.rot = turnToward(cruiser.rot, lane.heading, 4.5 * dt);
      cruiser.speed += clamp(topSpeed - cruiser.speed, -10 * dt, 9 * dt);
    }

    cruiser.x += Math.sin(cruiser.rot) * cruiser.speed * dt;
    cruiser.z += Math.cos(cruiser.rot) * cruiser.speed * dt;

    for (const rect of city.collisions) {
      const fixed = pushOutOfRect(cruiser.x, cruiser.z, 1.3, rect);
      if (fixed) {
        cruiser.x = fixed.x;
        cruiser.z = fixed.z;
        cruiser.speed *= 0.4;
      }
    }

    cruiser.ramCool -= dt;
    if (distance < 3.4 && cruiser.speed > 5 && cruiser.ramCool <= 0) {
      damagePlayer(state, 9 + state.wanted * 2, cruiser.x, cruiser.z);
      state.fx.spark((cruiser.x + player.x) / 2, 1.0, (cruiser.z + player.z) / 2, 6);
      cruiser.speed *= 0.25;
      cruiser.ramCool = 1.1;
      raiseWanted(state, Math.max(state.wanted, 1));
    }
  }

  // Officers on foot: close in, then stand and shoot. A building between them and the
  // player stops the shot, so cover means something.
  function stepOfficer(officer, player, dt) {
    officer.flash = Math.max(0, officer.flash - dt);
    if (officer.down > 0) {
      officer.down -= dt;
      if (officer.down <= 0) officer.active = false;
      return;
    }
    const dx = player.x - officer.x;
    const dz = player.z - officer.z;
    const distance = Math.hypot(dx, dz) || 1;
    officer.rot = turnToward(officer.rot, Math.atan2(dx, dz), 4 * dt);

    if (distance > 15) {
      officer.x += (dx / distance) * 3.6 * dt;
      officer.z += (dz / distance) * 3.6 * dt;
      officer.phase += dt * 7;
      for (const rect of city.collisions) {
        const fixed = pushOutOfRect(officer.x, officer.z, 0.45, rect);
        if (fixed) {
          officer.x = fixed.x;
          officer.z = fixed.z;
        }
      }
    } else {
      officer.cooldown -= dt;
      if (officer.cooldown <= 0 && clearShot(city, officer.x, officer.z, player.x, player.z)) {
        combat.fireAt(officer.x, officer.z, player.x, player.z, 'police');
        officer.flash = 0.07;
        officer.cooldown = 1.15 + rng.range(0, 0.9);
      }
    }
  }

  // Places cruisers at fixed points around the player with their officers already out.
  // The normal game spawns them off-screen; this opens a standoff on purpose.
  function deploy(count) {
    const player = state.player;
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    const spots = [[0, 30], [-9, 46], [9, 42], [0, 62], [-11, 70], [11, 74]];
    for (let i = 0; i < count && cruisers.length < MAX_CRUISERS; i += 1) {
      const [side, ahead] = spots[i % spots.length];
      const x = player.x + fx * ahead + fz * side;
      const z = player.z + fz * ahead - fx * side;
      const spot = nearestEdge(city, x, z);
      const cruiser = cruiserAt(spot.index, spot.t);
      cruiser.x = x;
      cruiser.z = z;
      cruiser.rot = player.heading + Math.PI;
      cruiser.speed = 0;
      cruiser.mode = i === 0 ? 'ram' : 'block';
      cruisers.push(cruiser);
      dropOfficers(cruiser);
    }
  }

  function step(dt) {
    const player = state.player;

    if (state.wanted > 0) {
      let nearest = Infinity;
      for (const cruiser of cruisers) {
        nearest = Math.min(nearest, Math.hypot(cruiser.x - player.x, cruiser.z - player.z));
      }
      for (const officer of officers) {
        if (officer.active && officer.down <= 0) {
          nearest = Math.min(nearest, Math.hypot(officer.x - player.x, officer.z - player.z));
        }
      }
      // Out of sight the heat dies down: one star at a time, every seven seconds.
      if (nearest > 85) {
        state.heat += dt;
        if (state.heat > 7) {
          state.wanted = Math.max(0, state.wanted - 1);
          state.heat = 0;
        }
      } else {
        state.heat = 0;
      }

      const wantedCruisers = Math.min(1 + state.wanted, MAX_CRUISERS);
      for (let i = 0; i < 3 && cruisers.length < wantedCruisers; i += 1) spawnCruiser(player);

      for (let i = cruisers.length - 1; i >= 0; i -= 1) {
        const cruiser = cruisers[i];
        steer(cruiser, player, dt);
        const distance = Math.hypot(cruiser.x - player.x, cruiser.z - player.z);
        if (!cruiser.dropped && distance < 30 && cruiser.speed < 6) dropOfficers(cruiser);
        if (distance > 340) cruisers.splice(i, 1);
      }
    } else {
      state.heat = 0;
      // With no stars left the cruisers are recycled out of the world.
      for (let i = cruisers.length - 1; i >= 0; i -= 1) {
        const cruiser = cruisers[i];
        if (Math.hypot(cruiser.x - player.x, cruiser.z - player.z) > 150) cruisers.splice(i, 1);
      }
    }

    for (const officer of officers) {
      if (officer.active) stepOfficer(officer, player, dt);
    }
    for (let i = officers.length - 1; i >= 0; i -= 1) {
      if (!officers[i].active) officers.splice(i, 1);
    }
  }

  function sync() {
    if (!batch) return;
    batch.begin();
    for (const cruiser of cruisers) batch.place(cruiser.x, cruiser.z, cruiser.rot, white, cabin, livery);
    batch.commit();

    if (lights) {
      const phase = Math.floor(state.time * 5) % 2 === 0;
      lights.begin();
      for (const cruiser of cruisers) lights.place(cruiser.x, cruiser.z, cruiser.rot, phase);
      lights.commit();
    }

    officerBatch.begin();
    for (const officer of officers) {
      if (!officer.active || officer.down > 0) continue;
      const bob = Math.abs(Math.sin(officer.phase)) * 0.06;
      officerBatch.place(officer.x, officer.z, officer.rot, officer.flash > 0 ? pale : navy, bob, 0, 1);
    }
    officerBatch.commit();
  }

  return { cruisers, officers, step, sync, spawnCruiser, deploy };
}

// The nearest road segment to a point, as an edge index and a position along it.
function nearestEdge(city, x, z) {
  let best = { index: 0, t: 0.5 };
  let bestDistance = Infinity;
  for (let index = 0; index < city.roads.edges.length; index += 1) {
    const edge = city.roads.edges[index];
    const dx = edge.bx - edge.ax;
    const dz = edge.bz - edge.az;
    const len2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - edge.ax) * dx + (z - edge.az) * dz) / len2, 0, 1);
    const px = edge.ax + dx * t;
    const pz = edge.az + dz * t;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = { index, t };
    }
  }
  return best;
}

// Follows the graph toward the player: at each junction, take the exit whose far end is
// closest to the player. Cheap, and it never drives a cruiser into a dead end.
function nextEdgeToward(city, edgeIndex, targetX, targetZ) {
  const edge = city.roads.edges[edgeIndex];
  const options = city.roads.out[edge.b];
  if (!options.length) return edgeIndex;
  let best = options[0];
  let bestDistance = Infinity;
  for (const index of options) {
    const candidate = city.roads.edges[index];
    if (candidate.b === edge.a) continue;
    const d = Math.hypot(candidate.bx - targetX, candidate.bz - targetZ);
    if (d < bestDistance) {
      bestDistance = d;
      best = index;
    }
  }
  return best;
}

// Walks the straight line in a few samples: a wall in the way blocks the shot.
function clearShot(city, x, z, tx, tz) {
  for (let i = 1; i < 5; i += 1) {
    const t = i / 5;
    const px = x + (tx - x) * t;
    const pz = z + (tz - z) * t;
    for (const rect of city.collisions) {
      if (Math.abs(px - rect.x) < rect.w / 2 && Math.abs(pz - rect.z) < rect.d / 2) return false;
    }
  }
  return true;
}

// Two small boxes on the roof, one red and one blue. Only the lit one is drawn, so the
// bar flickers red, blue, red, blue.
function createLightBars(scene, capacity) {
  const red = new THREE.InstancedMesh(sunlitGeometry('box'), sunlitMaterial({ color: 0xff5a5a }), capacity);
  const blue = new THREE.InstancedMesh(sunlitGeometry('box'), sunlitMaterial({ color: 0x6ab0ff }), capacity);
  for (const mesh of [red, blue]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    scene.add(mesh);
  }
  red.name = 'lightbar-red';
  blue.name = 'lightbar-blue';
  const dummy = new THREE.Object3D();
  let redCount = 0;
  let blueCount = 0;

  return {
    begin() {
      redCount = 0;
      blueCount = 0;
    },
    place(x, z, rot, phase) {
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const side = phase ? -0.6 : 0.6;
      dummy.position.set(x + cos * side + sin * -0.3, 1.68, z - sin * side + cos * -0.3);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.set(0.62, 0.18, 0.52);
      dummy.updateMatrix();
      if (phase) {
        red.setMatrixAt(redCount, dummy.matrix);
        redCount += 1;
      } else {
        blue.setMatrixAt(blueCount, dummy.matrix);
        blueCount += 1;
      }
    },
    commit() {
      red.count = redCount;
      blue.count = blueCount;
      red.visible = redCount > 0;
      blue.visible = blueCount > 0;
      red.instanceMatrix.needsUpdate = true;
      blue.instanceMatrix.needsUpdate = true;
    },
  };
}
