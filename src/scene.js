/**
 * scene.js — Three.js scene setup for "Embers"
 *
 * Builds:
 *  - Renderer, camera, scene
 *  - Room geometry (floor, ceiling, walls, glass walls)
 *  - Grid floor
 *  - Fog
 *  - Candles (procedural, data-driven)
 *
 * No external textures required — all procedural.
 */

'use strict';

window.EmberScene = (function () {

  // ── Constants ──────────────────────────────────────────────────────────────

  const ROOM = {
    width: 20,    // X extent: -10 to +10
    depth: 40,    // Z extent: 0 to -40 (camera starts near 0, candles go back)
    height: 5,    // Y: floor at 0, ceiling at 5
  };

  // Candle placement mapping ranges
  const CANDLE = {
    minRadius: 0.04,   // thinnest candle (small death toll)
    maxRadius: 0.25,   // fattest candle (largest death toll)
    minHeight: 0.4,    // shortest candle (brief disaster)
    maxHeight: 1.8,    // tallest candle (long-lasting disaster)
    hangY: 3.8,        // Y position of candle base (hangs from ceiling-ish)
    flameHeight: 0.18, // cone height for flame
    flameRadius: 0.06, // cone base radius
    // Wax pool beneath each candle
    waxMinRadius: 0.08,
    waxMaxRadius: 0.45,
  };

  // Longitude range mapped to X
  const LON_RANGE = { min: -90, max: 145 }; // covers dataset

  // Year range mapped to Z (recent near 0, older near -ROOM.depth)
  const YEAR_RANGE = { min: 1900, max: 2025 };

  // Disaster type color palette (procedural)
  const TYPE_COLORS = {
    flood:      0x4488cc,
    storm:      0x8866aa,
    earthquake: 0xcc8844,
    tsunami:    0x44aacc,
    pandemic:   0xcc4466,
    industrial: 0xaabb66,
    default:    0xcc9944,
  };

  // ── Module state ──────────────────────────────────────────────────────────

  let renderer, scene, camera;
  let candleObjects = []; // { mesh, flame, data, baseY, waxMesh }
  let flickerTime = 0;

  // ── Scale toggles ─────────────────────────────────────────────────────────
  // Set to 'log' or 'linear' — change here to switch mapping mode.
  const SIZE_SCALE = 'log'; // 'linear' | 'log'

  // ── Init ──────────────────────────────────────────────────────────────────

  function init(container) {
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    container.appendChild(renderer.domElement);

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06040200);

    // Fog — adds "time depth" feel (Chronic → Recent)
    // FogExp2 for atmospheric, non-linear depth cue
    scene.fog = new THREE.FogExp2(0x0a0804, 0.045);

    // Camera (first-person)
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 80);
    camera.position.set(0, 1.65, -2); // eye height ~1.65m, near entrance

    // Resize handler
    window.addEventListener('resize', onResize);

    buildRoom();
    buildLighting();

    return { renderer, scene, camera };
  }

  // ── Room geometry ─────────────────────────────────────────────────────────

  function buildRoom() {
    const W = ROOM.width;
    const D = ROOM.depth;
    const H = ROOM.height;

    // ── Floor ──
    // Replace this MeshStandardMaterial with a texture later by swapping
    // map: new THREE.TextureLoader().load('textures/floor.jpg')
    const floorGeo = new THREE.PlaneGeometry(W, D);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0c0906,
      roughness: 0.95,
      metalness: 0.0,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -D / 2);
    floor.receiveShadow = true;
    scene.add(floor);

    // Grid overlay on floor (subtle, hand-drawn feel)
    buildGridFloor(W, D);

    // ── Ceiling ──
    const ceilGeo = new THREE.PlaneGeometry(W, D);
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x080604, roughness: 1 });
    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, H, -D / 2);
    scene.add(ceil);

    // ── Solid back wall ──
    const backGeo = new THREE.PlaneGeometry(W, H);
    const backMat = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.9 });
    const backWall = new THREE.Mesh(backGeo, backMat);
    backWall.position.set(0, H / 2, -D);
    scene.add(backWall);

    // ── Solid front wall (behind camera entrance) ──
    const frontGeo = new THREE.PlaneGeometry(W, H);
    const frontMat = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.9 });
    const frontWall = new THREE.Mesh(frontGeo, frontMat);
    frontWall.rotation.y = Math.PI;
    frontWall.position.set(0, H / 2, 0);
    scene.add(frontWall);

    // ── Glass walls (left and right) ──
    // MeshPhysicalMaterial for glass — replace map/normalMap later for etched glass look
    buildGlassWall(-W / 2, D, H); // left
    buildGlassWall( W / 2, D, H); // right
  }

  function buildGlassWall(xPos, depth, height) {
    const geo = new THREE.PlaneGeometry(depth, height);

    // MeshPhysicalMaterial for semi-transparent glass with reflections
    // To add etching texture later: set map and alphaMap here
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x8899aa,
      transmission: 0.88,       // glass-like transparency
      opacity: 0.18,
      transparent: true,
      roughness: 0.05,
      metalness: 0.0,
      reflectivity: 0.6,
      ior: 1.45,                // glass index of refraction
      thickness: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.y = xPos < 0 ? Math.PI / 2 : -Math.PI / 2;
    mesh.position.set(xPos, height / 2, -depth / 2);
    scene.add(mesh);

    // Thin edge frame (subtle structure)
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.3 });
    const edgePoints = [
      new THREE.Vector3(0, -height/2, -depth/2),
      new THREE.Vector3(0, -height/2,  depth/2),
      new THREE.Vector3(0,  height/2,  depth/2),
      new THREE.Vector3(0,  height/2, -depth/2),
      new THREE.Vector3(0, -height/2, -depth/2),
    ].map(v => v.clone().setX(xPos));
    const edgeGeo = new THREE.BufferGeometry().setFromPoints(edgePoints);
    const edge = new THREE.Line(edgeGeo, edgeMat);
    scene.add(edge);
  }

  function buildGridFloor(W, D) {
    // Subtle line grid — replace with custom shader grid later for better look
    const divisions = 20;
    const gridHelper = new THREE.GridHelper(Math.max(W, D), divisions, 0x1a1208, 0x110e08);
    gridHelper.position.set(0, 0.001, -D / 2); // just above floor
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.35;
    scene.add(gridHelper);
  }

  // ── Lighting ──────────────────────────────────────────────────────────────

  function buildLighting() {
    // Very dim ambient — keeps room from total blackness
    const ambient = new THREE.AmbientLight(0x100806, 0.4);
    scene.add(ambient);

    // Dim directional from above-back (ceiling simulation)
    const dir = new THREE.DirectionalLight(0x302010, 0.3);
    dir.position.set(0, 10, 5);
    scene.add(dir);
  }

  // ── Candle creation ───────────────────────────────────────────────────────

  function buildCandles(data) {
    // Clear any existing
    candleObjects.forEach(c => {
      scene.remove(c.group);
    });
    candleObjects = [];

    const deathTolls = data.map(d => d.deathToll);
    const maxToll = Math.max(...deathTolls);
    const minToll = Math.min(...deathTolls);

    data.forEach((record) => {
      const group = buildSingleCandle(record, minToll, maxToll);
      scene.add(group);
    });
  }

  function mapRadius(toll, minToll, maxToll) {
    // Toggle between linear and log scaling via SIZE_SCALE constant
    let t;
    if (SIZE_SCALE === 'log') {
      // Log scale: compresses extreme values for better visual balance
      const logMin = Math.log(minToll + 1);
      const logMax = Math.log(maxToll + 1);
      t = (Math.log(toll + 1) - logMin) / (logMax - logMin);
    } else {
      // Linear scale
      t = (toll - minToll) / (maxToll - minToll);
    }
    return CANDLE.minRadius + t * (CANDLE.maxRadius - CANDLE.minRadius);
  }

  function mapHeight(days) {
    // Clamp durationDays to [1, 1095] then map to candle height
    const clamped = Math.max(1, Math.min(days, 1095));
    const t = Math.log(clamped) / Math.log(1095); // log for better spread
    return CANDLE.minHeight + t * (CANDLE.maxHeight - CANDLE.minHeight);
  }

  function mapX(longitude) {
    // Map longitude range to room X range with margin
    const margin = 1.5;
    const t = (longitude - LON_RANGE.min) / (LON_RANGE.max - LON_RANGE.min);
    return -ROOM.width / 2 + margin + t * (ROOM.width - margin * 2);
  }

  function mapZ(year) {
    // Recent (2025) → near front (Z ≈ -3), old (1900) → deep (Z ≈ -ROOM.depth+2)
    const t = (year - YEAR_RANGE.min) / (YEAR_RANGE.max - YEAR_RANGE.min);
    const zFront = -3;
    const zBack = -(ROOM.depth - 2);
    return zBack + t * (zFront - zBack);
  }

  function buildSingleCandle(record, minToll, maxToll) {
    const group = new THREE.Group();

    const radius = mapRadius(record.deathToll, minToll, maxToll);
    const height = mapHeight(record.durationDays);
    const xPos = mapX(record.longitude);
    const zPos = mapZ(record.year);

    // Candle body — cylinder
    // To add wax texture later: set map: textureLoader.load('textures/wax.jpg')
    const candleGeo = new THREE.CylinderGeometry(radius * 0.9, radius, height, 16);
    const typeColor = TYPE_COLORS[record.type] || TYPE_COLORS.default;
    const candleMat = new THREE.MeshStandardMaterial({
      color: blendColor(0xf5ead0, typeColor, 0.15),
      roughness: 0.85,
      metalness: 0.0,
      emissive: new THREE.Color(typeColor).multiplyScalar(0.04),
    });
    const candleMesh = new THREE.Mesh(candleGeo, candleMat);
    candleMesh.castShadow = true;
    candleMesh.receiveShadow = true;
    // Position: candle hangs from CANDLE.hangY, so base is at hangY - height
    const baseY = CANDLE.hangY - height;
    candleMesh.position.y = baseY + height / 2;
    group.add(candleMesh);

    // Flame — cone (emissive warm orange)
    const flameGeo = new THREE.ConeGeometry(CANDLE.flameRadius * (radius / CANDLE.minRadius * 0.3 + 0.7), CANDLE.flameHeight, 8);
    const flameMat = new THREE.MeshStandardMaterial({
      color: 0xffcc44,
      emissive: new THREE.Color(0xff8800),
      emissiveIntensity: 3.0,
      transparent: true,
      opacity: 0.92,
    });
    const flameMesh = new THREE.Mesh(flameGeo, flameMat);
    flameMesh.position.y = baseY + height + CANDLE.flameHeight / 2;
    group.add(flameMesh);

    // Flame point light (warm, short range, casts candle ambiance)
    const flameLight = new THREE.PointLight(0xff9933, 0.8, 3.5, 2);
    flameLight.position.y = baseY + height + CANDLE.flameHeight;
    group.add(flameLight);

    // Wax pool on the floor beneath the candle
    const waxRadius = mapRadius(record.deathToll, minToll, maxToll) * 2.5;
    const clampedWaxRadius = Math.max(CANDLE.waxMinRadius, Math.min(waxRadius, CANDLE.waxMaxRadius));
    const waxGeo = new THREE.RingGeometry(clampedWaxRadius * 0.3, clampedWaxRadius, 24);
    // Slightly glossy off-white wax material
    // To add wax texture: set map here
    const waxMat = new THREE.MeshStandardMaterial({
      color: 0xf0e4b0,
      roughness: 0.4,
      metalness: 0.05,
      emissive: new THREE.Color(0x604020),
      emissiveIntensity: 0.05,
      side: THREE.DoubleSide,
    });
    const waxMesh = new THREE.Mesh(waxGeo, waxMat);
    waxMesh.rotation.x = -Math.PI / 2;
    waxMesh.position.y = 0.002; // just above floor
    group.add(waxMesh);

    // Hanging thread (thin line from ceiling to candle top)
    const threadPoints = [
      new THREE.Vector3(0, ROOM.height, 0),
      new THREE.Vector3(0, CANDLE.hangY, 0),
    ];
    const threadGeo = new THREE.BufferGeometry().setFromPoints(threadPoints);
    const threadMat = new THREE.LineBasicMaterial({ color: 0x3a2a1a, transparent: true, opacity: 0.5 });
    const thread = new THREE.Line(threadGeo, threadMat);
    group.add(thread);

    // Position the whole group
    group.position.set(xPos, 0, zPos);

    // Store reference for animation and interaction
    const obj = {
      group,
      candleMesh,
      flameMesh,
      flameLight,
      waxMesh,
      data: record,
      baseY,
      height,
      radius,
      // Interaction state
      highlighted: false,
      selected: false,
      originalEmissive: new THREE.Color(typeColor).multiplyScalar(0.04),
      typeColor,
    };
    candleObjects.push(obj);

    return group;
  }

  // ── Animation ─────────────────────────────────────────────────────────────

  function updateFlicker(deltaTime) {
    flickerTime += deltaTime;

    candleObjects.forEach((c, i) => {
      // Flicker: perlin-like using multiple sin waves with offsets per candle
      const offset = i * 1.37; // unique phase per candle
      const flicker =
        Math.sin(flickerTime * 3.7 + offset) * 0.5 +
        Math.sin(flickerTime * 7.1 + offset * 2) * 0.25 +
        Math.sin(flickerTime * 13.3 + offset * 0.5) * 0.15 +
        Math.random() * 0.1; // tiny random spark

      const flickerNorm = (flicker + 1) / 2; // 0..1

      // Flame scale flicker
      const scaleX = 0.85 + flickerNorm * 0.3;
      const scaleY = 0.9 + flickerNorm * 0.2;
      c.flameMesh.scale.set(scaleX, scaleY, scaleX);

      // Flame position micro-wobble
      c.flameMesh.position.x = (Math.random() - 0.5) * 0.008;
      c.flameMesh.position.z = (Math.random() - 0.5) * 0.008;

      // Light intensity flicker
      const baseIntensity = c.highlighted ? 2.5 : 0.8;
      c.flameLight.intensity = baseIntensity + flickerNorm * 0.6;

      // Emissive pulse on highlight
      if (c.highlighted) {
        const pulse = 0.5 + flickerNorm * 0.5;
        c.candleMesh.material.emissiveIntensity = 0.35 * pulse;
        c.flameMesh.material.emissiveIntensity = 4.0 + flickerNorm * 2;
      } else {
        c.candleMesh.material.emissiveIntensity = 0.04;
        c.flameMesh.material.emissiveIntensity = 3.0;
      }
    });
  }

  function setHighlight(candleObj, on) {
    if (!candleObj) return;
    candleObj.highlighted = on;
    if (on) {
      candleObj.candleMesh.material.emissive = new THREE.Color(0xff9933);
      candleObj.candleMesh.material.emissiveIntensity = 0.35;
      candleObj.flameLight.intensity = 2.5;
      candleObj.flameLight.distance = 5;
    } else {
      candleObj.candleMesh.material.emissive.set(candleObj.originalEmissive);
      candleObj.candleMesh.material.emissiveIntensity = 0.04;
      candleObj.flameLight.intensity = 0.8;
      candleObj.flameLight.distance = 3.5;
    }
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function blendColor(hexA, hexB, t) {
    const a = new THREE.Color(hexA);
    const b = new THREE.Color(hexB);
    return a.lerp(b, t).getHex();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    init,
    buildCandles,
    updateFlicker,
    setHighlight,
    getCandles: () => candleObjects,
    getRenderer: () => renderer,
    getScene: () => scene,
    getCamera: () => camera,
    ROOM,
  };

})();
