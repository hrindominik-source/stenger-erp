-- Migracia 72 (balik F): GDPR.
-- 1. Lehoty uchovavania (hr_retention_rules) - kategorie bez hodnot; dlzku,
--    od coho sa pocita a co sa potom robi, vyplni jednatel podla pravnicky.
--    Pripomienka (hr_retention_due) az pri vyplnenej lehote.
-- 2. Anonymizacia zamestnanca - len po uplynuti VSETKYCH lehot, so schvalenim
--    jednatela (styri oci, bez nudzoveho postupu). Dokumenty, subory a
--    audit_log ostavaju (rozhodne pravnicka).
-- 3. Export udajov zamestnanca (hr_export_employee) - zaznam v audite
--    (action 'read', ucel 'export') + upozornenie jednatelovi.
-- 4. Dovod opravy (hr_corrections) naviazany na zaznamy audit_log.
-- 5. Zoznam spracovatelov (hr_processors) pre zaznam o cinnostiach.
-- Zaznam o citani citlivych udajov je v migracii 68.

-- ---------- 1. lehoty uchovavania ----------
create table if not exists public.hr_retention_rules (
  id text primary key default gen_random_uuid()::text,
  key text not null unique,
  label text not null,
  scope text not null,
  period_years numeric check (period_years is null or period_years > 0),
  period_from text check (period_from in ('KONEC_POMERU', 'VZNIK_ZAZNAMU')),
  action text check (action in ('ARCHIVOVAT', 'ANONYMIZOVAT', 'SKARTOVAT')),
  source text,
  note text,
  entered_by uuid references auth.users(id),
  entered_at timestamptz,
  check (period_years is null or (period_from is not null and action is not null and length(trim(coalesce(source, ''))) > 0))
);
alter table public.hr_retention_rules enable row level security;
revoke all on public.hr_retention_rules from anon, authenticated;
grant select, update on public.hr_retention_rules to authenticated;
create policy hr_retention_rules_select on public.hr_retention_rules for select
  using (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC'));
create policy hr_retention_rules_admin on public.hr_retention_rules for update
  using (public.hr_has_permission('HR_ADMIN')) with check (public.hr_has_permission('HR_ADMIN'));

create or replace function public.hr_retention_rules_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.entered_by := auth.uid();
    new.entered_at := now();
  end if;
  new.key := old.key; -- kategoria sa nemeni
  return new;
end $$;
drop trigger if exists hr_retention_rules_stamp on public.hr_retention_rules;
create trigger hr_retention_rules_stamp before update on public.hr_retention_rules
  for each row execute function public.hr_retention_rules_stamp();
drop trigger if exists audit_hr_retention_rules on public.hr_retention_rules;
create trigger audit_hr_retention_rules after insert or update on public.hr_retention_rules
  for each row execute function public.audit_trigger();

create or replace function public.hr_retention_rules_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.hr_notify('RETENTION_CHANGED', 'NA_VEDOMI', 'Lhůta uchovávání: ' || new.label,
    'hr_retention_rules', new.id, null,
    jsonb_build_object('period_years', new.period_years, 'period_from', new.period_from, 'action', new.action, 'source', new.source));
  return new;
end $$;
drop trigger if exists hr_retention_rules_notify on public.hr_retention_rules;
create trigger hr_retention_rules_notify after update on public.hr_retention_rules
  for each row execute function public.hr_retention_rules_notify();

-- kategorie podla inventara (docs/audit/04-gdpr.md); hodnoty nevyplnene
insert into public.hr_retention_rules (key, label, scope) values
  ('OSOBNI_SPIS', 'Osobní spis, pracovní smlouvy a dodatky', 'zaměstnanec, dokumenty'),
  ('MZDOVE_LISTY', 'Mzdové listy a podklady pro důchodové pojištění', 'mzdové údaje'),
  ('MZDY_UCETNI', 'Mzdová a účetní evidence', 'mzdové údaje'),
  ('DANE', 'Prohlášení poplatníka a daňové doklady', 'mzdové údaje, přílohy'),
  ('LEKARSKE', 'Lékařské prohlídky a posudky', 'lékařské prohlídky'),
  ('BOZP', 'Školení BOZP a ověření znalostí', 'školení'),
  ('EXEKUCE', 'Exekuce a insolvence', 'doklady exekucí'),
  ('PODPISY', 'Důkazy o podpisu a doručení', 'podpisy, doručení'),
  ('KIOSK_NEPRIJATI', 'Dotazníky nepřijatých uchazečů (kiosk)', 'koncepty dotazníků'),
  ('AUDIT', 'Záznamy změn a čtení (audit)', 'audit_log')
on conflict (key) do nothing;

-- Zamestnanci, ktorym podla vyplnenych lehot konci uchovavanie (do 30 dni
-- alebo uz skoncilo). Pocita sa od konca posledneho pomeru.
create or replace function public.hr_retention_due()
returns table (employee_id text, employee_name text, rule_key text, rule_label text, action text, due_date date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC')) then
    raise exception 'Neopravneno.' using errcode = '42501';
  end if;
  return query
  with ended as (
    select r.employee_id, max(coalesce(r.termination_date, r.fixed_term_end_date)) as end_date
    from public.employment_relationships r
    group by r.employee_id
    having bool_and(r.status = 'ENDED') and max(coalesce(r.termination_date, r.fixed_term_end_date)) is not null
  )
  select e.id, e.first_name || ' ' || e.last_name, rr.key, rr.label, rr.action,
    (en.end_date + make_interval(months => (rr.period_years * 12)::int))::date
  from ended en
  join public.employees e on e.id = en.employee_id
  join public.hr_retention_rules rr on rr.period_years is not null and rr.period_from = 'KONEC_POMERU'
  where coalesce(e.data->>'anonymized_at', '') = ''
    and (en.end_date + make_interval(months => (rr.period_years * 12)::int))::date <= current_date + 30
  order by 6, 2;
end $$;
revoke all on function public.hr_retention_due() from public, anon;
grant execute on function public.hr_retention_due() to authenticated;

-- Moze sa zamestnanec anonymizovat? Az ked su vsetky lehoty vyplnene a uplynuli.
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
revoke all on function public.hr_anonymization_ready(text) from public, anon;
grant execute on function public.hr_anonymization_ready(text) to authenticated;

-- ---------- 2. anonymizacia (styri oci) ----------
alter table public.hr_approval_requests drop constraint if exists hr_approval_requests_kind_check;
alter table public.hr_approval_requests add constraint hr_approval_requests_kind_check
  check (kind in ('EMPLOYER_SIGN', 'VOID_DOCUMENT', 'LEGAL_EXCEPTION', 'ANONYMIZE'));

create or replace function public.hr_approval_kind_label(p_kind text)
returns text language sql immutable as $$
  select case p_kind when 'EMPLOYER_SIGN' then 'Podpis za zaměstnavatele'
    when 'VOID_DOCUMENT' then 'Zneplatnění podepsaného dokumentu'
    when 'LEGAL_EXCEPTION' then 'Výjimka ze zákonného limitu'
    when 'ANONYMIZE' then 'Anonymizace zaměstnance' end;
$$;

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

-- Anonymizacia: osobne udaje v karte, citlive, mzdove a lekarske udaje.
-- Ostava: identifikator, pracovne pomery (datumy, typ), dokumenty a subory,
-- audit_log (rozhodne pravnicka - otazky).
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
revoke all on function public.hr_anonymize_employee(text, text) from public, anon;
grant execute on function public.hr_anonymize_employee(text, text) to authenticated;

-- ---------- 3. export udajov zamestnanca ----------
create or replace function public.hr_export_employee(p_employee_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v jsonb; v_medical boolean := public.hr_has_permission('HR_VIEW_MEDICAL_ADMIN'); v_docs jsonb;
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_SENSITIVE') and public.hr_has_permission('HR_VIEW_PAYROLL')) then
    raise exception 'Export smí jen uživatel s přístupem k citlivým a mzdovým údajům.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees where id = p_employee_id) then raise exception 'Zaměstnanec nenalezen.'; end if;
  -- dokumenty len tie, ktore pouzivatel smie vidiet (ako RLS hr_documents)
  select coalesce(jsonb_agg(to_jsonb(d) - 'variables_snapshot' order by d.created_at), '[]'::jsonb) into v_docs
  from public.hr_documents d
  where d.employee_id = p_employee_id
    and not exists (select 1 from unnest(public.hr_document_required_permissions(d.id)) perm where not public.hr_has_permission(perm));
  v := jsonb_build_object(
    'exported_at', now(),
    'employee', (select to_jsonb(e) from public.employees e where e.id = p_employee_id),
    'sensitive', (select to_jsonb(s) from public.employee_sensitive_data s where s.employee_id = p_employee_id),
    'payroll', (select to_jsonb(p) from public.employee_payroll_data p where p.employee_id = p_employee_id),
    'employments', (select coalesce(jsonb_agg(to_jsonb(r) order by r.start_date), '[]'::jsonb) from public.employment_relationships r where r.employee_id = p_employee_id),
    'contract_events', (select coalesce(jsonb_agg(to_jsonb(c) order by c.event_date), '[]'::jsonb) from public.employment_contract_events c
      where c.employment_id in (select id from public.employment_relationships where employee_id = p_employee_id)),
    'timeline', (select coalesce(jsonb_agg(to_jsonb(t) order by t.event_date), '[]'::jsonb) from public.employee_timeline_events t where t.employee_id = p_employee_id),
    'trainings', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.hr_training_records t where t.employee_id = p_employee_id),
    'medical_examinations', case when v_medical then (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.medical_examinations m where m.employee_id = p_employee_id) end,
    'contact_declarations', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.employee_contact_declarations c where c.employee_id = p_employee_id),
    'documents', v_docs,
    'signatures', (select coalesce(jsonb_agg(jsonb_build_object('document_id', s.hr_document_id, 'signer_type', s.signer_type, 'method', s.method,
        'signed_by_name', s.signed_by_name, 'signed_at', s.signed_at, 'document_hash', s.document_hash)), '[]'::jsonb)
      from public.hr_document_signatures s where s.hr_document_id in (select x->>'id' from jsonb_array_elements(v_docs) x)),
    'deliveries', (select coalesce(jsonb_agg(to_jsonb(dl)), '[]'::jsonb) from public.hr_document_deliveries dl
      where dl.hr_document_id in (select x->>'id' from jsonb_array_elements(v_docs) x))
  );
  perform public.hr_log_read('employees', p_employee_id, 'export',
    jsonb_build_object('documents', jsonb_array_length(v_docs), 'medical', v_medical));
  perform public.hr_notify('EMPLOYEE_EXPORTED', 'NA_VEDOMI', 'Export údajů zaměstnance', 'employees', p_employee_id, p_employee_id,
    jsonb_build_object('documents', jsonb_array_length(v_docs)));
  return v;
end $$;
revoke all on function public.hr_export_employee(text) from public, anon;
grant execute on function public.hr_export_employee(text) to authenticated;

-- ---------- 4. dovod opravy ----------
create table if not exists public.hr_corrections (
  id text primary key default gen_random_uuid()::text,
  employee_id text not null references public.employees(id) on delete cascade,
  reason text not null check (length(trim(reason)) >= 3),
  audit_ids bigint[] not null default '{}',
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists hr_corrections_employee on public.hr_corrections (employee_id, created_at desc);
alter table public.hr_corrections enable row level security;
revoke all on public.hr_corrections from anon, authenticated;
grant select on public.hr_corrections to authenticated;
create policy hr_corrections_select on public.hr_corrections for select
  using (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC'));

-- Po ulozeni zmeny: dovod sa naviaze na zmeny pouzivatela za poslednych 5 min
-- (karta, citlive a mzdove udaje, pracovny pomer), este bez dovodu.
create or replace function public.hr_record_correction(p_employee_id text, p_reason text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_id text; v_ids bigint[];
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_EDIT')) then
    raise exception 'Neopravneno.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Uveďte důvod změny.'; end if;
  select coalesce(array_agg(a.id order by a.id), '{}') into v_ids
  from public.audit_log a
  where a.changed_by = auth.uid() and a.action in ('insert', 'update', 'delete') and a.created_at > now() - interval '5 minutes'
    and ((a.entity in ('employees', 'employee_sensitive_data', 'employee_payroll_data') and a.entity_id = p_employee_id)
      or (a.entity = 'employment_relationships' and a.entity_id in (select id from public.employment_relationships where employee_id = p_employee_id)))
    and not exists (select 1 from public.hr_corrections c where c.employee_id = p_employee_id and a.id = any (c.audit_ids));
  insert into public.hr_corrections (employee_id, reason, audit_ids, created_by)
  values (p_employee_id, trim(p_reason), v_ids, auth.uid()) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.hr_record_correction(text, text) from public, anon;
grant execute on function public.hr_record_correction(text, text) to authenticated;

-- ---------- 5. spracovatelia ----------
create table if not exists public.hr_processors (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  data_categories text,
  purpose text,
  dpa_status text not null default 'NEOVERENO' check (dpa_status in ('NEOVERENO', 'UZAVRENA', 'NEPOTREBNA')),
  region text,
  note text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.hr_processors enable row level security;
revoke all on public.hr_processors from anon, authenticated;
grant select, insert, update on public.hr_processors to authenticated;
create policy hr_processors_admin on public.hr_processors for all
  using (public.hr_has_permission('HR_ADMIN')) with check (public.hr_has_permission('HR_ADMIN'));
create or replace function public.hr_processors_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists hr_processors_stamp on public.hr_processors;
create trigger hr_processors_stamp before insert or update on public.hr_processors
  for each row execute function public.hr_processors_stamp();
drop trigger if exists audit_hr_processors on public.hr_processors;
create trigger audit_hr_processors after insert or update on public.hr_processors
  for each row execute function public.audit_trigger();

-- podklad z docs/audit/04-gdpr.md; zmluvy (DPA) a region su neoverene
insert into public.hr_processors (id, name, data_categories, purpose, note) values
  ('proc-supabase', 'Supabase (databáze, úložiště, přihlášení, serverové funkce)', 'všechny údaje v Personalistice vč. zvláštních kategorií; IP v logech přihlášení', 'provoz systému', 'Ověřit DPA, region, šifrování, zálohy, kdo má přístup.'),
  ('proc-netlify', 'Netlify (webová aplikace)', 'IP, adresy stránek vč. podpisového odkazu v logech', 'provoz webu', 'Ověřit DPA, region, uchovávání logů.'),
  ('proc-server', 'Budoucí vlastní server / hosting', 'kompletní databáze a úložiště', 'provoz systému', 'Smlouva se správcem, umístění, šifrování disků a záloh.'),
  ('proc-email', 'Poskytovatel e-mailů (zatím nevybraný)', 'jméno, soukromý e-mail, PDF smluv a výměrů', 'doručování písemností', 'Ověřit DPA, region, šifrování.'),
  ('proc-ucetni', 'Externí účetní', 'mzdové a daňové údaje', 'mzdy, daně, odvody', 'Zpracovatel, nebo samostatný správce? (právnička)'),
  ('proc-pls', 'Poskytovatel pracovnělékařských služeb', 'mimo systém – v systému jen evidence prohlídek', 'pracovnělékařské služby', '')
on conflict (id) do nothing;
