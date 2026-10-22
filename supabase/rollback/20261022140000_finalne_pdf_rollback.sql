-- ROLLBACK migracie 20261022140000_finalne_pdf.sql (spustit PRED rollbackom 48).
-- Data (final_pdf_*, signed_pdf_*) ostavaju - odstrani sa len pravidlo, ze ich
-- zapisuje vyhradne server.
begin;
drop trigger if exists hr_documents_finalize on public.hr_documents;
drop function if exists public.hr_documents_finalize();
drop function if exists public.hr_is_server_role();
commit;
