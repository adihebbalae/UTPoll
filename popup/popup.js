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
const armBtn       = $('armAudioBtn');

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
  }
);

// ── Load current status + arm state ──────────────────────────────────────────────
chrome.storage.local.get({ status: 'inactive', audioArmed: false }, ({ status, audioArmed }) => {
  renderStatus(status);
  if (audioArmed) {
    armBtn.textContent = '✅ Audio armed';
    armBtn.disabled    = true;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.status) {
    renderStatus(changes.status.newValue);
  }
});

const STATUS_MAP = {
  inactive:      { dot: 'gray',  text: 'Not on Instapoll page' },
  monitoring:    { dot: 'green', text: 'Monitoring…' },
  poll_detected:    { dot: 'red',   text: 'Poll detected!' },
  autosubmit_ok:    { dot: 'green', text: 'Attendance submitted ✅' },
  autosubmit_fail:  { dot: 'red',   text: 'Auto-submit failed — submit manually!' },
};

function renderStatus(status) {
  const { dot, text } = STATUS_MAP[status] || STATUS_MAP.inactive;
  statusDot.className  = 'dot ' + dot;
  statusText.textContent = text;
}

// ── Show / hide ntfy topic input ──────────────────────────────────────────────
enablePush.addEventListener('change', () => {
  ntfySection.classList.toggle('hidden', !enablePush.checked);
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

  armBtn.textContent = '✅ Audio armed';
  armBtn.disabled    = true;
  chrome.storage.local.set({ audioArmed: true });
});
