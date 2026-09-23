-- xAI Max persistent conversation storage
-- Run this in Supabase Dashboard -> SQL Editor.

create table if not exists public.conversations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Conversation',
  agent_id text,
  agent_emoji text,
  messages jsonb not null default '[]'::jsonb,
  tokens integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversations enable row level security;

drop policy if exists "Users can view their conversations" on public.conversations;
create policy "Users can view their conversations"
  on public.conversations for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create their conversations" on public.conversations;
create policy "Users can create their conversations"
  on public.conversations for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their conversations" on public.conversations;
create policy "Users can update their conversations"
  on public.conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their conversations" on public.conversations;
create policy "Users can delete their conversations"
  on public.conversations for delete
  using (auth.uid() = user_id);

create index if not exists conversations_user_updated_idx
  on public.conversations(user_id, updated_at desc);

create table if not exists public.question_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  question text not null,
  answer text not null,
  agent_id text,
  model text,
  created_at timestamptz not null default now()
);

alter table public.question_logs enable row level security;

drop policy if exists "Users can view their question logs" on public.question_logs;
create policy "Users can view their question logs"
  on public.question_logs for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create their question logs" on public.question_logs;
create policy "Users can create their question logs"
  on public.question_logs for insert
  with check (auth.uid() = user_id);

create index if not exists question_logs_user_created_idx
  on public.question_logs(user_id, created_at desc);
