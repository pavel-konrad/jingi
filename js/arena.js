// The table of JINGI in the browser: the arena's own speaker and die, with the
// one gesture the game is built on. The visitor picks the die up and throws it
// into the cone; the cone kicks it about, as it does in the game, and the MOVE
// panel beside the canvas reports the face that came up.
//
// Models come straight from the game (speaker.glb is the four parts of the
// arena speaker exported from the Unity scene, die.glb is SM_Die); colours are
// the Unity materials' own. Physics is a pan of boxes in the shape of the bowl,
// the same trick the game uses, because a thin moving cone makes a poor collider.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import * as CANNON from "cannon-es";

const stage = document.querySelector("[data-arena]");
const canvas = stage?.querySelector("canvas");
if (stage && canvas) start().catch((error) => {
  // The poster under the canvas stays visible; the page reads the same without the toy.
  console.warn("JINGI arena could not start:", error);
  stage.dataset.error = String(error);
  stage.classList.add("is-static");
});

async function start() {
  const hud = {
    face: document.querySelector("[data-hud-face]"),
    move: document.querySelector("[data-hud-move]"),
    info: document.querySelector("[data-hud-info]"),
  };
  const throwButton = document.querySelector("[data-throw]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── renderer ────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0b10);
  scene.fog = new THREE.Fog(0x0d0b10, 9, 20);
  // Metal needs something to reflect; a dim room, so the two rings stay the light of the scene.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.06;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
  // Almost straight down, as the film sees the bowl: rings first, the die in the middle of them.
  const cameraHome = new THREE.Vector3(-1.1, 5.3, 2.3);
  camera.position.copy(cameraHome);
  const lookAt = new THREE.Vector3(0, -0.05, 0);
  camera.lookAt(lookAt);

  // The rings light the table: orange close to the cone, purple under the housing.
  const orange = new THREE.PointLight(0xff8a2a, 4.2, 8, 2);
  orange.position.set(0, 0.9, 0);
  const purple = new THREE.PointLight(0xa33cff, 7, 12, 2);
  purple.position.set(0, -1.1, 4.0);
  const purpleBack = purple.clone();
  purpleBack.position.set(0, -1.1, -4.0);
  scene.add(orange, purple, purpleBack, new THREE.AmbientLight(0x2a1c3a, 0.22));

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.6, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ── models ──────────────────────────────────────────────────────────────
  const loader = new GLTFLoader();
  const [speakerGltf, dieGltf] = await Promise.all([
    loader.loadAsync("models/speaker.glb"),
    loader.loadAsync("models/die.glb"),
  ]);

  // Unity's materials, by part.
  const materials = {
    Cone: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.47, 0.47, 0.47), metalness: 1, roughness: 0.51 }),
    Housing: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.51, 0.44, 0.75), metalness: 0.84, roughness: 0.62 }),
    RingOrange: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.72, 0.14) }),
    RingPurple: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 0.24, 1.9) }),
    DieBody: new THREE.MeshStandardMaterial({ color: new THREE.Color(1.0, 0.91, 0.65), metalness: 0.84, roughness: 0.585 }),
    DieGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 0.6, 0.1) }),
  };

  const speaker = speakerGltf.scene;
  let cone = null;
  speaker.traverse((node) => {
    if (!node.isMesh) return;
    const part = ["Cone", "Housing", "RingOrange", "RingPurple"].find((name) => node.name.startsWith(name));
    if (part) node.material = materials[part];
    if (part === "Cone") cone = node;
  });
  scene.add(speaker);
  const coneRestY = cone ? cone.position.y : 0;

  // The die's mesh sits away from its own origin in the source file; centre it on its pivot.
  const die = new THREE.Group();
  const dieModel = dieGltf.scene;
  dieModel.traverse((node) => {
    if (!node.isMesh) return;
    node.material = node.name.startsWith("Glow") ? materials.DieGlow : materials.DieBody;
  });
  const box = new THREE.Box3().setFromObject(dieModel);
  dieModel.position.sub(box.getCenter(new THREE.Vector3()));
  die.add(dieModel);
  scene.add(die);
  const DIE_SIZE = box.getSize(new THREE.Vector3()).x; // 0.366 m, as in the game
  const HALF = DIE_SIZE / 2;

  // Which face carries how many bars, read from the model itself (opposite faces add up to seven).
  const FACES = [
    { axis: new THREE.Vector3(1, 0, 0), value: 6 }, { axis: new THREE.Vector3(-1, 0, 0), value: 1 },
    { axis: new THREE.Vector3(0, 1, 0), value: 5 }, { axis: new THREE.Vector3(0, -1, 0), value: 2 },
    { axis: new THREE.Vector3(0, 0, 1), value: 3 }, { axis: new THREE.Vector3(0, 0, -1), value: 4 },
  ];

  // ── physics: a pan in the shape of the bowl ─────────────────────────────
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.allowSleep = true;
  const dieMaterial = new CANNON.Material("die");
  const panMaterial = new CANNON.Material("pan");
  world.addContactMaterial(new CANNON.ContactMaterial(dieMaterial, panMaterial, { restitution: 0.45, friction: 0.45 }));

  const FLOOR_RADIUS = 0.5, RIM_WIDTH = 0.75, RIM_SLOPE = THREE.MathUtils.degToRad(18), THICK = 0.5;
  const floorY = -HALF; // the die rests with its centre on the game's landing spot
  // The wall keeps a die that is in the bowl from leaving it. The hand is outside the
  // wall, so the die ignores it until it has come in over the rim (see WALL below).
  const PAN = 1, WALL = 2;
  const floor = new CANNON.Body({ type: CANNON.Body.KINEMATIC, material: panMaterial, collisionFilterGroup: PAN });
  const walls = new CANNON.Body({ type: CANNON.Body.STATIC, material: panMaterial, collisionFilterGroup: WALL });
  const reach = FLOOR_RADIUS + RIM_WIDTH;
  floor.addShape(new CANNON.Box(new CANNON.Vec3(reach, THICK / 2, reach)), new CANNON.Vec3(0, floorY - THICK / 2, 0));
  const SEGMENTS = 16;
  for (let i = 0; i < SEGMENTS; i++) {
    const angle = (i / SEGMENTS) * Math.PI * 2;
    const outward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const along = outward.clone().multiplyScalar(Math.cos(RIM_SLOPE)).add(new THREE.Vector3(0, Math.sin(RIM_SLOPE), 0));
    const normal = new THREE.Vector3(0, Math.cos(RIM_SLOPE), 0).sub(outward.clone().multiplyScalar(Math.sin(RIM_SLOPE)));
    const length = 2 * reach * Math.tan(Math.PI / SEGMENTS) + 0.05;
    const tangent = new THREE.Vector3().crossVectors(normal, along);

    const rimCentre = outward.clone().multiplyScalar(FLOOR_RADIUS).add(new THREE.Vector3(0, floorY, 0))
      .add(along.clone().multiplyScalar(RIM_WIDTH / 2)).sub(normal.clone().multiplyScalar(THICK / 2));
    const rimQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, normal, along));
    floor.addShape(new CANNON.Box(new CANNON.Vec3(length / 2, THICK / 2, RIM_WIDTH / 2)),
      new CANNON.Vec3(rimCentre.x, rimCentre.y, rimCentre.z), new CANNON.Quaternion(rimQuat.x, rimQuat.y, rimQuat.z, rimQuat.w));

    const wallCentre = outward.clone().multiplyScalar(reach * Math.cos(RIM_SLOPE) + THICK / 2).add(new THREE.Vector3(0, floorY + 1.4, 0));
    const wallTangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), outward);
    const wallQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(wallTangent, new THREE.Vector3(0, 1, 0), outward));
    walls.addShape(new CANNON.Box(new CANNON.Vec3(length / 2 + 0.1, 1.6, THICK / 2)),
      new CANNON.Vec3(wallCentre.x, wallCentre.y, wallCentre.z), new CANNON.Quaternion(wallQuat.x, wallQuat.y, wallQuat.z, wallQuat.w));
  }
  world.addBody(floor);
  world.addBody(walls);

  const body = new CANNON.Body({
    mass: 0.2, material: dieMaterial, shape: new CANNON.Box(new CANNON.Vec3(HALF, HALF, HALF)),
    linearDamping: 0.05, angularDamping: 0.35, allowSleep: true, sleepSpeedLimit: 0.12, sleepTimeLimit: 0.35,
    collisionFilterMask: PAN,
  });
  const INSIDE = FLOOR_RADIUS + RIM_WIDTH * 0.75; // within this radius the die is over the bowl
  world.addBody(body);

  // ── the turn ────────────────────────────────────────────────────────────
  // held: the die waits in the visitor's hand · flying: on its arc · landing: in the pan · settled: read and reported
  // Where the die waits: low and to the right in front of the camera, as if in the hand.
  const HAND = new THREE.Vector3();
  function placeHand() {
    HAND.set(0.55, -0.8, -4.4);
    camera.updateMatrixWorld();
    camera.localToWorld(HAND);
  }
  let state = "held";
  let moveNumber = 0;
  let kickStart = -1;
  let dragging = false;
  let dragVelocity = new THREE.Vector3();
  let lastDrag = null;
  let idleSpin = 0;
  const dragPlane = new THREE.Plane();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function holdInHand() {
    state = "held";
    body.type = CANNON.Body.KINEMATIC;
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.position.set(HAND.x, HAND.y, HAND.z);
    stage.dataset.state = "held";
  }

  function throwDie(push = new THREE.Vector3()) {
    // A ballistic arc that ends over the cone; how hard the hand moved shifts where.
    const from = new THREE.Vector3(body.position.x, body.position.y, body.position.z);
    const target = new THREE.Vector3(
      THREE.MathUtils.clamp(push.x * 0.12, -0.35, 0.35), 0.9, THREE.MathUtils.clamp(push.z * 0.12, -0.35, 0.35));
    const time = 0.62;
    const velocity = target.clone().sub(from).divideScalar(time);
    velocity.y += 0.5 * 9.81 * time;
    body.type = CANNON.Body.DYNAMIC;
    body.wakeUp();
    body.velocity.set(velocity.x, velocity.y, velocity.z);
    body.angularVelocity.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22);
    state = "flying";
    kickStart = -1;
    stage.dataset.state = "flying";
  }

  body.addEventListener("collide", () => {
    if (state !== "flying") return;
    state = "landing";
    kickStart = clock;        // the cone answers the first impact, once
    stage.dataset.state = "landing";
  });

  function faceUp() {
    const q = new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    let best = FACES[0], bestDot = -Infinity;
    for (const face of FACES) {
      const dot = face.axis.clone().applyQuaternion(q).y;
      if (dot > bestDot) { bestDot = dot; best = face; }
    }
    return best.value;
  }

  // The hint the game shows on its MOVE panel for a roll in the Basic mode, word for word.
  function report(value) {
    moveNumber += 1;
    hud.face.textContent = `face ${value}`;
    hud.move.textContent = `Move number: ${moveNumber}`;
    hud.info.textContent = `You rolled a ${value}. Drop it into a column - equal dice in a column multiply.`;
    stage.dataset.state = "settled";
    throwButton.textContent = "Throw again";
  }

  // The cone's kick: a short, decaying thump. The pan floor follows it, so the cone really throws the die.
  const KICK_SECONDS = 1.0, KICK_HEIGHT = 0.05, KICK_HZ = 5.5;
  function kickOffset(t) {
    if (t < 0 || t > KICK_SECONDS) return 0;
    return KICK_HEIGHT * Math.sin(2 * Math.PI * KICK_HZ * t) * Math.pow(1 - t / KICK_SECONDS, 2);
  }

  // ── input ───────────────────────────────────────────────────────────────
  function setPointer(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }

  canvas.addEventListener("pointerdown", (event) => {
    setPointer(event);
    if (raycaster.intersectObject(die, true).length === 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    dragging = true;
    body.type = CANNON.Body.KINEMATIC;
    body.velocity.setZero();
    body.angularVelocity.setZero();
    state = "held";
    stage.dataset.state = "dragging";
    // Drag on a plane through the die, facing the camera.
    const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
    dragPlane.setFromNormalAndCoplanarPoint(normal, die.position.clone());
    lastDrag = { point: die.position.clone(), time: performance.now() };
    dragVelocity.set(0, 0, 0);
  });

  canvas.addEventListener("pointermove", (event) => {
    setPointer(event);
    if (!dragging) {
      canvas.style.cursor = raycaster.intersectObject(die, true).length ? "grab" : "";
      return;
    }
    const point = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(dragPlane, point)) return;
    point.y = Math.max(point.y, 0.45); // the hand stays above the rim
    const now = performance.now();
    const dt = Math.max((now - lastDrag.time) / 1000, 1 / 240);
    dragVelocity.lerp(point.clone().sub(lastDrag.point).divideScalar(dt), 0.5);
    lastDrag = { point: point.clone(), time: now };
    body.position.set(point.x, point.y, point.z);
    canvas.style.cursor = "grabbing";
  });

  function release(event) {
    if (!dragging) return;
    dragging = false;
    canvas.releasePointerCapture?.(event.pointerId);
    canvas.style.cursor = "";
    throwDie(dragVelocity);
  }
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  // The button does the same throw for keyboards, screen readers and anyone who would rather not drag.
  throwButton.addEventListener("click", () => {
    if (state === "flying" || state === "landing") return;
    holdInHand();
    throwDie(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
  });

  // ── frame loop ──────────────────────────────────────────────────────────
  const wide = window.matchMedia("(min-width: 56.01em)");
  function resize() {
    const width = stage.clientWidth, height = stage.clientHeight;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    // A narrow stage (a phone) steps back so the whole bowl stays in view.
    const pull = THREE.MathUtils.clamp(1.15 / camera.aspect, 1, 1.9);
    camera.position.copy(cameraHome).multiplyScalar(pull);
    camera.lookAt(lookAt);
    // Where the stage is the whole section the panel covers its right side, so the bowl sits left of centre.
    if (wide.matches) camera.setViewOffset(width, height, Math.round(width * 0.19), 0, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    placeHand();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  let visible = true;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.05 }).observe(stage);

  let clock = 0;
  let previous = performance.now();
  let settleTimer = 0;
  holdInHand();
  stage.classList.add("is-live");

  // One step of the table: the cone's kick, the hand, physics, reading the die.
  function tick(dt) {
    clock += dt;

    // The floor of the pan and the cone move together.
    const lift = kickStart >= 0 ? kickOffset(clock - kickStart) : 0;
    const liftNext = kickStart >= 0 ? kickOffset(clock - kickStart + 1 / 60) : 0;
    floor.velocity.set(0, (liftNext - lift) * 60, 0);
    floor.position.set(0, lift, 0);
    if (cone) cone.position.y = coneRestY + lift * 1.6;

    if (state === "held" && !dragging) {
      // Waiting in the hand: it turns slowly so every face shows, unless motion is unwelcome.
      if (!reducedMotion) idleSpin += dt;
      body.position.set(HAND.x, HAND.y + (reducedMotion ? 0 : Math.sin(idleSpin * 1.6) * 0.035), HAND.z);
      body.quaternion.setFromEuler(0.5, idleSpin * 0.7, 0.3);
    }

    // Over the bowl the wall starts to count; in the hand it does not.
    const overBowl = Math.hypot(body.position.x, body.position.z) < INSIDE;
    if (state === "held") body.collisionFilterMask = PAN;
    else if (overBowl) body.collisionFilterMask = PAN | WALL;

    world.step(1 / 60, dt, 3);
    die.position.set(body.position.x, body.position.y, body.position.z);
    die.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);

    if (state === "landing") {
      const still = body.velocity.length() < 0.06 && body.angularVelocity.length() < 0.25 && clock - kickStart > KICK_SECONDS;
      settleTimer = still ? settleTimer + dt : 0;
      const lost = body.position.y < -2 || Math.hypot(body.position.x, body.position.z) > 3;
      if (lost) { holdInHand(); settleTimer = 0; }
      else if (settleTimer > 0.25) { settleTimer = 0; report(faceUp()); state = "settled"; }
    }

    // The orange ring flares with the kick, as the arena does.
    materials.RingOrange.color.setRGB(2.2 + Math.abs(lift) * 40, 0.72 + Math.abs(lift) * 12, 0.14);
    orange.intensity = 4.2 + Math.abs(lift) * 70;
  }

  // ?throw makes the first throw by itself and plays it out at once, so a
  // screenshot (or a test) sees the die at rest and the panel filled in.
  if (new URLSearchParams(location.search).has("throw")) {
    throwButton.click();
    for (let i = 0; i < 900 && state !== "settled"; i++) tick(1 / 60);
  }

  renderer.setAnimationLoop((now) => {
    const dt = Math.min((now - previous) / 1000, 1 / 30);
    previous = now;
    if (!visible) return; // nothing is drawn or simulated while the table is off screen
    tick(dt);
    composer.render();
  });
}
