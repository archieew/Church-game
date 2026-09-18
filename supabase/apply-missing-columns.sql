-- Adds the columns the app expects but which are missing from the live database.
-- Without these, Supabase rejects every games UPDATE, which left players stuck in the lobby.
-- Safe to run more than once.
--
-- HOW TO RUN:
--   1. Open https://supabase.com/dashboard/project/afrplpqjswocktkldmym/sql/new
--   2. Paste this entire file
--   3. Click "Run" (or press Ctrl+Enter)
--   4. Hard-refresh the game (Ctrl+Shift+R)

alter table public.games add column if not exists steal_player_id uuid;
alter table public.games add column if not exists steal_status text;
alter table public.games add column if not exists steal_selected_choice smallint;
alter table public.games add column if not exists timer_started boolean not null default false;

-- Relationship: games.steal_player_id -> players.id
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'games_steal_player_id_fkey') then
    alter table public.games
      add constraint games_steal_player_id_fkey
      foreign key (steal_player_id) references public.players(id) on delete set null;
  end if;
end $$;

-- Allowed steal states
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'games_steal_status_check') then
    alter table public.games
      add constraint games_steal_status_check
      check (steal_status is null or steal_status in ('available', 'pending', 'scored'));
  end if;
end $$;

-- Timer length range (no-op if it already exists)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'games_timer_seconds_range') then
    alter table public.games
      add constraint games_timer_seconds_range
      check (timer_seconds between 5 and 120);
  end if;
end $$;

-- Ask PostgREST to reload its schema cache so the new columns are usable immediately.
notify pgrst, 'reload schema';

-- Statuses the game uses today: a round is open (answering), judged right
-- (answered_correct), or shown after both players missed (revealed).
-- Replaces the older check that only knew 'ready_to_reveal'.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'games_status_check' and conrelid = 'public.games'::regclass
  ) then
    alter table public.games drop constraint games_status_check;
  end if;
  alter table public.games
    add constraint games_status_check
    check (status in ('lobby', 'answering', 'answered_correct', 'revealed', 'finished'));
end $$;

notify pgrst, 'reload schema';

-- VERIFY (optional): run this afterwards and you should see all four columns listed.
-- select column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'games'
--   and column_name in ('timer_started', 'steal_player_id', 'steal_status', 'steal_selected_choice')
-- order by column_name;
