/**
 * ui.js — HUD, museum panel, debug overlay for "Embers"
 *
 * Manages:
 *  - Museum label panel (right-side slide-in)
 *  - Debug HUD (toggle with D key)
 *  - Gesture mode toggle buttons
 *  - Loading screen dismissal
 *  - FPS counter
 */

'use strict';

window.EmberUI = (function () {

  // ── State ──────────────────────────────────────────────────────────────────

  let debugVisible = false;
  let panelVisible = false;
  let currentRecord = null;

  // FPS tracking
  let fpsFrames = 0;
  let fpsTime   = 0;
  let fpsValue  = 0;

  // Element refs (cached on init)
  let elPanel, elName, elMeta, elToll, elDuration, elDesc;
  let elDebug, elDbgFps, elDbgHands, elDbgLfist, elDbgRfist, elDbgBfist;
  let elDbgLpalm, elDbgRpalm, elDbgBpalm, elDbgPinch;
  let elBtnGallery, elBtnDemo;
  let elLoading;

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    elPanel    = document.getElementById('info-panel');
    elName     = document.getElementById('panel-name');
    elMeta     = document.getElementById('panel-meta');
    elToll     = document.getElementById('panel-toll');
    elDuration = document.getElementById('panel-duration');
    elDesc     = document.getElementById('panel-desc');

    elDebug     = document.getElementById('debug-hud');
    elDbgFps    = document.getElementById('dbg-fps');
    elDbgHands  = document.getElementById('dbg-hands');
    elDbgLfist  = document.getElementById('dbg-lfist');
    elDbgRfist  = document.getElementById('dbg-rfist');
    elDbgBfist  = document.getElementById('dbg-bfist');
    elDbgLpalm  = document.getElementById('dbg-lpalm');
    elDbgRpalm  = document.getElementById('dbg-rpalm');
    elDbgBpalm  = document.getElementById('dbg-bpalm');
    elDbgPinch  = document.getElementById('dbg-pinch');

    elBtnGallery = document.getElementById('btn-gallery');
    elBtnDemo    = document.getElementById('btn-demo');

    elLoading = document.getElementById('loading');

    // D key toggles debug HUD
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyD' && !e.repeat) toggleDebug();
      if (e.code === 'Escape') closePanel();
    });
  }

  // ── Loading screen ─────────────────────────────────────────────────────────

  function hideLoading() {
    if (!elLoading) return;
    elLoading.style.opacity = '0';
    elLoading.style.pointerEvents = 'none';
    setTimeout(() => {
      if (elLoading) elLoading.style.display = 'none';
    }, 900);
  }

  // ── Info panel ─────────────────────────────────────────────────────────────

  function showPanel(record) {
    if (!record || !elPanel) return;
    currentRecord = record;
    panelVisible = true;

    elName.textContent = record.name;
    elMeta.textContent = `${record.year} · ${capitalize(record.type)}`;
    elToll.textContent = formatNumber(record.deathToll);
    elDuration.textContent = `Duration: ${record.durationDays} ${record.durationDays === 1 ? 'day' : 'days'}`;
    elDesc.textContent = record.description;

    elPanel.classList.add('visible');
  }

  function closePanel() {
    panelVisible = false;
    currentRecord = null;
    if (elPanel) elPanel.classList.remove('visible');
  }

  function togglePanel(record) {
    if (panelVisible && currentRecord && currentRecord.id === record.id) {
      closePanel();
    } else {
      showPanel(record);
    }
  }

  // ── Debug HUD ──────────────────────────────────────────────────────────────

  function toggleDebug() {
    debugVisible = !debugVisible;
    if (elDebug) elDebug.classList.toggle('visible', debugVisible);
  }

  function updateDebug(state, fps) {
    if (!debugVisible || !elDebug) return;

    elDbgFps.textContent   = fps.toFixed(1);
    elDbgHands.textContent = state.handsCount;

    setBool(elDbgLfist,  state.leftFist);
    setBool(elDbgRfist,  state.rightFist);
    setBool(elDbgBfist,  state.bothFists);
    setBool(elDbgLpalm,  state.leftPalm);
    setBool(elDbgRpalm,  state.rightPalm);
    setBool(elDbgBpalm,  state.bothPalms);
    setBool(elDbgPinch,  state.pinch);
  }

  function setBool(el, val) {
    if (!el) return;
    el.textContent = val ? '✓' : '✗';
    el.className   = val ? 'dbg-true' : 'dbg-false';
  }

  // ── FPS ────────────────────────────────────────────────────────────────────

  function tickFps(deltaTime) {
    fpsFrames++;
    fpsTime += deltaTime;
    if (fpsTime >= 0.5) {
      fpsValue  = fpsFrames / fpsTime;
      fpsFrames = 0;
      fpsTime   = 0;
    }
    return fpsValue;
  }

  // ── Gesture mode buttons ──────────────────────────────────────────────────

  function setModeButton(mode) {
    if (!elBtnGallery || !elBtnDemo) return;
    elBtnGallery.classList.toggle('active', mode === 'gallery');
    elBtnDemo.classList.toggle('active', mode === 'demo');
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function formatNumber(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
  }

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    init,
    hideLoading,
    showPanel,
    closePanel,
    togglePanel,
    toggleDebug,
    updateDebug,
    setModeButton,
    tickFps,
    isPanelVisible: () => panelVisible,
  };

})();
