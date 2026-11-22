/* Spellbound Chess — stone sound effects, synthesized with WebAudio (no audio files). */
(function (root) {
  'use strict';
  let ctx = null, enabled = true;

  function ensure() {
    if (!enabled) return null;
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noise(c, seconds, brown) {
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    const src = c.createBufferSource(); src.buffer = buf; return src;
  }

  function env(c, node, t0, attack, hold, release, peak) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.setValueAtTime(peak, t0 + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
    node.connect(g); g.connect(c.destination); return g;
  }

  function filtered(c, src, type, freq, q) {
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
    src.connect(f); return f;
  }

  const sounds = {
    tap() {
      const c = ensure(); if (!c) return; const t = c.currentTime;
      const s = noise(c, 0.08); env(c, filtered(c, s, 'bandpass', 1800, 3), t, 0.002, 0.01, 0.06, 0.25); s.start(t);
    },
    grind(duration) {
      const c = ensure(); if (!c) return; const t = c.currentTime, d = Math.min(duration || 0.35, 1.2);
      const s = noise(c, d + 0.1, true); env(c, filtered(c, s, 'lowpass', 420, 1), t, 0.04, d * 0.6, d * 0.4, 0.35); s.start(t);
    },
    crack() {
      const c = ensure(); if (!c) return; const t = c.currentTime;
      const s1 = noise(c, 0.12); env(c, filtered(c, s1, 'highpass', 2500), t, 0.001, 0.005, 0.09, 0.6); s1.start(t);
      const s2 = noise(c, 0.8, true); env(c, filtered(c, s2, 'lowpass', 900), t + 0.03, 0.01, 0.1, 0.6, 0.5); s2.start(t + 0.03);
      for (let i = 0; i < 5; i++) {
        const tt = t + 0.12 + Math.random() * 0.4, s = noise(c, 0.05);
        env(c, filtered(c, s, 'bandpass', 900 + Math.random() * 1500, 4), tt, 0.002, 0.005, 0.04, 0.15); s.start(tt);
      }
    },
    thud() {
      const c = ensure(); if (!c) return; const t = c.currentTime;
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
      env(c, o, t, 0.005, 0.05, 0.45, 0.6); o.start(t); o.stop(t + 0.6);
    },
    rumble() {
      const c = ensure(); if (!c) return; const t = c.currentTime;
      const s = noise(c, 2.2, true); env(c, filtered(c, s, 'lowpass', 220), t, 0.2, 0.9, 1.0, 0.7); s.start(t);
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(30, t + 1.8);
      env(c, o, t, 0.1, 0.8, 0.9, 0.35); o.start(t); o.stop(t + 2);
    },
    chime() {
      const c = ensure(); if (!c) return; const t = c.currentTime;
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        env(c, o, t + i * 0.09, 0.01, 0.05, 0.6, 0.12); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.8);
      });
    },
  };

  root.SBAudio = {
    play(name, arg) { try { if (enabled && sounds[name]) sounds[name](arg); } catch (e) { /* sound is optional */ } },
    setEnabled(v) { enabled = !!v; if (enabled) ensure(); },
    isEnabled() { return enabled; },
    unlock() { ensure(); },
  };
})(window);
