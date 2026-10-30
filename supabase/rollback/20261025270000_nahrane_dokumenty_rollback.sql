-- Rollback migracie 80 (nahrane dokumenty). Nahrane dokumenty ostavaju, ale
-- znova ich vidi aj zaklada len jednatel (HR_ADMIN). Vratit aj frontend.
begin;
drop trigger if exists hr_documents_uploaded_notify on public.hr_documents;
drop function if exists public.hr_documents_uploaded_notify();

create or replace function public.hr_document_required_permissions(p_document_id text)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare v_perms text[]; v_origin text;
begin
  select tv.required_permissions, d.origin into v_perms, v_origin
  from public.hr_documents d left join public.hr_document_template_versions tv on tv.id = d.template_version_id
  where d.id = p_document_id;
  if v_perms is null or array_length(v_perms, 1) is null then
    if v_origin = 'UPLOADED' then return array['HR_ADMIN']; else return array['HR_VIEW_SENSITIVE']; end if;
  end if;
  return v_perms;
end $$;

-- bez security definer: hr_is_server_role() testuje current_user (ako v migracii 75)
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

drop function if exists public.hr_upload_doc_types();
commit;
