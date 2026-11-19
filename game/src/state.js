// The world state: the city, the player, and the shared data every system reads and
// writes — traffic, the crowd, police, the cars the player can steal, crew, the wanted
// level, money, the clock and the current mission. The systems that own each of those
// live in their own files; this one only builds and resets the container.

import { PLAYER } from './config.js';
import { buildCity } from './city.js';

export function createWorld(seed) {
  const state = {
    seed,
    cityVersion: 0,
    city: null,
    player: null,
    cars: [],
    peds: [],
    vehicles: [],
    crew: [],
    police: { cruisers: [], officers: [] },
    wanted: 0,
    money: 250,
    clock: 9 * 3600 + 20 * 60,
    health: PLAYER.maxHealth,
    hurt: 0,
    wasted: 0,
    heat: 0,
    kills: 0,
    deaths: 0,
    driving: null,
    speed: 0,
    mission: null,
    time: 0,
    // Set by the screenshot scenes so a staged standoff cannot end in a wasted screen.
    godMode: false,
    // Effects are owned by combat.js; these no-ops keep every system safe without it.
    fx: { blood() {}, spark() {}, dust() {}, muzzle() {} },
    onShot: null,
    reset(nextSeed) {
      applyReset(state, nextSeed);
    },
  };
  applyReset(state, seed);
  return state;
}

function applyReset(state, seed) {
  state.seed = seed;
  state.city = buildCity(seed);
  state.cityVersion += 1;
  state.time = 0;
  state.wanted = 0;
  state.money = 250;
  state.clock = 9 * 3600 + 20 * 60;
  state.health = PLAYER.maxHealth;
  state.hurt = 0;
  state.wasted = 0;
  state.heat = 0;
  state.kills = 0;
  state.deaths = 0;
  state.driving = null;
  state.speed = 0;
  state.godMode = false;
  state.cars = [];
  state.peds = [];
  state.vehicles = [];
  state.crew = [];
  state.police = { cruisers: [], officers: [] };
  state.player = {
    x: state.city.spawn.x,
    z: state.city.spawn.z,
    heading: state.city.spawn.heading,
    vx: 0,
    vz: 0,
    phase: 0,
    health: PLAYER.maxHealth,
  };
  state.mission = {
    id: null,
    title: 'Free roam',
    objective: 'Kestrel Avenue, Sunrow Beach and the docks are yours',
    stage: 'idle',
    done: false,
    marker: null,
  };
}

// Crime raises the wanted level and resets the clock the police use to give up.
export function raiseWanted(state, level) {
  const next = Math.min(5, Math.max(0, level));
  if (next > state.wanted) state.wanted = next;
  state.heat = 0;
}

export function addMoney(state, amount) {
  state.money += amount;
}

export function respawnPlayer(state) {
  const player = state.player;
  player.x = state.city.spawn.x;
  player.z = state.city.spawn.z;
  player.heading = state.city.spawn.heading;
  player.vx = 0;
  player.vz = 0;
  player.health = PLAYER.maxHealth;
  player.phase = 0;
  state.health = PLAYER.maxHealth;
  state.hurt = 0;
  state.wanted = 0;
  state.heat = 0;
  state.driving = null;
  state.speed = 0;
  if (state.police) {
    state.police.cruisers.length = 0;
    state.police.officers.length = 0;
  }
}

// Kept beside the state so a probe can read the same numbers the HUD shows.
export function describeState(state) {
  return {
    wanted: state.wanted,
    money: state.money,
    health: Math.round(state.health),
    cars: state.cars.length,
    peds: state.peds.length,
    cruisers: state.police.cruisers.length,
    officers: state.police.officers.length,
    kills: state.kills,
    deaths: state.deaths,
    player: { x: state.player.x, z: state.player.z, heading: state.player.heading },
  };
}
