-- ============================================================
-- 66. Balik C z auditu Personalistiky (docs/audit/03): schvalovanie sablon
--     a pravnych textov.
--   - Schvaluje len jednatel (HR_ADMIN, rola office) cez funkcie
--     hr_approve_template_version / hr_approve_legal_text; kto a kedy
--     zapisuje DB. Priama zmena stavu na "schvalene" z aplikacie je blokovana.
--   - Metadata: pravny zaklad, pravne overene k / kym, datum dalsej revizie,
--     poznamka ku schvaleniu.
--   - Pouzit sa da len schvaleny text (hr_current_legal_text) a len aktualna
--     schvalena verzia sablony (trigger na hr_documents), obe nie po revizii.
--     Koncepty textov sa nepouzivaju (rozhodnutie jednatela 2026-10-24).
--   - Jednorazove schvalenie existujucich pouzivanych sablon a textov
--     so zaznamom v audite - okrem § 21, § 335 a textov prejavu vole
--     (INTENT_*), tie ostavaju koncept (rozhodnutie jednatela 2026-10-24).
--   - Kym nie su texty prejavu vole schvalene, elektronicky podpis (tablet,
--     kiosk) nejde - DB odmietne podpis ELECTRONIC_TABLET bez schvaleneho
--     textu; papierovy postup funguje.
-- ============================================================

-- ---------- metadata ----------
alter table public.hr_legal_text_versions
  add column if not exists legal_basis text,
  add column if not exists legal_reviewed_at date,
  add column if not exists legal_reviewed_by text,
  add column if not exists next_review_date date,
  add column if not exists approval_note text;
alter table public.hr_document_templates
  add column if not exists legal_basis text,
  add column if not exists legal_reviewed_at date,
  add column if not exists legal_reviewed_by text,
  add column if not exists next_review_date date;
alter table public.hr_document_template_versions
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists approval_note text;

-- ---------- pravne texty ----------
create or replace function public.hr_legal_texts_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.body_sha256 := encode(extensions.digest(convert_to(new.body, 'UTF8'), 'sha256'), 'hex');
    if current_user = 'authenticated' then
      new.status := 'KONCEPT';
      new.approved_by := null;
      new.approved_at := null;
    end if;
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
    -- z aplikacie len cez hr_approve_legal_text (jednatel)
    if current_user = 'authenticated' and coalesce(current_setting('hr.approving', true), '') <> '1' then
      raise exception 'Text schvaluje jednatel tlacitkem Schvalit.';
    end if;
    new.approved_by := coalesce(auth.uid(), new.approved_by);
    new.approved_at := now();
  elsif old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by
      or new.approval_note is distinct from old.approval_note) then
    raise exception 'Udaje o schvaleni nelze menit.';
  end if;
  return new;
end;
$$;

