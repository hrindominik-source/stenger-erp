-- ============================================================
-- 55. Doplnky pred fazou G:
--   (a) podpis na tablete len pri osobnej pritomnosti: QR na obrazovke HR +
--       kratky jednorazovy kod, zariadenie a relacia HR v dokazoch, 3 zle
--       kody = odkaz zruseny, platnost len pocas aktivnej relacie HR;
--   (b) hash skenu potvrdenia o prevzati pocita server (klient sken nenahra);
--   (c) overenie certifikatu uznavaneho podpisu (zaznam + protokol) a
--       elektronicke dorucenie pisomnosti § 334 len pri overenom podpise;
--   (d) osoby s plnou mocou v DB (spravuje HR_ADMIN, audit).
--   Texty su KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.
-- ============================================================

-- ---------- (a) osobna pritomnost ----------
-- Tabulka z migracie 54 este nie je nasadena nikde mimo lokalu - stlpce
-- mozu byt povinne.
alter table public.hr_signing_tokens
  add column if not exists pairing_code_sha256 text not null check (pairing_code_sha256 ~ '^[0-9a-f]{64}$'),
  add column if not exists code_attempts int not null default 0 check (code_attempts between 0 and 3),
  add column if not exists code_verified_at timestamptz,
  add column if not exists device_id text check (device_id is null or device_id ~ '^[A-Za-z0-9-]{16,64}$'),
  add column if not exists hr_session_id uuid not null;

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
    new.code_attempts := 0;
    new.code_verified_at := null;
    new.device_id := null;
    new.used_at := null;
    new.revoked_at := null;
    return new;
  end if;
  if new.token_sha256 is distinct from old.token_sha256 or new.hr_document_id is distinct from old.hr_document_id
     or new.final_pdf_sha256 is distinct from old.final_pdf_sha256 or new.signer_type is distinct from old.signer_type
     or new.signer_name is distinct from old.signer_name or new.identity_verification is distinct from old.identity_verification
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at or new.pairing_code_sha256 is distinct from old.pairing_code_sha256
     or new.hr_session_id is distinct from old.hr_session_id
     or (old.used_at is not null and new.used_at is distinct from old.used_at)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     or (old.code_verified_at is not null and new.code_verified_at is distinct from old.code_verified_at)
     or (old.device_id is not null and new.device_id is distinct from old.device_id)
     or new.code_attempts < old.code_attempts or new.code_attempts > old.code_attempts + 1 then
    raise exception 'Podpisovy token lze jen jednou overit kodem, pouzit nebo zrusit.';
  end if;
  if old.revoked_at is not null or old.used_at is not null then
    raise exception 'Podpisovy token uz neplati.';
  end if;
  if new.code_verified_at is not null and new.device_id is null then
    raise exception 'Overeni kodem vyzaduje identifikator zarizeni.';
  end if;
  if new.used_at is not null and new.code_verified_at is null then
    raise exception 'Podpis bez overeni kodem z obrazovky HR neni mozny.';
  end if;
  -- tri zle kody = odkaz zruseny
  if new.code_attempts >= 3 and new.code_verified_at is null then
    new.revoked_at := coalesce(new.revoked_at, now());
  end if;
  return new;
end;
$$;

-- Relacia HR, ktora overila doklad, musi byt stale aktivna (odhlasenie HR
-- = odkaz neplati). Len pre server.
create or replace function public.hr_auth_session_active(p_session_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.sessions
    where id = p_session_id and user_id = p_user_id and (not_after is null or not_after > now())
  );
$$;
revoke all on function public.hr_auth_session_active(uuid, uuid) from public, anon, authenticated;
grant execute on function public.hr_auth_session_active(uuid, uuid) to service_role;

-- ---------- (b) sken potvrdenia o prevzati len cez server ----------
-- SECURITY INVOKER: hr_is_server_role() cita current_user volajuceho.
create or replace function public.hr_document_deliveries_receipt_server()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.receipt_scan_path is not null and (TG_OP = 'INSERT' or old.receipt_scan_path is null)
     and not public.hr_is_server_role() then
    raise exception 'Sken potvrzeni o prevzeti uklada server (otisk pocita server, ne prohlizec).';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_document_deliveries_receipt_server on public.hr_document_deliveries;
create trigger hr_document_deliveries_receipt_server before insert or update on public.hr_document_deliveries
  for each row execute function public.hr_document_deliveries_receipt_server();

