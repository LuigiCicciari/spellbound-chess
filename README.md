# Spellbound Chess

Play chess against living stone pieces. They march square by square, wind up and strike, and shatter what they capture. Win games to raise your Elo rating and climb the leaderboard.

Built to be shown on Tableau Public through a Web Page object, with the game hosted here on GitHub Pages.

**Play:** https://luigicicciari.github.io/spellbound-chess/

## Features

- A 3D stone battlefield: original carved warriors that march, fight and shatter (flat 2D board as an automatic fallback; add `?flat` to the address to force it)
- Personality: every piece type has idle habits (pawns glance around, knights paw the ground, rooks settle their weight, bishops sway, the queen surveys the board, the king leans on his sword) and its own reaction when attacked (a pawn flinches, a knight rears, a rook braces, the queen squares up). Pieces also stand to attention, hesitate when sent into danger, celebrate captures, and the king kneels in surrender
- ▶ Watch mode: the computer plays itself so you can enjoy the battles without playing
- Seven computer levels, each 400 rating points apart: Apprentice (400), Adept (800), Master (1200) use the game's own engine; Archmage (1600), Grand Archmage (2000), Elder (2400), Eternal (2800) use Stockfish
- Optional clock (10 min, 5 min, 3 min + 2 s) shown in the board's corners; Normal / Fast / Cinematic animations (Cinematic swoops the camera in for big captures)
- Click, drag, or type moves (`Nf3`, `e2e4`)
- Animated moves, captures, promotions, castling and checkmate, with synthesized stone sound effects
- **Casual** and **Rated** modes. Casual is for practice: take back moves, ask Stockfish for a hint (shown as an arrow), and see which of your pieces are in danger (attacked and undefended, or attacked by a cheaper piece). Rated games count on the leaderboard. The mode is fixed once a game starts; newcomers start in Casual.
- 📜 **Battle report** after every game: Stockfish analyses each move (in the background, cached), then shows a chart of White's winning chances, your accuracy and the stones' (Lichess's formula and its 10/20/30-point inaccuracy/mistake/blunder thresholds), captures, your three costliest moves with the better move (Review jumps straight to the position, with ▶ buttons to play your move or the better one), your best move (one that matched Stockfish's first choice at an important moment) replayed with the cinematic camera, Copy PGN and Open in Lichess. Undo in Casual also puts the clocks back.
- Opening names in the move list (a hand-picked list of about 90 well-known openings) and in the battle report and PGN
- LEVELS leaderboard tab: who has beaten each computer level most often; win streaks in the rating tile
- Casual mode warns before a move that would stalemate the stones while you're ahead; a stalemate result explains what happened
- Rated games are checked on the server: the `submit-game` Edge Function (in `supabase/functions/submit-game/index.ts`) replays every move with the game's own rules before the database rates the game
- Clicking a tall piece picks that piece; clicking the same spot again picks a shorter piece hidden behind it
- Elo rating: the first time you finish a Rated game you pick a name and New (400), Sometimes (800) or A lot (1200); after that Rated games save automatically. Ratings move fastest for your first 10 games. ALL TIME, TODAY and MINE leaderboard tabs
- At levels 4–7 Stockfish decides whether to accept a draw offer (offers open after move 20)
- You pick the name that shows on the leaderboard and can change it with the ✎ button, which also shows a recovery code for using your rating on another device
- Works on phones: the board fills the screen width, the controls sit right under it, and the battle report opens full screen. In Tableau, add a Phone device layout holding the same Web Page object.
- Respects your system's reduced-motion setting
- 🧩 **Daily puzzle**: one position a day, the same for everyone (new at midnight UTC). The stones play their move, you find the winning line; a wrong move is a slip and you try again, and any move that gives checkmate counts. Mondays are easiest and Sundays hardest. You get your time, slips, a day streak and a result to share; named players appear on the PUZZLE leaderboard tab (first-try solves first, then fastest). The puzzle server checks the line and the database keeps the time from when the puzzle first opens (a solve under 3 seconds is refused), so a time can't simply be typed in. Slips are counted by the browser, and a determined cheater could still read the answer: the board is for fun, not proof

## Online leaderboard (optional)

Scores are kept in each player's browser until you connect a free [Supabase](https://supabase.com) project:

