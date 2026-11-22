-- Spellbound Chess v0.5 update: a secure, server-side leaderboard.
-- Run once in Supabase (SQL Editor -> New query -> paste all of this -> Run). Keeps every saved game.
--
-- What changes:
--  * Games are saved only through submit_game(), which checks the player's secret, works out the opponent's
--    rating from the level (never from what the browser sends), applies rate limits and sanity checks,
--    and updates that player's rating on the server.
--  * A players table holds each player's current rating, so the page no longer downloads every game.
--  * Visitors can still read games and the leaderboard, but can no longer insert rows directly.

create extension if not exists pgcrypto;

-- 1. Players ------------------------------------------------------------------------------------
create table if not exists public.players (
  player_id     uuid primary key,
  secret_hash   text,                       -- sha256 of the browser's secret; null = not claimed yet
  handle        text not null check (handle ~ '^[A-Za-z0-9_]{3,16}$'),
  start_rating  smallint not null default 1200,
  rating        real not null,
  games         integer not null default 0,
  wins          integer not null default 0,
  draws         integer not null default 0,
  losses        integer not null default 0,
  best_level    smallint not null default 0,
  reached_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists players_rating_idx on public.players (rating desc);

alter table public.games add column if not exists rating_before real;
alter table public.games add column if not exists rating_after real;

-- 2. Rules shared by the backfill and by submit_game ---------------------------------------------
create or replace function public.level_elo(p_level integer) returns integer
language sql immutable as $$
  select case p_level when 1 then 400 when 2 then 800 when 3 then 1200 when 4 then 1600
                      when 5 then 2000 when 6 then 2400 when 7 then 2800 end;
$$;

create or replace function public.k_factor(p_games integer) returns real
language sql immutable as $$
  select case when p_games < 10 then 60 when p_games < 20 then 40 else 20 end::real;
$$;

-- 3. Backfill: rebuild every existing player's rating from their saved games, oldest first ----------
do $$
declare g record; p record; r_before real; r_after real; e real; s real;
begin
  for g in select * from public.games order by created_at asc loop
    select * into p from public.players where player_id = g.player_id;
    if not found then
      insert into public.players (player_id, handle, start_rating, rating)
      values (g.player_id, g.handle, coalesce(g.start_rating, 1200), coalesce(g.start_rating, 1200))
      returning * into p;
    end if;
    r_before := p.rating;
    e := 1 / (1 + power(10, (public.level_elo(g.level) - r_before) / 400.0));
    s := case g.result when 'W' then 1 when 'D' then 0.5 else 0 end;
    r_after := greatest(100, r_before + public.k_factor(p.games) * (s - e));
    update public.games set engine_elo = public.level_elo(g.level), rating_before = r_before, rating_after = r_after where id = g.id;
    update public.players set rating = r_after, games = games + 1, handle = g.handle,
      wins = wins + (g.result = 'W')::int, draws = draws + (g.result = 'D')::int, losses = losses + (g.result = 'L')::int,
      best_level = case when g.result = 'W' then greatest(best_level, g.level) else best_level end,
      reached_at = case when r_after > r_before then g.created_at else reached_at end
    where player_id = g.player_id;
  end loop;
end $$;

-- 4. Saving a game ------------------------------------------------------------------------------
create or replace function public.submit_game(
  p_player_id uuid, p_secret text, p_handle text, p_level integer, p_player_color text, p_result text,
  p_termination text, p_ply_count integer, p_pgn text, p_start_rating integer, p_clock text, p_app_version text
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p record; hash text; r_before real; r_after real; e real; s real; recent integer;
begin
  if p_secret is null or length(p_secret) < 24 then raise exception 'missing player secret'; end if;
  hash := encode(digest(p_secret, 'sha256'), 'hex');
  -- sanity checks the database can do without knowing chess
  if p_level not between 1 and 7 then raise exception 'bad level'; end if;
  if p_ply_count < 2 then raise exception 'game too short to rate'; end if;
  if p_termination = 'draw_agreed' and p_ply_count < 40 then raise exception 'draws need 20 moves'; end if;
  if p_termination = 'checkmate' and p_ply_count < 4 then raise exception 'impossible checkmate'; end if;
  if length(p_pgn) > p_ply_count * 9 + 40 then raise exception 'move list too long for the move count'; end if;
  -- rate limits: 3 games a minute, 60 an hour, per player
  select count(*) into recent from public.games where player_id = p_player_id and created_at > now() - interval '1 minute';
  if recent >= 3 then raise exception 'too many games, slow down'; end if;
  select count(*) into recent from public.games where player_id = p_player_id and created_at > now() - interval '1 hour';
  if recent >= 60 then raise exception 'hourly game limit reached'; end if;
  -- a site-wide brake so nobody can flood the table by inventing new players
  select count(*) into recent from public.games where created_at > now() - interval '1 minute';
  if recent >= 120 then raise exception 'the leaderboard is busy, try again in a minute'; end if;

  select * into p from public.players where player_id = p_player_id for update;
  if not found then
    insert into public.players (player_id, secret_hash, handle, start_rating, rating)
    values (p_player_id, hash, p_handle,
            case when p_start_rating in (400, 800, 1200) then p_start_rating else 800 end,
            case when p_start_rating in (400, 800, 1200) then p_start_rating else 800 end)
    returning * into p;
  elsif p.secret_hash is null then
    update public.players set secret_hash = hash where player_id = p_player_id returning * into p;  -- first claim of a pre-v0.5 player
  elsif p.secret_hash <> hash then
    raise exception 'this player belongs to another browser';
  end if;

  r_before := p.rating;
  e := 1 / (1 + power(10, (public.level_elo(p_level) - r_before) / 400.0));
  s := case p_result when 'W' then 1 when 'D' then 0.5 else 0 end;
  r_after := greatest(100, r_before + public.k_factor(p.games) * (s - e));

  insert into public.games (player_id, handle, level, engine_elo, player_color, result, termination, ply_count, pgn,
                            app_version, start_rating, clock, rating_before, rating_after)
  values (p_player_id, p_handle, p_level, public.level_elo(p_level), p_player_color, p_result, p_termination, p_ply_count, p_pgn,
          left(p_app_version, 20), p.start_rating, p_clock, r_before, r_after);

  update public.players set rating = r_after, games = games + 1, handle = p_handle,
    wins = wins + (p_result = 'W')::int, draws = draws + (p_result = 'D')::int, losses = losses + (p_result = 'L')::int,
    best_level = case when p_result = 'W' then greatest(best_level, p_level) else best_level end,
    reached_at = case when r_after > r_before then now() else reached_at end
  where player_id = p_player_id;

  return json_build_object('rating_before', r_before, 'rating_after', r_after, 'games', p.games + 1);
end $$;

-- 5. Renaming (also needs the secret) ------------------------------------------------------------
create or replace function public.rename_player(p_player_id uuid, p_secret text, p_handle text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.players set handle = p_handle
  where player_id = p_player_id and secret_hash = encode(digest(p_secret, 'sha256'), 'hex');
  if not found then raise exception 'player not found or not yours'; end if;
end $$;

-- 6. Today's biggest climbers ---------------------------------------------------------------------
create or replace view public.today_board with (security_invoker = true) as
  select g.player_id, p.handle, sum(g.rating_after - g.rating_before)::real as gain, count(*)::int as games
  from public.games g join public.players p on p.player_id = g.player_id
  where g.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
  group by g.player_id, p.handle;

-- 7. Who can do what ------------------------------------------------------------------------------
alter table public.players enable row level security;
drop policy if exists "anyone can read players" on public.players;
create policy "anyone can read players" on public.players for select to anon, authenticated using (true);
revoke all on public.players from anon, authenticated;
grant select (player_id, handle, start_rating, rating, games, wins, draws, losses, best_level, reached_at, created_at)
  on public.players to anon, authenticated;              -- secret_hash stays hidden

drop policy if exists "anyone can add a game" on public.games;   -- no more direct inserts
revoke insert, update, delete on public.games from anon, authenticated;
grant select on public.games to anon, authenticated;
grant select on public.today_board to anon, authenticated;

revoke all on function public.submit_game(uuid, text, text, integer, text, text, text, integer, text, integer, text, text) from public;
revoke all on function public.rename_player(uuid, text, text) from public;
grant execute on function public.submit_game(uuid, text, text, integer, text, text, text, integer, text, integer, text, text) to anon, authenticated;
grant execute on function public.rename_player(uuid, text, text) to anon, authenticated;
