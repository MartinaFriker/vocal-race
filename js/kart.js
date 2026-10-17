// Vokal-Kart: a kart race steered with two vowels (one for left, one for right).
// The kart drives by itself; without a voice it goes straight.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js";

const VA = window.VowelAnalysis;
const VOWELS = VA.VOWELS;

// ---------- tuning ----------
const ROAD_WIDTH = 16;          // metres; generous so steering with a short delay stays fun
const LAPS = 2;
const BASE_SPEED = 17;          // m/s on the road
const OFFROAD_FACTOR = 0.55;    // speed on grass
const TURN_RATE = 1.25;         // rad/s at full steering
const START_LINE_S = 24;        // distance of the start/finish line from the track origin
const DIFFICULTIES = [
  { key: "easy",   label: "Leicht", factor: 0.80 },
  { key: "medium", label: "Mittel", factor: 0.88 },
  { key: "hard",   label: "Schwer", factor: 0.95 },
];
const OPPONENTS = [
  { name: "Blau",  color: 0x2f6fe0, helmet: 0xffffff, lane: 4.5,  start: 14, pace: 1.00 },
  { name: "Grün",  color: 0x2fbf5a, helmet: 0xffd23f, lane: -4.5, start: 10, pace: 0.97 },
  { name: "Gelb",  color: 0xf2c230, helmet: 0x333333, lane: 4.5,  start: 6,  pace: 0.94 },
];
const PLAYER_COLOR = 0xe8202a;
const SURE_CONFIDENCE = 0.12;   // two-vowel decision: nearest must be clearly closer
const HISTORY_MS = 160;
const CALIB_SECONDS = 2;
const NOISE_SECONDS = 1;
const SETTINGS_KEY = "vokalkart_settings";
const PROFILES_KEY = "vokaltest_profiles"; // shared with the vowel test page

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const el = {};
["scene","hud","hudPos","hudOf","hudLap","hudTime","quitBtn","hudLevel","steerLeft","steerMid","steerRight",
 "steerLeftV","steerRightV","hudCenter","screenSetup","leftRow","rightRow","pairHint","diffSeg","profileSelect",
 "startBtn","setupError","screenCalib","calibSide","calibVowel","calibHint","calibCancel",
 "screenResult","resultHead","resultList","resultInfo","againBtn","menuBtn"].forEach((id) => { el[id] = $(id); });

