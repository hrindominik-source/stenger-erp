-- Migracia 80: nahratie existujucich podpisanych dokumentov (zmluvy, mzdove
-- vymery, dodatky ...), ktore vznikli mimo systemu.
--   - Zaklada ich aj personalistka (HR_DOCUMENT_GENERATE), nie len jednatel:
--     len origin UPLOADED, stav SIGNED, is_manual_history_entry, povoleny typ,
--     bez sablony a vazieb, subor v zamestnanci/<id>/historie/.
--   - Jednatel dostane upozornenie (NA_VEDOMI) - kto, co a komu nahral.
--   - Pristup: mzdovy vymer = HR_VIEW_PAYROLL, ostatne = HR_VIEW_SENSITIVE
--     (ako vygenerovane). Iny nahrany dokument ostava len HR_ADMIN.

create or replace function public.hr_upload_doc_types()
returns text[] language sql immutable set search_path = public as $$
  select array['pracovni_smlouva', 'pracovni_smlouva_cizinec', 'platovy_vymer', 'mzdovy_vymer', 'dodatek',
    'dohoda_o_skonceni', 'vypoved_zamestnance', 'vypoved_zamestnavatele', 'zruseni_ve_zkusebni_dobe',
    'hi001_naplen_prace_delnice', 'vstupni_skoleni', 'popis_pracovniho_mista', 'other'];
$$;

create or replace function public.hr_document_required_permissions(p_document_id text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_perms text[];
  v_origin text;
  v_type text;
  v_manual boolean;
begin
  select tv.required_permissions, d.origin, d.doc_type, d.is_manual_history_entry
    into v_perms, v_origin, v_type, v_manual
  from public.hr_documents d
  left join public.hr_document_template_versions tv on tv.id = d.template_version_id
  where d.id = p_document_id;

  if v_perms is null or array_length(v_perms, 1) is null then
    if v_origin = 'UPLOADED' and v_manual and v_type = any(public.hr_upload_doc_types()) then
      return case when v_type in ('platovy_vymer', 'mzdovy_vymer') then array['HR_VIEW_PAYROLL'] else array['HR_VIEW_SENSITIVE'] end;
    end if;
    if v_origin = 'UPLOADED' then
      return array['HR_ADMIN'];
    else
      return array['HR_VIEW_SENSITIVE'];
    end if;
  end if;
  return v_perms;
end;
$$;

-- bez security definer: hr_is_server_role() testuje current_user (ako v migracii 75)
create or replace function public.hr_documents_classification_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.hr_is_server_role() or public.hr_has_permission('HR_ADMIN') then return new; end if;
  if TG_OP = 'INSERT' then
    if coalesce(new.is_manual_history_entry, false) then
      -- nahraty existujuci podpisany dokument (migracia 80)
      if new.origin = 'UPLOADED' and new.status = 'SIGNED' and new.doc_type = any(public.hr_upload_doc_types())
         and new.template_id is null and new.template_version_id is null
         and new.amends_document_id is null and new.training_record_id is null and new.supersedes_document_id is null
         and new.final_pdf_path is null and new.onboarding_session_id is null
         and new.file_path like 'zamestnanci/' || new.employee_id || '/historie/%' then
        return new;
      end if;
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

-- Upozornenie jednatelovi pri nahrati (jeho vlastne hr_notify oznaci ako precitane).
create or replace function public.hr_documents_uploaded_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_emp text;
  v_by text;
begin
  if new.origin <> 'UPLOADED' or not coalesce(new.is_manual_history_entry, false) then return new; end if;
  select first_name || ' ' || last_name into v_emp from public.employees where id = new.employee_id;
  v_by := coalesce((select full_name from public.profiles where id = auth.uid()),
    (select email from auth.users where id = auth.uid()), 'server');
  perform public.hr_notify('DOCUMENT_UPLOADED', 'NA_VEDOMI',
    'Nahrán podepsaný dokument: ' || coalesce(new.variables_snapshot->>'doc_label', new.doc_type)
      || ' – ' || coalesce(v_emp, new.employee_id) || ' (nahrál: ' || v_by || ')',
    'hr_documents', new.id, new.employee_id,
    jsonb_build_object('doc_type', new.doc_type, 'datum_podpisu', new.variables_snapshot->>'datum_podpisu', 'uploaded_by_name', v_by),
    auth.uid());
  return new;
end $$;
revoke all on function public.hr_documents_uploaded_notify() from public, anon, authenticated;
drop trigger if exists hr_documents_uploaded_notify on public.hr_documents;
create trigger hr_documents_uploaded_notify after insert on public.hr_documents
  for each row execute function public.hr_documents_uploaded_notify();
