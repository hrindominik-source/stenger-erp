-- Rollback migracie 70 (zakonne parametre a kontroly). Vratit aj frontend.
-- Stlpec hr_documents.legal_check ostava (zaznam, co platilo pri generovani).
begin;
drop trigger if exists hr_signatures_legal_check on public.hr_document_signatures;
drop trigger if exists hr_documents_legal_check on public.hr_documents;
drop function if exists public.hr_signatures_legal_check();
drop function if exists public.hr_documents_legal_check();
drop function if exists public.hr_check_employment(text);
drop function if exists public.hr_check_employment_core(text);
drop function if exists public.hr_legal_param(text, date);
drop table if exists public.hr_legal_parameters;
drop function if exists public.hr_notify_legal_parameters();
drop function if exists public.hr_legal_parameters_stamp();
commit;
