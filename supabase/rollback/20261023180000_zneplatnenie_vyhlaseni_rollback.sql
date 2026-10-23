-- Rollback migracie 61 (spustit PRED rollbackom 60). Data sa nemenia.
begin;
drop trigger if exists hr_documents_void_declaration on public.hr_documents;
drop function if exists public.hr_documents_void_declaration();
drop function if exists public.hr_is_employee_declaration(text);
commit;
