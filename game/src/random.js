// A small seeded PRNG (mulberry32) so a seed always rebuilds the identical city.

export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;

  function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    range(min, max) {
      return min + (max - min) * next();
    },
    int(min, max) {
      return Math.floor(min + (max - min + 1) * next());
    },
    pick(list) {
      return list[Math.floor(next() * list.length) % list.length];
    },
    chance(probability) {
      return next() < probability;
    },
    sign() {
      return next() < 0.5 ? -1 : 1;
    },
    // Picks a key from {key: weight} using the given weights.
    weighted(weights) {
      let total = 0;
      for (const key in weights) total += weights[key];
      let roll = next() * total;
      for (const key in weights) {
        roll -= weights[key];
        if (roll <= 0) return key;
      }
      return Object.keys(weights)[0];
    },
  };
}
