# Spellbound Chess

Play chess against living stone pieces. They march square by square, wind up and strike, and shatter what they capture. Win games to raise your Elo rating and climb the ladder.

Built to be shown on Tableau Public through a Web Page object, with the game hosted here on GitHub Pages.

**Play:** https://luigicicciari.github.io/spellbound-chess/

## Features

- Four computer levels: Apprentice (600), Adept (1000), Master (1400), Archmage (1800)
- Click, drag, or type moves (`Nf3`, `e2e4`)
- Animated moves, captures, promotions, castling and checkmate, with synthesized stone sound effects
- Elo rating (everyone starts at 1200), with ALL TIME, TODAY and MINE ladder tabs
- You pick the name that shows on the ladder, and can change it with the ✎ button
- Respects your system's reduced-motion setting

## Online ladder (optional)

Scores are kept in each player's browser until you connect a free [Supabase](https://supabase.com) project:

1. Create a project, open **SQL Editor**, paste `supabase.sql`, and run it.
2. In **Project Settings → API Keys**, copy the **Publishable key** (starts with `sb_publishable_`) into `config.js`, and copy the **Project URL** from **Project Settings → Data API** (or the project's Connect screen).
3. Commit. The ladder chip changes from ○ LOCAL to ● LIVE.

The publishable key is safe to publish: the table only lets visitors read and add games. Never put a secret key (`sb_secret_...`) or `service_role` key in this repo. To remove a bad name, delete its rows in Supabase's Table Editor.

Ratings are never trusted from the browser. The ladder replays every saved game's moves, drops any that are illegal or whose result doesn't match the final position, and recalculates everyone's Elo from the games that remain.

## Files

| File | What it does |
|---|---|
| `index.html`, `style.css` | Page layout and dark stone theme |
| `rules.js` | Chess rules: legal moves, check, castling, en passant, promotion, draws |
| `engine.js`, `engine.worker.js` | Computer opponent (alpha-beta search), run off the main thread |
| `render.js` | SVG board, original piece drawings, and all animation |
| `audio.js` | Sound effects made with WebAudio (no audio files) |
| `ladder.js` | Saving games, verification, Elo, and the ladder |
| `main.js` | Game flow and controls |
| `config.js` | Supabase settings (empty = local mode) |
| `supabase.sql` | Database table and access rules |

## Tableau Public

In Tableau Desktop Public Edition, make a dashboard at a fixed size of 1500 × 926, add a **Web Page** object that fills it, and point it at the Play link above. Then publish to Tableau Public.

## Credits

Piece designs, code and sounds are original. Title font: [Cinzel](https://fonts.google.com/specimen/Cinzel) (SIL Open Font License), from Google Fonts.
