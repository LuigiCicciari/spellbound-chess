-- Spellbound Chess v1.0 database update. Run once in Supabase → SQL Editor,
-- ONLY AFTER the submit-game Edge Function is deployed and the v1.0 site files are uploaded.
--
-- From now on, games can only be saved through the submit-game Edge Function, which replays every move
-- before the database rates the game. Browsers can no longer call submit_game directly.
-- (Renaming stays as it was: rename_player still checks the player's private key.)
-- Note: re-running supabase-update-v0.6.1.sql or v0.5.sql would give browsers direct access again; run this file after them.

revoke execute on function public.submit_game(uuid, text, text, integer, text, text, text, integer, text, integer, text, text) from anon, authenticated, public;
grant execute on function public.submit_game(uuid, text, text, integer, text, text, text, integer, text, integer, text, text) to service_role;
-- the function also checks whether it already saved this exact game (a retry after a lost reply)
grant select on public.games to service_role;

-- To undo (let browsers save directly again):
-- grant execute on function public.submit_game(uuid, text, text, integer, text, text, text, integer, text, integer, text, text) to anon, authenticated;
