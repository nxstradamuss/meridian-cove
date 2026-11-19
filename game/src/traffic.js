// NPC traffic. Cars keep to their lane on the road graph, ease off for the car in front,
// brake for a pedestrian standing in the lane, turn at junctions, and are recycled to a
// road near the player once they fall too far behind. They are drawn as two instanced
// meshes (body and cabin) rewritten in place every frame.
//
// A car's `edge` is always an index into city.roads.edges, never the edge object.

import * as THREE from '../vendor/three.module.min.js';
import { COUNTS, TRAFFIC } from './config.js';
import { clamp, lanePoint, turnToward, wrapAngle } from './geometry.js';
import { makeRng } from './random.js';
import { createCarBatch } from './models.js';
import { makeOccluder } from './framing.js';

// The centre lines of the grid never move for the life of a city, so they are sorted once
// and cached against the city object. A junction query then costs two binary searches
// instead of a scan down every street.
const lineCache = new WeakMap();

function sortedLines(city) {
  let lines = lineCache.get(city);
  if (!lines) {
    const values = (list, key) => list.map((line) => line[key]).sort((a, b) => a - b);
    lines = { xs: values(city.roadsX, 'x'), zs: values(city.roadsZ, 'z') };
    lineCache.set(city, lines);
  }
  return lines;
}

// Distance from `value` to the closest entry of a sorted ascending array.
function nearestLine(sorted, value) {
  const last = sorted.length - 1;
  if (last < 0) return Infinity;
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  // `lo` is the first line at or past the value; the nearest is that one or its neighbour.
  let best = Math.abs(value - sorted[lo]);
  if (lo > 0) best = Math.min(best, Math.abs(value - sorted[lo - 1]));
  return best;
}

// Distance from a point to the nearest junction centre, where a vertical and a horizontal
// centre line cross. A lane runs about three units off its own centre line, so the distance
// to a single line says nothing about how close a car is to a mouth; the crossing does.
// Staged cars are kept at least 11 units clear of a junction, where two crossing lanes
// cannot see each other and a parked body would visibly overlap the other stream.
function junctionDistance(state, x, z) {
  const lines = sortedLines(state.city);
  const dx = nearestLine(lines.xs, x);
  const dz = nearestLine(lines.zs, z);
  return Math.hypot(dx, dz);
}

const CAR_COLORS = [0xe4ded0, 0xb8443c, 0x2f5f8a, 0x3f6b4a, 0xe0a23c, 0x8f9298, 0x2b2f36, 0xa8c4cc, 0xc4553f, 0x6d7f9a];
const MAX_CARS = COUNTS.cars + 12;
const RECYCLE_DISTANCE = 330;
const SPAWN_MIN = 150;
const SPAWN_MAX = 310;
const LANE = TRAFFIC.laneOffset;
const CAR_LENGTH = 4.4;

