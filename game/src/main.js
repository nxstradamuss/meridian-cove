// Boots the renderer, builds the city and every system, runs the fixed-step loop in a
// clear order, follows the player on foot or in a car, draws the world and then the HUD.

import * as THREE from '../vendor/three.module.min.js';
import { CITY_NAME, IDLE_INTENT, STEP } from './config.js';
import { createWorld, describeState, respawnPlayer } from './state.js';
import { buildWorld } from './scene3d.js';
import { createFollowCamera } from './camera3d.js';
import { createPlayerModel } from './player.js';
import { createInput } from './input.js';
import { createTraffic } from './traffic.js';
import { createPeds } from './peds.js';
import { createVehicles } from './vehicles.js';
import { createPolice } from './police.js';
import { createCombat } from './combat.js';
import { createMissions } from './missions.js';
import { createShots } from './shots.js';
import { drawHud } from './hud.js';
import { drawPause, drawTitle, drawWasted } from './screens.js';
import { createParticleSystem } from './particles.js';

const IDLE = IDLE_INTENT;

// The screenshot scenes drive themselves: the harness opens ?shot=<name> and takes the
// frame a second later, so each scene holds a scripted intent instead of live keys.
const SHOT_INTENT = {
  city: null,
  chase: { forward: 1, strafe: 0.03 },
  mission: { firing: true },
  standoff: { firing: true },
};

const stageCanvas = document.getElementById('stage');
const hudCanvas = document.getElementById('hud');
const hud = hudCanvas.getContext('2d');

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seed = Number(params.get('seed')) || 1;

