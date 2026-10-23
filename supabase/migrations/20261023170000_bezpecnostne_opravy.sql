-- ============================================================
-- 60. Opravy z nezavislej kontroly vetvy (23. 10. 2026).
--   H1/M4 podpisy zapisuje len server (aj papierovy sken - otisk pocita
--         server, Edge Function hr-signing paper_upload)
--   H2    po finalizacii sa pravne udaje dokumentu nemenia (nova verzia)
--   H3    zaznamy dorucenia zapisuje len server; potvrdenie prevzatia na
--         tablete musi byt skutocny podpisany doklad k tomuto dokumentu;
--         predanie nie pred zamknutim dokumentu
--   M2    uznavany podpis ZAMESTNANCA sa zapocita az s overenym certifikatom
--   M3    verzia sablony: citlivost a mapovanie sa po pouziti nemenia
--   L1    kod z obrazovky HR - pokusy atomicky (zamok riadku)
--   L2    kiosk - limit velkosti konceptu
--   L4    pomocne DEFINER funkcie nie su pre anon
-- Zamerne SECURITY INVOKER pri triggroch s hr_is_server_role().
-- ============================================================

-- ---------- H1/M4: podpisy len zo servera ----------
create or replace function public.hr_document_signatures_server_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.hr_is_server_role() then
    raise exception 'Podpis zapisuje jen server (podpis na tabletu, uznávaný podpis nebo nahraný sken).';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_document_signatures_a_server_only on public.hr_document_signatures;
create trigger hr_document_signatures_a_server_only before insert on public.hr_document_signatures
  for each row execute function public.hr_document_signatures_server_only();
drop policy if exists "hr_document_signatures_insert" on public.hr_document_signatures;

-- ---------- H3: dorucenia len zo servera ----------
create or replace function public.hr_document_deliveries_server_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.hr_is_server_role() then
    raise exception 'Záznam doručení zapisuje jen server (předání, odeslání, potvrzení).';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_document_deliveries_a0_server_only on public.hr_document_deliveries;
create trigger hr_document_deliveries_a0_server_only before insert or update on public.hr_document_deliveries
  for each row execute function public.hr_document_deliveries_server_only();
drop policy if exists "hr_document_deliveries_insert" on public.hr_document_deliveries;
drop policy if exists "hr_document_deliveries_update" on public.hr_document_deliveries;

create or replace function public.hr_document_deliveries_evidence_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked timestamptz;
  v_sig text := nullif(new.confirmation_evidence->>'receipt_signature_id', '');
begin
  if v_sig is not null and (TG_OP = 'INSERT' or v_sig is distinct from nullif(old.confirmation_evidence->>'receipt_signature_id', '')) then
    if not exists (
      select 1 from public.hr_document_signatures s
      join public.hr_documents r on r.id = s.hr_document_id
      where s.id = v_sig and s.signer_type = 'EMPLOYEE'
        and r.doc_type = 'potvrzeni_prevzeti' and r.status in ('SIGNED', 'ARCHIVED')
        and r.variables_snapshot->>'target_document_id' = new.hr_document_id
    ) then
      raise exception 'Potvrzení o převzetí musí být podepsaný doklad k tomuto dokumentu.';
    end if;
  end if;
  if new.channel like 'IN_PERSON%' and new.delivered_at is not null
     and (TG_OP = 'INSERT' or new.delivered_at is distinct from old.delivered_at) then
    select locked_at into v_locked from public.hr_documents where id = new.hr_document_id;
    if v_locked is not null
       and (new.delivered_at at time zone 'Europe/Prague')::date < (v_locked at time zone 'Europe/Prague')::date then
      raise exception 'Datum doručení nemůže být před podpisem dokumentu.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.hr_document_deliveries_evidence_check() from public, anon, authenticated;
drop trigger if exists hr_document_deliveries_evidence_check on public.hr_document_deliveries;
create trigger hr_document_deliveries_evidence_check before insert or update on public.hr_document_deliveries
  for each row execute function public.hr_document_deliveries_evidence_check();

-- ---------- H2: po finalizacii len nova verzia ----------
create or replace function public.hr_documents_final_freeze()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.final_pdf_sha256 is not null and not public.hr_is_server_role() and (
       new.variables_snapshot is distinct from old.variables_snapshot
       or new.doc_type is distinct from old.doc_type
       or new.legal_act_type is distinct from old.legal_act_type
       or new.employee_id is distinct from old.employee_id
       or new.employment_id is distinct from old.employment_id
       or new.template_id is distinct from old.template_id
       or new.template_version_id is distinct from old.template_version_id
       or new.file_path is distinct from old.file_path
       or new.origin is distinct from old.origin
       or new.amends_document_id is distinct from old.amends_document_id
       or new.onboarding_session_id is distinct from old.onboarding_session_id
       or new.version_no is distinct from old.version_no
       or new.supersedes_document_id is distinct from old.supersedes_document_id
       or new.signing_channel is distinct from old.signing_channel) then
    raise exception 'Dokument má finální PDF – údaje nelze měnit, vytvořte novou verzi.';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_documents_a_final_freeze on public.hr_documents;