// ---------- settings ----------
let settings = { left: "a", right: "i", difficulty: "easy", profile: "" };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch (e) {}
function saveSettings(){ try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} }
function loadProfiles(){
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILES_KEY)) || {};
    const ok = {};
    Object.keys(raw).forEach((n) => { if (VOWELS.every((v) => raw[n][v] && Array.isArray(raw[n][v].env))) ok[n] = raw[n]; });
    return ok;
  } catch (e) { return {}; }
}

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas: el.scene, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = skyTexture();
scene.fog = new THREE.Fog(0xbfe3f5, 120, 420);
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 900);
scene.add(new THREE.HemisphereLight(0xffffff, 0x5a8f3a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-60, 120, 40);
scene.add(sun);

function skyTexture(){
  const c = document.createElement("canvas"); c.width = 4; c.height = 256;
  const g = c.getContext("2d"), grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#3d9be0"); grad.addColorStop(0.55, "#8fd0f5"); grad.addColorStop(1, "#d8f0fb");
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function resize(){
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? 78 : 62; // wider view when the phone is held upright
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- track ----------
// A closed loop with long sweeping curves and one tighter hairpin.
const CONTROL = [
  [0, 0], [70, -4], [125, 12], [150, 55], [135, 100], [95, 112], [70, 92], [45, 70],
  [15, 78], [-10, 112], [-55, 125], [-95, 100], [-110, 55], [-85, 15], [-45, -2],
].map(([x, z]) => new THREE.Vector3(x * 1.25, 0, z * 1.25));
const curve = new THREE.CatmullRomCurve3(CONTROL, true, "centripetal");
const TRACK_LENGTH = curve.getLength();
const N = Math.round(TRACK_LENGTH / 1.0); // one sample per metre
const DS = TRACK_LENGTH / N;
const P = curve.getSpacedPoints(N).slice(0, N);
const T = P.map((_, i) => P[(i + 1) % N].clone().sub(P[(i - 1 + N) % N]).normalize());
const LEFT = T.map((t) => new THREE.Vector3(t.z, 0, -t.x)); // left of the driving direction

function sampleAt(s){
  const u = ((s / DS) % N + N) % N, i = Math.floor(u), f = u - i, j = (i + 1) % N;
  const pos = P[i].clone().lerp(P[j], f);
  const tan = T[i].clone().lerp(T[j], f).normalize();
  return { pos, tan, left: new THREE.Vector3(tan.z, 0, -tan.x) };
}

buildWorld();

function buildWorld(){
  // grass
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshLambertMaterial({ color: 0x6cc24a }));
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.02;
  scene.add(grass);

  // road, curbs: strips along the samples
  const half = ROAD_WIDTH / 2;
  scene.add(stripMesh(-half, half, 0, () => [0.30, 0.31, 0.35]));
  const curb = (i) => (Math.floor(i / 3) % 2 ? [0.95, 0.95, 0.95] : [0.85, 0.12, 0.15]);
  scene.add(stripMesh(half, half + 1.4, 0.01, curb));
  scene.add(stripMesh(-half - 1.4, -half, 0.01, curb));
  // dashed centre line
  scene.add(stripMesh(-0.15, 0.15, 0.015, (i) => (Math.floor(i / 4) % 2 ? null : [1, 1, 1])));

  // start/finish line (checker)
  const c = document.createElement("canvas"); c.width = 128; c.height = 16;
  const g = c.getContext("2d");
  for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? "#111" : "#fff"; g.fillRect(x * 8, y * 8, 8, 8); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, 2), new THREE.MeshBasicMaterial({ map: tex }));
  const st = sampleAt(START_LINE_S);
  line.position.copy(st.pos).setY(0.03);
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = Math.atan2(st.tan.x, st.tan.z);
  scene.add(line);
  // start gantry
  const postMat = new THREE.MeshLambertMaterial({ color: 0x222831 });
  [-1, 1].forEach((side) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), postMat);
    post.position.copy(st.pos).addScaledVector(st.left, side * (half + 2)).setY(3);
    scene.add(post);
  });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH + 4.6, 1.4, 0.4), new THREE.MeshLambertMaterial({ map: tex }));
  banner.position.copy(st.pos).setY(6);
  banner.rotation.y = Math.atan2(st.tan.x, st.tan.z); // box width runs across the road
  scene.add(banner);

  // trees and bushes, kept away from the road
  const rnd = mulberry32(7);
  const trunks = [], crowns = [];
  for (let k = 0; k < 260; k++) {
    const i = Math.floor(rnd() * N), side = rnd() < 0.5 ? -1 : 1;
    const off = half + 9 + rnd() * 70;
    const pos = P[i].clone().addScaledVector(LEFT[i], side * off);
    if (distanceToTrack(pos) < half + 7) continue;
    const s = 0.8 + rnd() * 0.9;
    trunks.push([pos, s]); crowns.push([pos, s, rnd()]);
  }
  const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.45, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0x8a5a33 }), trunks.length);
  const crownMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(2.4, 5.5, 7), new THREE.MeshLambertMaterial({ color: 0xffffff }), crowns.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), color = new THREE.Color();
  trunks.forEach(([p, s], i) => { m.compose(new THREE.Vector3(p.x, 1.2 * s, p.z), q, new THREE.Vector3(s, s, s)); trunkMesh.setMatrixAt(i, m); });
  crowns.forEach(([p, s, r], i) => {
    m.compose(new THREE.Vector3(p.x, (2.4 + 2.75) * s, p.z), q, new THREE.Vector3(s, s, s));
    crownMesh.setMatrixAt(i, m);
    crownMesh.setColorAt(i, color.setHSL(0.27 + r * 0.08, 0.55, 0.32 + r * 0.12));
  });
  scene.add(trunkMesh, crownMesh);

  // distant hills
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x4f9a52 });
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2, r = 330 + rnd() * 60;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(60 + rnd() * 50, 12, 8), hillMat);
    hill.position.set(Math.cos(a) * r, -25, Math.sin(a) * r + 70);
    hill.scale.y = 0.6;
    scene.add(hill);
  }
}

