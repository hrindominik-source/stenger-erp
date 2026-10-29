-- Rollback migracie 71 (styri oci). Kontrola pracovneho pomeru sa vrati na
-- verziu z migracie 70 (bez vynimiek). Ziadosti sa zmazu - pred rollbackom
-- ich exportovat, ak treba (zaznam ostava aj v audit_log). Vratit aj frontend.
begin;
drop trigger if exists zz_hr_signatures_employer_approval on public.hr_document_signatures;
drop trigger if exists zz_hr_documents_void_approval on public.hr_documents;
drop function if exists public.hr_signatures_employer_approval();
drop function if exists public.hr_documents_void_approval();
drop function if exists public.hr_open_approvals();
drop function if exists public.hr_approval_state(text, text);
drop function if exists public.hr_cancel_approval(text);
drop function if exists public.hr_decide_approval(text, boolean, text);
drop function if exists public.hr_request_approval(text, text, text, jsonb, boolean, text);

create or replace function public.hr_check_employment(p_employment_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC')) then
    raise exception 'Neopravneno.' using errcode = '42501';
  end if;
  return public.hr_check_employment_core(p_employment_id);
end $$;

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
  new.legal_check := v;
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
  v := public.hr_check_employment_core(d.employment_id);
  select string_agg(i->>'message', ' ') into v_blocks from jsonb_array_elements(v->'issues') i where i->>'level' = 'BLOCK';
  if v_blocks is not null then
    raise exception 'Dokument nelze podepsat – zákonný limit: %', v_blocks using errcode = 'P0001';
  end if;
  return new;
end $$;

drop function if exists public.hr_check_employment_core_with_exceptions(text);
drop function if exists public.hr_usable_approval(text, text);
drop function if exists public.hr_approval_kind_label(text);
drop function if exists public.hr_doc_self_signable(public.hr_documents);
drop function if exists public.hr_user_is_admin(uuid);
drop table if exists public.hr_approval_requests;
commit;
