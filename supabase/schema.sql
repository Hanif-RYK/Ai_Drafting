-- =====================================================================
-- Faisla Desk — Supabase schema
-- Supabase Dashboard → SQL Editor → New query → poori file paste karein → Run
-- Dobara chalana safe hai (idempotent).
--
-- Kya hota hai:
--   1. Purane AI Drafting ke tables (profiles, cases, glossary_rules, ai_logs,
--      live_notes, live_sessions) delete NAHI hote: woh "old_ai_drafting" schema
--      mein move ho jate hain (backup). Jab yaqeen ho jaye ke unki zaroorat nahi,
--      is file ke aakhir mein diya hua ek line ka command chala kar unhein
--      hamesha ke liye hata dein.
--   2. Naye tables bante hain: teams, profiles, team_invites, docs, ai_usage.
--   3. Row Level Security (RLS): har user sirf apni team ka data dekh/badal sakta hai.
--
-- Team model:
--   * Register karne wala user pehle "Create team" karta hai → woh us team ka admin hai.
--   * Admin doosron ko email se invite karta hai. Invite kiya hua user usi email se
--     register/login karta hai, invite dekhta hai aur Accept karta hai.
--   * Team ke sab members (admin + member) team ke saare cases, samples, rules aur
--     settings dekh aur edit kar sakte hain. Delete: banane wala ya admin.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Purane AI Drafting tables ko backup schema mein move karein
--    (sirf pehli dafa; jab "teams" table abhi nahi bana)
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  t text;
begin
  if to_regclass('public.teams') is not null then
    return; -- naya schema pehle se hai: purane tables ko haath na lagayein
  end if;

  create schema if not exists old_ai_drafting;

  -- Purani policies hatayein (functions un par depend karti hain)
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'cases', 'glossary_rules', 'ai_logs', 'live_notes', 'live_sessions')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;

  -- Purane triggers
  if to_regclass('public.profiles') is not null then
    execute 'drop trigger if exists profiles_guard on public.profiles';
  end if;
  if to_regclass('public.cases') is not null then
    execute 'drop trigger if exists cases_guard on public.cases';
  end if;
  drop trigger if exists on_auth_user_created on auth.users;

  -- Purane functions
  drop function if exists public.handle_new_user() cascade;
  drop function if exists public.profiles_guard() cascade;
  drop function if exists public.cases_guard() cascade;
  drop function if exists public.is_active_user() cascade;
  drop function if exists public.is_admin() cascade;
  drop function if exists public.is_judge() cascade;
  drop function if exists public.my_court_member_ids() cascade;

  -- Tables ko backup schema mein le jayein (data mehfooz rehta hai)
  foreach t in array array['live_sessions', 'live_notes', 'ai_logs', 'glossary_rules', 'cases', 'profiles']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I set schema old_ai_drafting', t);
    end if;
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------
create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 80),
  created_by  uuid not null references auth.users(id) on delete restrict,
  created_at  timestamptz not null default now()
);