export function createTraffic(state, scene) {
  const city = state.city;
  const edges = city.roads.edges;
  const rng = makeRng((state.seed ^ 0x2f6e1b3d) >>> 0);
  const cars = [];
  const buckets = edges.map(() => []);
  const avenueEdges = [];
  const crossEdges = [];

  edges.forEach((edge, index) => {
    const midX = (edge.ax + edge.bx) / 2;
    const midZ = (edge.az + edge.bz) / 2;
    if (edge.avenue) avenueEdges.push(index);
    else if (Math.abs(midX) < 210 && Math.abs(midZ) < 210) crossEdges.push(index);
  });
  if (!avenueEdges.length) avenueEdges.push(0);
  if (!crossEdges.length) crossEdges.push(edges.length - 1);

  const batch = scene ? createCarBatch(scene, MAX_CARS, 'traffic') : null;

  function makeCar(edgeIndex, t) {
    const edge = edges[edgeIndex];
    const color = new THREE.Color(rng.pick(CAR_COLORS));
    const speed = rng.range(TRAFFIC.minSpeed, TRAFFIC.maxSpeed);
    const cruise = rng.range(TRAFFIC.minSpeed, TRAFFIC.maxSpeed);
    const turnSeed = rng.int(1, 0x7fffffff);
    const car = {
      edge: edgeIndex,
      t,
      length: Math.hypot(edge.bx - edge.ax, edge.bz - edge.az) || 1,
      speed,
      cruise,
      color,
      // The cabin is the same paint darkened, so the two instanced meshes always agree.
      cabin: color.clone().multiplyScalar(0.32),
      turnSeed,
      x: edge.ax,
      z: edge.az,
      rot: 0,
    };
    place(car, 0);
    return car;
  }

  function place(car, blend) {
    const edge = edges[car.edge];
    const point = lanePoint(edge.ax, edge.az, edge.bx, edge.bz, car.t, LANE);
    car.x = point.x;
    car.z = point.z;
    car.rot = blend > 0 ? turnToward(car.rot, point.heading, blend) : point.heading;
  }

  function spawnAll() {
    cars.length = 0;
    // Four out of five cars belong on the avenue, spread evenly along every avenue edge
    // so the street the camera looks down is the busy one.
    const avenueCount = Math.round(COUNTS.cars * 0.8);
    const perEdge = Math.max(1, Math.ceil(avenueCount / avenueEdges.length));
    for (let i = 0; i < avenueCount; i += 1) {
      const edgeIndex = avenueEdges[i % avenueEdges.length];
      const slot = Math.floor(i / avenueEdges.length);
      const t = clamp((slot + 0.5) / perEdge + rng.range(-0.12, 0.12), 0.03, 0.97);
      cars.push(makeCar(edgeIndex, t));
    }
    for (let i = cars.length; i < COUNTS.cars; i += 1) {
      cars.push(makeCar(rng.pick(crossEdges), rng.range(0.05, 0.95)));
    }
    state.cars = cars;
  }

  // Picks a fresh road slot around the player, far enough out that the swap is not seen.
  function recycle(car, player) {
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const edgeIndex = rng.chance(0.6) ? rng.pick(avenueEdges) : rng.pick(crossEdges);
      const edge = edges[edgeIndex];
      const t = rng.range(0.1, 0.9);
      const point = lanePoint(edge.ax, edge.az, edge.bx, edge.bz, t, LANE);
      const distance = Math.hypot(point.x - player.x, point.z - player.z);
      if (distance < SPAWN_MIN || distance > SPAWN_MAX) continue;
      let clear = true;
      for (const other of cars) {
        if (other === car) continue;
        if (Math.hypot(other.x - point.x, other.z - point.z) < CAR_LENGTH * 1.8) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      car.edge = edgeIndex;
      car.t = t;
      car.speed = car.cruise;
      place(car, 0);
      return;
    }
  }

  // The car nearest ahead of `car` on the same edge, as a gap in world units.
  function gapAhead(car, bucket) {
    let best = Infinity;
    for (let i = 0; i < bucket.length; i += 1) {
      const other = bucket[i];
      if (other === car) continue;
      let delta = other.t - car.t;
      if (delta <= 0) delta += 1;
      if (delta * car.length < best) best = delta * car.length;
    }
    return best;
  }

  // The player standing in the lane ahead: brake for them.
  function obstacleAhead(car, player) {
    const fx = Math.sin(car.rot);
    const fz = Math.cos(car.rot);
    const dx = player.x - car.x;
    const dz = player.z - car.z;
    const along = dx * fx + dz * fz;
    if (along < 0.5 || along > 15) return false;
    const lateral = Math.abs(dx * fz - dz * fx);
    return lateral < 2.6;
  }

  function step(dt, state) {
    const player = state.player;
    for (const bucket of buckets) bucket.length = 0;
    for (const car of cars) buckets[car.edge].push(car);

    for (const car of cars) {
      const edge = edges[car.edge];
      const gap = gapAhead(car, buckets[car.edge]);
      let target = car.cruise;
      // Keep a two-second gap; a car that has stopped ahead stops the whole queue.
      const safe = 6 + car.speed * 1.1;
      if (gap < safe) target = Math.min(target, Math.max(0, (gap - CAR_LENGTH) * 1.4));
      if (obstacleAhead(car, player)) target = Math.min(target, 1.6);

      // Braking is sharper than accelerating, so a queue settles instead of breathing.
      const rate = target < car.speed ? 16 : 6;
      car.speed += clamp(target - car.speed, -rate * dt, rate * dt);
      if (car.speed < 0.05) car.speed = 0;

      car.t += (car.speed * dt) / car.length;
      if (car.t >= 1) {
        car.t -= 1;
        car.edge = nextEdge(city, car.edge, car);
        car.length = Math.hypot(
          edges[car.edge].bx - edges[car.edge].ax,
          edges[car.edge].bz - edges[car.edge].az,
        ) || 1;
      }
      place(car, 5.5 * dt);

      const dx = car.x - player.x;
      const dz = car.z - player.z;
      if (dx * dx + dz * dz > RECYCLE_DISTANCE * RECYCLE_DISTANCE) recycle(car, player);
    }
  }

  function sync() {
    if (!batch) return;
    batch.begin();
    for (const car of cars) batch.place(car.x, car.z, car.rot, car.color, car.cabin, null);
    batch.commit();
  }

  // Staging: move cars that already exist onto road points inside the frame a staged scene
  // is about to capture. The pool, the lanes and the colours stay as they are — only the
  // positions change — so the city keeps its 84 cars and the street the camera looks down
  // is the busy one. Points hidden behind a building are rejected, because a car nobody
  // can see does not fill a frame.
  function stageCars({ framer, count, near = 18, far = 220, gap = 10, margin = 0.9, avoid = [] }) {
    if (!framer || !count) return 0;
    const wanted = Math.min(count, cars.length);
    const blocked = makeOccluder(city, framer.eye);
    const slots = [];

    // Nothing staged may land on the player, on a parked car at the kerb or on a police
    // cruiser: a stream that overlaps what is already standing there reads as a glitch.
    const keepClear = avoid.slice();
    keepClear.push({ x: state.player.x, z: state.player.z, r: 6 });
    for (const car of state.vehicles || []) {
      if (car.parked) keepClear.push({ x: car.x, z: car.z, r: 3 });
    }
    for (const cruiser of (state.police && state.police.cruisers) || []) {
      keepClear.push({ x: cruiser.x, z: cruiser.z, r: 4.5 });
    }

    for (let index = 0; index < edges.length; index += 1) {
      const edge = edges[index];
      const length = Math.hypot(edge.bx - edge.ax, edge.bz - edge.az) || 1;
      if (framer.distance((edge.ax + edge.bx) / 2, (edge.az + edge.bz) / 2) > far + length) continue;
      const steps = Math.max(3, Math.round(length / 4.5));
      for (let s = 0; s <= steps; s += 1) {
        const t = clamp(s / steps, 0.03, 0.97);
        const point = lanePoint(edge.ax, edge.az, edge.bx, edge.bz, t, LANE);
        if (!framer.inFrame(point.x, 0.9, point.z, margin)) continue;
        const d = framer.distance(point.x, point.z);
        if (d < near || d > far) continue;
        // Keep clear of the junctions: cars on two crossing lanes do not see each other,
        // and a staged car parked across a mouth is the one place they visibly overlap.
        if (junctionDistance(state, point.x, point.z) < 11) continue;
        let skip = false;
        for (let a = 0; a < keepClear.length; a += 1) {
          const spot = keepClear[a];
          if (Math.hypot(point.x - spot.x, point.z - spot.z) < (spot.r || 5)) {
            skip = true;
            break;
          }
        }
        if (skip || blocked(point.x, point.z)) continue;
        slots.push({ edge: index, t, x: point.x, z: point.z, heading: point.heading, d });
      }
    }

    // Nearest first, keeping a car's length and a half between neighbours so the stream
    // never stacks two bodies in one place.
    slots.sort((a, b) => a.d - b.d);
    const chosen = [];
    for (const slot of slots) {
      if (chosen.length >= wanted) break;
      let clear = true;
      for (const other of chosen) {
        if (Math.hypot(other.x - slot.x, other.z - slot.z) < gap) {
          clear = false;
          break;
        }
      }
      if (clear) chosen.push(slot);
    }

    for (let i = 0; i < chosen.length; i += 1) {
      const car = cars[i];
      const slot = chosen[i];
      const edge = edges[slot.edge];
      car.edge = slot.edge;
      car.t = slot.t;
      car.length = Math.hypot(edge.bx - edge.ax, edge.bz - edge.az) || 1;
      car.speed = car.cruise;
      place(car, 0);
    }
    return chosen.length;
  }

  spawnAll();
  return { cars, step, sync, spawnAll, stageCars, edges };
}

// Follows the road graph: a car never doubles back, and picks its exit with a cheap hash
// of its own turn seed. Most cars carry straight on, which keeps the avenue busy; the
// rest turn off at the junction.
function nextEdge(city, edgeIndex, car) {
  const edge = city.roads.edges[edgeIndex];
  const options = city.roads.out[edge.b].filter((index) => {
    const candidate = city.roads.edges[index];
    return !(candidate.b === edge.a && candidate.a === edge.b);
  });
  if (!options.length) return edgeIndex;
  car.turnSeed = (car.turnSeed * 1664525 + 1013904223) >>> 0;
  if ((car.turnSeed >>> 9) % 100 < 68) {
    const heading = Math.atan2(edge.bx - edge.ax, edge.bz - edge.az);
    let best = options[0];
    let bestTurn = Infinity;
    for (const index of options) {
      const candidate = city.roads.edges[index];
      const turn = Math.abs(wrapAngle(Math.atan2(candidate.bx - candidate.ax, candidate.bz - candidate.az) - heading));
      if (turn < bestTurn) {
        bestTurn = turn;
        best = index;
      }
    }
    return best;
  }
  return options[car.turnSeed % options.length];
}
