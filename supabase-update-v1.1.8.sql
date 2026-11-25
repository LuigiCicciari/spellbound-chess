-- Spellbound Chess v1.1.8: "Delete my data" (needed for the app stores).
-- Run once in Supabase → SQL Editor, after the earlier update files. Safe to run again.
--
-- delete_player removes a player completely: their games, puzzle results, any feedback they sent, and the
-- player row itself (name, rating, hidden secret). It needs the same private secret as saving or renaming, so
-- nobody can delete someone else's data by knowing their player ID from the leaderboard.
-- p_client_id is the random id the browser uses for the feedback box; feedback sent before picking a name is
-- matched by it. A player ID the server has never seen just deletes that feedback (if any) and succeeds.

create or replace function public.delete_player(p_player_id uuid, p_secret text, p_client_id text default null)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  p public.players;
begin
  select * into p from public.players where player_id = p_player_id for update;
  if found then
    if p.secret_hash is null or p_secret is null or length(p_secret) < 24
       or p.secret_hash <> encode(digest(p_secret, 'sha256'), 'hex') then
      raise exception 'player not found or not yours';
    end if;
    delete from public.puzzle_results where player_id = p_player_id;
    delete from public.games where player_id = p_player_id;
    delete from public.feedback where player_id = p_player_id;
    delete from public.players where player_id = p_player_id;
  end if;
  if p_client_id is not null and length(p_client_id) between 8 and 64 then
    delete from public.feedback where client_id = p_client_id;
  end if;
end $$;

revoke all on function public.delete_player(uuid, text, text) from public;
grant execute on function public.delete_player(uuid, text, text) to anon, authenticated;
