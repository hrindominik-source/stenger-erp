-- ROLLBACK migracie 20261023100000_verzie_dodatky_prevzatie.sql (spustit PRED rollbackom 52).
-- Zastavi sa, ak uz existuju dodatky, skeny potvrdenia o prevzati alebo
-- evidencia skoleni (rollback by ich stratil) - najprv ich exportujte.
begin;
do $$
begin
  if exists (select 1 from public.hr_documents where amends_document_id is not null or training_record_id is not null)
     or exists (select 1 from public.hr_document_deliveries where receipt_scan_path is not null)
     or exists (select 1 from public.hr_training_records) then
    raise exception 'Rollback zastaven: existuji dodatky, skeny potvrzeni o prevzeti nebo evidence skoleni.';
  end if;
end;
$$;
drop function if exists public.hr_document_create_amendment(text, text);
drop trigger if exists hr_document_deliveries_receipt on public.hr_document_deliveries;
drop function if exists public.hr_document_deliveries_receipt();
drop index if exists public.hr_document_deliveries_receipt_scan_uq;
alter table public.hr_document_deliveries drop constraint if exists hr_document_deliveries_receipt_scan_check;
alter table public.hr_document_deliveries drop column if exists receipt_scan_path;
alter table public.hr_document_deliveries drop column if exists receipt_scan_sha256;
drop trigger if exists hr_document_signatures_training on public.hr_document_signatures;
drop function if exists public.hr_document_signatures_training();
drop trigger if exists hr_documents_links_guard on public.hr_documents;
drop function if exists public.hr_documents_links_guard();
drop function if exists public.hr_training_ok(text, text);
alter table public.hr_documents drop column if exists amends_document_id;
alter table public.hr_documents drop column if exists training_record_id;
drop table if exists public.hr_training_records;
drop function if exists public.hr_training_records_guard();

-- verzie z migracie 52
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
  if v_doc.status in ('SIGNED', 'ARCHIVED', 'VOIDED', 'SUPERSEDED') then
    raise exception 'Podepsany, zneplatneny nebo nahrazeny dokument nelze nahradit novou verzi.';
  end if;
  insert into public.hr_documents (id, employee_id, employment_id, onboarding_session_id, doc_type, template_id, template_version_id,
    origin, status, generated_at, generated_by, file_path, variables_snapshot, legal_act_type, version_no, supersedes_document_id, notes)
  values (v_new, v_doc.employee_id, v_doc.employment_id, v_doc.onboarding_session_id, v_doc.doc_type, v_doc.template_id, v_doc.template_version_id,
    v_doc.origin, 'DRAFT', now(), auth.uid(), v_doc.file_path, v_doc.variables_snapshot, v_doc.legal_act_type, v_doc.version_no + 1, v_doc.id, v_doc.notes);
  update public.hr_documents set status = 'SUPERSEDED', superseded_by = v_new, void_reason = trim(p_reason), updated_at = now()
    where id = v_doc.id;
  return v_new;
end;
$$;


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
  if public.hr_is_s334_document(v_doc.doc_type, v_doc.legal_act_type) and new.delivery_basis is distinct from 'SIGNED_RECEIPT'
     and new.delivered_at is not null then
    raise exception 'Pisemnost § 334 se osobne doruci jen proti podpisu potvrzeni o prevzeti.';
  end if;
  if new.delivery_basis = 'SIGNED_RECEIPT' and new.confirmation_evidence is null then
    raise exception 'Chybi zaznam o potvrzeni prevzeti.';
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


-- verzia z migracie 48
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

commit;
