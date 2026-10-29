-- Migracia 70 (balik D): zakonne parametre a kontroly pri generovani a podpise.
-- - hr_legal_parameters: kluc, hodnota, jednotka, platnost od-do, zdroj, kto
--   zadal/schvalil. Meni len jednatel (HR_ADMIN); audit + upozornenie.
-- - Hodnoty zadal jednatel pokynom (2026-10-28). Co nezadal, je prazdne
--   (value is null) a kontrola, ktora ho potrebuje, len upozorni.
-- - hr_check_employment: kontroly pracovneho pomeru; BLOK = zakonny limit,
--   UPOZORNENI = ostatne. Bloky plati pri vzniku generovaneho dokumentu
--   (PS, mzdovy vymer, dodatok) a pri podpise; pouzite parametre sa ulozia
--   k dokumentu (hr_documents.legal_check). Vynimka zo zakonneho limitu az
--   so schvalenim jednatelom (balik E).

create table if not exists public.hr_legal_parameters (
  id text primary key default gen_random_uuid()::text,
  key text not null,
  label text not null,
  value numeric,
  value_text text,
  unit text,
  valid_from date,
  valid_to date,
  source text,
  note text,
  entered_by uuid references auth.users(id),
  entered_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  approval_note text,
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  unique nulls not distinct (key, valid_from)
);
alter table public.hr_legal_parameters enable row level security;
grant select, insert, update, delete on public.hr_legal_parameters to authenticated;

