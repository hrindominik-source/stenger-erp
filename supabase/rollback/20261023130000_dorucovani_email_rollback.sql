-- Rollback migracie 56 (faza G - dorucovanie e-mailom). Len ked este
-- neexistuju e-mailove zasielky (inak by sa stratili doklady o dodani,
-- odstupenia a stav odoslania).
do $$
begin
  if exists (select 1 from public.hr_document_deliveries where channel like 'EMAIL%') then
    raise exception 'Existuji e-mailove zasilky - rollback migracie 56 by zahodil dukazy. Zastaveno.';
  end if;
end $$;

drop trigger if exists hr_document_deliveries_a_email_server on public.hr_document_deliveries;
drop trigger if exists hr_document_deliveries_email_rules on public.hr_document_deliveries;
drop function if exists public.hr_document_deliveries_email_server();
drop function if exists public.hr_document_deliveries_email_rules();
drop function if exists public.hr_document_deliveries_sweep();
drop function if exists public.hr_valid_contact_declaration_server(text, text);

alter table public.hr_document_deliveries drop constraint if exists hr_document_deliveries_withdrawal_scan_check;
alter table public.hr_document_deliveries drop constraint if exists hr_document_deliveries_attempts_check;
alter table public.hr_document_deliveries
  drop column if exists provider,
  drop column if exists last_attempt_at,
  drop column if exists provider_delivered_at,
  drop column if exists withdrawal_scan_path,
  drop column if exists withdrawal_scan_sha256;
