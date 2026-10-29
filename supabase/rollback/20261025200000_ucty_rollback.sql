-- Rollback migracie 73 (ucty). Pred rollbackom vypnut Auth hooky
-- (config.toml / nastavenie Auth: password_verification_attempt,
-- mfa_verification_attempt), inak Auth vola neexistujucu funkciu.
-- Zaznamy neuspesnych prihlaseni sa zmazu. Ukoncene pristupy a blokacie
-- uctov ostavaju (odblokovanie: IT, ban_duration "none"). Vratit aj frontend
-- a funkciu hr-ucty.
begin;
drop function if exists public.hr_offboard_user(uuid, uuid, text);
drop function if exists public.hr_account_security_overview();
drop function if exists public.hook_password_verification_attempt(jsonb);
drop function if exists public.hook_mfa_verification_attempt(jsonb);
drop function if exists public.hr_record_login_failure(uuid, text);
drop function if exists public.hr_is_hr_account(uuid);
drop table if exists public.hr_login_failures;
commit;
