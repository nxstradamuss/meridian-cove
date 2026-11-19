// Missions: three jobs, each with a marker in the world and one line of objective on the
// HUD. Steal the gold coupe and deliver it to the marina; drive to the Vipers' corner on
// Cannery Row and take the crew out; then survive a police response for forty-five
// seconds. Each starts by walking into its marker and pays on completion.

import * as THREE from '../vendor/three.module.min.js';
import { createPersonBatch } from './models.js';
import { sunlitGeometry, sunlitMaterial } from './shading.js';
import { addMoney, raiseWanted } from './state.js';

const MAX_MARKERS = 3;
const CREW_COLOR = 0x8a2f2f;
const MARKER_GOLD = 0xffc14a;
const MARKER_COLOR = new THREE.Color(MARKER_GOLD);

const MISSIONS = [
  {
    id: 'repo',
    title: 'Repo Run',
    start: { x: -5, z: 272, radius: 8 },
    objective: 'Steal the gold coupe parked on Kestrel Avenue',
  },
  {
    id: 'crew',
    title: 'Vipers on Cannery Row',
    start: { x: -150, z: 60, radius: 9 },
    objective: 'Drive west to the Vipers\u2019 corner on Cannery Row',
  },
  {
    id: 'heat',
    title: 'Heat Wave',
    start: { x: 16, z: 210, radius: 9 },
    objective: 'Reach the police forecourt and draw them out',
  },
];

const DELIVERY = { x: 360, z: 230, radius: 10 };
const SURVIVE_SECONDS = 45;

export function createMissions(state, scene, combat) {
  const crew = [];
  const crewBatch = scene ? createPersonBatch(scene, 6, 'crew') : null;
  const markers = scene ? createMarkers(scene, MAX_MARKERS) : null;
  const crewColor = new THREE.Color(CREW_COLOR);
  let index = 0;
  let cleared = 0;

  state.crew = crew;

  function setMission(id, title, objective, stage, marker) {
    state.mission = {
      id,
      title,
      objective,
      stage,
      done: false,
      marker,
      timer: 0,
      progress: '',
    };
  }

  function reset() {
    index = 0;
    cleared = 0;
    crew.length = 0;
    state.banner = null;
    const first = MISSIONS[0];
    setMission(first.id, first.title, first.objective, 'idle', { ...first.start });
  }

  function pass(reward, nextLine) {
    addMoney(state, reward);
    cleared += 1;
    state.mission.done = true;
    state.mission.stage = 'done';
    state.banner = {
      title: 'MISSION PASSED',
      sub: `+$${reward}   ${nextLine}`,
      time: 5,
    };
    index += 1;
    const next = MISSIONS[index];
    if (next) {
      setMission(next.id, next.title, next.objective, 'idle', { ...next.start });
    } else {
      setMission(null, 'Free roam', 'All three jobs are done — the city is yours', 'idle', null);
    }
  }

  function spawnCrew(marker) {
    crew.length = 0;
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2 + 0.6;
      crew.push({
        x: marker.x + Math.cos(angle) * 5,
        z: marker.z + Math.sin(angle) * 5,
        rot: angle + Math.PI,
        down: 0,
        dead: false,
        cooldown: 0.8 + i * 0.4,
        flash: 0,
        phase: 0,
      });
    }
  }

  function stepCrew(dt) {
    const player = state.player;
    for (const member of crew) {
      if (member.dead) continue;
      if (member.down > 0) {
        member.down -= dt;
        if (member.down <= 0) member.dead = true;
        continue;
      }
      member.flash = Math.max(0, member.flash - dt);
      const dx = player.x - member.x;
      const dz = player.z - member.z;
      const distance = Math.hypot(dx, dz) || 1;
      member.rot = Math.atan2(dx, dz);
      if (distance < 26) {
        member.cooldown -= dt;
        if (member.cooldown <= 0) {
          combat.fireAt(member.x, member.z, player.x, player.z, 'crew');
          member.flash = 0.07;
          member.cooldown = 1.3 + Math.random() * 1.1;
        }
      }
    }
  }

  function step(dt) {
    if (state.banner) {
      state.banner.time -= dt;
      if (state.banner.time <= 0) state.banner = null;
    }
    const player = state.player;
    const mission = state.mission;
    if (!mission || mission.stage === 'done') return;

    if (mission.stage === 'idle' && mission.marker) {
      const dx = player.x - mission.marker.x;
      const dz = player.z - mission.marker.z;
      if (dx * dx + dz * dz < mission.marker.radius * mission.marker.radius) {
        startMission(mission);
      }
      return;
    }

    if (mission.id === 'repo') {
      if (mission.stage === 'steal') {
        if (state.driving && state.driving.tag === 'coupe') {
          mission.stage = 'deliver';
          mission.objective = 'Deliver the coupe to the marina dock';
          mission.marker = { ...DELIVERY };
        }
      } else if (mission.stage === 'deliver') {
        if (state.driving && state.driving.tag === 'coupe') {
          const dx = player.x - DELIVERY.x;
          const dz = player.z - DELIVERY.z;
          if (dx * dx + dz * dz < DELIVERY.radius * DELIVERY.radius) {
            pass(900, 'The Vipers want a word.');
          }
        }
      }
    } else if (mission.id === 'crew') {
      if (mission.stage === 'fight') {
        stepCrew(dt);
        const down = crew.filter((member) => member.down > 0 || member.dead).length;
        mission.progress = `${down} / ${crew.length}`;
        mission.objective = `Take out the Viper crew (${down}/${crew.length})`;
        if (down >= crew.length) {
          raiseWanted(state, Math.max(2, state.wanted + 1));
          pass(1200, 'The police are on their way.');
        }
      }
    } else if (mission.id === 'heat') {
      if (mission.stage === 'survive') {
        mission.timer -= dt;
        mission.objective = `Survive the police for ${Math.max(0, Math.ceil(mission.timer))}s`;
        if (mission.timer <= 0) {
          state.wanted = 0;
          state.heat = 0;
          pass(1500, 'You lost them.');
        }
      }
    }
  }

  function startMission(mission) {
    if (mission.id === 'repo') {
      mission.stage = 'steal';
      mission.objective = 'Steal the gold coupe parked on Kestrel Avenue';
      mission.marker = { x: -5, z: 272, radius: 6 };
    } else if (mission.id === 'crew') {
      mission.stage = 'fight';
      spawnCrew(mission.marker);
      mission.objective = 'Take out the Viper crew (0/3)';
    } else if (mission.id === 'heat') {
      mission.stage = 'survive';
      mission.timer = SURVIVE_SECONDS;
      raiseWanted(state, 3);
      mission.objective = `Survive the police for ${SURVIVE_SECONDS}s`;
    }
  }

  function sync(time) {
    if (!markers) return;
    markers.begin();
    const mission = state.mission;
    if (mission && mission.marker && mission.stage !== 'done') {
      markers.place(mission.marker.x, mission.marker.z, time);
    }
    markers.commit();

    crewBatch.begin();
    for (const member of crew) {
      if (member.dead || member.down > 0) continue;
      crewBatch.place(member.x, member.z, member.rot, crewColor, 0, 0, 1.02);
    }
    crewBatch.commit();
  }

  reset();
  return {
    step,
    sync,
    reset,
    crew,
    jumpTo(next) {
      index = Math.max(0, Math.min(MISSIONS.length - 1, next));
      crew.length = 0;
      const mission = MISSIONS[index];
      setMission(mission.id, mission.title, mission.objective, 'idle', { ...mission.start });
    },
    get index() { return index; },
    get cleared() { return cleared; },
  };
}

