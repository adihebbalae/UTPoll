/**
 * offscreen.js — Runs inside the offscreen document.
 * On 'playAudio': plays a C5→E5→G5 chime immediately, then repeats every 4 s.
 * On 'stopAudio': cancels the loop.
 */
'use strict';

let chimeInterval = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'playAudio') {
    if (chimeInterval) return; // already looping
    playChime();
    chimeInterval = setInterval(playChime, 4000);
  } else if (message.action === 'stopAudio') {
    clearInterval(chimeInterval);
    chimeInterval = null;
  }
});

function playChime() {
  const ctx = new AudioContext();

  // C5 → E5 → G5 ascending chime
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

    osc.type           = 'sine';
    osc.frequency.value = freq;

    const t = ctx.currentTime + start;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.45, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    osc.start(t);
    osc.stop(t + 0.45);
  });

  // Release AudioContext after all notes have finished.
  setTimeout(() => ctx.close().catch(() => {}), 1000);
}
