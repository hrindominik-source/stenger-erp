-- Rollback migracie 59 (vzor pracovnej zmluvy ako sablona). Zastavi sa,
-- ak uz existuju dokumenty vygenerovane z tychto sablon. Subory
-- sablony/tpl-ps*/v1.docx v ulozisku ostavaju (nemazu sa).
do $$
begin
  if exists (select 1 from public.hr_documents where template_id in ('tpl-ps', 'tpl-ps-cizinec')) then
    raise exception 'Rollback zastaven: existuji smlouvy vygenerovane ze sablony tpl-ps / tpl-ps-cizinec.';
  end if;
end;
$$;

drop trigger if exists hr_document_template_versions_guard on public.hr_document_template_versions;
drop function if exists public.hr_document_template_versions_guard();

update public.hr_document_templates set current_version_id = null where id in ('tpl-ps', 'tpl-ps-cizinec');
delete from public.hr_document_template_versions where template_id in ('tpl-ps', 'tpl-ps-cizinec');
delete from public.hr_document_templates where id in ('tpl-ps', 'tpl-ps-cizinec');

alter table public.hr_document_templates drop constraint if exists hr_document_templates_doc_type_check;
alter table public.hr_document_templates add constraint hr_document_templates_doc_type_check
  check (doc_type in (
    'pracovni_smlouva', 'mzdovy_vymer', 'popis_pracovniho_mista', 'dodatek',
    'dohoda_o_skonceni', 'vypoved_zamestnance', 'vypoved_zamestnavatele',
    'zruseni_ve_zkusebni_dobe', 'other',
    'platovy_vymer', 'hi001_naplen_prace_delnice', 'vstupni_skoleni'
  ));
