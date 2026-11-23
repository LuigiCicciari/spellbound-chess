-- Spellbound Chess v1.1 database update: the daily puzzle. Run once in Supabase → SQL Editor (after v1.0).
--
-- One row per player per puzzle day. Only the "puzzle" Edge Function can write it: it checks the moves against
-- the solution, and the database keeps the clock (started_at is set by the server when the puzzle opens), so
-- times can't be typed in. Players who pick a name for puzzles only get a players row like everyone else.

create table if not exists public.puzzle_results (
  player_id   uuid not null references public.players (player_id),
  day         integer not null,                 -- puzzle number: 1 = 23 Nov 2026 (UTC)
  puzzle_id   text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ms          integer,                          -- finished_at - started_at, set by the server
  mistakes    integer,
  solved      boolean,
  primary key (player_id, day)
);
alter table public.puzzle_results enable row level security;   -- no policies: browsers can't read or write it directly
revoke all on public.puzzle_results from anon, authenticated;

-- today's (or any day's) standings: solved only, hidden players left out
create or replace view public.puzzle_board with (security_invoker = false) as
  select r.day, r.player_id, p.handle, r.ms, r.mistakes,
         rank() over (partition by r.day order by (r.mistakes = 0) desc, r.ms asc) as rank
  from public.puzzle_results r join public.players p on p.player_id = r.player_id
  where r.solved and not p.hidden;
grant select on public.puzzle_board to anon, authenticated;

-- a player's finished days (for streaks and the MINE view); readable by anyone, like games
create or replace view public.puzzle_history with (security_invoker = false) as
  select r.player_id, r.day, r.solved, r.ms, r.mistakes from public.puzzle_results r where r.finished_at is not null;
grant select on public.puzzle_history to anon, authenticated;

-- days solved in a row, ending at p_day (or the day before, if p_day isn't solved yet)
create or replace function public.puzzle_streak(p_player_id uuid, p_day integer) returns integer
language sql stable security definer set search_path = public as $$
  with solved as (select day from public.puzzle_results where player_id = p_player_id and solved),
       anchor as (select case when exists (select 1 from solved where day = p_day) then p_day else p_day - 1 end as d)
  select count(*)::int from (
    select day, (select d from anchor) - row_number() over (order by day desc) + 1 as k
    from solved where day <= (select d from anchor)
  ) t where day = k;
$$;

create or replace function public.puzzle_player(p_player_id uuid, p_secret text, p_handle text, p_start_rating integer)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare p record; hash text;
begin
  if p_secret is null or length(p_secret) < 24 then raise exception 'missing player secret'; end if;
  hash := encode(digest(p_secret, 'sha256'), 'hex');
  select * into p from public.players where player_id = p_player_id;
  if not found then
    if public.bad_handle(p_handle) then raise exception 'please pick a different name'; end if;
    insert into public.players (player_id, secret_hash, handle, start_rating, rating)
    values (p_player_id, hash, p_handle,
            case when p_start_rating in (400, 800, 1200) then p_start_rating else 800 end,
            case when p_start_rating in (400, 800, 1200) then p_start_rating else 800 end);
  elsif p.secret_hash is null or p.secret_hash <> hash then
    raise exception 'this player belongs to another browser';
  end if;
end $$;

-- opening the puzzle starts the server's clock (only the first open counts)
create or replace function public.puzzle_start(p_player_id uuid, p_secret text, p_handle text, p_start_rating integer,
                                               p_day integer, p_puzzle_id text)
returns json language plpgsql security definer set search_path = public as $$
declare r record; recent integer;
begin
  perform public.puzzle_player(p_player_id, p_secret, p_handle, p_start_rating);
  select count(*) into recent from public.puzzle_results where started_at > now() - interval '1 minute';
  if recent >= 120 then raise exception 'the leaderboard is busy, try again in a minute'; end if;
  insert into public.puzzle_results (player_id, day, puzzle_id) values (p_player_id, p_day, p_puzzle_id)
  on conflict (player_id, day) do nothing;
  select * into r from public.puzzle_results where player_id = p_player_id and day = p_day;
  return json_build_object('started_at', r.started_at, 'finished', r.finished_at is not null, 'solved', r.solved,
                           'ms', r.ms, 'mistakes', r.mistakes);
end $$;

-- finishing records the result once; the time is the server's
create or replace function public.puzzle_finish(p_player_id uuid, p_secret text, p_day integer, p_solved boolean, p_mistakes integer)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare r record; place integer; total integer;
begin
  if p_secret is null or not exists (select 1 from public.players where player_id = p_player_id
                                     and secret_hash = encode(digest(p_secret, 'sha256'), 'hex')) then
    raise exception 'player not found or not yours';
  end if;
  update public.puzzle_results
     set finished_at = now(), solved = p_solved, mistakes = greatest(0, least(p_mistakes, 99)),
         ms = least(2147483647, (extract(epoch from now() - started_at) * 1000)::bigint)::int
   where player_id = p_player_id and day = p_day and finished_at is null;
  select * into r from public.puzzle_results where player_id = p_player_id and day = p_day;
  if not found then raise exception 'open the puzzle first'; end if;
  select rank, (select count(*) from public.puzzle_board where day = p_day) into place, total
    from public.puzzle_board where day = p_day and player_id = p_player_id;
  return json_build_object('solved', r.solved, 'ms', r.ms, 'mistakes', r.mistakes, 'rank', place, 'of', total,
                           'streak', public.puzzle_streak(p_player_id, p_day));
end $$;

revoke all on function public.puzzle_player(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.puzzle_start(uuid, text, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.puzzle_finish(uuid, text, integer, boolean, integer) from public, anon, authenticated;
grant execute on function public.puzzle_start(uuid, text, text, integer, integer, text) to service_role;
grant execute on function public.puzzle_finish(uuid, text, integer, boolean, integer) to service_role;
grant execute on function public.puzzle_streak(uuid, integer) to anon, authenticated, service_role;
