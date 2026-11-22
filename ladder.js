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
    if (t === 'timeout') return !st && g.result !== 'D'; // a flag can't be checked from the moves, like a resignation
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
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    return res.status === 204 || res.status === 201 ? null : res.json();
  }

  let mode = live() ? 'live' : 'local';

  async function loadAll() {
    const local = store.get(LS_KEY, []);
    if (!live()) { mode = 'local'; return local; }
    try {
      const rows = [];
      for (let offset = 0; offset < 20000; offset += 1000) {
        const page = await rest(`games?select=*&order=created_at.asc&limit=1000&offset=${offset}`);
        rows.push(...page);
        if (page.length < 1000) break;
      }
      mode = 'live';
      return rows;
    } catch (e) {
      mode = 'local';
      return local;
    }
  }

  async function save(record) {
    const local = store.get(LS_KEY, []);
    record.created_at = record.created_at || new Date().toISOString();
    local.push(record); store.set(LS_KEY, local);
    if (!live()) { mode = 'local'; return { mode }; }
    try {
      const body = Object.assign({}, record); delete body.created_at; // the server stamps the time
      await rest('games', { method: 'POST', body: JSON.stringify(body), headers: { Prefer: 'return=minimal' } });
      mode = 'live';
    } catch (e) { mode = 'local'; }
    return { mode };
  }

  const api = { verify, compute, preview, loadAll, save, START, STARTS, PROVISIONAL, get mode() { return mode; }, isLiveConfigured: live };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SBLadder = api;
})(typeof window !== 'undefined' ? window : this);
