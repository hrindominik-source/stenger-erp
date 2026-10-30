-- Rollback migracie 79 (hr_nastaveni). Kontakt na lekara sa zmaze (zaznam
-- ostava v audit_log). Vratit aj frontend (blok Pokyny k prohlidce).
begin;
drop table if exists public.hr_nastaveni;
commit;
