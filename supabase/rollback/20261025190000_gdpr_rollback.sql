-- Rollback migracie 72 (GDPR). Lehoty, dovody oprav a spracovatelia sa
-- zmazu - pred rollbackom ich exportovat (zaznam ostava v audit_log).
-- Anonymizovane udaje sa NEVRACAJU. Ziadosti ANONYMIZE ostanu v tabulke len
-- ak sa najprv zmazu (kontrola kind). Vratit aj frontend.
begin;
drop function if exists public.hr_anonymize_employee(text, text);
drop function if exists public.hr_export_employee(text);
drop function if exists public.hr_record_correction(text, text);
drop function if exists public.hr_retention_due();
delete from public.hr_approval_requests where kind = 'ANONYMIZE';
alter table public.hr_approval_requests drop constraint if exists hr_approval_requests_kind_check;
alter table public.hr_approval_requests add constraint hr_approval_requests_kind_check
  check (kind in ('EMPLOYER_SIGN', 'VOID_DOCUMENT', 'LEGAL_EXCEPTION'));
create or replace function public.hr_approval_kind_label(p_kind text)
returns text language sql immutable as $$
  select case p_kind when 'EMPLOYER_SIGN' then 'Podpis za zaměstnavatele'
    when 'VOID_DOCUMENT' then 'Zneplatnění podepsaného dokumentu'
    when 'LEGAL_EXCEPTION' then 'Výjimka ze zákonného limitu' end;
$$;
-- hr_request_approval: vetva ANONYMIZE ostane, ale kind ju uz nepusti
drop function if exists public.hr_anonymization_ready(text) cascade;
drop table if exists public.hr_corrections;
drop table if exists public.hr_processors;
drop table if exists public.hr_retention_rules;
drop function if exists public.hr_retention_rules_stamp();
drop function if exists public.hr_retention_rules_notify();
drop function if exists public.hr_processors_stamp();
commit;
