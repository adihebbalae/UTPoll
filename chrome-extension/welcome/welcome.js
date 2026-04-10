'use strict';

document.getElementById('testChimeBtn').addEventListener('click', function () {
  const btn = this;
  btn.disabled    = true;
  btn.textContent = '\u266a Playing\u2026';

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
