/* Spellbound Chess — game flow, controls and panels. */
(function () {
  'use strict';
  const { Game, typeOf, colorOf } = window.SBRules;
  const LEVELS = window.SBEngine.LEVELS;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- state ---------- */
  const profile = store.get('spellbound.profile', null) || { player_id: uuid(), handle: '' };
  store.set('spellbound.profile', profile);
  const settings = Object.assign({ sound: true, seenHelp: false, level: 1, color: 'w' }, store.get('spellbound.settings', {}));
  const saveSettings = () => store.set('spellbound.settings', settings);

  let game = new Game();
  let playerColor = 'w';
  let level = settings.level;
  let phase = 'idle'; // player | engine | animating | over | replay
  let selected = null, pointerDownSq = null, dragStarted = false, downPos = null;
  let lastMove = null, gameOver = null, gameStart = Date.now(), savedThisGame = false;
  let book = null, allGames = [], ladderData = null, ladderTab = 'all';
  let gameToken = 0;

  const svg = $('board');
  const webglOK = () => { try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; } };
  let R = null;
  if (window.SBRender3D && webglOK() && !/[?&]flat\b/.test(location.search)) {
    try { $('board3d').hidden = false; svg.style.display = 'none'; R = window.SBRender3D.create($('board3d')); } catch (e) { R = null; }
  }
  if (!R) { $('board3d').hidden = true; svg.style.display = ''; R = window.SBRender.create(svg); }
  const boardEl = R.el || svg;
  $('viewBtn').hidden = !R.is3D;
  document.body.classList.toggle('is3d', !!R.is3D);
  let watching = false;

  /* ---------- engine (Web Worker, with a main-thread fallback) ---------- */
  let worker = null, reqId = 0;
  const pending = new Map();
  try {
    worker = new Worker('engine.worker.js');
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data); } };
    worker.onerror = () => { worker = null; };
  } catch (e) { worker = null; }
  function askEngine(payload) {
    return new Promise((resolve) => {
      if (worker) {
        const id = ++reqId; pending.set(id, resolve);
        worker.postMessage(Object.assign({ id }, payload));
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(local(payload)); } }, 8000);
      } else setTimeout(() => resolve(local(payload)), 30);
    });
  }
  function local(p) {
    if (p.kind === 'eval') return { value: window.SBEngine.evalFor(p.fen, p.color) };
    return { move: window.SBEngine.chooseMove(p.fen, p.level, { sanHistory: p.sanHistory, book: p.book }) };
  }

  /* ---------- opening book (optional file) ---------- */
  fetch('opening_tree.json').then((r) => (r.ok ? r.json() : null)).then((j) => { book = j; updateHint(); }).catch(() => {});

  /* ---------- UI helpers ---------- */
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms || 2200);
  }
  function setStatus(text, isCheck) { const s = $('status'); s.textContent = text; s.classList.toggle('check', !!isCheck); }
  function confirmBox(title, text) {
    return new Promise((resolve) => {
      $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('confirmOverlay').hidden = false;
      const done = (v) => { $('confirmOverlay').hidden = true; $('confirmYes').onclick = $('confirmNo').onclick = null; resolve(v); };
      $('confirmYes').onclick = () => done(true); $('confirmNo').onclick = () => done(false);
      $('confirmYes').focus();
    });
  }

  function refreshMarks(extra) {
    const st = Object.assign({ lastMove }, extra || {});
    st.check = game.inCheck() ? game.kingSquare(game.turn) : null;
    R.mark(st);
    if (R.setTurn) R.setTurn(game.turn, game.inCheck());
  }

  function renderMoves() {
    const ol = $('moveList'); ol.innerHTML = '';
    const h = game.sanHistory;
    for (let i = 0; i < h.length; i += 2) {
      const li = document.createElement('li');
      li.innerHTML = `<b>${i / 2 + 1}.</b>${h[i]}${h[i + 1] ? ' ' + h[i + 1] : ''}`;
      ol.appendChild(li);
    }
    if (!$('moveList').closest('.moves').classList.contains('expanded')) {
      const items = [...ol.children]; items.slice(0, Math.max(0, items.length - 3)).forEach((li) => li.remove());
    } else ol.scrollTop = ol.scrollHeight;
  }

  function miniPiece(p) {
    const t = p.toUpperCase(), side = p === t ? 'w' : 'b';
    return `<svg viewBox="0 0 100 100" aria-label="${side === 'w' ? 'white' : 'black'} ${t}"><g class="pc ${side}">${window.SBRender.pieceMarkup(t)}</g></svg>`;
  }
  function renderTrays() {
    const takenBy = { w: [], b: [] };
    for (const m of game.moveHistory) if (m.captured) takenBy[colorOf(m.piece)].push(m.captured);
    const order = 'QRBNP';
    const sortP = (arr) => arr.sort((a, b) => order.indexOf(a.toUpperCase()) - order.indexOf(b.toUpperCase()));
    const top = R.orientation === 'w' ? 'b' : 'w'; // the side at the top of the board
    $('trayTop').innerHTML = sortP(takenBy[top]).map(miniPiece).join('');
    $('trayBottom').innerHTML = sortP(takenBy[top === 'w' ? 'b' : 'w']).map(miniPiece).join('');
  }

  function syncBoard(rebuild) { if (rebuild !== false || !R.is3D) R.setPosition(game.board); refreshMarks(); renderMoves(); renderTrays(); updateHint(); updateButtons(); }

  function updateButtons() {
    const live = !watching && (phase === 'player' || phase === 'engine');
    $('drawBtn').disabled = !live || game.sanHistory.length < 2;
    $('resignBtn').disabled = !live || game.sanHistory.length < 1;
  }

  /* ---------- game flow ---------- */
  async function newGame() {
    gameToken++;
    $('resultOverlay').hidden = true; $('promo').hidden = true; $('hintPanel').hidden = true;
    R.setThinking('w', false); R.setThinking('b', false); R.showArrow(-1);
    game = new Game(); lastMove = null; gameOver = null; selected = null; savedThisGame = false; gameStart = Date.now();
    watching = false; $('watchBtn').textContent = '▶ Watch';
    level = Number($('level').value);
    const c = $('color').value;
    playerColor = c === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : c;
    R.setOrientation(playerColor, game.board);
    syncBoard();
    if (R.intro) {
      const token = gameToken; phase = 'intro'; updateButtons(); setStatus('The armies rise…');
      await R.intro();
      if (token !== gameToken) return;
    }
    if (game.turn === playerColor) { phase = 'player'; setStatus('Your move'); }
    else { phase = 'engine'; engineTurn(); }
    updateButtons();
  }

  async function engineTurn() {
    const token = gameToken;
    phase = 'engine'; updateButtons();
    setStatus('The stones are thinking…');
    const side = game.turn;
    R.setThinking(side, true);
    const t0 = Date.now();
    const res = await askEngine({ fen: game.fen(), level, sanHistory: game.sanHistory.slice(), book });
    const minThink = 550 + Math.random() * 400;
    if (Date.now() - t0 < minThink) await wait(minThink - (Date.now() - t0));
    R.setThinking(side, false);
    if (token !== gameToken || phase !== 'engine') return;
    if (!res || !res.move) { toast('The computer could not move.'); return; }
    await playMove(res.move);
  }

  async function playMove(spec) {
    const token = gameToken;
    const played = game.move(spec);
    if (!played) return false;
    phase = 'animating'; selected = null; updateButtons();
    R.mark({ lastMove: null });
    const byPlayer = !watching && colorOf(played.piece) === playerColor;
    const danger = byPlayer && game.attacked(played.to, game.turn);
    if (token === gameToken) await R.animateMove(played, { hesitate: danger, celebrate: true });
    if (token !== gameToken) return true;
    lastMove = { from: played.from, to: played.to };
    syncBoard(false);
    const mover = colorOf(played.piece) === playerColor ? 'You' : 'Stones';
    const st = game.status();
    if (st) { await endGame(st.result, st.reason); return true; }
    if (game.inCheck()) { R.pulseCheck(); if (R.checkGuard) R.checkGuard(game.kingSquare(game.turn)); if (R.thunder) R.thunder(); }
    if (watching) { setStatus(`Watching · ${colorOf(played.piece) === 'w' ? 'Moonstone' : 'Obsidian'} played ${played.san}`); engineTurn(); }
    else if (game.turn === playerColor) { phase = 'player'; setStatus(game.inCheck() ? 'Check! Your move' : `${mover === 'Stones' ? 'Stones played ' + played.san + ' · ' : ''}Your move`, game.inCheck()); }
    else { engineTurn(); }
    updateButtons();
    return true;
  }

  async function endGame(result, reason) {
    phase = 'over'; selected = null; updateButtons();
    R.setThinking('w', false); R.setThinking('b', false);
    const playerWon = (result === '1-0' && playerColor === 'w') || (result === '0-1' && playerColor === 'b');
    const draw = result === '1/2-1/2';
    gameOver = { result, reason, res: draw ? 'D' : playerWon ? 'W' : 'L' };
    if (reason === 'checkmate') {
      const loser = result === '1-0' ? 'b' : 'w';
      setStatus('Checkmate');
      if (R.setAlert) R.setAlert('mate', loser === 'w' ? 'b' : 'w');
      await (R.surrender || R.topple)(game.kingSquare(loser));
    } else if (draw) {
      setStatus('Draw');
      await R.bow([game.kingSquare('w'), game.kingSquare('b')]);
    } else setStatus(playerWon ? 'You win' : 'You resigned');
    if (watching) {
      const token = gameToken;
      setStatus(`${draw ? 'Draw' : (result === '1-0' ? 'Moonstone' : 'Obsidian') + ' wins'} ${REASONS[reason] || ''} · next battle soon…`);
      await wait(4500);
      if (watching && token === gameToken) startWatch();
      return;
    }
    if (playerWon) window.SBAudio.play('chime');
    showResult();
  }

  const REASONS = { checkmate: 'by checkmate', stalemate: 'by stalemate', threefold: 'by threefold repetition', fifty_move: 'by the 50-move rule',
    insufficient: 'by insufficient material', resign: 'by resignation', draw_agreed: 'by agreement' };

  function myStats() {
    const p = ladderData && ladderData.players.get(profile.player_id);
    return p || { rating: window.SBLadder.START, games: 0, w: 0, d: 0, l: 0, history: [], best: 0 };
  }

  function showResult() {
    const { res, reason } = gameOver;
    $('resultTitle').textContent = res === 'W' ? 'Victory!' : res === 'D' ? 'Draw' : 'Defeat';
    $('resultSub').textContent = `${res === 'W' ? 'You beat' : res === 'D' ? 'You drew with' : 'You lost to'} Level ${level} ${LEVELS[level].name} ${REASONS[reason] || ''} in ${Math.ceil(game.sanHistory.length / 2)} move${Math.ceil(game.sanHistory.length / 2) === 1 ? '' : 's'}.`;
    const me = myStats();
    const d = window.SBLadder.preview(me.rating, me.games, LEVELS[level].elo, res);
    const el = $('resultDelta');
    el.className = 'result-delta ' + (d > 0.5 ? 'good' : d < -0.5 ? 'alert' : 'neutral');
    el.textContent = `${d > 0.5 ? '▲ +' : d < -0.5 ? '▼ −' : '■ ±'}${Math.abs(Math.round(d))} if saved`;
    $('saveBtn').disabled = false; $('saveBtn').textContent = 'Save to ladder';
    $('saveNote').textContent = '';
    $('resultOverlay').hidden = false;
    $('saveBtn').focus();
  }

  async function saveGame() {
    if (savedThisGame || !gameOver) return;
    if (!profile.handle) { const ok = await askName(); if (!ok) return; }
    const rec = {
      player_id: profile.player_id, handle: profile.handle, level, engine_elo: LEVELS[level].elo, player_color: playerColor,
      result: gameOver.res, termination: gameOver.reason, ply_count: game.sanHistory.length, pgn: game.pgn(),
      app_version: (window.SB_CONFIG && window.SB_CONFIG.appVersion) || '0.1.0',
    };
    if (!window.SBLadder.verify(rec)) { $('saveNote').textContent = 'This game could not be verified, so it was not saved.'; return; }
    $('saveBtn').disabled = true; $('saveBtn').textContent = 'Saving…';
    const before = myStats().rating;
    const { mode } = await window.SBLadder.save(rec);
    savedThisGame = true;
    await refreshLadder();
    const after = myStats().rating;
    countUp($('rating'), before, after);
    $('saveBtn').textContent = 'Saved ✓';
    $('saveNote').textContent = mode === 'live' ? 'Saved to the online ladder.' : 'Saved in this browser (online ladder not connected).';
  }

  function countUp(node, a, b) {
    const t0 = performance.now(), dur = 900;
    const step = (now) => { const t = Math.min(1, (now - t0) / dur); node.textContent = fmt(a + (b - a) * (1 - Math.pow(1 - t, 3))); if (t < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  async function replayMoves() {
    $('resultOverlay').hidden = true;
    const moves = game.moveHistory.slice();
    const final = game, token = ++gameToken;
    phase = 'replay';
    const g = new Game(); game = g; lastMove = null;
    R.setPosition(g.board); R.mark({});
    setStatus('Replaying…');
    for (const m of moves) {
      if (token !== gameToken) return;
      const played = g.move(m);
      await R.animateMove(played);
      lastMove = { from: played.from, to: played.to };
      R.setPosition(g.board); refreshMarks(); renderMoves(); renderTrays();
      await wait(250);
    }
    if (token !== gameToken) return;
    game = final; phase = 'over';
    setStatus('Replay finished');
    $('resultOverlay').hidden = false;
  }

  /* ---------- player input ---------- */
  function legalFrom(sq) { return game.legalMoves().filter((m) => m.from === sq); }
  function showSelection(sq) {
    selected = sq;
    const ms = legalFrom(sq);
    refreshMarks({ selected: sq, targets: [...new Set(ms.map((m) => m.to))], captures: ms.filter((m) => m.captured).map((m) => m.to) });
  }
  function clearSelection() { selected = null; if (R.relax) R.relax(); refreshMarks(); }

  async function tryMove(from, to) {
    const options = game.legalMoves().filter((m) => m.from === from && m.to === to);
    if (!options.length) return false;
    let promotion = null;
    if (options[0].promotion) { promotion = await pickPromotion(); if (!promotion) { clearSelection(); return true; } }
    await playMove({ from, to, promotion });
    return true;
  }

  function pickPromotion() {
    return new Promise((resolve) => {
      const box = $('promoChoices'); box.innerHTML = '';
      for (const t of 'QRBN') {
        const b = document.createElement('button');
        const p = playerColor === 'w' ? t : t.toLowerCase();
        b.innerHTML = miniPiece(p); b.title = { Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight' }[t];
        b.onclick = () => { $('promo').hidden = true; resolve(p); };
        box.appendChild(b);
      }
      const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.style.width = '70px';
      cancel.onclick = () => { $('promo').hidden = true; resolve(null); }; box.appendChild(cancel);
      $('promo').hidden = false; box.firstChild.focus();
    });
  }

  boardEl.addEventListener('pointerdown', (ev) => {
    window.SBAudio.unlock();
    if (phase !== 'player') return;
    const sq = R.squareFromEvent(ev); if (sq < 0) return;
    const p = game.board[sq];
    if (selected !== null && selected !== sq && legalFrom(selected).some((m) => m.to === sq)) {
      const from = selected; tryMove(from, sq); return;
    }
    if (p && colorOf(p) === playerColor) {
      boardEl.setPointerCapture(ev.pointerId);
      pointerDownSq = sq; dragStarted = false; downPos = { x: ev.clientX, y: ev.clientY };
      if (selected !== sq) { showSelection(sq); window.SBAudio.play('tap'); }
      R.lift(sq, true);
    } else clearSelection();
  });
  const NAMES = { P: 'Pawn', N: 'Knight', B: 'Bishop', R: 'Rook', Q: 'Queen', K: 'King' };
  function showTip(ev) {
    const tip = $('pieceTip');
    const sq = R.squareFromEvent(ev);
    const p = sq >= 0 ? game.board[sq] : null;
    if (!p || pointerDownSq !== null) { tip.hidden = true; return; }
    const side = colorOf(p) === 'w' ? 'White' : 'Black';
    tip.textContent = `${side} ${NAMES[typeOf(p)]} · ${window.SBRules.sqName(sq)}`;
    const box = $('pieceTip').parentElement.getBoundingClientRect();
    tip.style.left = `${ev.clientX - box.left + 14}px`; tip.style.top = `${ev.clientY - box.top + 14}px`;
    tip.hidden = false;
  }
  boardEl.addEventListener('pointerleave', () => { $('pieceTip').hidden = true; });
  boardEl.addEventListener('pointermove', (ev) => {
    if (pointerDownSq === null) return;
    if (!dragStarted && downPos && Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y) > 6) { dragStarted = true; R.startDrag(pointerDownSq, ev); }
    if (dragStarted) R.moveDrag(ev);
  });
  boardEl.addEventListener('pointerup', async (ev) => {
    if (pointerDownSq === null) return;
    const from = pointerDownSq; pointerDownSq = null;
    R.lift(from, false);
    if (!dragStarted) return; // simple click: keep the selection
    dragStarted = false;
    const to = R.squareFromEvent(ev);
    R.endDrag(true);
    if (to >= 0 && to !== from && legalFrom(from).some((m) => m.to === to)) await tryMove(from, to);
  });
  boardEl.addEventListener('pointercancel', () => { if (pointerDownSq !== null) { R.lift(pointerDownSq, false); R.endDrag(true); pointerDownSq = null; dragStarted = false; } });

  $('typeForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const inp = $('typeMove'), txt = inp.value.trim();
    if (!txt) return;
    if (phase !== 'player') { toast('Wait for your turn.'); return; }
    const probe = game.move(txt);
    if (!probe) { toast(`"${txt}" isn't a legal move here.`); return; }
    game.undo();
    inp.value = '';
    await playMove({ from: probe.from, to: probe.to, promotion: probe.promotion });
  });

  /* ---------- buttons ---------- */
  $('newBtn').onclick = async () => {
    if (watching) { newGame(); return; }
    if ((phase === 'player' || phase === 'engine') && game.sanHistory.length > 1) {
      const ok = await confirmBox('Abandon this game?', 'It counts as a resignation if you save it.');
      if (!ok) return;
      gameToken++;
      await endGame(playerColor === 'w' ? '0-1' : '1-0', 'resign');
      return;
    }
    newGame();
  };
  $('resignBtn').onclick = async () => {
    if (!(phase === 'player' || phase === 'engine')) return;
    if (!(await confirmBox('Resign?', 'Your king will lay down his crown.'))) return;
    gameToken++;
    await endGame(playerColor === 'w' ? '0-1' : '1-0', 'resign');
  };
  $('drawBtn').onclick = async () => {
    if (phase !== 'player') { toast('Offer a draw on your turn.'); return; }
    const engineColor = playerColor === 'w' ? 'b' : 'w';
    const { value } = await askEngine({ kind: 'eval', fen: game.fen(), color: engineColor });
    if (game.sanHistory.length >= 40 && Math.abs(value) <= 50) await endGame('1/2-1/2', 'draw_agreed');
    else toast(game.sanHistory.length < 40 ? 'The stones refuse: too early for peace (after move 20).' : 'The stones refuse your draw.');
  };
  function startWatch() {
    gameToken++;
    $('resultOverlay').hidden = true; $('promo').hidden = true; $('hintPanel').hidden = true;
    game = new Game(); lastMove = null; gameOver = null; selected = null;
    watching = true; playerColor = null; level = Number($('level').value);
    $('watchBtn').textContent = '■ Stop';
    R.setOrientation(R.orientation || 'w', game.board);
    syncBoard();
    const token = gameToken;
    (async () => {
      if (R.intro) { phase = 'intro'; setStatus('The armies rise…'); await R.intro(); }
      if (token !== gameToken || !watching) return;
      setStatus('Watching the stones battle…');
      engineTurn();
    })();
  }
  $('watchBtn').onclick = () => { if (watching) newGame(); else startWatch(); };
  $('viewBtn').onclick = () => { if (!R.setView) return; R.setView(R.view === 'battle' ? 'overhead' : 'battle'); $('viewBtn').textContent = R.view === 'battle' ? '◎ Top view' : '◈ Battle view'; };
  $('flipBtn').onclick = () => { R.setOrientation(R.orientation === 'w' ? 'b' : 'w', game.board); refreshMarks(); renderTrays(); };
  $('level').value = String(settings.level); $('color').value = settings.color;
  $('level').onchange = () => { settings.level = Number($('level').value); saveSettings(); if (phase === 'player' && game.sanHistory.length < 1) level = settings.level; toast('New level applies to your next game.'); };
  $('color').onchange = () => { settings.color = $('color').value; saveSettings(); toast('Applies to your next game.'); };
  $('saveBtn').onclick = saveGame;
  $('againBtn').onclick = () => newGame();
  $('replayBtn').onclick = replayMoves;
  $('movesToggle').onclick = () => { const c = $('moveList').closest('.moves'); c.classList.toggle('expanded'); $('movesToggle').textContent = c.classList.contains('expanded') ? 'show less' : 'show all'; renderMoves(); };

  function applySound() { window.SBAudio.setEnabled(settings.sound); $('soundLabel').textContent = settings.sound ? 'Sound on' : 'Sound off'; $('soundBtn').setAttribute('aria-pressed', String(settings.sound)); }
  $('soundBtn').onclick = () => { settings.sound = !settings.sound; saveSettings(); applySound(); };
  $('helpBtn').onclick = () => { $('helpOverlay').hidden = false; };
  $('helpClose').onclick = () => { $('helpOverlay').hidden = true; settings.seenHelp = true; saveSettings(); window.SBAudio.unlock(); };

  /* ---------- name ---------- */
  const BLOCK = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'bitch', 'whore', 'rape', 'nazi', 'hitler', 'porn', 'dick', 'cock', 'pussy', 'slut', 'retard'];
  function nameProblem(n) {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(n)) return 'Use 3–16 letters, numbers or _.';
    const low = n.toLowerCase().replace(/_/g, '');
    if (BLOCK.some((w) => low.includes(w))) return 'Please pick a different name.';
    return '';
  }
  function askName() {
    return new Promise((resolve) => {
      $('nameInput').value = profile.handle || ''; $('nameError').textContent = ''; $('nameOverlay').hidden = false; $('nameInput').focus();
      $('nameForm').onsubmit = (ev) => {
        ev.preventDefault();
        const n = $('nameInput').value.trim(), problem = nameProblem(n);
        if (problem) { $('nameError').textContent = problem; return; }
        const renamed = profile.handle && profile.handle !== n;
        profile.handle = n; store.set('spellbound.profile', profile);
        $('nameOverlay').hidden = true; renderRating();
        if (renamed && window.SBLadder.mode === 'live') toast('Your new name shows on the ladder after your next saved game.', 3200);
        resolve(true);
      };
      $('nameCancel').onclick = () => { $('nameOverlay').hidden = true; resolve(false); };
    });
  }
  $('renameBtn').onclick = () => askName();

  /* ---------- rating tile + ladder ---------- */
  async function refreshLadder() {
    allGames = await window.SBLadder.loadAll();
    ladderData = window.SBLadder.compute(allGames);
    const live = window.SBLadder.mode === 'live';
    $('chip').textContent = live ? '● LIVE' : '○ LOCAL'; $('chip').classList.toggle('live', live);
    $('ladderNote').textContent = live ? '' : 'Scores are kept in this browser.';
    renderRating(); renderLadder();
  }

  function renderRating() {
    const me = myStats();
    $('handle').textContent = profile.handle || 'Unnamed player';
    $('rating').textContent = fmt(me.rating) + (me.games > 0 && me.games < window.SBLadder.PROVISIONAL ? '?' : '');
    const last = me.history[me.history.length - 1];
    const d = last ? last.delta : 0;
    const del = $('delta');
    del.className = 'delta ' + (d > 0.5 ? 'good' : d < -0.5 ? 'alert' : 'neutral');
    del.textContent = d > 0.5 ? `▲ +${Math.round(d)}` : d < -0.5 ? `▼ −${Math.abs(Math.round(d))}` : '■ ±0';
    $('record').textContent = `W ${me.w} · D ${me.d} · L ${me.l}`;
    if (!me.games) $('ratingSub').textContent = 'Play and save a game to get your rating (everyone starts at 1200)';
    else {
      const rank = me.rank ? `Rank #${me.rank} of ${ladderData.ranked.length}` : `Ranked after ${window.SBLadder.PROVISIONAL} games (${me.games} so far)`;
      $('ratingSub').textContent = `${rank}${me.best ? ' · Best win: Level ' + me.best : ''}`;
    }
    renderSpark(me.history);
  }

  function renderSpark(history) {
    const s = $('spark'); s.innerHTML = '';
    if (history.length < 2) return;
    const vals = [window.SBLadder.START].concat(history.map((h) => h.after));
    const lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(20, hi - lo);
    const X = (i) => 30 + (i / (vals.length - 1)) * 380, Y = (v) => 44 - ((v - lo) / span) * 38;
    const ns = 'http://www.w3.org/2000/svg';
    const ref = document.createElementNS(ns, 'line'); ref.setAttribute('class', 'ref');
    ref.setAttribute('x1', 30); ref.setAttribute('x2', 410); ref.setAttribute('y1', Y(1200)); ref.setAttribute('y2', Y(1200)); s.appendChild(ref);
    const path = document.createElementNS(ns, 'polyline'); path.setAttribute('class', 'line');
    path.setAttribute('points', vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')); s.appendChild(path);
    const lbl = (x, y, t, anchor) => { const e = document.createElementNS(ns, 'text'); e.setAttribute('x', x); e.setAttribute('y', y); e.setAttribute('text-anchor', anchor); e.textContent = t; s.appendChild(e); };
    lbl(26, 14, fmt(hi), 'end'); lbl(26, 48, fmt(lo), 'end');
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function renderLadder() {
    const body = $('ladderBody'); if (!ladderData) { body.innerHTML = ''; return; }
    const me = profile.player_id;
    if (ladderTab === 'mine') {
      const p = ladderData.players.get(me);
      if (!p) { body.innerHTML = '<div class="empty">Your saved games will show here.</div>'; return; }
      const rows = p.history.slice(-20).reverse().map((h) => {
        const g = h.game, d = h.delta;
        return `<tr><td>${esc(String(g.created_at).slice(0, 10))}</td><td>Lv ${g.level}</td><td>${g.player_color === 'w' ? 'White' : 'Black'}</td>
          <td>${g.result === 'W' ? 'Win' : g.result === 'D' ? 'Draw' : 'Loss'}</td><td class="num">${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d))}</td></tr>`;
      }).join('');
      body.innerHTML = `<table><thead><tr><th>Date</th><th>Level</th><th>Color</th><th>Result</th><th class="num">Rating</th></tr></thead><tbody>${rows}</tbody></table>`;
      return;
    }
    const list = ladderTab === 'today' ? ladderData.today : ladderData.ranked;
    if (!list.length) {
      body.innerHTML = `<div class="empty">${ladderTab === 'today' ? 'No saved games yet today.' : `Nobody is ranked yet. Players appear after ${window.SBLadder.PROVISIONAL} saved games.`}</div>`;
      return;
    }
    const top = list.slice(0, 10);
    const myIdx = list.findIndex((p) => p.player_id === me);
    const row = (p, i) => {
      const val = ladderTab === 'today' ? `${p.today >= 0 ? '+' : '−'}${Math.abs(Math.round(p.today))}` : fmt(p.rating);
      return `<tr class="${p.player_id === me ? 'me' : ''}"><td class="num">${i + 1}</td><td>${p.player_id === me ? '<b>YOU</b> · ' : ''}${esc(p.handle)}</td>
        <td class="num">${val}</td><td class="num">${p.games}</td><td class="num">${p.best ? 'Lv ' + p.best : '—'}</td></tr>`;
    };
    let rows = top.map(row).join('');
    if (myIdx >= 10) rows += `<tr class="gap"><td colspan="5">⋯</td></tr>` + row(list[myIdx], myIdx);
    body.innerHTML = `<table><thead><tr><th class="num">#</th><th>Name</th><th class="num">${ladderTab === 'today' ? 'Today' : 'Rating'}</th><th class="num">Games</th><th class="num">Best win</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => { document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b)); ladderTab = b.dataset.tab; renderLadder(); }; });

  /* ---------- hint ---------- */
  function hintNode() { return book && game.sanHistory.length <= 10 ? book[game.sanHistory.join(' ')] : null; }
  function updateHint() { $('hintBtn').hidden = !book; if (!$('hintPanel').hidden) renderHint(); }
  function renderHint() {
    const panel = $('hintPanel'), node = hintNode();
    R.showArrow(-1);
    if (!node) { panel.innerHTML = '<h3>WHAT REAL PLAYERS DID</h3><div class="small">No recorded games reached this position.</div>'; return; }
    const tot = node.w + node.d + node.b || 1, pct = (x) => Math.round((100 * x) / tot);
    const seg = (cls, v, label) => `<div class="${cls}" style="width:${(100 * v) / tot}%">${pct(v) >= 12 ? label + ' ' + pct(v) + '%' : ''}</div>`;
    panel.innerHTML = `<h3>HOW GAMES FROM HERE ENDED · ${fmt(tot)} games</h3>
      <div class="hint-bar">${seg('w', node.w, 'White')}${seg('d', node.d, 'Draw')}${seg('b', node.b, 'Black')}</div>
      <div class="hint-legend"><span>White ${pct(node.w)}%</span><span>Draw ${pct(node.d)}%</span><span>Black ${pct(node.b)}%</span></div>
      <h3>MOST PLAYED NEXT</h3><div class="hint-next">${(node.next || []).slice(0, 3).map(([san, n]) => `<button data-san="${esc(san)}">${esc(san)} · ${fmt(n)} games</button>`).join('') || '<div class="small">No data.</div>'}</div>`;
    panel.querySelectorAll('button[data-san]').forEach((b) => {
      const show = () => { const m = game.move(b.dataset.san); if (m) { game.undo(); R.showArrow(m.from, m.to); } };
      b.onmouseenter = show; b.onfocus = show; b.onclick = show;
      b.onmouseleave = () => R.showArrow(-1); b.onblur = () => R.showArrow(-1);
    });
  }
  $('hintBtn').onclick = () => { const p = $('hintPanel'); p.hidden = !p.hidden; if (!p.hidden) renderHint(); else R.showArrow(-1); };

  /* Test hook: start from a given position (used for automated checks; doesn't affect normal play). */
  window.__spellbound = {
    loadFen(fen, color) {
      gameToken++; $('resultOverlay').hidden = true;
      game = new Game(fen); playerColor = color || game.turn; lastMove = null; gameOver = null; savedThisGame = false;
      level = Number($('level').value);
      R.setOrientation(playerColor, game.board); syncBoard();
      if (game.turn === playerColor) { phase = 'player'; setStatus('Your move'); } else engineTurn();
    },
  };

  /* ---------- start ---------- */
  applySound();
  if (!settings.seenHelp) $('helpOverlay').hidden = false;
  refreshLadder();
  newGame();
})();
