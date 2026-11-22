/* Spellbound Chess — SVG board, original stone pieces, and animation. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const SQ = 100;
  const FILES = 'abcdefgh';

  /* ---------- Original piece drawings (100 x 100 box, base at y = 90) ---------- */
  const PLINTH = '<path class="body" d="M24 80 h52 l4 10 h-60 z"/><path class="facet" d="M50 80 h26 l4 10 h-30 z"/>';
  const PIECES = {
    P: `<path class="body" d="M36 80 L41 58 Q50 54 59 58 L64 80 Z"/>
        <path class="body" d="M38 58 h24 v-5 h-24 z"/>
        <circle class="body" cx="50" cy="41" r="12"/>
        <path class="facet" d="M50 55 L59 58 L64 80 L50 80 Z M50 29 A12 12 0 0 1 50 53 Z"/>
        <circle class="rune" cx="45.5" cy="41" r="2.2"/><circle class="rune" cx="54.5" cy="41" r="2.2"/>`,
    R: `<path class="body" d="M32 80 L35 44 L65 44 L68 80 Z"/>
        <path class="body" d="M30 45 V25 h9 v8 h7 v-8 h8 v8 h7 v-8 h9 V45 Z"/>
        <path class="facet" d="M50 25 h4 v8 h7 v-8 h9 V45 L68 80 L50 80 Z"/>
        <path class="seam" d="M34 60 H66 M36 70 H64"/>
        <rect class="rune" x="40" y="51" width="7" height="3" rx="1"/><rect class="rune" x="53" y="51" width="7" height="3" rx="1"/>`,
    N: `<path class="body" d="M30 80 L36 63 Q29 56 31 46 L39 31 L45 17 L52 25 Q65 27 72 41 L74 52 Q70 57 63 54 L58 50 Q56 59 66 68 L70 80 Z"/>
        <path class="facet" d="M52 25 Q65 27 72 41 L74 52 Q70 57 63 54 L58 50 Q56 59 66 68 L70 80 L52 80 L50 46 Z"/>
        <path class="seam" d="M39 31 Q34 44 38 58 M44 22 Q40 36 43 52"/>
        <circle class="rune" cx="56" cy="35" r="2.8"/>`,
    B: `<path class="body" d="M34 80 L42 46 Q50 20 58 46 L66 80 Z"/>
        <path class="facet" d="M50 22 Q56 32 58 46 L66 80 L50 80 Z"/>
        <path class="hollow" d="M44 46 Q50 30 56 46 Q50 51 44 46 Z"/>
        <path class="seam" d="M42 62 Q50 66 58 62"/>
        <rect class="body" x="70" y="26" width="4" height="58" rx="2"/>
        <circle class="rune" cx="72" cy="21" r="5"/>
        <circle class="rune" cx="47.8" cy="43" r="1.7"/><circle class="rune" cx="52.2" cy="43" r="1.7"/>`,
    Q: `<path class="body" d="M33 80 L42 50 L58 50 L67 80 Z"/>
        <path class="body" d="M37 56 Q50 44 63 56 Z"/>
        <circle class="body" cx="50" cy="39" r="10"/>
        <path class="body" d="M36 22 Q50 40 64 22 Q50 31 36 22 Z"/>
        <path class="facet" d="M50 47 Q58 50 63 56 L67 80 L50 80 Z M50 29 A10 10 0 0 1 50 49 Z"/>
        <circle class="rune" cx="50" cy="25" r="2.4"/>
        <circle class="rune" cx="46" cy="39" r="2"/><circle class="rune" cx="54" cy="39" r="2"/>`,
    K: `<path class="body" d="M31 80 L40 48 L60 48 L69 80 Z"/>
        <rect class="body" x="40" y="29" width="20" height="19" rx="3"/>
        <rect class="body" x="38" y="15" width="6" height="15" rx="1"/>
        <rect class="body" x="47" y="8" width="6" height="22" rx="1"/>
        <rect class="body" x="56" y="15" width="6" height="15" rx="1"/>
        <path class="facet" d="M50 29 H57 Q60 29 60 32 V48 L69 80 L50 80 Z M53 8 V30 H50 V8 Z"/>
        <path class="seam" d="M36 64 H64"/>
        <circle class="rune" cx="45.5" cy="38" r="2.2"/><circle class="rune" cx="54.5" cy="38" r="2.2"/>`,
  };
  const pieceMarkup = (t) => `<ellipse class="shadow" cx="50" cy="90" rx="30" ry="5"/><g class="pose">${PLINTH}${PIECES[t]}<g class="cracks"></g></g>`;

  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function anim(node, frames, opts) {
    return new Promise((resolve) => {
      if (!node.animate) { resolve(); return; }
      const a = node.animate(frames, Object.assign({ fill: 'forwards' }, opts));
      a.onfinish = () => { const last = frames[frames.length - 1]; if (last.transform) node.style.transform = last.transform; if (last.opacity !== undefined) node.style.opacity = last.opacity; a.cancel(); resolve(); };
      a.oncancel = () => resolve();
    });
  }

  function create(svg, opts) {
    opts = opts || {};
    const reduced = () => (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) || opts.forceReduced;
    let orient = 'w';
    const pieceEls = new Map(); // square -> <g>

    svg.setAttribute('viewBox', '0 0 800 800');
    svg.innerHTML = '';
    const defs = el('defs', {}, svg);
    defs.innerHTML = `
      <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <pattern id="grainL" width="40" height="40" patternUnits="userSpaceOnUse">
        <rect width="40" height="40" fill="#B9B3A5"/><path d="M0 12 Q10 8 20 13 T40 11 M0 31 Q14 27 26 32 T40 30" stroke="#A9A395" stroke-width="1" fill="none"/>
        <circle cx="7" cy="22" r="1" fill="#C6C0B2"/><circle cx="31" cy="5" r="1.2" fill="#A7A193"/>
      </pattern>
      <pattern id="grainD" width="40" height="40" patternUnits="userSpaceOnUse">
        <rect width="40" height="40" fill="#5E5A55"/><path d="M0 9 Q12 13 22 8 T40 10 M0 28 Q9 33 21 27 T40 29" stroke="#55514C" stroke-width="1" fill="none"/>
        <circle cx="13" cy="19" r="1" fill="#67635E"/><circle cx="34" cy="36" r="1.2" fill="#534F4A"/>
      </pattern>`;

    const world = el('g', { class: 'world' }, svg);
    const squaresG = el('g', { class: 'squares' }, world);
    const marksG = el('g', { class: 'marks' }, world);
    const piecesG = el('g', { class: 'pieces' }, world);
    const fxG = el('g', { class: 'fx' }, world);
    const hintsG = el('g', { class: 'hints' }, world);
    const coordsG = el('g', { class: 'coords' }, world);

    const xy = (sq) => {
      let c = sq & 7, r = sq >> 3;
      if (orient === 'b') { c = 7 - c; r = 7 - r; }
      return [c * SQ, r * SQ];
    };
    const isLight = (sq) => ((sq >> 3) + (sq & 7)) % 2 === 0;
    const tf = (x, y) => `translate(${x}px, ${y}px)`;

    function drawSquares() {
      squaresG.innerHTML = ''; coordsG.innerHTML = '';
      for (let s = 0; s < 64; s++) {
        const [x, y] = xy(s);
        el('rect', { x, y, width: SQ, height: SQ, fill: isLight(s) ? 'url(#grainL)' : 'url(#grainD)', class: 'sq' }, squaresG);
      }
      el('rect', { x: 1, y: 1, width: 798, height: 798, class: 'frame' }, squaresG);
      for (let i = 0; i < 8; i++) {
        const file = orient === 'w' ? FILES[i] : FILES[7 - i];
        const rank = orient === 'w' ? 8 - i : i + 1;
        const fileSq = orient === 'w' ? 56 + i : 7 - i;   // bottom row square
        const rankSq = orient === 'w' ? i * 8 : 63 - i * 8; // left column square
        el('text', { x: i * SQ + 92, y: 793, class: 'coord ' + (isLight(fileSq) ? 'on-light' : 'on-dark'), 'text-anchor': 'end' }, coordsG).textContent = file;
        el('text', { x: 5, y: i * SQ + 17, class: 'coord ' + (isLight(rankSq) ? 'on-light' : 'on-dark') }, coordsG).textContent = rank;
      }
    }

    function makePiece(p, sq) {
      const t = p.toUpperCase(), side = p === t ? 'w' : 'b';
      const g = el('g', { class: `pc ${side}`, 'data-type': t }, piecesG);
      g.innerHTML = pieceMarkup(t);
      const [x, y] = xy(sq);
      g.style.transform = tf(x, y);
      pieceEls.set(sq, g);
      return g;
    }

    function setPosition(board) {
      piecesG.innerHTML = ''; pieceEls.clear();
      board.forEach((p, sq) => { if (p) makePiece(p, sq); });
    }

    function setOrientation(o, board) { orient = o; drawSquares(); if (board) setPosition(board); }

    function clearMarks() { marksG.innerHTML = ''; }

    function mark(state) {
      clearMarks();
      const { lastMove, selected, targets, check, captures } = state || {};
      if (lastMove) for (const s of [lastMove.from, lastMove.to]) { const [x, y] = xy(s); el('rect', { x, y, width: SQ, height: SQ, class: 'last' }, marksG); }
      if (selected !== undefined && selected !== null) { const [x, y] = xy(selected); el('rect', { x, y, width: SQ, height: SQ, class: 'sel' }, marksG); }
      if (check !== undefined && check !== null && check >= 0) {
        const [x, y] = xy(check);
        const g = el('g', { class: 'check ' + (isLight(check) ? 'on-light' : 'on-dark') }, marksG);
        el('circle', { cx: x + 50, cy: y + 50, r: 44, class: 'check-out' }, g);
        el('circle', { cx: x + 50, cy: y + 50, r: 44, class: 'check-in' }, g);
      }
      for (const s of targets || []) {
        const [x, y] = xy(s);
        if ((captures || []).includes(s)) {
          el('circle', { cx: x + 50, cy: y + 50, r: 45, class: 'ring-halo' }, marksG);
          el('circle', { cx: x + 50, cy: y + 50, r: 45, class: 'ring-core' }, marksG);
        } else {
          el('circle', { cx: x + 50, cy: y + 50, r: 11, class: 'dot' }, marksG);
        }
      }
    }

    function squareFromEvent(ev) {
      const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
      const m = svg.getScreenCTM(); if (!m) return -1;
      const p = pt.matrixTransform(m.inverse());
      let c = Math.floor(p.x / SQ), r = Math.floor(p.y / SQ);
      if (c < 0 || c > 7 || r < 0 || r > 7) return -1;
      if (orient === 'b') { c = 7 - c; r = 7 - r; }
      return r * 8 + c;
    }
    function pointFromEvent(ev) {
      const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
      const m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
    }

    /* ---------- drag support ---------- */
    let drag = null;
    function startDrag(sq, ev) {
      const g = pieceEls.get(sq); if (!g) return;
      piecesG.appendChild(g); g.classList.add('lifted');
      drag = { sq, g };
      moveDrag(ev);
    }
    function moveDrag(ev) {
      if (!drag) return;
      const p = pointFromEvent(ev);
      drag.g.style.transform = tf(p.x - 50, p.y - 62);
    }
    function endDrag(snapBack) {
      if (!drag) return;
      const { sq, g } = drag; drag = null; g.classList.remove('lifted');
      if (snapBack) { const [x, y] = xy(sq); g.style.transform = tf(x, y); }
    }
    const dragging = () => !!drag;

    function lift(sq, on) { const g = pieceEls.get(sq); if (g) g.classList.toggle('lifted', !!on); }

    /* ---------- effects ---------- */
    function shake() {
      if (reduced()) return Promise.resolve();
      return anim(world, [
        { transform: 'translate(0px,0px)' }, { transform: 'translate(-4px,2px)' }, { transform: 'translate(4px,-2px)' },
        { transform: 'translate(-3px,-1px)' }, { transform: 'translate(2px,2px)' }, { transform: 'translate(0px,0px)' }], { duration: 160 });
    }

    function addCracks(g) {
      const c = g.querySelector('.cracks'); if (!c) return;
      c.innerHTML = '';
      const paths = ['M50 30 L46 42 L53 50 L47 62 L52 76', 'M47 42 L38 48 L34 58', 'M53 50 L62 55 L66 68', 'M50 30 L56 24'];
      for (const d of paths) el('path', { d, class: 'crack' }, c);
    }

    function shatter(sq, side) {
      const [x0, y0] = xy(sq);
      if (reduced()) return Promise.resolve();
      const shards = [];
      const pts = [];
      for (let i = 0; i < 13; i++) pts.push([x0 + 32 + Math.random() * 36, y0 + 22 + Math.random() * 64]);
      for (const [px, py] of pts) {
        const s = 4 + Math.random() * 7, a = Math.random() * Math.PI;
        const poly = [0, 1, 2].map((k) => {
          const ang = a + k * 2.2 + Math.random() * 0.6;
          return `${(Math.cos(ang) * s).toFixed(1)},${(Math.sin(ang) * s).toFixed(1)}`;
        }).join(' ');
        const node = el('polygon', { points: poly, class: `shard ${side}` }, fxG);
        shards.push({ node, x: px, y: py, vx: (px - (x0 + 50)) * 0.09 + (Math.random() - 0.5) * 2.4, vy: -2.6 - Math.random() * 2.6, r: 0, vr: (Math.random() - 0.5) * 22 });
      }
      for (let i = 0; i < 6; i++) {
        const d = el('circle', { cx: x0 + 50 + (Math.random() - 0.5) * 40, cy: y0 + 84, r: 4, class: 'dust' }, fxG);
        anim(d, [{ transform: 'scale(1)', opacity: 0.55 }, { transform: `translate(${(Math.random() - 0.5) * 30}px, ${-10 - Math.random() * 14}px) scale(4)`, opacity: 0 }],
          { duration: 700 + Math.random() * 300, easing: 'ease-out' }).then(() => d.remove());
      }
      return new Promise((resolve) => {
        const t0 = performance.now();
        const step = (now) => {
          const t = (now - t0) / 650;
          for (const s of shards) {
            s.vy += 0.38; s.x += s.vx; s.y += s.vy; s.r += s.vr;
            s.node.setAttribute('transform', `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)}) rotate(${s.r.toFixed(0)})`);
            s.node.style.opacity = String(Math.max(0, 1 - t));
          }
          if (t < 1) requestAnimationFrame(step);
          else { shards.forEach((s) => s.node.remove()); resolve(); }
        };
        requestAnimationFrame(step);
      });
    }

    /* Path of squares a piece walks through (for the bob-per-square walk). */
    function walkPath(from, to) {
      const fr = from >> 3, fc = from & 7, tr = to >> 3, tc = to & 7;
      const dr = Math.sign(tr - fr), dc = Math.sign(tc - fc);
      const straight = fr === tr || fc === tc || Math.abs(tr - fr) === Math.abs(tc - fc);
      if (!straight) return null; // knight
      const out = []; let r = fr, c = fc;
      while (r !== tr || c !== tc) { r += dr; c += dc; out.push(r * 8 + c); }
      return out;
    }

    async function walk(g, from, to, stopShort) {
      const [x1, y1] = xy(from), [x2, y2] = xy(to);
      let tx = x2, ty = y2;
      if (stopShort) { const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1; tx = x2 - (dx / len) * 46; ty = y2 - (dy / len) * 46; }
      if (reduced()) { g.style.transform = tf(tx, ty); return; }
      const path = walkPath(from, to);
      if (!path) { // knight leaps in an arc
        const mx = (x1 + tx) / 2, my = Math.min(y1, ty) - 55;
        await anim(g, [{ transform: tf(x1, y1) }, { transform: tf(mx, my) + ' scale(1.06)' , offset: 0.5 }, { transform: tf(tx, ty) }],
          { duration: 480, easing: 'cubic-bezier(.4,0,.2,1)' });
        root.SBAudio && root.SBAudio.play('thud');
        return;
      }
      const n = path.length, frames = [{ transform: tf(x1, y1) }];
      for (let i = 1; i <= n; i++) {
        const fx = x1 + ((tx - x1) * i) / n, fy = y1 + ((ty - y1) * i) / n;
        const hx = x1 + ((tx - x1) * (i - 0.5)) / n, hy = y1 + ((ty - y1) * (i - 0.5)) / n;
        frames.push({ transform: tf(hx, hy - 5), offset: (i - 0.5) / n });
        frames.push({ transform: tf(fx, fy), offset: i / n });
      }
      root.SBAudio && root.SBAudio.play('grind', (300 + 60 * n) / 1000);
      await anim(g, frames, { duration: 300 + 60 * n, easing: 'ease-in-out' });
    }

    const STRIKES = {
      P: [{ transform: 'translate(0px,0px)' }, { transform: 'translate(-6px,0px) rotate(-6deg)', offset: 0.55 }, { transform: 'translate(10px,-2px) rotate(8deg)' }],
      N: [{ transform: 'translate(0px,0px)' }, { transform: 'translate(-4px,-16px) rotate(-14deg)', offset: 0.6 }, { transform: 'translate(8px,4px) rotate(4deg)' }],
      B: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-22deg)', offset: 0.55 }, { transform: 'rotate(26deg) translate(6px,0px)' }],
      R: [{ transform: 'translate(0px,0px)' }, { transform: 'translate(0px,-14px)', offset: 0.55 }, { transform: 'translate(8px,6px)' }],
      Q: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-28deg) translate(-4px,0px)', offset: 0.5 }, { transform: 'rotate(30deg) translate(10px,0px)' }],
      K: [{ transform: 'translate(0px,0px)' }, { transform: 'translate(-5px,0px)', offset: 0.55 }, { transform: 'translate(9px,0px)' }],
    };

    async function strike(attacker, victim, type, facingLeft) {
      const pose = attacker.querySelector('.pose');
      let frames = STRIKES[type] || STRIKES.P;
      if (facingLeft) frames = frames.map((f) => ({ ...f, transform: f.transform.replace(/translate\((-?\d+)px/g, (m, v) => `translate(${-v}px`).replace(/rotate\((-?\d+)deg/g, (m, v) => `rotate(${-v}deg`) }));
      await anim(pose, frames, { duration: 250, easing: 'ease-in' });
      addCracks(victim);
      root.SBAudio && root.SBAudio.play('crack');
      await wait(90);
      await anim(pose, [frames[frames.length - 1], { transform: 'translate(0px,0px) rotate(0deg)' }], { duration: 160 });
    }

    /* Animate a move that has already been validated. move: { from, to, piece, captured, flags, promotion }.
       The rendered position is updated to match after the animation. */
    async function animateMove(m) {
      const g = pieceEls.get(m.from);
      if (!g) return;
      piecesG.appendChild(g);
      const capSq = m.flags === 'e' ? m.to + (m.piece === 'P' ? 8 : -8) : m.to;
      const victim = m.captured ? pieceEls.get(capSq) : null;

      if (victim && !reduced()) {
        await walk(g, m.from, capSq, true);
        const [ax] = xy(m.from), [vx] = xy(capSq);
        await strike(g, victim, m.piece.toUpperCase(), vx < ax);
        const side = victim.classList.contains('w') ? 'w' : 'b';
        victim.style.opacity = '0';
        shake();
        await shatter(capSq, side);
        victim.remove(); pieceEls.delete(capSq);
        const [x1, y1] = xy(capSq), [x2, y2] = xy(m.to);
        const cur = g.style.transform;
        await anim(g, [{ transform: cur }, { transform: tf(x2, y2) }], { duration: 180, easing: 'ease-out' });
        void x1; void y1;
      } else {
        if (victim) { await anim(victim, [{ opacity: 1 }, { opacity: 0 }], { duration: 150 }); victim.remove(); pieceEls.delete(capSq); }
        if (m.flags === 'k' || m.flags === 'q') {
          const rookFrom = m.flags === 'k' ? m.to + 1 : m.to - 2, rookTo = m.flags === 'k' ? m.to - 1 : m.to + 1;
          const rook = pieceEls.get(rookFrom);
          await Promise.all([walk(g, m.from, m.to), rook ? walk(rook, rookFrom, rookTo) : null]);
          if (rook) { pieceEls.delete(rookFrom); pieceEls.set(rookTo, rook); }
        } else {
          await walk(g, m.from, m.to);
        }
      }
      pieceEls.delete(m.from);
      pieceEls.set(m.to, g);

      if (m.promotion) {
        const pose = g.querySelector('.pose');
        if (!reduced()) await anim(pose, [{ transform: 'translateY(0px) scaleY(1)' }, { transform: 'translateY(40px) scaleY(0.2)', opacity: 0.2 }], { duration: 260, easing: 'ease-in' });
        g.remove(); pieceEls.delete(m.to);
        const np = makePiece(m.promotion, m.to);
        root.SBAudio && root.SBAudio.play('grind', 0.5);
        if (!reduced()) {
          const npPose = np.querySelector('.pose');
          dustSwirl(m.to);
          await anim(npPose, [{ transform: 'translateY(40px) scaleY(0.2)', opacity: 0.2 }, { transform: 'translateY(-6px) scaleY(1.05)', opacity: 1, offset: 0.8 }, { transform: 'translateY(0px) scaleY(1)', opacity: 1 }], { duration: 420, easing: 'ease-out' });
        }
      }
    }

    function dustSwirl(sq) {
      const [x0, y0] = xy(sq);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const d = el('circle', { cx: x0 + 50, cy: y0 + 70, r: 3, class: 'dust' }, fxG);
        anim(d, [{ transform: 'translate(0px,0px) scale(1)', opacity: 0.6 }, { transform: `translate(${Math.cos(a) * 40}px, ${Math.sin(a) * 18 - 20}px) scale(3)`, opacity: 0 }], { duration: 600, easing: 'ease-out' }).then(() => d.remove());
      }
    }

    async function topple(kingSq) {
      const g = pieceEls.get(kingSq); if (!g) return;
      const pose = g.querySelector('.pose');
      addCracks(g);
      root.SBAudio && root.SBAudio.play('rumble');
      if (reduced()) { g.style.opacity = '0.35'; return; }
      await anim(pose, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-6deg)', offset: 0.3 }, { transform: 'rotate(88deg) translate(0px,6px)' }], { duration: 900, easing: 'cubic-bezier(.5,0,.8,.4)' });
      shake();
      const side = g.classList.contains('w') ? 'w' : 'b';
      g.style.opacity = '0';
      await shatter(kingSq, side);
    }

    async function bow(squares) {
      if (reduced()) return;
      root.SBAudio && root.SBAudio.play('tap');
      await Promise.all(squares.map((sq) => { const g = pieceEls.get(sq); return g ? anim(g.querySelector('.pose'), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(10deg)', offset: 0.5 }, { transform: 'rotate(0deg)' }], { duration: 700 }) : null; }));
    }

    function pulseCheck() { root.SBAudio && root.SBAudio.play('thud'); }

    function setThinking(side, on) { svg.classList.toggle('thinking-' + side, !!on); }

    function showArrow(from, to) {
      hintsG.innerHTML = '';
      if (from < 0) return;
      const [x1, y1] = xy(from), [x2, y2] = xy(to);
      el('line', { x1: x1 + 50, y1: y1 + 50, x2: x2 + 50, y2: y2 + 50, class: 'hint-arrow', 'marker-end': 'url(#arrowhead)' }, hintsG);
    }
    defs.insertAdjacentHTML('beforeend', '<marker id="arrowhead" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#8EC5E8"/></marker>');

    drawSquares();
    return { setPosition, setOrientation, mark, clearMarks, squareFromEvent, startDrag, moveDrag, endDrag, dragging, lift,
      animateMove, topple, bow, pulseCheck, setThinking, showArrow, get orientation() { return orient; } };
  }

  root.SBRender = { create, pieceMarkup };
})(window);
