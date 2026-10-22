-- ROLLBACK migracie 20261022160000_uplny_podpis.sql (spustit PRED rollbackom 50).
-- Odstrani pravidlo "SIGNED len pri vsetkych podpisoch" a kontrolu pri
-- odovzdani. Doplnene legal_act_type ostavaju (su spravne). Funkcia
-- hr_onboarding_submit ma rovnaku logiku ako v migracii 50 - nemeni sa.
begin;
drop trigger if exists hr_document_deliveries_signed on public.hr_document_deliveries;
drop function if exists public.hr_document_deliveries_signed();
drop trigger if exists hr_documents_signed_complete on public.hr_documents;
drop function if exists public.hr_documents_signed_complete();
drop function if exists public.hr_document_missing_signers(text);
drop function if exists public.hr_required_signers(text);
drop function if exists public.hr_default_legal_act_type(text);
commit;