1. Create a project, open **SQL Editor**, paste `supabase.sql` and run it, then do the same with `supabase-update-v0.5.sql` and `supabase-update-v0.6.1.sql`. Deploy the Edge Function in `supabase/functions/submit-game/index.ts` (Edge Functions → Deploy a new function → Via Editor, name `submit-game`, turn off "Enforce JWT verification"), then run `supabase-update-v1.0.sql`. For the daily puzzle, run `supabase-update-v1.1.sql` and `-v1.1.1.sql` and deploy `supabase/functions/puzzle/index.ts` the same way (name `puzzle`, JWT verification off); it reads the puzzle list from this site's `puzzles.json`.
2. In **Project Settings → API Keys**, copy the **Publishable key** (starts with `sb_publishable_`) into `config.js`, and copy the **Project URL** from **Project Settings → Data API** (or the project's Connect screen).
3. Commit. The leaderboard chip changes from ○ LOCAL to ● LIVE.

The publishable key is safe to publish. Visitors can read the leaderboard but can't write to the tables directly: games are saved only through the `submit_game` function, which checks the player's private key (stored as a hash, never readable), sanity-checks the game, rate-limits saves, and calculates the Elo change on the server. Never put a secret key (`sb_secret_...`) or `service_role` key in this repo. To take someone off the leaderboard, open **Table Editor → players** and tick `hidden` on their row.

Each browser also replays its games' moves and refuses to submit any that are illegal or whose result doesn't match the final position.

## Files

| File | What it does |
|---|---|
| `index.html`, `style.css` | Page layout and dark stone theme |
| `rules.js` | Chess rules: legal moves, check, castling, en passant, promotion, draws |
| `engine.js`, `engine.worker.js` | The game's own computer opponent (levels 1–3), run off the main thread |
| `sf.js` | Runs Stockfish for levels 4–7 |
| `engine/` | Stockfish.js 17.1 lite single-threaded (`stockfish-17.1-lite-single-03e3232.js` + `.wasm`), GPLv3, from [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) |
| `supabase-update-v0.4.sql`, `-v0.5.sql`, `-v0.6.1.sql` | One-time database updates (v0.5 adds the players table and the secure save function; v0.6.1 checks that results match how the game ended, filters names on the server, and adds a `hidden` switch) |
| `render3d.js` | 3D board, original stone warriors and battle animation ([three.js](https://threejs.org), MIT, loaded from jsDelivr) |
| `render.js` | Flat SVG board, used when 3D isn't available |
| `audio.js` | Sound effects made with WebAudio (no audio files) |
| `ladder.js` | Saving games, verification, Elo, and the leaderboard |
| `main.js` | Game flow and controls |
| `config.js` | Supabase settings (empty = local mode) |
| `puzzles.json` | The daily puzzles: 1,092 days (156 weeks, to 18 Nov 2029, no repeats) from the [Lichess puzzle database](https://database.lichess.org/#puzzles) (public domain, CC0), rated 1000–1650, popularity 90+, 2,000+ plays, one per source game, each checked with the game's own rules. Day 1 = 23 Nov 2026 (UTC); the list repeats after the last day. Adding puzzles to the end never changes earlier days |
| `supabase/functions/` | Server-side checks: `submit-game` (replays rated games) and `puzzle` (checks puzzle solutions; the database times them) |
| `supabase-update-v1.0.sql`, `-v1.1.sql` | v1.0: only the Edge Function can save games. v1.1: puzzle results table, leaderboard view and streaks. v1.1.1: 3-second floor on solved times; hidden players left out of puzzle history |
| `supabase.sql` | Database table and access rules |

## Tableau Public

In Tableau Desktop Public Edition, make a dashboard at a fixed size of 1500 × 926, add a **Web Page** object that fills it, and point it at the Play link above. Then publish to Tableau Public.

## License

This game is released under the GNU General Public License v3 because it includes Stockfish (GPLv3).

## Credits

Piece designs, code and sounds are original. Daily puzzles come from the Lichess puzzle database, released into the public domain by Lichess. Stockfish © the Stockfish developers; Stockfish.js © Chess.com, LLC (GPLv3). Title font: [Cinzel](https://fonts.google.com/specimen/Cinzel) (SIL Open Font License), from Google Fonts.
