-- =====================================================================
-- Templates ko asal cases se alag karna
-- Supabase Dashboard → SQL Editor → New query → poora paste → Run
-- Dobara chalana safe hai.
-- =====================================================================

-- 1. Naya column: true = template, false = asal case
alter table public.cases
  add column if not exists is_template boolean not null default false;

-- 2. Purane templates pehchanein: "Add Template" se bane cases finalized hote thay
--    magar un mein plaint / facts ka text nahi hota tha (sirf judgement paste hoti thi).
update public.cases
set is_template = true
where status = 'finalized'
  and is_template = false
  and coalesce(btrim(plaint_text), '') = ''
  and coalesce(btrim(facts_text), '') = ''
  and reused_from_judgement_id is null
  and coalesce(btrim(judgement_output), '') <> '';

-- 3. Lists / counts filter on this column
create index if not exists cases_is_template_idx on public.cases (is_template, status);
