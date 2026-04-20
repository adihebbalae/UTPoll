'use strict';

// ── DOM references ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const statusDot    = $('statusDot');
const statusText   = $('statusText');
const form         = $('settingsForm');
const courseIdEl   = $('courseId');
const apiPatternEl = $('apiPattern');
const enableNotif      = $('enableNotification');
const enableAudio      = $('enableAudio');
const enablePush       = $('enablePush');
const enableAutoSubmit = $('enableAutoSubmit');
const ntfySection      = $('ntfySection');
const ntfyTopicEl  = $('ntfyTopic');
const armBtn          = $('armAudioBtn');
const audioActions    = $('audioActions');
const advancedToggle  = $('advancedToggle');
const advancedSection = $('advancedSection');
const statusSub       = $('statusSub');

// ── Load persisted settings ───────────────────────────────────────────────────
// Tracks the last topic value that was actually saved, to detect real changes.
let savedTopic = '';

chrome.storage.sync.get(
  {
    courseId:           '',
    apiPattern:         '/api/v1/student/course/*/poll',
    enableNotification: true,
    enableAudio:        true,
    enablePush:         false,
    ntfyTopic:          '',
    enableAutoSubmit:   false,
  },
  (s) => {
    courseIdEl.value   = s.courseId;
    apiPatternEl.value = s.apiPattern;
    enableNotif.checked        = s.enableNotification;
    enableAudio.checked        = s.enableAudio;
    enablePush.checked         = s.enablePush;
    enableAutoSubmit.checked   = s.enableAutoSubmit;
    ntfyTopicEl.value  = s.ntfyTopic;
    savedTopic = s.ntfyTopic;
    ntfySection.classList.toggle('hidden', !s.enablePush);
    audioActions.classList.toggle('hidden', !s.enableAudio);
  }
);

// ── Load current status + arm state ──────────────────────────────────────────────
// Status/history/countdown are loaded together at the bottom of the file.
chrome.storage.local.get({ audioArmed: false }, ({ audioArmed }) => {
  if (audioArmed) {
    armBtn.textContent = '✅ Sound allowed';
    armBtn.disabled    = true;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.status)      renderStatus(changes.status.newValue);
    if (changes.pollHistory) renderHistory(changes.pollHistory.newValue || []);
  }
});

const STATUS_MAP = {
  inactive:        { dot: 'gray',  text: 'Not monitoring',     sub: 'Open Instapoll in Canvas to begin.' },
  monitoring:      { dot: 'green', text: 'Monitoring…',        sub: "You'll be alerted the moment a poll opens." },
  poll_detected:   { dot: 'red',   text: 'Poll detected!',     sub: 'Check Instapoll now — alerts are firing!' },
  autosubmit_ok:   { dot: 'green', text: 'Poll submitted!',    sub: 'Full credit recorded automatically.' },
  autosubmit_fail: { dot: 'red',   text: 'Auto-submit failed', sub: 'Please submit manually on the Instapoll page.' },
};

function renderStatus(status) {
  const { dot, text, sub } = STATUS_MAP[status] || STATUS_MAP.inactive;
  statusDot.className    = 'dot ' + dot;
  statusText.textContent = text;
  statusSub.textContent  = sub || '';

  if (status === 'poll_detected') {
    chrome.storage.local.get({ pollFinishTs: null }, ({ pollFinishTs }) => {
      startCountdown(pollFinishTs);
    });
  } else {
    stopCountdown();
  }
}

// ── Countdown ─────────────────────────────────────────────────────────
let countdownInterval = null;
const countdownEl = $('countdown');

function startCountdown(finishTs) {
  stopCountdown();
  if (!finishTs) { countdownEl.classList.add('hidden'); return; }

  function tick() {
    const remaining = Math.ceil(finishTs - Date.now() / 1000);
    if (remaining <= 0) {
      countdownEl.textContent = 'Closing…';
      stopCountdown();
      return;
    }
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    countdownEl.textContent = `${m}:${String(s).padStart(2, '0')} remaining`;
    countdownEl.classList.remove('hidden');
  }

  tick();
  countdownInterval = setInterval(tick, 1000);
}

function stopCountdown() {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  countdownEl.classList.add('hidden');
}

// ── Show / hide ntfy section, audio actions, and advanced panel ─────────────────
enablePush.addEventListener('change', () => {
  ntfySection.classList.toggle('hidden', !enablePush.checked);
});

enableAudio.addEventListener('change', () => {
  audioActions.classList.toggle('hidden', !enableAudio.checked);
});

advancedToggle.addEventListener('click', () => {
  const isOpen = !advancedSection.classList.contains('hidden');
  advancedSection.classList.toggle('hidden', isOpen);
  advancedToggle.textContent = isOpen ? '⚙ Advanced settings' : '⚙ Hide advanced settings';
});

