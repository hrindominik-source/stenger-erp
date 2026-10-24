-- Rollback migracie 66 (balik C: schvalovanie sablon a textov). Pozor:
--   - hr_current_legal_text bude opat vracat aj koncepty (aj § 21 / § 335);
--   - jednorazove schvalenie ostane zapisane (stav SCHVALENO, audit) - stav
--     sa nevracia, schvalenie textov je nemenne;
--   - stlpce metadat (pravny zaklad, revizia, poznamka) sa zmazu.
begin;

drop trigger if exists hr_documents_template_approved on public.hr_documents;
drop function if exists public.hr_documents_template_approved();
drop trigger if exists hr_templates_approval_guard on public.hr_document_templates;
drop trigger if exists hr_templates_approval_guard on public.hr_document_template_versions;
drop function if exists public.hr_templates_approval_guard();
drop function if exists public.hr_approve_template_version(text, text, date, text);
drop function if exists public.hr_approve_legal_text(text, text, date, text);

create or replace function public.hr_current_legal_text(p_key text)
returns public.hr_legal_text_versions language sql stable security definer set search_path = public as $$
  select * from public.hr_legal_text_versions
  where text_key = p_key and status <> 'VYRAZENO'
  order by version_no desc
  limit 1;
$$;

create or replace function public.hr_legal_texts_guard()
returns trigger language plpgsql set search_path = public as $$
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

-- upozornenia sablon ako v migracii 65
create or replace function public.hr_notify_templates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_TABLE_NAME = 'hr_document_template_versions' then
    if TG_OP = 'INSERT' and coalesce(new.mapping_status, '') <> 'SCHVALENA' then
      perform public.hr_notify('TEMPLATE_PENDING', 'KE_SCHVALENI',
        'Nová verze šablony čeká na schválení (v' || new.version_number || ')', 'hr_document_template_versions', new.id, null,
        jsonb_build_object('template_id', new.template_id), new.uploaded_by);
    elsif TG_OP = 'UPDATE' and new.mapping_status = 'SCHVALENA' and old.mapping_status is distinct from 'SCHVALENA' then
      update public.hr_notifications set resolved_at = now(), resolved_by = auth.uid()
        where entity = 'hr_document_template_versions' and entity_id = new.id and kind = 'KE_SCHVALENI' and resolved_at is null;
      perform public.hr_notify('TEMPLATE_APPROVED', 'NA_VEDOMI', 'Šablona schválena (v' || new.version_number || ')',
        'hr_document_template_versions', new.id, null, jsonb_build_object('template_id', new.template_id));
    end if;
  else
    if TG_OP = 'INSERT' and new.status = 'KONCEPT' then
      perform public.hr_notify('LEGAL_TEXT_PENDING', 'KE_SCHVALENI', 'Nová verze textu čeká na schválení: ' || new.title,
        'hr_legal_text_versions', new.id, null, jsonb_build_object('text_key', new.text_key, 'version_no', new.version_no), new.created_by);
    elsif TG_OP = 'UPDATE' and new.status <> 'KONCEPT' and old.status = 'KONCEPT' then
      update public.hr_notifications set resolved_at = now(), resolved_by = auth.uid()
        where entity = 'hr_legal_text_versions' and entity_id = new.id and kind = 'KE_SCHVALENI' and resolved_at is null;
    end if;
  end if;
  return new;
end;
$$;

-- suhrn bez revizii (ako v migracii 65)
create or replace function public.hr_konatel_summary(p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 7), 1));
begin
  if not (coalesce(auth.role(), '') = 'service_role'
          or (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN'))) then
    raise exception 'Neopravneno.';
  end if;
  return jsonb_build_object(
    'od', v_from,
    'do', now(),
    'udalosti', coalesce((select jsonb_object_agg(event_type, n) from (
        select event_type, count(*) n from public.hr_notifications where created_at >= v_from group by event_type) x), '{}'::jsonb),
    'ke_schvaleni', (select count(*) from public.hr_notifications where kind = 'KE_SCHVALENI' and resolved_at is null),
    'neprectene', (select count(*) from public.hr_notifications where read_at is null and kind = 'NA_VEDOMI'),
    'smlouvy_konci_30_dni', (select count(*) from public.employment_relationships
        where status in ('ACTIVE', 'NOTICE_PERIOD') and fixed_term_end_date between current_date and current_date + 30),
    'smlouvy_po_konci', (select count(*) from public.employment_relationships
        where status = 'ACTIVE' and fixed_term_end_date < current_date),
    'prohlidky_po_platnosti', (select count(*) from (
        select distinct on (m.employee_id) m.valid_until from public.medical_examinations m
        join public.employees e on e.id = m.employee_id and e.active
        order by m.employee_id, m.valid_until desc nulls last) x where valid_until < current_date),
    'prohlidky_do_30_dni', (select count(*) from (
        select distinct on (m.employee_id) m.valid_until from public.medical_examinations m
        join public.employees e on e.id = m.employee_id and e.active
        order by m.employee_id, m.valid_until desc nulls last) x where valid_until between current_date and current_date + 30),
    'pristupy', (select count(*) from public.hr_permissions
        where (valid_until is null or valid_until >= current_date) and (valid_from is null or valid_from <= current_date)),
    'pristupy_konci_14_dni', (select count(*) from public.hr_permissions where valid_until between current_date and current_date + 14)
  );
end;
$$;

alter table public.hr_document_template_versions
  drop column if exists approved_by, drop column if exists approved_at, drop column if exists approval_note;
alter table public.hr_document_templates
  drop column if exists legal_basis, drop column if exists legal_reviewed_at, drop column if exists legal_reviewed_by,
  drop column if exists next_review_date;
alter table public.hr_legal_text_versions
  drop column if exists legal_basis, drop column if exists legal_reviewed_at, drop column if exists legal_reviewed_by,
  drop column if exists next_review_date, drop column if exists approval_note;

commit;
