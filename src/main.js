/**
 * main.js — Entry point and render loop for "Embers"
 *
 * Orchestrates:
 *  - Data loading (disasters.json)
 *  - Module initialization (scene, hands, gestures, interaction, ui)
 *  - Ambient audio (Web Audio API, procedural tone — no external files)
 *  - Main render loop (requestAnimationFrame)
 *  - Global event wiring (gesture mode toggle, keyboard)
 */

'use strict';

(function () {

  // ── Constants ──────────────────────────────────────────────────────────────

  const DATA_URL = 'data/disasters.json';

  // ── State ──────────────────────────────────────────────────────────────────

  let clock;
  let gestureMode = 'gallery';
  let audioCtx = null;
  let audioStarted = false;

  // ── Boot ───────────────────────────────────────────────────────────────────

  async function boot() {
    // 1. Load disaster data
    let data;
    try {
      const resp = await fetch(DATA_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      data = await resp.json();
    } catch (err) {
      console.warn('Could not load disasters.json, using fallback data.', err);
      data = getFallbackData();
    }

    // 2. Initialize Three.js scene
    const container = document.getElementById('canvas-container');
    const { renderer, scene, camera } = EmberScene.init(container);

    // 3. Build candles from data
    EmberScene.buildCandles(data);

    // 4. Initialize UI
    EmberUI.init();

    // 5. Initialize interaction (raycast + movement)
    EmberInteraction.init(
      camera,
      EmberScene.getCandles,
      (record) => {
        if (record) {
          EmberUI.showPanel(record);
        } else {
          EmberUI.closePanel();
        }
      }
    );

    // Enable mouse-drag look as keyboard/mouse fallback
    EmberInteraction.enableMouseLook();

    // 6. Initialize gesture recognition
    EmberGestures.init(() => {
      // Pinch fired — attempt candle selection
      EmberInteraction.trySelect();
    });

    // 7. Initialize hand tracking (MediaPipe)
    EmberHands.init((hands) => {
      EmberGestures.update(hands);
    });

    // 8. Wire global mode toggle
    window.setGestureMode = (mode) => {
      gestureMode = mode;
      EmberGestures.setMode(mode);
      EmberUI.setModeButton(mode);
    };

    // 9. Keyboard shortcuts
    document.addEventListener('keydown', onGlobalKey);

    // 10. Clock
    clock = new THREE.Clock();

    // 11. Hide loading screen
    EmberUI.hideLoading();

    // 12. Start ambient audio on first interaction
    document.addEventListener('click', startAudio, { once: true });
    document.addEventListener('keydown', startAudio, { once: true });

    // 13. Begin render loop
    requestAnimationFrame(renderLoop);

    console.log(`Embers: ${data.length} candles loaded.`);
  }

  // ── Render loop ────────────────────────────────────────────────────────────

  function renderLoop() {
    requestAnimationFrame(renderLoop);

    const deltaTime = Math.min(clock.getDelta(), 0.1); // cap at 100ms

    // Gesture movement intent (from hand gestures)
    const gestureIntent = EmberGestures.getMoveIntent();

    // Keyboard fallback intent (always merge; gesture takes precedence if active)
    const keyboardIntent = EmberInteraction.getKeyboardIntent();

    // Combine: gesture overrides keyboard if any gesture motion is detected
    const hasGesture = gestureIntent.forward !== 0 || gestureIntent.strafe !== 0;
    const moveIntent = hasGesture ? gestureIntent : keyboardIntent;

    // Update movement and raycast
    EmberInteraction.update(deltaTime, moveIntent);

    // Animate candle flames
    EmberScene.updateFlicker(deltaTime);

    // FPS tracking
    const fps = EmberUI.tickFps(deltaTime);

    // Update debug HUD
    const debugState = EmberGestures.getDebugState();
    EmberUI.updateDebug(debugState, fps);

    // Render
    const renderer = EmberScene.getRenderer();
    const scene    = EmberScene.getScene();
    const camera   = EmberScene.getCamera();
    renderer.render(scene, camera);
  }

  // ── Global key handler ─────────────────────────────────────────────────────

  function onGlobalKey(e) {
    // Escape closes panel
    if (e.code === 'Escape') {
      EmberUI.closePanel();
      EmberInteraction.deselect();
    }
    // D is handled in ui.js for debug toggle
  }

  // ── Ambient audio (procedural, no external files) ─────────────────────────

  function startAudio() {
    if (audioStarted) return;
    audioStarted = true;

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      buildAmbience(audioCtx);
    } catch (err) {
      console.warn('Audio unavailable:', err);
    }
  }

  /**
   * Procedural ambient room tone:
   *  - Pink-ish noise filtered to a low hum (~80Hz)
   *  - Very low volume, reverberant feel
   *
   * No external audio files needed.
   * To replace: swap this for an AudioBufferSourceNode loading an .mp3/.ogg file.
   */
  function buildAmbience(ctx) {
    const bufferSize = ctx.sampleRate * 4; // 4-second noise buffer
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data   = buffer.getChannelData(0);

    // Generate white noise
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }

    // Source: loop the noise buffer
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // Low-pass filter: cut everything above ~120Hz for a low room hum
    const lpf = ctx.createBiquadFilter();
    lpf.type      = 'lowpass';
    lpf.frequency.value = 120;
    lpf.Q.value   = 0.8;

    // Second narrow-band filter around 80Hz for "room tone" resonance
    const peak = ctx.createBiquadFilter();
    peak.type      = 'peaking';
    peak.frequency.value = 80;
    peak.gain.value      = 8;
    peak.Q.value         = 2;

    // Gain: very quiet
    const gain = ctx.createGain();
    gain.gain.value = 0.025;

    // Chain: source → lpf → peak → gain → output
    source.connect(lpf);
    lpf.connect(peak);
    peak.connect(gain);
    gain.connect(ctx.destination);

    source.start();

    // Slow gain fade-in (2s)
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.025, ctx.currentTime + 2);
  }

  // ── Fallback data (used if fetch fails) ───────────────────────────────────

  function getFallbackData() {
    return [
      { id:1, name:"1931 China Floods", year:1931, type:"flood", deathToll:3700000, durationDays:180, longitude:114.3, description:"The deadliest natural disaster in recorded history. Seasonal floods across central China inundated an area the size of England." },
      { id:2, name:"1970 Bhola Cyclone", year:1970, type:"storm", deathToll:500000, durationDays:3, longitude:90.0, description:"The deadliest tropical cyclone on record struck East Pakistan (now Bangladesh)." },
      { id:3, name:"1976 Tangshan Earthquake", year:1976, type:"earthquake", deathToll:242000, durationDays:1, longitude:118.2, description:"A 7.6 magnitude earthquake struck Tangshan while residents slept, leveling nearly the entire city." },
      { id:4, name:"2004 Indian Ocean Tsunami", year:2004, type:"tsunami", deathToll:227898, durationDays:1, longitude:95.8, description:"A 9.1 magnitude earthquake generated waves up to 30 meters, striking 14 countries." },
      { id:5, name:"2010 Haiti Earthquake", year:2010, type:"earthquake", deathToll:316000, durationDays:1, longitude:-72.3, description:"A catastrophic 7.0 magnitude earthquake struck near Port-au-Prince, leaving 1.5 million homeless." },
      { id:6, name:"1918 Spanish Flu", year:1918, type:"pandemic", deathToll:50000000, durationDays:730, longitude:0.0, description:"The most severe pandemic in modern history infected 500 million people worldwide." },
      { id:7, name:"2020 COVID-19", year:2020, type:"pandemic", deathToll:6900000, durationDays:1095, longitude:114.0, description:"A novel coronavirus triggered the first worldwide pandemic in a century." },
      { id:8, name:"2005 Hurricane Katrina", year:2005, type:"storm", deathToll:1833, durationDays:7, longitude:-89.6, description:"The costliest hurricane in U.S. history breached New Orleans' levees, flooding 80% of the city." },
      { id:9, name:"1986 Chernobyl Disaster", year:1986, type:"industrial", deathToll:31, durationDays:14, longitude:30.1, description:"Reactor No. 4 exploded during a safety test, releasing radioactive contamination across Europe." },
      { id:10, name:"2011 Tōhoku Earthquake", year:2011, type:"tsunami", deathToll:19747, durationDays:1, longitude:142.4, description:"A 9.1 magnitude earthquake off Japan triggered tsunamis and the Fukushima nuclear meltdowns." },
    ];
  }

  // ── Start ──────────────────────────────────────────────────────────────────

  boot().catch(err => console.error('Embers boot failed:', err));

})();
