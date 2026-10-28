-- Rollback migracie 68 (zaznam o citani citlivych udajov). Priame citanie
-- tabuliek sa vrati (RLS ostava). Zaznamy 'read' v audit_log ostanu, preto
-- kontrola akcie zostava rozsirena o 'read'. SELECT pre anon sa nevracia (RLS ho aj tak
-- blokovalo). Frontend vratit spolu.
begin;
revoke select (employee_id, created_at, updated_at) on public.employee_sensitive_data from authenticated;
revoke select (employee_id, created_at, updated_at) on public.employee_payroll_data from authenticated;
grant select on public.employee_sensitive_data to authenticated;
grant select on public.employee_payroll_data to authenticated;
drop function if exists public.hr_read_payroll_overview(text[]);
drop function if exists public.hr_read_payroll(text, text);
drop function if exists public.hr_read_sensitive(text, text);
drop function if exists public.hr_log_read(text, text, text, jsonb);
commit;
