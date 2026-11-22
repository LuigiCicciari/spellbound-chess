/* Spellbound Chess — Stockfish for the strong levels (4–7).
   Stockfish.js 17.1 lite single-threaded (GPLv3, https://github.com/nmrugg/stockfish.js) runs in a Web Worker
   from the repo's engine/ folder. Strength is set with UCI_LimitStrength + UCI_Elo (1320–3190). */
(function (root) {
  'use strict';
  const PATH = 'engine/stockfish-17.1-lite-single-03e3232.js';
  let worker = null, ready = null, chain = Promise.resolve();
  const listeners = new Set();

  function send(cmd) { worker.postMessage(cmd); }
  function waitFor(pred, ms) {
    return new Promise((resolve, reject) => {
      const fn = (line) => { if (pred(line)) { listeners.delete(fn); clearTimeout(t); resolve(line); } };
      const t = setTimeout(() => { listeners.delete(fn); reject(new Error('Stockfish timed out')); }, ms);
      listeners.add(fn);
    });
  }

  function load() {
    if (ready) return ready;
    ready = (async () => {
      if (typeof WebAssembly !== 'object') throw new Error('No WebAssembly');
      worker = new Worker(PATH);
      worker.onmessage = (e) => { const line = String(e.data); for (const fn of [...listeners]) fn(line); };
      worker.onerror = () => { for (const fn of [...listeners]) fn('__error__'); };
      send('uci');
      const r = await waitFor((l) => l === 'uciok' || l === '__error__', 20000);
      if (r === '__error__') throw new Error('Stockfish failed to load');
      send('setoption name UCI_LimitStrength value true');
      send('isready');
      await waitFor((l) => l === 'readyok', 20000);
      return true;
    })();
    ready.catch(() => { try { worker && worker.terminate(); } catch (e) { /* ignore */ } worker = null; ready = null; });
    return ready;
  }

  const FILES = 'abcdefgh';
  const sq = (n) => (8 - parseInt(n[1], 10)) * 8 + FILES.indexOf(n[0]);

  /* Best move at a target Elo. Returns { from, to, promotion } using the game's square numbers. */
  function bestMove(fen, elo, movetimeMs) {
    const job = chain.then(async () => {
      await load();
      send(`setoption name UCI_Elo value ${Math.max(1320, Math.min(3190, Math.round(elo)))}`);
      send('isready');
      await waitFor((l) => l === 'readyok', 10000);
      send(`position fen ${fen}`);
      send(`go movetime ${Math.max(100, Math.round(movetimeMs || 900))}`);
      const line = await waitFor((l) => l.startsWith('bestmove'), (movetimeMs || 900) + 10000);
      const uci = line.split(/\s+/)[1];
      if (!uci || uci === '(none)') return null;
      const side = fen.split(' ')[1];
      const promo = uci[4] ? (side === 'w' ? uci[4].toUpperCase() : uci[4].toLowerCase()) : null;
      return { from: sq(uci.slice(0, 2)), to: sq(uci.slice(2, 4)), promotion: promo, source: 'stockfish' };
    });
    chain = job.catch(() => {});
    return job;
  }

  root.SBStockfish = { load, bestMove, PATH };
})(window);
