// ============================================================================
// PALACE RUNNER — main.js
// Single entry point. All tunable constants live in CONFIG below.
// File structure:
//   index.html  — canvas + HUD/screens + CSS + importmap
//   js/main.js  — THIS FILE: CONFIG tunables + boot
//   js/input.js — keyboard / touch swipe / buttons + input buffering
//   js/audio.js — synthesized Web Audio SFX + ambient bed
//   js/player.js— procedural runner character + run/jump/slide animation
//   js/world.js — palette, lights, sky, palace chunk builders, particles
//   js/game.js  — state machine, difficulty, collisions, camera, main loop
//
// HOW TO RUN: `python3 -m http.server 8000` in this folder, then open
//   http://localhost:8000/index.html   (plain file:// also works in most
//   browsers, but a static server is recommended for ES-module CORS rules).
//
// DRAW-CALL BUDGET: ~110 max. Shared geometries/materials everywhere, one
//   InstancedMesh for coins, pooled particle Points (2 draws), ≤4 real-time
//   point lights, one 1024px directional shadow with a tight 45m box.
//   Chunks older than ~30m behind the player are disposed; ≤6 live chunks.
//
// PROCEDURAL vs AUTHORED: everything in-game is procedural stand-in geometry
//   (boxes/cylinders/lathe + canvas textures). In a production pass these
//   would be replaced by authored assets: sculpted gopuram/deity rows,
//   carved column capitals, jali lattice alpha-maps, character rig, recorded
//   foley + tanpura/drum loops. Gameplay code would not need to change.
// ============================================================================
import * as THREE from 'three';
import { Game } from './game.js';

export const CONFIG = {
  // ---- locomotion ----
  startSpeed: 9.0,        // m/s at run start
  maxSpeed: 22.0,         // hard cap so architecture stays readable
  speedRampDist: 950,     // ~63% of ramp done by this distance (exp curve)
  laneWidth: 2.3,         // lateral spacing of the 3 lanes
  laneLerp: 11.0,         // lane tween rate (slight overshoot applied)
  gravity: -34.0,         // snappy arcade gravity
  jumpVel: 11.5,          // jump take-off velocity
  slideTime: 0.72,        // seconds of slide
  coyoteTime: 0.10,       // input forgiveness after leaving ground
  // ---- spawning ----
  chunkAhead: 5,          // live chunks kept ahead of player
  cullBehind: 30,         // metres behind player before chunk is freed
  rowGapEasy: 20, rowGapHard: 11, // obstacle row spacing (lerped by difficulty)
  powerupEveryMin: 30, powerupEveryMax: 45, // seconds between power-ups
  magnetTime: 8, shieldTime: 25, multTime: 10,
  magnetRadius: 7.0, coinRadius: 1.35,
  reactionGap: 0.42,      // min seconds of travel between hazard rows
  // ---- atmosphere ----
  fogDensity: 0.0085,     // FogExp2 density (dusk haze + culling aid)
  fogColor: 0x4a2f52,     // violet dusk haze
  sunColor: 0xffb36b, sunIntensity: 2.6,
  hemiSky: 0x6a5acd, hemiGround: 0x8a5a30, hemiIntensity: 0.75,
  lampColor: 0xff9a3c, lampIntensity: 14, lampDist: 16,
  bloomFake: true,        // emissive + additive sprites instead of postpass
  rain: false,            // set true for monsoon variant (wet floor + hiss)
  // ---- palette ----
  sandstone: 0xc99a62, granite: 0x3d3a4a, gold: 0xe8b64c,
  oxideRed: 0x9a3b26, blackStone: 0x17141f, leafGreen: 0x2e7d4f,
  // ---- juice ----
  camDist: 7.2, camHeight: 3.9, camLookAhead: 6.5,
  baseFov: 62, maxFovBoost: 13,
  shakeOnDeath: 0.9, kickOnLand: 0.35,
  // ---- perf ----
  shadowMap: 1024, shadowRange: 46,
  dustCount: 320, puffCount: 120, sparkCount: 200,
};

const canvas = document.getElementById('game-canvas');
const game = new Game(canvas, CONFIG);
window.__game = game; // debug/testing handle (no gameplay effect)
game.init();
