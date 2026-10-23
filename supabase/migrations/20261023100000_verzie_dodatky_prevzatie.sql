-- ============================================================
-- 53. Doplnky pred fazou F:
--     a) zamknuty, ale neuplne podpisany dokument -> "zneplatnit a vytvorit
--        novu verziu" (povodna VOIDED, jej podpisy ostavaju ako zaznam);
--     b) uplne podpisana zmluva -> dodatok (novy dokument s vazbou);
--     c) sken potvrdenia o prevzati viazany na zaznam odovzdania;
--     d) zaznam o skoleni len s evidenciou skolenia a overenim znalosti.
--     Pravne pravidla su KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.
-- ============================================================

-- ---------- d) evidencia skolenia ----------
create table if not exists public.hr_training_records (
  id text primary key default gen_random_uuid()::text,
  employee_id text not null references public.employees(id) on delete cascade,
  training_type text not null default 'VSTUPNI_BOZP' check (training_type in ('VSTUPNI_BOZP', 'PO', 'JINE')),
  trained_at date not null,
  trainer_name text not null check (trim(trainer_name) <> ''),
  scope text not null check (trim(scope) <> ''),          -- obsah / rozsah skolenia
  knowledge_check_method text not null check (knowledge_check_method in ('TEST', 'ORAL', 'PRACTICAL')),
  knowledge_check_result text not null check (knowledge_check_result in ('PASSED', 'FAILED')),
  knowledge_checked_at date not null,
  knowledge_checked_by_name text not null check (trim(knowledge_checked_by_name) <> ''),
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (knowledge_checked_at >= trained_at)
);
create index if not exists hr_training_records_employee_idx on public.hr_training_records (employee_id);
alter table public.hr_training_records enable row level security;
drop policy if exists "hr_training_records_view" on public.hr_training_records;
create policy "hr_training_records_view" on public.hr_training_records
  for select using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC'));
drop policy if exists "hr_training_records_insert" on public.hr_training_records;
create policy "hr_training_records_insert" on public.hr_training_records
  for insert with check (
    public.current_role() = 'office' and created_by = auth.uid()
    and (public.hr_has_permission('HR_EDIT') or public.hr_has_permission('HR_DOCUMENT_GENERATE'))
  );

-- Evidencia sa neprepisuje - oprava = novy zaznam (pred podpisom ho naviazat).
create or replace function public.hr_training_records_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' and coalesce(current_setting('stenger.hard_delete', true), '') = 'on' then
    return old;
  end if;
  if TG_OP = 'INSERT' then
    new.created_at := now();
    return new;
  end if;
  raise exception 'Evidence skoleni se neprepisuje - zalozte novy zaznam.';
end;
$$;
drop trigger if exists hr_training_records_guard on public.hr_training_records;
create trigger hr_training_records_guard before insert or update or delete on public.hr_training_records
  for each row execute function public.hr_training_records_guard();
drop trigger if exists audit_hr_training_records on public.hr_training_records;
create trigger audit_hr_training_records after insert or update or delete on public.hr_training_records
  for each row execute function public.audit_trigger();

alter table public.hr_documents add column if not exists training_record_id text references public.hr_training_records(id);
alter table public.hr_documents add column if not exists amends_document_id text references public.hr_documents(id);

create or replace function public.hr_training_ok(p_training_record_id text, p_employee_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.hr_training_records t
                 where t.id = p_training_record_id and t.employee_id = p_employee_id and t.knowledge_check_result = 'PASSED');
$$;

-- Vazby dokumentu (skolenie, dodatok): kontrola pri vlozeni/zmene a pri
-- prechode do SIGNED.
create or replace function public.hr_documents_links_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig public.hr_documents%rowtype;
  v_act text := coalesce(new.legal_act_type, public.hr_default_legal_act_type(new.doc_type));
begin
  if TG_OP = 'UPDATE' then
    if new.amends_document_id is distinct from old.amends_document_id then
      raise exception 'Vazbu dodatku na puvodni smlouvu nelze menit.';
    end if;
    if new.training_record_id is distinct from old.training_record_id and old.locked_at is not null then
      raise exception 'Dokument je zamceny - evidenci skoleni nelze zmenit.';
    end if;
  end if;
  if TG_OP = 'INSERT' and new.amends_document_id is not null then
    select * into v_orig from public.hr_documents where id = new.amends_document_id;
    if new.doc_type <> 'dodatek' then
      raise exception 'Vazba na puvodni smlouvu je jen pro dodatek.';
    end if;
    if v_orig.status not in ('SIGNED', 'ARCHIVED')
       or coalesce(v_orig.legal_act_type, public.hr_default_legal_act_type(v_orig.doc_type)) <> 'BILATERAL_CONTRACT' then
      raise exception 'Dodatek lze vytvorit jen k podepsane smlouve.';
    end if;
    if v_orig.employee_id is distinct from new.employee_id then
      raise exception 'Dodatek musi patrit stejnemu zamestnanci.';
    end if;
  end if;
  if new.training_record_id is not null and not exists (
    select 1 from public.hr_training_records t where t.id = new.training_record_id and t.employee_id = new.employee_id
  ) then
    raise exception 'Evidence skoleni patri jinemu zamestnanci.';
  end if;
  if v_act = 'TRAINING_RECORD' and new.status = 'SIGNED' and not new.is_manual_history_entry
     and (TG_OP = 'INSERT' or old.status is distinct from 'SIGNED')
     and not public.hr_training_ok(new.training_record_id, new.employee_id) then
    raise exception 'Zaznam o skoleni lze podepsat jen s evidenci skoleni a uspesnym overenim znalosti.';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_documents_links_guard on public.hr_documents;
