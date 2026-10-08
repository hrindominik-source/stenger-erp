-- ============================================================
-- 47. Exekuce - doklady len pre opravnenie HR_EXEKUCE (manazer, uctovnicka)
--     Spustit JEDNORAZOVO v Supabase -> SQL Editor (je idempotentne,
--     opakovane spustenie nic nepokazi). Rovnaky obsah je aj na konci
--     supabase/schema.sql (sekcia 47).
--
--     - Ano/Ne exekucie je v employees.data.exekuce (vidi kazdy s HR_VIEW_BASIC).
--     - Doklady: subory v hr-dokumenty pod cestou exekuce/<employee_id>/...
--       + zaznamy v employee_garnishment_documents.
--     - Citat/otvorit ich moze LEN HR_EXEKUCE (a HR_ADMIN, ktory ma vsetko).
--     - Nahrat (insert) moze kazdy s HR_EDIT (napr. personalista) - ale
--       potom ich uz neotvori. Pocet dokladov (bez detailov) vidi kazdy s
--       HR_VIEW_BASIC cez funkciu hr_garnishment_doc_count.
-- ============================================================

create table if not exists public.employee_garnishment_documents (
  id text primary key,
  employee_id text not null references public.employees(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_size bigint,
  uploaded_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.employee_garnishment_documents enable row level security;

drop policy if exists "garnishment_docs_view" on public.employee_garnishment_documents;
create policy "garnishment_docs_view" on public.employee_garnishment_documents
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_EXEKUCE'));

drop policy if exists "garnishment_docs_insert" on public.employee_garnishment_documents;
create policy "garnishment_docs_insert" on public.employee_garnishment_documents
  for insert
  with check (
    public.current_role() = 'office'
    and public.hr_has_permission('HR_EDIT')
    and file_path like 'exekuce/%'
  );
-- Ziadna UPDATE/DELETE policy - doklady su archivne.

drop trigger if exists audit_employee_garnishment_documents on public.employee_garnishment_documents;
create trigger audit_employee_garnishment_documents after insert or update or delete on public.employee_garnishment_documents
  for each row execute function public.audit_trigger();

-- Pocet dokladov bez detailov (personalista vidi, ze doklad je nahraty).
create or replace function public.hr_garnishment_doc_count(p_employee_id text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC')
      then (select count(*)::int from public.employee_garnishment_documents where employee_id = p_employee_id)
    else 0
  end;
$$;
grant execute on function public.hr_garnishment_doc_count(text) to authenticated;

-- Ulozisko: cesta exekuce/... je viditelna LEN s HR_EXEKUCE. Ostatne cesty
-- bezo zmeny (povodna logika podla hr_documents).
create or replace function public.hr_object_path_visible(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_doc_id text;
begin
  if p_path like 'exekuce/%' then
    return public.hr_has_permission('HR_EXEKUCE');
  end if;
  select id into v_doc_id from public.hr_documents where file_path = p_path limit 1;
  if v_doc_id is null then
    return true; -- subor sablony a pod. - baseline HR_VIEW_BASIC uz je vynuteny v policy
  end if;
  return not exists (
    select 1 from unnest(public.hr_document_required_permissions(v_doc_id)) as perm
    where not public.hr_has_permission(perm)
  );
end;
$$;
