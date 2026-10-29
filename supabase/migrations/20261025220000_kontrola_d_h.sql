-- Migracia 75: opravy z nezavislej kontroly balikov D-H (2026-10-29).
-- H1/H2: klasifikaciu dokumentu (typ, povod, sablona, verzia, rucna historia,
--        pomer) meni po vlozeni len server/jednatel; textove dokumenty
--        (potvrdenie, § 21, § 335) vklada len server; rucna historia sa nikdy
--        nepodpise za zamestnavatela bez schvalenia; PS len so sablonou toho
--        isteho typu a s pracovnym pomerom.
-- M1:    schvalenie sa viaze na obsah (odtlacok finalneho PDF, typ, verzia) a
--        cerpa sa so zamkom riadku.
-- M2:    vynimka zo zakonneho limitu sa viaze na konkretne nalezy (kod +
--        hodnoty v sprave), bez nudzoveho postupu.
-- L1:    anonymizacia: lehoty "od vzniku zaznamu" (napr. audit) ju neblokuju.
-- L2:    ziadosti vidi jednatel a HR_EDIT; stav ziadosti len k viditelnemu dokumentu.
-- L3:    odchod: ochrana kazdeho HR_ADMIN, len ucty s pristupom do HR.
-- L4:    hr_legal_parameters bez TRUNCATE/DELETE pre anon a authenticated.
-- N4:    priznak anonymizacie v employees.data meni len anonymizacia.

-- ---------- H1/H2: ochrana klasifikacie dokumentu ----------
-- SECURITY INVOKER: current_user = volajuci (v SECURITY DEFINER funkciach
-- servera vlastnik -> hr_is_server_role).
create or replace function public.hr_documents_classification_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.hr_is_server_role() or public.hr_has_permission('HR_ADMIN') then return new; end if;
  if TG_OP = 'INSERT' then
    if coalesce(new.is_manual_history_entry, false) then
      raise exception 'Ruční historický záznam dokumentu zakládá jen jednatel.' using errcode = '42501';
    end if;
    if new.doc_type in ('potvrzeni_prevzeti', 's21_oznameni_adresy', 's335_pouceni', 's335_souhlas', 's335_odvolani', 'osobni_dotaznik') then
      raise exception 'Tento dokument vytváří jen server ze schváleného textu.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.doc_type is distinct from old.doc_type or new.origin is distinct from old.origin
     or new.template_id is distinct from old.template_id or new.template_version_id is distinct from old.template_version_id
     or new.version_no is distinct from old.version_no or new.is_manual_history_entry is distinct from old.is_manual_history_entry
     or new.employee_id is distinct from old.employee_id
     or (old.employment_id is not null and new.employment_id is distinct from old.employment_id) then
    raise exception 'Typ, původ, šablonu, verzi ani přiřazení dokumentu nelze měnit – vytvořte nový dokument.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists hr_documents_classification_guard on public.hr_documents;
create trigger hr_documents_classification_guard before insert or update on public.hr_documents
  for each row execute function public.hr_documents_classification_guard();

create or replace function public.hr_doc_self_signable(d public.hr_documents)
returns boolean language sql stable set search_path = public as $$
  select d.origin = 'GENERATED' and coalesce(d.version_no, 1) = 1 and not coalesce(d.is_manual_history_entry, false) and (
    -- PS (aj DPP/DPC): schvalena sablona TOHO ISTEHO typu + pracovny pomer (zakonne limity)
    (d.doc_type in ('pracovni_smlouva', 'pracovni_smlouva_cizinec') and d.employment_id is not null
      and exists (select 1 from public.hr_document_template_versions v join public.hr_document_templates t on t.id = v.template_id
        where v.id = d.template_version_id and t.doc_type = d.doc_type))
    -- napln prace, skolenie: len so schvalenou sablonou toho isteho typu
    or (d.doc_type in ('popis_pracovniho_mista', 'hi001_naplen_prace_delnice', 'vstupni_skoleni')
      and exists (select 1 from public.hr_document_template_versions v join public.hr_document_templates t on t.id = v.template_id
        where v.id = d.template_version_id and t.doc_type = d.doc_type))
    -- potvrdenie o prevzati vytvara len server (guard vyssie)
    or d.doc_type = 'potvrzeni_prevzeti');