create trigger hr_documents_links_guard before insert or update on public.hr_documents
  for each row execute function public.hr_documents_links_guard();

-- Podpis zaznamu o skoleni sa bez evidencie a overenia znalosti neprijme.
create or replace function public.hr_document_signatures_training()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.hr_documents%rowtype;
begin
  select * into v_doc from public.hr_documents where id = new.hr_document_id;
  if coalesce(v_doc.legal_act_type, public.hr_default_legal_act_type(v_doc.doc_type)) = 'TRAINING_RECORD'
     and not public.hr_training_ok(v_doc.training_record_id, v_doc.employee_id) then
    raise exception 'Zaznam o skoleni nema evidenci skoleni s uspesnym overenim znalosti - podpis neni mozny.';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_document_signatures_training on public.hr_document_signatures;
create trigger hr_document_signatures_training before insert on public.hr_document_signatures
  for each row execute function public.hr_document_signatures_training();

-- ---------- a) nova verzia; zamknuty dokument sa zneplatni ----------
create or replace function public.hr_document_new_version(p_document_id text, p_reason text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.hr_documents%rowtype;
  v_new text := gen_random_uuid()::text;
begin
  if not (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_GENERATE')) then
    raise exception 'Neopravneno - nova verze vyzaduje HR_DOCUMENT_GENERATE.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Uvedte duvod nove verze.';
  end if;
  select * into v_doc from public.hr_documents where id = p_document_id for update;
  if v_doc.id is null or exists (
    select 1 from unnest(public.hr_document_required_permissions(v_doc.id)) as perm where not public.hr_has_permission(perm)
  ) then
    raise exception 'Dokument nenalezen.';
  end if;
  if v_doc.status in ('SIGNED', 'ARCHIVED') then
    raise exception 'Podepsany dokument se nenahrazuje - ke smlouve vytvorte dodatek.';
  end if;
  if v_doc.status in ('VOIDED', 'SUPERSEDED') then
    raise exception 'Zneplatneny nebo nahrazeny dokument nelze nahradit novou verzi.';
  end if;
  insert into public.hr_documents (id, employee_id, employment_id, onboarding_session_id, doc_type, template_id, template_version_id,
    origin, status, generated_at, generated_by, file_path, variables_snapshot, legal_act_type, version_no, supersedes_document_id,
    amends_document_id, training_record_id, notes)
  values (v_new, v_doc.employee_id, v_doc.employment_id, v_doc.onboarding_session_id, v_doc.doc_type, v_doc.template_id, v_doc.template_version_id,
    v_doc.origin, 'DRAFT', now(), auth.uid(), v_doc.file_path, v_doc.variables_snapshot, v_doc.legal_act_type, v_doc.version_no + 1, v_doc.id,
    v_doc.amends_document_id, v_doc.training_record_id, v_doc.notes);
  -- Zamknuty (uz s podpisom) -> zneplatnit; podpisy ostavaju ako zaznam a
  -- k novej verzii sa nepocitaju (su viazane na povodny riadok).
  update public.hr_documents
    set status = case when v_doc.locked_at is not null then 'VOIDED' else 'SUPERSEDED' end,
        superseded_by = v_new, void_reason = trim(p_reason), updated_at = now()
    where id = v_doc.id;
  return v_new;
end;
$$;

-- ---------- b) dodatok k podpisanej zmluve ----------
create or replace function public.hr_document_create_amendment(p_document_id text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.hr_documents%rowtype;
  v_new text := gen_random_uuid()::text;
  v_tpl public.hr_document_templates%rowtype;
begin
  if not (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_GENERATE')) then
    raise exception 'Neopravneno - dodatek vyzaduje HR_DOCUMENT_GENERATE.';
  end if;
  select * into v_doc from public.hr_documents where id = p_document_id;
  if v_doc.id is null or exists (
    select 1 from unnest(public.hr_document_required_permissions(v_doc.id)) as perm where not public.hr_has_permission(perm)
  ) then
    raise exception 'Dokument nenalezen.';
  end if;
  -- schvalena sablona dodatku, ak existuje (dnes ziadna - otvorena uloha)
  select * into v_tpl from public.hr_document_templates where doc_type = 'dodatek' and status = 'SCHVALENA' order by created_at desc limit 1;
  insert into public.hr_documents (id, employee_id, employment_id, doc_type, template_id, origin, status, generated_at, generated_by,
    legal_act_type, amends_document_id, notes)
  values (v_new, v_doc.employee_id, v_doc.employment_id, 'dodatek', v_tpl.id, 'GENERATED', 'DRAFT', now(), auth.uid(),
    'BILATERAL_CONTRACT', v_doc.id, nullif(trim(coalesce(p_note, '')), ''));
  return v_new;
end;
$$;
revoke execute on function public.hr_document_create_amendment(text, text) from public, anon;
grant execute on function public.hr_document_create_amendment(text, text) to authenticated;

-- ---------- c) sken potvrdenia o prevzati ----------
alter table public.hr_document_deliveries add column if not exists receipt_scan_path text;
alter table public.hr_document_deliveries add column if not exists receipt_scan_sha256 text;
alter table public.hr_document_deliveries drop constraint if exists hr_document_deliveries_receipt_scan_check;
alter table public.hr_document_deliveries add constraint hr_document_deliveries_receipt_scan_check
  check ((receipt_scan_path is null) = (receipt_scan_sha256 is null)
         and (receipt_scan_sha256 is null or receipt_scan_sha256 ~ '^[0-9a-f]{64}$'));
create unique index if not exists hr_document_deliveries_receipt_scan_uq on public.hr_document_deliveries (receipt_scan_path) where receipt_scan_path is not null;

-- Cesta skenu: prevzeti/<hr_document_id>/<nazov s prvymi 16 znakmi hashu>.
-- Subor tak dedi klasifikaciu dokumentu uz od nahratia (hr_object_path_visible).
create or replace function public.hr_document_deliveries_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.hr_documents%rowtype;
begin
  if TG_OP = 'UPDATE' and old.receipt_scan_path is not null
     and (new.receipt_scan_path is distinct from old.receipt_scan_path or new.receipt_scan_sha256 is distinct from old.receipt_scan_sha256) then
    raise exception 'Sken potvrzeni o prevzeti je jiz ulozen a nelze ho zmenit.';
  end if;
  if new.receipt_scan_path is not null and (TG_OP = 'INSERT' or old.receipt_scan_path is null) then
    if new.receipt_scan_path not like 'prevzeti/' || new.hr_document_id || '/%'
       or position(left(new.receipt_scan_sha256, 16) in new.receipt_scan_path) = 0 then
      raise exception 'Sken potvrzeni o prevzeti musi byt ve slozce dokumentu a nest otisk v nazvu.';
    end if;
  end if;
  -- "Proti podpisu potvrdenia" = sken potvrdenia alebo (od fazy F) podpis
  -- potvrdenia na tablete.
  if new.delivery_basis = 'SIGNED_RECEIPT' and new.receipt_scan_path is null
     and coalesce(new.confirmation_evidence->>'receipt_signature_id', '') = '' then
    raise exception 'Doruceni proti podpisu potvrzeni vyzaduje sken potvrzeni o prevzeti.';
  end if;
  select * into v_doc from public.hr_documents where id = new.hr_document_id;
  if new.channel in ('IN_PERSON_PAPER', 'IN_PERSON_ELECTRONIC_COPY') and new.delivered_at is not null
     and public.hr_is_s334_document(v_doc.doc_type, v_doc.legal_act_type) and new.delivery_basis is distinct from 'SIGNED_RECEIPT' then
    raise exception 'Pisemnost § 334 se osobne doruci jen proti podpisu potvrzeni o prevzeti.';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_document_deliveries_receipt on public.hr_document_deliveries;
create trigger hr_document_deliveries_receipt before insert or update on public.hr_document_deliveries
  for each row execute function public.hr_document_deliveries_receipt();

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

-- Osobne odovzdanie (z migracie 52) - potvrdenie prevzatia teraz kontroluje
-- hr_document_deliveries_receipt (sken alebo podpis na tablete).
create or replace function public.hr_document_deliveries_in_person()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.hr_documents%rowtype;
begin
  if new.channel not in ('IN_PERSON_PAPER', 'IN_PERSON_ELECTRONIC_COPY') then
    if TG_OP = 'INSERT' and new.delivery_basis = 'HANDED_OVER' then
      raise exception 'Duvod "predano osobne" jen pro osobni predani.';
    end if;
    return new;
  end if;
  select * into v_doc from public.hr_documents where id = new.hr_document_id;
  if new.delivery_basis is not null and new.delivery_basis not in ('HANDED_OVER', 'SIGNED_RECEIPT') then
    raise exception 'Nepripustny duvod doruceni pro osobni predani.';
  end if;
  if TG_OP = 'INSERT' then
    new.handed_over_by := coalesce(new.handed_over_by, auth.uid());
    new.delivered_document_sha256 := coalesce(new.delivered_document_sha256, v_doc.signed_pdf_sha256);
    if new.delivered_at is not null and new.delivered_at > now() + interval '5 minutes' then
      raise exception 'Datum predani nemuze byt v budoucnosti.';
    end if;
  end if;
  return new;
end;
$$;
