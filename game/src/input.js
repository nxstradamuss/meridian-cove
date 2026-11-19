// Keyboard and mouse state: held keys, edge-triggered presses, and one intent object
// per fixed simulation step.

import { CAMERA } from './config.js';

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA'];
const RIGHT = ['KeyD'];
const TURN_LEFT = ['KeyQ', 'ArrowLeft'];
const TURN_RIGHT = ['KeyE', 'ArrowRight'];

export function createInput(element) {
  const held = new Set();
  const edges = new Set();
  let mouseDx = 0;
  let locked = false;

  function onKeyDown(event) {
    if (!held.has(event.code)) edges.add(event.code);
    held.add(event.code);
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
  }

  function onKeyUp(event) {
    held.delete(event.code);
  }

  function onMouseMove(event) {
    if (!locked) return;
    mouseDx += event.movementX || 0;
  }

  function onLockChange() {
    locked = document.pointerLockElement === element;
  }

  function onBlur() {
    held.clear();
    edges.clear();
    mouseDx = 0;
  }

  function onMouseDown(event) {
    if (event.button === 0) held.add('Mouse0');
    if (!locked) element.requestPointerLock?.();
  }

  function onMouseUp(event) {
    if (event.button === 0) held.delete('Mouse0');
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLockChange);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('contextmenu', (event) => event.preventDefault());

  function any(list) {
    return list.some((code) => held.has(code));
  }

  return {
    isDown(code) {
      return held.has(code);
    },
    wasPressed(code) {
      return edges.has(code);
    },
    isLocked() {
      return locked;
    },
    // Called once per fixed step, after the intent has been read.
    endStep() {
      edges.clear();
      mouseDx = 0;
    },
    intent() {
      const forward = (any(FORWARD) ? 1 : 0) - (any(BACK) ? 1 : 0);
      const strafe = (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0);
      const turn = (any(TURN_RIGHT) ? 1 : 0) - (any(TURN_LEFT) ? 1 : 0);
      return {
        forward,
        strafe,
        turn,
        look: mouseDx * CAMERA.sensitivity,
        sprint: held.has('ShiftLeft') || held.has('ShiftRight'),
        handbrake: held.has('Space'),
        firing: held.has('Mouse0'),
      };
    },
  };
}
