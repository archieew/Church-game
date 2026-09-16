create extension if not exists "pgcrypto";

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('character', 'event')),
  question_text text not null,
  choices jsonb not null check (jsonb_array_length(choices) = 4),
  correct_choice smallint not null check (correct_choice between 0 and 3),
  explanation text not null,
  verse_reference text not null,
  difficulty text not null default 'medium' check (difficulty = 'medium'),
  approved boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique check (room_code ~ '^[A-Z0-9]{6}$'),
  status text not null default 'lobby' check (status in ('lobby', 'answering', 'ready_to_reveal', 'revealed', 'finished')),
  current_question integer not null default 0,
  total_questions integer not null default 10 check (total_questions between 1 and 20),
  question_set jsonb not null default '[]'::jsonb,
  timer_seconds integer not null default 15 check (timer_seconds between 5 and 120),
  buzzed_player_id uuid,
  buzzed_at timestamptz,
  steal_player_id uuid,
  steal_status text check (steal_status in ('available', 'pending', 'scored')),
  steal_selected_choice smallint check (steal_selected_choice between 0 and 3),
  admin_connected boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.games
  add column if not exists timer_seconds integer not null default 15;

alter table public.games
  add column if not exists question_set jsonb not null default '[]'::jsonb;

alter table public.games
  add column if not exists buzzed_player_id uuid;

alter table public.games
  add column if not exists buzzed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'games_timer_seconds_range'
  ) then
    alter table public.games
      add constraint games_timer_seconds_range
      check (timer_seconds between 5 and 120);
  end if;
end $$;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  score integer not null default 0 check (score >= 0),
  connected boolean not null default true,
  joined_at timestamptz not null default now(),
  unique (game_id, display_name)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'games_buzzed_player_id_fkey'
  ) then
    alter table public.games
      add constraint games_buzzed_player_id_fkey
      foreign key (buzzed_player_id) references public.players(id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'games_steal_player_id_fkey'
  ) then
    alter table public.games
      add constraint games_steal_player_id_fkey
      foreign key (steal_player_id) references public.players(id) on delete set null;
  end if;
end $$;

create unique index if not exists one_active_admin_per_game
  on public.games (id) where admin_connected = true;

create table if not exists public.game_answers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  question_index integer not null,
  question_id uuid references public.questions(id),
  question_key text,
  selected_choice smallint not null check (selected_choice between 0 and 3),
  locked_at timestamptz not null default now(),
  points_earned integer not null default 0 check (points_earned >= 0),
  unique (game_id, player_id, question_index)
);

alter table public.game_answers
  alter column question_id drop not null;

alter table public.game_answers
  add column if not exists question_key text;

alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.questions enable row level security;
alter table public.game_answers enable row level security;

create policy "Public can read approved questions"
  on public.questions for select
  using (approved = true);

create policy "Public can read games"
  on public.games for select
  using (true);

create policy "Public can create games"
  on public.games for insert
  with check (true);

create policy "Public can update games"
  on public.games for update
  using (true)
  with check (true);

create policy "Public can read players"
  on public.players for select
  using (true);

create policy "Public can join games"
  on public.players for insert
  with check (true);

create policy "Public can update player presence"
  on public.players for update
  using (true)
  with check (true);

create policy "Public can read answers"
  on public.game_answers for select
  using (true);

create policy "Players can lock answers"
  on public.game_answers for insert
  with check (true);

create policy "Admin can score answers"
  on public.game_answers for update
  using (true)
  with check (true);

alter table public.games replica identity full;
alter table public.players replica identity full;
alter table public.game_answers replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.games;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.players;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.game_answers;
exception when duplicate_object then null;
end $$;
