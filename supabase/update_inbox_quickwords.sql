-- =====================================================================
-- Faisla Desk: Inbox, apne quick words, aur settings sirf admin ke liye
-- =====================================================================
-- Supabase Dashboard → SQL Editor → New query → ye poori file paste → Run.
-- Ek dafa chalana kaafi hai; dobara chalana bhi safe hai. Koi purana data nahi hatta.
-- (Yahi tabdeeliyan supabase/schema.sql mein bhi shamil hain.)
--
-- 1. profiles.quick_words: har user ke apne quick words.
-- 2. docs: settings, samples, rules aur seekhe hue notes sirf team admin likh / badal /
--    hata sakta hai. Cases har member save kar sakta hai (pehle ki tarah).
-- 3. inbox: draft kisi team member ko bhejna (saath cause list ka number aur tareekh).
--    Draft message ke andar jata hai; History mein sirf Save dabane se jata hai.
--    Har message sirf bhejne wala aur jise bheja gaya woh dekh sakta hai; inbox se
--    hatana sirf receiver ka kaam hai.
-- =====================================================================

-- 1. Apne quick words ---------------------------------------------------
alter table public.profiles add column if not exists quick_words text not null default '';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_quick_words_len') then
    alter table public.profiles add constraint profiles_quick_words_len check (length(quick_words) <= 4000);
  end if;
end $$;
-- (profiles_guard pehle se id, email, team_id aur role ko browser se badalne nahi deta;
--  naam aur quick_words user khud badal sakta hai.)

-- 2. Settings, samples, rules: sirf admin ---------------------------------
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;

create policy docs_insert on public.docs
  for insert to authenticated
  with check (team_id = public.my_team_id() and (kind = 'case' or public.is_team_admin()));

create policy docs_update on public.docs
  for update to authenticated
  using (team_id = public.my_team_id() and (kind = 'case' or public.is_team_admin()))
  with check (team_id = public.my_team_id() and (kind = 'case' or public.is_team_admin()));

create policy docs_delete on public.docs
  for delete to authenticated
  using (team_id = public.my_team_id()
         and (public.is_team_admin() or (kind = 'case' and (created_by = auth.uid() or created_by is null))));

-- 3. Inbox -------------------------------------------------------------
create table if not exists public.inbox (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  from_user   uuid references auth.users(id) on delete set null,
  to_user     uuid not null references auth.users(id) on delete cascade,
  case_id     text not null check (length(case_id) between 1 and 120),
  title       text not null default '' check (length(title) <= 300),
  section     text not null default '' check (length(section) <= 40),
  subtype     text not null default '' check (length(subtype) <= 200),
  note        text not null default '' check (length(note) <= 1000),
  cause_no    text not null default '',          -- case ka number cause list mein
  cause_date  date,                              -- kis tareekh ki cause list
  data        jsonb not null default '{}'::jsonb, -- bheja hua draft (History mein save hona zaroori nahi)
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists inbox_to_idx on public.inbox (to_user, created_at desc);
-- Pehle wala inbox table ho to naye columns bhi aa jayein
alter table public.inbox add column if not exists cause_no text not null default '';
alter table public.inbox add column if not exists cause_date date;
alter table public.inbox add column if not exists data jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inbox_cause_no_len') then
    alter table public.inbox add constraint inbox_cause_no_len check (length(cause_no) <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inbox_data_size') then
    alter table public.inbox add constraint inbox_data_size check (octet_length(data::text) <= 400000);
  end if;
end $$;

-- Browser se aane wala har message: bhejne wala, team aur waqt server khud likhta hai;
-- receiver isi team ka member hona chahiye. Draft message ke saath jata hai, History mein
-- save hona zaroori nahi.
-- (Ye trigger function security definer NAHI hai, taake current_user browser ka role rahe.)
create or replace function public.inbox_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.team_id    := public.my_team_id();
    new.from_user  := auth.uid();
    new.created_at := now();
    new.read_at    := null;
    if new.team_id is null then raise exception 'Aap kisi team mein nahi hain'; end if;
    if not exists (select 1 from public.profiles where id = new.to_user and team_id = new.team_id) then
      raise exception 'Ye shakhs aap ki team mein nahi hai';
    end if;
    if length(btrim(new.cause_no)) = 0 or new.cause_date is null then
      raise exception 'Cause list ka number aur tareekh likhein';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists inbox_guard on public.inbox;
create trigger inbox_guard
  before insert on public.inbox
  for each row execute function public.inbox_guard();

-- Parha hua mark karna: sirf apne inbox ke messages, sirf read_at badalta hai
create or replace function public.inbox_mark_read(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update public.inbox set read_at = now()
  where id = any(p_ids) and to_user = auth.uid() and read_at is null;
$$;
revoke all on function public.inbox_mark_read(uuid[]) from public, anon;
grant execute on function public.inbox_mark_read(uuid[]) to authenticated;

alter table public.inbox enable row level security;
drop policy if exists inbox_select on public.inbox;
drop policy if exists inbox_insert on public.inbox;
drop policy if exists inbox_delete on public.inbox;

create policy inbox_select on public.inbox
  for select to authenticated
  using (team_id = public.my_team_id() and (to_user = auth.uid() or from_user = auth.uid()));

create policy inbox_insert on public.inbox
  for insert to authenticated
  with check (team_id = public.my_team_id() and from_user = auth.uid());

create policy inbox_delete on public.inbox
  for delete to authenticated
  using (team_id = public.my_team_id() and to_user = auth.uid());

revoke all on public.inbox from anon;
revoke update, truncate on public.inbox from authenticated;
grant select, insert, delete on public.inbox to authenticated;

-- Naya message foran receiver tak (realtime)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inbox'
     ) then
    alter publication supabase_realtime add table public.inbox;
  end if;
end $$;
