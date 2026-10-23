-- Rollback migracie 57 (faza H - opravnenia). Vrati politiky z baseline
-- a migracie 52 a odstrani kontroly zneplatnenia a podpisu za zamestnavatela.
-- Opravnenia HR_DOCUMENT_VOID / HR_SIGN_FOR_EMPLOYER v hr_permissions
-- ostanu ulozene (bez ucinku), nic sa nemaze.
drop trigger if exists hr_documents_void_permission on public.hr_documents;
drop function if exists public.hr_documents_void_permission();
drop trigger if exists hr_document_signatures_employer_signatory on public.hr_document_signatures;
drop function if exists public.hr_document_signatures_employer_signatory();
drop function if exists public.hr_user_has_permission(uuid, text);

drop policy if exists "hr_document_signatures_view" on public.hr_document_signatures;
create policy "hr_document_signatures_view" on public.hr_document_signatures
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "hr_document_signatures_insert" on public.hr_document_signatures;
create policy "hr_document_signatures_insert" on public.hr_document_signatures
  for insert
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SIGN'));
drop policy if exists "hr_document_deliveries_insert" on public.hr_document_deliveries;
create policy "hr_document_deliveries_insert" on public.hr_document_deliveries
  for insert
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SEND'));
drop policy if exists "hr_document_deliveries_update" on public.hr_document_deliveries;
create policy "hr_document_deliveries_update" on public.hr_document_deliveries
  for update
  using (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SEND'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SEND'));
