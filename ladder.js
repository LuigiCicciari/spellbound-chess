/* Spellbound Chess — saved games, verification, Elo and the ladder.
   LIVE mode: Supabase REST (fill in config.js). LOCAL mode: this browser only. */
(function (root) {
  'use strict';
  const R = root.SBRules || (typeof require !== 'undefined' ? require('./rules.js') : null);

  const START = 1200, FLOOR = 100, PROVISIONAL = 5;
  const STARTS = [400, 800, 1200]; // New to chess / Play casually / Play a lot
  // Ratings move fastest at first so a wrong starting guess corrects itself within a few games.
  const kFor = (gamesPlayed) => (gamesPlayed < 10 ? 60 : gamesPlayed < 20 ? 40 : 20);
  const expected = (r, opp) => 1 / (1 + Math.pow(10, (opp - r) / 400));
  const scoreOf = (res) => (res === 'W' ? 1 : res === 'D' ? 0.5 : 0);

  /* Check that a saved game is real: legal moves, and the result matches the final position where it can be checked. */
  function verify(g) {
    if (!g || !/^[A-Za-z0-9_]{3,16}$/.test(g.handle || '')) return false;
    if (!(Number(g.level) >= 1 && Number(g.level) <= 7)) return false;
    if (g.start_rating != null && !STARTS.includes(Number(g.start_rating)) && Number(g.start_rating) !== START) return false;
    if (!['W', 'D', 'L'].includes(g.result) || !['w', 'b'].includes(g.player_color)) return false;
    const game = R.replay(g.pgn);
    if (!game) return false;
    const st = game.status();
    const t = g.termination;
    const loserIsPlayer = (winner) => (winner === g.player_color ? 'W' : 'L');
    if (t === 'checkmate') return !!st && st.reason === 'checkmate' && g.result === loserIsPlayer(st.result === '1-0' ? 'w' : 'b');
    if (['stalemate', 'threefold', 'fifty_move', 'insufficient'].includes(t)) return !!st && st.reason === t && g.result === 'D';
    if (t === 'resign') return !st && g.result === 'L'; // only the player can resign
    if (t === 'draw_agreed') return !st && g.result === 'D';
    if (t === 'timeout') { // a flag can't be checked from the moves, like a resignation; only the player's clock can run out
      if (!g.clock || st) return false;
      if (g.result === 'L') return true;
      // a draw on time: the side whose clock ran (the side to move) flagged, and the other side can't mate
      return g.result === 'D' && game.turn === g.player_color && typeof game.canMate === 'function' && !game.canMate(g.player_color === 'w' ? 'b' : 'w');
    }
    return false;
  }

  /* Recompute every player's rating from the verified games, oldest first. */
  function compute(games, nowIso) {
    const today = (nowIso || new Date().toISOString()).slice(0, 10);
    const players = new Map();
    const sorted = games.filter(verify).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    for (const g of sorted) {
      let p = players.get(g.player_id);
      if (!p) { const s0 = Number(g.start_rating) || START; p = { player_id: g.player_id, handle: g.handle, start: s0, rating: s0, games: 0, w: 0, d: 0, l: 0, best: 0, today: 0, history: [], reachedAt: g.created_at }; players.set(g.player_id, p); }
      const before = p.rating;
      const e = expected(before, Number(g.engine_elo));
      const after = Math.max(FLOOR, before + kFor(p.games) * (scoreOf(g.result) - e));
      p.rating = after; p.games++; p.handle = g.handle;
      if (g.result === 'W') { p.w++; p.best = Math.max(p.best, Number(g.level)); } else if (g.result === 'D') p.d++; else p.l++;
      if (String(g.created_at).slice(0, 10) === today) p.today += after - before;
      if (after > before) p.reachedAt = g.created_at;
      p.history.push({ game: g, before, after, delta: after - before });
    }
    const list = [...players.values()];
    const ranked = list.filter((p) => p.games >= PROVISIONAL)
      .sort((a, b) => b.rating - a.rating || b.games - a.games || String(a.reachedAt).localeCompare(String(b.reachedAt)));
    ranked.forEach((p, i) => { p.rank = i + 1; });
    const todayList = list.filter((p) => p.history.some((h) => String(h.game.created_at).slice(0, 10) === today))
      .sort((a, b) => b.today - a.today);
    return { players, ranked, today: todayList };
  }

  /* Rating change this result would cause, before saving. */
  function preview(current, gamesPlayed, engineElo, result) {
    const e = expected(current, engineElo);
    return Math.max(FLOOR, current + kFor(gamesPlayed) * (scoreOf(result) - e)) - current;
  }

  /* ---------- storage ---------- */
  const LS_KEY = 'spellbound.games.v1';
  const store = {
    get(k, d) { try { const v = root.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage may be blocked */ } },
  };

  function cfg() { return root.SB_CONFIG || {}; }
  function live() { const c = cfg(); return !!(c.supabaseUrl && c.supabaseAnonKey); }

  async function rest(path, init) {
    const c = cfg();
    const key = c.supabaseAnonKey.trim();
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    // New publishable keys (sb_publishable_...) go in the apikey header only.
    // Older "anon" keys are JWTs (eyJ...) and also go in Authorization.
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(`${c.supabaseUrl.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '')}/rest/v1/${path}`, Object.assign({}, init, {
      headers: Object.assign(headers, (init || {}).headers),
    }));
    if (!res.ok) {
      let msg = `Supabase ${res.status}`;
      try { const j = await res.json(); if (j && j.message) msg = j.message; } catch (e) { /* ignore */ }
      const err = new Error(msg); err.status = res.status; throw err;
    }
    if (init && init.count) return { rows: await res.json(), range: res.headers.get('content-range') };
    return res.status === 204 ? null : res.json();
  }
  const NOT_DEPLOYED = Symbol('not deployed');
  async function callFunction(name, body) {
    const c = cfg();
    const key = c.supabaseAnonKey.trim();
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(`${c.supabaseUrl.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '')}/functions/v1/${name}`, { method: 'POST', headers, body });
    if (res.status === 404) return NOT_DEPLOYED;
    if (!res.ok) {
      let msg = `Supabase ${res.status}`;
      try { const j = await res.json(); if (j && (j.message || j.msg)) msg = j.message || j.msg; } catch (e) { /* ignore */ }
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return res.json();
  }
  const countFrom = (range) => { const m = /\/(\d+)$/.exec(range || ''); return m ? Number(m[1]) : 0; };

  let mode = live() ? 'live' : 'local';

  /* Everything the rating tile and leaderboard need, in one shape for both modes:
     { mode, ranked: [{player_id, handle, rating, games, best, rank}], totalRanked, today: [{player_id, handle, gain, games}],
       me: {rating, games, w, d, l, best, rank, start} | null, history: [{created_at, level, player_color, result, before, after, delta}] } */
  async function board(playerId, fallbackStart) {
    if (live()) {
      try {
        const cols = 'player_id,handle,rating,games,wins,draws,losses,best_level,start_rating';
        // hidden = moderated players (v0.6.1 database); fall back if that column isn't there yet
        let vis = '&hidden=is.false';
        try { await rest('players?select=hidden&limit=1'); } catch (e) { vis = ''; }
        const top = await rest(`players?select=${cols}&games=gte.${PROVISIONAL}${vis}&order=rating.desc,games.desc&limit=10`, { count: true, headers: { Prefer: 'count=exact' } });
        const meRows = await rest(`players?select=${cols}&player_id=eq.${encodeURIComponent(playerId)}`);
        const today = await rest('today_board?select=player_id,handle,gain,games&order=gain.desc&limit=10');
        const hist = await rest(`games?select=created_at,level,player_color,result,rating_before,rating_after&player_id=eq.${encodeURIComponent(playerId)}&order=created_at.desc&limit=500`);
        hist.reverse();                                  // newest 500, oldest first
        const m = meRows[0] || null;
        let me = null;
        if (m) {
          me = { rating: m.rating, games: m.games, w: m.wins, d: m.draws, l: m.losses, best: m.best_level, start: m.start_rating, rank: null };
          if (m.games >= PROVISIONAL) {
            const above = await rest(`players?select=player_id&games=gte.${PROVISIONAL}${vis}&rating=gt.${m.rating}&limit=1`, { count: true, headers: { Prefer: 'count=exact' } });
            me.rank = countFrom(above.range) + 1;
          }
        }
        mode = 'live';
        return {
          mode,
          ranked: top.rows.map((p, i) => ({ player_id: p.player_id, handle: p.handle, rating: p.rating, games: p.games, best: p.best_level, rank: i + 1 })),
          totalRanked: countFrom(top.range),
          today: today.map((t) => ({ player_id: t.player_id, handle: t.handle, gain: t.gain, games: t.games })),
          me,
          history: hist.filter((h) => h.rating_after != null).map((h) => ({ created_at: h.created_at, level: h.level, player_color: h.player_color, result: h.result, before: h.rating_before, after: h.rating_after, delta: h.rating_after - h.rating_before })),
        };
      } catch (e) { mode = 'local'; }
    }
    // LOCAL: everything comes from this browser's saved games
    const data = compute(store.get(LS_KEY, []));
    const p = data.players.get(playerId);
    return {
      mode: 'local',
      ranked: data.ranked.slice(0, 10).map((q) => ({ player_id: q.player_id, handle: q.handle, rating: q.rating, games: q.games, best: q.best, rank: q.rank })),
      totalRanked: data.ranked.length,
      today: data.today.slice(0, 10).map((q) => ({ player_id: q.player_id, handle: q.handle, gain: q.today, games: q.history.length })),
      me: p ? { rating: p.rating, games: p.games, w: p.w, d: p.d, l: p.l, best: p.best, start: p.start, rank: p.rank || null } : null,
      history: p ? p.history.map((h) => ({ created_at: h.game.created_at, level: h.game.level, player_color: h.game.player_color, result: h.game.result, before: h.before, after: h.after, delta: h.delta })) : [],
    };
  }

  /* Per-level board: who has beaten this level most often (wins, then draws). */
  async function levelBoard(level) {
    const L = Number(level);
    const tally = (rows, nameOf) => {
      const m = new Map();
      for (const g of rows) {
        const t = m.get(g.player_id) || { player_id: g.player_id, handle: nameOf(g), wins: 0, draws: 0, games: 0 };
        t.games++; if (g.result === 'W') t.wins++; else if (g.result === 'D') t.draws++;
        m.set(g.player_id, t);
      }
      return [...m.values()].filter((t) => t.wins > 0).sort((a, b) => b.wins - a.wins || b.draws - a.draws || a.games - b.games).slice(0, 10);
    };
    if (live()) {
      try {
        const rows = await rest(`games?select=player_id,handle,result&level=eq.${L}&order=created_at.desc&limit=5000`);
        let hidden = new Set();
        try { hidden = new Set((await rest('players?select=player_id&hidden=is.true')).map((p) => p.player_id)); } catch (e) { /* older database */ }
        const names = new Map();
        const top = tally(rows.filter((g) => !hidden.has(g.player_id)), (g) => g.handle);
        if (top.length) {
          const ids = top.map((t) => t.player_id).join(',');
          try { (await rest(`players?select=player_id,handle&player_id=in.(${ids})`)).forEach((p) => names.set(p.player_id, p.handle)); } catch (e) { /* keep game names */ }
        }
        return top.map((t, i) => ({ ...t, handle: names.get(t.player_id) || t.handle, rank: i + 1 }));
      } catch (e) { /* fall through to local */ }
    }
    return tally(store.get(LS_KEY, []).filter((g) => Number(g.level) === L), (g) => g.handle).map((t, i) => ({ ...t, rank: i + 1 }));
  }

  /* Save a finished game. LIVE: through the submit_game function, which checks the secret and rates the game on the server. */
  async function save(record, secret) {
    const local = store.get(LS_KEY, []);
    record.created_at = record.created_at || new Date().toISOString();
    // "Try again" sends the same game again: keep one local copy of it
    if (!local.some((g) => g.player_id === record.player_id && g.pgn === record.pgn && g.termination === record.termination)) { local.push(record); store.set(LS_KEY, local); }
    if (!live()) { mode = 'local'; return { mode }; }
    try {
      const body = JSON.stringify({
        p_player_id: record.player_id, p_secret: secret, p_handle: record.handle, p_level: record.level,
        p_player_color: record.player_color, p_result: record.result, p_termination: record.termination,
        p_ply_count: record.ply_count, p_pgn: record.pgn, p_start_rating: record.start_rating,
        p_clock: record.clock, p_app_version: record.app_version,
      });
      // v1.0: games go through the submit-game Edge Function, which replays the moves before the database rates
      // the game. v1.1.7: no way around it any more. If the function answers 404 (missing or mid-redeploy), the game
      // is kept and sent again on the next visit; the old direct database call is gone (browsers can't run it
      // anyway since v1.0, and its permission error used to be taken as a final refusal, dropping the game).
      const r = await callFunction('submit-game', body);
      if (r === NOT_DEPLOYED) return { mode: 'live', error: 'the save service is unavailable right now', transient: true };
      mode = 'live';
      return { mode, before: r && r.rating_before, after: r && r.rating_after };
    } catch (e) {
      // a refused save (wrong secret, rate limit, bad game) stays refused; a server error or network failure is
      // reported as transient so the game is kept and sent again (the server ignores a game it already has)
      if (e.status && e.status < 500) return { mode: 'live', error: e.message };
      return { mode: 'live', error: e.message || 'network error', transient: true };
    }
  }

  async function rename(playerId, secret, handle) {
    if (!live()) return true;
    try { await rest('rpc/rename_player', { method: 'POST', body: JSON.stringify({ p_player_id: playerId, p_secret: secret, p_handle: handle }) }); return true; }
    catch (e) { return false; }
  }

  /* ---------- delete my data (v1.1.8) ---------- */
  // Removes the player's games, puzzle results, feedback and the player row on the server (needs the secret).
  async function deletePlayer(playerId, secret, clientId) {
    if (!live()) return { ok: true };
    try {
      await rest('rpc/delete_player', { method: 'POST', body: JSON.stringify({ p_player_id: playerId, p_secret: secret || null, p_client_id: clientId || null }) });
      return { ok: true };
    } catch (e) { return { error: e.message || 'network error' }; }
  }

  /* ---------- daily puzzle (v1.1) ---------- */
  // All writes go through the "puzzle" Edge Function: it checks the solution, and the database keeps the clock.
  // Each returns the server's JSON, or { error, transient } (transient = couldn't reach it; refused = not transient).
  async function puzzleCall(body) {
    if (!live()) return { error: 'offline', transient: true };
    try {
      const r = await callFunction('puzzle', JSON.stringify(body));
      if (r === NOT_DEPLOYED) return { error: 'puzzle leaderboard not set up yet', transient: true };
      return r || {};
    } catch (e) {
      return { error: e.message || 'network error', transient: !(e.status && e.status < 500) };
    }
  }
  const puzzleStart = (who, day) => puzzleCall({ action: 'start', day, p_player_id: who.player_id, p_secret: who.secret, p_handle: who.handle, p_start_rating: who.start });
  const puzzleFinish = (who, day, solved, moves, mistakes) => puzzleCall({ action: 'finish', day, solved, moves, mistakes, p_player_id: who.player_id, p_secret: who.secret });
  async function puzzleBoard(day, playerId) {
    if (!live()) return null;
    try {
      const top = await rest(`puzzle_board?select=player_id,handle,ms,mistakes,rank&day=eq.${Number(day)}&order=rank.asc,ms.asc&limit=10`);
      let me = null, streak = 0;
      if (playerId) {
        const mine = await rest(`puzzle_board?select=player_id,handle,ms,mistakes,rank&day=eq.${Number(day)}&player_id=eq.${encodeURIComponent(playerId)}`);
        me = mine[0] || null;
        streak = Number(await rest('rpc/puzzle_streak', { method: 'POST', body: JSON.stringify({ p_player_id: playerId, p_day: Number(day) }) })) || 0;
      }
      return { top: top.map((r) => ({ ...r, ms: Number(r.ms), mistakes: Number(r.mistakes), rank: Number(r.rank) })), me, streak };
    } catch (e) { return null; }
  }

  /* ---------- feedback (v1.1.3): private, write-only; read in Supabase's Table Editor ---------- */
  async function feedback(body) {
    if (!live()) return { error: "the leaderboard isn't connected, so feedback can't be sent from here" };
    try {
      await rest('rpc/submit_feedback', { method: 'POST', body: JSON.stringify(body) });
      return { ok: true };
    } catch (e) { return { error: e.message || 'network error' }; }
  }

  const api = { verify, compute, preview, board, levelBoard, save, rename, feedback, deletePlayer, puzzleStart, puzzleFinish, puzzleBoard, START, STARTS, PROVISIONAL, get mode() { return mode; }, isLiveConfigured: live };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SBLadder = api;
})(typeof window !== 'undefined' ? window : this);
