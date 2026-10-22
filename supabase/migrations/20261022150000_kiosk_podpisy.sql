-- ============================================================
-- 50. Faza D - vstupny dotaznik (kiosk ?kiosk=nastup): elektronicka
--     komunikacia (§ 21 oznamenie, § 335 suhlas s poucenim), podpis
--     dotaznika a kazdeho vyhlasenia zvlast, papierova alternativa.
--     PDF na podpis generuje a uklada LEN server (Edge Function hr-kiosk);
--     kiosk (anon) ma dalej len RPC viazane na session_token.
-- ============================================================

-- 50.1 Pravne texty - KONCEPTY na schvalenie pravnickou (bod I zadania).
--      Telo obsahuje oznacenie konceptu, aby bolo viditelne aj v PDF.
--      Schvalenie = nova verzia bez oznacenia (stara ostava pri podpisoch).
insert into public.hr_legal_text_versions (id, text_key, version_no, title, body, body_sha256) values
  ('lt-s21-address-notice-v1', 'S21_ADDRESS_NOTICE', 1,
   'Oznámení elektronické adresy (§ 21 zákoníku práce)',
   'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.' || chr(10) ||
   'Oznamuji zaměstnavateli Stenger Czech s.r.o., IČO 28501381, svou elektronickou adresu uvedenou v tomto oznámení pro účely § 21 zákoníku práce.' || chr(10) ||
   'Prohlašuji, že tato adresa není v dispozici zaměstnavatele (nejde o pracovní e-mailovou schránku přidělenou nebo spravovanou zaměstnavatelem).' || chr(10) ||
   'Na tuto adresu mi zaměstnavatel zašle vyhotovení pracovní smlouvy, dohody o provedení práce, dohody o pracovní činnosti, jejich změn a dalších dohod uvedených v § 21 odst. 1 zákoníku práce, budou-li uzavřeny elektronicky.' || chr(10) ||
   'Beru na vědomí, že od takto uzavřené smlouvy nebo dohody mohu písemně odstoupit nejpozději do 7 dnů ode dne, kdy mi bylo její vyhotovení dodáno na tuto adresu, pokud jsem dosud nezačal(a) plnit práva a povinnosti z ní vyplývající.' || chr(10) ||
   'Zavazuji se každou změnu této adresy zaměstnavateli bez zbytečného odkladu písemně oznámit. Toto oznámení se vztahuje pouze k adrese v něm uvedené.',
   'x'),
  ('lt-s335-notice-v1', 'S335_NOTICE', 1,
   'Poučení o doručování písemností elektronicky (§ 335 zákoníku práce)',
   'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.' || chr(10) ||
   '1. Písemnosti podle § 334 zákoníku práce (zejména výpověď, okamžité zrušení pracovního poměru, zrušení ve zkušební době, odvolání z vedoucího pracovního místa a mzdový výměr) vám zaměstnavatel doručuje do vlastních rukou. Elektronicky vám je smí doručovat pouze s vaším souhlasem uděleným v samostatném písemném prohlášení, ve kterém uvedete elektronickou adresu, jež není v dispozici zaměstnavatele.' || chr(10) ||
   '2. Souhlas je dobrovolný. Pokud jej neudělíte, budou vám písemnosti doručovány osobně na pracovišti, v bytě nebo kdekoli budete zastižen(a), případně prostřednictvím provozovatele poštovních služeb. Neudělení souhlasu pro vás nemá žádné nepříznivé následky.' || chr(10) ||
   '3. Elektronicky doručovaná písemnost musí být podepsána uznávaným elektronickým podpisem a musíte ji mít možnost uložit a vytisknout.' || chr(10) ||
   '4. Písemnost je doručena dnem, kdy převzetí potvrdíte datovou zprávou nebo písemně. Nepotvrdíte-li převzetí do 15 dnů ode dne, kdy vám byla dodána na vaši elektronickou adresu, považuje se 15. dnem za doručenou. Vrátí-li se písemnost jako nedoručitelná, doručení je neúčinné.' || chr(10) ||
   '5. Souhlas můžete kdykoli písemně odvolat; odvolání je účinné dnem, kdy jej zaměstnavatel obdrží. Změnu elektronické adresy je třeba oznámit; souhlas se vztahuje pouze k adrese v něm uvedené.',
   'x'),
  ('lt-s335-consent-v1', 'S335_CONSENT', 1,
   'Souhlas s doručováním písemností elektronicky (§ 335 zákoníku práce)',
   'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.' || chr(10) ||
   'Na základě poučení, které mi bylo poskytnuto před udělením tohoto souhlasu (verze poučení je uvedena v tomto prohlášení), souhlasím s tím, aby mi zaměstnavatel Stenger Czech s.r.o., IČO 28501381, doručoval písemnosti podle § 334 zákoníku práce elektronicky na moji elektronickou adresu uvedenou v tomto prohlášení, která není v dispozici zaměstnavatele.' || chr(10) ||
   'Souhlas uděluji dobrovolně. Beru na vědomí, že jej mohu kdykoli písemně odvolat a že bez něj se mi písemnosti doručují osobně nebo prostřednictvím provozovatele poštovních služeb.',
   'x'),
  ('lt-intent-questionnaire-v1', 'INTENT_QUESTIONNAIRE', 1, 'Prohlášení k osobnímu dotazníku',
   'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Prohlašuji, že všechny údaje uvedené v tomto osobním dotazníku jsou pravdivé a úplné, a zavazuji se oznámit jejich změny bez zbytečného odkladu.', 'x'),
  ('lt-intent-employee-declaration-v1', 'INTENT_EMPLOYEE_DECLARATION', 1, 'Projev vůle – prohlášení zaměstnance',
   'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Činím toto prohlášení.', 'x'),
  ('lt-intent-bilateral-contract-v1', 'INTENT_BILATERAL_CONTRACT', 1, 'Projev vůle – smlouva',
   'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Seznámil/a jsem se s celým obsahem a uzavírám tuto smlouvu.', 'x'),
  ('lt-intent-receipt-v1', 'INTENT_RECEIPT_ACKNOWLEDGEMENT', 1, 'Projev vůle – převzetí',
   'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Potvrzuji převzetí dokumentu. Tímto podpisem nevyjadřuji souhlas s jeho obsahem.', 'x'),
  ('lt-intent-training-v1', 'INTENT_TRAINING_RECORD', 1, 'Projev vůle – záznam o školení',
   'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Potvrzuji absolvování školení uvedeného v tomto záznamu a ověření svých znalostí ve dni uvedeném v záznamu.', 'x')