$$;

-- ---------- M1: schvalenie viazane na obsah ----------
create or replace function public.hr_doc_snapshot(d public.hr_documents)
returns jsonb language sql stable as $$
  select jsonb_build_object('final_pdf_sha256', d.final_pdf_sha256, 'doc_type', d.doc_type, 'version_no', coalesce(d.version_no, 1));
$$;

-- Zodpoveda schvalenie dokumentu, ako je teraz? Ziadosti z aplikacie maju
-- vzdy snimku ('doc'); zaznamy bez nej zapisuje len server/migracia.
create or replace function public.hr_approval_matches(r public.hr_approval_requests)
returns boolean language sql stable security definer set search_path = public as $$
  select case when r.kind not in ('EMPLOYER_SIGN', 'VOID_DOCUMENT') or not (r.payload ? 'doc') then true
    else coalesce((select public.hr_doc_snapshot(d) = r.payload->'doc' from public.hr_documents d where d.id = r.entity_id), false) end;
$$;
revoke all on function public.hr_approval_matches(public.hr_approval_requests) from public, anon, authenticated;

create or replace function public.hr_usable_approval(p_kind text, p_entity_id text)
returns public.hr_approval_requests language sql stable security definer set search_path = public as $$
  select * from public.hr_approval_requests r
  where r.kind = p_kind and r.entity_id = p_entity_id and r.status in ('APPROVED', 'EMERGENCY', 'CONFIRMED') and r.consumed_at is null
    and public.hr_approval_matches(r)
  order by r.requested_at desc limit 1;
$$;

