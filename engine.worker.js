/* Runs the computer opponent off the main thread so the board never freezes. */
importScripts('rules.js?v=1.0.1', 'engine.js?v=1.0.1');
self.onmessage = (e) => {
  const { id, kind, fen, level, sanHistory, book, color } = e.data;
  try {
    if (kind === 'eval') self.postMessage({ id, value: self.SBEngine.evalFor(fen, color) });
    else self.postMessage({ id, move: self.SBEngine.chooseMove(fen, level, { sanHistory, book }) });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