// Triangle strip between two lateral offsets; colorFn(i) returns RGB or null to leave a gap.
function stripMesh(offA, offB, y, colorFn){
  const pos = [], col = [];
  for (let i = 0; i < N; i++) {
    const c = colorFn(i);
    if (!c) continue;
    const j = (i + 1) % N;
    const a0 = P[i].clone().addScaledVector(LEFT[i], offA), b0 = P[i].clone().addScaledVector(LEFT[i], offB);
    const a1 = P[j].clone().addScaledVector(LEFT[j], offA), b1 = P[j].clone().addScaledVector(LEFT[j], offB);
    [a0, b0, a1, b0, b1, a1].forEach((v) => { pos.push(v.x, y, v.z); col.push(c[0], c[1], c[2]); });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

function distanceToTrack(pos){
  let best = Infinity;
  for (let i = 0; i < N; i += 2) best = Math.min(best, (P[i].x - pos.x) ** 2 + (P[i].z - pos.z) ** 2);
  return Math.sqrt(best);
}
function mulberry32(a){ return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- karts ----------
function makeKart(color, helmet){
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b1d22 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 2.5), bodyMat); body.position.y = 0.45; g.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.7), bodyMat); nose.position.set(0, 0.42, 1.45); g.add(nose);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 0.25), dark); bumper.position.set(0, 0.3, 1.85); g.add(bumper);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.3), dark); seat.position.set(0, 0.95, -0.55); g.add(seat);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.45), new THREE.MeshLambertMaterial({ color: 0x2a2f3a })); torso.position.set(0, 1.05, -0.25); g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 10), new THREE.MeshLambertMaterial({ color: helmet })); head.position.set(0, 1.62, -0.22); g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.1), dark); visor.position.set(0, 1.64, 0.1); g.add(visor);
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.36, 14); wheelGeo.rotateZ(Math.PI / 2);
  [[-0.88, 0.95], [0.88, 0.95], [-0.92, -0.9], [0.92, -0.9]].forEach(([x, z]) => {
    const w = new THREE.Mesh(wheelGeo, dark); w.position.set(x, 0.38, z); g.add(w);
  });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.5, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; shadow.scale.set(0.8, 1.25, 1); g.add(shadow);
  scene.add(g);
  return g;
}

const player = { mesh: makeKart(PLAYER_COLOR, 0xffffff), pos: new THREE.Vector3(), heading: 0, speed: 0, steer: 0,
  idx: 0, lap: 0, progress: 0, finished: false, finishTime: 0, name: "Du", color: PLAYER_COLOR };
const ais = OPPONENTS.map((o) => ({ ...o, mesh: makeKart(o.color, o.helmet), s: 0, offset: 0, targetOffset: 0, speed: 0,
  finished: false, finishTime: 0, wobble: Math.random() * 10 }));

// ---------- race state ----------
let state = "setup";      // setup | calib | countdown | race | result
let raceTime = 0, countdown = 0, aiFactor = 0.8, finishOrder = [];
let keys = { left: false, right: false };
let voiceSteer = 0;       // -1 left, 0 straight, 1 right (from the microphone)
let lastT = performance.now();

function resetRace(){
  const d = DIFFICULTIES.find((x) => x.key === settings.difficulty) || DIFFICULTIES[0];
  aiFactor = d.factor;
  raceTime = 0; finishOrder = [];
  const sp = sampleAt(2);
  player.pos.copy(sp.pos); player.heading = Math.atan2(sp.tan.x, sp.tan.z);
  player.speed = 0; player.steer = 0; player.idx = 2; player.lap = 0; player.finished = false;
  player.progress = 2;
  ais.forEach((a) => { a.s = a.start; a.offset = a.lane; a.targetOffset = a.lane; a.speed = 0; a.finished = false; });
  placeKarts();
}

function placeKarts(){
  player.mesh.position.copy(player.pos);
  player.mesh.rotation.y = player.heading;
  player.mesh.rotation.z = -player.steer * 0.06;
  ais.forEach((a) => {
    const sp = sampleAt(a.s);
    a.mesh.position.copy(sp.pos).addScaledVector(sp.left, a.offset);
    a.mesh.rotation.y = Math.atan2(sp.tan.x, sp.tan.z) + (a.targetOffset - a.offset) * 0.03;
  });
}

