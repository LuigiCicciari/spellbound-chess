-- Spellbound Chess: online ladder table for Supabase.
-- Run this once in your Supabase project: SQL Editor -> New query -> paste -> Run.
-- Visitors (using the public "publishable" key) can only READ and ADD games. They cannot change or delete anything.
-- To remove a bad name or a spam row, delete it in Table Editor -> games.

create table if not exists public.games (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null,
  handle        text not null check (handle ~ '^[A-Za-z0-9_]{3,16}$'),
  level         smallint not null check (level between 1 and 7),
  engine_elo    smallint not null check (engine_elo between 100 and 3000),
  player_color  text not null check (player_color in ('w', 'b')),
  result        text not null check (result in ('W', 'D', 'L')),
  termination   text not null check (termination in ('checkmate', 'resign', 'stalemate', 'threefold', 'fifty_move', 'insufficient', 'draw_agreed', 'timeout')),
  ply_count     smallint not null check (ply_count between 1 and 600),
  pgn           text not null check (char_length(pgn) < 10000),
  app_version   text check (char_length(app_version) <= 20),
  start_rating  smallint check (start_rating in (400, 800, 1200)),
  clock         text check (char_length(clock) <= 10),
  created_at    timestamptz not null default now()
);

create index if not exists games_created_at_idx on public.games (created_at);
create index if not exists games_player_idx on public.games (player_id);

-- The server always sets the time, so nobody can backdate a game.
create or replace function public.games_stamp_time() returns trigger language plpgsql as $$
begin
  new.created_at := now();
  return new;
end $$;
drop trigger if exists games_stamp_time on public.games;
create trigger games_stamp_time before insert on public.games for each row execute function public.games_stamp_time();

-- Row-level security: read and insert only.
alter table public.games enable row level security;

drop policy if exists "anyone can read games" on public.games;
create policy "anyone can read games" on public.games for select to anon, authenticated using (true);

drop policy if exists "anyone can add a game" on public.games;
create policy "anyone can add a game" on public.games for insert to anon, authenticated with check (true);

-- Give visitors read and add access to this one table (needed when "Grant API access to new tables" is off).
grant usage on schema public to anon, authenticated;
grant select, insert on public.games to anon, authenticated;

-- No update or delete policies exist, and no such grants, so those are refused for visitors.
revoke update, delete on public.games from anon, authenticated;
