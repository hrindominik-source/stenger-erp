-- ============================================================
-- 61. Zneplatnenie podpisaneho vyhlasenia zamestnanca (§ 21 oznamenie
--     adresy, § 335 suhlas a jeho odvolanie).
--   Podpisane vyhlasenie je prejav vole zamestnanca - zmena adresy sa riesi
--   novym vyhlasenim, suhlas podla § 335 odvolanim. Zneplatnit ho (aj cez
--   "novu verziu") smie len HR_ADMIN a s dovodom aspon 10 znakov.
--   Server (service_role) hr_has_permission splna; ziadna serverova cesta
--   podpisane vyhlasenia nezneplatnuje, dovod je povinny aj pre server.
-- ============================================================

create or replace function public.hr_is_employee_declaration(p_doc_type text)
returns boolean
language sql
immutable
as $$
  select p_doc_type in ('s21_oznameni_adresy', 's335_souhlas', 's335_odvolani');
$$;

create or replace function public.hr_documents_void_declaration()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'VOIDED' and old.status in ('SIGNED', 'ARCHIVED')
     and public.hr_is_employee_declaration(old.doc_type) then
    if not public.hr_has_permission('HR_ADMIN') then
      raise exception 'Podepsané prohlášení zaměstnance smí zneplatnit jen HR_ADMIN. Změna adresy = nové oznámení, souhlas podle § 335 = odvolání.';
    end if;
    if length(trim(coalesce(new.void_reason, ''))) < 10 then
      raise exception 'Uveďte důvod zneplatnění (alespoň 10 znaků).';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists hr_documents_void_declaration on public.hr_documents;
create trigger hr_documents_void_declaration before update on public.hr_documents
  for each row execute function public.hr_documents_void_declaration();
