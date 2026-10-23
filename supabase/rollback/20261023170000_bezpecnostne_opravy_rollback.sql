-- Rollback migracie 60 (opravy z nezavislej kontroly). Spustit PRED
-- rollbackom 59; spolu vratit frontend a funkcie hr-signing, hr-kiosk
-- (starsi frontend zapisuje papierovy sken priamo). Data sa nemenia.
-- Odobrate prava anon na pomocne funkcie (L4) ostavaju odobrate.
begin;

drop trigger if exists hr_document_signatures_a_server_only on public.hr_document_signatures;
drop function if exists public.hr_document_signatures_server_only();
drop trigger if exists hr_document_deliveries_a0_server_only on public.hr_document_deliveries;
drop function if exists public.hr_document_deliveries_server_only();
drop trigger if exists hr_document_deliveries_evidence_check on public.hr_document_deliveries;
drop function if exists public.hr_document_deliveries_evidence_check();
drop trigger if exists hr_documents_a_final_freeze on public.hr_documents;
drop function if exists public.hr_documents_final_freeze();
drop function if exists public.hr_signing_token_check_code(text, boolean, text);

-- politiky podla migracie 57
create policy "hr_document_signatures_insert" on public.hr_document_signatures
  for insert
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SIGN')
    and exists (select 1 from public.hr_documents d where d.id = hr_document_signatures.hr_document_id));
create policy "hr_document_deliveries_insert" on public.hr_document_deliveries
  for insert
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SEND')
    and exists (select 1 from public.hr_documents d where d.id = hr_document_deliveries.hr_document_id));
create policy "hr_document_deliveries_update" on public.hr_document_deliveries
  for update
  using (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SEND')
    and exists (select 1 from public.hr_documents d where d.id = hr_document_deliveries.hr_document_id))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SEND')
    and exists (select 1 from public.hr_documents d where d.id = hr_document_deliveries.hr_document_id));

-- uplny podpis podla migracie 51
create or replace function public.hr_document_missing_signers(p_document_id text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(r order by r), '{}'::text[])
  from public.hr_documents d
  cross join lateral unnest(public.hr_required_signers(coalesce(d.legal_act_type, public.hr_default_legal_act_type(d.doc_type)))) as r
  where d.id = p_document_id
    and not exists (
      select 1 from public.hr_document_signatures s
      where s.hr_document_id = d.id and s.signer_type = r
        and (s.method = 'PAPER'
             or (s.method in ('ELECTRONIC_TABLET', 'ELECTRONIC_QUALIFIED') and s.signed_content_sha256 = d.final_pdf_sha256))
    );
$$;

-- nemennost verzie sablony podla migracie 59
create or replace function public.hr_document_template_versions_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.hr_documents where template_version_id = old.id) then
      raise exception 'Verzi šablony použitou v dokumentech nelze smazat.';
    end if;
    return old;
  end if;
  if new.template_id is distinct from old.template_id
     or new.version_number is distinct from old.version_number
     or new.file_path is distinct from old.file_path
     or (old.content_hash is not null and new.content_hash is distinct from old.content_hash) then
    raise exception 'Verze šablony je neměnná - změna = nová verze.';
  end if;
  return new;
end;
$$;

-- koncept dotaznika podla migracie 50
create or replace function public.hr_onboarding_save_draft(p_session_token text, p_draft_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.onboarding_sessions s
    set draft_data = p_draft_data, last_activity_at = now()
    where s.session_token = p_session_token and s.status = 'IN_PROGRESS'
      and (s.expires_at is null or s.expires_at > now())
      and not exists (select 1 from public.hr_documents d where d.onboarding_session_id = s.id and d.locked_at is not null);
  return found;
end;
$$;

-- zapis do ulozista podla migracie 55
drop policy if exists "hr_dokumenty_files_write" on storage.objects;
create policy "hr_dokumenty_files_write" on storage.objects
  for insert
  with check (
    bucket_id = 'hr-dokumenty' and public.current_role() = 'office' and public.hr_has_permission('HR_EDIT')
    and name not like 'prevzeti/%' and name not like 'plne-moci/%' and name not like '%/overeni-podpisu-%'
  );

commit;