-- Klient nezapisuje do prevzeti/ ani plne-moci/ (subory s hashom zo servera).
drop policy if exists "hr_dokumenty_files_write" on storage.objects;
create policy "hr_dokumenty_files_write" on storage.objects
  for insert
  with check (
    bucket_id = 'hr-dokumenty' and public.current_role() = 'office' and public.hr_has_permission('HR_EDIT')
    and name not like 'prevzeti/%' and name not like 'plne-moci/%' and name not like '%/overeni-podpisu-%'
  );

-- ---------- (c) overenie certifikatu uznavaneho podpisu ----------
create table if not exists public.hr_signature_verifications (
  id text primary key default gen_random_uuid()::text,
  signature_id text not null references public.hr_document_signatures(id) on delete cascade,
  result text not null check (result in ('VALID', 'INVALID', 'INDETERMINATE')),
  method text not null check (method in ('MANUAL_PUBLIC_SERVICE', 'AUTOMATIC')),
  service_name text not null,
  protocol_path text,
  protocol_sha256 text check (protocol_sha256 is null or protocol_sha256 ~ '^[0-9a-f]{64}$'),
  verified_by uuid references auth.users(id),
  verified_by_name text,
  verified_at timestamptz not null default now(),
  note text,
  check ((protocol_path is null) = (protocol_sha256 is null)),
  check (method <> 'MANUAL_PUBLIC_SERVICE' or (protocol_path is not null and verified_by is not null))
);
create index if not exists hr_signature_verifications_sig_idx on public.hr_signature_verifications (signature_id);
alter table public.hr_signature_verifications enable row level security;
drop policy if exists "hr_signature_verifications_view" on public.hr_signature_verifications;
create policy "hr_signature_verifications_view" on public.hr_signature_verifications
  for select
  using (
    public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC')
    and exists (select 1 from public.hr_document_signatures s join public.hr_documents d on d.id = s.hr_document_id where s.id = signature_id)
  );
-- zapis len server (protokol nahra a zahashuje Edge Function)

create or replace function public.hr_signature_verifications_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_method text;
begin
  if TG_OP = 'DELETE' then
    if coalesce(current_setting('stenger.hard_delete', true), '') = 'on' then
      return old;
    end if;
    raise exception 'Zaznam o overeni podpisu se nemaze.';
  end if;
  if TG_OP = 'UPDATE' then
    raise exception 'Zaznam o overeni podpisu nelze menit - vytvorte novy.';
  end if;
  select method into v_method from public.hr_document_signatures where id = new.signature_id;
  if v_method is distinct from 'ELECTRONIC_QUALIFIED' then
    raise exception 'Overeni certifikatu jen u uznavaneho elektronickeho podpisu.';
  end if;
  new.verified_at := clock_timestamp(); -- poradie overeni aj v jednej transakcii
  return new;
end;
$$;
drop trigger if exists hr_signature_verifications_guard on public.hr_signature_verifications;
create trigger hr_signature_verifications_guard before insert or update or delete on public.hr_signature_verifications
  for each row execute function public.hr_signature_verifications_guard();
drop trigger if exists audit_hr_signature_verifications on public.hr_signature_verifications;
create trigger audit_hr_signature_verifications after insert or update or delete on public.hr_signature_verifications
  for each row execute function public.audit_trigger();

-- Stav certifikatu podpisu: posledne overenie, inak NOT_VERIFIED.
create or replace function public.hr_signature_certificate_status(p_signature_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select result from public.hr_signature_verifications where signature_id = p_signature_id order by verified_at desc, id desc limit 1),
    'NOT_VERIFIED');
$$;

-- Pisomnost § 334 sa elektronicky doruci len s uznavanym podpisom
-- zamestnavatela, ktoreho certifikat bol overeny (VALID).
create or replace function public.hr_document_employer_signature_verified(p_document_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hr_document_signatures s
    join public.hr_documents d on d.id = s.hr_document_id
    where s.hr_document_id = p_document_id and s.signer_type = 'EMPLOYER' and s.method = 'ELECTRONIC_QUALIFIED'
      and s.signed_content_sha256 = d.final_pdf_sha256
      and public.hr_signature_certificate_status(s.id) = 'VALID'
  );
$$;
grant execute on function public.hr_document_employer_signature_verified(text) to authenticated, service_role;