// A gold ring on the ground and a diamond turning above it, both instanced.
function createMarkers(scene, capacity) {
  const ring = new THREE.InstancedMesh(
    new THREE.RingGeometry(2.4, 3.1, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffc14a, side: THREE.DoubleSide }),
    capacity,
  );
  const diamond = new THREE.InstancedMesh(
    sunlitGeometry('box'),
    sunlitMaterial({ color: 0xffc14a }),
    capacity,
  );
  for (const mesh of [ring, diamond]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    scene.add(mesh);
  }
  ring.name = 'mission-rings';
  diamond.name = 'mission-diamonds';
  const dummy = new THREE.Object3D();
  let cursor = 0;

  return {
    begin() {
      cursor = 0;
    },
    place(x, z, time) {
      dummy.position.set(x, 0.42, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      ring.setMatrixAt(cursor, dummy.matrix);

      dummy.position.set(x, 4.2 + Math.sin(time * 2.2) * 0.35, z);
      dummy.rotation.set(0.6, time * 1.6, 0.6);
      dummy.scale.setScalar(1.1);
      dummy.updateMatrix();
      diamond.setMatrixAt(cursor, dummy.matrix);
      diamond.setColorAt(cursor, MARKER_COLOR);
      cursor += 1;
    },
    commit() {
      ring.count = cursor;
      diamond.count = cursor;
      ring.visible = cursor > 0;
      diamond.visible = cursor > 0;
      ring.instanceMatrix.needsUpdate = true;
      diamond.instanceMatrix.needsUpdate = true;
      if (diamond.instanceColor) diamond.instanceColor.needsUpdate = true;
    },
  };
}
