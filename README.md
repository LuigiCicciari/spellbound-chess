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
- Elo rating: the first time you finish a game you pick a name and New (400), Casual (800) or A lot (1200); after that rated games save automatically. Ratings move fastest for your first 10 games. ALL TIME, TODAY and MINE leaderboard tabs
- At levels 4–7 Stockfish decides whether to accept a draw offer (offers open after move 20)
- You pick the name that shows on the leaderboard and can change it with the ✎ button, which also shows a recovery code for using your rating on another device
- Respects your system's reduced-motion setting

## Online leaderboard (optional)

Scores are kept in each player's browser until you connect a free [Supabase](https://supabase.com) project:

1. Create a project, open **SQL Editor**, paste `supabase.sql` and run it, then do the same with `supabase-update-v0.5.sql` and `supabase-update-v0.6.1.sql`.
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
| `supabase.sql` | Database table and access rules |

## Tableau Public

In Tableau Desktop Public Edition, make a dashboard at a fixed size of 1500 × 926, add a **Web Page** object that fills it, and point it at the Play link above. Then publish to Tableau Public.

## License

This game is released under the GNU General Public License v3 because it includes Stockfish (GPLv3).

## Credits

Piece designs, code and sounds are original. Stockfish © the Stockfish developers; Stockfish.js © Chess.com, LLC (GPLv3). Title font: [Cinzel](https://fonts.google.com/specimen/Cinzel) (SIL Open Font License), from Google Fonts.