-- Ek row per login user. Signup par trigger banata hai.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  team_id     uuid references public.teams(id) on delete set null,
  role        text not null default 'member' check (role in ('admin', 'member')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists profiles_team_idx on public.profiles (team_id);
create index if not exists profiles_email_idx on public.profiles (lower(email));

create table if not exists public.team_invites (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  team_name     text not null,            -- invitee ko team ka naam dikhane ke liye (woh teams table nahi parh sakta)
  email         text not null,            -- hamesha lowercase
  role          text not null default 'member' check (role in ('admin', 'member')),
  invited_by    uuid not null references auth.users(id) on delete cascade,
  invited_by_name text not null default '',
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz
);
create unique index if not exists team_invites_pending_idx on public.team_invites (team_id, email) where status = 'pending';
create index if not exists team_invites_email_idx on public.team_invites (email) where status = 'pending';

-- App ka saara data: cases (History), samples, lessons (rules), digests, settings.
-- Har row ek document hai; "data" mein poora object, baqi columns search/filter ke liye.
create table if not exists public.docs (
  team_id     uuid not null references public.teams(id) on delete cascade,
  id          text not null check (length(id) between 1 and 120),
  kind        text not null check (kind in ('case', 'sample', 'lesson', 'digest', 'settings')),
  section     text not null default '',
  subtype     text not null default '',
  stage       text not null default '',
  title       text not null default '',
  data        jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users(id) on delete set null,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (team_id, id)
);
create index if not exists docs_team_kind_idx on public.docs (team_id, kind, section);
-- Realtime DELETE events mein team_id chahiye (filter ke liye)
alter table public.docs replica identity full;

-- AI ka kharcha dekhne ke liye (Edge Function likhti hai)
create table if not exists public.ai_usage (
  id             bigint generated always as identity primary key,
  team_id        uuid not null references public.teams(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,
  model          text not null default '',
  mode           text not null default '',
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cache_read_tokens integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists ai_usage_team_idx on public.ai_usage (team_id, created_at desc);


-- ---------------------------------------------------------------------
-- 2. HELPER FUNCTIONS (security definer → RLS ke andar recursion nahi hoti)
-- ---------------------------------------------------------------------
create or replace function public.my_team_id()
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_team_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and team_id is not null
  );
$$;

create or replace function public.my_email()
returns text language sql stable security definer set search_path = public as $$
  select lower(email) from auth.users where id = auth.uid();
$$;

revoke all on function public.my_team_id(), public.is_team_admin(), public.my_email() from public, anon;
grant execute on function public.my_team_id(), public.is_team_admin(), public.my_email() to authenticated;


-- ---------------------------------------------------------------------
-- 3. PROFILE CREATION (signup trigger + purane users ka backfill)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(nullif(btrim(meta->>'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Jo accounts pehle se auth.users mein hain unki profile bana dein
insert into public.profiles (id, email, full_name)
select u.id,
       lower(coalesce(u.email, '')),
       coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), split_part(coalesce(u.email, ''), '@', 1))
from auth.users u
on conflict (id) do nothing;

-- Agar kisi wajah se profile na bani ho to app ye RPC call karti hai
create or replace function public.ensure_profile()
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.profiles (id, email, full_name)
  select u.id, lower(coalesce(u.email, '')),
         coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), split_part(coalesce(u.email, ''), '@', 1))
  from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;
  select * into p from public.profiles where id = auth.uid();
  return p;
end $$;

-- Browser profile ke sirf apne naam ko badal sakta hai; team_id / role / email RPCs se hi badalte hain.
-- Browser ki query "authenticated" role se chalti hai; neeche ke RPC functions (security definer)
-- function ke owner ke role se chalte hain, is liye unki tabdeeli yahan nahi rukti.
-- (Ye trigger function khud security definer NAHI hai, warna current_user hamesha owner hota.)
create or replace function public.profiles_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.id      := old.id;
    new.email   := old.email;
    new.team_id := old.team_id;
    new.role    := old.role;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();


-- ---------------------------------------------------------------------
-- 4. TEAM RPCs (membership sirf inhi functions se badalti hai)
-- ---------------------------------------------------------------------
-- Pehla user team banata hai aur admin ban jata hai
create or replace function public.create_team(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if length(v_name) < 2 then raise exception 'Team ka naam kam az kam 2 harf ka ho'; end if;
  perform public.ensure_profile();
  if (select team_id from public.profiles where id = auth.uid()) is not null then
    raise exception 'Aap pehle se ek team mein hain';
  end if;
  insert into public.teams (name, created_by) values (v_name, auth.uid()) returning id into v_team;
  update public.profiles set team_id = v_team, role = 'admin' where id = auth.uid();
  return v_team;
end $$;

-- Admin email se invite bhejta hai
create or replace function public.invite_member(p_email text, p_role text default 'member')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_team  uuid;
  v_id    uuid;
  v_role  text := case when p_role = 'admin' then 'admin' else 'member' end;
begin
  if not public.is_team_admin() then raise exception 'Sirf team admin invite bhej sakta hai'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email sahi nahi hai'; end if;
  v_team := public.my_team_id();
  if exists (select 1 from public.profiles where team_id = v_team and lower(email) = v_email) then
    raise exception 'Ye user pehle se aap ki team mein hai';
  end if;
  if exists (select 1 from public.team_invites where team_id = v_team and email = v_email and status = 'pending') then
    raise exception 'Is email ko invite pehle se bheja ja chuka hai';
  end if;
  insert into public.team_invites (team_id, team_name, email, role, invited_by, invited_by_name)
  values (v_team, (select name from public.teams where id = v_team), v_email, v_role, auth.uid(),
          (select full_name from public.profiles where id = auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.revoke_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_admin() then raise exception 'Sirf team admin invite wapas le sakta hai'; end if;
  update public.team_invites set status = 'revoked', responded_at = now()
  where id = p_invite and team_id = public.my_team_id() and status = 'pending';
  if not found then raise exception 'Invite nahi mila'; end if;
end $$;

-- Invite kiya hua user accept karta hai (usi email se login hona zaroori)
create or replace function public.accept_invite(p_invite uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.team_invites;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform public.ensure_profile();
  select * into inv from public.team_invites where id = p_invite for update;
  if inv.id is null or inv.status <> 'pending' then raise exception 'Ye invite ab maujood nahi'; end if;
  if inv.email <> public.my_email() then raise exception 'Ye invite kisi aur email ke liye hai'; end if;
  if (select team_id from public.profiles where id = auth.uid()) is not null then
    raise exception 'Aap pehle se ek team mein hain. Pehle us team ko chhorein.';
  end if;
  update public.profiles set team_id = inv.team_id, role = inv.role where id = auth.uid();
  update public.team_invites set status = 'accepted', responded_at = now() where id = inv.id;
  return inv.team_id;
end $$;

create or replace function public.decline_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.team_invites set status = 'declined', responded_at = now()
  where id = p_invite and email = public.my_email() and status = 'pending';
  if not found then raise exception 'Invite nahi mila'; end if;
end $$;

-- Admin kisi member ko team se nikalta hai
create or replace function public.remove_member(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_admin() then raise exception 'Sirf team admin member nikaal sakta hai'; end if;
  if p_user = auth.uid() then raise exception 'Apne aap ko nikalne ke liye "Leave team" istemal karein'; end if;
  update public.profiles set team_id = null, role = 'member'
  where id = p_user and team_id = public.my_team_id();
  if not found then raise exception 'Member nahi mila'; end if;
end $$;

-- Admin kisi member ko admin banata hai ya admin se member karta hai
create or replace function public.set_member_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team uuid := public.my_team_id();
  v_role text := case when p_role = 'admin' then 'admin' else 'member' end;
begin
  if not public.is_team_admin() then raise exception 'Sirf team admin role badal sakta hai'; end if;
  if v_role = 'member' and p_user = auth.uid()
     and (select count(*) from public.profiles where team_id = v_team and role = 'admin') < 2 then
    raise exception 'Team mein kam az kam ek admin hona chahiye. Pehle kisi aur ko admin banayein.';
  end if;
  update public.profiles set role = v_role where id = p_user and team_id = v_team;
  if not found then raise exception 'Member nahi mila'; end if;
end $$;

-- Member team chhorta hai (aakhri admin nahi chhor sakta)
create or replace function public.leave_team()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team uuid := public.my_team_id();
begin
  if v_team is null then return; end if;
  if (select role from public.profiles where id = auth.uid()) = 'admin'
     and (select count(*) from public.profiles where team_id = v_team and role = 'admin') < 2
     and (select count(*) from public.profiles where team_id = v_team) > 1 then
    raise exception 'Aap aakhri admin hain. Pehle kisi aur member ko admin banayein.';
  end if;
  update public.profiles set team_id = null, role = 'member' where id = auth.uid();
end $$;

create or replace function public.rename_team(p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_admin() then raise exception 'Sirf team admin naam badal sakta hai'; end if;
  update public.teams set name = btrim(p_name) where id = public.my_team_id();
end $$;

revoke all on function
  public.ensure_profile(), public.create_team(text), public.invite_member(text, text), public.revoke_invite(uuid),
  public.accept_invite(uuid), public.decline_invite(uuid), public.remove_member(uuid),
  public.set_member_role(uuid, text), public.leave_team(), public.rename_team(text)
from public, anon;
grant execute on function
  public.ensure_profile(), public.create_team(text), public.invite_member(text, text), public.revoke_invite(uuid),
  public.accept_invite(uuid), public.decline_invite(uuid), public.remove_member(uuid),
  public.set_member_role(uuid, text), public.leave_team(), public.rename_team(text)
to authenticated;


-- ---------------------------------------------------------------------
-- 5. DOCS GUARD: team_id, created_by, updated_by hamesha server set karta hai
-- ---------------------------------------------------------------------
create or replace function public.docs_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Browser se aane wali har insert / update par (service role / SQL editor par nahi)
  if current_user in ('authenticated', 'anon') then
    new.team_id := public.my_team_id();
    if new.team_id is null then raise exception 'Aap kisi team mein nahi hain'; end if;
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.created_at := now();
    else
      new.created_by := old.created_by;
      new.created_at := old.created_at;
    end if;
    new.updated_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists docs_guard on public.docs;
create trigger docs_guard
  before insert or update on public.docs
  for each row execute function public.docs_guard();


-- ---------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.teams        enable row level security;
alter table public.profiles     enable row level security;
alter table public.team_invites enable row level security;
alter table public.docs         enable row level security;
alter table public.ai_usage     enable row level security;

-- Purani (isi naam ki) policies hata kar dobara banayein, taake file dobara chal sake
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('teams', 'profiles', 'team_invites', 'docs', 'ai_usage')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- TEAMS: sirf apni team
create policy teams_select on public.teams
  for select to authenticated
  using (id = public.my_team_id());

-- PROFILES: apni row + apni team ke log; update sirf apni row (guard trigger baqi columns rok deta hai)
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or (team_id is not null and team_id = public.my_team_id()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- INVITES: admin/members apni team ke invites dekhte hain; invitee apni email ke invites
create policy invites_select on public.team_invites
  for select to authenticated
  using (team_id = public.my_team_id() or email = public.my_email());

-- DOCS: poori team parh/likh sakti hai; delete banane wala ya admin
create policy docs_select on public.docs
  for select to authenticated
  using (team_id = public.my_team_id());

create policy docs_insert on public.docs
  for insert to authenticated
  with check (team_id = public.my_team_id());

create policy docs_update on public.docs
  for update to authenticated
  using (team_id = public.my_team_id())
  with check (team_id = public.my_team_id());

create policy docs_delete on public.docs
  for delete to authenticated
  using (team_id = public.my_team_id() and (created_by = auth.uid() or created_by is null or public.is_team_admin()));

-- AI USAGE: team dekh sakti hai; likhti sirf Edge Function (service role) hai
create policy ai_usage_select on public.ai_usage
  for select to authenticated
  using (team_id = public.my_team_id());


-- ---------------------------------------------------------------------
-- 7. GRANTS (anon ko kuch nahi)
-- ---------------------------------------------------------------------
revoke all on public.teams, public.profiles, public.team_invites, public.docs, public.ai_usage from anon;
-- Supabase naye tables par "authenticated" ko sab kuch de deta hai; jo zaroori nahi woh wapas lein.
-- (RLS phir bhi rokti, ye doosri deewar hai.) Team / invite / role ki tabdeeli sirf upar ke RPCs se.
revoke insert, update, delete, truncate on public.teams, public.team_invites, public.ai_usage from authenticated;
revoke insert, delete, truncate on public.profiles from authenticated;
revoke truncate on public.docs from authenticated;
grant select on public.teams, public.team_invites, public.ai_usage to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.docs to authenticated;


-- ---------------------------------------------------------------------
-- 8. REALTIME: docs table ki tabdeeliyan foran sab members ko pahunchti hain
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs'
     ) then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 9. (OPTIONAL, BAAD MEIN) Purana AI Drafting data hamesha ke liye hatane ke liye:
--
--   drop schema old_ai_drafting cascade;
--
-- Ye line sirf tab chalayein jab aap ko yaqeen ho ke purane cases/templates
-- ki zaroorat nahi rahi.
-- ---------------------------------------------------------------------