create trigger hr_documents_a_final_freeze before update on public.hr_documents
  for each row execute function public.hr_documents_final_freeze();

-- ---------- M2: uznavany podpis zamestnanca az s overenym certifikatom ----------
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
             or (s.method = 'ELECTRONIC_TABLET' and s.signed_content_sha256 = d.final_pdf_sha256)
             or (s.method = 'ELECTRONIC_QUALIFIED' and s.signed_content_sha256 = d.final_pdf_sha256
                 and (s.signer_type = 'EMPLOYER' or public.hr_signature_certificate_status(s.id) = 'VALID')))
    );
$$;
revoke execute on function public.hr_document_missing_signers(text) from public, anon;
grant execute on function public.hr_document_missing_signers(text) to authenticated, service_role;

-- ---------- M3: verzia sablony ----------
create or replace function public.hr_document_template_versions_guard()
returns trigger
language plpgsql
set search_path = public
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
     or (old.content_hash is not null and new.content_hash is distinct from old.content_hash)
     or new.required_permissions is distinct from old.required_permissions then
    raise exception 'Verze šablony je neměnná (soubor, otisk, citlivost) - změna = nová verze.';
  end if;
  if (new.mapping_status is distinct from old.mapping_status or new.variables_schema is distinct from old.variables_schema)
     and exists (select 1 from public.hr_documents where template_version_id = old.id) then
    raise exception 'Použitou verzi šablony nelze měnit - změna = nová verze.';
  end if;
  return new;
end;
$$;
revoke all on function public.hr_document_template_versions_guard() from public, anon, authenticated;

-- ---------- L1: kod z obrazovky HR (zamok riadku - paralelne pokusy) ----------
create or replace function public.hr_signing_token_check_code(p_token_id text, p_code_ok boolean, p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.hr_signing_tokens%rowtype;
begin
  select * into t from public.hr_signing_tokens where id = p_token_id for update;
  if t.id is null or t.revoked_at is not null or t.used_at is not null then
    return jsonb_build_object('status', 'REVOKED');
  end if;
  if t.code_verified_at is not null then
    return jsonb_build_object('status', case when t.device_id = p_device_id then 'VERIFIED' else 'OTHER_DEVICE' end);
  end if;
  if p_code_ok then
    update public.hr_signing_tokens set code_verified_at = now(), device_id = p_device_id where id = t.id;
    return jsonb_build_object('status', 'VERIFIED');
  end if;
  update public.hr_signing_tokens set code_attempts = t.code_attempts + 1 where id = t.id;
  return jsonb_build_object('status', case when t.code_attempts + 1 >= 3 then 'REVOKED' else 'WRONG' end, 'attempts', t.code_attempts + 1);
end;
$$;
revoke all on function public.hr_signing_token_check_code(text, boolean, text) from public, anon, authenticated;
grant execute on function public.hr_signing_token_check_code(text, boolean, text) to service_role;

-- ---------- L2: kiosk - velkost konceptu ----------
create or replace function public.hr_onboarding_save_draft(p_session_token text, p_draft_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_column_size(p_draft_data) > 262144 then
    raise exception 'Dotazník je příliš velký.';
  end if;
  update public.onboarding_sessions s
    set draft_data = p_draft_data, last_activity_at = now()
    where s.session_token = p_session_token and s.status = 'IN_PROGRESS'
      and (s.expires_at is null or s.expires_at > now())
      and not exists (select 1 from public.hr_documents d where d.onboarding_session_id = s.id and d.locked_at is not null);
  return found;
end;
$$;

-- ---------- L4 ----------
revoke execute on function public.hr_training_ok(text, text) from public, anon;
revoke execute on function public.hr_signature_certificate_status(text) from public, anon;
revoke execute on function public.hr_document_employer_signature_verified(text) from public, anon;
grant execute on function public.hr_training_ok(text, text) to authenticated, service_role;
grant execute on function public.hr_signature_certificate_status(text) to authenticated, service_role;

-- ---------- Info: sken podpisu len zo servera ----------
drop policy if exists "hr_dokumenty_files_write" on storage.objects;
create policy "hr_dokumenty_files_write" on storage.objects
  for insert
  with check (
    bucket_id = 'hr-dokumenty' and public.current_role() = 'office' and public.hr_has_permission('HR_EDIT')
    and name not like 'prevzeti/%' and name not like 'plne-moci/%' and name not like '%/overeni-podpisu-%'
    and name not like 'zamestnanci-podpisy/%'
  );
