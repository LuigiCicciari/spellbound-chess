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
  const randomHex = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, '0')).join(''); };
  if (!profile.secret) profile.secret = randomHex(24);
  store.set('spellbound.profile', profile);
  const settings = Object.assign({ sound: true, seenHelp: false, level: 1, color: 'w', clock: 'off', speed: 'normal' }, store.get('spellbound.settings', {}));
  if (!settings.mode) settings.mode = profile.handle ? 'rated' : 'casual'; // newcomers start in Casual
  if (settings.danger === undefined) settings.danger = true;
  const saveSettings = () => store.set('spellbound.settings', settings);

  let game = new Game();
  let playerColor = 'w';
  let level = settings.level;
  let phase = 'idle'; // player | engine | animating | over | replay
  let selected = null, pointerDownSq = null, dragStarted = false, downPos = null, pendingCycle = null;
  let lastMove = null, gameOver = null, gameStart = Date.now(), savedThisGame = false;
  let book = null, ladderData = null, ladderTab = 'all';
  let promoResolve = null, confirmResolve = null; // open dialogs that must close when a game ends
  let gameToken = 0;
  let unrated = false;   // true if this game fell back from Stockfish to the built-in engine
  let mode = settings.mode; // 'casual' | 'rated', fixed for the whole game once it starts
  const rated = () => mode === 'rated';
  let clock = null;      // { w, b, inc, run, last } in ms when clock mode is on

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
    worker = new Worker('engine.worker.js?v=0.7.0');
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data); } };
    worker.onerror = () => { worker = null; };
  } catch (e) { worker = null; }
  async function askEngine(payload) {
    const L = LEVELS[payload.level];
    if (payload.kind !== 'eval' && L && L.stockfish && window.SBStockfish && !unrated) {
      try {
        const left = clock ? clock[game.turn] : Infinity;
        const movetime = Math.max(150, Math.min(900, left / 40));
        const move = await window.SBStockfish.bestMove(payload.fen, L.elo, movetime);
        if (move) return { move };
      } catch (e) {
        unrated = true;
        toast('Stockfish could not load, so the built-in engine is playing. This game won\'t be rated.', 4500);
      }
    }
    return askWorker(payload);
  }
  function askWorker(payload) {
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
      const done = (v) => { $('confirmOverlay').hidden = true; $('confirmYes').onclick = $('confirmNo').onclick = null; confirmResolve = null; resolve(v); };
      confirmResolve = done;
      $('confirmYes').onclick = () => done(true); $('confirmNo').onclick = () => done(false);
      $('confirmYes').focus();
    });
  }

  function refreshMarks(extra) {
    const st = Object.assign({ lastMove }, extra || {});
    st.check = game.inCheck() ? game.kingSquare(game.turn) : null;
    st.danger = dangerSquares();
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

  /* Casual helper: your pieces (not the king) that the other side attacks and none of yours defend.
     It's a simple count of attackers and defenders, not a full blunder check: pins and uneven trades aren't considered. */
  function dangerSquares() {
    if (rated() || !settings.danger || watching || !playerColor || phase === 'over' || phase === 'replay') return [];
    const me = playerColor, them = me === 'w' ? 'b' : 'w', out = [];
    for (let s = 0; s < 64; s++) {
      const p = game.board[s];
      if (p && colorOf(p) === me && typeOf(p) !== 'K' && game.attacked(s, them) && !game.attacked(s, me)) out.push(s);
    }
    return out;
  }
  function noteDanger() {
    const d = dangerSquares();
    if (d.length) $('status').textContent += ` · ⚠ ${d.length} piece${d.length > 1 ? 's' : ''} attacked and undefended`;
  }
  function updateMode() {
    const started = game.sanHistory.length > 0 && !watching && phase !== 'over';
    $('modeCasual').setAttribute('aria-checked', String(settings.mode === 'casual'));
    $('modeRated').setAttribute('aria-checked', String(settings.mode === 'rated'));
    $('modeCasual').closest('.mode-switch').classList.toggle('locked', started && settings.mode !== mode);
    $('casualRow').hidden = mode !== 'casual';
    $('dangerBtn').setAttribute('aria-pressed', String(!!settings.danger));
  }
  function updateButtons() {
    const casualTurn = mode === 'casual' && !watching && phase === 'player';
    $('takebackBtn').disabled = !casualTurn || game.sanHistory.length < (playerColor === 'w' ? 2 : 3);
    $('sfHintBtn').disabled = !casualTurn;
    const live = !watching && (phase === 'player' || phase === 'engine');
    $('drawBtn').disabled = !live || game.sanHistory.length < 2;
    $('resignBtn').disabled = watching || !['player', 'engine', 'animating'].includes(phase) || game.sanHistory.length < 1;
  }

  /* ---------- game flow ---------- */
  async function newGame() {
    gameToken++;
    $('resultOverlay').hidden = true; $('promo').hidden = true; $('hintPanel').hidden = true;
    R.setThinking('w', false); R.setThinking('b', false); R.showArrow(-1);
    game = new Game(); lastMove = null; gameOver = null; selected = null; savedThisGame = false; gameStart = Date.now();
    unrated = false;
    mode = settings.mode; updateMode();
    watching = false; $('watchBtn').textContent = '▶ Watch';
    initClock();
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
    clockStart(game.turn);
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
    let ok = res && res.move ? await playMove(res.move) : false;
    if (!ok && token === gameToken && phase === 'engine') {
      const backup = await askWorker({ fen: game.fen(), level: Math.min(level, 4), sanHistory: game.sanHistory.slice(), book });
      if (token === gameToken && phase === 'engine' && backup && backup.move) ok = await playMove(backup.move);
      if (!ok) toast('The computer could not move.');
    }
  }

  async function playMove(spec) {
    if (phase === 'over' || phase === 'replay') return false;   // nothing moves once a game has ended
    const token = gameToken;
    const mover = game.turn;
    const played = game.move(spec);
    if (!played) return false;
    clockStop(mover, true);
    phase = 'animating'; selected = null; updateButtons(); R.showArrow(-1);
    R.mark({ lastMove: null });
    const byPlayer = !watching && colorOf(played.piece) === playerColor;
    const danger = byPlayer && game.attacked(played.to, game.turn);
    if (token === gameToken) await R.animateMove(played, { hesitate: danger, celebrate: true });
    if (token !== gameToken) return true;
    lastMove = { from: played.from, to: played.to };
    syncBoard(false);
    if (!watching) notePending();
    const moverName = colorOf(played.piece) === playerColor ? 'You' : 'Stones';
    const st = game.status();
    if (st) { await endGame(st.result, st.reason); return true; }
    clockStart(game.turn);
    if (R.noticeThreats) { // pieces newly attacked by the piece that just moved turn to look at it
      const side = colorOf(game.board[played.to]);
      R.noticeThreats(played.to, game.attacksFrom(played.to).filter((s) => game.board[s] && colorOf(game.board[s]) !== side && typeOf(game.board[s]) !== 'K'));
    }
    if (game.inCheck()) { R.pulseCheck(); if (R.checkGuard) R.checkGuard(game.kingSquare(game.turn)); if (R.thunder) R.thunder(); }
    if (watching) { setStatus(`Watching · ${colorOf(played.piece) === 'w' ? 'Moonstone' : 'Obsidian'} played ${played.san}`); engineTurn(); }
    else if (game.turn === playerColor) { phase = 'player'; setStatus(game.inCheck() ? 'Check! Your move' : `${moverName === 'Stones' ? 'Stones played ' + played.san + ' · ' : ''}Your move`, game.inCheck()); refreshMarks(); noteDanger(); }
    else { engineTurn(); }
    updateButtons();
    return true;
  }

  async function endGame(result, reason) {
    if (phase === 'over') return;                       // a game ends once (e.g. flag while a dialog was open)
    phase = 'over'; selected = null; updateButtons(); clockStop(null, false);
    clearPending();
    if (promoResolve) promoResolve(null);
    if (confirmResolve) confirmResolve(false);
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
    } else setStatus(reason === 'timeout' ? (playerWon ? 'The stones ran out of time' : 'You ran out of time') : (playerWon ? 'You win' : 'You resigned'));
    if (watching) {
      const token = gameToken;
      setStatus(`${draw ? 'Draw' : (result === '1-0' ? 'Moonstone' : 'Obsidian') + ' wins'} ${REASONS[reason] || ''} · next battle soon…`);
      await wait(4500);
      if (watching && token === gameToken) startWatch();
      return;
    }
    if (playerWon) window.SBAudio.play('chime');
    showResult();
    if (rated() && !unrated && profile.handle && profile.start && game.sanHistory.length >= 2) saveGame(); // rated games save themselves
  }

  const REASONS = { checkmate: 'by checkmate', stalemate: 'by stalemate', threefold: 'by threefold repetition', fifty_move: 'by the 50-move rule',
    insufficient: 'by insufficient material', resign: 'by resignation', draw_agreed: 'by agreement', timeout: 'on time' };
  const RESULT_DRAW_TIMEOUT = 'on time (the other side had no way to checkmate)';

  function myStats() {
    const p = ladderData && ladderData.me;
    return p ? Object.assign({ history: ladderData.history }, p)
      : { rating: profile.start || 800, games: 0, w: 0, d: 0, l: 0, history: [], best: 0, rank: null };
  }

  function showResult() {
    const { res, reason } = gameOver;
    $('resultTitle').textContent = res === 'W' ? 'Victory!' : res === 'D' ? 'Draw' : 'Defeat';
    const why = reason === 'timeout' && res === 'D' ? RESULT_DRAW_TIMEOUT : (REASONS[reason] || '');
    $('resultSub').textContent = `${res === 'W' ? 'You beat' : res === 'D' ? 'You drew with' : 'You lost to'} Level ${level} ${LEVELS[level].name} ${why} in ${Math.ceil(game.sanHistory.length / 2)} move${Math.ceil(game.sanHistory.length / 2) === 1 ? '' : 's'}.`;
    const me = myStats();
    const d = window.SBLadder.preview(me.rating, me.games, LEVELS[level].elo, res);
    const el = $('resultDelta');
    el.className = 'result-delta ' + (d > 0.5 ? 'good' : d < -0.5 ? 'alert' : 'neutral');
    el.textContent = `${d > 0.5 ? '▲ +' : d < -0.5 ? '▼ −' : '■ ±'}${Math.abs(Math.round(d))}`;
    const auto = !!(profile.handle && profile.start);
    $('saveBtn').disabled = unrated; $('saveBtn').textContent = auto ? 'Saving…' : 'Save to leaderboard';
    $('saveNote').textContent = unrated ? 'Stockfish could not load during this game, so it can\'t be rated.' : auto ? '' : 'Choose a name to join the leaderboard. After that, rated games save automatically.';
    if (unrated) { el.textContent = 'Unrated game'; $('saveBtn').textContent = 'Not rated'; }
    if (!rated()) { $('saveBtn').disabled = true; $('saveBtn').textContent = 'Casual game'; el.className = 'result-delta neutral'; el.textContent = 'Not rated'; $('saveNote').textContent = 'Switch to Rated before your next game to play for the leaderboard.'; }
    else if (game.sanHistory.length < 2) { $('saveBtn').disabled = true; $('saveBtn').textContent = 'Too short to rate'; el.textContent = ''; $('saveNote').textContent = ''; }
    $('resultOverlay').hidden = false;
    $('saveBtn').focus();
  }

  function recordFor(res, reason) {
    return {
      player_id: profile.player_id, handle: profile.handle, level, engine_elo: LEVELS[level].elo, player_color: playerColor,
      result: res, termination: reason, ply_count: game.sanHistory.length, pgn: game.pgn(),
      app_version: (window.SB_CONFIG && window.SB_CONFIG.appVersion) || '0.7.0',
      start_rating: profile.start || null, clock: clock ? settings.clock : null,
    };
  }
  /* A rated game in progress is kept as "resigned" in this browser, so closing the page or starting over
     mid-game still counts as a loss. It's cleared the moment the game ends normally. */
  const PENDING = 'spellbound.pending';
  function notePending() {
    if (unrated || !rated()) { clearPending(); return; }
    if (watching || !profile.handle || !profile.start || phase === 'over' || phase === 'replay' || game.sanHistory.length < 2) return;
    store.set(PENDING, recordFor('L', 'resign'));
  }
  function clearPending() { try { localStorage.removeItem(PENDING); } catch (e) { /* ignore */ } }
  async function flushPending() {
    const rec = store.get(PENDING, null);
    if (!rec || rec.player_id !== profile.player_id) { clearPending(); return; }
    clearPending();
    if (!window.SBLadder.verify(rec)) return;
    const r = await window.SBLadder.save(rec, profile.secret);
    if (!r.error) { toast('Your unfinished game was counted as a resignation.', 4000); refreshLadder(); }
  }

  async function saveGame() {
    if (savedThisGame || !gameOver || !rated()) return;
    if (!profile.handle || !profile.start) { const ok = await askName(); if (!ok) return; }
    const rec = recordFor(gameOver.res, gameOver.reason);
    if (rec.ply_count < 2) return;
    if (!window.SBLadder.verify(rec)) { $('saveNote').textContent = 'This game could not be verified, so it was not saved.'; return; }
    savedThisGame = true;
    $('saveBtn').disabled = true; $('saveBtn').textContent = 'Saving…';
    const before = myStats().rating;
    const r = await window.SBLadder.save(rec, profile.secret);
    if (r.error) { savedThisGame = false; $('saveBtn').disabled = false; $('saveBtn').textContent = 'Try again'; $('saveNote').textContent = `Not saved: ${r.error}.`; return; }
    await refreshLadder();
    const after = myStats().rating;
    countUp($('rating'), before, after);
    $('saveBtn').textContent = 'Saved ✓';
    $('saveNote').textContent = r.mode === 'live' ? 'Saved to the leaderboard.' : 'Saved in this browser (online leaderboard not connected).';
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
      if (!R.is3D) R.setPosition(g.board);
      refreshMarks(); renderMoves(); renderTrays();
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
    const token = gameToken;
    if (options[0].promotion) { promotion = await pickPromotion(); if (!promotion) { if (phase === 'player') clearSelection(); return true; } }
    if (token !== gameToken || phase !== 'player') return true;
    await playMove({ from, to, promotion });
    return true;
  }

  function pickPromotion() {
    return new Promise((resolve) => {
      const done = (v) => { $('promo').hidden = true; promoResolve = null; resolve(v); };
      promoResolve = done;
      const box = $('promoChoices'); box.innerHTML = '';
      for (const t of 'QRBN') {
        const b = document.createElement('button');
        const p = playerColor === 'w' ? t : t.toLowerCase();
        b.innerHTML = miniPiece(p); b.title = { Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight' }[t];
        b.onclick = () => { done(p); };
        box.appendChild(b);
      }
      const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.style.width = '70px';
      cancel.onclick = () => done(null); box.appendChild(cancel);
      $('promo').hidden = false; box.firstChild.focus();
    });
  }

  boardEl.addEventListener('pointerdown', (ev) => {
    window.SBAudio.unlock();
    if (phase !== 'player') return;
    const hitSq = R.squareFromEvent(ev);
    const ground = R.groundSquareFromEvent ? R.groundSquareFromEvent(ev) : hitSq;
    const stack = R.piecesUnderPointer ? R.piecesUnderPointer(ev) : (hitSq >= 0 && game.board[hitSq] ? [hitSq] : []);
    if (hitSq < 0 && ground < 0 && !stack.length) return;
    const own = (s) => s >= 0 && game.board[s] && colorOf(game.board[s]) === playerColor;
    const ownStack = stack.filter(own);           // your pieces under the pointer, nearest first
    if (selected !== null) {
      const targets = legalFrom(selected).map((m) => m.to);
      // Clicking high up on one of your own pieces means "pick that piece instead", even if a target square is behind it.
      const ownHigh = ownStack.length && ownStack[0] !== selected && (R.lastHitHeight ? R.lastHitHeight() > 0.45 : true);
      const pick = ownHigh ? undefined : [ground, ...stack.filter((s) => !own(s)), hitSq].find((s) => s >= 0 && s !== selected && targets.includes(s));
      if (pick !== undefined) { const from = selected; tryMove(from, pick); return; }
    }
    // What you click is what you get: the nearest of your pieces under the pointer. Clicking the same spot again
    // picks the piece hidden behind it. With no piece under the pointer, the square on the floor decides.
    let sq, cycle = false;
    if (ownStack.length) {
      const i = ownStack.indexOf(selected);
      cycle = i >= 0 && ownStack.length > 1;
      sq = ownStack[0];
      if (cycle) pendingCycle = ownStack[(i + 1) % ownStack.length];
    } else sq = own(ground) ? ground : (ground >= 0 ? ground : hitSq);
    if (cycle) sq = selected;                      // keep it until pointerup: a drag still moves the selected piece
    else pendingCycle = null;
    const p = game.board[sq];
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
    if (!dragStarted) { // simple click: keep the selection, or switch to the piece hidden behind it
      const next = pendingCycle; pendingCycle = null;
      if (next !== null && next !== from && phase === 'player') { showSelection(next); window.SBAudio.play('tap'); R.lift(next, true); R.lift(next, false); }
      return;
    }
    pendingCycle = null;
    dragStarted = false;
    const to = R.groundSquareFromEvent ? R.groundSquareFromEvent(ev) : R.squareFromEvent(ev);
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
    if (['player', 'engine', 'animating', 'intro'].includes(phase) && game.sanHistory.length > 1) {
      const ok = await confirmBox('Abandon this game?', rated() && profile.handle ? 'It counts as a loss on the leaderboard.' : 'It counts as a resignation.');
      if (!ok) return;
      gameToken++;
      await endGame(playerColor === 'w' ? '0-1' : '1-0', 'resign');
      return;
    }
    newGame();
  };
  $('resignBtn').onclick = async () => {
    if (!['player', 'engine', 'animating'].includes(phase)) return;
    if (!(await confirmBox('Resign?', 'Your king will lay down his crown.'))) return;
    gameToken++;
    await endGame(playerColor === 'w' ? '0-1' : '1-0', 'resign');
  };
  $('drawBtn').onclick = async () => {
    if (phase !== 'player') { toast('Offer a draw on your turn.'); return; }
    const engineColor = playerColor === 'w' ? 'b' : 'w';
    if (game.sanHistory.length < 40) { toast('The stones refuse: too early for peace (after move 20).'); return; }
    let engineView = null; // the computer's own opinion of the position, in centipawns, from its side
    const L = LEVELS[level];
    if (L.stockfish && window.SBStockfish && !unrated) {
      try { const cp = await window.SBStockfish.evaluate(game.fen(), 700); engineView = -cp; } catch (e) { engineView = null; }
    }
    if (engineView === null) { const { value } = await askWorker({ kind: 'eval', fen: game.fen(), color: engineColor }); engineView = value; }
    if (phase !== 'player') return;
    if (engineView <= 50) await endGame('1/2-1/2', 'draw_agreed'); // it accepts unless it thinks it's better
    else toast('The stones refuse your draw: they think they are winning.');
  };
  function startWatch() {
    gameToken++;
    $('resultOverlay').hidden = true; $('promo').hidden = true; $('hintPanel').hidden = true;
    game = new Game(); lastMove = null; gameOver = null; selected = null;
    watching = true; playerColor = null; level = Number($('level').value);
    unrated = false; clock = null; showClocks(false);
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

  /* ---------- Casual / Rated ---------- */
  function setMode(m) {
    if (settings.mode === m) return;
    settings.mode = m; saveSettings();
    const fresh = watching || phase === 'over' || game.sanHistory.length === 0;
    if (fresh && !watching) { mode = m; refreshMarks(); toast(m === 'rated' ? 'Rated: this game counts on the leaderboard.' : 'Casual: practice freely. This game won\'t change your rating.'); }
    else if (!watching) toast(`${m === 'rated' ? 'Rated' : 'Casual'} starts with your next game. This one stays ${mode === 'rated' ? 'Rated' : 'Casual'}.`);
    updateMode(); updateButtons();
  }
  $('modeCasual').onclick = () => setMode('casual');
  $('modeRated').onclick = () => setMode('rated');
  $('dangerBtn').onclick = () => { settings.danger = !settings.danger; saveSettings(); updateMode(); refreshMarks(); };
  $('takebackBtn').onclick = () => {
    if (mode !== 'casual' || watching || phase !== 'player') return;
    const n = game.sanHistory.length >= 2 && game.turn === playerColor ? 2 : 0; // your move and the stones' reply
    if (!n || game.sanHistory.length - n < (playerColor === 'b' ? 1 : 0)) return;
    gameToken++;
    for (let i = 0; i < n; i++) game.undo();
    const h = game.moveHistory[game.moveHistory.length - 1];
    lastMove = h ? { from: h.from, to: h.to } : null;
    selected = null; R.showArrow(-1);
    syncBoard(true);
    setStatus('Move taken back · Your move'); noteDanger();
  };
  $('sfHintBtn').onclick = async () => {
    if (mode !== 'casual' || watching || phase !== 'player') return;
    const token = gameToken, fen = game.fen();
    $('sfHintBtn').disabled = true; setStatus('Looking for a good move…');
    let mv = null;
    try { if (window.SBStockfish) mv = await window.SBStockfish.bestMove(fen, 3190, 700); } catch (e) { mv = null; }
    if (!mv) { const r = await askWorker({ fen, level: 3, sanHistory: game.sanHistory.slice(), book }); mv = r && r.move; }
    if (token !== gameToken || phase !== 'player' || game.fen() !== fen) return;
    updateButtons();
    const probe = mv && game.move(mv);
    if (!probe) { setStatus('No hint available · Your move'); return; }
    game.undo();
    R.showArrow(probe.from, probe.to);
    setStatus(`Hint: ${probe.san} · Your move`);
  };

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
      const hasGames = !!(ladderData && ladderData.me);
      $('recoveryCode').value = `${profile.player_id}.${profile.secret}`; $('recoveryInput').value = ''; $('recoveryNote').textContent = '';
      $('startChoice').hidden = hasGames || !!profile.start;
      document.querySelectorAll('input[name=start]').forEach((r) => { r.checked = Number(r.value) === (profile.start || 800); });
      $('nameForm').onsubmit = (ev) => {
        ev.preventDefault();
        const n = $('nameInput').value.trim(), problem = nameProblem(n);
        if (problem) { $('nameError').textContent = problem; return; }
        const renamed = profile.handle && profile.handle !== n;
        if (renamed && ladderData && ladderData.me && window.SBLadder.mode === 'live') {
          window.SBLadder.rename(profile.player_id, profile.secret, n).then((ok) => { if (!ok) toast('Could not rename on the leaderboard. Try again later.'); refreshLadder(); });
        }
        profile.handle = n;
        if (!$('startChoice').hidden) { const pick = document.querySelector('input[name=start]:checked'); profile.start = pick ? Number(pick.value) : 800; }
        if (!profile.start) profile.start = 1200; // players from before v0.4 started at 1200
        store.set('spellbound.profile', profile);
        $('nameOverlay').hidden = true; renderRating();
        resolve(true);
      };
      $('nameCancel').onclick = () => { $('nameOverlay').hidden = true; resolve(false); };
    });
  }
  $('renameBtn').onclick = () => askName();
  $('copyCode').onclick = async () => {
    try { await navigator.clipboard.writeText($('recoveryCode').value); $('recoveryNote').textContent = 'Copied. Keep it somewhere safe.'; }
    catch (e) { $('recoveryCode').select(); $('recoveryNote').textContent = 'Press Ctrl+C to copy.'; }
  };
  $('useCode').onclick = () => {
    const v = $('recoveryInput').value.trim();
    const mm = /^([0-9a-f-]{36})\.([0-9a-f]{24,})$/i.exec(v);
    if (!mm) { $('recoveryNote').textContent = "That doesn't look like a recovery code."; return; }
    profile.player_id = mm[1].toLowerCase(); profile.secret = mm[2].toLowerCase(); profile.start = profile.start || 800;
    store.set('spellbound.profile', profile);
    $('recoveryNote').textContent = 'Restored. Loading your rating…';
    refreshLadder().then(() => { if (ladderData && ladderData.me) { $('startChoice').hidden = true; } });
  };

  /* ---------- rating tile + ladder ---------- */
  async function refreshLadder() {
    ladderData = await window.SBLadder.board(profile.player_id);
    if (ladderData.me && !profile.handle) { const top = ladderData.ranked.find((p) => p.player_id === profile.player_id); if (top) profile.handle = top.handle; }
    const live = ladderData.mode === 'live';
    $('chip').textContent = live ? '● LIVE' : '○ LOCAL'; $('chip').classList.toggle('live', live);
    $('ladderNote').textContent = live ? '' : 'Scores are kept in this browser.';
    if (live && ladderData.me && !profile.start) { profile.start = ladderData.me.start || 1200; store.set('spellbound.profile', profile); }
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
    if (!me.games) $('ratingSub').textContent = 'Finish a game to get your rating. You choose a starting level the first time.';
    else {
      const rank = me.rank ? `Rank #${me.rank} of ${ladderData.totalRanked}` : `Ranked after ${window.SBLadder.PROVISIONAL} games (${me.games} so far)`;
      $('ratingSub').textContent = `${rank}${me.best ? ' · Best win: Level ' + me.best : ''}`;
    }
    renderSpark(me.history);
  }

  function renderSpark(history) {
    const s = $('spark'); s.innerHTML = '';
    if (history.length < 2) return;
    const vals = [history[0].before].concat(history.map((h) => h.after));
    const lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(20, hi - lo);
    const X = (i) => 30 + (i / (vals.length - 1)) * 380, Y = (v) => 44 - ((v - lo) / span) * 38;
    const ns = 'http://www.w3.org/2000/svg';
    const ref = document.createElementNS(ns, 'line'); ref.setAttribute('class', 'ref');
    ref.setAttribute('x1', 30); ref.setAttribute('x2', 410); ref.setAttribute('y1', Y(vals[0])); ref.setAttribute('y2', Y(vals[0])); s.appendChild(ref);
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
      if (!ladderData.history.length) { body.innerHTML = '<div class="empty">Your saved games will show here.</div>'; return; }
      const rows = ladderData.history.slice(-20).reverse().map((h) => {
        const g = h, d = h.delta;
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
    const row = (p, i) => {
      const val = ladderTab === 'today' ? `${p.gain >= 0 ? '+' : '−'}${Math.abs(Math.round(p.gain))}` : fmt(p.rating);
      const best = ladderTab === 'today' ? '' : (p.best ? 'Lv ' + p.best : '—');
      return `<tr class="${p.player_id === me ? 'me' : ''}"><td class="num">${i + 1}</td><td>${p.player_id === me ? '<b>YOU</b> · ' : ''}${esc(p.handle)}</td>
        <td class="num">${val}</td><td class="num">${p.games}</td><td class="num">${best}</td></tr>`;
    };
    let rows = top.map(row).join('');
    const mine = ladderData.me;
    if (ladderTab === 'all' && mine && mine.rank && mine.rank > 10) {
      rows += `<tr class="gap"><td colspan="5">⋯</td></tr>` + row({ player_id: me, handle: profile.handle, rating: mine.rating, games: mine.games, best: mine.best }, mine.rank - 1);
    }
    body.innerHTML = `<table><thead><tr><th class="num">#</th><th>Name</th><th class="num">${ladderTab === 'today' ? 'Today' : 'Rating'}</th><th class="num">Games</th><th class="num">${ladderTab === 'today' ? '' : 'Best win'}</th></tr></thead><tbody>${rows}</tbody></table>`;
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

  /* ---------- clock mode ---------- */
  const fmtClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function initClock() {
    if (settings.clock === 'off' || watching) { clock = null; showClocks(false); return; }
    const [mins, inc] = settings.clock.split('+').map(Number);
    clock = { w: mins * 60000, b: mins * 60000, inc: inc * 1000, run: null, last: 0 };
    showClocks(true); renderClock();
  }
  function showClocks(on) { $('clockMe').hidden = !on; $('clockThem').hidden = !on; }
  function clockStart(side) { if (!clock || watching) return; clock.run = side; clock.last = performance.now(); renderClock(); }
  function clockStop(mover, addInc) {
    if (!clock || !clock.run) return;
    clock[clock.run] -= performance.now() - clock.last;
    if (addInc && mover) clock[mover] += clock.inc;
    clock.run = null; renderClock();
  }
  function renderClock() {
    if (!clock) return;
    const now = performance.now();
    const left = (side) => clock[side] - (clock.run === side ? now - clock.last : 0);
    const me = playerColor || 'w', them = me === 'w' ? 'b' : 'w';
    for (const [id, side, label] of [['clockMe', me, 'You'], ['clockThem', them, 'Stones']]) {
      const el = $(id), ms = left(side);
      el.textContent = `${label} ${fmtClock(ms)}`;
      el.classList.toggle('running', clock.run === side); el.classList.toggle('low', ms < 20000);
    }
    return left;
  }
  setInterval(() => {
    if (!clock || !clock.run || phase === 'over') return;
    const left = renderClock();
    const side = clock.run;
    if (left(side) <= 0) {
      clock[side] = 0; clock.run = null; renderClock();
      gameToken++;
      const winner = side === 'w' ? 'b' : 'w';
      endGame(game.canMate(winner) ? (side === 'w' ? '0-1' : '1-0') : '1/2-1/2', 'timeout');
    }
  }, 100);

  function applySpeed() {
    if (R.setSpeed) R.setSpeed(settings.speed === 'fast' ? 0.55 : 1);
    if (R.setCinematic) R.setCinematic(settings.speed === 'cinematic');
  }
  $('clockSel').value = settings.clock; $('speedSel').value = settings.speed;
  $('clockSel').onchange = () => { settings.clock = $('clockSel').value; saveSettings(); toast(settings.clock === 'off' ? 'Clock off from your next game.' : `Clock ${settings.clock} from your next game.`); };
  $('speedSel').onchange = () => { settings.speed = $('speedSel').value; saveSettings(); applySpeed(); };
  applySpeed();

  /* Escape closes whatever dialog is open */
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!$('nameOverlay').hidden) $('nameCancel').click();
    else if (!$('confirmOverlay').hidden) $('confirmNo').click();
    else if (!$('helpOverlay').hidden) $('helpClose').click();
    else if (!$('promo').hidden && promoResolve) promoResolve(null);
    else if (!$('hintPanel').hidden) { $('hintPanel').hidden = true; R.showArrow(-1); }
    else if (selected !== null && phase === 'player') clearSelection();
  });

  /* Test hook: start from a given position (used for automated checks; doesn't affect normal play). */
  window.__spellbound = {
    setClock(ms) { if (clock) { clock.w = ms; clock.b = ms; } },
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
  refreshLadder().then(flushPending);
  newGame();
})();