// ---------- update ----------
function update(dt){
  // steering input: keyboard wins, otherwise the voice
  const keySteer = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
  const target = keySteer !== 0 ? keySteer : voiceSteer;
  player.steer += (target - player.steer) * Math.min(1, dt * 7);

  // player physics
  const near = nearestIndex(player.pos, player.idx);
  const lateral = player.pos.clone().sub(P[near]).dot(LEFT[near]);
  const onRoad = Math.abs(lateral) <= ROAD_WIDTH / 2 + 0.6;
  const targetSpeed = state === "race" && !player.finished ? BASE_SPEED * (onRoad ? 1 : OFFROAD_FACTOR) : (player.finished ? BASE_SPEED * 0.5 : 0);
  player.speed += (targetSpeed - player.speed) * Math.min(1, dt * (targetSpeed > player.speed ? 1.2 : 2.5));
  // steer right = clockwise from above; heading grows to the left
  player.heading -= player.steer * TURN_RATE * dt * Math.min(1, player.speed / 6);
  const fwd = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));
  player.pos.addScaledVector(fwd, player.speed * dt);
  // keep the kart from wandering far away: soft wall 12 m beside the road
  const limit = ROAD_WIDTH / 2 + 12;
  if (Math.abs(lateral) > limit) player.pos.addScaledVector(LEFT[near], (Math.sign(lateral) * limit - lateral));

  // lap counting from the nearest track sample
  const newIdx = nearestIndex(player.pos, near);
  if (newIdx - player.idx < -N / 2) player.lap++;
  if (newIdx - player.idx > N / 2) player.lap--;
  player.idx = newIdx;
  player.progress = player.lap * TRACK_LENGTH + player.idx * DS;
  player.wrongWay = state === "race" && player.speed > 3 && fwd.dot(T[player.idx]) < -0.2;

  if (state === "race") {
    raceTime += dt;
    if (!player.finished && player.progress >= LAPS * TRACK_LENGTH + START_LINE_S) {
      player.finished = true; player.finishTime = raceTime; finishOrder.push(player);
      setTimeout(showResult, 1600);
    }
  }

  // opponents
  ais.forEach((a, k) => {
    if (state === "race") {
      // gentle rubber band: keeps the field together so overtaking stays possible
      const gap = a.s - player.progress;
      const band = THREE.MathUtils.clamp(-gap / 120, -0.08, 0.08);
      const want = a.finished ? BASE_SPEED * 0.5 : BASE_SPEED * aiFactor * a.pace * (1 + band) * (1 + 0.03 * Math.sin(raceTime * 0.7 + a.wobble));
      a.speed += (want - a.speed) * Math.min(1, dt * 1.0);
    } else { a.speed = 0; }
    a.s += a.speed * dt;
    if (!a.finished && a.s >= LAPS * TRACK_LENGTH + START_LINE_S) { a.finished = true; a.finishTime = raceTime; finishOrder.push(a); }

    // avoid the kart ahead (player or another AI) by moving to a free lane
    a.targetOffset = a.lane;
    const others = [{ s: player.progress, off: player.pos.clone().sub(P[player.idx]).dot(LEFT[player.idx]) }]
      .concat(ais.filter((b) => b !== a).map((b) => ({ s: b.s, off: b.offset })));
    others.forEach((o) => {
      const ahead = o.s - a.s;
      if (ahead > 0 && ahead < 9 && Math.abs(o.off - a.offset) < 2.6) {
        a.targetOffset = o.off > 0 ? o.off - 4.5 : o.off + 4.5;
      }
    });
    a.targetOffset = THREE.MathUtils.clamp(a.targetOffset, -ROAD_WIDTH / 2 + 1.6, ROAD_WIDTH / 2 - 1.6);
    a.offset += (a.targetOffset - a.offset) * Math.min(1, dt * 1.5);

    // bump: push the player away from an opponent instead of passing through it
    const sp = sampleAt(a.s);
    const apos = sp.pos.clone().addScaledVector(sp.left, a.offset);
    const d = player.pos.clone().sub(apos).setY(0), dist = d.length();
    if (dist < 2.1 && dist > 0.001) {
      player.pos.addScaledVector(d.normalize(), 2.1 - dist);
      player.speed *= 0.985;
    }
  });

  placeKarts();
}

