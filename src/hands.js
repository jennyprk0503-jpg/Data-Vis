/**
 * hands.js — MediaPipe Hands integration for "Embers"
 *
 * Manages:
 *  - Webcam stream acquisition
 *  - MediaPipe Hands model initialization
 *  - Per-frame landmark delivery to gestures.js
 *  - Landmark visualization on the corner preview canvas
 */

'use strict';

window.EmberHands = (function () {

  // ── Config ─────────────────────────────────────────────────────────────────

  // MediaPipe landmark indices
  const LM = {
    WRIST: 0,
    THUMB_CMC: 1,
    THUMB_MCP: 2,
    THUMB_IP: 3,
    THUMB_TIP: 4,
    INDEX_MCP: 5,
    INDEX_PIP: 6,
    INDEX_DIP: 7,
    INDEX_TIP: 8,
    MIDDLE_MCP: 9,
    MIDDLE_PIP: 10,
    MIDDLE_DIP: 11,
    MIDDLE_TIP: 12,
    RING_MCP: 13,
    RING_PIP: 14,
    RING_DIP: 15,
    RING_TIP: 16,
    PINKY_MCP: 17,
    PINKY_PIP: 18,
    PINKY_DIP: 19,
    PINKY_TIP: 20,
  };

  // ── State ──────────────────────────────────────────────────────────────────

  let handsModel = null;
  let camera = null; // MediaPipe Camera helper
  let videoEl = null;
  let previewCanvas = null;
  let previewCtx = null;

  // Latest hand data from MediaPipe callback
  let latestResults = null;

  // Callback to deliver results to gestures module
  let onResultsCb = null;

  // Whether the webcam/MediaPipe is active
  let active = false;

  // ── Init ───────────────────────────────────────────────────────────────────

  function init(onResults) {
    onResultsCb = onResults;

    videoEl = document.getElementById('webcam-video');
    previewCanvas = document.getElementById('landmark-canvas');
    previewCtx = previewCanvas.getContext('2d');

    // Wait for MediaPipe to be available
    waitForMediaPipe(() => startMediaPipe());
  }

  function waitForMediaPipe(cb, tries = 0) {
    if (typeof Hands !== 'undefined' && typeof Camera !== 'undefined') {
      cb();
      return;
    }
    if (tries > 100) {
      console.warn('MediaPipe not available — gesture navigation disabled.');
      return;
    }
    setTimeout(() => waitForMediaPipe(cb, tries + 1), 100);
  }

  function startMediaPipe() {
    // Initialize MediaPipe Hands
    handsModel = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
      }
    });

    handsModel.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,     // 0=lite, 1=full — change to 0 for performance
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.55,
    });

    handsModel.onResults(handleResults);

    // Start webcam via MediaPipe Camera utility
    camera = new Camera(videoEl, {
      onFrame: async () => {
        if (handsModel) {
          await handsModel.send({ image: videoEl });
        }
      },
      width: 320,  // low res for performance
      height: 240,
    });

    camera.start()
      .then(() => {
        active = true;
        console.log('MediaPipe Hands active.');
      })
      .catch((err) => {
        console.warn('Webcam unavailable:', err);
        // App continues without gesture navigation
      });
  }

  // ── Results handler ────────────────────────────────────────────────────────

  function handleResults(results) {
    latestResults = results;

    // Draw landmark overlay on preview canvas
    drawPreview(results);

    // Deliver processed hand data to gestures module
    if (onResultsCb) {
      onResultsCb(parseHands(results));
    }
  }

  function parseHands(results) {
    const hands = [];

    if (!results.multiHandLandmarks || !results.multiHandedness) {
      return hands;
    }

    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
      const landmarks = results.multiHandLandmarks[i];
      const handedness = results.multiHandedness[i];

      // MediaPipe reports handedness from the MODEL's perspective (mirrored).
      // Since webcam is mirrored for user, we flip the label so it matches
      // the user's actual left/right.
      const rawLabel = handedness.label; // 'Left' or 'Right'
      const label = rawLabel === 'Left' ? 'Right' : 'Left'; // corrected for mirror

      hands.push({
        label,           // 'Left' | 'Right' (from user's perspective)
        score: handedness.score,
        landmarks,       // array of 21 {x, y, z} in [0,1] normalized coords
        lm: landmarks,   // alias for convenience
      });
    }

    return hands;
  }

  // ── Preview canvas drawing ─────────────────────────────────────────────────

  function drawPreview(results) {
    if (!previewCanvas || !previewCtx) return;

    // Size the canvas to match its display size
    const pw = previewCanvas.clientWidth || 120;
    const ph = previewCanvas.clientHeight || 90;
    if (previewCanvas.width !== pw) previewCanvas.width = pw;
    if (previewCanvas.height !== ph) previewCanvas.height = ph;

    previewCtx.clearRect(0, 0, pw, ph);

    if (!results.multiHandLandmarks) return;

    results.multiHandLandmarks.forEach((landmarks, hi) => {
      const color = hi === 0 ? '#ff9944' : '#44aaff';

      // Draw connections
      if (typeof drawConnectors !== 'undefined' && typeof HAND_CONNECTIONS !== 'undefined') {
        drawConnectors(previewCtx, landmarks, HAND_CONNECTIONS, {
          color: color + '88',
          lineWidth: 1,
        });
        // Scale landmarks to canvas size (MediaPipe drawing_utils uses normalized coords)
        drawLandmarks(previewCtx, landmarks, {
          color,
          lineWidth: 1,
          radius: 1.5,
        });
      } else {
        // Fallback: manual dot drawing
        landmarks.forEach((lm) => {
          previewCtx.beginPath();
          previewCtx.arc(lm.x * pw, lm.y * ph, 2, 0, Math.PI * 2);
          previewCtx.fillStyle = color;
          previewCtx.fill();
        });
      }
    });
  }

  // ── Public landmark accessors ──────────────────────────────────────────────

  function getLatestResults() {
    return latestResults;
  }

  function isActive() {
    return active;
  }

  return {
    init,
    getLatestResults,
    isActive,
    LM,
  };

})();
