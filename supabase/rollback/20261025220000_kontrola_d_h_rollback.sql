-- Rollback migracie 75 (opravy z kontroly D-H): vrati definicie z migracii 71-73.
-- POZOR: vracia aj zranitelnosti z kontroly - pouzit len pri nutnosti a hned opravit.
begin;

drop trigger if exists hr_documents_classification_guard on public.hr_documents;
drop function if exists public.hr_documents_classification_guard();
drop trigger if exists hr_employees_anonymized_guard on public.employees;
drop function if exists public.hr_employees_anonymized_guard();
drop policy if exists hr_approval_requests_select on public.hr_approval_requests;

create policy hr_approval_requests_select on public.hr_approval_requests for select
  using (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC'));

create or replace function public.hr_doc_self_signable(d public.hr_documents)
returns boolean language sql stable set search_path = public as $$
  select d.origin = 'GENERATED' and coalesce(d.version_no, 1) = 1 and (
    (d.template_version_id is not null
      and d.doc_type in ('pracovni_smlouva', 'pracovni_smlouva_cizinec', 'popis_pracovniho_mista', 'hi001_naplen_prace_delnice', 'vstupni_skoleni'))
    or d.doc_type = 'potvrzeni_prevzeti');
$$;

create or replace function public.hr_usable_approval(p_kind text, p_entity_id text)
returns public.hr_approval_requests language sql stable security definer set search_path = public as $$
  select * from public.hr_approval_requests
  where kind = p_kind and entity_id = p_entity_id and status in ('APPROVED', 'EMERGENCY', 'CONFIRMED') and consumed_at is null
  order by requested_at desc limit 1;
$$;

create or replace function public.hr_signatures_employer_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare d public.hr_documents; v_actor uuid; a public.hr_approval_requests;
begin
  if new.signer_type <> 'EMPLOYER' then return new; end if;
  select * into d from public.hr_documents where id = new.hr_document_id;
  if public.hr_doc_self_signable(d) then return new; end if;
  -- autor: kto podpisal/nahral (server v mene pouzivatela), inak prihlaseny pouzivatel
  v_actor := coalesce(new.signer_user_id, new.uploaded_by, case when current_setting('role', true) = 'authenticated' then auth.uid() end);
  if v_actor is null then return new; end if; -- server/migracia bez pouzivatela
  if public.hr_user_is_admin(v_actor) then return new; end if;
  a := public.hr_usable_approval('EMPLOYER_SIGN', d.id);
  if a.id is null then
    raise exception 'Podpis za zaměstnavatele u tohoto dokumentu schvaluje jednatel – požádejte o schválení (nebo použijte nouzový postup).'
      using errcode = 'P0001';
  end if;
  update public.hr_approval_requests set consumed_at = now() where id = a.id;
  return new;
end $$;

create or replace function public.hr_documents_void_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare a public.hr_approval_requests;
begin
  if old.status in ('VOIDED', 'SUPERSEDED') or new.status not in ('VOIDED', 'SUPERSEDED') then return new; end if;
  -- len krok prihlaseneho pouzivatela (server: kiosk, vyhlasenia - len pred podpisom)
  if auth.uid() is null or current_setting('role', true) is distinct from 'authenticated' then return new; end if;
  if not exists (select 1 from public.hr_document_signatures s where s.hr_document_id = old.id) then return new; end if;
  if public.hr_user_is_admin(auth.uid()) then return new; end if;
  a := public.hr_usable_approval('VOID_DOCUMENT', old.id);
  if a.id is null then
    raise exception 'Zneplatnění podepsaného dokumentu schvaluje jednatel – požádejte o schválení (nebo použijte nouzový postup).'
      using errcode = 'P0001';
  end if;
  update public.hr_approval_requests set consumed_at = now() where id = a.id;
  return new;
end $$;

create or replace function public.hr_request_approval(p_kind text, p_entity_id text, p_reason text,
  p_payload jsonb default '{}'::jsonb, p_emergency boolean default false, p_emergency_info text default null)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_id text;
  v_admin boolean := public.hr_has_permission('HR_ADMIN');
  v_entity text;
  v_employee text;
  v_title text;
  v_doc public.hr_documents;
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC')) then
    raise exception 'Neopravneno.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Uveďte důvod (alespoň 5 znaků).'; end if;
  if p_emergency and length(trim(coalesce(p_emergency_info, ''))) < 5 then
    raise exception 'U nouzového postupu uveďte, jak a kdy jste jednatele informovali.';
  end if;
  if p_kind in ('EMPLOYER_SIGN', 'VOID_DOCUMENT') then
    select * into v_doc from public.hr_documents where id = p_entity_id;
    if not found then raise exception 'Dokument nenalezen.'; end if;
    if p_kind = 'EMPLOYER_SIGN' and not public.hr_has_permission('HR_SIGN_FOR_EMPLOYER') then raise exception 'Neopravneno.' using errcode = '42501'; end if;
    if p_kind = 'VOID_DOCUMENT' and not public.hr_has_permission('HR_DOCUMENT_VOID') then raise exception 'Neopravneno.' using errcode = '42501'; end if;
    v_entity := 'hr_documents';
    v_employee := v_doc.employee_id;
  elsif p_kind = 'LEGAL_EXCEPTION' then
    if not public.hr_has_permission('HR_EDIT') then raise exception 'Neopravneno.' using errcode = '42501'; end if;
    select employee_id into v_employee from public.employment_relationships where id = p_entity_id;
    if v_employee is null then raise exception 'Pracovní poměr nenalezen.'; end if;
    if jsonb_array_length(coalesce(p_payload->'codes', '[]'::jsonb)) = 0 then raise exception 'Chybí, ze kterých limitů se žádá výjimka.'; end if;
    v_entity := 'employment_relationships';
  elsif p_kind = 'ANONYMIZE' then
    -- trvaly zasah do udajov: nudzovy postup nie je
    if p_emergency then raise exception 'Anonymizace nemá nouzový postup.'; end if;
    if not public.hr_has_permission('HR_EDIT') then raise exception 'Neopravneno.' using errcode = '42501'; end if;
    if not (public.hr_anonymization_ready(p_entity_id)->>'ready')::boolean then
      raise exception '%', public.hr_anonymization_ready(p_entity_id)->>'reason';
    end if;
    v_entity := 'employees';
    v_employee := p_entity_id;
  else
    raise exception 'Neznámý typ žádosti.';
  end if;

  -- jednatel rozhoduje sam (napr. vynimka zo zakonneho limitu) - zaznam a audit ostavaju
  if v_admin then
    insert into public.hr_approval_requests (kind, entity, entity_id, employee_id, payload, reason, status, requested_by, decided_by, decided_at, decision_note)
    values (p_kind, v_entity, p_entity_id, v_employee, coalesce(p_payload, '{}'::jsonb), trim(p_reason), 'APPROVED', auth.uid(), auth.uid(), now(), 'Rozhodnutí jednatele')
    returning id into v_id;
    return v_id;
  end if;
  insert into public.hr_approval_requests (kind, entity, entity_id, employee_id, payload, reason, emergency, emergency_info, status, requested_by)
  values (p_kind, v_entity, p_entity_id, v_employee, coalesce(p_payload, '{}'::jsonb), trim(p_reason), coalesce(p_emergency, false),
    nullif(trim(coalesce(p_emergency_info, '')), ''), case when p_emergency then 'EMERGENCY' else 'PENDING' end, auth.uid())
  returning id into v_id;

  v_title := public.hr_approval_kind_label(p_kind) || case when p_emergency then ' – NOUZOVÝ POSTUP (provedeno bez schválení, potvrďte)' else ' – žádost o schválení' end;
  perform public.hr_notify(case when p_emergency then 'EMERGENCY_STEP' else 'APPROVAL_REQUESTED' end, 'KE_SCHVALENI', v_title,
    'hr_approval_requests', v_id, v_employee,
    jsonb_build_object('kind', p_kind, 'entity_id', p_entity_id, 'reason', trim(p_reason), 'emergency_info', p_emergency_info, 'payload', p_payload));
  return v_id;
exception when unique_violation then
  raise exception 'Žádost o schválení už čeká na jednatele.';
end $$;

create or replace function public.hr_check_employment_core_with_exceptions(p_employment_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_codes text[]; v_ex jsonb;
begin
  v := public.hr_check_employment_core(p_employment_id);
  select coalesce(array_agg(distinct c), '{}'), coalesce(jsonb_agg(distinct jsonb_build_object('id', r.id, 'status', r.status, 'codes', r.payload->'codes')), '[]'::jsonb)
    into v_codes, v_ex
  from public.hr_approval_requests r, jsonb_array_elements_text(r.payload->'codes') c
  where r.kind = 'LEGAL_EXCEPTION' and r.entity_id = p_employment_id and r.status in ('APPROVED', 'EMERGENCY', 'CONFIRMED');
  if cardinality(v_codes) = 0 then return v; end if;
  return v || jsonb_build_object(
    'issues', (select coalesce(jsonb_agg(case when i->>'level' = 'BLOCK' and i->>'code' = any (v_codes)
        then i || jsonb_build_object('level', 'WARN', 'exception', true, 'message', 'VÝJIMKA schválená jednatelem: ' || (i->>'message'))
        else i end), '[]'::jsonb) from jsonb_array_elements(v->'issues') i),
    'exceptions', v_ex);
end $$;

create or replace function public.hr_approval_state(p_kind text, p_entity_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_doc public.hr_documents; v_needed boolean := true; v_last public.hr_approval_requests;
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC')) then raise exception 'Neopravneno.' using errcode = '42501'; end if;
  if p_kind = 'EMPLOYER_SIGN' then
    select * into v_doc from public.hr_documents where id = p_entity_id;
    v_needed := not public.hr_doc_self_signable(v_doc);
  elsif p_kind = 'VOID_DOCUMENT' then
    v_needed := exists (select 1 from public.hr_document_signatures s where s.hr_document_id = p_entity_id);
  end if;
  if public.hr_has_permission('HR_ADMIN') then v_needed := false; end if;
  select * into v_last from public.hr_approval_requests where kind = p_kind and entity_id = p_entity_id order by requested_at desc limit 1;
  return jsonb_build_object('needed', v_needed,
    'usable', (public.hr_usable_approval(p_kind, p_entity_id)).id is not null,
    'last', case when v_last.id is null then null else jsonb_build_object('id', v_last.id, 'status', v_last.status, 'reason', v_last.reason,
      'emergency', v_last.emergency, 'decision_note', v_last.decision_note, 'requested_at', v_last.requested_at, 'mine', v_last.requested_by = auth.uid(),
      'consumed', v_last.consumed_at is not null) end);
end $$;

create or replace function public.hr_anonymization_ready(p_employee_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_end date; v_missing text[]; v_due date; v_open int;
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC')) then
    raise exception 'Neopravneno.' using errcode = '42501';
  end if;
  if exists (select 1 from public.employees where id = p_employee_id and coalesce(data->>'anonymized_at', '') <> '') then
    return jsonb_build_object('ready', false, 'reason', 'Zaměstnanec už je anonymizován.');
  end if;
  select count(*) filter (where status <> 'ENDED'), max(coalesce(termination_date, fixed_term_end_date))
    into v_open, v_end from public.employment_relationships where employee_id = p_employee_id;
  if v_open > 0 then return jsonb_build_object('ready', false, 'reason', 'Zaměstnanec má neukončený pracovní poměr.'); end if;
  if v_end is null then return jsonb_build_object('ready', false, 'reason', 'Chybí datum skončení pracovního poměru.'); end if;
  select array_agg(label order by key) into v_missing from public.hr_retention_rules where period_years is null;
  if v_missing is not null then
    return jsonb_build_object('ready', false, 'missing', to_jsonb(v_missing),
      'reason', 'Lhůty uchovávání nejsou vyplněny (doplní jednatel podle právničky): ' || array_to_string(v_missing, ', ') || '.');
  end if;
  select max(case when period_from = 'KONEC_POMERU' then v_end else current_date end + make_interval(months => (period_years * 12)::int))::date
    into v_due from public.hr_retention_rules;
  if v_due > current_date then
    return jsonb_build_object('ready', false, 'due_date', v_due, 'reason', 'Lhůty uchovávání ještě neuplynuly (nejdříve ' || to_char(v_due, 'DD.MM.YYYY') || ').');
  end if;
  return jsonb_build_object('ready', true, 'due_date', v_due);
end $$;

create or replace function public.hr_anonymize_employee(p_employee_id text, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a public.hr_approval_requests; v_ready jsonb;
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_EDIT')) then
    raise exception 'Neopravneno.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Uveďte důvod (alespoň 5 znaků).'; end if;
  v_ready := public.hr_anonymization_ready(p_employee_id);
  if not (v_ready->>'ready')::boolean then raise exception '%', v_ready->>'reason'; end if;
  if not public.hr_has_permission('HR_ADMIN') then
    a := public.hr_usable_approval('ANONYMIZE', p_employee_id);
    if a.id is null or a.emergency then
      raise exception 'Anonymizaci schvaluje jednatel – požádejte o schválení.' using errcode = 'P0001';
    end if;
    update public.hr_approval_requests set consumed_at = now() where id = a.id;
  end if;

  delete from public.employee_sensitive_data where employee_id = p_employee_id;
  delete from public.employee_payroll_data where employee_id = p_employee_id;
  delete from public.medical_examinations where employee_id = p_employee_id;
  update public.employees set
    first_name = 'Anonymizováno', last_name = right(p_employee_id, 6), maiden_name = null, title = null,
    date_of_birth = null, place_of_birth = null, country_of_birth = null, gender = null, nationality = null,
    permanent_address = '{}'::jsonb, correspondence_address = '{}'::jsonb, phone = null, private_email = null,
    id_document_type = null, health_insurance_company = null, highest_education = null, notes = null, active = false,
    data = jsonb_build_object('anonymized_at', now(), 'anonymized_by', auth.uid(), 'anonymized_reason', trim(p_reason)),
    updated_at = now()
  where id = p_employee_id;
  perform public.hr_notify('EMPLOYEE_ANONYMIZED', 'NA_VEDOMI', 'Zaměstnanec anonymizován', 'employees', p_employee_id, p_employee_id,
    jsonb_build_object('reason', trim(p_reason)));
end $$;

create or replace function public.hr_offboard_user(p_user_id uuid, p_actor uuid, p_reason text, p_mode text default 'ACCOUNT')
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_email text; v_profile text;
begin
  if p_mode not in ('HR', 'ACCOUNT') then raise exception 'Neznámá akce.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Uveďte důvod (alespoň 5 znaků).'; end if;
  if p_user_id = p_actor then raise exception 'Vlastní přístup v aplikaci neukončíte.'; end if;
  select lower(email) into v_email from auth.users where id = p_user_id;
  select profile into v_profile from public.hr_permissions where user_id = p_user_id or (user_id is null and user_email = v_email) limit 1;
  if v_profile = 'KONATEL' then raise exception 'Přístup jednatele ukončuje IT serverově.'; end if;
  -- koniec pristupu do HR (zaznam ostava; zmena ide do auditu a upozornenia)
  update public.hr_permissions set
    valid_from = least(coalesce(valid_from, current_date - 1), current_date - 1),
    valid_until = current_date - 1,
    note = case when p_mode = 'ACCOUNT' then 'Odchod: ' else 'Konec přístupu do HR: ' end || trim(p_reason)
  where user_id = p_user_id or (user_id is null and user_email = v_email);
  if p_mode = 'ACCOUNT' then
    -- zrusenie vsetkych relacii (obnovovacie tokeny padnu s reláciou)
    delete from auth.refresh_tokens where user_id = p_user_id::text;
    delete from auth.sessions where user_id = p_user_id;
  end if;
  insert into public.audit_log (entity, entity_id, action, old_value, new_value, changed_by, changed_by_role, source)
  values ('auth_user', p_user_id::text, 'update', null,
    jsonb_build_object(case when p_mode = 'ACCOUNT' then 'offboarded' else 'hr_access_ended' end, true, 'email', v_email, 'reason', trim(p_reason)),
    p_actor, 'office', 'server');
  perform public.hr_notify(case when p_mode = 'ACCOUNT' then 'USER_OFFBOARDED' else 'HR_ACCESS_ENDED' end, 'NA_VEDOMI',
    case when p_mode = 'ACCOUNT' then 'Účet zablokován (odchod z firmy): ' else 'Ukončen přístup do HR: ' end || coalesce(v_email, '?'),
    'auth_user', p_user_id::text, null, jsonb_build_object('reason', trim(p_reason)), p_actor);
end $$;

drop function if exists public.hr_take_approval(text, text);
drop function if exists public.hr_approval_matches(public.hr_approval_requests);
drop function if exists public.hr_doc_snapshot(public.hr_documents);
commit;
