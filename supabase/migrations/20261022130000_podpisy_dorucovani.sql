-- ============================================================
-- 48. Podpisy, nemenne dokumenty a dorucovanie (§ 21 / § 334-335 ZP)
--     Faza B zadania docs/podpisy-dorucovani. VYLUCNE ADITIVNE - ziadny
--     existujuci stlpec/riadok sa nemaze. Zatial IBA LOKALNE; nasadenie
--     do produkcie az po schvaleni (docs/podpisy-dorucovani/nasadenie.md).
--
--     Tri osi stavu dokumentu su oddelene:
--       (a) zivotny cyklus  = hr_documents.status (+ finalized_at/locked_at/voided_at)
--       (b) podpisy         = odvodene z hr_document_signatures
--       (c) odovzdanie      = hr_document_deliveries
--     SIGNED nikdy neznamena dorucene.
-- ============================================================

create extension if not exists pgcrypto;

-- 48.1 hr_settings - konfiguracia a feature flagy (pravne neiste body nie su
--      natvrdo v kode - bod 2 zadania). Citat moze kazdy office s HR_VIEW_BASIC,
--      menit len HR_ADMIN. Kiosk (anon) cita len bezpecnu cast cez RPC 48.9.
create table if not exists public.hr_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.hr_settings enable row level security;
drop policy if exists "hr_settings_view" on public.hr_settings;
create policy "hr_settings_view" on public.hr_settings
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "hr_settings_admin" on public.hr_settings;
create policy "hr_settings_admin" on public.hr_settings
  for all
  using (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN'));
drop trigger if exists audit_hr_settings on public.hr_settings;
create trigger audit_hr_settings after insert or update or delete on public.hr_settings
  for each row execute function public.audit_trigger();

insert into public.hr_settings (key, value, description) values
  ('s335_consent_enabled', 'false'::jsonb,
   'Souhlas s elektronickym dorucovanim pisemnosti (§ 335 ZP) v kiosku a v karte. Predvolene vypnuto.'),
  ('electronic_contract_enabled', 'false'::jsonb,
   'Elektronicke uzavirani smluv podle § 21 ZP (podpis na tabletu + zaslani vyhotoveni).'),
  ('s21_tablet_in_person_conservative', 'true'::jsonb,
   'Pravne nejiste: i podpis na tabletu zamestnavatele pri osobnim setkani se povazuje za elektronicke uzavreni (zaslani na § 21 adresu + 7denni lhuta). Nemenit bez pravnicky.'),
  ('email_mode', '"mock"'::jsonb,
   'Odesilani e-mailu: mock (testovaci schranka) | provider. V produkci zatim jen mock.'),
  ('kiosk', '{"session_ttl_hours": 8, "max_new_sessions_per_hour": 30, "device_unlock_required": false, "unlock_ttl_minutes": 15}'::jsonb,
   'Kiosk ?kiosk=nastup: platnost relace, limit novych relaci za hodinu, volitelne odemceni zarizeni pres HR (feature flag).'),
  ('wage_notice_reminder_day', '10'::jsonb,
   'Mzdovy vymer zaslany na jinou adresu (§ 335 odst. 3): den, kdy HR dostane upozorneni na chybejici potvrzeni.')
on conflict (key) do nothing;

create or replace function public.hr_setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select value from public.hr_settings where key = p_key;
$$;
revoke execute on function public.hr_setting(text) from public, anon;
grant execute on function public.hr_setting(text) to authenticated;

-- 48.2 hr_legal_text_versions - verzovane texty vyhlaseni, pouceni a prejavu
--      vole (bod I zadania). Zmena textu = nova verzia; stare podpisy ostavaju
--      viazane na stary text (sha256). Telo sa po vlozeni nikdy nemeni.
create table if not exists public.hr_legal_text_versions (
  id text primary key,
  text_key text not null,              -- napr. S21_ADDRESS_NOTICE, S335_NOTICE, S335_CONSENT, INTENT_BILATERAL_CONTRACT
  version_no int not null,
  title text not null,
  body text not null,
  body_sha256 text not null,
  status text not null default 'KONCEPT' check (status in ('KONCEPT', 'SCHVALENO', 'VYRAZENO')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (text_key, version_no)
);
alter table public.hr_legal_text_versions enable row level security;
drop policy if exists "hr_legal_texts_view" on public.hr_legal_text_versions;
create policy "hr_legal_texts_view" on public.hr_legal_text_versions
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "hr_legal_texts_insert" on public.hr_legal_text_versions;
create policy "hr_legal_texts_insert" on public.hr_legal_text_versions
  for insert
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_LEGAL_TEXTS_ADMIN'));
drop policy if exists "hr_legal_texts_update" on public.hr_legal_text_versions;
create policy "hr_legal_texts_update" on public.hr_legal_text_versions
  for update
  using (public.current_role() = 'office' and public.hr_has_permission('HR_LEGAL_TEXTS_ADMIN'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_LEGAL_TEXTS_ADMIN'));

-- Telo/hash/kluc su nemenne; menit sa smie len stav (schvalenie/vyradenie).
create or replace function public.hr_legal_texts_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    new.body_sha256 := encode(extensions.digest(convert_to(new.body, 'UTF8'), 'sha256'), 'hex');
    return new;
  end if;
  if TG_OP = 'DELETE' then
    raise exception 'Verze pravniho textu nelze smazat.';
  end if;
  if new.text_key is distinct from old.text_key or new.version_no is distinct from old.version_no
     or new.title is distinct from old.title or new.body is distinct from old.body
     or new.body_sha256 is distinct from old.body_sha256 or new.created_at is distinct from old.created_at then
    raise exception 'Text verze je nemenny - vytvorte novou verzi.';
  end if;
  if old.status = 'VYRAZENO' and new.status <> 'VYRAZENO' then
    raise exception 'Vyrazenou verzi nelze znovu aktivovat.';
  end if;
  if new.status = 'SCHVALENO' and old.status <> 'SCHVALENO' then
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'Udaje o schvaleni nelze menit.';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_legal_texts_guard on public.hr_legal_text_versions;
create trigger hr_legal_texts_guard before insert or update or delete on public.hr_legal_text_versions
  for each row execute function public.hr_legal_texts_guard();
drop trigger if exists audit_hr_legal_text_versions on public.hr_legal_text_versions;
create trigger audit_hr_legal_text_versions after insert or update or delete on public.hr_legal_text_versions
  for each row execute function public.audit_trigger();

-- 48.3 hr_documents - rozsirenie (bod 4.3 zadania)
alter table public.hr_documents alter column employee_id drop not null;
alter table public.hr_documents add column if not exists onboarding_session_id text references public.onboarding_sessions(id);
alter table public.hr_documents add column if not exists legal_act_type text;
alter table public.hr_documents add column if not exists version_no int not null default 1;
alter table public.hr_documents add column if not exists supersedes_document_id text references public.hr_documents(id);
alter table public.hr_documents add column if not exists final_pdf_path text;
alter table public.hr_documents add column if not exists final_pdf_sha256 text;
alter table public.hr_documents add column if not exists final_pdf_text_check jsonb;
alter table public.hr_documents add column if not exists finalized_at timestamptz;
alter table public.hr_documents add column if not exists finalized_by uuid references auth.users(id);
alter table public.hr_documents add column if not exists locked_at timestamptz;
alter table public.hr_documents add column if not exists signing_channel text;
alter table public.hr_documents add column if not exists signed_pdf_path text;
alter table public.hr_documents add column if not exists signed_pdf_sha256 text;
alter table public.hr_documents add column if not exists voided_at timestamptz;
alter table public.hr_documents add column if not exists void_reason text;

alter table public.hr_documents drop constraint if exists hr_documents_owner_check;
alter table public.hr_documents add constraint hr_documents_owner_check
  check (employee_id is not null or onboarding_session_id is not null);
alter table public.hr_documents drop constraint if exists hr_documents_legal_act_type_check;
alter table public.hr_documents add constraint hr_documents_legal_act_type_check
  check (legal_act_type is null or legal_act_type in (
    'BILATERAL_CONTRACT', 'EMPLOYER_UNILATERAL', 'EMPLOYEE_DECLARATION', 'RECEIPT_ACKNOWLEDGEMENT', 'TRAINING_RECORD'
  ));
alter table public.hr_documents drop constraint if exists hr_documents_signing_channel_check;
alter table public.hr_documents add constraint hr_documents_signing_channel_check
  check (signing_channel is null or signing_channel in ('PAPER', 'ELECTRONIC'));
alter table public.hr_documents drop constraint if exists hr_documents_status_check;
alter table public.hr_documents add constraint hr_documents_status_check
  check (status in (
    'DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'READY_FOR_SIGNATURE', 'SIGNED', 'ARCHIVED', 'VOIDED', 'SUPERSEDED'
  ));
alter table public.hr_documents drop constraint if exists hr_documents_final_pdf_check;
alter table public.hr_documents add constraint hr_documents_final_pdf_check
  check ((finalized_at is null) = (final_pdf_sha256 is null) and (finalized_at is null) = (final_pdf_path is null));
alter table public.hr_documents drop constraint if exists hr_documents_void_check;
alter table public.hr_documents add constraint hr_documents_void_check
  check ((voided_at is null) = (status <> 'VOIDED') and (voided_at is null or coalesce(trim(void_reason), '') <> ''));
create unique index if not exists hr_documents_final_pdf_path_uq on public.hr_documents (final_pdf_path) where final_pdf_path is not null;
create index if not exists hr_documents_onboarding_session_idx on public.hr_documents (onboarding_session_id) where onboarding_session_id is not null;

-- Nemennost po zamknuti (bod 5 / C zadania). Plati aj pre service role -
-- jedina vynimka je hr_admin_delete_employee (set_config stenger.hard_delete).
create or replace function public.hr_documents_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if coalesce(current_setting('stenger.hard_delete', true), '') = 'on' then
      return old;
    end if;
    raise exception 'HR dokumenty se nemazou - pouzijte zneplatneni (VOIDED).';
  end if;

  -- Podpisany dokument je vzdy zamknuty (aj papierovy postup cez sken).
  if new.status = 'SIGNED' and new.locked_at is null then
    new.locked_at := now();
  end if;
  if TG_OP = 'INSERT' then
    if new.status = 'VOIDED' then
      raise exception 'Novy dokument nemuze byt rovnou zneplatneny.';
    end if;
    return new;
  end if;
  if new.status = 'VOIDED' and old.status <> 'VOIDED' then
    new.voided_at := coalesce(new.voided_at, now());
  end if;

  if old.locked_at is not null then
    if new.locked_at is distinct from old.locked_at then
      raise exception 'Zamceni dokumentu nelze zrusit.';
    end if;
    if new.doc_type is distinct from old.doc_type
       or new.template_id is distinct from old.template_id
       or new.template_version_id is distinct from old.template_version_id
       or new.origin is distinct from old.origin
       or new.file_path is distinct from old.file_path
       or new.variables_snapshot is distinct from old.variables_snapshot
       or new.final_pdf_path is distinct from old.final_pdf_path
       or new.final_pdf_sha256 is distinct from old.final_pdf_sha256
       or new.final_pdf_text_check is distinct from old.final_pdf_text_check
       or new.finalized_at is distinct from old.finalized_at
       or new.finalized_by is distinct from old.finalized_by
       or new.legal_act_type is distinct from old.legal_act_type
       or new.version_no is distinct from old.version_no
       or new.supersedes_document_id is distinct from old.supersedes_document_id
       or new.signing_channel is distinct from old.signing_channel
       or new.employment_id is distinct from old.employment_id
       or new.onboarding_session_id is distinct from old.onboarding_session_id
       or new.generated_at is distinct from old.generated_at
       or new.generated_by is distinct from old.generated_by
       or new.is_manual_history_entry is distinct from old.is_manual_history_entry then
      raise exception 'Dokument je po podpisu zamceny - zmena obsahu neni mozna, vytvorte novou verzi.';
    end if;
    -- Prerazeni z dotaznikove relace na zamestnance (bez zmeny obsahu).
    if new.employee_id is distinct from old.employee_id and old.employee_id is not null then
      raise exception 'Zamceny dokument nelze presunout jinemu zamestnanci.';
    end if;
    -- Podpisany original sa zapise raz.
    if old.signed_pdf_path is not null and (new.signed_pdf_path is distinct from old.signed_pdf_path
       or new.signed_pdf_sha256 is distinct from old.signed_pdf_sha256) then
      raise exception 'Podepsany original je jiz ulozen.';
    end if;
    if old.voided_at is not null and (new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason) then
      raise exception 'Zneplatneni nelze menit.';
    end if;
    if old.status in ('SIGNED', 'ARCHIVED', 'VOIDED', 'SUPERSEDED')
       and new.status not in ('SIGNED', 'ARCHIVED', 'VOIDED', 'SUPERSEDED') then
      raise exception 'Podepsany dokument nelze vratit do rozpracovaneho stavu.';
    end if;
    if old.status in ('VOIDED', 'SUPERSEDED') and new.status <> old.status then
      raise exception 'Zneplatneny/nahrazeny dokument nelze obnovit.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists hr_documents_guard on public.hr_documents;
create trigger hr_documents_guard before insert or update or delete on public.hr_documents
  for each row execute function public.hr_documents_guard();

-- 48.4 hr_signature_images - obrazok podpisu (PNG) priamo v DB, jeden riadok
--      = jeden podpisovy zaznam (podpis z dotaznika sa nesmie pouzit inde -
--      unique na hr_document_signatures.signature_image_id). V DB namiesto
--      storage: kiosk (anon) do storage nesmie, a riadok je chraneny rovnakym
--      triggrom nemennosti.
create table if not exists public.hr_signature_images (
  id text primary key,
  png bytea not null check (octet_length(png) between 100 and 300000),
  png_sha256 text not null,
  strokes jsonb,
  created_at timestamptz not null default now()
);
alter table public.hr_signature_images enable row level security;
-- Citanie len cez podpis, ktory na obrazok odkazuje (policy nizsie po 48.5).
-- Vkladanie LEN cez RPC (security definer) - ziadna insert policy.
create or replace function public.hr_signature_images_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    new.png_sha256 := encode(extensions.digest(new.png, 'sha256'), 'hex');
    return new;
  end if;
  if TG_OP = 'DELETE' and coalesce(current_setting('stenger.hard_delete', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Obrazek podpisu je nemenny.';
end;
$$;
drop trigger if exists hr_signature_images_guard on public.hr_signature_images;
create trigger hr_signature_images_guard before insert or update or delete on public.hr_signature_images
  for each row execute function public.hr_signature_images_guard();

-- 48.5 hr_document_signatures - rozsirenie (bod 4.4 zadania)
alter table public.hr_document_signatures drop constraint if exists hr_document_signatures_method_check;
alter table public.hr_document_signatures add constraint hr_document_signatures_method_check
  check (method in (
    'PAPER', 'ELECTRONIC_TABLET', 'ELECTRONIC_QUALIFIED',
    'TABLET_SIMPLE', 'ELECTRONIC_SIGNATURE_PROVIDER', 'OTHER' -- povodne hodnoty, nepouzivane
  ));
alter table public.hr_document_signatures add column if not exists signed_content_sha256 text;
alter table public.hr_document_signatures add column if not exists signature_image_id text references public.hr_signature_images(id);
alter table public.hr_document_signatures add column if not exists intent_text_version_id text references public.hr_legal_text_versions(id);
alter table public.hr_document_signatures add column if not exists intent_text_sha256 text;
alter table public.hr_document_signatures add column if not exists identity_verification jsonb;
alter table public.hr_document_signatures add column if not exists evidence jsonb not null default '{}'::jsonb;
alter table public.hr_document_signatures add column if not exists evidence_sha256 text;
alter table public.hr_document_signatures add column if not exists signer_user_id uuid references auth.users(id);
alter table public.hr_document_signatures add column if not exists scan_matches_original_confirmed_by uuid references auth.users(id);
create unique index if not exists hr_document_signatures_image_uq
  on public.hr_document_signatures (signature_image_id) where signature_image_id is not null;
alter table public.hr_document_signatures drop constraint if exists hr_document_signatures_electronic_check;
alter table public.hr_document_signatures add constraint hr_document_signatures_electronic_check
  check (method <> 'ELECTRONIC_TABLET' or (
    signed_content_sha256 is not null and signature_image_id is not null
    and intent_text_version_id is not null and intent_text_sha256 is not null
  ));
alter table public.hr_document_signatures drop constraint if exists hr_document_signatures_qualified_check;
alter table public.hr_document_signatures add constraint hr_document_signatures_qualified_check
  check (method <> 'ELECTRONIC_QUALIFIED' or (signed_content_sha256 is not null and file_path is not null));

-- Podpis: overi vazbu na finalne PDF, doplni serverovy cas a hash dokazov,
-- zamkne dokument. UPDATE/DELETE zakazane (aj pre service role, okrem hard delete).
create or replace function public.hr_document_signatures_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.hr_documents%rowtype;
begin
  if TG_OP = 'DELETE' then
    if coalesce(current_setting('stenger.hard_delete', true), '') = 'on' then
      return old;
    end if;
    raise exception 'Podpisovy zaznam je nemenny.';
  end if;
  if TG_OP = 'UPDATE' then
    raise exception 'Podpisovy zaznam je nemenny.';
  end if;

  select * into v_doc from public.hr_documents where id = new.hr_document_id for update;
  if v_doc.status in ('VOIDED', 'SUPERSEDED') then
    raise exception 'Dokument je zneplatneny/nahrazeny - nelze podepsat.';
  end if;

  if new.method in ('ELECTRONIC_TABLET', 'ELECTRONIC_QUALIFIED') then
    if v_doc.final_pdf_sha256 is null then
      raise exception 'Dokument nema finalni PDF - elektronicky podpis neni mozny.';
    end if;
    if v_doc.final_pdf_text_check is null or coalesce((v_doc.final_pdf_text_check->>'ok')::boolean, false) is not true then
      raise exception 'Finalni PDF neproslo kontrolou textu (variables_snapshot) - podpis je zablokovan.';
    end if;
    if new.method = 'ELECTRONIC_TABLET' and new.signed_content_sha256 is distinct from v_doc.final_pdf_sha256 then
      raise exception 'Podepisovany obsah neodpovida finalnimu PDF (hash).';
    end if;
    new.signed_at := now(); -- serverovy cas, nie z klienta
  end if;

  new.evidence_sha256 := encode(extensions.digest(convert_to(jsonb_build_object(
    'hr_document_id', new.hr_document_id, 'method', new.method, 'signer_type', new.signer_type,
    'signed_at', new.signed_at, 'signed_by_name', new.signed_by_name,
    'signed_content_sha256', new.signed_content_sha256, 'document_hash', new.document_hash,
    'signature_image_id', new.signature_image_id,
    'intent_text_version_id', new.intent_text_version_id, 'intent_text_sha256', new.intent_text_sha256,
    'identity_verification', new.identity_verification, 'evidence', new.evidence,
    'signer_user_id', new.signer_user_id, 'file_path', new.file_path
  )::text, 'UTF8'), 'sha256'), 'hex');

  if v_doc.locked_at is null then
    update public.hr_documents set locked_at = now(),
      signing_channel = coalesce(signing_channel, case when new.method = 'PAPER' then 'PAPER' else 'ELECTRONIC' end)
      where id = new.hr_document_id;
  end if;
  return new;
end;
$$;
drop trigger if exists hr_document_signatures_guard on public.hr_document_signatures;
create trigger hr_document_signatures_guard before insert or update or delete on public.hr_document_signatures
  for each row execute function public.hr_document_signatures_guard();

drop policy if exists "hr_signature_images_view" on public.hr_signature_images;
create policy "hr_signature_images_view" on public.hr_signature_images
  for select
  using (exists (
    select 1 from public.hr_document_signatures s
    join public.hr_documents d on d.id = s.hr_document_id
    where s.signature_image_id = hr_signature_images.id
  )); -- hr_documents RLS (klasifikacia) sa uplatni cez join

-- 48.6 employee_contact_declarations - § 21 oznamenie adresy, § 335 suhlas,
--      § 335 odvolanie. Vzdy samostatne zaznamy aj samostatne dokumenty.
--      Platnost sa odvodzuje (48.8) - vyhlasenie plati len pre email_snapshot.
create table if not exists public.employee_contact_declarations (
  id text primary key,
  kind text not null check (kind in ('S21_ADDRESS_NOTICE', 'S335_CONSENT', 'S335_REVOCATION')),
  employee_id text references public.employees(id),
  onboarding_session_id text references public.onboarding_sessions(id),
  email_snapshot text not null check (email_snapshot ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  declared_at timestamptz not null,
  channel text not null check (channel in ('KIOSK_TABLET', 'TABLET_HR', 'PAPER_SCAN')),
  hr_document_id text references public.hr_documents(id),
  notice_version_id text references public.hr_legal_text_versions(id),
  revokes_declaration_id text references public.employee_contact_declarations(id),
  superseded_at timestamptz,
  revoked_at timestamptz,
  revocation_received_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (employee_id is not null or onboarding_session_id is not null),
  check (kind <> 'S335_CONSENT' or notice_version_id is not null),
  check (kind <> 'S335_REVOCATION' or revokes_declaration_id is not null)
);
create index if not exists employee_contact_declarations_employee_idx on public.employee_contact_declarations (employee_id);
alter table public.employee_contact_declarations enable row level security;
drop policy if exists "contact_declarations_view" on public.employee_contact_declarations;
create policy "contact_declarations_view" on public.employee_contact_declarations
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "contact_declarations_insert" on public.employee_contact_declarations;
create policy "contact_declarations_insert" on public.employee_contact_declarations
  for insert
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT') and channel <> 'KIOSK_TABLET');
-- Ziadna update policy - odvolanie/nahradenie len cez RPC (48.8).

create or replace function public.hr_contact_declarations_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if coalesce(current_setting('stenger.hard_delete', true), '') = 'on' then
      return old;
    end if;
    raise exception 'Vyhlaseni se nemazou.';
  end if;
  if TG_OP = 'INSERT' then
    new.email_snapshot := lower(trim(new.email_snapshot));
    return new;
  end if;
  if new.kind is distinct from old.kind or new.email_snapshot is distinct from old.email_snapshot
     or new.declared_at is distinct from old.declared_at or new.channel is distinct from old.channel
     or new.hr_document_id is distinct from old.hr_document_id or new.notice_version_id is distinct from old.notice_version_id
     or new.revokes_declaration_id is distinct from old.revokes_declaration_id
     or new.onboarding_session_id is distinct from old.onboarding_session_id
     or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by
     or (old.employee_id is not null and new.employee_id is distinct from old.employee_id)
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     or (old.revocation_received_at is not null and new.revocation_received_at is distinct from old.revocation_received_at) then
    raise exception 'Vyhlaseni je nemenne (lze jen doplnit nahrazeni/odvolani).';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_contact_declarations_guard on public.employee_contact_declarations;
create trigger hr_contact_declarations_guard before insert or update or delete on public.employee_contact_declarations
  for each row execute function public.hr_contact_declarations_guard();
drop trigger if exists audit_employee_contact_declarations on public.employee_contact_declarations;
create trigger audit_employee_contact_declarations after insert or update or delete on public.employee_contact_declarations
  for each row execute function public.audit_trigger();

-- Platne vyhlasenie daneho druhu pre AKTUALNY private_email zamestnanca.
-- Zmena e-mailu => stare vyhlasenia sa na novu adresu nevztahuju (bod 4.2).
create or replace function public.hr_valid_contact_declaration(p_employee_id text, p_kind text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.id
  from public.employee_contact_declarations d
  join public.employees e on e.id = d.employee_id
  where d.employee_id = p_employee_id
    and d.kind = p_kind
    and p_kind in ('S21_ADDRESS_NOTICE', 'S335_CONSENT')
    and d.superseded_at is null
    and d.revoked_at is null
    and e.private_email is not null
    and d.email_snapshot = lower(trim(e.private_email))
    and public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC')
  order by d.declared_at desc
  limit 1;
$$;
grant execute on function public.hr_valid_contact_declaration(text, text) to authenticated;

-- Odvolanie § 335 suhlasu: novy zaznam S335_REVOCATION + revoked_at na suhlase.
create or replace function public.hr_revoke_s335_consent(p_consent_id text, p_received_at timestamptz, p_hr_document_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.employee_contact_declarations%rowtype;
  v_id text := 'decl-' || replace(gen_random_uuid()::text, '-', '');
begin
  if not (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT')) then
    raise exception 'Neopravneno.';
  end if;
  select * into v_c from public.employee_contact_declarations where id = p_consent_id for update;
  if v_c.id is null or v_c.kind <> 'S335_CONSENT' then raise exception 'Souhlas nenalezen.'; end if;
  if v_c.revoked_at is not null then raise exception 'Souhlas uz byl odvolan.'; end if;
  insert into public.employee_contact_declarations (id, kind, employee_id, onboarding_session_id, email_snapshot,
    declared_at, channel, hr_document_id, revokes_declaration_id, revocation_received_at, created_by)
  values (v_id, 'S335_REVOCATION', v_c.employee_id, v_c.onboarding_session_id, v_c.email_snapshot,
    p_received_at, 'PAPER_SCAN', p_hr_document_id, v_c.id, p_received_at, auth.uid());
  update public.employee_contact_declarations
    set revoked_at = now(), revocation_received_at = p_received_at
    where id = v_c.id;
  return v_id;
end;
$$;
grant execute on function public.hr_revoke_s335_consent(text, timestamptz, text) to authenticated;

-- 48.7 hr_document_deliveries - odovzdanie/dorucenie (bod 4.5 zadania)
create table if not exists public.hr_document_deliveries (
  id text primary key,
  hr_document_id text not null references public.hr_documents(id),
  channel text not null check (channel in (
    'IN_PERSON_PAPER', 'IN_PERSON_ELECTRONIC_COPY', 'EMAIL_S21', 'EMAIL_S335_CONSENT',
    'EMAIL_S335_WAGE_OTHER_ADDRESS', 'DATA_BOX', 'POST'
  )),
  recipient_snapshot text,
  declaration_id text references public.employee_contact_declarations(id),
  delivered_document_sha256 text,         -- hash presne toho suboru, ktory bol odovzdany/odoslany
  queued_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  send_status text check (send_status is null or send_status in ('QUEUED', 'SENT', 'FAILED', 'BOUNCED')),
  send_error text,
  attempts int not null default 0,
  delivered_at timestamptz,
  delivery_basis text check (delivery_basis is null or delivery_basis in (
    'SIGNED_RECEIPT', 'EMPLOYEE_CONFIRMATION', 'FICTION_15_DAYS', 'DATA_BOX_LOGIN', 'PROVIDER_DELIVERED_S21', 'HANDED_OVER'
  )),
  confirmation_evidence jsonb,
  ineffective_at timestamptz,
  ineffective_reason text,
  withdrawal_deadline date,
  withdrawal_received_at timestamptz,
  handed_over_by uuid references auth.users(id),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (channel not in ('EMAIL_S21', 'EMAIL_S335_CONSENT') or declaration_id is not null),
  check (channel not like 'EMAIL%' or recipient_snapshot is not null),
  check (delivered_at is null or ineffective_at is null),
  check ((delivered_at is null) = (delivery_basis is null))
);
create index if not exists hr_document_deliveries_doc_idx on public.hr_document_deliveries (hr_document_id);
alter table public.hr_document_deliveries enable row level security;
drop policy if exists "hr_document_deliveries_view" on public.hr_document_deliveries;
create policy "hr_document_deliveries_view" on public.hr_document_deliveries
  for select
  using (
    public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC')
    and exists (select 1 from public.hr_documents d where d.id = hr_document_id) -- dedi klasifikaciu dokumentu
  );
drop policy if exists "hr_document_deliveries_insert" on public.hr_document_deliveries;
create policy "hr_document_deliveries_insert" on public.hr_document_deliveries
  for insert
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SEND'));
drop policy if exists "hr_document_deliveries_update" on public.hr_document_deliveries;
create policy "hr_document_deliveries_update" on public.hr_document_deliveries
  for update
  using (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SEND'))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SEND'));

create or replace function public.hr_document_deliveries_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.hr_documents%rowtype;
  v_decl public.employee_contact_declarations%rowtype;
begin
  if TG_OP = 'DELETE' then
    if coalesce(current_setting('stenger.hard_delete', true), '') = 'on' then
      return old;
    end if;
    raise exception 'Zaznam o dorucovani se nemaze.';
  end if;

  if TG_OP = 'INSERT' then
    select * into v_doc from public.hr_documents where id = new.hr_document_id;
    if v_doc.status in ('VOIDED', 'SUPERSEDED') then
      raise exception 'Zneplatneny dokument nelze predat ani odeslat.';
    end if;
    if new.channel like 'EMAIL%' then
      new.recipient_snapshot := lower(trim(new.recipient_snapshot));
    end if;
    if new.channel in ('EMAIL_S21', 'EMAIL_S335_CONSENT') then
      select * into v_decl from public.employee_contact_declarations where id = new.declaration_id;
      if v_decl.kind is distinct from (case new.channel when 'EMAIL_S21' then 'S21_ADDRESS_NOTICE' else 'S335_CONSENT' end) then
        raise exception 'Kanal neodpovida druhu vyhlaseni.';
      end if;
      if v_decl.revoked_at is not null or v_decl.superseded_at is not null then
        raise exception 'Vyhlaseni je odvolane/nahrazene.';
      end if;
      if v_decl.email_snapshot is distinct from new.recipient_snapshot then
        raise exception 'Adresa prijemce neodpovida adrese z vyhlaseni.';
      end if;
      if v_decl.employee_id is distinct from v_doc.employee_id then
        raise exception 'Vyhlaseni patri jinemu zamestnanci.';
      end if;
    end if;
    if new.channel = 'EMAIL_S21' and v_doc.legal_act_type is distinct from 'BILATERAL_CONTRACT' then
      raise exception 'Kanal § 21 je jen pro smlouvy.';
    end if;
    if new.channel = 'EMAIL_S335_WAGE_OTHER_ADDRESS' and v_doc.doc_type not in ('platovy_vymer', 'mzdovy_vymer') then
      raise exception '§ 335 odst. 3 (jina adresa) je jen pro mzdovy vymer.';
    end if;
    -- E-mail § 334/335 nikdy nie je "dorucene" uz pri vlozeni.
    if new.channel like 'EMAIL_S335%' and new.delivered_at is not null then
      raise exception 'Pisemnost § 334 neni dorucena odeslanim e-mailu.';
    end if;
    return new;
  end if;

  -- UPDATE: identita zaznamu a raz zapisane fakty sa nemenia.
  if new.hr_document_id is distinct from old.hr_document_id or new.channel is distinct from old.channel
     or new.recipient_snapshot is distinct from old.recipient_snapshot or new.declaration_id is distinct from old.declaration_id
     or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by
     or (old.delivered_document_sha256 is not null and new.delivered_document_sha256 is distinct from old.delivered_document_sha256)
     or (old.sent_at is not null and new.sent_at is distinct from old.sent_at)
     or (old.delivered_at is not null and (new.delivered_at is distinct from old.delivered_at or new.delivery_basis is distinct from old.delivery_basis))
     or (old.ineffective_at is not null and new.ineffective_at is distinct from old.ineffective_at)
     or (old.withdrawal_received_at is not null and new.withdrawal_received_at is distinct from old.withdrawal_received_at) then
    raise exception 'Zaznam o dorucovani lze jen doplnit, ne prepsat.';
  end if;
  if new.channel like 'EMAIL_S335%' and new.delivery_basis in ('PROVIDER_DELIVERED_S21', 'HANDED_OVER') then
    raise exception 'Nepripustny duvod doruceni pro pisemnost § 334.';
  end if;
  if new.channel = 'EMAIL_S335_WAGE_OTHER_ADDRESS' and new.delivery_basis = 'FICTION_15_DAYS' then
    raise exception 'Mzdovy vymer na jinou adresu: fikce doruceni neplati (§ 335 odst. 3).';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists hr_document_deliveries_guard on public.hr_document_deliveries;
create trigger hr_document_deliveries_guard before insert or update or delete on public.hr_document_deliveries
  for each row execute function public.hr_document_deliveries_guard();
drop trigger if exists audit_hr_document_deliveries on public.hr_document_deliveries;
create trigger audit_hr_document_deliveries after insert or update or delete on public.hr_document_deliveries
  for each row execute function public.audit_trigger();

-- 48.8 Ulozisko - viditelnost suborov podla klasifikacie dokumentu aj pre
--      NOVE cesty (finalne PDF, podpisany original, sken podpisu). Doteraz sa
--      porovnavalo len hr_documents.file_path - sken podpisu
--      (zamestnanci-podpisy/...) tak videl kazdy s HR_VIEW_BASIC aj pri
--      citlivom dokumente. Opravene spolu s touto fazou.
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
    return true; -- subor sablony a pod. - baseline HR_VIEW_BASIC uz je vynuteny v policy
  end if;
  return not exists (
    select 1 from unnest(public.hr_document_required_permissions(v_doc_id)) as perm
    where not public.hr_has_permission(perm)
  );
end;
$$;

-- 48.9 Kiosk - expiracia relacie, limit novych relacii, upratovanie
--      opustenych konceptov, volitelne odomknutie zariadenia cez HR.
alter table public.onboarding_sessions add column if not exists expires_at timestamptz;
alter table public.onboarding_sessions add column if not exists last_activity_at timestamptz;
alter table public.onboarding_sessions add column if not exists draft_purged_at timestamptz;
alter table public.onboarding_sessions add column if not exists unlock_id text;
alter table public.onboarding_sessions drop constraint if exists onboarding_sessions_status_check;
alter table public.onboarding_sessions add constraint onboarding_sessions_status_check
  check (status in ('IN_PROGRESS', 'SUBMITTED', 'REVIEWED', 'DISCARDED', 'EXPIRED'));
update public.onboarding_sessions set expires_at = created_at + interval '8 hours'
  where expires_at is null and status = 'IN_PROGRESS';

-- Jednorazove odomknutia zariadenia (HR vygeneruje kod, kiosk ho zada).
create table if not exists public.hr_kiosk_unlocks (
  id text primary key,
  code_sha256 text not null unique,
  issued_by uuid not null references auth.users(id),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table public.hr_kiosk_unlocks enable row level security;
drop policy if exists "hr_kiosk_unlocks_view" on public.hr_kiosk_unlocks;
create policy "hr_kiosk_unlocks_view" on public.hr_kiosk_unlocks
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT'));

create or replace function public.hr_kiosk_issue_unlock()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_ttl int := coalesce((public.hr_setting('kiosk')->>'unlock_ttl_minutes')::int, 15);
begin
  if not (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT')) then
    raise exception 'Neopravneno.';
  end if;
  insert into public.hr_kiosk_unlocks (id, code_sha256, issued_by, expires_at)
  values ('unl-' || replace(gen_random_uuid()::text, '-', ''), encode(extensions.digest(v_code, 'sha256'), 'hex'),
          auth.uid(), now() + make_interval(mins => v_ttl));
  return v_code; -- zobrazi sa raz HR, v DB len hash
end;
$$;
revoke execute on function public.hr_kiosk_issue_unlock() from public, anon;
grant execute on function public.hr_kiosk_issue_unlock() to authenticated;

-- Upratovanie: IN_PROGRESS po expiracii -> EXPIRED + vymazanie konceptu
-- (osobne udaje). Vola sa pri kazdom starte relacie (bez cronu) a da sa
-- volat aj rucne (HR_ADMIN) / neskor cez pg_cron.
create or replace function public.hr_onboarding_cleanup()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update public.onboarding_sessions
    set status = 'EXPIRED', draft_data = '{}'::jsonb, draft_purged_at = now()
    where status = 'IN_PROGRESS' and expires_at is not null and expires_at < now()
      and not exists (select 1 from public.hr_documents d where d.onboarding_session_id = onboarding_sessions.id);
  get diagnostics v_n = row_count;
  -- Relacia s podpisanymi dokumentmi sa len oznaci (dokumenty sa nemazu).
  update public.onboarding_sessions
    set status = 'EXPIRED'
    where status = 'IN_PROGRESS' and expires_at is not null and expires_at < now();
  return v_n;
end;
$$;
revoke execute on function public.hr_onboarding_cleanup() from public, anon, authenticated;

drop function if exists public.hr_onboarding_start_session();
create or replace function public.hr_onboarding_start_session(p_unlock_code text default null)
returns table (id text, session_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb := coalesce(public.hr_setting('kiosk'), '{}'::jsonb);
  v_id text := 'onb-' || replace(gen_random_uuid()::text, '-', '');
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires timestamptz := now() + make_interval(hours => coalesce((v_cfg->>'session_ttl_hours')::int, 8));
  v_unlock_id text;
begin
  perform public.hr_onboarding_cleanup();
  -- Globalny limit (anon nema identitu) - ochrana pred zahltenim.
  perform pg_advisory_xact_lock(hashtext('hr_onboarding_start_session'));
  if (select count(*) from public.onboarding_sessions s where s.created_at > now() - interval '1 hour')
     >= coalesce((v_cfg->>'max_new_sessions_per_hour')::int, 30) then
    raise exception 'Prilis mnoho novych dotazniku za posledni hodinu. Zkuste to pozdeji nebo kontaktujte personalni oddeleni.';
  end if;
  if coalesce((v_cfg->>'device_unlock_required')::boolean, false) then
    update public.hr_kiosk_unlocks u set used_at = now()
      where u.code_sha256 = encode(extensions.digest(upper(trim(coalesce(p_unlock_code, ''))), 'sha256'), 'hex')
        and u.used_at is null and u.expires_at > now()
      returning u.id into v_unlock_id;
    if v_unlock_id is null then
      raise exception 'Zarizeni neni odemceno - pozadejte personalni oddeleni o kod.';
    end if;
  end if;
  insert into public.onboarding_sessions (id, session_token, status, draft_data, expires_at, last_activity_at, unlock_id)
  values (v_id, v_token, 'IN_PROGRESS', '{}'::jsonb, v_expires, now(), v_unlock_id);
  return query select v_id, v_token, v_expires;
end;
$$;
revoke execute on function public.hr_onboarding_start_session(text) from public;
grant execute on function public.hr_onboarding_start_session(text) to anon, authenticated;

create or replace function public.hr_onboarding_save_draft(p_session_token text, p_draft_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.onboarding_sessions
    set draft_data = p_draft_data, last_activity_at = now()
    where session_token = p_session_token and status = 'IN_PROGRESS'
      and (expires_at is null or expires_at > now());
  return found;
end;
$$;

create or replace function public.hr_onboarding_submit(p_session_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.onboarding_sessions
    set status = 'SUBMITTED', submitted_at = now(), last_activity_at = now()
    where session_token = p_session_token and status = 'IN_PROGRESS'
      and (expires_at is null or expires_at > now());
  return found;
end;
$$;

-- Bezpecna konfiguracia pre kiosk (anon) - len to, co kiosk potrebuje.
create or replace function public.hr_onboarding_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    's335_consent_enabled', coalesce(public.hr_setting('s335_consent_enabled'), 'false'::jsonb),
    'device_unlock_required', coalesce(public.hr_setting('kiosk')->'device_unlock_required', 'false'::jsonb)
  );
$$;
grant execute on function public.hr_onboarding_config() to anon, authenticated;

-- Schvalenie: prenesie dokumenty a vyhlasenia zo session na zamestnanca
-- (len employee_id, obsah a hashe sa nemenia - strazi trigger 48.3).
-- DISCARDED: nic sa nemaze, relacia je len oznacena.
create or replace function public.hr_onboarding_review(p_session_id text, p_status text, p_resulting_employee_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT')) then
    raise exception 'Neopravnene.';
  end if;
  if p_status not in ('REVIEWED', 'DISCARDED') then
    raise exception 'Neplatny stav.';
  end if;
  if p_status = 'REVIEWED' and p_resulting_employee_id is null then
    raise exception 'Chybi zamestnanec.';
  end if;
  update public.onboarding_sessions
    set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
        resulting_employee_id = p_resulting_employee_id
    where id = p_session_id and status in ('SUBMITTED', 'IN_PROGRESS', 'EXPIRED');
  if not found then
    return false;
  end if;
  if p_status = 'REVIEWED' then
    update public.hr_documents set employee_id = p_resulting_employee_id, updated_at = now()
      where onboarding_session_id = p_session_id and employee_id is null;
    update public.employee_contact_declarations set employee_id = p_resulting_employee_id
      where onboarding_session_id = p_session_id and employee_id is null;
  end if;
  return true;
end;
$$;
grant execute on function public.hr_onboarding_review(text, text, text) to authenticated;

-- 48.10 Trvale mazanie zamestnanca - len HR_ADMIN, s auditom a dovodom;
--       zablokovane pri podpisanych/dorucenych dokumentoch, ak zaznam nie je
--       oznaceny ako testovaci alebo duplicitny (rozhodnutie z fazy A).
alter table public.employees add column if not exists record_flag text;
alter table public.employees drop constraint if exists employees_record_flag_check;
alter table public.employees add constraint employees_record_flag_check
  check (record_flag is null or record_flag in ('TEST', 'DUPLICATE'));

create or replace function public.hr_employees_record_flag_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.record_flag is distinct from (case when TG_OP = 'UPDATE' then old.record_flag else null end)
     and not public.hr_has_permission('HR_ADMIN')
     and auth.uid() is not null then
    raise exception 'Oznaceni testovaciho/duplicitniho zaznamu muze menit jen HR_ADMIN.';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_employees_record_flag_guard on public.employees;
create trigger hr_employees_record_flag_guard before insert or update on public.employees
  for each row execute function public.hr_employees_record_flag_guard();

drop function if exists public.hr_admin_delete_employee(text);
create or replace function public.hr_admin_delete_employee(p_employee_id text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_emp public.employees%rowtype;
  v_signed int;
  v_delivered int;
begin
  if not (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN')) then
    raise exception 'Neopravnene - trvale vymazani zamestnance vyzaduje HR_ADMIN.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Uvedte duvod trvaleho vymazani.';
  end if;
  select * into v_emp from public.employees where id = p_employee_id;
  if v_emp.id is null then
    raise exception 'Zamestnanec nenalezen.';
  end if;
  select count(*) into v_signed from public.hr_documents
    where employee_id = p_employee_id and (locked_at is not null or status in ('SIGNED', 'ARCHIVED'));
  select count(*) into v_delivered from public.hr_document_deliveries dl
    join public.hr_documents d on d.id = dl.hr_document_id
    where d.employee_id = p_employee_id and (dl.delivered_at is not null or dl.sent_at is not null);
  if (v_signed > 0 or v_delivered > 0) and v_emp.record_flag is null then
    raise exception 'Zamestnanec ma podepsane nebo dorucene dokumenty (% / %). Trvale vymazani je mozne jen u zaznamu oznaceneho jako testovaci nebo duplicitni - jinak pouzijte archivaci.', v_signed, v_delivered;
  end if;

  insert into public.audit_log (entity, entity_id, action, old_value, new_value, changed_by, changed_by_role, source)
  values ('employees_hard_delete', p_employee_id, 'delete',
    jsonb_build_object('record_flag', v_emp.record_flag, 'signed_documents', v_signed, 'delivered_documents', v_delivered),
    jsonb_build_object('reason', p_reason),
    auth.uid(), public.current_role(), 'user');

  perform set_config('stenger.hard_delete', 'on', true);
  delete from public.hr_document_deliveries
    where hr_document_id in (select id from public.hr_documents where employee_id = p_employee_id);
  delete from public.employee_contact_declarations where employee_id = p_employee_id;
  delete from public.hr_document_signatures
    where hr_document_id in (select id from public.hr_documents where employee_id = p_employee_id);
  delete from public.hr_signature_images i
    where not exists (select 1 from public.hr_document_signatures s where s.signature_image_id = i.id);
  delete from public.hr_documents where employee_id = p_employee_id;
  delete from public.employment_terms_versions
    where employment_id in (select id from public.employment_relationships where employee_id = p_employee_id);
  delete from public.employment_contract_events
    where employment_id in (select id from public.employment_relationships where employee_id = p_employee_id);
  delete from public.medical_examinations where employee_id = p_employee_id;
  delete from public.employee_timeline_events where employee_id = p_employee_id;
  delete from public.employment_relationships where employee_id = p_employee_id;
  delete from public.employee_sensitive_data where employee_id = p_employee_id;
  delete from public.employee_payroll_data where employee_id = p_employee_id;
  update public.employment_relationships set supervisor_employee_id = null where supervisor_employee_id = p_employee_id;
  update public.onboarding_sessions set resulting_employee_id = null where resulting_employee_id = p_employee_id;
  delete from public.employees where id = p_employee_id;
  perform set_config('stenger.hard_delete', 'off', true);
end;
$body$;
revoke execute on function public.hr_admin_delete_employee(text, text) from public, anon;
grant execute on function public.hr_admin_delete_employee(text, text) to authenticated;

-- 48.11 Backfill: uz podpisane dokumenty (papier) su od teraz zamknute.
--       V produkcii sa dotkne len existujucich SIGNED/ARCHIVED riadkov.
update public.hr_documents set locked_at = coalesce(updated_at, now())
  where status in ('SIGNED', 'ARCHIVED') and locked_at is null;
