// Flat 2D helpers for the parts of the simulation that live on the ground plane:
// lane maths, distances, clamping and segment tests.

export const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(t) {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

export function dist2(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

export function dist(ax, az, bx, bz) {
  return Math.sqrt(dist2(ax, az, bx, bz));
}

// Wraps an angle into (-PI, PI].
export function wrapAngle(angle) {
  let a = angle % TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

// Turns `from` toward `to` by at most `maxStep` radians.
export function turnToward(from, to, maxStep) {
  const delta = wrapAngle(to - from);
  if (Math.abs(delta) <= maxStep) return to;
  return wrapAngle(from + Math.sign(delta) * maxStep);
}

// Forward vector for a heading where 0 faces +z and PI faces -z.
export function headingVector(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

// Right-hand vector of a forward vector (used for lane offsets).
export function rightVector(fx, fz) {
  return { x: -fz, z: fx };
}

// A point along segment a->b at t in [0,1], pushed `offset` to the right of travel.
export function lanePoint(ax, az, bx, bz, t, offset) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const fx = dx / len;
  const fz = dz / len;
  return {
    x: ax + dx * t - fz * offset,
    z: az + dz * t + fx * offset,
    heading: Math.atan2(fx, fz),
  };
}

export function pointInRect(px, pz, rect) {
  return Math.abs(px - rect.x) <= rect.w / 2 && Math.abs(pz - rect.z) <= rect.d / 2;
}

// Pushes a circle out of an axis-aligned rectangle. Returns the corrected centre.
export function pushOutOfRect(px, pz, radius, rect) {
  const hw = rect.w / 2 + radius;
  const hd = rect.d / 2 + radius;
  const dx = px - rect.x;
  const dz = pz - rect.z;
  if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) return null;
  const overlapX = hw - Math.abs(dx);
  const overlapZ = hd - Math.abs(dz);
  if (overlapX < overlapZ) {
    return { x: rect.x + Math.sign(dx || 1) * hw, z: pz };
  }
  return { x: px, z: rect.z + Math.sign(dz || 1) * hd };
}

// Closest point on segment a->b to p, as {x, z, t}.
export function nearestOnSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / lenSq, 0, 1);
  return { x: ax + dx * t, z: az + dz * t, t };
}

// Segment intersection: returns t along p1->p2, or null when they miss.
export function segmentHit(p1x, p1z, p2x, p2z, p3x, p3z, p4x, p4z) {
  const d1x = p2x - p1x;
  const d1z = p2z - p1z;
  const d2x = p4x - p3x;
  const d2z = p4z - p3z;
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p3x - p1x) * d2z - (p3z - p1z) * d2x) / denom;
  const u = ((p3x - p1x) * d1z - (p3z - p1z) * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}
