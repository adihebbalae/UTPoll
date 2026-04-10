/**
 * content.js — Content script; runs at document_start on polls.la.utexas.edu.
 * 1. Injects inject.js synchronously (before any await) to guarantee window.WebSocket
 *    is patched before the page's own scripts establish a Pusher connection.
 * 2. Reads actual settings from storage and sends them to inject.js via postMessage.
 * 3. Maintains a runtime port so background.js can track page liveness.
 * 4. Bridges window.postMessage → chrome.runtime.sendMessage.
 */
'use strict';

// ── Step 1: inject immediately (synchronous, before any await) ────────────────
// Using safe defaults so WebSocket is patched before any page script runs.
// Actual user settings are forwarded below once storage responds.
const _utpoll_nonce = crypto.randomUUID();
{
  const root = document.head || document.documentElement;
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('inject.js');
  s.dataset.pattern    = '/api/v1/student/course/*/poll';
  s.dataset.courseId   = '';
  s.dataset.autosubmit = '0';
  s.dataset.nonce      = _utpoll_nonce;
  s.onload = () => s.remove();
  root.appendChild(s);
}

// ── Step 2: load actual user settings and forward to inject.js ────────────────
(async () => {
  const { apiPattern, courseId, enableAutoSubmit } = await chrome.storage.sync.get({
    apiPattern: '/api/v1/student/course/*/poll',
    courseId: '',
    enableAutoSubmit: false,
  });
  // inject.js listens for this message to update its live configuration.
  // Includes the nonce so inject.js can verify this came from our content script.
  window.postMessage({
    type:        'UTPOLL_CONFIG',
    nonce:       _utpoll_nonce,
    pattern:     apiPattern,
    courseId:    courseId,
    autosubmit:  enableAutoSubmit ? '1' : '0',
  }, window.location.origin);
})();

// Establish a persistent port so background.js can detect page liveness.
// Auto-reconnects when the service worker is restarted (MV3 lifecycle fix).
// Bails out silently if the extension context is invalidated (e.g. after reload).
function connectPort() {
  if (!chrome.runtime?.id) return; // Extension was reloaded — stop retrying.
  try {
    const port = chrome.runtime.connect({ name: 'instapoll_page' });
    port.onDisconnect.addListener(() => {
      if (!chrome.runtime?.id) return; // Context gone — don't retry.
      // Service worker was killed and restarted — reconnect after a brief delay.
      setTimeout(connectPort, 1000);
    });
  } catch (_) {
    // Context invalidated between the check and the connect call — ignore.
  }
}
connectPort();

// Forward page-context messages to the service worker.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const { type, data } = event.data || {};
  if (type !== 'UTPOLL_LIVE' && type !== 'UTPOLL_IDLE' &&
      type !== 'UTPOLL_AUTOSUBMIT_OK' && type !== 'UTPOLL_AUTOSUBMIT_FAIL') return;

  if (!chrome.runtime?.id) return; // Context invalidated — ignore.

  if (type === 'UTPOLL_AUTOSUBMIT_OK') {
    chrome.runtime.sendMessage({ action: 'autoSubmitResult', ok: true }).catch(() => {});
    return;
  }
  if (type === 'UTPOLL_AUTOSUBMIT_FAIL') {
    chrome.runtime.sendMessage({ action: 'autoSubmitResult', ok: false, error: event.data.error }).catch(() => {});
    return;
  }
  chrome.runtime.sendMessage({
    action: type === 'UTPOLL_LIVE' ? 'pollDetected' : 'pollCleared',
    polls: data,
  }).catch(() => {
    // Extension context may be invalidated after an update — ignore.
  });
});
