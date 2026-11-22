/* Spellbound Chess — chess rules (move generation, SAN, game-over detection).
   Board: 64 squares, index = row*8 + col, row 0 = rank 8, col 0 = file a.
   Pieces: 'PNBRQK' white, 'pnbrqk' black, null = empty. */
(function (root) {
  'use strict';

  const FILES = 'abcdefgh';
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const sqName = (s) => FILES[s & 7] + (8 - (s >> 3));
  const sqIndex = (n) => (8 - parseInt(n[1], 10)) * 8 + FILES.indexOf(n[0]);
  const colorOf = (p) => (p ? (p === p.toUpperCase() ? 'w' : 'b') : null);
  const typeOf = (p) => (p ? p.toUpperCase() : null);
  const onBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

  class Game {
    constructor(fen) { this.load(fen || START_FEN); }

    load(fen) {
      const [placement, turn, castle, ep, half, full] = fen.trim().split(/\s+/);
      this.board = new Array(64).fill(null);
      let s = 0;
      for (const ch of placement) {
        if (ch === '/') continue;
        if (/\d/.test(ch)) s += parseInt(ch, 10);
        else this.board[s++] = ch;
      }
      this.turn = turn || 'w';
      this.castling = { K: false, Q: false, k: false, q: false };
      if (castle && castle !== '-') for (const ch of castle) this.castling[ch] = true;
      this.ep = ep && ep !== '-' ? sqIndex(ep) : -1;
      this.halfmove = parseInt(half || '0', 10);
      this.fullmove = parseInt(full || '1', 10);
      this.stack = [];
      this.sanHistory = [];
      this.moveHistory = [];
      this.repetition = new Map();
      this._bump(this.key(), 1);
    }

    fen() {
      let out = '';
      for (let r = 0; r < 8; r++) {
        let empty = 0;
        for (let c = 0; c < 8; c++) {
          const p = this.board[r * 8 + c];
          if (!p) { empty++; continue; }
          if (empty) { out += empty; empty = 0; }
          out += p;
        }
        if (empty) out += empty;
        if (r < 7) out += '/';
      }
      const cs = ['K', 'Q', 'k', 'q'].filter((k) => this.castling[k]).join('') || '-';
      return `${out} ${this.turn} ${cs} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.halfmove} ${this.fullmove}`;
    }

    key() {
      const cs = ['K', 'Q', 'k', 'q'].filter((k) => this.castling[k]).join('');
      return this.board.map((p) => p || '.').join('') + this.turn + cs + this.ep;
    }

    _bump(k, d) { this.repetition.set(k, (this.repetition.get(k) || 0) + d); }

    kingSquare(color) {
      const k = color === 'w' ? 'K' : 'k';
      return this.board.indexOf(k);
    }

    attacked(sq, by) {
      const r = sq >> 3, c = sq & 7, b = this.board;
      // pawns
      const pr = by === 'w' ? r + 1 : r - 1;
      const pawn = by === 'w' ? 'P' : 'p';
      for (const dc of [-1, 1]) if (onBoard(pr, c + dc) && b[pr * 8 + c + dc] === pawn) return true;
      const N = by === 'w' ? 'N' : 'n', K = by === 'w' ? 'K' : 'k';
      for (const [dr, dc] of KNIGHT) if (onBoard(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === N) return true;
      for (const [dr, dc] of KING) if (onBoard(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === K) return true;
      const slide = (dirs, set) => {
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (onBoard(rr, cc)) {
            const p = b[rr * 8 + cc];
            if (p) { if (colorOf(p) === by && set.includes(typeOf(p))) return true; break; }
            rr += dr; cc += dc;
          }
        }
        return false;
      };
      return slide(DIAG, 'BQ') || slide(ORTHO, 'RQ');
    }

    inCheck(color) {
      const c = color || this.turn;
      const k = this.kingSquare(c);
      return k >= 0 && this.attacked(k, c === 'w' ? 'b' : 'w');
    }

    pseudoMoves() {
      const moves = [], b = this.board, us = this.turn, them = us === 'w' ? 'b' : 'w';
      const add = (from, to, piece, flags, promotion) => {
        const captured = flags === 'e' ? (us === 'w' ? 'p' : 'P') : b[to];
        moves.push({ from, to, piece, captured: captured || null, flags, promotion: promotion || null });
      };
      for (let s = 0; s < 64; s++) {
        const p = b[s];
        if (!p || colorOf(p) !== us) continue;
        const t = typeOf(p), r = s >> 3, c = s & 7;
        if (t === 'P') {
          const dir = us === 'w' ? -1 : 1, startRow = us === 'w' ? 6 : 1, lastRow = us === 'w' ? 0 : 7;
          const one = (r + dir) * 8 + c;
          const pushPromo = (to, flags) => {
            if ((to >> 3) === lastRow) for (const pr of 'QRBN') add(s, to, p, flags + 'p', us === 'w' ? pr : pr.toLowerCase());
            else add(s, to, p, flags);
          };
          if (onBoard(r + dir, c) && !b[one]) {
            pushPromo(one, 'n');
            const two = (r + 2 * dir) * 8 + c;
            if (r === startRow && !b[two]) add(s, two, p, 'b');
          }
          for (const dc of [-1, 1]) {
            if (!onBoard(r + dir, c + dc)) continue;
            const to = (r + dir) * 8 + c + dc;
            if (b[to] && colorOf(b[to]) === them) pushPromo(to, 'c');
            else if (to === this.ep) add(s, to, p, 'e');
          }
        } else if (t === 'N' || t === 'K') {
          for (const [dr, dc] of t === 'N' ? KNIGHT : KING) {
            if (!onBoard(r + dr, c + dc)) continue;
            const to = (r + dr) * 8 + c + dc;
            if (!b[to]) add(s, to, p, 'n');
            else if (colorOf(b[to]) === them) add(s, to, p, 'c');
          }
          if (t === 'K') {
            const row = us === 'w' ? 7 : 0, kSide = us === 'w' ? 'K' : 'k', qSide = us === 'w' ? 'Q' : 'q';
            if (s === row * 8 + 4 && !this.attacked(s, them)) {
              if (this.castling[kSide] && !b[row * 8 + 5] && !b[row * 8 + 6] && b[row * 8 + 7] === (us === 'w' ? 'R' : 'r')
                && !this.attacked(row * 8 + 5, them) && !this.attacked(row * 8 + 6, them)) add(s, row * 8 + 6, p, 'k');
              if (this.castling[qSide] && !b[row * 8 + 3] && !b[row * 8 + 2] && !b[row * 8 + 1] && b[row * 8] === (us === 'w' ? 'R' : 'r')
                && !this.attacked(row * 8 + 3, them) && !this.attacked(row * 8 + 2, them)) add(s, row * 8 + 2, p, 'q');
            }
          }
        } else {
          const dirs = t === 'B' ? DIAG : t === 'R' ? ORTHO : DIAG.concat(ORTHO);
          for (const [dr, dc] of dirs) {
            let rr = r + dr, cc = c + dc;
            while (onBoard(rr, cc)) {
              const to = rr * 8 + cc;
              if (!b[to]) add(s, to, p, 'n');
              else { if (colorOf(b[to]) === them) add(s, to, p, 'c'); break; }
              rr += dr; cc += dc;
            }
          }
        }
      }
      return moves;
    }

    makeMove(m) {
      const b = this.board, us = this.turn;
      this.stack.push({ m, castling: { ...this.castling }, ep: this.ep, halfmove: this.halfmove, fullmove: this.fullmove });
      b[m.to] = m.promotion || m.piece;
      b[m.from] = null;
      if (m.flags === 'e') b[m.to + (us === 'w' ? 8 : -8)] = null;
      if (m.flags === 'k') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = null; }
      if (m.flags === 'q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = null; }
      // castling rights
      if (typeOf(m.piece) === 'K') { if (us === 'w') this.castling.K = this.castling.Q = false; else this.castling.k = this.castling.q = false; }
      const touch = (sq) => {
        if (sq === 63) this.castling.K = false; if (sq === 56) this.castling.Q = false;
        if (sq === 7) this.castling.k = false; if (sq === 0) this.castling.q = false;
      };
      touch(m.from); touch(m.to);
      this.ep = m.flags === 'b' ? (m.from + m.to) / 2 : -1;
      this.halfmove = typeOf(m.piece) === 'P' || m.captured ? 0 : this.halfmove + 1;
      if (us === 'b') this.fullmove++;
      this.turn = us === 'w' ? 'b' : 'w';
    }

    unmakeMove() {
      const st = this.stack.pop(); if (!st) return null;
      const { m } = st, b = this.board;
      this.turn = this.turn === 'w' ? 'b' : 'w';
      const us = this.turn;
      b[m.from] = m.piece;
      b[m.to] = m.flags === 'e' ? null : m.captured;
      if (m.flags === 'e') b[m.to + (us === 'w' ? 8 : -8)] = m.captured;
      if (m.flags === 'k') { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = null; }
      if (m.flags === 'q') { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = null; }
      this.castling = st.castling; this.ep = st.ep; this.halfmove = st.halfmove; this.fullmove = st.fullmove;
      return m;
    }

    legalMoves() {
      const us = this.turn, out = [];
      for (const m of this.pseudoMoves()) {
        this.makeMove(m);
        if (!this.inCheck(us)) out.push(m);
        this.unmakeMove();
      }
      return out;
    }

    san(m, legal) {
      legal = legal || this.legalMoves();
      let s;
      if (m.flags === 'k') s = 'O-O';
      else if (m.flags === 'q') s = 'O-O-O';
      else {
        const t = typeOf(m.piece);
        s = '';
        if (t === 'P') { if (m.captured) s = FILES[m.from & 7]; }
        else {
          s = t;
          const rivals = legal.filter((o) => o.to === m.to && o.from !== m.from && o.piece === m.piece);
          if (rivals.length) {
            const sameFile = rivals.some((o) => (o.from & 7) === (m.from & 7));
            const sameRank = rivals.some((o) => (o.from >> 3) === (m.from >> 3));
            if (!sameFile) s += FILES[m.from & 7];
            else if (!sameRank) s += 8 - (m.from >> 3);
            else s += sqName(m.from);
          }
        }
        if (m.captured) s += 'x';
        s += sqName(m.to);
        if (m.promotion) s += '=' + typeOf(m.promotion);
      }
      this.makeMove(m);
      if (this.inCheck()) s += this.legalMoves().length ? '+' : '#';
      this.unmakeMove();
      return s;
    }

    /* Play a move for real (keeps SAN history and repetition counts). Accepts a move object,
       a SAN string ("Nf3"), or coordinates ("e2e4", "e7e8q"). Returns the move with .san, or null. */
    move(input) {
      const legal = this.legalMoves();
      let m = null;
      if (typeof input === 'object') {
        m = legal.find((o) => o.from === input.from && o.to === input.to
          && (!o.promotion || typeOf(o.promotion) === typeOf(input.promotion || 'Q')));
      } else {
        const txt = String(input).trim();
        const clean = (x) => x.replace(/[+#?!]/g, '').replace(/0/g, 'O').toLowerCase();
        m = legal.find((o) => clean(this.san(o, legal)) === clean(txt));
        if (!m && /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(txt)) {
          const from = sqIndex(txt.slice(0, 2).toLowerCase()), to = sqIndex(txt.slice(2, 4).toLowerCase());
          const promo = txt[4] ? txt[4].toUpperCase() : 'Q';
          m = legal.find((o) => o.from === from && o.to === to && (!o.promotion || typeOf(o.promotion) === promo));
        }
      }
      if (!m) return null;
      const san = this.san(m, legal);
      this.makeMove(m);
      this._bump(this.key(), 1);
      this.sanHistory.push(san);
      const played = { ...m, san, fromName: sqName(m.from), toName: sqName(m.to) };
      this.moveHistory.push(played);
      return played;
    }

    undo() {
      if (!this.moveHistory.length) return null;
      this._bump(this.key(), -1);
      this.unmakeMove();
      this.sanHistory.pop();
      return this.moveHistory.pop();
    }

    insufficientMaterial() {
      const others = [];
      for (let s = 0; s < 64; s++) {
        const p = this.board[s];
        if (p && typeOf(p) !== 'K') others.push({ t: typeOf(p), s });
      }
      if (others.length === 0) return true;
      if (others.length === 1 && (others[0].t === 'N' || others[0].t === 'B')) return true;
      if (others.every((o) => o.t === 'B')) {
        const shade = (s) => ((s >> 3) + (s & 7)) % 2;
        return others.every((o) => shade(o.s) === shade(others[0].s));
      }
      return false;
    }

    /* null while the game is on; otherwise { over: true, result: '1-0'|'0-1'|'1/2-1/2', reason } */
    status() {
      const legal = this.legalMoves();
      if (!legal.length) {
        if (this.inCheck()) return { over: true, result: this.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
        return { over: true, result: '1/2-1/2', reason: 'stalemate' };
      }
      if (this.insufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient' };
      if (this.halfmove >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty_move' };
      if ((this.repetition.get(this.key()) || 0) >= 3) return { over: true, result: '1/2-1/2', reason: 'threefold' };
      return null;
    }

    pgn() {
      const parts = [];
      this.sanHistory.forEach((s, i) => { if (i % 2 === 0) parts.push(`${i / 2 + 1}.`); parts.push(s); });
      return parts.join(' ');
    }

    perft(depth) {
      if (depth === 0) return 1;
      let n = 0;
      for (const m of this.legalMoves()) { this.makeMove(m); n += this.perft(depth - 1); this.unmakeMove(); }
      return n;
    }
  }

  /* Replay a move list (SAN, space separated, move numbers allowed). Returns the Game or null if any move is illegal. */
  function replay(pgn) {
    const g = new Game();
    const tokens = String(pgn || '').split(/\s+/).filter((t) => t && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
    for (const t of tokens) if (!g.move(t.replace(/^\d+\.+/, ''))) return null;
    return g;
  }

  const api = { Game, replay, START_FEN, sqName, sqIndex, colorOf, typeOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SBRules = api;
})(typeof self !== 'undefined' ? self : this);
