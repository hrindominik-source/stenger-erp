-- ============================================================
-- 58. Faza I - sablony a texty vyhlaseni.
--   Nove typy dokumentov (generuje server z verzovanych textov
--   hr_legal_text_versions, Edge Function hr-declarations):
--     s21_oznameni_adresy  Oznameni elektronicke adresy (§ 21 ZP)     [existuje z kiosku]
--     s335_pouceni         Pouceni o elektronickem dorucovani (§ 335 ZP)
--     s335_souhlas         Souhlas s elektronickym dorucovanim (§ 335) [existuje z kiosku]
--     s335_odvolani        Odvolani souhlasu s elektronickym dorucovanim
--     potvrzeni_prevzeti   Potvrzeni o prevzeti pisemnosti
--   Texty su KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU; zmena textu = nova verzia
--   (hr_legal_texts_guard), podpisy ostavaju viazane na verziu, ktoru
--   obsahuje podpisane PDF (variables_snapshot + intent_text_version_id).
--   Po uplnom podpise HR dokumentu vznikne vyhlasenie / odvolanie v DB.
-- ============================================================

insert into public.hr_legal_text_versions (id, text_key, version_no, title, body, body_sha256) values
  ('lt-s335-revocation-v1', 'S335_REVOCATION', 1,
   'Odvolání souhlasu s doručováním písemností elektronicky (§ 335 zákoníku práce)',
   'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.' || chr(10) ||
   'Odvolávám svůj souhlas s doručováním písemností zaměstnavatele Stenger Czech s.r.o., IČO 28501381, prostřednictvím sítě nebo služby elektronických komunikací na elektronickou adresu uvedenou v tomto odvolání (§ 335 zákoníku práce).' || chr(10) ||
   'Beru na vědomí, že odvolání je účinné dnem, kdy je zaměstnavatel obdrží. Písemnosti odeslané přede dnem účinnosti odvolání se doručují podle dosavadního souhlasu.', 'x'),
  ('lt-receipt-confirmation-v1', 'RECEIPT_CONFIRMATION', 1,
   'Potvrzení o převzetí písemnosti',
   'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.' || chr(10) ||
   'Potvrzuji, že jsem dne uvedeného níže převzal(a) od zaměstnavatele Stenger Czech s.r.o., IČO 28501381, písemnost uvedenou v tomto potvrzení (vyhotovení s otiskem SHA-256 uvedeným níže).' || chr(10) ||
   'Podpisem potvrzuji pouze převzetí písemnosti, nikoli souhlas s jejím obsahem.', 'x')
on conflict (id) do nothing;

-- Typ pravneho ukonu (rozsirenie migracie 51 - povodne druhy bez zmeny).
create or replace function public.hr_default_legal_act_type(p_doc_type text)
returns text
language sql
immutable
as $$
  select case
    when p_doc_type in ('pracovni_smlouva', 'pracovni_smlouva_cizinec', 'dodatek', 'dohoda_o_skonceni', 'dpp', 'dpc') then 'BILATERAL_CONTRACT'
    when p_doc_type in ('platovy_vymer', 'mzdovy_vymer', 'vypoved_zamestnavatele') then 'EMPLOYER_UNILATERAL'
    when p_doc_type in ('vypoved_zamestnance', 'osobni_dotaznik', 's21_oznameni_adresy', 's335_souhlas', 's335_odvolani') then 'EMPLOYEE_DECLARATION'
    when p_doc_type in ('hi001_naplen_prace_delnice', 'popis_pracovniho_mista', 's335_pouceni', 'potvrzeni_prevzeti') then 'RECEIPT_ACKNOWLEDGEMENT'
    when p_doc_type = 'vstupni_skoleni' then 'TRAINING_RECORD'
    else null
  end;
$$;

-- Po uplnom podpise vyhlasenia vytvorenom serverom pre zamestnanca:
-- zapis § 21 oznamenia / § 335 suhlasu (stare vyhlasenie toho druhu sa
-- nahradi) alebo odvolanie suhlasu. Len PDF vygenerovane serverom
-- (final_pdf_text_check.method = server-generated-v1, zapisuje len server).
create or replace function public.hr_documents_declaration_signed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := new.variables_snapshot->>'declaration_kind';
  v_email text := new.variables_snapshot->>'email';
  v_channel text;
  v_consent public.employee_contact_declarations%rowtype;
begin
  if not (new.status = 'SIGNED' and old.status is distinct from 'SIGNED') or v_kind is null
     or new.employee_id is null or new.onboarding_session_id is not null
     or coalesce(new.final_pdf_text_check->>'method', '') <> 'server-generated-v1'
     or exists (select 1 from public.employee_contact_declarations where hr_document_id = new.id) then
    return new;
  end if;
  v_channel := case when exists (select 1 from public.hr_document_signatures s where s.hr_document_id = new.id and s.method like 'ELECTRONIC%')
                    then 'TABLET_HR' else 'PAPER_SCAN' end;
  if v_kind in ('S21_ADDRESS_NOTICE', 'S335_CONSENT') then
    update public.employee_contact_declarations set superseded_at = now()
      where employee_id = new.employee_id and kind = v_kind and superseded_at is null and revoked_at is null;
    insert into public.employee_contact_declarations (id, kind, employee_id, email_snapshot, declared_at, channel, hr_document_id, notice_version_id, created_by)
    values ('decl-' || replace(gen_random_uuid()::text, '-', ''), v_kind, new.employee_id, v_email, now(), v_channel, new.id,
      case when v_kind = 'S335_CONSENT' then new.variables_snapshot->>'notice_version_id' end, auth.uid());
  elsif v_kind = 'S335_REVOCATION' then
    select * into v_consent from public.employee_contact_declarations
      where id = new.variables_snapshot->>'consent_id' and kind = 'S335_CONSENT' and employee_id = new.employee_id for update;
    if v_consent.id is not null and v_consent.revoked_at is null then
      insert into public.employee_contact_declarations (id, kind, employee_id, email_snapshot, declared_at, channel, hr_document_id,
        revokes_declaration_id, revocation_received_at, created_by)
      values ('decl-' || replace(gen_random_uuid()::text, '-', ''), 'S335_REVOCATION', new.employee_id, v_consent.email_snapshot, now(),
        v_channel, new.id, v_consent.id, now(), auth.uid());
      update public.employee_contact_declarations set revoked_at = now(), revocation_received_at = now() where id = v_consent.id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists hr_documents_declaration_signed on public.hr_documents;
create trigger hr_documents_declaration_signed after update on public.hr_documents
  for each row execute function public.hr_documents_declaration_signed();
