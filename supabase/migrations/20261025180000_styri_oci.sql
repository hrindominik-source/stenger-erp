-- Migracia 71 (balik E): princip styroch oci pre rizikove kroky.
-- Spolocny mechanizmus hr_approval_requests: rizikovy krok sa najprv zapise
-- ako ziadost a vykona sa az po schvaleni jednatelom (DB, nie len UI).
--
-- Kroky (rozhodnutie jednatela):
-- - EMPLOYER_SIGN: podpis za zamestnavatela pri dokumente, ktory personalistka
--   nepodpisuje sama. Sama podpise len PS, napln prace a vstupne skolenie zo
--   schvalenej sablony (povodna verzia, generovana); vsetko ostatne (vypoved,
--   zrusenie, dohoda o skonceni, mzdovy/platovy vymer = zmena mzdy, dodatok,
--   nahraty alebo upraveny dokument = odchylka od sablony) schvaluje jednatel.
-- - VOID_DOCUMENT: zneplatnenie/nahradenie dokumentu, ktory uz ma podpis.
-- - LEGAL_EXCEPTION: vynimka zo zakonneho limitu (balik D) pre pracovny pomer.
-- Jednatel (HR_ADMIN) tieto kroky robi sam bez ziadosti.
-- Nudzovy postup: navrhovatel uvedie dovod a ako jednatela informoval; krok
-- sa povoli hned, jednatel dostane upozornenie a musi ho dodatocne potvrdit
-- alebo odmietnut - do vyriesenia je v jeho prehlade otvoreny. Pre opravnenia
-- a trvale mazanie nudzovy postup nie je (tie robi len jednatel).