function nearestIndex(pos, from){
  let best = from, bestD = Infinity;
  for (let k = -25; k <= 60; k++) {
    const i = ((from + k) % N + N) % N;
    const d = (P[i].x - pos.x) ** 2 + (P[i].z - pos.z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ---------- camera ----------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function updateCamera(dt, snap){
  const fwd = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));
  const wantPos = player.pos.clone().addScaledVector(fwd, -7.5).setY(3.4);
  const wantLook = player.pos.clone().addScaledVector(fwd, 6).setY(1.2);
  const k = snap ? 1 : Math.min(1, dt * 5);
  camPos.lerp(wantPos, k); camLook.lerp(wantLook, k);
  camera.position.copy(camPos); camera.lookAt(camLook);
}

// ---------- HUD ----------
function ranking(){
  const done = finishOrder.slice();
  const rest = [player, ...ais].filter((r) => !done.includes(r))
    .sort((a, b) => (b === player ? b.progress : b.s) - (a === player ? a.progress : a.s));
  return done.concat(rest);
}
function updateHud(){
  const rank = ranking().indexOf(player) + 1;
  el.hudPos.textContent = rank;
  el.hudOf.textContent = "/" + (ais.length + 1);
  const lap = THREE.MathUtils.clamp(Math.floor((player.progress - START_LINE_S) / TRACK_LENGTH) + 1, 1, LAPS);
  el.hudLap.textContent = player.finished ? "Ziel!" : "Runde " + lap + "/" + LAPS;
  el.hudTime.textContent = formatTime(raceTime);
  const s = player.steer;
  el.steerLeft.classList.toggle("is-on", s < -0.35);
  el.steerRight.classList.toggle("is-on", s > 0.35);
  el.steerMid.classList.toggle("is-on", Math.abs(s) <= 0.35 && state === "race");
  if (state === "race") {
    if (player.wrongWay) { showCenter("Falsche Richtung!", true); }
    else if (!player.finished) { el.hudCenter.hidden = true; }
  }
}
function showCenter(text, small){
  el.hudCenter.textContent = text;
  el.hudCenter.classList.toggle("small", !!small);
  el.hudCenter.hidden = false;
}
function formatTime(t){ const m = Math.floor(t / 60), s = t - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1); }

