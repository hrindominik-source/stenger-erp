-- Rollback migracie 81 (kopia plnej moci). Uz finalizovane PDF s pripojenou
-- kopiou ostavaju (su zamknute hashom); subory kopii v plne-moci/ znova len
-- podla citlivosti originalu / HR_ADMIN. Vratit aj frontend a hr-finalize-pdf.
begin;
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

CREATE OR REPLACE FUNCTION public.hr_object_path_visible(p_path text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_doc_id text;
  v_sens text;
begin
  if p_path like 'exekuce/%' then
    return public.hr_has_permission('HR_EXEKUCE');
  end if;
  -- prilohy zamestnanca (zdravotne doklady, pas, rodne listy deti, PN ...) -
  -- evidencia je v employee_payroll_data, teda rovnake pravo ako metadata
  if p_path ~ '^zamestnanci/[^/]+/prilohy/' then
    return public.hr_has_permission('HR_VIEW_PAYROLL');
  end if;
  -- subory sablon (baseline HR_VIEW_BASIC je vynuteny v policy)
  if p_path like 'sablony/%' then
    return true;
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
    -- neznamy subor (napr. po trvalom vymazani zaznamu) - len HR_ADMIN
    return public.hr_has_permission('HR_ADMIN');
  end if;
  return not exists (
    select 1 from unnest(public.hr_document_required_permissions(v_doc_id)) as perm
    where not public.hr_has_permission(perm)
  );
end;
$function$;

alter table public.hr_signatories drop constraint if exists hr_signatories_poa_copy_check;
alter table public.hr_signatories drop column if exists poa_copy_sha256, drop column if exists poa_copy_path;
commit;
