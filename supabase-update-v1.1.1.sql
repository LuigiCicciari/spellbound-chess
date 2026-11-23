-- Spellbound Chess v1.1.1 database update (after v1.1). Safe to run more than once.
--  * A solved puzzle needs at least 3 seconds on the server's clock from opening to finishing (the stones' setup move
--    alone takes longer to play), which stops the crudest scripted "solved in 0.2 s" submissions. It can't stop
--    someone who reads the solution and waits: the leaderboard is for fun, not proof.
--  * puzzle_history leaves out hidden players, like the other public views.

create or replace view public.puzzle_history with (security_invoker = false) as
  select r.player_id, r.day, r.solved, r.ms, r.mistakes
  from public.puzzle_results r join public.players p on p.player_id = r.player_id
  where r.finished_at is not null and not p.hidden;
grant select on public.puzzle_history to anon, authenticated;

create or replace function public.puzzle_finish(p_player_id uuid, p_secret text, p_day integer, p_solved boolean, p_mistakes integer)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare r record; place integer; total integer;
begin
  if p_secret is null or not exists (select 1 from public.players where player_id = p_player_id
                                     and secret_hash = encode(digest(p_secret, 'sha256'), 'hex')) then
    raise exception 'player not found or not yours';
  end if;
  if p_solved and exists (select 1 from public.puzzle_results where player_id = p_player_id and day = p_day
                          and finished_at is null and now() - started_at < interval '3 seconds') then
    raise exception 'that was too fast to be real';
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

revoke all on function public.puzzle_finish(uuid, text, integer, boolean, integer) from public, anon, authenticated;
grant execute on function public.puzzle_finish(uuid, text, integer, boolean, integer) to service_role;
