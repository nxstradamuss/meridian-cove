// The four staged scenes behind the screenshots: the cover, a police chase, the Vipers'
// job on Cannery Row and a five-star standoff.
//
// Each scene sets the world up, runs the fixed step so traffic, crowd and police settle
// into the pose it wants, and then composes the street for the camera: traffic and
// pedestrians are moved onto the road and pavements that actually project inside the
// viewport, so the frame the harness captures is full of life instead of showing whatever
// happened to be near the spawn point. Nothing here runs during normal play.

import { IDLE_INTENT, STEP } from './config.js';
import { createFramer } from './framing.js';

const IDLE = IDLE_INTENT;

export function createShots(deps) {
  const {
    state, playerModel, follow, traffic, peds, vehicles, police, missions, simulate, setOnFoot,
  } = deps;

  function place(x, z, heading) {
    state.player.x = x;
    state.player.z = z;
    state.player.heading = heading;
    state.player.vx = 0;
    state.player.vz = 0;
    playerModel.place(state.city, state.player);
    follow.place(state.player);
  }

  function run(count, intent) {
    for (let i = 0; i < count; i += 1) simulate(STEP, intent);
  }

  // Puts the figure back where the state says it is and parks the camera behind it, which
  // is what the harness photographs.
  function settle() {
    playerModel.place(state.city, state.player);
    follow.place(state.player);
  }

  // The whole point of this file: fill the frame. The framer projects world points with
  // the camera's own matrices, so only traffic and pedestrians that land inside the
  // viewport (and are not hidden behind a building) are moved.
  function compose({ cars, crowd, near, far, avoid = [] }) {
    const framer = createFramer(follow.camera);
    const moved = traffic.stageCars({ framer, count: cars, near, far, avoid });
    const people = peds.stageCrowd({
      framer,
      count: crowd,
      near: Math.max(9, near - 7),
      far: Math.min(far, 140),
      avoid,
    });
    return { moved, people };
  }

  // The cover: the player on Kestrel Avenue at the chosen viewpoint, with a two-way
  // stream of traffic and a crowd on both kerbs filling the corridor the camera looks down.
  function city() {
    const view = state.city.viewpoint;
    place(view.x, view.z, view.heading);
    run(150, IDLE);
    settle();
    const counts = compose({
      cars: 26,
      crowd: 34,
      near: 18,
      far: 215,
      avoid: [{ x: state.player.x, z: state.player.z, r: 6 }],
    });
    run(3, IDLE);
    settle();
    return counts;
  }

  // The chase: the player in the gold coupe, three cruisers boxed in ahead and the avenue
  // busy in both directions around them.
  function chase() {
    const car = vehicles.vehicles[0];
    car.x = -3;
    car.z = 168;
    car.heading = Math.PI;
    car.speed = 9;
    car.parked = false;
    vehicles.enter(state, car);
    setOnFoot(false);
    state.wanted = 3;
    state.heat = 0;
    state.godMode = true;
    police.deploy(3);
    run(40, { ...IDLE, forward: 1 });
    settle();

    const avoid = police.cruisers.map((cruiser) => ({ x: cruiser.x, z: cruiser.z, r: 7.5 }));
    avoid.push({ x: state.player.x, z: state.player.z, r: 10 });
    const counts = compose({ cars: 20, crowd: 22, near: 17, far: 190, avoid });
    run(3, { ...IDLE, forward: 1 });
    settle();
    return counts;
  }

  // The Vipers' job: the player walks east along Cannery Row into the marker and the crew
  // comes out, with traffic on the street behind them. The approach runs along the road so
  // the follow camera stays in the open street instead of backing into a building.
  function mission() {
    missions.jumpTo(1);
    place(-164, 60, Math.PI / 2);
    state.wanted = 2;
    state.godMode = true;
    run(58, { ...IDLE, forward: 1 });
    run(30, { ...IDLE, firing: true });
    settle();

    const avoid = missions.crew.filter((member) => !member.dead).map(
      (member) => ({ x: member.x, z: member.z, r: 4 }),
    );
    avoid.push({ x: state.player.x, z: state.player.z, r: 5 });
    const counts = compose({ cars: 12, crowd: 16, near: 15, far: 150, avoid });
    run(2, { ...IDLE, firing: true });
    settle();
    return counts;
  }

  // The standoff: five stars, three cruisers, officers on foot, both sides shooting.
  function standoff() {
    missions.jumpTo(2);
    place(16, 222, Math.PI);
    state.wanted = 5;
    state.heat = 0;
    state.godMode = true;
    state.player.health = 68;
    state.health = 68;
    police.deploy(3);
    run(50, { ...IDLE, forward: 1 });
    run(30, { ...IDLE, firing: true });
    settle();

    const avoid = police.cruisers.map((cruiser) => ({ x: cruiser.x, z: cruiser.z, r: 7.5 }));
    for (const officer of police.officers) {
      if (officer.active) avoid.push({ x: officer.x, z: officer.z, r: 3.5 });
    }
    avoid.push({ x: state.player.x, z: state.player.z, r: 6 });
    const counts = compose({ cars: 16, crowd: 20, near: 16, far: 170, avoid });
    run(2, { ...IDLE, firing: true });
    settle();
    return counts;
  }

  return { city, chase, mission, standoff };
}
