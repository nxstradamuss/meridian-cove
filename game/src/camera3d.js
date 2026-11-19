// The third-person follow camera: sits behind and above the player, eases toward its
// target, and never drops below the street.

import * as THREE from '../vendor/three.module.min.js';
import { CAMERA } from './config.js';

export function createFollowCamera(aspect) {
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
  const position = new THREE.Vector3();
  const target = new THREE.Vector3();
  const wantedPosition = new THREE.Vector3();
  const wantedTarget = new THREE.Vector3();

  function desired(player, outPosition, outTarget) {
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    outPosition.set(
      player.x - fx * CAMERA.back,
      Math.max(CAMERA.minHeight, CAMERA.height),
      player.z - fz * CAMERA.back,
    );
    outTarget.set(
      player.x + fx * CAMERA.lookAhead,
      CAMERA.lookHeight,
      player.z + fz * CAMERA.lookAhead,
    );
  }

  function place(player) {
    desired(player, position, target);
    camera.position.copy(position);
    camera.lookAt(target);
  }

  function update(player, dt) {
    desired(player, wantedPosition, wantedTarget);
    const blend = 1 - Math.exp(-CAMERA.ease * dt);
    position.lerp(wantedPosition, blend);
    target.lerp(wantedTarget, blend);
    if (position.y < CAMERA.minHeight) position.y = CAMERA.minHeight;
    camera.position.copy(position);
    camera.lookAt(target);
  }

  function resize(width, height) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  place({ x: 0, z: 0, heading: 0 });
  return { camera, place, update, resize };
}