on conflict (id) do nothing;

-- Aktualna (posledna nevyradena) verzia textu.
create or replace function public.hr_current_legal_text(p_key text)
returns public.hr_legal_text_versions
language sql
stable
security definer
set search_path = public
as $$
  select * from public.hr_legal_text_versions
  where text_key = p_key and status <> 'VYRAZENO'
  order by version_no desc
  limit 1;
$$;
revoke execute on function public.hr_current_legal_text(text) from public, anon;
grant execute on function public.hr_current_legal_text(text) to authenticated, service_role;

-- 50.2 Rezim podpisu dotaznika (elektronicky na tablete / na papieri).
alter table public.onboarding_sessions add column if not exists signing_mode text;
alter table public.onboarding_sessions drop constraint if exists onboarding_sessions_signing_mode_check;
alter table public.onboarding_sessions add constraint onboarding_sessions_signing_mode_check
  check (signing_mode is null or signing_mode in ('ELECTRONIC', 'PAPER'));

-- 50.3 Konfiguracia pre kiosk (anon): flagy + texty, ktore musi zobrazit
--      (verzia sa uklada k vyhlaseniu). Ziadne ine data.
create or replace function public.hr_onboarding_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s335 boolean := coalesce((public.hr_setting('s335_consent_enabled'))::text::boolean, false);
  v_texts jsonb := '{}'::jsonb;
  v_key text;
  v_t public.hr_legal_text_versions;
begin
  foreach v_key in array case when v_s335
      then array['S21_ADDRESS_NOTICE', 'S335_NOTICE', 'S335_CONSENT', 'INTENT_QUESTIONNAIRE', 'INTENT_EMPLOYEE_DECLARATION']
      else array['S21_ADDRESS_NOTICE', 'INTENT_QUESTIONNAIRE', 'INTENT_EMPLOYEE_DECLARATION'] end loop
    v_t := public.hr_current_legal_text(v_key);
    if v_t.id is not null then
      v_texts := v_texts || jsonb_build_object(v_key, jsonb_build_object(
        'id', v_t.id, 'version_no', v_t.version_no, 'title', v_t.title, 'body', v_t.body,
        'body_sha256', v_t.body_sha256, 'status', v_t.status));
    end if;
  end loop;
  return jsonb_build_object(
    's335_consent_enabled', v_s335,
    'device_unlock_required', coalesce(public.hr_setting('kiosk')->'device_unlock_required', 'false'::jsonb),
    'texts', v_texts
  );
end;
$$;
revoke execute on function public.hr_onboarding_config() from public;
grant execute on function public.hr_onboarding_config() to anon, authenticated;