create or replace function public.hr_approve_legal_text(p_id text, p_note text default null, p_next_review date default null,
  p_legal_basis text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.hr_legal_text_versions;
begin
  if not (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN')) then
    raise exception 'Schvalovat muze jen jednatel.';
  end if;
  select * into v from public.hr_legal_text_versions where id = p_id for update;
  if v.id is null or v.status <> 'KONCEPT' then
    raise exception 'Schvalit lze jen koncept.';
  end if;
  perform set_config('hr.approving', '1', true);
  update public.hr_legal_text_versions
    set status = 'SCHVALENO', approval_note = nullif(trim(p_note), ''),
        next_review_date = coalesce(p_next_review, next_review_date), legal_basis = coalesce(nullif(trim(p_legal_basis), ''), legal_basis)
    where id = p_id;
  -- predchadzajuca schvalena verzia toho isteho textu sa vyradi
  update public.hr_legal_text_versions set status = 'VYRAZENO'
    where text_key = v.text_key and id <> p_id and status = 'SCHVALENO';
  perform set_config('hr.approving', '', true);
end;
$$;
revoke execute on function public.hr_approve_legal_text(text, text, date, text) from public, anon;
grant execute on function public.hr_approve_legal_text(text, text, date, text) to authenticated;

-- Pouzije sa len schvalena verzia, nie po termine revizie. Koncept nie.
create or replace function public.hr_current_legal_text(p_key text)
returns public.hr_legal_text_versions language sql stable security definer set search_path = public as $$
  select * from public.hr_legal_text_versions
  where text_key = p_key and status = 'SCHVALENO'
    and (next_review_date is null or next_review_date >= current_date)
  order by version_no desc
  limit 1;
$$;

-- ---------- sablony ----------
create or replace function public.hr_templates_approval_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' or coalesce(current_setting('hr.approving', true), '') = '1' then
    return new;
  end if;
  if TG_TABLE_NAME = 'hr_document_templates' then
    if (TG_OP = 'INSERT' and new.status = 'SCHVALENA')
       or (TG_OP = 'UPDATE' and ((new.status = 'SCHVALENA' and old.status is distinct from 'SCHVALENA')
         or new.current_version_id is distinct from old.current_version_id
         or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at)) then
      raise exception 'Šablonu schvaluje jednatel tlačítkem Schválit.';
    end if;
    if TG_OP = 'INSERT' then
      new.approved_by := null;
      new.approved_at := null;
    end if;
  else
    if (TG_OP = 'INSERT' and (new.approved_by is not null or new.approved_at is not null))
       or (TG_OP = 'UPDATE' and (new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at
         or new.approval_note is distinct from old.approval_note)) then
      raise exception 'Šablonu schvaluje jednatel tlačítkem Schválit.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists hr_templates_approval_guard on public.hr_document_templates;
create trigger hr_templates_approval_guard before insert or update on public.hr_document_templates
  for each row execute function public.hr_templates_approval_guard();
drop trigger if exists hr_templates_approval_guard on public.hr_document_template_versions;
create trigger hr_templates_approval_guard before insert or update on public.hr_document_template_versions
  for each row execute function public.hr_templates_approval_guard();

create or replace function public.hr_approve_template_version(p_version_id text, p_note text default null,
  p_next_review date default null, p_legal_basis text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.hr_document_template_versions;
  t public.hr_document_templates;
begin
  if not (public.current_role() = 'office' and public.hr_has_permission('HR_ADMIN')) then
    raise exception 'Schvalovat muze jen jednatel.';
  end if;
  select * into v from public.hr_document_template_versions where id = p_version_id for update;
  if v.id is null then
    raise exception 'Verze sablony neexistuje.';
  end if;
  if v.mapping_status <> 'SCHVALENA' then
    raise exception 'Verze má neznámé tagy - nejprve opravte soubor.';
  end if;
  select * into t from public.hr_document_templates where id = v.template_id for update;
  if t.status = 'VYRAZENA' then
    raise exception 'Vyrazenou sablonu nelze schvalit.';
  end if;
  perform set_config('hr.approving', '1', true);
  update public.hr_document_template_versions
    set approved_by = auth.uid(), approved_at = now(), approval_note = nullif(trim(p_note), '')
    where id = v.id and approved_at is null;
  update public.hr_document_templates
    set status = 'SCHVALENA', current_version_id = v.id, approved_by = auth.uid(), approved_at = now(),
        next_review_date = coalesce(p_next_review, next_review_date), legal_basis = coalesce(nullif(trim(p_legal_basis), ''), legal_basis)
    where id = t.id;
  perform set_config('hr.approving', '', true);
end;
$$;
revoke execute on function public.hr_approve_template_version(text, text, date, text) from public, anon;
grant execute on function public.hr_approve_template_version(text, text, date, text) to authenticated;

-- Dokument zo sablony len z aktualnej schvalenej verzie, nie po revizii.
create or replace function public.hr_documents_template_approved()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ok boolean;
begin
  if new.template_version_id is null then
    return new;
  end if;
  select (t.status = 'SCHVALENA' and t.current_version_id = v.id and v.approved_at is not null
          and (t.next_review_date is null or t.next_review_date >= current_date))
    into ok
    from public.hr_document_template_versions v join public.hr_document_templates t on t.id = v.template_id
    where v.id = new.template_version_id;
  if not coalesce(ok, false) then
    raise exception 'Šablona není schválená jednatelem (nebo je po termínu revize) - dokument nelze vytvořit.';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_documents_template_approved on public.hr_documents;
create trigger hr_documents_template_approved before insert or update of template_version_id on public.hr_documents
  for each row execute function public.hr_documents_template_approved();

-- ---------- upozornenia (nahradza logiku z migracie 65) ----------
create or replace function public.hr_notify_templates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_TABLE_NAME = 'hr_document_template_versions' then
    if TG_OP = 'INSERT' and new.approved_at is null then
      perform public.hr_notify('TEMPLATE_PENDING', 'KE_SCHVALENI',
        'Nová verze šablony čeká na schválení: ' || coalesce((select name from public.hr_document_templates where id = new.template_id), new.template_id)
          || ' (v' || new.version_number || ')',
        'hr_document_template_versions', new.id, null, jsonb_build_object('template_id', new.template_id), new.uploaded_by);
    elsif TG_OP = 'UPDATE' and new.approved_at is not null and old.approved_at is null then
      update public.hr_notifications set resolved_at = now(), resolved_by = auth.uid()
        where entity = 'hr_document_template_versions' and entity_id = new.id and kind = 'KE_SCHVALENI' and resolved_at is null;
      perform public.hr_notify('TEMPLATE_APPROVED', 'NA_VEDOMI', 'Šablona schválena (v' || new.version_number || ')',
        'hr_document_template_versions', new.id, null, jsonb_build_object('template_id', new.template_id, 'note', new.approval_note));
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

-- revizie v suhrne pre jednatela
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
    'pristupy_konci_14_dni', (select count(*) from public.hr_permissions where valid_until between current_date and current_date + 14),
    'revize_do_30_dni', (select count(*) from public.hr_document_templates where status = 'SCHVALENA'
          and next_review_date between current_date and current_date + 30)
        + (select count(*) from public.hr_legal_text_versions where status = 'SCHVALENO'
          and next_review_date between current_date and current_date + 30),
    'revize_po_terminu', (select count(*) from public.hr_document_templates where status = 'SCHVALENA' and next_review_date < current_date)
        + (select count(*) from public.hr_legal_text_versions where status = 'SCHVALENO' and next_review_date < current_date)
  );
end;
$$;

-- ---------- jednorazove schvalenie existujucich (rozhodnutie jednatela 2026-10-24) ----------
do $$
declare
  v_konatel uuid;
  v_note text;
  n_tpl int;
  n_txt int;
begin
  select case when count(*) = 1 then min(user_id::text)::uuid end into v_konatel
    from public.hr_permissions where profile = 'KONATEL' and user_id is not null;
  v_note := 'Jednorázově schváleno jednatelem při zavedení schvalování (migrace 66, rozhodnutí 2026-10-24)'
    || case when v_konatel is null then ' – účet jednatele nebyl jednoznačně určen.' else '.' end;

  update public.hr_document_template_versions v
    set approved_by = coalesce(v_konatel, t.approved_by), approved_at = coalesce(t.approved_at, now()), approval_note = v_note
    from public.hr_document_templates t
    where t.current_version_id = v.id and t.status = 'SCHVALENA' and v.approved_at is null;
  get diagnostics n_tpl = row_count;
  update public.hr_document_templates
    set approved_by = coalesce(approved_by, v_konatel), approved_at = coalesce(approved_at, now())
    where status = 'SCHVALENA';

  -- texty v pouziti; § 21, § 335 a prejavy vole (INTENT_*) ostavaju koncept
  update public.hr_legal_text_versions x
    set status = 'SCHVALENO', approved_by = v_konatel, approval_note = v_note
    where x.status = 'KONCEPT'
      and x.text_key not in ('S21_ADDRESS_NOTICE', 'S335_NOTICE', 'S335_CONSENT', 'S335_REVOCATION')
      and x.text_key not like 'INTENT\_%'
      and x.version_no = (select max(version_no) from public.hr_legal_text_versions y
                          where y.text_key = x.text_key and y.status <> 'VYRAZENO');
  get diagnostics n_txt = row_count;

  insert into public.audit_log (entity, entity_id, action, old_value, new_value, changed_by, changed_by_role, source)
  values ('hr_approval_bootstrap', 'migrace-66', 'update', null,
    jsonb_build_object('note', v_note, 'template_versions', n_tpl, 'legal_texts', n_txt,
      'unapproved_texts', array['S21_ADDRESS_NOTICE', 'S335_NOTICE', 'S335_CONSENT', 'S335_REVOCATION', 'INTENT_*']),
    v_konatel, null, 'automation');
  perform public.hr_notify('APPROVAL_BOOTSTRAP', 'NA_VEDOMI',
    'Zavedeno schvalování: dosavadní šablony (' || n_tpl || ') a texty (' || n_txt || ') označeny jako schválené; § 21, § 335 a prejavy vůle zůstávají koncept – elektronický podpis je vypnutý',
    'hr_approval_bootstrap', 'migrace-66', null, '{}'::jsonb, v_konatel);
end $$;

-- ---------- elektronicky podpis len so schvalenym textom prejavu vole ----------
create or replace function public.hr_signatures_intent_approved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.method = 'ELECTRONIC_TABLET' and not exists (
      select 1 from public.hr_legal_text_versions t
      where t.id = new.intent_text_version_id and t.status = 'SCHVALENO'
        and (t.next_review_date is null or t.next_review_date >= current_date)) then
    raise exception 'Elektronický podpis čeká na schválení textů – použijte papírový postup.';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_signatures_intent_approved on public.hr_document_signatures;
create trigger hr_signatures_intent_approved before insert on public.hr_document_signatures
  for each row execute function public.hr_signatures_intent_approved();

-- Ktore texty prejavu vole su schvalene (UI: tlacidla podpisu na tablete).
create or replace function public.hr_esign_ready_keys()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(k order by k), '{}') from unnest(array['INTENT_BILATERAL_CONTRACT', 'INTENT_RECEIPT_ACKNOWLEDGEMENT',
    'INTENT_TRAINING_RECORD', 'INTENT_EMPLOYEE_DECLARATION', 'INTENT_EMPLOYER_SIGNATURE', 'INTENT_QUESTIONNAIRE']) k
  where (public.hr_current_legal_text(k)).id is not null;
$$;
revoke execute on function public.hr_esign_ready_keys() from public, anon;
grant execute on function public.hr_esign_ready_keys() to authenticated, service_role;
