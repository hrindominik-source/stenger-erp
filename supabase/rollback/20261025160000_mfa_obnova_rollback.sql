-- Rollback migracie 69 (obnova MFA). Zaznamy resetov v audit_log ostanu.
-- Externa uctovnicka opat bez povinneho MFA. Vratit aj hr-mfa a frontend.
begin;
update public.hr_settings set value = jsonb_set(value, '{required_profiles}', '["KONATEL", "PERSONALISTA"]') where key = 'mfa';
drop function if exists public.hr_mfa_overview();
drop function if exists public.hr_mfa_server_reset(text, text, boolean);
drop function if exists public.hr_mfa_log_reset(uuid, uuid, text, text);
drop function if exists public.hr_mfa_consume_recovery_code(uuid, text);
drop function if exists public.hr_mfa_recovery_remaining();
drop function if exists public.hr_mfa_generate_recovery_codes();
drop function if exists public.hr_mfa_code_hash(text);
drop table if exists public.hr_mfa_recovery_failures;
drop table if exists public.hr_mfa_recovery_codes;
commit;
