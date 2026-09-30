-- =====================================================================
-- AI Drafting System — Row Level Security (RLS)
-- Run this whole file once in: Supabase Dashboard → SQL Editor → New query
-- It is safe to run again (idempotent).
--
-- Access rules:
--   * Only logged-in users with status = 'active' can use data.
--   * Cases are shared inside one court only (same court_name, case/space-insensitive).
--   * Case delete: the creator or an admin (same court).
--   * Only a judge can finalize / un-finalize a case.
--   * Profiles are created by a server trigger (the browser can no longer set
--     is_admin / status itself). The very first steno becomes the admin.
--   * Only an admin can approve / reject users.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Remove any old policies on these tables (old permissive policies
--    would otherwise still let everything through, because policies are OR-ed)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'cases', 'glossary_rules', 'ai_logs', 'live_notes', 'live_sessions')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 1. Helper functions (SECURITY DEFINER so they can read profiles without
--    triggering profiles' own RLS → no infinite recursion)
-- ---------------------------------------------------------------------
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active' and is_admin);
$$;

create or replace function public.is_judge()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active' and role = 'judge');
$$;

-- All user ids in the caller's court. Empty if the caller is not active.
create or replace function public.my_court_member_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id
  from profiles p
  where lower(btrim(p.court_name)) = (
    select lower(btrim(me.court_name)) from profiles me
    where me.id = auth.uid() and me.status = 'active'
  );
$$;

revoke all on function public.is_active_user(), public.is_admin(), public.is_judge(), public.my_court_member_ids() from public, anon;
grant execute on function public.is_active_user(), public.is_admin(), public.is_judge(), public.my_court_member_ids() to authenticated;


-- ---------------------------------------------------------------------
-- 2. PROFILES
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;

-- Create the profile on the server when a user signs up.
-- The app sends full_name / role / court_name / steno_email as signUp metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta     jsonb   := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role   text    := meta->>'role';
  v_first  boolean;
begin
  if v_role is null or v_role not in ('steno', 'judge', 'user') then
    v_role := 'user';
  end if;

  -- Serialize so two simultaneous sign-ups can't both become the first admin
  perform pg_advisory_xact_lock(hashtext('profiles_first_admin'));
  select not exists (select 1 from profiles where is_admin) and v_role = 'steno' into v_first;

  insert into profiles (id, full_name, role, email, court_name, steno_email,
                        status, is_admin, approved_by_admin, approved_by_judge, judge_id)
  values (
    new.id,
    coalesce(nullif(btrim(meta->>'full_name'), ''), split_part(new.email, '@', 1)),
    v_role,
    new.email,
    btrim(coalesce(meta->>'court_name', '')),
    nullif(btrim(meta->>'steno_email'), ''),
    case when v_first then 'active' else 'pending' end,
    v_first,
    v_first,
    true,
    null
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Read: your own row (even while pending), people in your court, or everything if admin
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or id in (select public.my_court_member_ids())
  );

-- Update: only admins (approve / reject). No insert / delete from the browser.
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- An admin must not accidentally remove their own admin rights / lock themselves out
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.id = auth.uid()
     and (new.is_admin is distinct from old.is_admin or new.status is distinct from old.status) then
    raise exception 'Aap apna admin status / account status khud change nahi kar sakte';
  end if;
  new.id := old.id;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();


-- ---------------------------------------------------------------------
-- 3. CASES (shared within one court)
-- ---------------------------------------------------------------------
alter table public.cases enable row level security;

-- Server-side rules the browser cannot bypass
create or replace function public.cases_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- SQL editor / service role: no user, no restrictions
  if auth.uid() is null then
    return new;
  end if;

  if new.status is null or new.status not in ('pending', 'review', 'finalized') then
    raise exception 'Invalid case status: %', new.status;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;  -- owner can never be changed
    if new.status is distinct from old.status
       and (new.status = 'finalized' or old.status = 'finalized')
       and not public.is_judge() then
      raise exception 'Sirf judge case finalize ya un-finalize kar sakta hai';
    end if;
  end if;

  new.last_updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists cases_guard on public.cases;
create trigger cases_guard
  before insert or update on public.cases
  for each row execute function public.cases_guard();

create policy cases_select on public.cases
  for select to authenticated
  using (created_by in (select public.my_court_member_ids()));

create policy cases_insert on public.cases
  for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());