create policy hr_legal_parameters_select on public.hr_legal_parameters for select
  using (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC'));
create policy hr_legal_parameters_admin on public.hr_legal_parameters for all
  using (public.hr_has_permission('HR_ADMIN')) with check (public.hr_has_permission('HR_ADMIN'));

-- zmenu v aplikacii zadava aj schvaluje jednatel (jediny, kto smie)
create or replace function public.hr_legal_parameters_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then -- zmena z aplikacie (nie migracia/server)
    new.entered_by := auth.uid();
    new.entered_at := now();
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  return new;
end $$;
drop trigger if exists hr_legal_parameters_stamp on public.hr_legal_parameters;
create trigger hr_legal_parameters_stamp before insert or update on public.hr_legal_parameters
  for each row execute function public.hr_legal_parameters_stamp();

drop trigger if exists audit_hr_legal_parameters on public.hr_legal_parameters;
create trigger audit_hr_legal_parameters after insert or update or delete on public.hr_legal_parameters
  for each row execute function public.audit_trigger();

create or replace function public.hr_notify_legal_parameters()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  perform public.hr_notify('LEGAL_PARAM_CHANGED', 'NA_VEDOMI',
    'Zákonný parametr ' || lower(tg_op) || ': ' || r.label, 'hr_legal_parameters', r.id, null,
    jsonb_build_object('key', r.key, 'value', r.value, 'value_text', r.value_text, 'valid_from', r.valid_from, 'source', r.source,
      'old_value', case when tg_op = 'UPDATE' then old.value end));
  return null;
end $$;
drop trigger if exists hr_notify_legal_parameters on public.hr_legal_parameters;
create trigger hr_notify_legal_parameters after insert or update or delete on public.hr_legal_parameters
  for each row when (current_user = 'authenticated') execute function public.hr_notify_legal_parameters();

-- ---------- hodnoty (pokyn jednatela 2026-10-28) ----------
-- Pri predpisoch ZP jednatel neuviedol "platne od" -> valid_from prazdne
-- (plati bez obmedzenia, kym jednatel nedoplni; otazka v otazky-pre-mna.md).
insert into public.hr_legal_parameters (key, label, value, value_text, unit, valid_from, source, note, approved_at, approval_note) values
  ('MIN_WAGE_MONTH', 'Minimální mzda – měsíční', 22400, null, 'Kč/měsíc', '2026-01-01', 'MPSV – minimální mzda od 1. 1. 2026',
    'Při kratší týdenní pracovní době (úvazku) se poměrně krátí.', now(), 'Zadal jednatel pokynem 2026-10-28.'),
  ('MIN_WAGE_HOUR', 'Minimální mzda – hodinová', 134.40, null, 'Kč/hod (při 40 h/týden)', '2026-01-01', 'MPSV – minimální mzda od 1. 1. 2026',
    null, now(), 'Zadal jednatel pokynem 2026-10-28.'),
  ('PROBATION_MAX_MONTHS', 'Zkušební doba – max. (běžný zaměstnanec)', 4, null, 'měsíce', null, '§ 35 zákoníku práce', null, now(), 'Zadal jednatel pokynem 2026-10-28.'),
  ('PROBATION_MAX_MONTHS_MANAGER', 'Zkušební doba – max. (vedoucí zaměstnanec)', 8, null, 'měsíce', null, '§ 35 zákoníku práce', null, now(), 'Zadal jednatel pokynem 2026-10-28.'),
  ('PROBATION_MAX_SHARE_FIXED_TERM', 'Zkušební doba – max. podíl z doby určité', 0.5, null, 'podíl (½)', null, '§ 35 zákoníku práce', null, now(), 'Zadal jednatel pokynem 2026-10-28.'),
  ('PROBATION_EXTENSION', 'Zkušební doba – prodloužení', null, 'Prodlužuje se o celodenní překážky v práci a celodenní dovolenou.', 'pravidlo', null, '§ 35 zákoníku práce',
    null, now(), 'Zadal jednatel pokynem 2026-10-28.'),
  ('FIXED_TERM_MAX_YEARS', 'Doba určitá – max. délka jednoho poměru', 3, null, 'roky', null, '§ 39 zákoníku práce', null, now(), 'Zadal jednatel pokynem 2026-10-28.'),
  ('FIXED_TERM_MAX_REPEATS', 'Doba určitá – max. počet opakování (včetně prodloužení)', 2, null, 'opakování', null, '§ 39 zákoníku práce', null, now(), 'Zadal jednatel pokynem 2026-10-28.'),
  ('FIXED_TERM_MAX_TOTAL_YEARS', 'Doba určitá – max. celkem', 9, null, 'roky', null, '§ 39 zákoníku práce', null, now(), 'Zadal jednatel pokynem 2026-10-28.'),
  ('FIXED_TERM_GAP_RESET_YEARS', 'Doba určitá – přestávka, po které se předchozí poměr nezapočítává', 3, null, 'roky', null, '§ 39 zákoníku práce', null, now(), 'Zadal jednatel pokynem 2026-10-28.'),
  ('DPP_MAX_HOURS_YEAR', 'DPP – max. rozsah práce za kalendářní rok', 300, null, 'hodin/rok', null, '§ 75 zákoníku práce', null, now(), 'Zadal jednatel pokynem 2026-10-28.'),
  ('DPC_MAX_SHARE_WEEKLY', 'DPČ – max. průměrný rozsah z týdenní pracovní doby', 0.5, null, 'podíl (½)', null, '§ 76 zákoníku práce', null, now(), 'Zadal jednatel pokynem 2026-10-28.')
on conflict do nothing;

-- nezadane (prazdne, doplni jednatel podla pravnicky/mzdovej uctovnicky)
insert into public.hr_legal_parameters (key, label, unit, note) values
  ('GUARANTEED_WAGE', 'Zaručená mzda (pokud se bude používat)', 'Kč/měsíc', 'Nevyplněno – doplní jednatel.'),
  ('DPP_CONTRIB_INCOME_LIMIT', 'DPP – příjem, od kterého se platí pojistné', 'Kč/měsíc', 'Nevyplněno – doplní jednatel.'),
  ('DPC_CONTRIB_INCOME_LIMIT', 'DPČ – příjem, od kterého se platí pojistné', 'Kč/měsíc', 'Nevyplněno – doplní jednatel.'),
  ('WEEKLY_WORKING_TIME_FULL', 'Stanovená týdenní pracovní doba zaměstnavatele', 'hodin/týden', 'Nevyplněno – doplní jednatel (potřebné pro kontrolu DPČ).'),
  ('MEDICAL_EXAM_INTERVALS', 'Lhůty lékařských prohlídek podle kategorie práce', null, 'Nevyplněno – doplní jednatel.'),
  ('BOZP_TRAINING_INTERVAL', 'Lhůta opakování školení BOZP', 'měsíce', 'Nevyplněno – doplní jednatel.')
on conflict do nothing;

-- Parameter platny k datu (null = nevyplneny).
create or replace function public.hr_legal_param(p_key text, p_date date)
returns public.hr_legal_parameters language sql stable security definer set search_path = public as $$
  select * from public.hr_legal_parameters
  where key = p_key and (valid_from is null or valid_from <= coalesce(p_date, current_date))
    and (valid_to is null or valid_to >= coalesce(p_date, current_date))
  order by valid_from desc nulls last limit 1;
$$;
revoke all on function public.hr_legal_param(text, date) from public, anon;

-- ---------- kontrola pracovneho pomeru ----------
create or replace function public.hr_check_employment_core(p_employment_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e public.employment_relationships;
  v_issues jsonb := '[]'::jsonb;
  v_params jsonb := '{}'::jsonb;
  d date;
  p public.hr_legal_parameters;
  v_months int;
  v_manager boolean;
  v_wage jsonb;
  v_amount numeric;
  v_hours numeric;
  v_chain_start date;
  v_contracts int;
  v_prolong int;
  v_prev record;
  v_cursor_start date;
  v_postaveni text;
begin
  select * into e from public.employment_relationships where id = p_employment_id;
  if not found then return jsonb_build_object('issues', '[]'::jsonb, 'params', '{}'::jsonb); end if;
  d := coalesce(e.start_date, current_date);
  v_manager := coalesce((e.data->>'vedouci')::boolean, false);
  v_postaveni := e.data->>'postaveni';

  -- skusobna doba (dohodnuta dlzka v mesiacoch; predlzenie o prekazky nie je porusenie)
  v_months := nullif(e.data->>'zkusebni_doba_mesice', '')::int;
  if v_months is not null and v_months > 0 then
    p := public.hr_legal_param(case when v_manager then 'PROBATION_MAX_MONTHS_MANAGER' else 'PROBATION_MAX_MONTHS' end, d);
    if p.value is null then
      v_issues := v_issues || jsonb_build_object('code', 'PARAM_MISSING', 'level', 'WARN', 'message', 'Parametr „' || coalesce(p.label, 'max. zkušební doba') || '“ není vyplněn – kontrolu nelze provést.');
    else
      v_params := v_params || jsonb_build_object(p.key, jsonb_build_object('id', p.id, 'value', p.value, 'valid_from', p.valid_from, 'source', p.source));
      if v_months > p.value then
        v_issues := v_issues || jsonb_build_object('code', 'PROBATION_MAX', 'level', 'BLOCK', 'param', p.key,
          'message', format('Zkušební doba %s měs. překračuje maximum %s měs. (%s; %s).', v_months, p.value,
            case when v_manager then 'vedoucí zaměstnanec' else 'není vedoucí zaměstnanec' end, p.source));
      end if;
    end if;
    if e.employment_type = 'doba_urcita' and e.start_date is not null and e.fixed_term_end_date is not null then
      p := public.hr_legal_param('PROBATION_MAX_SHARE_FIXED_TERM', d);
      if p.value is not null then
        v_params := v_params || jsonb_build_object(p.key, jsonb_build_object('id', p.id, 'value', p.value, 'valid_from', p.valid_from, 'source', p.source));
        if ((e.start_date + make_interval(months => v_months))::date - e.start_date) > p.value * ((e.fixed_term_end_date - e.start_date) + 1) then
          v_issues := v_issues || jsonb_build_object('code', 'PROBATION_FIXED_TERM', 'level', 'BLOCK', 'param', p.key,
            'message', format('Zkušební doba přesahuje polovinu sjednané doby určité (%s).', p.source));
        end if;
      end if;
    end if;
  end if;

  -- doba urcita: dlzka, opakovania, celkom (retazec s prestavkou < N rokov)
  if e.employment_type = 'doba_urcita' and e.start_date is not null and e.fixed_term_end_date is not null then
    p := public.hr_legal_param('FIXED_TERM_MAX_YEARS', d);
    if p.value is not null then
      v_params := v_params || jsonb_build_object(p.key, jsonb_build_object('id', p.id, 'value', p.value, 'valid_from', p.valid_from, 'source', p.source));
      if e.fixed_term_end_date >= (e.start_date + make_interval(years => p.value::int))::date then
        v_issues := v_issues || jsonb_build_object('code', 'FIXED_TERM_LENGTH', 'level', 'BLOCK', 'param', p.key,
          'message', format('Doba určitá je delší než %s roky (%s).', p.value, p.source));
      end if;
    end if;
    -- retazec predchadzajucich pomerov na dobu urcitu u toho isteho zamestnanca
    p := public.hr_legal_param('FIXED_TERM_GAP_RESET_YEARS', d);
    v_chain_start := e.start_date;
    v_contracts := 1;
    v_cursor_start := e.start_date;
    if p.value is not null then
      v_params := v_params || jsonb_build_object(p.key, jsonb_build_object('id', p.id, 'value', p.value, 'valid_from', p.valid_from, 'source', p.source));
      for v_prev in
        select r.start_date, coalesce(r.termination_date, r.fixed_term_end_date) as end_date
        from public.employment_relationships r
        where r.employee_id = e.employee_id and r.id <> e.id and r.employment_type = 'doba_urcita'
          and r.start_date is not null and r.start_date < e.start_date
        order by r.start_date desc
      loop
        exit when v_prev.end_date is null or v_prev.end_date < (v_cursor_start - make_interval(years => p.value::int))::date;
        v_contracts := v_contracts + 1;
        v_chain_start := v_prev.start_date;
        v_cursor_start := v_prev.start_date;
      end loop;
    end if;
    -- predlzenia = zmeny konca doby urcitej v historii podmienok retazca
    select coalesce(sum(greatest(cnt - 1, 0)), 0) into v_prolong from (
      select count(distinct t.fixed_term_end_date) as cnt
      from public.employment_terms_versions t join public.employment_relationships r on r.id = t.employment_id
      where r.employee_id = e.employee_id and r.employment_type = 'doba_urcita' and r.start_date >= v_chain_start
        and r.start_date <= e.start_date and t.fixed_term_end_date is not null
      group by t.employment_id) x;
    p := public.hr_legal_param('FIXED_TERM_MAX_REPEATS', d);
    if p.value is not null then
      v_params := v_params || jsonb_build_object(p.key, jsonb_build_object('id', p.id, 'value', p.value, 'valid_from', p.valid_from, 'source', p.source));
      if (v_contracts - 1 + v_prolong) > p.value then
        v_issues := v_issues || jsonb_build_object('code', 'FIXED_TERM_REPEATS', 'level', 'BLOCK', 'param', p.key,
          'message', format('Doba určitá by byla sjednána/prodloužena po %s. (max. %s opakování; %s).', v_contracts - 1 + v_prolong, p.value, p.source));
      end if;
    end if;
    p := public.hr_legal_param('FIXED_TERM_MAX_TOTAL_YEARS', d);
    if p.value is not null then
      v_params := v_params || jsonb_build_object(p.key, jsonb_build_object('id', p.id, 'value', p.value, 'valid_from', p.valid_from, 'source', p.source));
      if e.fixed_term_end_date >= (v_chain_start + make_interval(years => p.value::int))::date then
        v_issues := v_issues || jsonb_build_object('code', 'FIXED_TERM_TOTAL', 'level', 'BLOCK', 'param', p.key,
          'message', format('Doby určité u zaměstnance by celkem přesáhly %s let (%s).', p.value, p.source));
      end if;
    end if;
  end if;

  -- minimalna mzda: mzda platna k nastupu a kazda dalsia zmena mzdy, vzdy
  -- proti minimalnej mzde platnej k datu jej ucinnosti
  if v_postaveni is distinct from '1221' and v_postaveni is distinct from '1222' then
    v_hours := coalesce(e.weekly_hours, 40);
    for v_wage in
      select w || jsonb_build_object('_on', greatest((w->>'platnost_od')::date, d)) from (
        (select w from public.employee_payroll_data pd, jsonb_array_elements(coalesce(pd.data->'mzda_historie', '[]'::jsonb)) w
          where pd.employee_id = e.employee_id and coalesce(w->>'platnost_od', '') <> '' and (w->>'platnost_od')::date <= d
          order by (w->>'platnost_od')::date desc limit 1)
        union all
        (select w from public.employee_payroll_data pd, jsonb_array_elements(coalesce(pd.data->'mzda_historie', '[]'::jsonb)) w
          where pd.employee_id = e.employee_id and coalesce(w->>'platnost_od', '') <> '' and (w->>'platnost_od')::date > d)
        union all
        -- stary format bez historie: aktualna mzda priamo v data
        (select pd.data || jsonb_build_object('platnost_od', d) from public.employee_payroll_data pd
          where pd.employee_id = e.employee_id and coalesce(pd.data->>'mzda_castka', '') <> ''
            and jsonb_array_length(coalesce(pd.data->'mzda_historie', '[]'::jsonb)) = 0)
      ) x(w)
    loop
      v_amount := nullif(regexp_replace(replace(coalesce(v_wage->>'mzda_castka', ''), ',', '.'), '[^0-9.]', '', 'g'), '')::numeric;
      continue when v_amount is null or v_amount <= 0;
      if coalesce(v_wage->>'mzda_typ', 'hodinova') = 'smluvni' then
        p := public.hr_legal_param('MIN_WAGE_MONTH', (v_wage->>'_on')::date);
        if p.value is not null then
          v_params := v_params || jsonb_build_object(p.key, jsonb_build_object('id', p.id, 'value', p.value, 'valid_from', p.valid_from, 'source', p.source));
          if v_amount < round(p.value * least(v_hours, 40) / 40, 2) then
            v_issues := v_issues || jsonb_build_object('code', 'MIN_WAGE', 'level', 'BLOCK', 'param', p.key,
              'message', format('Měsíční mzda platná od %s je nižší než minimální mzda platná k tomuto dni, přepočtená na úvazek %s h/týden (%s).',
                to_char((v_wage->>'_on')::date, 'DD. MM. YYYY'), v_hours, p.source));
          end if;
        end if;
      else
        p := public.hr_legal_param('MIN_WAGE_HOUR', (v_wage->>'_on')::date);
        if p.value is not null then
          v_params := v_params || jsonb_build_object(p.key, jsonb_build_object('id', p.id, 'value', p.value, 'valid_from', p.valid_from, 'source', p.source));
          if v_amount < p.value then
            v_issues := v_issues || jsonb_build_object('code', 'MIN_WAGE', 'level', 'BLOCK', 'param', p.key,
              'message', format('Hodinová mzda platná od %s je nižší než minimální mzda platná k tomuto dni (%s).',
                to_char((v_wage->>'_on')::date, 'DD. MM. YYYY'), p.source));
          end if;
        end if;
      end if;
    end loop;
  end if;

  -- DPC: priemerny rozsah max. podiel stanovenej tyzdennej pracovnej doby
  if v_postaveni in ('1211', '1212') and e.weekly_hours is not null then
    p := public.hr_legal_param('WEEKLY_WORKING_TIME_FULL', d);
    if p.value is null then
      v_issues := v_issues || jsonb_build_object('code', 'PARAM_MISSING', 'level', 'WARN',
        'message', 'Parametr „Stanovená týdenní pracovní doba zaměstnavatele“ není vyplněn – rozsah DPČ nelze zkontrolovat.');
    else
      v_params := v_params || jsonb_build_object(p.key, jsonb_build_object('id', p.id, 'value', p.value, 'valid_from', p.valid_from, 'source', p.source));
      p := public.hr_legal_param('DPC_MAX_SHARE_WEEKLY', d);
      if p.value is not null and e.weekly_hours > p.value * (v_params->'WEEKLY_WORKING_TIME_FULL'->>'value')::numeric then
        v_params := v_params || jsonb_build_object(p.key, jsonb_build_object('id', p.id, 'value', p.value, 'valid_from', p.valid_from, 'source', p.source));
        v_issues := v_issues || jsonb_build_object('code', 'DPC_SCOPE', 'level', 'BLOCK', 'param', p.key,
          'message', format('Rozsah DPČ %s h/týden přesahuje polovinu stanovené týdenní pracovní doby (%s).', e.weekly_hours, p.source));
      end if;
    end if;
  end if;
  if v_postaveni in ('1221', '1222') then
    p := public.hr_legal_param('DPP_MAX_HOURS_YEAR', d);
    v_issues := v_issues || jsonb_build_object('code', 'DPP_HOURS', 'level', 'WARN',
      'message', format('DPP: rozsah max. %s h za kalendářní rok u zaměstnavatele (%s) – systém odpracované hodiny DPP neeviduje, zkontrolujte ručně.', coalesce(p.value::text, '?'), coalesce(p.source, 'parametr nevyplněn')));
  end if;

  -- podpis zmluvy najneskor v den nastupu
  if e.contract_signed_date is not null and e.start_date is not null and e.contract_signed_date > e.start_date then
    v_issues := v_issues || jsonb_build_object('code', 'SIGNED_AFTER_START', 'level', 'WARN',
      'message', 'Datum podpisu smlouvy je až po dni nástupu.');
  end if;
  -- pred nastupom: prehliadka a vstupne skolenie BOZP (upozornenie)
  if e.start_date is not null and e.status is distinct from 'ENDED' then
    if not exists (select 1 from public.medical_examinations m where m.employee_id = e.employee_id and m.exam_date <= e.start_date) then
      v_issues := v_issues || jsonb_build_object('code', 'NO_MEDICAL_EXAM', 'level', 'WARN', 'message', 'Před nástupem není evidována lékařská prohlídka.');
    end if;
    if not exists (select 1 from public.hr_training_records t where t.employee_id = e.employee_id and t.training_type = 'VSTUPNI_BOZP' and t.trained_at::date <= e.start_date) then
      v_issues := v_issues || jsonb_build_object('code', 'NO_BOZP_TRAINING', 'level', 'WARN', 'message', 'Před nástupem není evidováno vstupní školení BOZP.');
    end if;
  end if;

  return jsonb_build_object('issues', v_issues, 'params', v_params, 'checked_at', now(), 'on_date', d);
end $$;
revoke all on function public.hr_check_employment_core(text) from public, anon, authenticated;

-- Pre aplikaciu: rovnaky vysledok, len pre HR s pristupom k zamestnancom.
create or replace function public.hr_check_employment(p_employment_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC')) then
    raise exception 'Neopravneno.' using errcode = '42501';
  end if;
  return public.hr_check_employment_core(p_employment_id);
end $$;
revoke all on function public.hr_check_employment(text) from public, anon;
grant execute on function public.hr_check_employment(text) to authenticated;

-- ---------- vynutenie pri generovani a podpise ----------
alter table public.hr_documents add column if not exists legal_check jsonb;

create or replace function public.hr_documents_legal_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare v jsonb; v_blocks text;
begin
  if new.origin <> 'GENERATED' or new.employment_id is null or coalesce(new.is_manual_history_entry, false)
     or new.doc_type not in ('pracovni_smlouva', 'pracovni_smlouva_cizinec', 'mzdovy_vymer', 'dodatek') then
    return new;
  end if;
  v := public.hr_check_employment_core(new.employment_id);
  select string_agg(i->>'message', ' ') into v_blocks from jsonb_array_elements(v->'issues') i where i->>'level' = 'BLOCK';
  if v_blocks is not null then
    raise exception 'Dokument nelze vytvořit – zákonný limit: %', v_blocks using errcode = 'P0001';
  end if;
  new.legal_check := v; -- pouzite parametre a upozornenia ku dnu generovania
  return new;
end $$;
drop trigger if exists hr_documents_legal_check on public.hr_documents;
create trigger hr_documents_legal_check before insert on public.hr_documents
  for each row execute function public.hr_documents_legal_check();

create or replace function public.hr_signatures_legal_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare d public.hr_documents; v jsonb; v_blocks text;
begin
  select * into d from public.hr_documents where id = new.hr_document_id;
  if d.origin <> 'GENERATED' or d.employment_id is null or coalesce(d.is_manual_history_entry, false)
     or d.doc_type not in ('pracovni_smlouva', 'pracovni_smlouva_cizinec', 'mzdovy_vymer', 'dodatek') then
    return new;
  end if;
  v := public.hr_check_employment_core(d.employment_id);
  select string_agg(i->>'message', ' ') into v_blocks from jsonb_array_elements(v->'issues') i where i->>'level' = 'BLOCK';
  if v_blocks is not null then
    raise exception 'Dokument nelze podepsat – zákonný limit: %', v_blocks using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists hr_signatures_legal_check on public.hr_document_signatures;
create trigger hr_signatures_legal_check before insert on public.hr_document_signatures
  for each row execute function public.hr_signatures_legal_check();
