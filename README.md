# Meridian Cove

A 3D open-world crime city in the browser — built for the [make.fun gta6-01 competition](https://make.fun/c/gta6-01).

[![Live Demo](https://img.shields.io/badge/play-live-blue)](https://nxstradamuss.github.io/meridian-cove/)

## Overview

Meridian Cove is a fully playable GTA-style open city running entirely in the browser with zero dependencies (no build step, no network requests). It features:

- **Procedural city generation** — different seed = different city layout every time
- **Instanced rendering** — thousands of buildings, cars, pedestrians, street furniture drawn with ~30 draw calls
- **Baked lighting** — vertex-color sun shading + ground-projected shadows (no shadow maps, runs in software rendering)
- **Dynamic time of day** — sun position, sky gradient, fog, shadows, and building window lights all interpolate smoothly
- **Particle system** — wheel dust, exhaust smoke, gunfire sparks, muzzle flashes, debris
- **Full gameplay systems** — traffic with lane logic, pedestrians, police pursuit, combat, missions, drivable vehicles

## Tech Stack

- **three.js** (vendored `three.module.min.js`, r158) — only external dependency
- **Vanilla TypeScript** (Node 22, runs directly with `node main.ts`)
- **Canvas 2D HUD** — no HTML/CSS overlay
- **InstancedMesh** for everything repeated (buildings, cars, people, particles)
- **Fixed timestep simulation** (1/60s) — deterministic, replayable

## Architecture Highlights

### Procedural City (`game/src/city.js`)
Grid-based road graph (11×11 streets = 100 blocks). Buildings placed per-block with height bands (towers/core/mid/low), palette variation, rooftop details (tanks/gardens), street furniture (lamps, hydrants, benches, planters), coast with marina, landmarks.

### Rendering (`game/src/scene3d.js`)
- **Sky**: vertex-colored cylinder (56 tris, no texture)
- **Buildings**: 4 instanced meshes (lower, upper, roofs, window bands) — colors via instance attributes
- **Shadows**: pre-baked convex hull per building, chunked by 120m grid, culled by distance
- **Culling**: radius-based (470m), only rewrites instance buffers when player moves >12m

### Time of Day (`game/src/timeOfDay.js` + `scene3d.js`)
9 keyframes (midnight → noon → midnight) with interpolated:
- Sun direction (normalized)
- Sky zenith/horizon colors
- Fog color
- Shadow opacity
- Ambient light level
- Window lights on/off threshold

### Particle System (`game/src/particles.js`)
Single `InstancedMesh` (quad geometry, baked sun shading) with 5 types:
- **Dust** — behind wheels, short-lived
- **Smoke** — exhaust, rises
- **Sparks** — bullet impacts
- **Flash** — muzzle
- **Debris** — explosions

Physics per frame: gravity, drag, ground bounce, camera-distance culling.

### Gameplay Systems
| System | File | Features |
|--------|------|----------|
| Traffic | `traffic.js` | Lane-keeping, gap-based braking, junction turns, recycle far cars |
| Pedestrians | `peds.js` | Sidewalk wandering, alert propagation, staged framing |
| Vehicles | `vehicles.js` | Enter/exit, physics, chase cam |
| Police | `police.js` | Cruisers + foot officers, wanted scaling, deployment |
| Combat | `combat.js` | Bullet pool, spread, damage, hit/spark events for particles |
| Missions | `missions.js` | Markers, crew, objectives, standoff |

## Competition Constraints Met

- ✅ **No network** — fully offline, vendor three.js
- ✅ **Deterministic** — fixed timestep, seeded RNG for screenshots
- ✅ **Size limits** — 27 files, ~900KB, 4 screenshots ≤256 KiB each
- ✅ **OSI license** — MIT
- ✅ **Transcripts** — 11 Hermes sessions, 99.5% own work

## Building & Running

```bash
# Build dossier for submission
MAKEFUN_OUTPUT_DIR=out node main.ts

# Run locally
node serve.ts --port 8080
# Open http://localhost:8080
# Add ?shot=city|chase|mission|standoff for competition screenshots
```

## Screenshots (Competition Entry)

| Scene | Description |
|-------|-------------|
| `1-city.jpg` | Cover: Kestrel Avenue viewpoint, traffic + crowd |
| `2-chase.jpg` | Police chase: player in gold coupe, 3 cruisers boxing in |
| `3-mission.jpg` | Vipers job: Cannery Row approach, crew engagement |
| `4-standoff.jpg` | 5-star standoff: cruisers, officers, both sides firing |

## Competition History

- **Round 5** — Submitted, passed validity, scored dev phase
- **Round 6** — Rejected (screenshots updated outside recording)
- **Round 7** — Reverted to witnessed screenshots, all checks pass, scored dev phase
- **Next** — Particle system + night mode integration (this repo)

## License

MIT — see [LICENSE](LICENSE)

---

*Built with an AI coding agent (Hermes) for the make.fun gta6-01 competition. The city, systems, and rendering pipeline are all original work.*