// The harness compares two runs of the same scene byte for byte, so a shot page takes its
// muzzle flashes, sparks and shot spread from one fixed sequence instead of the platform's
// random source. Play and title pages keep the real Math.random.
if (shotName) {
  let randomState = (seed * 2654435761) >>> 0;
  Math.random = function random() {
    randomState = (randomState + 0x6d2b79f5) >>> 0;
    let t = randomState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

document.title = `${CITY_NAME} — open city`;

const renderer = new THREE.WebGLRenderer({
  canvas: stageCanvas,
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(1);
// The sun is baked (see shading.js and shadows.js), so there is no shadow map to render
// and no light in any shader.
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const state = createWorld(seed);
const follow = createFollowCamera(window.innerWidth / window.innerHeight);
const input = createInput(stageCanvas);

let world = null;
let playerModel = null;
let traffic = null;
let peds = null;
let vehicles = null;
let police = null;
let combat = null;
let missions = null;
let shots = null;
let particles = null;

let mode = 'title';
let elapsed = 0;
let frames = 0;
let accumulator = 0;
let last = performance.now();
let fpsWindow = 0;
let fpsFrames = 0;

const gta = {
  ready: false,
  stats: null,
  fps: 0,
  renderer,
  view: null,
  restart(nextSeed) {
    state.reset(nextSeed ?? Math.floor(Math.random() * 1e6));
    rebuild();
  },
  setMode(next) {
    mode = next;
  },
};
window.__gta = gta;

// Every system is built against one city, so a restart swaps the whole set together.
function rebuild() {
  const previous = world;
  world = buildWorld(state.city);
  playerModel = createPlayerModel(world.scene);
  combat = createCombat(state, world.scene);
  traffic = createTraffic(state, world.scene);
  peds = createPeds(state, world.scene);
  vehicles = createVehicles(state, world.scene);
  police = createPolice(state, world.scene, combat);
  missions = createMissions(state, world.scene, combat);
  shots = createShots({
    state, playerModel, follow, traffic, peds, vehicles, police, missions, simulate, setOnFoot,
  });
  particles = createParticleSystem(world.scene);
  state.onShot = (x, z) => peds.alert(x, z, 30);

  if (previous) previous.scene.clear();
  playerModel.place(state.city, state.player);
  follow.place(state.player);
  gta.stats = describeCity();
  gta.systems = { traffic, peds, vehicles, police, combat, missions, particles };
}

function describeCity() {
  const stats = state.city.stats;
  return {
    seed: state.seed,
    buildings: stats.buildings,
    towers: stats.towers,
    glass: stats.glass,
    blocks: stats.blocks,
    parks: stats.parks,
    viewpoint: state.city.viewpoint,
  };
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  follow.resize(width, height);

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  hudCanvas.width = Math.round(width * ratio);
  hudCanvas.height = Math.round(height * ratio);
  hudCanvas.style.width = `${width}px`;
  hudCanvas.style.height = `${height}px`;
  gta.pixelRatio = ratio;
}

// One fixed step, in a fixed order: the player, then traffic, the crowd, the police,
// combat and the missions. Each system reads and writes the shared state only.
function simulate(dt, intent) {
  state.time += dt;
  state.clock = (state.clock + dt * 60) % 86400;

  if (state.driving) {
    vehicles.step(dt, intent, state);
    // Wheel dust from driven car
    if (state.speed > 4) {
      const p = state.player;
      particles.emitDust(p.x, p.z, p.heading, state.speed);
    }
    // Exhaust smoke
    if (Math.random() < 0.15) {
      const p = state.player;
      particles.emitSmoke(p.x, p.z, p.heading, 1);
    }
  } else {
    playerModel.step(dt, state.player, intent, state.city, { dust: state.fx.dust });
    state.speed = 0;
    state.health = state.player.health;
  }

  traffic.step(dt, state);
  peds.step(dt, state);
  police.step(dt);
  combat.step(dt, intent.firing);
  missions.step(dt);
  
  // Particle effects from combat
  if (combat.events.justHit) {
    particles.emitSparks(combat.events.hitX, combat.events.hitY, combat.events.hitZ, combat.events.hitNormal);
    combat.events.justHit = false;
  }
  if (combat.events.justFired) {
    particles.emitFlash(combat.events.fireX, combat.events.fireY, combat.events.fireZ, combat.events.fireHeading);
    combat.events.justFired = false;
  }
  
  // Traffic exhaust
  traffic.forEachCar?.((car) => {
    if (car.speed > 2 && Math.random() < 0.05) {
      particles.emitSmoke(car.x, car.z, car.heading, 0.5);
    }
    if (car.speed > 6) {
      particles.emitDust(car.x, car.z, car.heading, car.speed);
    }
  });

  updatePrompt();
  elapsed += dt;
}

function updatePrompt() {
  if (state.wasted > 0) {
    state.prompt = null;
  } else if (state.driving) {
    state.prompt = 'F    GET OUT';
  } else {
    state.prompt = vehicles.nearest(state.player.x, state.player.z, 4.8) ? 'F    GET IN' : null;
  }
}

function syncViews() {
  traffic.sync();
  peds.sync();
  vehicles.sync();
  police.sync();
  combat.sync();
  missions.sync(state.time);
}

function setOnFoot(visible) {
  playerModel.group.visible = visible;
  playerModel.shadow.visible = visible;
}

function toggleCar() {
  if (state.driving) {
    vehicles.exit(state);
    setOnFoot(true);
    playerModel.place(state.city, state.player);
    follow.place(state.player);
  } else {
    const car = vehicles.nearest(state.player.x, state.player.z, 4.8);
    if (car && vehicles.enter(state, car)) {
      setOnFoot(false);
      follow.place(state.player);
    }
  }
}

function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;

  handleModeKeys();
  const scripted = shotName && mode === 'play' ? SHOT_INTENT[shotName] : null;
  const intent = scripted !== undefined && scripted !== null
    ? { ...IDLE, ...scripted }
    : mode === 'play' ? input.intent() : { ...IDLE, look: input.intent().look };

  // A staged shot is composed once in shots.js and then photographed. The loop leaves the
  // pose alone from the first frame on, so the captured frame is the composed one and does
  // not depend on how many frames happened to run before the harness took the picture.
  if (shotName) {
    elapsed += dt;
  } else if (mode === 'play' || mode === 'title') {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      simulate(STEP, intent);
      accumulator -= STEP;
      steps += 1;
    }
    if (accumulator > STEP * 5) accumulator = 0;
    follow.update(state.player, dt);
  } else {
    elapsed += dt;
  }
  input.endStep();

  syncViews();
  world.cull(state);
  // Step particle system
  if (particles) particles.step(dt, state.player.x, state.player.z);
  renderer.render(world.scene, follow.camera);

  hud.setTransform(1, 0, 0, 1, 0, 0);
  hud.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  const ratio = gta.pixelRatio || 1;
  if (mode === 'title') {
    drawTitle(hud, window.innerWidth, window.innerHeight, ratio, elapsed);
  } else {
    drawHud(hud, window.innerWidth, window.innerHeight, ratio, state);
    if (mode === 'pause') drawPause(hud, window.innerWidth, window.innerHeight, ratio, state);
  }
  if (state.wasted > 0 && mode !== 'title') {
    drawWasted(hud, window.innerWidth, window.innerHeight, ratio, state.wasted);
  }

  frames += 1;
  fpsWindow += dt;
  fpsFrames += 1;
  if (fpsWindow >= 0.5) {
    gta.fps = Math.round(fpsFrames / fpsWindow);
    fpsWindow = 0;
    fpsFrames = 0;
  }
  if (shotName && mode === 'play' && frames >= 3) gta.ready = true;
  requestAnimationFrame(frame);
}

function handleModeKeys() {
  if (mode === 'title' && (input.wasPressed('Enter') || input.wasPressed('Space'))) {
    mode = 'play';
    follow.place(state.player);
  } else if (mode === 'play' && input.wasPressed('Escape')) {
    mode = 'pause';
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (mode === 'pause' && (input.wasPressed('Escape') || input.wasPressed('Enter'))) {
    mode = 'play';
    follow.place(state.player);
  } else if (mode === 'play' && input.wasPressed('KeyF')) {
    toggleCar();
  } else if (mode === 'play' && input.wasPressed('KeyR')) {
    state.driving = null;
    respawnPlayer(state);
    setOnFoot(true);
    playerModel.place(state.city, state.player);
    follow.place(state.player);
    combat.reset();
  }
}

// --- The four screenshot scenes -------------------------------------------------------
// The scenes themselves live in shots.js: each one sets the world up, lets the fixed step
// settle it, and then fills the frame with traffic and crowd. This file only decides which
// one to stage when the harness opens ?shot=<name>.

window.addEventListener('resize', resize);

rebuild();
resize();

const SHOTS = { city: 'city', chase: 'chase', mission: 'mission', standoff: 'standoff' };

if (shotName && SHOTS[shotName]) {
  gta.shot = shots[SHOTS[shotName]]();
  mode = 'play';
} else {
  mode = 'title';
}

gta.state = state;
gta.world = world;
gta.follow = follow;
gta.input = input;
gta.playerModel = playerModel;
gta.describe = () => describeState(state);
requestAnimationFrame(frame);
