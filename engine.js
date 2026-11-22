/* Spellbound Chess — computer opponent.
   Negamax alpha-beta with piece-square tables, MVV-LVA ordering, quiescence and iterative deepening.
   Levels: 1 Apprentice, 2 Adept, 3 Master, 4 Archmage. */
(function (root) {
  'use strict';
  const R = root.SBRules || (typeof require !== 'undefined' ? require('./rules.js') : null);

  const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  // Piece-square tables from White's point of view, row 0 = rank 8.
  const PST = {
    P: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    N: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    B: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    R: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    Q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    K: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
    KE: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
  };

  // Levels 1-3 use this engine (ratings are estimates to calibrate against Stockfish).
  // Levels 4-7 use Stockfish with UCI_Elo (sf.js); the built-in settings below are only a fallback if Stockfish can't load.
  const LEVELS = {
    1: { name: 'Apprentice', elo: 400, depth: 1, blunder: 0.30, pool: 6, quiesce: false, timeMs: 400 },
    2: { name: 'Adept', elo: 800, depth: 2, blunder: 0.10, pool: 3, quiesce: false, timeMs: 700 },
    3: { name: 'Master', elo: 1200, depth: 3, blunder: 0, pool: 1, quiesce: true, timeMs: 1200 },
    4: { name: 'Archmage', elo: 1600, stockfish: true, depth: 4, blunder: 0, pool: 1, quiesce: true, timeMs: 1500 },
    5: { name: 'Grand Archmage', elo: 2000, stockfish: true, depth: 4, blunder: 0, pool: 1, quiesce: true, timeMs: 1500 },
    6: { name: 'Elder', elo: 2400, stockfish: true, depth: 4, blunder: 0, pool: 1, quiesce: true, timeMs: 1500 },
    7: { name: 'Eternal', elo: 2800, stockfish: true, depth: 4, blunder: 0, pool: 1, quiesce: true, timeMs: 1500 },
  };
  const MATE = 100000;

  /* Static evaluation from the side to move's point of view (centipawns). */
  function evaluate(g) {
    let score = 0, nonPawn = 0;
    for (let s = 0; s < 64; s++) { const p = g.board[s]; if (p && 'NBRQnbrq'.includes(p)) nonPawn += VAL[p.toUpperCase()]; }
    const endgame = nonPawn <= 1300;
    for (let s = 0; s < 64; s++) {
      const p = g.board[s]; if (!p) continue;
      const t = p.toUpperCase(), white = p === t;
      const idx = white ? s : (7 - (s >> 3)) * 8 + (s & 7);
      const table = t === 'K' && endgame ? PST.KE : PST[t];
      const v = VAL[t] + table[idx];
      score += white ? v : -v;
    }
    return g.turn === 'w' ? score : -score;
  }

  function orderMoves(moves) {
    return moves.map((m) => {
      let k = 0;
      if (m.captured) k += 10 * VAL[m.captured.toUpperCase()] - VAL[m.piece.toUpperCase()] + 10000;
      if (m.promotion) k += VAL[m.promotion.toUpperCase()] + 9000;
      return { m, k };
    }).sort((a, b) => b.k - a.k).map((x) => x.m);
  }

  class Search {
    constructor(g, deadline) { this.g = g; this.deadline = deadline; this.nodes = 0; this.stopped = false; }

    timeUp() {
      if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) this.stopped = true;
      return this.stopped;
    }

    legal(capturesOnly) {
      const g = this.g, us = g.turn, out = [];
      for (const m of g.pseudoMoves()) {
        if (capturesOnly && !m.captured && !m.promotion) continue;
        g.makeMove(m);
        if (!g.inCheck(us)) out.push(m);
        g.unmakeMove();
      }
      return out;
    }

    quiesce(alpha, beta, ply) {
      if (this.timeUp()) return 0;
      const stand = evaluate(this.g);
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
      if (ply > 8) return alpha;
      for (const m of orderMoves(this.legal(true))) {
        this.g.makeMove(m);
        const score = -this.quiesce(-beta, -alpha, ply + 1);
        this.g.unmakeMove();
        if (this.stopped) return 0;
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }
      return alpha;
    }

    negamax(depth, alpha, beta, ply, useQ) {
      if (this.timeUp()) return 0;
      const moves = this.legal(false);
      if (!moves.length) return this.g.inCheck() ? -MATE + ply : 0;
      if (this.g.halfmove >= 100) return 0;
      if (depth === 0) return useQ ? this.quiesce(alpha, beta, 0) : evaluate(this.g);
      for (const m of orderMoves(moves)) {
        this.g.makeMove(m);
        const score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, useQ);
        this.g.unmakeMove();
        if (this.stopped) return 0;
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }
      return alpha;
    }

    /* Score every root move at a fixed depth (used for the weakened levels). */
    scoreRoot(depth, useQ) {
      const scored = [];
      for (const m of orderMoves(this.legal(false))) {
        this.g.makeMove(m);
        const s = -this.negamax(depth - 1, -MATE - 1, MATE + 1, 1, useQ);
        this.g.unmakeMove();
        if (this.stopped) break;
        scored.push({ m, s });
      }
      return scored.sort((a, b) => b.s - a.s);
    }

    /* Iterative deepening with a principal-move-first ordering. */
    best(maxDepth, useQ) {
      let rootMoves = orderMoves(this.legal(false));
      let best = { m: rootMoves[0], s: 0, depth: 0 };
      for (let d = 1; d <= maxDepth; d++) {
        let alpha = -MATE - 1, iterBest = null;
        for (const m of rootMoves) {
          this.g.makeMove(m);
          const s = -this.negamax(d - 1, -MATE - 1, -alpha, 1, useQ);
          this.g.unmakeMove();
          if (this.stopped) break;
          if (!iterBest || s > iterBest.s) { iterBest = { m, s, depth: d }; alpha = s; }
        }
        if (this.stopped && !iterBest) break;
        if (iterBest && (!this.stopped || iterBest.s > best.s)) best = iterBest;
        if (this.stopped) break;
        rootMoves = [best.m].concat(rootMoves.filter((x) => x !== best.m));
        if (Math.abs(best.s) > MATE - 100) break;
      }
      return best;
    }
  }

  /* Pick the computer's move.
     fen: position; level: 1-4; book: optional opening tree { prefix: { next: [[san, n], ...] } };
     sanHistory: moves so far (for the book lookup); rnd: optional random function. */
  function chooseMove(fen, level, opts) {
    opts = opts || {};
    const rnd = opts.rnd || Math.random;
    const L = LEVELS[level] || LEVELS[1];
    const g = new R.Game(fen);
    const legal = g.legalMoves();
    if (!legal.length) return null;

    // Opening book from real games (first 8 plies)
    const hist = opts.sanHistory || [];
    if (opts.book && hist.length < 8) {
      const node = opts.book[hist.join(' ')];
      if (node && node.next && node.next.length) {
        const pool = level <= 2 ? node.next : node.next.slice(0, 3);
        const total = pool.reduce((a, x) => a + x[1], 0);
        let pick = rnd() * total;
        for (const [san, n] of pool) {
          pick -= n;
          if (pick <= 0) {
            const m = legal.find((o) => g.san(o, legal) === san);
            if (m) return { from: m.from, to: m.to, promotion: m.promotion, source: 'book' };
            break;
          }
        }
      }
    }

    const search = new Search(g, Date.now() + L.timeMs);
    let chosen;
    if (L.blunder > 0) {
      const scored = search.scoreRoot(L.depth, L.quiesce);
      if (!scored.length) chosen = legal[0];
      else if (rnd() < L.blunder) chosen = scored[Math.floor(rnd() * Math.min(L.pool, scored.length))].m;
      else {
        // pick randomly among moves tied for best, so games vary
        const top = scored.filter((x) => x.s >= scored[0].s - 5);
        chosen = top[Math.floor(rnd() * top.length)].m;
      }
    } else {
      chosen = search.best(L.depth, L.quiesce).m || legal[0];
    }
    return { from: chosen.from, to: chosen.to, promotion: chosen.promotion, source: 'search', nodes: search.nodes };
  }

  /* Evaluation of a position (centipawns) from the given color's point of view; used for draw offers. */
  function evalFor(fen, color) {
    const g = new R.Game(fen);
    const s = new Search(g, Date.now() + 300);
    const v = s.negamax(2, -MATE - 1, MATE + 1, 0, true);
    return g.turn === color ? v : -v;
  }

  const api = { chooseMove, evalFor, evaluate, LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SBEngine = api;
})(typeof self !== 'undefined' ? self : this);
