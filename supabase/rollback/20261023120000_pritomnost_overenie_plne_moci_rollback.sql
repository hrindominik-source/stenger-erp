-- ROLLBACK migracie 20261023120000_pritomnost_overenie_plne_moci.sql (spustit PRED rollbackom 54).
-- Zastavi sa, ak existuju osoby s plnou mocou, overenia certifikatu, skeny
-- potvrdenia ulozene serverom alebo pouzite podpisove tokeny - najprv exportovat.
-- Spolu s DB treba vratit aj frontend a Edge Functions hr-signing/hr-delivery
-- (kod bez migracie 55 nema odkial vziat osoby s plnou mocou).
begin;
do $$
begin
  if exists (select 1 from public.hr_signatories) or exists (select 1 from public.hr_signature_verifications)
     or exists (select 1 from public.hr_signing_tokens where used_at is not null) then
    raise exception 'Rollback zastaven: existuji osoby s plnou moci, overeni certifikatu nebo pouzite podpisove tokeny.';
  end if;
end;
$$;
set local stenger.hard_delete = 'on';
-- (d) osoby s plnou mocou
drop table if exists public.hr_signatories;
drop function if exists public.hr_signatories_guard();
-- (c) overenie certifikatu
drop trigger if exists hr_document_deliveries_s334_electronic on public.hr_document_deliveries;
drop function if exists public.hr_document_deliveries_s334_electronic();
drop function if exists public.hr_document_employer_signature_verified(text);
drop function if exists public.hr_signature_certificate_status(text);
drop table if exists public.hr_signature_verifications;
drop function if exists public.hr_signature_verifications_guard();
-- (b) sken potvrdenia cez server
drop trigger if exists hr_document_deliveries_receipt_server on public.hr_document_deliveries;
drop function if exists public.hr_document_deliveries_receipt_server();
drop policy if exists "hr_dokumenty_files_write" on storage.objects;
create policy "hr_dokumenty_files_write" on storage.objects
  for insert
  with check (bucket_id = 'hr-dokumenty' and public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'));
-- (a) osobna pritomnost
drop function if exists public.hr_auth_session_active(uuid, uuid);
delete from public.hr_signing_tokens;
alter table public.hr_signing_tokens
  drop column if exists pairing_code_sha256, drop column if exists code_attempts, drop column if exists code_verified_at,
  drop column if exists device_id, drop column if exists hr_session_id;
-- verzia z migracie 54
create or replace function public.hr_signing_tokens_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if coalesce(current_setting('stenger.hard_delete', true), '') = 'on' then
      return old;
    end if;
    raise exception 'Podpisovy token se nemaze.';
  end if;
  if TG_OP = 'INSERT' then
    new.created_at := now();
    return new;
  end if;
  -- len jednorazove doplnenie pouzitia / zrusenia
  if new.token_sha256 is distinct from old.token_sha256 or new.hr_document_id is distinct from old.hr_document_id
     or new.final_pdf_sha256 is distinct from old.final_pdf_sha256 or new.signer_type is distinct from old.signer_type
     or new.signer_name is distinct from old.signer_name or new.identity_verification is distinct from old.identity_verification
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at
     or (old.used_at is not null and new.used_at is distinct from old.used_at)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'Podpisovy token lze jen jednou pouzit nebo zrusit.';
  end if;
  return new;
end;
$$;

-- verzia z migracie 53
create or replace function public.hr_object_path_visible(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_doc_id text;
begin
  if p_path like 'exekuce/%' then
    return public.hr_has_permission('HR_EXEKUCE');
  end if;
  select id into v_doc_id from public.hr_documents
    where file_path = p_path or final_pdf_path = p_path or signed_pdf_path = p_path
    limit 1;
  if v_doc_id is null then
    select hr_document_id into v_doc_id from public.hr_document_signatures where file_path = p_path limit 1;
  end if;
  if v_doc_id is null then
    select hr_document_id into v_doc_id from public.hr_document_deliveries where receipt_scan_path = p_path limit 1;
  end if;
  -- sken potvrdenia o prevzati: klasifikacia dokumentu z cesty (aj pred
  -- vlozenim zaznamu odovzdania); neznamy dokument = neviditelny
  if v_doc_id is null and p_path like 'prevzeti/%' then
    v_doc_id := split_part(p_path, '/', 2);
    if not exists (select 1 from public.hr_documents where id = v_doc_id) then
      return false;
    end if;
  end if;
  if v_doc_id is null then
    return true; -- subor sablony a pod. - baseline HR_VIEW_BASIC uz je vynuteny v policy
  end if;
  return not exists (
    select 1 from unnest(public.hr_document_required_permissions(v_doc_id)) as perm
    where not public.hr_has_permission(perm)
  );
end;
$$;
commit;
