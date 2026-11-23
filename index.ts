// Spellbound Chess: submit-game (Supabase Edge Function)
//
// Every rated game now comes through here. It replays the moves with the game's own rules and refuses a game
// whose moves are illegal, whose move count doesn't match, or whose result doesn't fit the final position
// (a claimed checkmate must really be checkmate, by the right side). Only then does it pass the game on to the
// submit_game database function, using the server-only service key, so the database no longer accepts saves
// straight from browsers.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → Via Editor, name it  submit-game ,
// paste this whole file, Deploy. Then in the function's Settings turn OFF "Enforce JWT verification"
// (the game sends the public publishable key, which isn't a JWT; this function checks it itself).

const RULES_HOST: Record<string, any> = {};
// ---- the game's chess rules (copied from rules.js) ----
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
        // Normalize without losing case: "Bxc6" (bishop) and "bxc6" (b-pawn) are different moves.
        const norm = (x) => x.replace(/[+#?!]/g, '').replace(/e\.p\./gi, '').replace(/0/g, 'O').replace(/\s+/g, '')
          .replace(/^([a-h](?:x[a-h])?[18])=?([QRBNqrbn])$/, (mm, sq, p) => `${sq}=${p.toUpperCase()}`);
        const sans = legal.map((o) => [o, norm(this.san(o, legal))]);
        const want = norm(txt);
        m = (sans.find(([, s]) => s === want) || [])[0] || null;
        if (!m) { // forgiving fallback for casual typing ("nf3", "o-o"), only when it can mean exactly one move
          const loose = sans.filter(([, s]) => s.toLowerCase() === want.toLowerCase());
          if (loose.length === 1) m = loose[0][0];
        }
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

    /* Squares the piece on sq attacks (pins ignored): used to show which pieces just came under threat. */
    attacksFrom(sq) {
      const p = this.board[sq]; if (!p) return [];
      const r = sq >> 3, c = sq & 7, t = typeOf(p), col = colorOf(p), out = [];
      const push = (rr, cc) => { if (onBoard(rr, cc)) out.push(rr * 8 + cc); };
      if (t === 'P') { const dir = col === 'w' ? -1 : 1; push(r + dir, c - 1); push(r + dir, c + 1); }
      else if (t === 'N' || t === 'K') for (const [dr, dc] of t === 'N' ? KNIGHT : KING) push(r + dr, c + dc);
      else {
        const dirs = t === 'B' ? DIAG : t === 'R' ? ORTHO : DIAG.concat(ORTHO);
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (onBoard(rr, cc)) { out.push(rr * 8 + cc); if (this.board[rr * 8 + cc]) break; rr += dr; cc += dc; }
        }
      }
      return out;
    }

    /* False when this side has only a king, or king plus one bishop or knight: it can never checkmate.
       (Used so a player who runs out of time draws instead of losing when the opponent can't win.) */
    canMate(color) {
      const mine = this.board.filter((p) => p && colorOf(p) === color && typeOf(p) !== 'K').map(typeOf);
      if (mine.length === 0) return false;
      if (mine.length === 1 && (mine[0] === 'B' || mine[0] === 'N')) return false;
      return true;
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
})(RULES_HOST);

// ---- end of rules ----

const { Game } = RULES_HOST.SBRules;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, content-type, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// The publishable key the game uses; requests without it are turned away. (Set it as a secret if you rotate it.)
const PUBLIC_KEY = Deno.env.get('SPELLBOUND_PUBLIC_KEY') || 'sb_publishable_zT-gV7iMkd6PRbAbU0WGGA_MJBMTk5K';
const DECIDED = { checkmate: true, stalemate: true, threefold: true, fifty_move: true, insufficient: true } as Record<string, boolean>;

function check(b: any): string | null {
  if (!b || typeof b.p_pgn !== 'string' || b.p_pgn.length > 10000) return 'missing moves';
  if (b.p_player_color !== 'w' && b.p_player_color !== 'b') return 'bad colour';
  const g = new Game();
  const tokens = b.p_pgn.replace(/\{[^}]*\}/g, ' ').split(/\s+/)
    .filter((t: string) => t && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  for (const raw of tokens) {
    if (!g.move(raw.replace(/^\d+\.+/, ''))) return 'illegal move: ' + raw.slice(0, 12);
  }
  if (tokens.length !== Number(b.p_ply_count)) return 'move count does not match';
  const st = g.status();                       // { over, result: '1-0' | '0-1' | '1/2-1/2', reason } or null
  const term = String(b.p_termination || '');
  if (DECIDED[term]) {
    if (!st || st.reason !== term) return `the final position is not ${term.replace('_', ' ')}`;
    const playerWon = (st.result === '1-0' && b.p_player_color === 'w') || (st.result === '0-1' && b.p_player_color === 'b');
    const want = st.result === '1/2-1/2' ? 'D' : playerWon ? 'W' : 'L';
    if (b.p_result !== want) return 'the result does not match the final position';
  } else if (st) {
    return 'the game was already over';        // resign / timeout / agreed draw can't come after the end
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { message: 'POST only' });
  if ((req.headers.get('apikey') || '') !== PUBLIC_KEY) return reply(401, { message: 'unknown client' });
  let body: any;
  try { body = await req.json(); } catch { return reply(400, { message: 'bad request' }); }
  const problem = check(body);
  if (problem) return reply(400, { message: 'Game not accepted: ' + problem });

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const res = await fetch(`${url}/rest/v1/rpc/submit_game`, {
    method: 'POST',
    headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { ...cors, 'Content-Type': 'application/json' } });
});