// ── Save settings ─────────────────────────────────────────────────────────────
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const newTopic = ntfyTopicEl.value.trim();
  chrome.storage.sync.set(
    {
      courseId:           courseIdEl.value.trim(),
      apiPattern:         apiPatternEl.value.trim() || '/api/v1/student/course/*/poll',
      enableNotification: enableNotif.checked,
      enableAudio:        enableAudio.checked,
      enablePush:         enablePush.checked,
      ntfyTopic:          newTopic,
      enableAutoSubmit:   enableAutoSubmit.checked,
    },
    () => {
      // Send welcome push if the topic is new or was changed.
      if (newTopic && newTopic !== savedTopic) {
        sendWelcomePush(newTopic);
      }
      savedTopic = newTopic;
      const btn = form.querySelector('.btn-primary');
      btn.textContent = 'Saved ✓';
      setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    }
  );
});

// ── Test / welcome push notification ─────────────────────────────────────────
const testPushBtn    = $('testPushBtn');
const testPushStatus = $('testPushStatus');

async function sendWelcomePush(topic) {
  testPushBtn.disabled       = true;
  testPushStatus.textContent = 'Sending…';
  testPushStatus.className   = 'push-status';

  try {
    const res = await fetch('https://ntfy.sh/', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        title:   'Welcome to UT Instapoll Alert! 🎉',
        message: 'Testing push notifications — you are all set! You will be alerted the moment a live poll is detected.',
        priority: 3,
        tags:    ['white_check_mark'],
      }),
    });

    if (res.ok) {
      testPushStatus.textContent = '✅ Test push sent!';
      testPushStatus.className   = 'push-status ok';
    } else {
      testPushStatus.textContent = `Error ${res.status} — check your topic name.`;
      testPushStatus.className   = 'push-status err';
    }
  } catch (err) {
    testPushStatus.textContent = 'Error: ' + (err && err.message ? err.message : 'Unknown error');
    testPushStatus.className   = 'push-status err';
  } finally {
    testPushBtn.disabled = false;
  }
}

// Manual button — always sends regardless of whether topic changed.
testPushBtn.addEventListener('click', () => {
  const topic = ntfyTopicEl.value.trim();
  if (!topic) {
    testPushStatus.textContent = 'Enter a topic name first.';
    testPushStatus.className   = 'push-status err';
    return;
  }
  sendWelcomePush(topic);
});

// Clear status message when the user edits the topic field.
ntfyTopicEl.addEventListener('input', () => {
  testPushStatus.textContent = '';
});

// ── Test chime ───────────────────────────────────────────────────────────────
const testChimeBtn = $('testChimeBtn');

testChimeBtn.addEventListener('click', function () {
  const btn = this;
  btn.disabled    = true;
  btn.textContent = '\u266a ...';

  const ctx = new AudioContext();
  const notes = [
    { freq: 523.25, start: 0.00 },
    { freq: 659.25, start: 0.25 },
    { freq: 783.99, start: 0.50 },
  ];

  notes.forEach(({ freq, start }) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type            = 'sine';
    osc.frequency.value = freq;
    const t = ctx.currentTime + start;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.45, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.start(t);
    osc.stop(t + 0.45);
  });

  setTimeout(() => {
    ctx.close().catch(() => {});
    btn.disabled    = false;
    btn.textContent = '\u25b6 Test chime';
  }, 1000);
});

// ── Arm audio (satisfies browser autoplay policy) ─────────────────────────────
armBtn.addEventListener('click', () => {
  const ctx  = new AudioContext();
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.value = 0.001; // Nearly silent
  osc.start();
  osc.stop(ctx.currentTime + 0.1);
  setTimeout(() => ctx.close(), 300);

  armBtn.textContent = '✅ Sound allowed';
  armBtn.disabled    = true;
  chrome.storage.local.set({ audioArmed: true });
});

// ── Poll history ──────────────────────────────────────────────────────────────
const TYPE_ICON = {
  attendance:      '📋',
  multiple_choice: '🔘',
  text_entry:      '✏️',
};

function timeAgo(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function renderHistory(pollHistory) {
  const section = $('historySection');
  const list    = $('historyList');
  if (!pollHistory || pollHistory.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  list.innerHTML = pollHistory.map(entry => {
    const icon = TYPE_ICON[entry.type] || '📊';
    const when = timeAgo(new Date(entry.detectedAt));
    // Sanitize name to prevent XSS from stored data.
    const safeName = entry.name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="history-entry">
      <span class="history-icon">${icon}</span>
      <span class="history-name">${safeName}</span>
      <span class="history-when">${when}</span>
    </div>`;
  }).join('');
}

// Load history and current poll status on open.
chrome.storage.local.get({ pollHistory: [], status: 'inactive', pollFinishTs: null },
  ({ pollHistory, status, pollFinishTs }) => {
    renderHistory(pollHistory);
    renderStatus(status);
    if (status === 'poll_detected' && pollFinishTs) startCountdown(pollFinishTs);
  }
);

$('historyToggle').addEventListener('click', () => {
  const list   = $('historyList');
  const isOpen = !list.classList.contains('hidden');
  list.classList.toggle('hidden', isOpen);
  $('historyToggle').textContent = isOpen ? '🕐 Recent polls' : '🕐 Hide recent polls';
});