create table if not exists public.hr_approval_requests (
  id text primary key default gen_random_uuid()::text,
  kind text not null check (kind in ('EMPLOYER_SIGN', 'VOID_DOCUMENT', 'LEGAL_EXCEPTION')),
  entity text not null,
  entity_id text not null,
  employee_id text,
  payload jsonb not null default '{}'::jsonb,
  reason text not null check (length(trim(reason)) >= 5),
  emergency boolean not null default false,
  emergency_info text,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EMERGENCY', 'CONFIRMED', 'REJECTED_AFTER', 'CANCELLED')),
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  consumed_at timestamptz,
  check (not emergency or length(trim(coalesce(emergency_info, ''))) >= 5)
);
create unique index if not exists hr_approval_requests_open on public.hr_approval_requests (kind, entity_id) where status = 'PENDING';
alter table public.hr_approval_requests enable row level security;
revoke all on public.hr_approval_requests from anon, authenticated;
grant select on public.hr_approval_requests to authenticated;
create policy hr_approval_requests_select on public.hr_approval_requests for select
  using (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC'));

drop trigger if exists audit_hr_approval_requests on public.hr_approval_requests;
create trigger audit_hr_approval_requests after insert or update on public.hr_approval_requests
  for each row execute function public.audit_trigger();

-- Je pouzivatel jednatel (HR_ADMIN) - pre podpis/zneplatnenie robeny serverom
-- v jeho mene (signer_user_id / uploaded_by).
create or replace function public.hr_user_is_admin(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.hr_permissions p
    where (p.user_id = p_user or (p.user_id is null and p.user_email = (select lower(email) from auth.users where id = p_user)))
      and (p.valid_from is null or p.valid_from <= current_date)
      and (p.valid_until is null or p.valid_until >= current_date)
      and 'HR_ADMIN' = any (coalesce(case when p.profile = 'VLASTNI' then p.permissions end, public.hr_profile_permissions(p.profile), '{}'::text[])));
$$;
revoke all on function public.hr_user_is_admin(uuid) from public, anon, authenticated;

-- Dokumenty, ktore personalistka podpise za zamestnavatela sama (rozhodnutie
-- jednatela): PS (aj DPP/DPC), napln prace a zaznam o skoleni zo schvalenej
-- sablony v povodnej verzii; potvrdenie o prevzati zo schvaleneho textu.
create or replace function public.hr_doc_self_signable(d public.hr_documents)
returns boolean language sql stable set search_path = public as $$
  select d.origin = 'GENERATED' and coalesce(d.version_no, 1) = 1 and (
    (d.template_version_id is not null
      and d.doc_type in ('pracovni_smlouva', 'pracovni_smlouva_cizinec', 'popis_pracovniho_mista', 'hi001_naplen_prace_delnice', 'vstupni_skoleni'))
    or d.doc_type = 'potvrzeni_prevzeti');
$$;

create or replace function public.hr_approval_kind_label(p_kind text)
returns text language sql immutable as $$
  select case p_kind when 'EMPLOYER_SIGN' then 'Podpis za zaměstnavatele'
    when 'VOID_DOCUMENT' then 'Zneplatnění podepsaného dokumentu'
    when 'LEGAL_EXCEPTION' then 'Výjimka ze zákonného limitu' end;
$$;

-- ---------- ziadost ----------
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
revoke all on function public.hr_request_approval(text, text, text, jsonb, boolean, text) from public, anon;
grant execute on function public.hr_request_approval(text, text, text, jsonb, boolean, text) to authenticated;

-- ---------- rozhodnutie jednatela ----------
create or replace function public.hr_decide_approval(p_id text, p_approve boolean, p_note text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare r public.hr_approval_requests;
begin
  if not public.hr_has_permission('HR_ADMIN') then raise exception 'Schvaluje jen jednatel.' using errcode = '42501'; end if;
  select * into r from public.hr_approval_requests where id = p_id for update;
  if not found then raise exception 'Žádost nenalezena.'; end if;
  if r.requested_by = auth.uid() then raise exception 'Vlastní žádost nelze schválit (čtyři oči).'; end if;
  if r.status not in ('PENDING', 'EMERGENCY') then raise exception 'Žádost už je vyřízena.'; end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Uveďte důvod zamítnutí.'; end if;
  update public.hr_approval_requests set
    status = case when r.status = 'PENDING' then (case when p_approve then 'APPROVED' else 'REJECTED' end)
                  else (case when p_approve then 'CONFIRMED' else 'REJECTED_AFTER' end) end,
    decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id;
  update public.hr_notifications set resolved_at = now(), read_at = coalesce(read_at, now())
  where entity = 'hr_approval_requests' and entity_id = p_id and kind = 'KE_SCHVALENI' and resolved_at is null;
end $$;
revoke all on function public.hr_decide_approval(text, boolean, text) from public, anon;
grant execute on function public.hr_decide_approval(text, boolean, text) to authenticated;

-- Navrhovatel stiahne cakajucu ziadost.
create or replace function public.hr_cancel_approval(p_id text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.hr_approval_requests set status = 'CANCELLED', decided_at = now()
  where id = p_id and status = 'PENDING' and requested_by = auth.uid();
  if not found then raise exception 'Zrušit lze jen vlastní čekající žádost.'; end if;
  update public.hr_notifications set resolved_at = now(), read_at = coalesce(read_at, now())
  where entity = 'hr_approval_requests' and entity_id = p_id and kind = 'KE_SCHVALENI' and resolved_at is null;
end $$;
revoke all on function public.hr_cancel_approval(text) from public, anon;
grant execute on function public.hr_cancel_approval(text) to authenticated;

-- Pouzitelne schvalenie kroku (schvalene / nudzove), este nespotrebovane.
create or replace function public.hr_usable_approval(p_kind text, p_entity_id text)
returns public.hr_approval_requests language sql stable security definer set search_path = public as $$
  select * from public.hr_approval_requests
  where kind = p_kind and entity_id = p_entity_id and status in ('APPROVED', 'EMERGENCY', 'CONFIRMED') and consumed_at is null
  order by requested_at desc limit 1;
$$;
revoke all on function public.hr_usable_approval(text, text) from public, anon, authenticated;

-- Pre UI: treba schvalenie? je k dispozicii? posledna ziadost.
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
revoke all on function public.hr_approval_state(text, text) from public, anon;
grant execute on function public.hr_approval_state(text, text) to authenticated;

-- ---------- vynutenie: podpis za zamestnavatela ----------
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
-- "zz_": az po povodnych kontrolach opravneni a plnej moci (poradie podla mena)
drop trigger if exists zz_hr_signatures_employer_approval on public.hr_document_signatures;
create trigger zz_hr_signatures_employer_approval before insert on public.hr_document_signatures
  for each row execute function public.hr_signatures_employer_approval();

-- ---------- vynutenie: zneplatnenie / nahradenie podpisaneho ----------
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
drop trigger if exists zz_hr_documents_void_approval on public.hr_documents;
create trigger zz_hr_documents_void_approval before update of status on public.hr_documents
  for each row execute function public.hr_documents_void_approval();

-- ---------- vynimka zo zakonneho limitu (balik D) ----------
-- Schvalena/nudzova vynimka pokryva uvedene kody limitov pre dany pomer;
-- bloky s tymito kodmi sa zmenia na upozornenie "VYJIMKA".
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
revoke all on function public.hr_check_employment_core_with_exceptions(text) from public, anon, authenticated;

create or replace function public.hr_check_employment(p_employment_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC')) then
    raise exception 'Neopravneno.' using errcode = '42501';
  end if;
  return public.hr_check_employment_core_with_exceptions(p_employment_id);
end $$;

create or replace function public.hr_documents_legal_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare v jsonb; v_blocks text;
begin
  if new.origin <> 'GENERATED' or new.employment_id is null or coalesce(new.is_manual_history_entry, false)
     or new.doc_type not in ('pracovni_smlouva', 'pracovni_smlouva_cizinec', 'mzdovy_vymer', 'dodatek') then
    return new;
  end if;
  v := public.hr_check_employment_core_with_exceptions(new.employment_id);
  select string_agg(i->>'message', ' ') into v_blocks from jsonb_array_elements(v->'issues') i where i->>'level' = 'BLOCK';
  if v_blocks is not null then
    raise exception 'Dokument nelze vytvořit – zákonný limit: %', v_blocks using errcode = 'P0001';
  end if;
  new.legal_check := v; -- pouzite parametre, upozornenia a vynimky ku dnu generovania
  return new;
end $$;

create or replace function public.hr_signatures_legal_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare d public.hr_documents; v jsonb; v_blocks text;
begin
  select * into d from public.hr_documents where id = new.hr_document_id;
  if d.origin <> 'GENERATED' or d.employment_id is null or coalesce(d.is_manual_history_entry, false)
     or d.doc_type not in ('pracovni_smlouva', 'pracovni_smlouva_cizinec', 'mzdovy_vymer', 'dodatek') then
    return new;
  end if;
  v := public.hr_check_employment_core_with_exceptions(d.employment_id);
  select string_agg(i->>'message', ' ') into v_blocks from jsonb_array_elements(v->'issues') i where i->>'level' = 'BLOCK';
  if v_blocks is not null then
    raise exception 'Dokument nelze podepsat – zákonný limit: %', v_blocks using errcode = 'P0001';
  end if;
  return new;
end $$;

-- nudzove kroky cakajuce na potvrdenie a cakajuce ziadosti v suhrne jednatela
create or replace function public.hr_open_approvals()
returns setof public.hr_approval_requests language plpgsql stable security definer set search_path = public as $$
begin
  if not public.hr_has_permission('HR_ADMIN') then raise exception 'Neopravneno.' using errcode = '42501'; end if;
  return query select * from public.hr_approval_requests where status in ('PENDING', 'EMERGENCY') order by emergency desc, requested_at;
end $$;
revoke all on function public.hr_open_approvals() from public, anon;
grant execute on function public.hr_open_approvals() to authenticated;
