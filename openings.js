/* Spellbound Chess: opening names. The longest listed move sequence that the game starts with names the opening.
   Moves are in SAN without check marks. A small hand-picked list of well-known openings, not a full ECO table. */
(function (root) {
  'use strict';
  const LIST = [
    // 1.e4 e5
    ['e4', "King's Pawn Opening"],
    ['e4 e5', 'Open Game'],
    ['e4 e5 Nf3', "King's Knight Opening"],
    ['e4 e5 Nf3 Nc6 Bb5', 'Ruy Lopez'],
    ['e4 e5 Nf3 Nc6 Bb5 a6', 'Ruy Lopez: Morphy Defense'],
    ['e4 e5 Nf3 Nc6 Bb5 Nf6', 'Ruy Lopez: Berlin Defense'],
    ['e4 e5 Nf3 Nc6 Bc4', 'Italian Game'],
    ['e4 e5 Nf3 Nc6 Bc4 Bc5', 'Italian Game: Giuoco Piano'],
    ['e4 e5 Nf3 Nc6 Bc4 Bc5 b4', 'Italian Game: Evans Gambit'],
    ['e4 e5 Nf3 Nc6 Bc4 Nf6', 'Italian Game: Two Knights Defense'],
    ['e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5', 'Two Knights Defense: Knight Attack'],
    ['e4 e5 Nf3 Nc6 d4', 'Scotch Game'],
    ['e4 e5 Nf3 Nc6 Nc3', 'Three Knights Opening'],
    ['e4 e5 Nf3 Nc6 Nc3 Nf6', 'Four Knights Game'],
    ['e4 e5 Nf3 Nc6 c3', 'Ponziani Opening'],
    ['e4 e5 Nf3 Nf6', "Petrov's Defense"],
    ['e4 e5 Nf3 d6', 'Philidor Defense'],
    ['e4 e5 Nf3 f5', 'Latvian Gambit'],
    ['e4 e5 f4', "King's Gambit"],
    ['e4 e5 f4 exf4', "King's Gambit Accepted"],
    ['e4 e5 Nc3', 'Vienna Game'],
    ['e4 e5 Bc4', "Bishop's Opening"],
    ['e4 e5 d4', 'Center Game'],
    ['e4 e5 Qh5', 'Wayward Queen Attack'],
    ['e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7', "Scholar's Mate"],
    ['e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7', "Scholar's Mate"],
    // 1.e4, other replies
    ['e4 c5', 'Sicilian Defense'],
    ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', 'Sicilian Defense: Najdorf Variation'],
    ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', 'Sicilian Defense: Dragon Variation'],
    ['e4 c5 Nf3 e6', 'Sicilian Defense: French Variation'],
    ['e4 c5 c3', 'Sicilian Defense: Alapin Variation'],
    ['e4 c5 Nc3', 'Sicilian Defense: Closed'],
    ['e4 c5 d4 cxd4 c3', 'Sicilian Defense: Smith-Morra Gambit'],
    ['e4 e6', 'French Defense'],
    ['e4 e6 d4 d5 e5', 'French Defense: Advance Variation'],
    ['e4 e6 d4 d5 exd5', 'French Defense: Exchange Variation'],
    ['e4 e6 d4 d5 Nc3 Bb4', 'French Defense: Winawer Variation'],
    ['e4 e6 d4 d5 Nd2', 'French Defense: Tarrasch Variation'],
    ['e4 c6', 'Caro-Kann Defense'],
    ['e4 c6 d4 d5 e5', 'Caro-Kann Defense: Advance Variation'],
    ['e4 c6 d4 d5 exd5', 'Caro-Kann Defense: Exchange Variation'],
    ['e4 d5', 'Scandinavian Defense'],
    ['e4 d6', 'Pirc Defense'],
    ['e4 g6', 'Modern Defense'],
    ['e4 Nf6', "Alekhine's Defense"],
    ['e4 Nc6', 'Nimzowitsch Defense'],
    ['e4 b6', "Owen's Defense"],
    ['e4 a6', 'St. George Defense'],
    // 1.d4
    ['d4', "Queen's Pawn Opening"],
    ['d4 d5', "Queen's Pawn Game"],
    ['d4 d5 c4', "Queen's Gambit"],
    ['d4 d5 c4 dxc4', "Queen's Gambit Accepted"],
    ['d4 d5 c4 e6', "Queen's Gambit Declined"],
    ['d4 d5 c4 c6', 'Slav Defense'],
    ['d4 d5 c4 Nc6', 'Chigorin Defense'],
    ['d4 d5 Bf4', 'London System'],
    ['d4 d5 Nf3 Nf6 Bf4', 'London System'],
    ['d4 Nf6 Bf4', 'London System'],
    ['d4 d5 e4', 'Blackmar-Diemer Gambit'],
    ['d4 Nf6', 'Indian Defense'],
    ['d4 Nf6 Bg5', 'Trompowsky Attack'],
    ['d4 Nf6 c4 g6 Nc3 d5', 'Grünfeld Defense'],
    ['d4 Nf6 c4 g6 Nc3 Bg7', "King's Indian Defense"],
    ['d4 Nf6 c4 e6 Nc3 Bb4', 'Nimzo-Indian Defense'],
    ['d4 Nf6 c4 e6 Nf3 b6', "Queen's Indian Defense"],
    ['d4 Nf6 c4 c5', 'Benoni Defense'],
    ['d4 Nf6 c4 e5', 'Budapest Gambit'],
    ['d4 f5', 'Dutch Defense'],
    ['d4 e5', 'Englund Gambit'],
    // flank and rare first moves
    ['c4', 'English Opening'],
    ['c4 e5', 'English Opening: Reversed Sicilian'],
    ['Nf3', 'Zukertort Opening'],
    ['Nf3 d5 c4', 'Réti Opening'],
    ['g3', 'Hungarian Opening'],
    ['b3', 'Nimzo-Larsen Attack'],
    ['f4', "Bird's Opening"],
    ['Nc3', 'Van Geet Opening'],
    ['b4', 'Polish Opening'],
    ['e3', "Van 't Kruijs Opening"],
    ['d3', 'Mieses Opening'],
    ['g4', "Grob's Attack"],
    ['a3', "Anderssen's Opening"],
    ['h3', 'Clemenz Opening'],
    ['a4', 'Ware Opening'],
    ['h4', 'Kádas Opening'],
    ['f3', 'Barnes Opening'],
    ['f3 e5 g4 Qh4', "Fool's Mate"],
    ['f3 e6 g4 Qh4', "Fool's Mate"],
    ['f4 e5 g4 Qh4', "Fool's Mate"],
    ['f4 e6 g4 Qh4', "Fool's Mate"],
    ['Na3', 'Durkin Opening'],
    ['Nh3', 'Amar Opening'],
    ['c3', 'Saragossa Opening'],
  ];
  const MAP = new Map(LIST);
  const MAX = Math.max(...LIST.map(([k]) => k.split(' ').length));

  /* Name for a game's moves (an array of SAN strings), or '' before the first move. */
  function name(sans) {
    const clean = (sans || []).slice(0, MAX).map((s) => String(s).replace(/[+#!?]/g, ''));
    for (let n = clean.length; n > 0; n--) {
      const hit = MAP.get(clean.slice(0, n).join(' '));
      if (hit) return hit;
    }
    return '';
  }

  const api = { name, LIST };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SBOpenings = api;
})(typeof self !== 'undefined' ? self : this);
