/**
 * interaction.js — Raycast selection and camera movement for "Embers"
 *
 * Handles:
 *  - First-person camera movement with smooth acceleration/deceleration
 *  - Room bounds clamping
 *  - Raycast from camera center → candle hit detection
 *  - Proximity check (must be < 1.5m from candle to select)
 *  - Candle highlight state management
 *  - Pinch selection → triggers UI panel
 */

'use strict';

window.EmberInteraction = (function () {

  // ── Movement config ────────────────────────────────────────────────────────

  // Walking speed in world units per second
  const WALK_SPEED = 3.5;

  // Strafe speed (slightly slower than forward)
  const STRAFE_SPEED = 2.8;

  // Smoothing: acceleration factor — raised for snappier gesture response
  // 0 = instant snap, 1 = never reaches target
  const ACCEL = 0.18;

  // Deceleration: how fast velocity drops when intent is 0
  const DECEL = 0.80;

  // Room bounds — matches scene.js ROOM constants
  // Camera stays inside these margins
  const BOUNDS = {
    xMin: -8.5,
    xMax:  8.5,
    zMin: -39,
    zMax:  1.0,  // allow camera slightly past entrance
  };

  // Eye height
  const EYE_HEIGHT = 1.65;

  // Candle selection proximity (world units)
  const SELECT_DISTANCE = 1.5; // < this → can select

  // Highlight proximity (world units) — show reticle hit but not yet close enough
  const HIGHLIGHT_DISTANCE = 8.0; // show highlight when looking at candle within this dist

  // ── State ──────────────────────────────────────────────────────────────────

  let camera = null;
  let candles = null; // ref to EmberScene.getCandles()

  // Current velocity (world units/s)
  let velForward = 0;
  let velStrafe  = 0;

  // Raycaster (reused each frame)
  const raycaster = new THREE.Raycaster();

  // Currently highlighted candle object
  let highlightedCandle = null;

  // Currently selected candle object
  let selectedCandle = null;

  // Callback when a candle is selected
  let onSelectCb = null;

  // ── Init ───────────────────────────────────────────────────────────────────

  function init(cam, getCandlesFn, onSelect) {
    camera = cam;
    candles = getCandlesFn;
    onSelectCb = onSelect;
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  function update(deltaTime, moveIntent) {
    updateMovement(deltaTime, moveIntent);
    updateRaycast();
  }

  // ── Camera movement ────────────────────────────────────────────────────────

  function updateMovement(deltaTime, moveIntent) {
    // Target velocities from gesture intent
    const targetForward = moveIntent.forward * WALK_SPEED;
    const targetStrafe  = moveIntent.strafe  * STRAFE_SPEED;

    // Smooth acceleration toward target
    if (moveIntent.forward !== 0) {
      velForward += (targetForward - velForward) * ACCEL;
    } else {
      velForward *= DECEL;
      if (Math.abs(velForward) < 0.01) velForward = 0;
    }

    if (moveIntent.strafe !== 0) {
      velStrafe += (targetStrafe - velStrafe) * ACCEL;
    } else {
      velStrafe *= DECEL;
      if (Math.abs(velStrafe) < 0.01) velStrafe = 0;
    }

    // Camera-relative directions (uses camera's facing direction)
    const forward = new THREE.Vector3();
    const right   = new THREE.Vector3();

    // Get forward (where camera is looking, projected onto XZ plane)
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    // Right is perpendicular on XZ plane
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    // Compute displacement
    const move = new THREE.Vector3();
    move.addScaledVector(forward, velForward * deltaTime);
    move.addScaledVector(right,   velStrafe  * deltaTime);

    // Apply movement
    camera.position.x += move.x;
    camera.position.z += move.z;

    // Keep eye at correct height
    camera.position.y = EYE_HEIGHT;

    // Clamp to room bounds
    camera.position.x = Math.max(BOUNDS.xMin, Math.min(BOUNDS.xMax, camera.position.x));
    camera.position.z = Math.max(BOUNDS.zMin, Math.min(BOUNDS.zMax, camera.position.z));
  }

  // ── Raycast + highlight ────────────────────────────────────────────────────

  function updateRaycast() {
    const candleList = candles();
    if (!candleList || candleList.length === 0) return;

    // Cast ray from camera center (screen center = normalized 0,0)
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    // Collect all candle meshes for intersection test
    const meshes = candleList.map(c => c.candleMesh);
    const hits = raycaster.intersectObjects(meshes, false);

    // Find which candle object owns the hit mesh
    let newHighlight = null;
    if (hits.length > 0) {
      const hitMesh = hits[0].object;
      const candleObj = candleList.find(c => c.candleMesh === hitMesh);
      if (candleObj) {
        // Distance from camera to candle group position
        const dist = camera.position.distanceTo(candleObj.group.position);
        if (dist < HIGHLIGHT_DISTANCE) {
          newHighlight = candleObj;
        }
      }
    }

    // Update highlight state
    if (newHighlight !== highlightedCandle) {
      if (highlightedCandle) {
        EmberScene.setHighlight(highlightedCandle, false);
      }
      highlightedCandle = newHighlight;
      if (highlightedCandle) {
        EmberScene.setHighlight(highlightedCandle, true);
      }
    }

    // Update reticle visual (show "hit" state)
    const reticle = document.getElementById('reticle');
    if (reticle) {
      if (highlightedCandle) {
        reticle.classList.add('hit');
      } else {
        reticle.classList.remove('hit');
      }
    }
  }

  // ── Pinch selection ────────────────────────────────────────────────────────

  function trySelect() {
    if (!highlightedCandle) return;

    // Proximity check: must be within SELECT_DISTANCE
    const dist = camera.position.distanceTo(highlightedCandle.group.position);
    if (dist > SELECT_DISTANCE) {
      // Too far — provide a visual nudge but don't open panel
      // Could add a brief UI hint here
      return;
    }

    selectedCandle = highlightedCandle;
    if (onSelectCb) onSelectCb(selectedCandle.data);
  }

  function deselect() {
    selectedCandle = null;
    if (onSelectCb) onSelectCb(null);
  }

  // ── Mouse look (for keyboard/mouse fallback navigation) ──────────────────

  let mouseLookEnabled = false;
  let yaw = 0;   // horizontal rotation (degrees)
  let pitch = 0; // vertical rotation

  function enableMouseLook() {
    mouseLookEnabled = true;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
  }

  const keys = {};

  function onKeyDown(e) {
    keys[e.code] = true;
  }

  function onKeyUp(e) {
    keys[e.code] = false;
  }

  function onMouseMove(e) {
    if (!mouseLookEnabled) return;
    // Only rotate if left mouse button held
    if (e.buttons !== 1) return;
    yaw   -= e.movementX * 0.15;
    pitch -= e.movementY * 0.15;
    pitch  = Math.max(-60, Math.min(60, pitch));
    applyRotation();
  }

  function applyRotation() {
    camera.rotation.order = 'YXZ';
    camera.rotation.y = THREE.MathUtils.degToRad(yaw);
    camera.rotation.x = THREE.MathUtils.degToRad(pitch);
  }

  // ── Keyboard movement (fallback for no webcam) ────────────────────────────

  function getKeyboardIntent() {
    let forward = 0, strafe = 0;
    if (keys['KeyW'] || keys['ArrowUp'])    forward =  1;
    if (keys['KeyS'] || keys['ArrowDown'])  forward = -1;
    if (keys['KeyA'] || keys['ArrowLeft'])  strafe  = -1;
    if (keys['KeyD'] || keys['ArrowRight']) strafe  =  1;
    // Note: D key is also used for debug toggle — handled in main.js
    return { forward, strafe };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    init,
    update,
    trySelect,
    deselect,
    enableMouseLook,
    getKeyboardIntent,
    getHighlightedCandle: () => highlightedCandle,
    getSelectedCandle: () => selectedCandle,
  };

})();
