-- ============================================================
-- 59. Vzor pracovnej zmluvy ako verzovana sablona.
-- Dnesne vzory (public/hr/sablony/pracovni_smlouva*.docx) sa stavaju
-- verziou 1 sablon tpl-ps / tpl-ps-cizinec. content_hash = SHA-256 bajtov
-- dnesnych vzorov - generator pouzije subor len ked otlacok sedi (z
-- ulozista, alebo pri prvom pouziti z dodaneho suboru, ktory potom ulozi
-- na file_path). Existujuce dokumenty sa NEMENIA (ziadny update
-- hr_documents) - ostavaju bez template_version_id.
-- ============================================================

alter table public.hr_document_templates drop constraint if exists hr_document_templates_doc_type_check;
alter table public.hr_document_templates add constraint hr_document_templates_doc_type_check
  check (doc_type in (
    'pracovni_smlouva', 'mzdovy_vymer', 'popis_pracovniho_mista', 'dodatek',
    'dohoda_o_skonceni', 'vypoved_zamestnance', 'vypoved_zamestnavatele',
    'zruseni_ve_zkusebni_dobe', 'other',
    'platovy_vymer', 'hi001_naplen_prace_delnice', 'vstupni_skoleni',
    'pracovni_smlouva_cizinec'
  ));

insert into public.hr_document_templates (id, doc_type, name, active, status, approved_at) values
  ('tpl-ps', 'pracovni_smlouva', 'Pracovní smlouva (vzor Stenger)', true, 'SCHVALENA', now()),
  ('tpl-ps-cizinec', 'pracovni_smlouva_cizinec', 'Pracovní smlouva – cizinec (vzor Stenger)', true, 'SCHVALENA', now())
on conflict (id) do nothing;

insert into public.hr_document_template_versions
  (id, template_id, version_number, file_path, variables_schema, effective_date, content_hash, mapping_status, required_permissions) values
  ('tpl-ps-v1', 'tpl-ps', 1, 'sablony/tpl-ps/v1.docx', '{"generator": "pracovniSmlouva.js"}'::jsonb, current_date,
   '4d24f2fb375560911839bbda51409df863d3763b8f077206904b59225369c3f2', 'SCHVALENA', array['HR_VIEW_SENSITIVE']),
  ('tpl-ps-cizinec-v1', 'tpl-ps-cizinec', 1, 'sablony/tpl-ps-cizinec/v1.docx', '{"generator": "pracovniSmlouva.js"}'::jsonb, current_date,
   '0734a6a019fb277403b580119bc8cb4694a0f645d15f6d84f013dd253a1e1e16', 'SCHVALENA', array['HR_VIEW_SENSITIVE'])
on conflict (id) do nothing;

update public.hr_document_templates set current_version_id = 'tpl-ps-v1' where id = 'tpl-ps' and current_version_id is null;
update public.hr_document_templates set current_version_id = 'tpl-ps-cizinec-v1' where id = 'tpl-ps-cizinec' and current_version_id is null;

-- Verzia sablony je nemenna: subor, otlacok a zaradenie sa nemenia (zmena =
-- nova verzia); pouzita verzia sa nemaze.
create or replace function public.hr_document_template_versions_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.hr_documents where template_version_id = old.id) then
      raise exception 'Verzi šablony použitou v dokumentech nelze smazat.';
    end if;
    return old;
  end if;
  if new.template_id is distinct from old.template_id
     or new.version_number is distinct from old.version_number
     or new.file_path is distinct from old.file_path
     or (old.content_hash is not null and new.content_hash is distinct from old.content_hash) then
    raise exception 'Verze šablony je neměnná - změna = nová verze.';
  end if;
  return new;
end;
$$;

drop trigger if exists hr_document_template_versions_guard on public.hr_document_template_versions;
create trigger hr_document_template_versions_guard
  before update or delete on public.hr_document_template_versions
  for each row execute function public.hr_document_template_versions_guard();
