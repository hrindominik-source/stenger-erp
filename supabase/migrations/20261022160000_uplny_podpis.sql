-- ============================================================
-- 51. Podpisany != zamknuty. Dokument sa zamkne prvym podpisom (obsah sa
--     uz nemeni), ale PODPISANY (status SIGNED) je az ked ma vsetky
--     pozadovane podpisy podla typu pravneho ukonu (zmluva: zamestnanec AJ
--     zamestnavatel). Stav SIGNED aj odovzdanie/odoslanie vyhotovenia DB
--     povoli len pre uplne podpisany dokument.
-- ============================================================

-- 51.1 Typ pravneho ukonu podla druhu dokumentu (UI ho doteraz nevyplnalo).
--      Nejednoznacne druhy (zrusenie ve zkusebni dobe, other) ostavaju null.
create or replace function public.hr_default_legal_act_type(p_doc_type text)
returns text
language sql
immutable
as $$
  select case
    when p_doc_type in ('pracovni_smlouva', 'pracovni_smlouva_cizinec', 'dodatek', 'dohoda_o_skonceni', 'dpp', 'dpc') then 'BILATERAL_CONTRACT'
    when p_doc_type in ('platovy_vymer', 'mzdovy_vymer', 'vypoved_zamestnavatele') then 'EMPLOYER_UNILATERAL'
    when p_doc_type in ('vypoved_zamestnance', 'osobni_dotaznik', 's21_oznameni_adresy', 's335_souhlas') then 'EMPLOYEE_DECLARATION'
    when p_doc_type in ('hi001_naplen_prace_delnice', 'popis_pracovniho_mista') then 'RECEIPT_ACKNOWLEDGEMENT'
    when p_doc_type = 'vstupni_skoleni' then 'TRAINING_RECORD'
    else null
  end;
$$;

create or replace function public.hr_required_signers(p_legal_act_type text)
returns text[]
language sql
immutable
as $$
  select case p_legal_act_type
    when 'BILATERAL_CONTRACT' then array['EMPLOYEE', 'EMPLOYER']
    when 'EMPLOYER_UNILATERAL' then array['EMPLOYER']
    else array['EMPLOYEE']
  end;
$$;

-- Chybajuci podpisujuci. Pocita sa elektronicky podpis PRESNE aktualnej
-- finalnej verzie (hash) alebo papierovy podpis (sken) daneho podpisujuceho.
create or replace function public.hr_document_missing_signers(p_document_id text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(r order by r), '{}'::text[])
  from public.hr_documents d
  cross join lateral unnest(public.hr_required_signers(coalesce(d.legal_act_type, public.hr_default_legal_act_type(d.doc_type)))) as r
  where d.id = p_document_id
    and not exists (
      select 1 from public.hr_document_signatures s
      where s.hr_document_id = d.id and s.signer_type = r
        and (s.method = 'PAPER'
             or (s.method in ('ELECTRONIC_TABLET', 'ELECTRONIC_QUALIFIED') and s.signed_content_sha256 = d.final_pdf_sha256))
    );
$$;
revoke execute on function public.hr_document_missing_signers(text) from public, anon;
grant execute on function public.hr_document_missing_signers(text) to authenticated, service_role;

-- 51.2 Doplnenie typu pri vlozeni + stav SIGNED len pri uplnom podpise.
--      Rucne zapisany historicky zaznam (is_manual_history_entry) je vynimka.
create or replace function public.hr_documents_signed_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing text[];
begin
  if TG_OP = 'INSERT' and new.legal_act_type is null then
    new.legal_act_type := public.hr_default_legal_act_type(new.doc_type);
  end if;
  if new.status = 'SIGNED' and (TG_OP = 'INSERT' or old.status is distinct from 'SIGNED') then
    if TG_OP = 'INSERT' then
      if not new.is_manual_history_entry then
        raise exception 'Novy dokument nemuze byt rovnou podepsany - podpisy se zaznamenavaji samostatne.';
      end if;
      return new;
    end if;
    v_missing := public.hr_document_missing_signers(new.id);
    if array_length(v_missing, 1) > 0 then
      raise exception 'Dokument neni podepsan vsemi stranami - chybi: %.', array_to_string(v_missing, ', ');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists hr_documents_signed_complete on public.hr_documents;
create trigger hr_documents_signed_complete before insert or update on public.hr_documents
  for each row execute function public.hr_documents_signed_complete();

-- Typ ukonu sa doplni aj existujucim nezamknutym dokumentom (zamknute
-- podpisane dokumenty sa nemenia).
update public.hr_documents set legal_act_type = public.hr_default_legal_act_type(doc_type)
  where legal_act_type is null and locked_at is null and public.hr_default_legal_act_type(doc_type) is not null;

-- 51.3 Odovzdanie / odoslanie vyhotovenia len pre uplne podpisany dokument.
create or replace function public.hr_document_deliveries_signed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.hr_documents d where d.id = new.hr_document_id and d.status in ('SIGNED', 'ARCHIVED')) then
    raise exception 'Odevzdat nebo odeslat lze jen dokument podepsany vsemi stranami.';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_document_deliveries_signed on public.hr_document_deliveries;
create trigger hr_document_deliveries_signed before insert on public.hr_document_deliveries
  for each row execute function public.hr_document_deliveries_signed();

-- 51.4 Odoslanie dotaznika: "s podpisom" = zamknuty (aspon jeden podpis),
--      "podpisany" = SIGNED (vsetky podpisy). Logika sa nemeni, len je to
--      vyslovne pomenovane.
create or replace function public.hr_onboarding_submit(p_session_token text, p_signing_mode text default 'PAPER')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_with_signature int;
  v_not_signed int;
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
  select count(*) filter (where d.locked_at is not null),
         count(*) filter (where d.status not in ('SIGNED', 'VOIDED', 'SUPERSEDED'))
    into v_with_signature, v_not_signed
    from public.hr_documents d where d.onboarding_session_id = v_id;

  if p_signing_mode = 'ELECTRONIC' then
    if not exists (select 1 from public.hr_documents d where d.onboarding_session_id = v_id
                   and d.doc_type = 'osobni_dotaznik' and d.status = 'SIGNED') or v_not_signed > 0 then
      raise exception 'Nejsou podepsany vsechny dokumenty dotazniku.';
    end if;
  else
    if v_with_signature > 0 then
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