create policy cases_update on public.cases
  for update to authenticated
  using (created_by in (select public.my_court_member_ids()))
  with check (created_by in (select public.my_court_member_ids()));

create policy cases_delete on public.cases
  for delete to authenticated
  using (
    created_by in (select public.my_court_member_ids())
    and (created_by = auth.uid() or public.is_admin())
  );


-- ---------------------------------------------------------------------
-- 4. GLOSSARY RULES (private to each user)
-- ---------------------------------------------------------------------
alter table public.glossary_rules enable row level security;

create policy glossary_own on public.glossary_rules
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_active_user());


-- ---------------------------------------------------------------------
-- 5. AI LOGS (visible/insertable only for cases you can see)
--    The sub-select on cases is itself filtered by the cases RLS above.
-- ---------------------------------------------------------------------
alter table public.ai_logs enable row level security;

create policy ai_logs_select on public.ai_logs
  for select to authenticated
  using (exists (select 1 from public.cases c where c.id = ai_logs.case_id));

create policy ai_logs_insert on public.ai_logs
  for insert to authenticated
  with check (public.is_active_user() and exists (select 1 from public.cases c where c.id = ai_logs.case_id));


-- ---------------------------------------------------------------------
-- 6. LIVE NOTES (Live Editor pad + orders sent to steno) — per court
-- ---------------------------------------------------------------------
alter table public.live_notes enable row level security;

create policy live_notes_select on public.live_notes
  for select to authenticated
  using (updated_by in (select public.my_court_member_ids()));

create policy live_notes_insert on public.live_notes
  for insert to authenticated
  with check (public.is_active_user() and updated_by = auth.uid());

create policy live_notes_update on public.live_notes
  for update to authenticated
  using (updated_by in (select public.my_court_member_ids()))
  with check (updated_by = auth.uid());

create policy live_notes_delete on public.live_notes
  for delete to authenticated
  using (updated_by in (select public.my_court_member_ids()));


-- ---------------------------------------------------------------------
-- 7. LIVE SESSIONS (who is viewing a case)
-- ---------------------------------------------------------------------
alter table public.live_sessions enable row level security;

create policy live_sessions_select on public.live_sessions
  for select to authenticated
  using (exists (select 1 from public.cases c where c.id = live_sessions.case_id));

create policy live_sessions_insert on public.live_sessions
  for insert to authenticated
  with check (
    active_user_id = auth.uid()
    and exists (select 1 from public.cases c where c.id = live_sessions.case_id)
  );

create policy live_sessions_update on public.live_sessions
  for update to authenticated
  using (exists (select 1 from public.cases c where c.id = live_sessions.case_id))
  with check (active_user_id = auth.uid());

create policy live_sessions_delete on public.live_sessions
  for delete to authenticated
  using (active_user_id = auth.uid());


-- ---------------------------------------------------------------------
-- 8. Indexes that keep the policies fast
-- ---------------------------------------------------------------------
create index if not exists profiles_court_norm_idx on public.profiles (lower(btrim(court_name)));
create index if not exists cases_created_by_idx on public.cases (created_by);
create index if not exists live_notes_updated_by_idx on public.live_notes (updated_by);
create index if not exists ai_logs_case_id_idx on public.ai_logs (case_id);


-- ---------------------------------------------------------------------
-- 9. Anonymous (not logged in) visitors get nothing
-- ---------------------------------------------------------------------
revoke all on public.profiles, public.cases, public.glossary_rules,
              public.ai_logs, public.live_notes, public.live_sessions from anon;
