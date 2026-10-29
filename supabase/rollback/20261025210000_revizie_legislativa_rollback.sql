-- Rollback migracie 74 (revizie, legislativa). Potvrdenia revizii a stav
-- strazcu sa zmazu (zaznam ostava v audit_log). Vratit aj frontend a funkciu
-- hr-legislativa (a planovac na serveri).
begin;
drop function if exists public.hr_legislation_record(text, text, text, text);
drop function if exists public.hr_revision_confirm(date, text);
drop function if exists public.hr_revision_notify();
drop function if exists public.hr_revision_due_list();
drop function if exists public.hr_revision_items();
drop function if exists public.hr_revision_period(date);
drop table if exists public.hr_legislation_watch;
drop function if exists public.hr_legislation_watch_stamp();
drop table if exists public.hr_revision_reviews;
commit;
