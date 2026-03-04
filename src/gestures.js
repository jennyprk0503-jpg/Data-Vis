/**
 * gestures.js — Gesture recognition and movement commands for "Embers"
 *
 * Detects:
 *  Gallery Mode: open palm (both = forward, right only = strafe right, left only = strafe left)
 *  Demo Mode:    fist (right = strafe right, left = strafe left, both = forward)
 *  Pinch:        thumb tip near index tip (either hand)
 *
 * Stability features:
 *  - Frame smoothing: N consecutive frames required to confirm a gesture
 *  - Pinch cooldown: prevents double-fires
 *  - Deadzone: ignores borderline detections
 */

'use strict';

window.EmberGestures = (function () {

  // ── Thresholds ─────────────────────────────────────────────────────────────

  // Pinch: distance between thumb tip and index tip (normalized 0–1)
  const PINCH_THRESHOLD = 0.07;       // < this = pinch detected
  const PINCH_DEADZONE  = 0.10;       // > this = definitely not pinch (hysteresis)

  // Fist: average finger curl — how close fingertips are to palm
  // Distance from tip to wrist < FIST_THRESHOLD (normalized) = fist
  const FIST_THRESHOLD  = 0.30;

  // Palm open: all fingertips extended away from palm
  // Average tip-to-wrist > PALM_THRESHOLD = open palm
  const PALM_THRESHOLD  = 0.45;

  // Palm facing camera: z-depth of wrist relative to fingertips
  // If wrist.z > middle_tip.z by this much, hand faces camera
  const PALM_FACING_Z   = 0.04;

  // Frame smoothing: require this many consecutive frames to confirm
  // Increase for more stability, decrease for faster response.
  const CONFIRM_FRAMES  = 5;

  // Pinch cooldown in milliseconds (prevents double-select)
  const PINCH_COOLDOWN_MS = 600;

  // ── State ──────────────────────────────────────────────────────────────────

  // Gesture mode: 'gallery' | 'demo'
  let gestureMode = 'gallery';

  // Frame counters for each gesture (smoothing buffers)
  const frameCount = {
    leftFist:   0,
    rightFist:  0,
    leftPalm:   0,
    rightPalm:  0,
    pinch:      0,
  };

  // Confirmed (smoothed) gesture states
  const confirmed = {
    leftFist:   false,
    rightFist:  false,
    leftPalm:   false,
    rightPalm:  false,
    pinch:      false,
  };

  // Pinch timing
  let lastPinchTime = 0;
  let pinchFired    = false; // tracks if we've already fired for this pinch hold

  // Latest movement intent (consumed by main.js each frame)
  let moveIntent = { forward: 0, strafe: 0 }; // values: -1, 0, +1

  // Pinch callback
  let onPinchCb = null;

  // Debug state output (read by ui.js)
  let debugState = {
    handsCount: 0,
    leftFist: false,
    rightFist: false,
    bothFists: false,
    leftPalm: false,
    rightPalm: false,
    bothPalms: false,
    pinch: false,
  };

  // ── Public init ────────────────────────────────────────────────────────────

  function init(onPinch) {
    onPinchCb = onPinch;
  }

  function setMode(mode) {
    gestureMode = mode;
    // Reset counters on mode switch
    Object.keys(frameCount).forEach(k => frameCount[k] = 0);
    Object.keys(confirmed).forEach(k => confirmed[k] = false);
  }

  // ── Main update (called each frame with latest hand data) ─────────────────

  function update(hands) {
    // hands: array from EmberHands.parseHands — [{label, landmarks}, ...]

    debugState.handsCount = hands.length;

    // Find left and right hand landmarks
    let leftHand  = null;
    let rightHand = null;
    hands.forEach(h => {
      if (h.label === 'Left')  leftHand  = h.landmarks;
      if (h.label === 'Right') rightHand = h.landmarks;
    });

    // Raw gesture detection this frame
    const raw = {
      leftFist:  leftHand  ? isFist(leftHand)  : false,
      rightFist: rightHand ? isFist(rightHand) : false,
      leftPalm:  leftHand  ? isOpenPalm(leftHand)  : false,
      rightPalm: rightHand ? isOpenPalm(rightHand) : false,
      pinch: (leftHand  && isPinch(leftHand))  ||
             (rightHand && isPinch(rightHand)),
    };

    // Apply frame smoothing
    Object.keys(frameCount).forEach(key => {
      if (raw[key]) {
        frameCount[key] = Math.min(frameCount[key] + 1, CONFIRM_FRAMES + 2);
      } else {
        frameCount[key] = Math.max(frameCount[key] - 2, 0); // faster drop-off
      }
      confirmed[key] = frameCount[key] >= CONFIRM_FRAMES;
    });

    // Derived states
    const bothFists = confirmed.leftFist && confirmed.rightFist;
    const bothPalms = confirmed.leftPalm && confirmed.rightPalm;

    // Update debug state
    debugState.leftFist   = confirmed.leftFist;
    debugState.rightFist  = confirmed.rightFist;
    debugState.bothFists  = bothFists;
    debugState.leftPalm   = confirmed.leftPalm;
    debugState.rightPalm  = confirmed.rightPalm;
    debugState.bothPalms  = bothPalms;
    debugState.pinch      = confirmed.pinch;

    // ── Movement intent ──────────────────────────────────────────────────────

    moveIntent.forward = 0;
    moveIntent.strafe  = 0;

    if (gestureMode === 'gallery') {
      // Gallery Mode: open palm gestures
      // Both palms → move forward
      if (bothPalms) {
        moveIntent.forward = 1;
      }
      // Right palm only → strafe right
      else if (confirmed.rightPalm && !confirmed.leftPalm) {
        moveIntent.strafe = 1;
      }
      // Left palm only → strafe left
      else if (confirmed.leftPalm && !confirmed.rightPalm) {
        moveIntent.strafe = -1;
      }
      // Otherwise stop (hands out of frame or no recognized gesture)

    } else {
      // Demo Mode: fist gestures
      // Both fists → move forward
      if (bothFists) {
        moveIntent.forward = 1;
      }
      // Right fist only → strafe right
      else if (confirmed.rightFist && !confirmed.leftFist) {
        moveIntent.strafe = 1;
      }
      // Left fist only → strafe left
      else if (confirmed.leftFist && !confirmed.rightFist) {
        moveIntent.strafe = -1;
      }
    }

    // ── Pinch firing ─────────────────────────────────────────────────────────
    const now = performance.now();
    if (confirmed.pinch && !pinchFired) {
      // Cooldown check (600ms — adjust PINCH_COOLDOWN_MS above)
      if (now - lastPinchTime > PINCH_COOLDOWN_MS) {
        lastPinchTime = now;
        pinchFired = true;
        if (onPinchCb) onPinchCb();
      }
    }
    if (!confirmed.pinch) {
      pinchFired = false; // reset so next pinch can fire
    }
  }

  // ── Low-level gesture detectors ───────────────────────────────────────────

  /**
   * Fist: all four fingertips are close to the wrist.
   * Measured as average of tip-to-wrist distances (normalized image coords).
   */
  function isFist(lm) {
    const wrist = lm[0];
    // Check index, middle, ring, pinky tips
    const tipIndices = [8, 12, 16, 20];
    let sum = 0;
    tipIndices.forEach(idx => {
      sum += dist2D(lm[idx], wrist);
    });
    const avg = sum / tipIndices.length;
    return avg < FIST_THRESHOLD;
  }

  /**
   * Open Palm: all fingertips are well away from the wrist.
   * Uses average tip-to-wrist distance.
   */
  function isOpenPalm(lm) {
    const wrist = lm[0];
    const tipIndices = [8, 12, 16, 20];
    let sum = 0;
    tipIndices.forEach(idx => {
      sum += dist2D(lm[idx], wrist);
    });
    const avg = sum / tipIndices.length;
    return avg > PALM_THRESHOLD;
  }

  /**
   * Pinch: thumb tip (4) and index tip (8) are very close.
   * Uses 3D distance including z-depth for better accuracy.
   */
  function isPinch(lm) {
    const thumbTip = lm[4];
    const indexTip = lm[8];
    const d = dist3D(thumbTip, indexTip);
    return d < PINCH_THRESHOLD;
  }

  // ── Distance helpers ──────────────────────────────────────────────────────

  function dist2D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function dist3D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = (a.z || 0) - (b.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    init,
    update,
    setMode,
    getMoveIntent: () => ({ ...moveIntent }),
    getDebugState: () => ({ ...debugState }),
    getConfirmed: () => ({ ...confirmed }),
  };

})();
