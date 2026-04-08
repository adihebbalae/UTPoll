/**
 * background.js — Service worker / central brain.
 *
 * State machine:
 *   IDLE     → on pollDetected (debounced ×2 in 5 s) → ALERTED (fires all alerts)
 *   ALERTED  → on pollCleared                         → IDLE
 *
 * Also tracks active Instapoll tabs via runtime ports to maintain the
 * status indicator shown in the popup.
 */
'use strict';

// ── Lifecycle ─────────────────────────────────────────────────────────────────
const UNINSTALL_URL = 'https://llamafnc-tech.github.io/goodbye/goodbye.html';

chrome.runtime.setUninstallURL(UNINSTALL_URL);

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
  }
});

// ── State ─────────────────────────────────────────────────────────────────────
let alertState    = 'IDLE';   // 'IDLE' | 'ALERTED'
let debounceCount = 0;
let debounceTimer = null;

const DEBOUNCE_THRESHOLD = 1;
const DEBOUNCE_WINDOW_MS = 5000;

// ── Page-liveness tracking via runtime ports ──────────────────────────────────
const activePorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'instapoll_page') return;

  activePorts.add(port);
  setStatus('monitoring');
  // Reset the arm-audio flag so the button re-arms on next page load.
  chrome.storage.local.set({ audioArmed: false });

  port.onDisconnect.addListener(() => {
    activePorts.delete(port);
    if (activePorts.size === 0) {
      // All Instapoll tabs closed — reset everything.
      alertState    = 'IDLE';
      debounceCount = 0;
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      setStatus('inactive');
    }
  });
});

// ── Message handling ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {
    case 'pollDetected':     handlePollDetected(message.polls); return false;
    case 'pollCleared':      handlePollCleared();               return false;
    case 'autoSubmitResult': handleAutoSubmitResult(message);   return false;
    case 'sendNtfyPush': {
      // Proxied on behalf of the popup so the fetch comes from the service worker,
      // which is not subject to extension-page CSP restrictions.
      const { topic, title, body, priority = 'default', tags = '' } = message;
      fetch('https://ntfy.sh/' + encodeURIComponent(topic), {
        method:  'POST',
        headers: Object.fromEntries([
          ['Title',    title],
          ['Priority', priority],
          ...(tags ? [['Tags', tags]] : []),
        ]),
        body,
      })
        .then((res) => sendResponse({ ok: res.ok, status: res.status }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true; // Keep channel open for async response.
    }
  }
  return false;
});

// ── Debounce logic ────────────────────────────────────────────────────────────
function handlePollDetected(polls) {
  if (alertState === 'ALERTED') return; // Already alerted; ignore duplicates.

  debounceCount++;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    // Window expired without reaching threshold — reset.
    debounceCount = 0;
    debounceTimer = null;
  }, DEBOUNCE_WINDOW_MS);

  if (debounceCount >= DEBOUNCE_THRESHOLD) {
    debounceCount = 0;
    clearTimeout(debounceTimer);
    debounceTimer = null;
    alertState    = 'ALERTED';
    triggerAlerts(polls);
  }
}

function handlePollCleared() {  if (alertState === 'ALERTED') {
    alertState = 'IDLE';
    setStatus('monitoring');
    // Stop the repeating chime.
    chrome.runtime.sendMessage({ action: 'stopAudio' }).catch(() => {});
    chrome.offscreen.closeDocument().catch(() => {});
  }
}

function handleAutoSubmitResult({ ok, status, error }) {
  if (ok) {
    setStatus('autosubmit_ok');
    // Revert indicator after a few seconds.
    setTimeout(() => {
      setStatus(alertState === 'ALERTED' ? 'poll_detected' : 'monitoring');
    }, 4000);
  } else {
    console.warn('[UTPoll] Auto-submit failed:', status, error);
    setStatus('autosubmit_fail');
  }
}

// ── Alert dispatch ────────────────────────────────────────────────────────────
async function triggerAlerts(polls) {
  setStatus('poll_detected');

  const settings = await chrome.storage.sync.get({
    enableNotification: true,
    enableAudio:        true,
    enablePush:         false,
    ntfyTopic:          '',
  });

  if (settings.enableNotification) {
    chrome.notifications.create('utpoll_alert', {
      type:             'basic',
      iconUrl:          chrome.runtime.getURL('assets/icon-128.png'),
      title:            'UT Instapoll Alert',
      message:          'A live poll is available! Open Instapoll now.',
      requireInteraction: true,
      priority:         2,
    });
  }

  if (settings.enableAudio) {
    playAlertAudio().catch(console.error);
  }

  if (settings.enablePush && settings.ntfyTopic) {
    const topic = settings.ntfyTopic.trim();
    if (topic) {
      fetch('https://ntfy.sh/', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          title:    'UT Instapoll Alert 🚨',
          message:  'Poll is live! Open Instapoll now.',
          priority: 5,
          tags:     ['rotating_light'],
        }),
      }).catch(console.error);
    }
  }
}

// ── Offscreen audio ───────────────────────────────────────────────────────────
async function playAlertAudio() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');

  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url:           'offscreen.html',
      reasons:       ['AUDIO_PLAYBACK'],
      justification: 'Play alert chime when a live poll is detected.',
    });
  }

  chrome.runtime.sendMessage({ action: 'playAudio' });

  // Close offscreen document after the chime finishes (~1.5 s of audio + buffer).
  setTimeout(() => {
    chrome.offscreen.closeDocument().catch(() => {});
  }, 2500);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(status) {
  chrome.storage.local.set({ status });
}
