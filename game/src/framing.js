// Screen-space framing for the staged screenshot scenes.
//
// The scenes are composed by placing traffic and crowd where the camera actually looks,
// so they need the same projection the renderer uses: the camera's world-to-view matrix
// followed by its projection matrix. `inFrame` answers "would this point land inside the
// viewport rectangle", and `distance` gives the flat range the camera has to cover.
//
// Nothing here runs during play; a scene builds one framer after the camera has been
// placed, composes the street, and throws it away.

import * as THREE from '../vendor/three.module.min.js';

const _view = new THREE.Vector3();

export function createFramer(camera) {
  const eye = new THREE.Vector3();

  // The camera matrices are only current once the camera has been moved into place.
  function refresh() {
    camera.updateMatrixWorld(true);
    eye.setFromMatrixPosition(camera.matrixWorld);
    return framer;
  }

  const framer = {
    refresh,
    eye,

    // NDC position and the view-space depth of a world point, or null when the point is
    // behind the eye (where the perspective divide flips the sign).
    project(x, y, z) {
      _view.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      if (_view.z > -0.5) return null;
      const p = _view.clone().applyMatrix4(camera.projectionMatrix);
      return { x: p.x, y: p.y, depth: -_view.z };
    },

    // True when the point projects inside the viewport with the given margin: 0.92 keeps
    // a staged object a little clear of the edge of the frame.
    inFrame(x, y, z, margin = 0.92) {
      const p = framer.project(x, y, z);
      return p !== null && Math.abs(p.x) <= margin && Math.abs(p.y) <= margin;
    },

    distance(x, z) {
      return Math.hypot(x - eye.x, z - eye.z);
    },
  };

  return refresh();
}

// A cheap line-of-sight test for staging: a footprint between the camera and a point
// hides it, and something hidden behind a building does not count as being in the frame.
// Only the staged scenes pay for this; the live game never asks.
export function makeOccluder(city, eye) {
  const rects = city.collisions;
  return function blocked(x, z) {
    for (let i = 1; i <= 6; i += 1) {
      const t = i / 7;
      const px = eye.x + (x - eye.x) * t;
      const pz = eye.z + (z - eye.z) * t;
      for (let r = 0; r < rects.length; r += 1) {
        const rect = rects[r];
        if (Math.abs(px - rect.x) < rect.w / 2 && Math.abs(pz - rect.z) < rect.d / 2) return true;
      }
    }
    return false;
  };
}
