-- Spellbound Chess v0.6.1 database update. Run once in Supabase → SQL Editor, after v0.5.
-- 1. Results must fit how the game ended (resign = loss, draws = draw, no wins on time)
-- 2. Pre-v0.5 players can claim their ID until the end of 2026, then unclaimed IDs are locked
-- 3. Name filter on the server too
-- 4. A "hidden" switch for moderation: set it to true in Table Editor → players to remove someone from the leaderboard

-- 1. Name filter ---------------------------------------------------------------------------------
create or replace function public.bad_handle(h text) returns boolean
language sql immutable as $$
  select h is null or h !~ '^[A-Za-z0-9_]{3,16}$'
      or replace(lower(h), '_', '') ~ '(fuck|shit|cunt|nigg|fag|bitch|whore|rape|nazi|hitler|porn|dick|cock|pussy|slut|retard)'
$$;

create or replace function public.rename_player(p_player_id uuid, p_secret text, p_handle text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.bad_handle(p_handle) then raise exception 'please pick a different name'; end if;
  update public.players set handle = p_handle
  where player_id = p_player_id and secret_hash = encode(digest(p_secret, 'sha256'), 'hex');
  if not found then raise exception 'player not found or not yours'; end if;
end $$;

-- 2. Moderation switch ---------------------------------------------------------------------------
alter table public.players add column if not exists hidden boolean not null default false;
grant select (hidden) on public.players to anon, authenticated;

create or replace view public.today_board with (security_invoker = true) as
  select g.player_id, p.handle, sum(g.rating_after - g.rating_before)::real as gain, count(*)::int as games
  from public.games g join public.players p on p.player_id = g.player_id
  where g.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc' and not p.hidden
  group by g.player_id, p.handle;
grant select on public.today_board to anon, authenticated;

-- 3. Saving a game (same as v0.5 plus the checks above) ------------------------------------------
create or replace function public.submit_game(
  p_player_id uuid, p_secret text, p_handle text, p_level integer, p_player_color text, p_result text,
  p_termination text, p_ply_count integer, p_pgn text, p_start_rating integer, p_clock text, p_app_version text
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p record; hash text; r_before real; r_after real; e real; s real; recent integer;
begin
  if public.bad_handle(p_handle) then raise exception 'please pick a different name'; end if;
  if p_secret is null or length(p_secret) < 24 then raise exception 'missing player secret'; end if;
  hash := encode(digest(p_secret, 'sha256'), 'hex');
  -- sanity checks the database can do without knowing chess
  if p_level not between 1 and 7 then raise exception 'bad level'; end if;
  if p_ply_count < 2 then raise exception 'game too short to rate'; end if;
  if p_termination = 'draw_agreed' and p_ply_count < 40 then raise exception 'draws need 20 moves'; end if;
  if p_termination = 'checkmate' and p_ply_count < 4 then raise exception 'impossible checkmate'; end if;
  -- the result has to fit the way the game ended
  if p_result not in ('W', 'D', 'L') then raise exception 'bad result'; end if;
  if p_termination = 'resign' and p_result <> 'L' then raise exception 'only you can resign'; end if;
  if p_termination in ('stalemate', 'threefold', 'fifty_move', 'insufficient', 'draw_agreed') and p_result <> 'D' then raise exception 'that ending is a draw'; end if;
  if p_termination = 'checkmate' and p_result = 'D' then raise exception 'checkmate is not a draw'; end if;
  if p_termination = 'timeout' then
    if p_clock is null then raise exception 'no clock, no timeout'; end if;
    if p_result = 'W' then raise exception 'the stones never run out of time'; end if;  -- the computer moves in about a second
  end if;
  if p_termination = 'checkmate' and p_result = 'W' and p_level >= 4 and p_ply_count < 20 then raise exception 'too quick a win to rate'; end if;
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
  elsif p.secret_hash is null and now() < timestamptz '2027-01-01 00:00+00' then
    update public.players set secret_hash = hash where player_id = p_player_id returning * into p;  -- first claim of a pre-v0.5 player
  elsif p.secret_hash is null or p.secret_hash <> hash then
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

revoke all on function public.submit_game(uuid, text, text, integer, text, text, text, integer, text, integer, text, text) from public;
grant execute on function public.submit_game(uuid, text, text, integer, text, text, text, integer, text, integer, text, text) to anon, authenticated;
revoke all on function public.rename_player(uuid, text, text) from public;
grant execute on function public.rename_player(uuid, text, text) to anon, authenticated;
