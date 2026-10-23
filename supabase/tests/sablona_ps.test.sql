-- DB testy migracie 59: vzor pracovnej zmluvy ako verzovana sablona.
-- Iba lokalne: npx supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is((select status from public.hr_document_templates where id = 'tpl-ps'), 'SCHVALENA', 'sablona PS schvalena');
select is((select current_version_id from public.hr_document_templates where id = 'tpl-ps-cizinec'), 'tpl-ps-cizinec-v1', 'variant cizinec ma verziu 1');
select is((select content_hash from public.hr_document_template_versions where id = 'tpl-ps-v1'),
  '4d24f2fb375560911839bbda51409df863d3763b8f077206904b59225369c3f2', 'verzia 1 = otlacok dnesneho vzoru');
select is((select required_permissions from public.hr_document_template_versions where id = 'tpl-ps-v1'), array['HR_VIEW_SENSITIVE'],
  'citlivost ako doteraz (HR_VIEW_SENSITIVE)');

-- nemennost verzie
select throws_ok($$update public.hr_document_template_versions set file_path = 'sablony/x.docx' where id = 'tpl-ps-v1'$$, 'P0001', null, 'subor verzie sa nemeni');
select throws_ok($$update public.hr_document_template_versions set content_hash = repeat('0', 64) where id = 'tpl-ps-v1'$$, 'P0001', null, 'otlacok verzie sa nemeni');
select lives_ok($$update public.hr_document_template_versions set mapping_status = 'SCHVALENA' where id = 'tpl-ps-v1'$$, 'stav mapovania sa meni dalej');

-- dokument z verzie: dedi citlivost, pouzita verzia sa nemaze
insert into public.employees (id, first_name, last_name) values ('emp-ps1', 'Petra', 'Sablonova');
insert into public.hr_documents (id, employee_id, doc_type, template_id, template_version_id, origin, status, file_path)
  values ('d-ps1', 'emp-ps1', 'pracovni_smlouva_cizinec', 'tpl-ps-cizinec', 'tpl-ps-cizinec-v1', 'GENERATED', 'READY_FOR_SIGNATURE', 'zamestnanci/emp-ps1/d-ps1.docx');
select is(public.hr_document_required_permissions('d-ps1'), array['HR_VIEW_SENSITIVE'], 'dokument dedi citlivost verzie');
select throws_ok($$delete from public.hr_document_template_versions where id = 'tpl-ps-cizinec-v1'$$, 'P0001', null, 'pouzita verzia sa nemaze');

select * from finish();
rollback;
