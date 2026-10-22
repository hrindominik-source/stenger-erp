-- ROLLBACK migracie 20261022130000_podpisy_dorucovani.sql
-- Spustat LEN po schvaleni a LEN ak este nevznikli ziadne elektronicke podpisy,
-- vyhlasenia ani dorucenia (inak by sa stratili dokazy) - skript to overi sam.
begin;

do $$
begin
  if exists (select 1 from public.hr_document_signatures where method in ('ELECTRONIC_TABLET', 'ELECTRONIC_QUALIFIED'))
     or exists (select 1 from public.employee_contact_declarations)
     or exists (select 1 from public.hr_document_deliveries)
     or exists (select 1 from public.hr_documents where employee_id is null) then
    raise exception 'Rollback zastaven: existuji elektronicke podpisy/vyhlaseni/doruceni nebo dokumenty z dotazniku.';
  end if;
end $$;

-- triggre a funkcie
drop trigger if exists hr_documents_guard on public.hr_documents;
drop trigger if exists hr_document_signatures_guard on public.hr_document_signatures;
drop trigger if exists hr_employees_record_flag_guard on public.employees;
drop function if exists public.hr_documents_guard();
drop function if exists public.hr_document_signatures_guard();
drop function if exists public.hr_employees_record_flag_guard();
drop function if exists public.hr_valid_contact_declaration(text, text);
drop function if exists public.hr_revoke_s335_consent(text, timestamptz, text);
drop function if exists public.hr_kiosk_issue_unlock();
drop function if exists public.hr_onboarding_config();
drop function if exists public.hr_onboarding_cleanup();

-- nove tabulky
drop table if exists public.hr_document_deliveries;
drop table if exists public.employee_contact_declarations;
drop policy if exists "hr_signature_images_view" on public.hr_signature_images;
alter table public.hr_document_signatures drop column if exists signature_image_id;
alter table public.hr_document_signatures drop column if exists intent_text_version_id;
drop table if exists public.hr_signature_images;
drop table if exists public.hr_legal_text_versions;
drop table if exists public.hr_kiosk_unlocks;
drop table if exists public.hr_settings;
drop function if exists public.hr_setting(text);

-- hr_document_signatures
alter table public.hr_document_signatures drop constraint if exists hr_document_signatures_electronic_check;
alter table public.hr_document_signatures drop constraint if exists hr_document_signatures_qualified_check;
alter table public.hr_document_signatures drop column if exists signed_content_sha256;
alter table public.hr_document_signatures drop column if exists intent_text_sha256;
alter table public.hr_document_signatures drop column if exists identity_verification;
alter table public.hr_document_signatures drop column if exists evidence;
alter table public.hr_document_signatures drop column if exists evidence_sha256;
alter table public.hr_document_signatures drop column if exists signer_user_id;
alter table public.hr_document_signatures drop column if exists scan_matches_original_confirmed_by;
alter table public.hr_document_signatures drop constraint if exists hr_document_signatures_method_check;
alter table public.hr_document_signatures add constraint hr_document_signatures_method_check
  check (method in ('PAPER', 'TABLET_SIMPLE', 'ELECTRONIC_SIGNATURE_PROVIDER', 'OTHER'));

-- hr_documents
alter table public.hr_documents drop constraint if exists hr_documents_owner_check;
alter table public.hr_documents drop constraint if exists hr_documents_legal_act_type_check;
alter table public.hr_documents drop constraint if exists hr_documents_signing_channel_check;
alter table public.hr_documents drop constraint if exists hr_documents_final_pdf_check;
alter table public.hr_documents drop constraint if exists hr_documents_void_check;
drop index if exists public.hr_documents_final_pdf_path_uq;
drop index if exists public.hr_documents_onboarding_session_idx;
update public.hr_documents set status = 'ARCHIVED' where status in ('VOIDED', 'SUPERSEDED');
alter table public.hr_documents drop constraint if exists hr_documents_status_check;
alter table public.hr_documents add constraint hr_documents_status_check
  check (status in ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'READY_FOR_SIGNATURE', 'SIGNED', 'ARCHIVED'));
alter table public.hr_documents alter column employee_id set not null;
alter table public.hr_documents
  drop column if exists onboarding_session_id, drop column if exists legal_act_type, drop column if exists version_no,
  drop column if exists supersedes_document_id, drop column if exists final_pdf_path, drop column if exists final_pdf_sha256,
  drop column if exists final_pdf_text_check, drop column if exists finalized_at, drop column if exists finalized_by,
  drop column if exists locked_at, drop column if exists signing_channel, drop column if exists signed_pdf_path,
  drop column if exists signed_pdf_sha256, drop column if exists voided_at, drop column if exists void_reason;

-- onboarding_sessions + kiosk RPC: obnovit povodne definicie zo schema.sql (sekcia 45.8)
update public.onboarding_sessions set status = 'DISCARDED' where status = 'EXPIRED';
alter table public.onboarding_sessions drop constraint if exists onboarding_sessions_status_check;
alter table public.onboarding_sessions add constraint onboarding_sessions_status_check
  check (status in ('IN_PROGRESS', 'SUBMITTED', 'REVIEWED', 'DISCARDED'));
alter table public.onboarding_sessions
  drop column if exists expires_at, drop column if exists last_activity_at,
  drop column if exists draft_purged_at, drop column if exists unlock_id;
drop function if exists public.hr_onboarding_start_session(text);
drop function if exists public.hr_admin_delete_employee(text, text);
alter table public.employees drop constraint if exists employees_record_flag_check;
alter table public.employees drop column if exists record_flag;
-- Potom znovu spustit zo supabase/schema.sql sekcie: 45.6/47 (hr_object_path_visible),
-- 45.7 (hr_admin_delete_employee), 45.8 (hr_onboarding_* RPC).

commit;
