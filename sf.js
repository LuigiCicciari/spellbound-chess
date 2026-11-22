/* Spellbound Chess — Stockfish for the strong levels (4–7).
   Stockfish.js 17.1 lite single-threaded (GPLv3, https://github.com/nmrugg/stockfish.js) runs in a Web Worker
   from the repo's engine/ folder. Strength is set with UCI_LimitStrength + UCI_Elo (1320–3190). */
(function (root) {
  'use strict';
  const PATH = 'engine/stockfish-17.1-lite-single-03e3232.js';
  let worker = null, ready = null, chain = Promise.resolve();
  const listeners = new Set();

  function send(cmd) { if (worker) worker.postMessage(cmd); }
  function waitFor(pred, ms) {
    return new Promise((resolve, reject) => {
      const fn = (line) => {
        if (line === '__error__') { listeners.delete(fn); clearTimeout(t); reject(new Error('Stockfish crashed')); return; }
        if (pred(line)) { listeners.delete(fn); clearTimeout(t); resolve(line); }
      };
      const t = setTimeout(() => { listeners.delete(fn); reject(new Error('Stockfish timed out')); }, ms);
      listeners.add(fn);
    });
  }

  /* Throw the worker away so the next request starts a fresh one (after a crash, a timeout or a stray reply). */
  function reset() {
    try { if (worker) worker.terminate(); } catch (e) { /* ignore */ }
    worker = null; ready = null;
    for (const fn of [...listeners]) fn('__error__');
  }

  function load() {
    if (ready) return ready;
    ready = (async () => {
      if (typeof WebAssembly !== 'object') throw new Error('No WebAssembly');
      worker = new Worker(PATH);
      worker.onmessage = (e) => { const line = String(e.data); for (const fn of [...listeners]) fn(line); };
      worker.onerror = () => { reset(); };
      send('uci');
      await waitFor((l) => l === 'uciok', 20000);
      send('setoption name UCI_LimitStrength value true');
      send('isready');
      await waitFor((l) => l === 'readyok', 20000);
      return true;
    })();
    ready.catch(() => reset());
    return ready;
  }

  const FILES = 'abcdefgh';
  const sq = (n) => (8 - parseInt(n[1], 10)) * 8 + FILES.indexOf(n[0]);

  /* Run one request at a time; any failure resets the engine so it can't answer a later request late. */
  function queue(task) {
    const job = chain.then(task).catch((e) => { reset(); throw e; });
    chain = job.catch(() => {});
    return job;
  }

  /* Best move at a target Elo. Returns { from, to, promotion } using the game's square numbers. */
  function bestMove(fen, elo, movetimeMs) {
    return queue(async () => {
      await load();
      send(`setoption name UCI_Elo value ${Math.max(1320, Math.min(3190, Math.round(elo)))}`);
      send('isready'); await waitFor((l) => l === 'readyok', 10000);
      send(`position fen ${fen}`);
      send(`go movetime ${Math.max(100, Math.round(movetimeMs || 900))}`);
      const line = await waitFor((l) => l.startsWith('bestmove'), (movetimeMs || 900) + 10000);
      const uci = line.split(/\s+/)[1];
      if (!uci || uci === '(none)') return null;
      const side = fen.split(' ')[1];
      const promo = uci[4] ? (side === 'w' ? uci[4].toUpperCase() : uci[4].toLowerCase()) : null;
      return { from: sq(uci.slice(0, 2)), to: sq(uci.slice(2, 4)), promotion: promo, source: 'stockfish' };
    });
  }

  /* Full-strength evaluation in centipawns from the side to move's point of view (mates become ±10000). */
  function evaluate(fen, movetimeMs) {
    return queue(async () => {
      await load();
      send('setoption name UCI_LimitStrength value false');
      send('isready'); await waitFor((l) => l === 'readyok', 10000);
      let score = 0;
      const fn = (line) => {
        const mm = /score (cp|mate) (-?\d+)/.exec(line);
        if (mm) score = mm[1] === 'cp' ? Number(mm[2]) : (Number(mm[2]) > 0 ? 10000 : -10000);
      };
      listeners.add(fn);
      try {
        send(`position fen ${fen}`);
        send(`go movetime ${Math.max(100, Math.round(movetimeMs || 600))}`);
        await waitFor((l) => l.startsWith('bestmove'), (movetimeMs || 600) + 10000);
      } finally {
        listeners.delete(fn);
        send('setoption name UCI_LimitStrength value true');
      }
      return score;
    });
  }

  /* Full-strength look at a position: score from the side to move (centipawns, mates ±10000) and the best move. */
  function analyse(fen, movetimeMs) {
    return queue(async () => {
      await load();
      send('setoption name UCI_LimitStrength value false');
      send('isready'); await waitFor((l) => l === 'readyok', 10000);
      let score = 0;
      const fn = (line) => {
        const mm = /score (cp|mate) (-?\d+)/.exec(line);
        if (mm) score = mm[1] === 'cp' ? Number(mm[2]) : (Number(mm[2]) > 0 ? 10000 : -10000);
      };
      listeners.add(fn);
      let line = '';
      try {
        send(`position fen ${fen}`);
        send(`go movetime ${Math.max(60, Math.round(movetimeMs || 200))}`);
        line = await waitFor((l) => l.startsWith('bestmove'), (movetimeMs || 200) + 10000);
      } finally {
        listeners.delete(fn);
        send('setoption name UCI_LimitStrength value true');
      }
      const uci = line.split(/\s+/)[1];
      const side = fen.split(' ')[1];
      const best = uci && uci !== '(none)' ? { from: sq(uci.slice(0, 2)), to: sq(uci.slice(2, 4)), promotion: uci[4] ? (side === 'w' ? uci[4].toUpperCase() : uci[4].toLowerCase()) : null } : null;
      return { score, best };
    });
  }

  root.SBStockfish = { load, bestMove, evaluate, analyse, reset, PATH };
})(window);
