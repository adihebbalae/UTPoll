/**
 * content.js — Content script; runs at document_start on polls.la.utexas.edu.
 * 1. Reads settings from storage and injects config + inject.js into the page context.
 * 2. Maintains a runtime port so background.js can track page liveness.
 * 3. Bridges window.postMessage → chrome.runtime.sendMessage.
 */
'use strict';

(async () => {
  // Read the configuration settings before injecting so inject.js can use them.
  const { apiPattern, courseId, enableAutoSubmit } = await chrome.storage.sync.get({
    apiPattern: '/api/v1/student/course/*/poll',
    courseId: '',
    enableAutoSubmit: false,
  });

  const root = document.head || document.documentElement;

  // Inject the intercept script into the page context.
  // Config is passed via data-* attributes to avoid inline scripts (CSP-safe).
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('inject.js');
  s.dataset.pattern     = apiPattern;
  s.dataset.courseId    = courseId;
  s.dataset.autosubmit  = enableAutoSubmit ? '1' : '0';
  s.onload = () => s.remove();
  root.appendChild(s);
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
