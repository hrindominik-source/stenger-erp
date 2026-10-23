-- ROLLBACK migracie 20261022170000_dokumenty_detail.sql (spustit PRED rollbackom 51).
-- Zmaze udalosti dokumentov (stiahnutia k tlaci) - pred spustenim ich
-- pripadne exportujte: select * from public.hr_document_events;
-- Nove verzie dokumentov a zaznamy o odovzdani ostavaju (su to platne data).
begin;
drop function if exists public.hr_document_new_version(text, text);
drop trigger if exists hr_document_deliveries_in_person on public.hr_document_deliveries;
drop function if exists public.hr_document_deliveries_in_person();
drop function if exists public.hr_is_s334_document(text, text);
drop trigger if exists hr_document_signatures_bind_version on public.hr_document_signatures;
drop function if exists public.hr_document_signatures_bind_version();
drop table if exists public.hr_document_events;
drop function if exists public.hr_document_events_guard();
commit;
