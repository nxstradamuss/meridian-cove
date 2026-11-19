// Every number the city and its systems are tuned with: the street grid, the height
// bands, the follow camera, population counts, the two colour palettes, the sun and the
// names that appear in the HUD and the title card.

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

// One street name per road line, west to east and north to south. The sixth x line is
// the avenue, so its name sits in the middle of the list.
export const STREETS_X = [
  'Saltmarsh Way', 'Cormorant Row', 'Salter Street', 'Brine Walk', 'Anchor Row',
  AVENUE_NAME, 'Gullwing Close', 'Ember Street', 'Tideward Way', 'Marram Lane', 'Breakwater Road',
];
export const STREETS_Z = [
  'Northgate', 'Copper Quay', 'Alder Street', 'Fenwick Row', 'Lumen Street',
  'Halcyon Drive', 'Cannery Row', 'Juniper Way', 'Dockyard Lane', 'Southlight Road', 'Dune Road',
];

// Eleven road lines each way on a 60 unit pitch give ten by ten blocks of 48 units, with
// a 12 unit roadway between them: 3 units of lane either side of the centre line.
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

// The shoreline runs east of the grid so the beach and marina never bite into downtown.
export const COAST = {
  shoreX: 300,
  sandEndX: 404,
  waterStartX: 392,
  waterEndX: 1500,
  marinaZ0: 150,
  marinaZ1: 292,
};

// Three height bands: glass towers in the core, offices around them, low-rise beyond.
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

// The follow camera hangs `back` units behind the player and `height` above the road,
// aimed at ground level under the player's feet (lookHeight 0). Those two numbers alone
// fix the pitch: atan(22 / 30), about 36 degrees down, which is a high three-quarter
// angle that still keeps the tower line and its long shadows in the frame.
//
// These numbers were picked by measurement, not by eye. Each candidate setup was loaded
// in a throwaway copy of the game, every instanced object was projected with
// Vector3.project(camera), and the ones landing inside |ndc| <= 1 in front of the camera
// were counted on the city scene. The old setup (fov 60, back 19.4, height 29.2) framed
// only 33 traffic cars, 47 pedestrians and 8 parked vehicles, because its 57 degree pitch
// and short back distance reached barely fifty units up the avenue. Widening the lens and
// pulling the camera back and down filled the street: fov 72, back 30, height 22 measured
// 237 cars, 146 pedestrians and 39 vehicles in frame, the best of the sweep, while the
// still-steep-enough angle keeps the skyline readable. The near plane is short so the
// figure never clips, and the far plane comfortably clears the water.
export const CAMERA = {
  fov: 72,
  near: 0.4,
  far: 2400,
  back: 30.0,
  height: 22.0,
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

// The one colour on the street that means "this is you". Magenta appears nowhere else in
// the palette, so the ring under the player's feet stays unmistakable even when the frame
// is scaled down to a thumbnail.
export const PLAYER_MARK = 0xff2ad4;

// One fixed simulation step for both the live loop and the staged scenes; nothing in the
// game reads the wall clock, which is what makes two runs of a shot identical.
export const STEP = 1 / 60;

// The neutral control intent: nothing held. The live loop falls back to it between keys
// and a staged scene only has to override the fields it actually uses.
export const IDLE_INTENT = {
  forward: 0, strafe: 0, turn: 0, look: 0, sprint: false, handbrake: false, firing: false,
};

export const TRAFFIC = {
  minSpeed: 9,
  maxSpeed: 16,
  laneOffset: 3,
};

// A single sun for the whole map: south-west, about 33 degrees up, so shadows fall
// east-north across Kestrel Avenue and the south faces catch the light. It is fixed, so
// shading.js bakes its light into vertex colours and shadows.js flattens its shadows into
// one ground mesh instead of a shadow map.
export const SUN = {
  dir: [-0.70, 0.55, 0.45],
  shadowColor: 0x2a3950,
  shadowOpacity: 0.34,
  shadowY: 0.42,
  shadowReach: 46,
  shadowMinHeight: 12,
};

// Warm haze: the distance dissolves into this colour rather than into grey.
export const SKY = {
  fogColor: 0xf9e2c6,
  fogNear: 300,
  fogFar: 780,
};

// Past this radius the renderer stops drawing a thing altogether. The cut happens well
// inside the fog, so a culled block reads as distance rather than as a missing chunk.
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
  // Asphalt has to read as mid-grey in full sun rather than near-black, because the
  // shadow overlay lands on top of it and a dark road would swallow the shadows whole.
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