// ---------- main loop ----------
function frame(now){
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (state === "countdown") {
    countdown -= dt;
    const n = Math.ceil(countdown);
    showCenter(n > 0 ? String(n) : "Los!");
    if (countdown <= 0) { state = "race"; setTimeout(() => { if (state === "race" && !player.wrongWay) el.hudCenter.hidden = true; }, 700); }
  }
  if (state === "countdown" || state === "race" || state === "result") { updateVoice(now); update(dt); }
  else { idleCamera(now); }
  if (state !== "setup" && state !== "calib") updateCamera(dt, false);
  if (state === "countdown" || state === "race") updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
// slow fly-around behind the menus
function idleCamera(now){
  const s = (now / 1000) * 9 % TRACK_LENGTH, sp = sampleAt(s), ahead = sampleAt(s + 25);
  camera.position.copy(sp.pos).addScaledVector(sp.left, 14).setY(9);
  camera.lookAt(ahead.pos);
}

// ---------- microphone & vowels ----------
let audioCtx = null, analyser = null, timeData = null, micStream = null;
let threshold = 0.004, gaugeMax = 0.02, templates = null, hist = [];

async function ensureMic(){
  if (analyser) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("Dieser Browser unterstützt keinen Mikrofonzugriff.");
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume().catch(() => {});
  // same settings as the other modes, so profiles from the test page match
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const src = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser(); analyser.fftSize = 2048;
  src.connect(analyser);
  timeData = new Float32Array(analyser.fftSize);
}
function rms(){
  analyser.getFloatTimeDomainData(timeData);
  let s = 0; for (let i = 0; i < timeData.length; i++) s += timeData[i] * timeData[i];
  return Math.sqrt(s / timeData.length);
}
function updateVoice(now){
  if (!analyser || !templates) { voiceSteer = 0; return; }
  const level = rms();
  el.hudLevel.style.width = Math.min(100, (level / gaugeMax) * 100) + "%";
  if (level > threshold) {
    const r = VA.analyzeFrame(timeData, audioCtx.sampleRate);
    if (r) hist.push({ t: now, env: r.envelope });
  } else { hist = []; }
  while (hist.length && now - hist[0].t > HISTORY_MS) hist.shift();
  if (hist.length >= 2) {
    const cls = VA.classify(VA.medianEnvelope(hist.map((h) => h.env)), templates);
    voiceSteer = cls && cls.confidence >= SURE_CONFIDENCE ? (cls.vowel === settings.left ? -1 : 1) : 0;
  } else { voiceSteer = 0; }
}

// Calibration: 1 s silence, then each of the two vowels for 2 s (skipped with a saved profile).
let calibCancelled = false;
async function calibrate(){
  calibCancelled = false;
  showScreen("calib");
  const profiles = loadProfiles();
  const prof = settings.profile && profiles[settings.profile];
  const noise = await collect(NOISE_SECONDS, "Kurz still sein …", "–", "Wir messen kurz die Umgebung.", false);
  if (!noise) return false;
  const sorted = noise.levels.slice().sort((a, b) => a - b);
  threshold = Math.max(0.004, sorted[Math.floor((sorted.length - 1) * 0.9)] * 2.5);
  gaugeMax = threshold * 4;
  if (prof) {
    templates = { [settings.left]: prof[settings.left].env, [settings.right]: prof[settings.right].env };
    return true;
  }
  templates = {};
  for (const [v, side] of [[settings.left, "Links"], [settings.right, "Rechts"]]) {
    for (let attempt = 0; ; attempt++) {
      const res = await collect(CALIB_SECONDS, side === "Links" ? "◀ Links" : "Rechts ▶", v,
        attempt ? "Noch einmal, bitte laut und gleichmässig." : "Halte jetzt " + v.toUpperCase() + " ganz lang.", true);
      if (!res) return false;
      if (res.envs.length >= 8) { templates[v] = VA.medianEnvelope(res.envs); break; }
    }
  }
  return true;
}
function collect(seconds, sideText, vowel, hint, wantVoice){
  el.calibSide.textContent = sideText;
  el.calibVowel.textContent = vowel;
  el.calibHint.textContent = hint;
  return new Promise((resolve) => {
    const start = performance.now(), levels = [], envs = [];
    function step(now){
      if (calibCancelled) { resolve(null); return; }
      const level = rms();
      levels.push(level);
      if (wantVoice && level > threshold) {
        const r = VA.analyzeFrame(timeData, audioCtx.sampleRate);
        if (r) envs.push(r.envelope);
      }
      const p = Math.min(1, (now - start) / 1000 / seconds);
      el.calibVowel.style.setProperty("--p", p * 100 + "%");
      if (p < 1) requestAnimationFrame(step); else resolve({ levels, envs });
    }
    requestAnimationFrame(step);
  });
}

// ---------- screens ----------
function showScreen(name){
  el.screenSetup.hidden = name !== "setup";
  el.screenCalib.hidden = name !== "calib";
  el.screenResult.hidden = name !== "result";
  el.hud.hidden = !(name === "race");
}
function pairDifficulty(a, b){
  const p = VA.PRESETS.child, d = Math.hypot(Math.log(p[a].f1 / p[b].f1), Math.log(p[a].f2 / p[b].f2));
  return d > 0.75 ? "leichtes Paar – klingen sehr verschieden" : d > 0.45 ? "mittleres Paar" : "schweres Paar – klingen ähnlich";
}
function buildSetup(){
  [["leftRow", "left", "right"], ["rightRow", "right", "left"]].forEach(([row, key, other]) => {
    el[row].innerHTML = "";
    VOWELS.forEach((v) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "vowel-btn" + (settings[key] === v ? " is-active" : "");
      b.textContent = v.toUpperCase(); b.disabled = settings[other] === v;
      b.addEventListener("click", () => { settings[key] = v; saveSettings(); buildSetup(); });
      el[row].appendChild(b);
    });
  });
  el.pairHint.textContent = settings.left.toUpperCase() + " / " + settings.right.toUpperCase() + ": " + pairDifficulty(settings.left, settings.right);
  el.diffSeg.innerHTML = "";
  DIFFICULTIES.forEach((d) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = d.label; b.className = settings.difficulty === d.key ? "is-active" : "";
    b.addEventListener("click", () => { settings.difficulty = d.key; saveSettings(); buildSetup(); });
    el.diffSeg.appendChild(b);
  });
  const profiles = loadProfiles();
  el.profileSelect.innerHTML = "";
  [["", "Vor dem Rennen einmessen"]].concat(Object.keys(profiles).sort().map((n) => [n, "Profil: " + n])).forEach(([val, label]) => {
    const o = document.createElement("option"); o.value = val; o.textContent = label; el.profileSelect.appendChild(o);
  });
  if (!profiles[settings.profile]) settings.profile = "";
  el.profileSelect.value = settings.profile;
  el.steerLeftV.textContent = settings.left;
  el.steerRightV.textContent = settings.right;
}
el.profileSelect.addEventListener("change", () => { settings.profile = el.profileSelect.value; saveSettings(); });

