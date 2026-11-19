// Tuning constants for Meridian Cove: grid layout, height bands, follow camera, counts,
// both colour palettes, the sun, and every invented name the game uses.

export const CITY_NAME = 'Meridian Cove';
export const CITY_TAGLINE = 'A sunlit coastal city of glass and salt.';
export const RADIO_STATION = 'Tidal 92.7';
export const RADIO_SHOW = 'The Long Shore Breakfast';
export const GANG_NAME = 'The Glass Vipers';
export const AVENUE_NAME = 'Kestrel Avenue';

export const DISTRICTS = {
  core: { name: 'Cobalt Core', blurb: 'glass towers over Kestrel Avenue' },
  midtown: { name: 'Halcyon Rise', blurb: 'offices and rooftop gardens' },
  outer: { name: 'Rustway Flats', blurb: 'cream low-rise and water tanks' },
  shore: { name: 'Sunrow Beach', blurb: 'sand, palms and the marina' },
};

// Street names run west to east (x lines) and north to south (z lines).
export const STREETS_X = [
  'Saltmarsh Way', 'Cormorant Row', 'Salter Street', 'Brine Walk', 'Anchor Row',
  AVENUE_NAME, 'Gullwing Close', 'Ember Street', 'Tideward Way', 'Marram Lane', 'Breakwater Road',
];
export const STREETS_Z = [
  'Northgate', 'Copper Quay', 'Alder Street', 'Fenwick Row', 'Lumen Street',
  'Halcyon Drive', 'Cannery Row', 'Juniper Way', 'Dockyard Lane', 'Southlight Road', 'Dune Road',
];

// The block grid: 11 road lines each way at 60 unit pitch, 10x10 blocks of 48 units.
export const GRID = {
  span: 300,
  pitch: 60,
  roadWidth: 12,
  blockSize: 48,
  columns: 10,
  sidewalkInset: 3,
  laneWidth: 3,
};

export const WORLD_LIMIT = GRID.span + 6;

// The coast sits east of the grid, so the beach and marina never cut into downtown.
export const COAST = {
  shoreX: 300,
  sandEndX: 404,
  waterStartX: 392,
  waterEndX: 1500,
  marinaZ0: 150,
  marinaZ1: 292,
};

export const HEIGHTS = {
  towerMin: 62,
  towerMax: 122,
  midMin: 22,
  midMax: 58,
  lowMin: 8,
  lowMax: 22,
};

export const COUNTS = {
  cars: 84,
  peds: 170,
  lamps: 140,
  trees: 240,
  palms: 64,
  boats: 18,
  particles: 32,
};

export const CAMERA = {
  fov: 62,
  near: 0.4,
  far: 2400,
  back: 19.0,
  height: 30.0,
  lookHeight: 0.0,
  lookAhead: 0,
  ease: 8,
  minHeight: 2.4,
  sensitivity: 0.0028,
  turnSpeed: 2.3,
};

export const PLAYER = {
  walkSpeed: 6.4,
  sprintSpeed: 11.6,
  accel: 30,
  friction: 14,
  radius: 0.55,
  eyeHeight: 1.7,
  maxHealth: 100,
};

// The one colour on the street that means "this is you". Nothing else in the city uses
// magenta, so the ring under the player's feet is unmistakable even in a shrunk frame.
export const PLAYER_MARK = 0xff2ad4;

// The fixed simulation step, shared by the loop and the staged screenshot scenes.
export const STEP = 1 / 60;

// The neutral control intent: no keys held. The loop falls back to it and every staged
// scene starts from it, so a scene only has to say what makes it different.
export const IDLE_INTENT = {
  forward: 0, strafe: 0, turn: 0, look: 0, sprint: false, handbrake: false, firing: false,
};

export const TRAFFIC = {
  minSpeed: 9,
  maxSpeed: 16,
  laneOffset: 3,
};

// One sun for the whole city: west-south, 33 degrees up, so shadows rake east-north
// across Kestrel Avenue and every south facade is lit. It never moves, so its light is
// baked into vertex colours (shading.js) and its shadows into one flat mesh (shadows.js).
export const SUN = {
  dir: [-0.70, 0.55, 0.45],
  shadowColor: 0x2a3950,
  shadowOpacity: 0.34,
  shadowY: 0.42,
  shadowReach: 46,
  shadowMinHeight: 12,
};

export const SKY = {
  fogColor: 0xf9e2c6,
  fogNear: 300,
  fogFar: 780,
};

// Anything past this radius from the player is parked out of the render set: it sits
// well inside the fog, so its absence reads as haze rather than as a hole.
export const CULL = {
  radius: 470,
  shadowRadius: 230,
  step: 12,
};

export const PALETTE = {
  glass: [0x6fa8cc, 0x4f86ad, 0x8dc0da, 0x3d6d94, 0x5f9dbb, 0x9fcfe0, 0x4a7d9e],
  glassRoof: 0x4a5f6b,
  warm: [0xf0c98f, 0xe0a06a, 0xf7dcb8, 0xd4774f, 0xf5c48a, 0xe8b579, 0xcf8a58],
  warmRoof: 0xa85f3e,
  mid: [0xd6cfbe, 0xbfb7a6, 0xe0d9c9, 0xaea695, 0xcac2b1],
  midRoof: 0x7d776d,
  bandGlass: 0x1f4a63,
  bandWarm: 0x6b4a35,
  bandMid: 0x5d564c,
  sidewalk: 0xdcd3c2,
  // Asphalt reads mid-grey in full sun, not near-black: the road has to sit under the
  // shadow overlay without turning into a void.
  road: 0x5f666e,
  paint: 0xf7f4ea,
  paintYellow: 0xf0c542,
  sand: 0xecd6a6,
  wetSand: 0xd2bd92,
  lawn: 0x6f9a52,
  water: 0x1d7f9a,
  treeTrunk: 0x6b4f36,
  treeLeaf: [0x4f7f3a, 0x5f9145, 0x3f6b31, 0x6f9c4c],
  palmTrunk: 0x8a6a45,
  palmLeaf: 0x4d8a3e,
  lampPost: 0x4a4f55,
  helipad: 0x2b2f33,
  policeWall: 0xe4dccb,
  policeTrim: 0x2c3f5c,
};