-- Atomicke cerpanie (zamok riadku - dva subezne podpisy nespotrebuju jedno schvalenie).
create or replace function public.hr_take_approval(p_kind text, p_entity_id text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare r public.hr_approval_requests;
begin
  for r in select * from public.hr_approval_requests
      where kind = p_kind and entity_id = p_entity_id and status in ('APPROVED', 'EMERGENCY', 'CONFIRMED') and consumed_at is null
      order by requested_at desc for update loop
    if public.hr_approval_matches(r) then
      update public.hr_approval_requests set consumed_at = now() where id = r.id;
      return r.id;
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.hr_take_approval(text, text) from public, anon, authenticated;

create or replace function public.hr_signatures_employer_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare d public.hr_documents; v_actor uuid;
begin
  if new.signer_type <> 'EMPLOYER' then return new; end if;
  select * into d from public.hr_documents where id = new.hr_document_id;
  if public.hr_doc_self_signable(d) then return new; end if;
  v_actor := coalesce(new.signer_user_id, new.uploaded_by, case when current_setting('role', true) = 'authenticated' then auth.uid() end);
  if v_actor is null then return new; end if;
  if public.hr_user_is_admin(v_actor) then return new; end if;
  if public.hr_take_approval('EMPLOYER_SIGN', d.id) is null then
    raise exception 'Podpis za zaměstnavatele u tohoto dokumentu schvaluje jednatel – požádejte o schválení (nebo použijte nouzový postup). Schválení platí jen pro schválenou verzi dokumentu.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.hr_documents_void_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status in ('VOIDED', 'SUPERSEDED') or new.status not in ('VOIDED', 'SUPERSEDED') then return new; end if;
  if auth.uid() is null or current_setting('role', true) is distinct from 'authenticated' then return new; end if;
  if not exists (select 1 from public.hr_document_signatures s where s.hr_document_id = old.id) then return new; end if;
  if public.hr_user_is_admin(auth.uid()) then return new; end if;
  if public.hr_take_approval('VOID_DOCUMENT', old.id) is null then
    raise exception 'Zneplatnění podepsaného dokumentu schvaluje jednatel – požádejte o schválení (nebo použijte nouzový postup).'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ---------- ziadost: snimka obsahu, nalezy vynimky, bez nudze pri vynimke ----------
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
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_issues jsonb;
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
    -- dokument musi byt pre ziadatela viditelny (klasifikacia citlivosti)
    if exists (select 1 from unnest(public.hr_document_required_permissions(v_doc.id)) perm where not public.hr_has_permission(perm)) then
      raise exception 'Dokument nenalezen.';
    end if;
    if p_kind = 'EMPLOYER_SIGN' and not public.hr_has_permission('HR_SIGN_FOR_EMPLOYER') then raise exception 'Neopravneno.' using errcode = '42501'; end if;
    if p_kind = 'VOID_DOCUMENT' and not public.hr_has_permission('HR_DOCUMENT_VOID') then raise exception 'Neopravneno.' using errcode = '42501'; end if;
    if p_kind = 'EMPLOYER_SIGN' and v_doc.final_pdf_sha256 is null then
      raise exception 'O schválení podpisu lze žádat až k finálnímu PDF (jednatel schvaluje konkrétní znění).';
    end if;
    v_payload := v_payload || jsonb_build_object('doc', public.hr_doc_snapshot(v_doc));
    v_entity := 'hr_documents';
    v_employee := v_doc.employee_id;
  elsif p_kind = 'LEGAL_EXCEPTION' then
    if p_emergency then raise exception 'Výjimka ze zákonného limitu nemá nouzový postup – rozhoduje jednatel.'; end if;
    if not public.hr_has_permission('HR_EDIT') then raise exception 'Neopravneno.' using errcode = '42501'; end if;
    select employee_id into v_employee from public.employment_relationships where id = p_entity_id;
    if v_employee is null then raise exception 'Pracovní poměr nenalezen.'; end if;
    -- nalezy (kod + sprava s hodnotami) pocita server; vynimka plati len pre ne
    select coalesce(jsonb_agg(jsonb_build_object('code', i->>'code', 'message', i->>'message')), '[]'::jsonb) into v_issues
    from jsonb_array_elements(public.hr_check_employment_core(p_entity_id)->'issues') i
    where i->>'level' = 'BLOCK' and i->>'code' in (select jsonb_array_elements_text(coalesce(p_payload->'codes', '[]'::jsonb)));
    if jsonb_array_length(v_issues) = 0 then raise exception 'Chybí, ze kterých limitů se žádá výjimka.'; end if;
    v_payload := v_payload || jsonb_build_object('issues', v_issues);
    v_entity := 'employment_relationships';
  elsif p_kind = 'ANONYMIZE' then
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

  if v_admin then
    insert into public.hr_approval_requests (kind, entity, entity_id, employee_id, payload, reason, status, requested_by, decided_by, decided_at, decision_note)
    values (p_kind, v_entity, p_entity_id, v_employee, v_payload, trim(p_reason), 'APPROVED', auth.uid(), auth.uid(), now(), 'Rozhodnutí jednatele')
    returning id into v_id;
    return v_id;
  end if;
  insert into public.hr_approval_requests (kind, entity, entity_id, employee_id, payload, reason, emergency, emergency_info, status, requested_by)
  values (p_kind, v_entity, p_entity_id, v_employee, v_payload, trim(p_reason), coalesce(p_emergency, false),
    nullif(trim(coalesce(p_emergency_info, '')), ''), case when p_emergency then 'EMERGENCY' else 'PENDING' end, auth.uid())
  returning id into v_id;

  v_title := public.hr_approval_kind_label(p_kind) || case when p_emergency then ' – NOUZOVÝ POSTUP (provedeno bez schválení, potvrďte)' else ' – žádost o schválení' end;
  perform public.hr_notify(case when p_emergency then 'EMERGENCY_STEP' else 'APPROVAL_REQUESTED' end, 'KE_SCHVALENI', v_title,
    'hr_approval_requests', v_id, v_employee,
    jsonb_build_object('kind', p_kind, 'entity_id', p_entity_id, 'reason', trim(p_reason), 'emergency_info', p_emergency_info, 'payload', v_payload));
  return v_id;
exception when unique_violation then
  raise exception 'Žádost o schválení už čeká na jednatele.';
end $$;

-- vynimka plati len pre nalez s rovnakym kodom AJ spravou (hodnoty)
create or replace function public.hr_check_employment_core_with_exceptions(p_employment_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_ok jsonb; v_ex jsonb;
begin
  v := public.hr_check_employment_core(p_employment_id);
  select coalesce(jsonb_agg(x), '[]'::jsonb), coalesce(jsonb_agg(distinct jsonb_build_object('id', r.id, 'status', r.status, 'issues', r.payload->'issues')), '[]'::jsonb)
    into v_ok, v_ex
  from public.hr_approval_requests r, jsonb_array_elements(coalesce(r.payload->'issues', '[]'::jsonb)) x
  where r.kind = 'LEGAL_EXCEPTION' and r.entity_id = p_employment_id and r.status in ('APPROVED', 'EMERGENCY', 'CONFIRMED');
  if jsonb_array_length(v_ok) = 0 then return v; end if;
  return v || jsonb_build_object(
    'issues', (select coalesce(jsonb_agg(case when i->>'level' = 'BLOCK'
          and v_ok @> jsonb_build_array(jsonb_build_object('code', i->>'code', 'message', i->>'message'))
        then i || jsonb_build_object('level', 'WARN', 'exception', true, 'message', 'VÝJIMKA schválená jednatelem: ' || (i->>'message'))
        else i end), '[]'::jsonb) from jsonb_array_elements(v->'issues') i),
    'exceptions', v_ex);
end $$;

-- ---------- L2: kto vidi ziadosti ----------
drop policy if exists hr_approval_requests_select on public.hr_approval_requests;
create policy hr_approval_requests_select on public.hr_approval_requests for select
  using (public.hr_role_ok() and (public.hr_has_permission('HR_ADMIN') or public.hr_has_permission('HR_EDIT') or requested_by = auth.uid()));

create or replace function public.hr_approval_state(p_kind text, p_entity_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_doc public.hr_documents; v_needed boolean := true; v_last public.hr_approval_requests;
begin
  if not (public.hr_role_ok() and (public.hr_has_permission('HR_EDIT') or public.hr_has_permission('HR_ADMIN'))) then
    raise exception 'Neopravneno.' using errcode = '42501';
  end if;
  if p_kind in ('EMPLOYER_SIGN', 'VOID_DOCUMENT') then
    select * into v_doc from public.hr_documents where id = p_entity_id;
    if v_doc.id is null or exists (select 1 from unnest(public.hr_document_required_permissions(v_doc.id)) perm where not public.hr_has_permission(perm)) then
      raise exception 'Dokument nenalezen.';
    end if;
    v_needed := case when p_kind = 'EMPLOYER_SIGN' then not public.hr_doc_self_signable(v_doc)
      else exists (select 1 from public.hr_document_signatures s where s.hr_document_id = p_entity_id) end;
  end if;
  if public.hr_has_permission('HR_ADMIN') then v_needed := false; end if;
  select * into v_last from public.hr_approval_requests where kind = p_kind and entity_id = p_entity_id order by requested_at desc limit 1;
  return jsonb_build_object('needed', v_needed,
    'usable', (public.hr_usable_approval(p_kind, p_entity_id)).id is not null,
    'last', case when v_last.id is null then null else jsonb_build_object('id', v_last.id, 'status', v_last.status, 'reason', v_last.reason,
      'emergency', v_last.emergency, 'decision_note', v_last.decision_note, 'requested_at', v_last.requested_at, 'mine', v_last.requested_by = auth.uid(),
      'consumed', v_last.consumed_at is not null, 'outdated', not public.hr_approval_matches(v_last)) end);
end $$;

-- ---------- L1: anonymizacia - lehoty od vzniku zaznamu ju neblokuju ----------
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
  -- lehoty "od vzniku zaznamu" (napr. audit) sa tykaju zaznamov, nie karty zamestnanca
  select max((v_end + make_interval(months => (period_years * 12)::int))::date) into v_due
  from public.hr_retention_rules where period_from = 'KONEC_POMERU';
  if v_due is not null and v_due > current_date then
    return jsonb_build_object('ready', false, 'due_date', v_due, 'reason', 'Lhůty uchovávání ještě neuplynuly (nejdříve ' || to_char(v_due, 'DD.MM.YYYY') || ').');
  end if;
  return jsonb_build_object('ready', true, 'due_date', v_due);
end $$;

-- ---------- N4: priznak anonymizacie meni len anonymizacia ----------
create or replace function public.hr_employees_anonymized_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.data->'anonymized_at') is distinct from (old.data->'anonymized_at')
     and current_setting('hr.anonymizing', true) is distinct from 'on' and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'Příznak anonymizace mění jen anonymizace.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists hr_employees_anonymized_guard on public.employees;
create trigger hr_employees_anonymized_guard before update on public.employees
  for each row execute function public.hr_employees_anonymized_guard();

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
    select * into a from public.hr_approval_requests
    where kind = 'ANONYMIZE' and entity_id = p_employee_id and status in ('APPROVED', 'CONFIRMED') and consumed_at is null and not emergency
    order by requested_at desc limit 1 for update;
    if a.id is null then
      raise exception 'Anonymizaci schvaluje jednatel – požádejte o schválení.' using errcode = 'P0001';
    end if;
    update public.hr_approval_requests set consumed_at = now() where id = a.id;
  end if;
  perform set_config('hr.anonymizing', 'on', true);
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
  perform set_config('hr.anonymizing', 'off', true);
  perform public.hr_notify('EMPLOYEE_ANONYMIZED', 'NA_VEDOMI', 'Zaměstnanec anonymizován', 'employees', p_employee_id, p_employee_id,
    jsonb_build_object('reason', trim(p_reason)));
end $$;

-- ---------- L3: odchod - kazdy HR_ADMIN chraneny, len ucty HR ----------
create or replace function public.hr_offboard_user(p_user_id uuid, p_actor uuid, p_reason text, p_mode text default 'ACCOUNT')
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_email text;
begin
  if p_mode not in ('HR', 'ACCOUNT') then raise exception 'Neznámá akce.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Uveďte důvod (alespoň 5 znaků).'; end if;
  if p_user_id = p_actor then raise exception 'Vlastní přístup v aplikaci neukončíte.'; end if;
  select lower(email) into v_email from auth.users where id = p_user_id;
  if not public.hr_is_hr_account(p_user_id) then raise exception 'Účet nemá přístup do HR – v aplikaci ho neukončíte.'; end if;
  if public.hr_user_is_admin(p_user_id) or exists (select 1 from public.hr_permissions
      where (user_id = p_user_id or (user_id is null and user_email = v_email)) and profile = 'KONATEL') then
    raise exception 'Přístup jednatele ukončuje IT serverově.';
  end if;
  update public.hr_permissions set
    valid_from = least(coalesce(valid_from, current_date - 1), current_date - 1),
    valid_until = current_date - 1,
    note = case when p_mode = 'ACCOUNT' then 'Odchod: ' else 'Konec přístupu do HR: ' end || trim(p_reason)
  where user_id = p_user_id or (user_id is null and user_email = v_email);
  if p_mode = 'ACCOUNT' then
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

-- ---------- L4: zakonne parametre bez TRUNCATE/DELETE ----------
revoke all on public.hr_legal_parameters from anon, authenticated;
grant select, insert, update on public.hr_legal_parameters to authenticated;
