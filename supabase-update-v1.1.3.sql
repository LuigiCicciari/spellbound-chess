-- Spellbound Chess v1.1.3 database update: the "Send feedback" box. Run once in Supabase → SQL Editor.
--
-- Feedback is private: browsers can send it but nobody can read it back through the site (no select grant, no
-- policies). Read it in Supabase → Table Editor → feedback, or with the SQL at the bottom of this file.
-- Limits: 1,000 characters a message, 5 a day from one browser, 30 a minute site-wide.

create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  message     text not null check (length(message) between 2 and 1000),
  name        text check (name is null or length(name) <= 40),
  client_id   text not null check (length(client_id) between 8 and 64),   -- a random id kept in the browser, for the limits
  player_id   uuid,                                                        -- set only when the sender has a leaderboard name
  where_from  text check (where_from is null or length(where_from) <= 20), -- help / game / puzzle
  app_version text check (app_version is null or length(app_version) <= 20),
  context     jsonb check (context is null or length(context::text) <= 2000),
  done        boolean not null default false                               -- tick when you've dealt with it
);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

create or replace function public.submit_feedback(p_message text, p_name text, p_client_id text, p_player_id uuid,
                                                  p_where text, p_app_version text, p_context jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  p_message := btrim(coalesce(p_message, ''));
  p_name := nullif(btrim(coalesce(p_name, '')), '');
  if length(p_message) < 2 then raise exception 'please write a few words'; end if;
  if length(p_message) > 1000 then raise exception 'please keep it under 1,000 characters'; end if;
  if p_name is not null and length(p_name) > 40 then raise exception 'name too long'; end if;
  if p_client_id is null or length(p_client_id) not between 8 and 64 then raise exception 'bad client'; end if;
  if p_context is not null and length(p_context::text) > 2000 then p_context := null; end if;
  select count(*) into n from public.feedback where client_id = p_client_id and created_at > now() - interval '1 day';
  if n >= 5 then raise exception 'thanks, that''s plenty for today'; end if;
  select count(*) into n from public.feedback where created_at > now() - interval '1 minute';
  if n >= 30 then raise exception 'busy, try again in a minute'; end if;
  insert into public.feedback (message, name, client_id, player_id, where_from, app_version, context)
  values (p_message, p_name, p_client_id, p_player_id, left(p_where, 20), left(p_app_version, 20), p_context);
  return json_build_object('ok', true);
end $$;
revoke all on function public.submit_feedback(text, text, text, uuid, text, text, jsonb) from public;
grant execute on function public.submit_feedback(text, text, text, uuid, text, text, jsonb) to anon, authenticated, service_role;

-- Reading it (SQL Editor):
--   select created_at at time zone 'America/Los_Angeles' as sent, where_from, name, message,
--          context->>'device' as device, context->>'screen' as screen, app_version
--   from public.feedback where not done order by created_at desc;
