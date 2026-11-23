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
    try { $('board3d').hidden = false; svg.style.display = 'none'; R = window.SBRender3D.create($('board3d')); } catch (e) { R = null; window.SB3DError = 'the 3D board could not start (' + ((e && e.message) || e) + ')'; }
  }
  const flatWhy = /[?&]flat\b/.test(location.search) ? null
    : !window.SBRender3D ? (window.SB3DError || 'the 3D files did not load')
    : !webglOK() ? 'this window has WebGL (3D graphics) turned off' : window.SB3DError || null;
  if (!R) { $('board3d').hidden = true; svg.style.display = ''; R = window.SBRender.create(svg); }
  const boardEl = R.el || svg;
  $('viewBtn').hidden = !R.is3D;
  document.body.classList.toggle('is3d', !!R.is3D);
  let watching = false;

  /* ---------- engine (Web Worker, with a main-thread fallback) ---------- */
  let worker = null, reqId = 0;
  const pending = new Map();
  try {
    worker = new Worker('engine.worker.js?v=0.9.2');
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
        toast(`Stockfish could not load, so the built-in engine is playing.${rated() ? ' This game won\'t be rated.' : ''}`, 4500);
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

  /* Casual helper: your pieces (not the king) that are attacked and not defended, or attacked by a cheaper piece
     (a defended rook still loses material to a pawn). Pins and longer exchanges aren't considered, so it's a
     reminder, not a full blunder check. */
  const PVAL = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 100 };
  function dangerSquares() {
    if (rated() || !settings.danger || watching || !playerColor || phase === 'over' || phase === 'replay' || phase === 'review') return [];
    const me = playerColor, them = me === 'w' ? 'b' : 'w', out = [], cheapest = new Array(64).fill(Infinity);
    for (let s = 0; s < 64; s++) {
      const p = game.board[s];
      if (p && colorOf(p) === them) for (const t of game.attacksFrom(s)) cheapest[t] = Math.min(cheapest[t], PVAL[typeOf(p)]);
    }
    for (let s = 0; s < 64; s++) {
      const p = game.board[s];
      if (!p || colorOf(p) !== me || typeOf(p) === 'K' || cheapest[s] === Infinity) continue;
      if (!game.attacked(s, me) || cheapest[s] < PVAL[typeOf(p)]) out.push(s);
    }
    return out;
  }
  function noteDanger() {
    const d = dangerSquares();
    if (d.length) $('status').textContent += ` · ⚠ ${d.length} piece${d.length > 1 ? 's' : ''} in danger`;
  }
  function updateMode() {
    const started = game.sanHistory.length > 0 && !watching && phase !== 'over' && phase !== 'review';
    const shown = started ? mode : settings.mode;   // during a game the switch shows the game's own mode
    $('modeCasual').setAttribute('aria-checked', String(shown === 'casual'));
    $('modeRated').setAttribute('aria-checked', String(shown === 'rated'));
    const queued = started && settings.mode !== mode;
    $('modeCasual').closest('.mode-switch').classList.toggle('locked', started);
    $('modeCasual').querySelector('span').textContent = queued && settings.mode === 'casual' ? 'next game' : 'practice';
    $('modeRated').querySelector('span').textContent = queued && settings.mode === 'rated' ? 'next game' : 'leaderboard';
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
    if (store.get(PENDING, null) && !saveInFlight) flushPending();
    if (reviewState) endReview(false);
    reportToken++; $('reportOverlay').hidden = true;
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
    if (!watching) setStatus(`${byPlayer ? 'You play' : 'Stones play'} ${played.san}…`); // no stale "Hint · Your move" while pieces move
    if (token === gameToken) await R.animateMove(played, { hesitate: danger, celebrate: true });
    if (token !== gameToken) return true;
    lastMove = { from: played.from, to: played.to };
    syncBoard(false);
    if (!watching) { notePending(); if (game.sanHistory.length <= 2) updateMode(); }
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
    const wasRated = rated();                           // decided now: the mode switch can't change a finished game
    const endToken = gameToken;                         // if a new game starts during the ending, the pending record saves this one
    phase = 'over'; selected = null; updateButtons(); clockStop(null, false);
    {
      const pw = (result === '1-0' && playerColor === 'w') || (result === '0-1' && playerColor === 'b');
      const res = result === '1/2-1/2' ? 'D' : pw ? 'W' : 'L';
      if (wasRated && !unrated && !watching && profile.handle && profile.start && game.sanHistory.length >= 2) store.set(PENDING, recordFor(res, reason));
      else clearPending();
    }
    updateMode(); setTimeout(() => offerUpdate(), 2500);
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
    if (endToken !== gameToken) return;
    if (watching) {
      const token = gameToken;
      setStatus(`${draw ? 'Draw' : (result === '1-0' ? 'Moonstone' : 'Obsidian') + ' wins'} ${REASONS[reason] || ''} · next battle soon…`);
      await wait(4500);
      if (watching && token === gameToken) startWatch();
      return;
    }
    if (playerWon) window.SBAudio.play('chime');
    showResult();
    if (wasRated && !unrated && profile.handle && profile.start && game.sanHistory.length >= 2) saveGame(); // rated games save themselves
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
    $('saveBtn').hidden = !rated();
    if (!rated()) { $('saveBtn').disabled = true; $('saveBtn').textContent = 'Casual game'; el.className = 'result-delta neutral'; el.textContent = 'Not rated'; $('saveNote').textContent = 'Switch to Rated before your next game to play for the leaderboard.'; }
    else if (game.sanHistory.length < 2) { $('saveBtn').disabled = true; $('saveBtn').textContent = 'Too short to rate'; el.textContent = ''; $('saveNote').textContent = ''; }
    $('reportBtn').hidden = game.sanHistory.length < 2;
    $('resultOverlay').hidden = false;
    ($('saveBtn').hidden ? $('againBtn') : $('saveBtn')).focus();
  }

  function recordFor(res, reason) {
    return {
      player_id: profile.player_id, handle: profile.handle, level, engine_elo: LEVELS[level].elo, player_color: playerColor,
      result: res, termination: reason, ply_count: game.sanHistory.length, pgn: game.pgn(),
      app_version: (window.SB_CONFIG && window.SB_CONFIG.appVersion) || '0.9.2',
      start_rating: profile.start || null, clock: clock ? settings.clock : null,
    };
  }
  /* A rated game in progress is kept as "resigned" in this browser, so closing the page or starting over
     mid-game still counts as a loss. It's cleared the moment the game ends normally. */
  const PENDING = 'spellbound.pending';
  let saveInFlight = false;   // a save is on its way: don't send the same game again from the pending record
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
    if (!r.error) { toast(rec.termination === 'resign' ? 'Your unfinished game was counted as a resignation.' : 'Your last game has been saved to the leaderboard.', 4000); refreshLadder(); }
  }

  async function saveGame() {
    if (savedThisGame || !gameOver || !rated()) return;
    if (!profile.handle || !profile.start) { const ok = await askName(); if (!ok) return; }
    const rec = recordFor(gameOver.res, gameOver.reason);
    if (rec.ply_count < 2) return;
    if (!window.SBLadder.verify(rec)) { clearPending(); $('saveNote').textContent = 'This game could not be verified, so it was not saved.'; return; }
    savedThisGame = true;
    $('saveBtn').disabled = true; $('saveBtn').textContent = 'Saving…';
    const before = myStats().rating;
    saveInFlight = true;
    const r = await window.SBLadder.save(rec, profile.secret).finally(() => { saveInFlight = false; });
    if (r.error) { if (!/busy|network|fetch|timed? ?out|5\d\d/i.test(r.error)) clearPending(); savedThisGame = false; $('saveBtn').disabled = false; $('saveBtn').textContent = 'Try again'; $('saveNote').textContent = `Not saved: ${r.error}.`; return; }
    clearPending();                                  // saved: nothing left to send later
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
    if (reviewState) endReview(false);
    reportToken++; $('reportOverlay').hidden = true;
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
  $('watchBtn').onclick = async () => {
    if (watching) { newGame(); return; }
    if (['player', 'engine', 'animating', 'intro'].includes(phase) && game.sanHistory.length > 1) {
      const ok = await confirmBox('Leave this game to watch?', rated() && profile.handle ? 'It counts as a loss on the leaderboard.' : 'It counts as a resignation.');
      if (!ok) return;
      gameToken++;
      await endGame(playerColor === 'w' ? '0-1' : '1-0', 'resign');
      $('resultOverlay').hidden = true;
    }
    startWatch();
  };
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
    const fresh = !watching && phase !== 'over' && phase !== 'review' && phase !== 'replay' && game.sanHistory.length === 0;
    if (fresh) { mode = m; refreshMarks(); toast(m === 'rated' ? 'Rated: this game counts on the leaderboard.' : 'Casual: practice freely. This game won\'t change your rating.'); }
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
    if (clock) { const snap = clockSnaps[game.sanHistory.length]; if (snap) { clock.w = snap.w; clock.b = snap.b; } clockSnaps.length = game.sanHistory.length; clockStart(game.turn); }
    const h = game.moveHistory[game.moveHistory.length - 1];
    lastMove = h ? { from: h.from, to: h.to } : null;
    selected = null; R.showArrow(-1);
    syncBoard(true);
    setStatus(game.inCheck() ? 'Move taken back · Check! Your move' : 'Move taken back · Your move', game.inCheck()); noteDanger(); updateMode();
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

  /* ---------- battle report ---------- */
  // Win chance (0-100) from a centipawn score, the curve Lichess uses; scores past ±15 pawns are treated as decided.
  const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, cp)))) - 1);
  const moveAcc = (drop) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, drop)) - 3.1669));
  let report = null;          // { key, evals: [White's centipawns after ply i], best: [best move from position i], done }
  let reportToken = 0, reviewState = null, reviewAnim = 0;
  const finalGame = () => (reviewState ? reviewState.final : game);
  const reportKey = (g) => `${playerColor}|${level}|${g.pgn()}`;

  // One report uses one judge: Stockfish, or (if it can't load) the built-in engine for every move. Scores from
  // the two aren't on the same scale, so mixing them would invent blunders.
  async function evalPosition(g, ms, src) {
    const st = g.status();
    if (st) return { w: st.result === '1-0' ? 10000 : st.result === '0-1' ? -10000 : 0, best: null };
    const fen = g.fen();
    if (src === 'sf') {
      const r = await window.SBStockfish.analyse(fen, ms);  // throws if Stockfish fails; the caller restarts with the built-in engine
      return { w: g.turn === 'w' ? r.score : -r.score, best: r.best };
    }
    const res = await askWorker({ kind: 'eval', fen, color: 'w' });
    if (!res || typeof res.value !== 'number' || !isFinite(res.value)) throw new Error('eval failed');
    return { w: res.value, best: null };
  }

  async function openReport() {
    if (!gameOver || watching) return;
    const final = finalGame();
    $('resultOverlay').hidden = true; $('reportOverlay').hidden = false;
    const key = reportKey(final);
    if (!report || report.key !== key) {
      const saved = store.get('spellbound.report', null);
      report = saved && saved.key === key ? saved : { key, evals: [], best: [], done: false, src: window.SBStockfish && window.SBStockfish.analyse ? 'sf' : 'engine' };
    }
    renderReport();
    $('reportClose').focus();
    if (!report.done) runAnalysis(final);
  }

  async function runAnalysis(final) {
    const token = ++reportToken, moves = final.moveHistory.slice(), n = moves.length;
    const ms = n > 100 ? 120 : n > 60 ? 160 : 220;
    const g = new Game();
    for (let i = 0; i <= n; i++) {
      if (i > 0) g.move(moves[i - 1]);
      if (report.evals[i] !== undefined && report.evals[i] !== null) continue;
      let r;
      try { r = await evalPosition(g, ms, report.src); }
      catch (e) {
        if (token !== reportToken) return;
        if (report.src === 'sf') { report.src = 'engine'; report.evals = []; report.best = []; renderReport(); runAnalysis(final); return; } // start over with one judge
        $('reportProgress').textContent = 'The analysis stopped early. Close and reopen the report to try again.'; return;
      }
      if (token !== reportToken) return;            // a new game or a new report took over
      report.evals[i] = r.w; report.best[i] = r.best;
      $('reportProgress').textContent = `${report.src === 'sf' ? 'Stockfish' : 'The built-in engine'} is studying the battle… move ${Math.ceil(i / 2)} of ${Math.ceil(n / 2)}`;
      if (i % 3 === 0 || i === n) renderReport();
      if (i % 10 === 0) store.set('spellbound.report', report); // progress survives a reload
    }
    report.done = true;
    store.set('spellbound.report', report);          // reopening the report doesn't repeat the work
    renderReport();
  }

  /* Move-by-move numbers from whatever has been analysed so far. */
  function reportMoves() {
    const final = finalGame(), e = report.evals, out = [];
    for (let i = 1; i <= final.moveHistory.length; i++) {
      if (e[i - 1] === undefined || e[i] === undefined || e[i - 1] === null || e[i] === null) break;
      const m = final.moveHistory[i - 1], mover = colorOf(m.piece);
      const pov = (cp) => (mover === 'w' ? winPct(cp) : 100 - winPct(cp));
      const before = pov(e[i - 1]), after = pov(e[i]);
      const best = report.best[i - 1];
      out.push({ i, mover, san: final.sanHistory[i - 1], drop: before - after, acc: moveAcc(before - after), best,
        top: !!best && best.from === m.from && best.to === m.to && (!best.promotion || (m.promotion || '').toLowerCase() === best.promotion.toLowerCase()),
        captured: m.captured || null });
    }
    return out;
  }
  // Lichess's thresholds: a move that loses 30+ points of winning chance is a blunder, 20+ a mistake, 10+ an inaccuracy
  const kind = (drop) => (drop >= 30 ? 'blunder' : drop >= 20 ? 'mistake' : drop >= 10 ? 'inaccuracy' : null);
  // Game accuracy: the average of the plain mean and the harmonic mean of the move accuracies (Lichess blends the two
  // the same way; it also weights the plain mean by how sharp each position was, which this skips)
  const gameAcc = (a) => {
    if (!a.length) return null;
    const mean = a.reduce((x, m) => x + m.acc, 0) / a.length;
    const harm = a.length / a.reduce((x, m) => x + 1 / Math.max(1, m.acc), 0);
    return Math.round((mean + harm) / 2);
  };
  const moveLabel = (i) => `${Math.ceil(i / 2)}${i % 2 ? '' : ' (Black)'}`;
  function sanOf(ply, spec) {
    if (!spec) return null;
    const g = new Game(); finalGame().moveHistory.slice(0, ply).forEach((m) => g.move(m));
    const p = g.move(spec); return p ? p.san : null;
  }

  function renderReport() {
    const final = finalGame(), n = final.moveHistory.length, ms = reportMoves();
    const mine = ms.filter((m) => m.mover === playerColor), theirs = ms.filter((m) => m.mover !== playerColor);
    const avg = gameAcc;
    const caps = (c) => final.moveHistory.filter((m) => m.captured && colorOf(m.piece) === c).length;
    const them = playerColor === 'w' ? 'b' : 'w';
    const counts = { blunder: 0, mistake: 0, inaccuracy: 0 }; mine.forEach((m) => { const k = kind(m.drop); if (k) counts[k]++; });
    const res = gameOver ? gameOver.res : '';
    $('reportSub').textContent = `${res === 'W' ? 'Victory' : res === 'D' ? 'Draw' : 'Defeat'} against Level ${level} ${LEVELS[level].name} · ${Math.ceil(n / 2)} moves · ${mode === 'rated' ? 'Rated' : 'Casual'} game`;
    const stat = (v, label) => `<div class="stat"><b>${v === null ? '…' : v}</b><span>${label}</span></div>`;
    $('reportStats').innerHTML = stat(avg(mine) === null ? null : avg(mine) + '%', 'Your accuracy') + stat(avg(theirs) === null ? null : avg(theirs) + '%', "The stones' accuracy")
      + stat(`${caps(playerColor)} · ${caps(them)}`, 'Captures (you · stones)') + stat(report.done ? `${counts.blunder} · ${counts.mistake} · ${counts.inaccuracy}` : null, 'Blunders · mistakes · inaccuracies');
    // turning points: your three costliest moves; best moment: your biggest gain
    const worst = mine.filter((m) => kind(m.drop)).sort((a, b) => b.drop - a.drop).slice(0, 3).sort((a, b) => a.i - b.i);
    // ★ Best move: one of yours that matched Stockfish's first choice where it mattered most: right after the stones
    // slipped (you punished it), or when it won material. Opening moves don't count.
    const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    const prevDrop = (m) => { const p = ms.find((x) => x.i === m.i - 1); return p ? Math.max(0, p.drop) : 0; };
    const bestMoment = report.src === 'sf'
      ? mine.filter((m) => m.top && m.i > 6).map((m) => ({ m, score: prevDrop(m) + (m.captured ? VAL[m.captured.toLowerCase()] * 3 : 0) }))
        .filter((x) => x.score >= 3).sort((a, b) => b.score - a.score).map((x) => x.m)[0] || null
      : null;
    drawChart(n, worst, bestMoment);
    const box = $('reportMoments'); box.innerHTML = '';
    if (!report.done) { box.innerHTML = '<div class="small">Turning points appear when the analysis finishes.</div>'; return; }
    $('reportProgress').textContent = report.src === 'sf' ? '' : 'Stockfish could not load, so the game\'s own engine did the analysis (less precise, and no better-move suggestions).';
    const add = (m, tag, label, text, btn, fn) => {
      const d = document.createElement('div'); d.className = 'moment';
      d.innerHTML = `<span class="tag ${tag}">${label}</span><span class="what"></span>`;
      d.querySelector('.what').textContent = text;
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = btn; b.onclick = fn; b.dataset.ply = m.i;
      b.setAttribute('aria-label', `${btn.replace('▶ ', '')} move ${moveLabel(m.i)}, ${m.san}`); d.appendChild(b);
      box.appendChild(d);
    };
    worst.forEach((m, k) => {
      const better = sanOf(m.i - 1, m.best);
      add(m, kind(m.drop), `${k + 1} · ${kind(m.drop).toUpperCase()}`, `Move ${moveLabel(m.i)} · You played ${m.san}${better && better !== m.san ? ` · better was ${better}` : ''} (winning chances −${Math.round(m.drop)}%)`, 'Review', () => review(m.i, false));
    });
    if (bestMoment) add(bestMoment, 'best', '★ BEST', `Move ${moveLabel(bestMoment.i)} · ${bestMoment.san}: Stockfish's own first choice${prevDrop(bestMoment) >= 10 ? ', punishing the stones\' slip' : bestMoment.captured ? ', winning material' : ''}`, '▶ Replay', () => review(bestMoment.i, true));
    if (!worst.length && !bestMoment) box.innerHTML = '<div class="small">A clean game: no big swings either way.</div>';
  }

  function drawChart(n, worst, bestMoment) {
    const svgEl = $('reportChart'), W = 600, H = 150, X = (i) => 10 + (n ? (i / n) * (W - 20) : 0), Y = (wp) => H - 10 - (wp / 100) * (H - 20);
    const pts = []; for (let i = 0; i <= n; i++) { if (report.evals[i] === undefined || report.evals[i] === null) break; pts.push([X(i), Y(winPct(report.evals[i]))]); }
    const line = pts.map((p) => p.join(',')).join(' ');
    const area = pts.length ? `${X(0)},${Y(50)} ${line} ${pts[pts.length - 1][0]},${Y(50)}` : '';
    const dot = (m, cls, label) => { const p = pts[m.i]; return p ? `<circle cx="${p[0]}" cy="${p[1]}" r="6" class="${cls}"/><text x="${p[0]}" y="${p[1] - 10}" class="chart-lab">${label}</text>` : ''; };
    svgEl.innerHTML = `<line x1="10" x2="${W - 10}" y1="${Y(50)}" y2="${Y(50)}" class="chart-mid"/>
      <text x="14" y="18" class="chart-lab left">White ahead</text><text x="14" y="${H - 14}" class="chart-lab left">Black ahead</text>
      ${area ? `<polygon points="${area}" class="chart-area"/>` : ''}${line ? `<polyline points="${line}" class="chart-line"/>` : ''}
      ${worst.map((m, k) => dot(m, 'chart-bad', String(k + 1))).join('')}${bestMoment ? dot(bestMoment, 'chart-good', '★') : ''}`;
    const last = pts.length ? Math.round(winPct(report.evals[pts.length - 1])) : 50;
    svgEl.setAttribute('aria-label', `Chart of White's winning chances over ${n} moves; at the end White's chances are ${last}%.`);
  }

  /* Review: the board jumps straight to the position before that move (no replaying the whole game). */
  function review(i, replay) {
    const final = finalGame();
    if (!reviewState) reviewState = { final };
    reportToken++;                                   // stop any analysis still running
    $('reportOverlay').hidden = true;
    phase = 'review'; gameToken++; reviewAnim++;
    const g = new Game(); final.moveHistory.slice(0, i - 1).forEach((m) => g.move(m));
    game = g; reviewState.ply = i; selected = null;
    const prev = g.moveHistory[g.moveHistory.length - 1]; lastMove = prev ? { from: prev.from, to: prev.to } : null;
    R.setPosition(g.board); R.showArrow(-1); showClocks(false);
    const played = final.moveHistory[i - 1], best = report.best[i - 1];
    refreshMarks({ selected: played.from }); renderMoves(); renderTrays();
    const better = sanOf(i - 1, best);
    $('reviewText').textContent = `Move ${moveLabel(i)} · You played ${final.sanHistory[i - 1]}${better && better !== final.sanHistory[i - 1] ? `. Better: ${better} (arrow).` : '.'}`;
    if (better && better !== final.sanHistory[i - 1]) R.showArrow(best.from, best.to);
    $('reviewBetter').hidden = !better || better === final.sanHistory[i - 1];
    $('reviewBar').hidden = false; $('reviewBack').focus();
    setStatus('Reviewing the battle');
    if (replay) playLine('mine', true);
  }
  async function playLine(which, cinematic) {
    if (!reviewState || phase !== 'review') return;
    const i = reviewState.ply, g = game, token = ++reviewAnim;
    const spec = which === 'mine' ? reviewState.final.moveHistory[i - 1] : report.best[i - 1];
    if (!spec) return;
    for (const id of ['reviewMine', 'reviewBetter']) $(id).disabled = true;
    R.showArrow(-1);
    if (cinematic && R.setCinematic) R.setCinematic(true);
    const played = g.move(spec);
    if (played) { await R.animateMove(played, { celebrate: true }); await wait(900); }
    if (R.setCinematic) R.setCinematic(settings.speed === 'cinematic');
    if (token !== reviewAnim || phase !== 'review') return;
    if (played) g.undo();
    R.setPosition(g.board); refreshMarks({ selected: reviewState.final.moveHistory[i - 1].from });
    const best = report.best[i - 1]; if (best && !$('reviewBetter').hidden) R.showArrow(best.from, best.to);
    for (const id of ['reviewMine', 'reviewBetter']) $(id).disabled = false;
  }
  function endReview(showReport) {
    if (!reviewState) return;
    const ply = reviewState.ply;
    reviewAnim++;
    game = reviewState.final; reviewState = null; phase = 'over';
    const h = game.moveHistory[game.moveHistory.length - 1]; lastMove = h ? { from: h.from, to: h.to } : null;
    R.showArrow(-1); $('reviewBar').hidden = true; showClocks(!!clock);
    R.setPosition(game.board); refreshMarks(); renderMoves(); renderTrays();
    setStatus('Game over');
    if (showReport) {
      $('reportOverlay').hidden = false; renderReport();
      const back = document.querySelector(`#reportMoments .btn[data-ply="${ply}"]`); (back || $('reportClose')).focus();
    }
  }
  function reportPgn() {
    const final = finalGame(), me = 'You', bot = `Level ${level} ${LEVELS[level].name} (${LEVELS[level].elo})`;
    const result = gameOver ? gameOver.result : '*';
    return `[Event "Spellbound Chess"]\n[Site "https://luigicicciari.github.io/spellbound-chess/"]\n[Date "${new Date(gameStart).toISOString().slice(0, 10).replace(/-/g, '.')}"]\n`
      + `[White "${playerColor === 'w' ? me : bot}"]\n[Black "${playerColor === 'b' ? me : bot}"]\n[Result "${result}"]\n\n${final.pgn()} ${result}\n`;
  }
  $('reportBtn').onclick = openReport;
  $('reportClose').onclick = () => { $('reportOverlay').hidden = true; $('resultOverlay').hidden = false; };
  $('reviewBack').onclick = () => endReview(true);
  $('reviewMine').onclick = () => playLine('mine', false);
  $('reviewBetter').onclick = () => playLine('better', false);
  $('copyPgn').onclick = async () => {
    try { await navigator.clipboard.writeText(reportPgn()); toast('PGN copied. Paste it into any chess site.'); }
    catch (e) { toast('Copying is blocked here. Use Open in Lichess instead.'); }
  };
  $('lichessLink').onclick = () => { $('lichessLink').href = `https://lichess.org/analysis/pgn/${encodeURIComponent(finalGame().pgn())}?color=${playerColor === 'b' ? 'black' : 'white'}`; };

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
        return `<tr><td>${esc(String(g.created_at).slice(0, 10))}</td><td>Lv ${Number(g.level)}</td><td>${g.player_color === 'w' ? 'White' : 'Black'}</td>
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
      const best = ladderTab === 'today' ? '' : (p.best ? 'Lv ' + Number(p.best) : '—');
      return `<tr class="${p.player_id === me ? 'me' : ''}"><td class="num">${i + 1}</td><td>${p.player_id === me ? '<b>YOU</b> · ' : ''}${esc(p.handle)}</td>
        <td class="num">${val}</td><td class="num">${Number(p.games)}</td><td class="num">${best}</td></tr>`;
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
    clock = { w: mins * 60000, b: mins * 60000, inc: inc * 1000, run: null, last: 0 }; clockSnaps = [];
    showClocks(true); renderClock();
  }
  function showClocks(on) { $('clockMe').hidden = !on; $('clockThem').hidden = !on; }
  let clockSnaps = [];  // both clocks at the start of each turn, so Undo can put the time back too
  function clockStart(side) { if (!clock || watching) return; clockSnaps[game.sanHistory.length] = { w: clock.w, b: clock.b }; clock.run = side; clock.last = performance.now(); renderClock(); }
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
    else if (!$('reportOverlay').hidden) $('reportClose').click();
    else if (!$('reviewBar').hidden) endReview(true);
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

  /* ---------- new version check ----------
     Visitors often leave the game open for hours. Every 10 minutes (and when the tab comes back into view) the page
     asks the site which version is live. If it's newer, a bar offers a reload, but only between games, never mid-move. */
  const myVersion = (window.SB_CONFIG && window.SB_CONFIG.appVersion) || '';
  let newerVersion = null, updateDismissed = false, lastCheck = 0;
  const midGame = () => !watching && ['player', 'engine', 'animating', 'intro'].includes(phase) && game.sanHistory.length > 0;
  function offerUpdate() {
    if (!newerVersion || updateDismissed || midGame()) return;
    $('updateBar').hidden = false;
  }
  async function checkVersion() {
    if (!myVersion || Date.now() - lastCheck < 60000) return;
    lastCheck = Date.now();
    try {
      const txt = await fetch(`config.js?check=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : ''));
      const live = (/appVersion:\s*'([^']+)'/.exec(txt) || [])[1];
      if (live && live !== myVersion) { newerVersion = live; offerUpdate(); }
    } catch (e) { /* offline: try again later */ }
  }
  $('updateBtn').onclick = () => location.reload();
  $('updateLater').onclick = () => { updateDismissed = true; $('updateBar').hidden = true; };
  setTimeout(checkVersion, 30000);
  setInterval(checkVersion, 10 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
  if (!R.is3D && flatWhy) setTimeout(() => toast(`Showing the flat board: ${flatWhy}.`, 7000), 1200); // says why, so it can be fixed
  if (!settings.seenHelp) $('helpOverlay').hidden = false;
  refreshLadder().then(flushPending);
  newGame();
})();