create or replace function public.hr_document_deliveries_s334_electronic()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.hr_documents%rowtype;
begin
  if TG_OP = 'INSERT' and new.channel like 'EMAIL%' then
    select * into v_doc from public.hr_documents where id = new.hr_document_id;
    if public.hr_is_s334_document(v_doc.doc_type, v_doc.legal_act_type)
       and not public.hr_document_employer_signature_verified(v_doc.id) then
      raise exception 'Pisemnost § 334 lze elektronicky dorucit jen s uznavanym podpisem zamestnavatele s overenym certifikatem.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists hr_document_deliveries_s334_electronic on public.hr_document_deliveries;
create trigger hr_document_deliveries_s334_electronic before insert on public.hr_document_deliveries
  for each row execute function public.hr_document_deliveries_s334_electronic();

-- ---------- (d) osoby s plnou mocou ----------
create table if not exists public.hr_signatories (
  id text primary key default gen_random_uuid()::text,
  full_name text not null check (length(trim(full_name)) > 2),          -- s titulom, ako v dokumente
  full_name_instrumental text not null check (length(trim(full_name_instrumental)) > 2), -- 7. pad ("zastoupená kým")
  user_id uuid references auth.users(id),                                -- ucet, ktorym podpisuje elektronicky
  valid_from date not null,
  valid_to date,
  poa_scan_path text unique,
  poa_scan_sha256 text check (poa_scan_sha256 is null or poa_scan_sha256 ~ '^[0-9a-f]{64}$'),
  sensitivity text not null default 'HR_VIEW_SENSITIVE' check (sensitivity in ('HR_VIEW_BASIC', 'HR_VIEW_SENSITIVE')),
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  check ((poa_scan_path is null) = (poa_scan_sha256 is null)),
  check (poa_scan_path is null or poa_scan_path like 'plne-moci/%')
);
alter table public.hr_signatories enable row level security;
drop policy if exists "hr_signatories_view" on public.hr_signatories;
create policy "hr_signatories_view" on public.hr_signatories
  for select using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "hr_signatories_insert" on public.hr_signatories;
create policy "hr_signatories_insert" on public.hr_signatories
  for insert with check (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN'));
drop policy if exists "hr_signatories_update" on public.hr_signatories;
create policy "hr_signatories_update" on public.hr_signatories
  for update using (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN'));
-- ziadna delete policy: plna moc sa ukonci datumom valid_to

create or replace function public.hr_signatories_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if coalesce(current_setting('stenger.hard_delete', true), '') = 'on' then
      return old;
    end if;
    raise exception 'Osoba s plnou moci se nemaze - ukoncete platnost.';
  end if;
  if TG_OP = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.poa_scan_path is not null and not public.hr_is_server_role() then
      raise exception 'Sken plne moci uklada server.';
    end if;
  else
    if new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by then
      raise exception 'Zalozeni zaznamu nelze menit.';
    end if;
    if old.poa_scan_path is not null and (new.poa_scan_path is distinct from old.poa_scan_path or new.poa_scan_sha256 is distinct from old.poa_scan_sha256) then
      raise exception 'Sken plne moci je nemenny - pro novou plnou moc zalozte novy zaznam.';
    end if;
    if new.poa_scan_path is distinct from old.poa_scan_path and not public.hr_is_server_role() then
      raise exception 'Sken plne moci uklada server.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists hr_signatories_guard on public.hr_signatories;
create trigger hr_signatories_guard before insert or update or delete on public.hr_signatories
  for each row execute function public.hr_signatories_guard();
drop trigger if exists audit_hr_signatories on public.hr_signatories;
create trigger audit_hr_signatories after insert or update or delete on public.hr_signatories
  for each row execute function public.audit_trigger();

-- ---------- viditelnost suborov ----------
create or replace function public.hr_object_path_visible(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_doc_id text;
  v_sens text;
begin
  if p_path like 'exekuce/%' then
    return public.hr_has_permission('HR_EXEKUCE');
  end if;
  -- sken plnej moci: citlivost zaznamu; neznamy subor len HR_ADMIN
  if p_path like 'plne-moci/%' then
    select sensitivity into v_sens from public.hr_signatories where poa_scan_path = p_path;
    return public.hr_has_permission(coalesce(v_sens, 'HR_ADMIN'));
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
  if v_doc_id is null then
    select s.hr_document_id into v_doc_id from public.hr_signature_verifications v
      join public.hr_document_signatures s on s.id = v.signature_id where v.protocol_path = p_path limit 1;
  end if;
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