-- 50.4 Po prvom podpise sa udaje dotaznika uz nemenia (podpisane PDF by
--      prestali zodpovedat konceptu).
create or replace function public.hr_onboarding_save_draft(p_session_token text, p_draft_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.onboarding_sessions s
    set draft_data = p_draft_data, last_activity_at = now()
    where s.session_token = p_session_token and s.status = 'IN_PROGRESS'
      and (s.expires_at is null or s.expires_at > now())
      and not exists (select 1 from public.hr_documents d where d.onboarding_session_id = s.id and d.locked_at is not null);
  return found;
end;
$$;

-- 50.5 Odoslanie s rezimom podpisu.
--   ELECTRONIC: podpisany osobny dotaznik a ziadny nepodpisany dokument.
--   PAPER: ziadny elektronicky podpis; pripravene PDF sa zneplatnia (HR
--          dotaznik vytlaci a nahra sken, vyhlasenia sa zbieraju papierovo).
drop function if exists public.hr_onboarding_submit(text);
create or replace function public.hr_onboarding_submit(p_session_token text, p_signing_mode text default 'PAPER')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_signed int;
  v_unsigned int;
begin
  if p_signing_mode not in ('ELECTRONIC', 'PAPER') then
    raise exception 'Neplatny rezim podpisu.';
  end if;
  select s.id into v_id from public.onboarding_sessions s
    where s.session_token = p_session_token and s.status = 'IN_PROGRESS'
      and (s.expires_at is null or s.expires_at > now())
    for update;
  if v_id is null then
    return false;
  end if;
  -- Podpisany = zamknuty (podpis ulozeny), aj ked original este nie je hotovy.
  select count(*) filter (where d.locked_at is not null or d.status = 'SIGNED'),
         count(*) filter (where d.status not in ('SIGNED', 'VOIDED', 'SUPERSEDED'))
    into v_signed, v_unsigned
    from public.hr_documents d where d.onboarding_session_id = v_id;

  if p_signing_mode = 'ELECTRONIC' then
    if not exists (select 1 from public.hr_documents d where d.onboarding_session_id = v_id
                   and d.doc_type = 'osobni_dotaznik' and d.status = 'SIGNED') or v_unsigned > 0 then
      raise exception 'Nejsou podepsany vsechny dokumenty dotazniku.';
    end if;
  else
    if v_signed > 0 then
      raise exception 'Cast dokumentu uz je podepsana elektronicky - dokoncete podpis na tabletu.';
    end if;
    update public.hr_documents set status = 'VOIDED', void_reason = 'Zvolen podpis na papíře', updated_at = now()
      where onboarding_session_id = v_id and locked_at is null and status not in ('SIGNED', 'VOIDED', 'SUPERSEDED');
  end if;

  update public.onboarding_sessions
    set status = 'SUBMITTED', submitted_at = now(), last_activity_at = now(), signing_mode = p_signing_mode
    where id = v_id;
  return true;
end;
$$;
revoke execute on function public.hr_onboarding_submit(text, text) from public;
grant execute on function public.hr_onboarding_submit(text, text) to anon, authenticated;
revoke execute on function public.hr_onboarding_save_draft(text, jsonb) from public;
grant execute on function public.hr_onboarding_save_draft(text, jsonb) to anon, authenticated;

-- 50.6 Kontrola HR: REVIEWED prenesie dokumenty a vyhlasenia (bez zmeny
--      obsahu a hashov - strazi hr_documents_guard). DISCARDED nic nemaze:
--      podpisane ostavaju, nepodpisane sa len zneplatnia s dovodom.
create or replace function public.hr_onboarding_review(p_session_id text, p_status text, p_resulting_employee_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.current_role() = 'office' and public.hr_has_permission('HR_EDIT')) then
    raise exception 'Neopravnene.';
  end if;
  if p_status not in ('REVIEWED', 'DISCARDED') then
    raise exception 'Neplatny stav.';
  end if;
  if p_status = 'REVIEWED' and p_resulting_employee_id is null then
    raise exception 'Chybi zamestnanec.';
  end if;
  update public.onboarding_sessions
    set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
        resulting_employee_id = p_resulting_employee_id
    where id = p_session_id and status in ('SUBMITTED', 'IN_PROGRESS', 'EXPIRED');
  if not found then
    return false;
  end if;
  if p_status = 'REVIEWED' then
    update public.hr_documents set employee_id = p_resulting_employee_id, updated_at = now()
      where onboarding_session_id = p_session_id and employee_id is null;
    update public.employee_contact_declarations set employee_id = p_resulting_employee_id
      where onboarding_session_id = p_session_id and employee_id is null;
  else
    update public.hr_documents set status = 'VOIDED', void_reason = 'Dotazník zamítnut personálním oddělením', updated_at = now()
      where onboarding_session_id = p_session_id and locked_at is null and status not in ('SIGNED', 'ARCHIVED', 'VOIDED', 'SUPERSEDED');
  end if;
  return true;
end;
$$;
revoke execute on function public.hr_onboarding_review(text, text, text) from public, anon;
grant execute on function public.hr_onboarding_review(text, text, text) to authenticated;
