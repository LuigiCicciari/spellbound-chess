-- Spellbound Chess v0.4 update: run once in Supabase (SQL Editor -> New query -> paste -> Run).
-- Safe to run on the existing table: it keeps every saved game.
-- Adds levels 5-7 (Stockfish), losing on time, the player's starting rating and the clock setting.

alter table public.games drop constraint if exists games_level_check;
alter table public.games add constraint games_level_check check (level between 1 and 7);

alter table public.games drop constraint if exists games_termination_check;
alter table public.games add constraint games_termination_check
  check (termination in ('checkmate', 'resign', 'stalemate', 'threefold', 'fifty_move', 'insufficient', 'draw_agreed', 'timeout'));

alter table public.games add column if not exists start_rating smallint check (start_rating in (400, 800, 1200));
alter table public.games add column if not exists clock text check (char_length(clock) <= 10);
