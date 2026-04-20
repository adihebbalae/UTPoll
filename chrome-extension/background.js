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
let activeTabId   = null;     // Tab ID of the most recently connected Instapoll tab.
let reAlertTimer  = null;     // setTimeout handle for the 30-second re-alert.

const DEBOUNCE_THRESHOLD = 2;
const DEBOUNCE_WINDOW_MS = 5000;

// ── Page-liveness tracking via runtime ports ──────────────────────────────────
const activePorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'instapoll_page') return;

  activePorts.add(port);
  // Track the most recently active Instapoll tab for auto-focus on poll detection.
  if (port.sender?.tab?.id) activeTabId = port.sender.tab.id;
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
      activeTabId = null;
      // Stop any playing chime and release the offscreen document.
      chrome.runtime.sendMessage({ action: 'stopAudio' }).catch(() => {});
      chrome.offscreen.closeDocument().catch(() => {});
    }
  });
});

// ── Message handling ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {
    case 'pollDetected':     handlePollDetected(message.polls, message.allAnswered); return false;
    case 'pollCleared':      handlePollCleared();               return false;
    case 'autoSubmitResult': handleAutoSubmitResult(message);   return false;
    case 'sendNtfyPush': {
      // Proxied on behalf of the popup. Uses JSON body so emoji in title is safe.
      const { topic, title, body, priority = 'default', tags = '' } = message;
      fetch('https://ntfy.sh/', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          title,
          message: body,
          priority: priority === 'urgent' ? 5 : priority === 'high' ? 4 : priority === 'low' ? 2 : 3,
          ...(tags ? { tags: tags.split(',').map(t => t.trim()).filter(Boolean) } : {}),
        }),
      })
        .then((res) => sendResponse({ ok: res.ok, status: res.status }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true; // Keep channel open for async response.
    }
  }
  return false;
});

// ── Debounce logic ────────────────────────────────────────────────────────────
function handlePollDetected(polls, allAnswered) {
  if (alertState === 'ALERTED') return; // Already alerted; ignore duplicates.

  // If the student has already answered all live polls, update status quietly
  // but don't fire the full alert (sound, notification, push).
  if (allAnswered) {
    setStatus('autosubmit_ok'); // Reuse the green indicator — poll is open, already answered.
    return;
  }

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

function handlePollCleared() {
  if (alertState === 'ALERTED') {
    alertState = 'IDLE';
    setStatus('monitoring');
    // Stop the repeating chime.
    chrome.runtime.sendMessage({ action: 'stopAudio' }).catch(() => {});
    chrome.offscreen.closeDocument().catch(() => {});
    // Clear badge and countdown timestamp.
    chrome.action.setBadgeText({ text: '' });
    chrome.storage.local.remove('pollFinishTs');
    // Cancel any pending re-alert.
    if (reAlertTimer) { clearTimeout(reAlertTimer); reAlertTimer = null; }
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
    // Revert indicator after a few seconds so the user isn't stuck on red.
    setTimeout(() => {
      setStatus(alertState === 'ALERTED' ? 'poll_detected' : 'monitoring');
    }, 6000);
  }
}

// ── Alert helpers ────────────────────────────────────────────────────────────
function buildNotificationMessage(polls) {
  if (polls && polls.length > 1) {
    const unanswered = polls.filter(p => !p.response);
    if (unanswered.length === 0) return `${polls.length} polls are open — you’ve answered all of them!`;
    return `${polls.length} polls are open at once — open Instapoll now!`;
  }
  const poll = polls?.[0];
  const type = poll?.type || '';
  if (poll?.response) return 'Poll is open — you’ve already submitted!';
  switch (type) {
    case 'attendance':       return 'Attendance check — open Instapoll and submit!';
    case 'text_entry':      return 'Text entry poll — any answer earns full credit!';
    case 'multiple_choice': return 'Multiple choice poll is open — answer quickly!';
    default:                return 'A live poll is available! Open Instapoll now.';
  }
}

// ── Alert dispatch ────────────────────────────────────────────────────────────
async function triggerAlerts(polls) {
  setStatus('poll_detected');

  // Badge — visible on the extension icon even when the popup is closed.
  chrome.action.setBadgeText({ text: 'LIVE' });
  chrome.action.setBadgeBackgroundColor({ color: '#BF0000' });

  // Store finish timestamp so the popup can render a live countdown.
  const finishTs = polls?.[0]?.finish_timestamp ?? null;
  chrome.storage.local.set({ pollFinishTs: finishTs });

  // Log this poll to the local history (last 10 entries).
  appendPollHistory(polls?.[0]);

  // Re-alert: if the poll is still active after 30 s, play the chime once more.
  // Uses setTimeout — best-effort (service worker may be killed first in rare cases).
  if (reAlertTimer) clearTimeout(reAlertTimer);
  reAlertTimer = setTimeout(() => {
    reAlertTimer = null;
    if (alertState === 'ALERTED') playAlertAudio().catch(console.error);
  }, 30000);

  // Auto-focus the Instapoll tab so it's ready to answer (feature: tab auto-focus).
  if (activeTabId !== null) {
    chrome.tabs.update(activeTabId, { active: true }).catch(() => {});
  }

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
      message:          buildNotificationMessage(polls),
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
  // The offscreen document stays alive and loops every 4 s (see offscreen.js).
  // It is closed by handlePollCleared() when the poll ends.
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(status) {
  chrome.storage.local.set({ status });
}

/** Prepend a poll entry to the persisted history (max 10). */
async function appendPollHistory(poll) {
  if (!poll) return;
  const { pollHistory = [] } = await chrome.storage.local.get({ pollHistory: [] });
  const entry = {
    id:         poll.id,
    name:       poll.name || 'Poll',
    type:       poll.type || 'unknown',
    courseId:   poll.course_id,
    detectedAt: new Date().toISOString(),
  };
  // Avoid duplicate if the same poll is re-detected (page refresh while active).
  const deduped = pollHistory.filter(e => e.id !== poll.id);
  chrome.storage.local.set({ pollHistory: [entry, ...deduped].slice(0, 10) });
}
