-- Rollback migracie 78 (zmena cisla uctu). Oznacenia na overenie sa zmazu
-- (zaznam ostava v audit_log a v upozorneniach jednatela). Vratit aj frontend.
begin;
drop trigger if exists hr_bank_account_changed on public.employee_sensitive_data;
drop function if exists public.hr_bank_account_changed();
drop function if exists public.hr_bank_account_confirm(text);
drop function if exists public.hr_bank_account_last4(text);
drop table if exists public.hr_bank_account_checks;
commit;