async function startRace(){
  el.setupError.hidden = true;
  el.startBtn.disabled = true;
  try { await ensureMic(); }
  catch (e) {
    el.startBtn.disabled = false;
    el.setupError.textContent = e && e.message && e.message.startsWith("Dieser") ? e.message
      : "Kein Mikrofonzugriff erhalten. Bitte im Browser erlauben und nochmal versuchen.";
    el.setupError.hidden = false;
    return;
  }
  el.startBtn.disabled = false;
  requestWakeLock();
  if (!(await calibrate())) { showScreen("setup"); releaseWakeLock(); return; }
  beginCountdown();
}
function beginCountdown(){
  resetRace();
  updateCamera(0, true);
  showScreen("race");
  hist = [];
  countdown = 3;
  state = "countdown";
  requestWakeLock();
}
function showResult(){
  state = "result";
  releaseWakeLock();
  const order = ranking();
  const place = order.indexOf(player) + 1;
  el.resultHead.textContent = place === 1 ? "Sieg! Platz 1" : "Platz " + place;
  el.resultList.innerHTML = order.map((r, i) =>
    `<li class="${r === player ? "me" : ""}"><b>${i + 1}.</b><i style="background:#${r.color.toString(16).padStart(6, "0")}"></i>` +
    `<span>${r.name}</span><span class="mono">${r.finished ? formatTime(r.finishTime) : "–"}</span></li>`).join("");
  el.resultInfo.textContent = "Gelenkt mit " + settings.left.toUpperCase() + " (links) und " + settings.right.toUpperCase() + " (rechts).";
  showScreen("result");
}

el.startBtn.addEventListener("click", startRace);
el.calibCancel.addEventListener("click", () => { calibCancelled = true; });
el.againBtn.addEventListener("click", beginCountdown);
el.menuBtn.addEventListener("click", () => { state = "setup"; buildSetup(); showScreen("setup"); });
el.quitBtn.addEventListener("click", () => { state = "setup"; releaseWakeLock(); buildSetup(); showScreen("setup"); });

window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") keys.left = true;
  if (e.key === "ArrowRight") keys.right = true;
});
window.addEventListener("keyup", (e) => {
  if (e.key === "ArrowLeft") keys.left = false;
  if (e.key === "ArrowRight") keys.right = false;
});

// ---------- wake lock & app switching ----------
let wakeLock = null;
function requestWakeLock(){
  if (wakeLock || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  navigator.wakeLock.request("screen").then((l) => { wakeLock = l; l.addEventListener("release", () => { wakeLock = null; }); }).catch(() => {});
}
function releaseWakeLock(){ if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (audioCtx && audioCtx.state !== "running") audioCtx.resume().catch(() => {});
    if (state === "race" || state === "countdown") requestWakeLock();
    lastT = performance.now();
  }
});

// test hook for automated checks (no effect on normal play)
window.__kart = { get state(){ return state; }, player, ais, ranking, sampleAt, P, T, LEFT, N, TRACK_LENGTH, get voiceSteer(){ return voiceSteer; }, keys };

buildSetup();
showScreen("setup");
requestAnimationFrame(frame);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}
