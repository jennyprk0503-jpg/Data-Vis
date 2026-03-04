/**
 * gestures.js — Gesture recognition and movement commands for "Embers"
 *
 * Detection approach (scale-invariant):
 *  - OPEN FINGER: tip.y < pip.y  (fingertip is above the mid-joint in image space)
 *  - CURLED FINGER: tip.y > pip.y (fingertip has folded below mid-joint)
 *  This works regardless of hand size or distance from camera.
 *
 * Navigation:
 *  Gallery Mode — open palm:
 *    Any palm visible → move forward
 *    No hands / fists → stop
 *  Demo Mode — fists:
 *    Right fist → strafe right, Left fist → strafe left, Both → forward
 *
 * Stability: CONFIRM_FRAMES consecutive detections required to confirm.
 * Pinch cooldown: PINCH_COOLDOWN_MS between select fires.
 */

'use strict';

window.EmberGestures = (function () {

  // ── Thresholds ─────────────────────────────────────────────────────────────

  // Pinch: 3D distance between thumb tip (4) and index tip (8), normalized coords
  // Raise if pinch fires too easily; lower if it never fires.
  const PINCH_THRESHOLD = 0.07;

  // Minimum fingers extended to call a hand "open palm" (out of 4 non-thumb fingers)
  // Lower = more lenient (3 fingers = palm), raise to 4 if false positives
  const PALM_MIN_FINGERS = 3;

  // Maximum fingers extended to call a hand a "fist"
  const FIST_MAX_FINGERS = 1;

  // Frame smoothing: consecutive frames needed to confirm a gesture.
  // Lower = faster response; higher = more stable. Was 5, now 3.
  const CONFIRM_FRAMES = 3;

  // Faster drop-off: frames subtracted per non-detected frame
  const DROP_FRAMES = 2;

  // Pinch cooldown in ms — prevents double-select
  const PINCH_COOLDOWN_MS = 600;

  // ── State ──────────────────────────────────────────────────────────────────

  let gestureMode = 'gallery';

  // Rolling frame counts (incremented on detection, decremented on absence)
  const frameCount = {
    leftFist: 0, rightFist: 0,
    leftPalm: 0, rightPalm: 0,
    pinch: 0,
  };

  // Smoothed confirmed states
  const confirmed = {
    leftFist: false, rightFist: false,
    leftPalm: false, rightPalm: false,
    pinch: false,
  };

  let lastPinchTime = 0;
  let pinchFired = false;
  let onPinchCb = null;

  let moveIntent = { forward: 0, strafe: 0 };

  let debugState = {
    handsCount: 0,
    leftFist: false, rightFist: false, bothFists: false,
    leftPalm: false, rightPalm: false, bothPalms: false,
    pinch: false,
  };

  // ── Init ───────────────────────────────────────────────────────────────────

  function init(onPinch) {
    onPinchCb = onPinch;
  }

  function setMode(mode) {
    gestureMode = mode;
    Object.keys(frameCount).forEach(k => { frameCount[k] = 0; });
    Object.keys(confirmed).forEach(k => { confirmed[k] = false; });
  }

  // ── Main update ────────────────────────────────────────────────────────────

  function update(hands) {
    debugState.handsCount = hands.length;

    let leftHand = null, rightHand = null;
    hands.forEach(h => {
      if (h.label === 'Left')  leftHand  = h.landmarks;
      if (h.label === 'Right') rightHand = h.landmarks;
    });

    // Raw single-frame detections
    const raw = {
      leftFist:  leftHand  ? isFist(leftHand)     : false,
      rightFist: rightHand ? isFist(rightHand)    : false,
      leftPalm:  leftHand  ? isOpenPalm(leftHand)  : false,
      rightPalm: rightHand ? isOpenPalm(rightHand) : false,
      pinch: (leftHand  && isPinch(leftHand)) ||
             (rightHand && isPinch(rightHand)),
    };

    // Apply frame smoothing (hysteresis buffer)
    Object.keys(frameCount).forEach(key => {
      if (raw[key]) {
        frameCount[key] = Math.min(frameCount[key] + 1, CONFIRM_FRAMES + 4);
      } else {
        frameCount[key] = Math.max(frameCount[key] - DROP_FRAMES, 0);
      }
      confirmed[key] = frameCount[key] >= CONFIRM_FRAMES;
    });

    const bothFists = confirmed.leftFist && confirmed.rightFist;
    const bothPalms = confirmed.leftPalm && confirmed.rightPalm;
    const anyPalm   = confirmed.leftPalm || confirmed.rightPalm;

    // Update debug
    debugState.leftFist  = confirmed.leftFist;
    debugState.rightFist = confirmed.rightFist;
    debugState.bothFists = bothFists;
    debugState.leftPalm  = confirmed.leftPalm;
    debugState.rightPalm = confirmed.rightPalm;
    debugState.bothPalms = bothPalms;
    debugState.pinch     = confirmed.pinch;

    // ── Movement intent ──────────────────────────────────────────────────────

    moveIntent.forward = 0;
    moveIntent.strafe  = 0;

    if (gestureMode === 'gallery') {
      // ANY open palm → move forward (most intuitive)
      // Strafe: one palm present, specifically left or right only
      if (anyPalm) {
        if (bothPalms) {
          // Both palms → go forward
          moveIntent.forward = 1;
        } else if (confirmed.rightPalm && !confirmed.leftPalm) {
          // Right only → strafe right
          moveIntent.strafe = 1;
        } else if (confirmed.leftPalm && !confirmed.rightPalm) {
          // Left only → strafe left
          moveIntent.strafe = -1;
        }
      }
      // No palm / fists / no hands → stop (moveIntent stays 0)

    } else {
      // Demo Mode: fist gestures
      if (bothFists) {
        moveIntent.forward = 1;
      } else if (confirmed.rightFist && !confirmed.leftFist) {
        moveIntent.strafe = 1;
      } else if (confirmed.leftFist && !confirmed.rightFist) {
        moveIntent.strafe = -1;
      }
    }

    // ── Pinch ────────────────────────────────────────────────────────────────

    const now = performance.now();
    if (confirmed.pinch && !pinchFired) {
      if (now - lastPinchTime > PINCH_COOLDOWN_MS) {
        lastPinchTime = now;
        pinchFired = true;
        if (onPinchCb) onPinchCb();
      }
    }
    if (!confirmed.pinch) pinchFired = false;
  }

  // ── Gesture detectors (scale-invariant) ───────────────────────────────────

  /**
   * Open palm: count how many non-thumb fingers are extended.
   * A finger is "extended" when its tip is ABOVE its PIP joint in image space
   * (tip.y < pip.y, since y=0 is top of image in MediaPipe normalized coords).
   *
   * This is scale-invariant — works at any hand distance from camera.
   */
  function isOpenPalm(lm) {
    // [tip_index, pip_index] for each finger (index, middle, ring, pinky)
    const fingers = [[8, 6], [12, 10], [16, 14], [20, 18]];
    let extended = 0;
    fingers.forEach(([tip, pip]) => {
      // tip.y < pip.y → tip is higher in the image → finger is extended upward
      if (lm[tip].y < lm[pip].y) extended++;
    });
    return extended >= PALM_MIN_FINGERS; // at least 3 of 4 fingers open
  }

  /**
   * Fist: most fingers are curled — tip is BELOW (higher y) their PIP joint.
   */
  function isFist(lm) {
    const fingers = [[8, 6], [12, 10], [16, 14], [20, 18]];
    let extended = 0;
    fingers.forEach(([tip, pip]) => {
      if (lm[tip].y < lm[pip].y) extended++;
    });
    // A fist has at most FIST_MAX_FINGERS extended
    return extended <= FIST_MAX_FINGERS;
  }

  /**
   * Pinch: thumb tip (4) close to index tip (8).
   * Uses 3D distance for better accuracy (MediaPipe provides z-depth estimate).
   */
  function isPinch(lm) {
    const t = lm[4], i = lm[8];
    const dx = t.x - i.x, dy = t.y - i.y, dz = (t.z || 0) - (i.z || 0);
    return Math.sqrt(dx*dx + dy*dy + dz*dz) < PINCH_THRESHOLD;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    init,
    update,
    setMode,
    getMoveIntent: () => ({ ...moveIntent }),
    getDebugState: () => ({ ...debugState }),
    getConfirmed:  () => ({ ...confirmed }),
  };

})();
