-- Rollback migracie 58 (faza I - sablony a texty). Texty S335_REVOCATION a
-- RECEIPT_CONFIRMATION ostavaju (guard zakazuje mazanie verzii textov) -
-- oznacia sa ako vyradene. Vyhlasenia uz vytvorene po podpise ostavaju.
drop trigger if exists hr_documents_declaration_signed on public.hr_documents;
drop function if exists public.hr_documents_declaration_signed();

update public.hr_legal_text_versions set status = 'VYRAZENO'
  where text_key in ('S335_REVOCATION', 'RECEIPT_CONFIRMATION') and status <> 'VYRAZENO';

-- typ pravneho ukonu podla migracie 51
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
