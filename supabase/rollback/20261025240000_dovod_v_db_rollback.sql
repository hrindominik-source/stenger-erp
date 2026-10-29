-- Rollback migracie 77 (povinny dovod zmeny v DB). Zaznamy dovodov v
-- hr_corrections ostavaju. Frontend (hr_change_reason_begin/finish) vratit spolu.
begin;
drop trigger if exists hr_require_change_reason on public.employees;
drop trigger if exists hr_require_change_reason on public.employee_sensitive_data;
drop trigger if exists hr_require_change_reason on public.employee_payroll_data;
drop trigger if exists hr_require_change_reason on public.employment_relationships;
drop function if exists public.hr_require_change_reason();
drop function if exists public.hr_change_reason_present(text);
drop function if exists public.hr_change_reason_finish(text);
drop function if exists public.hr_change_reason_begin(text, text, text[]);
alter table public.hr_corrections drop column if exists finished_at;
commit;
