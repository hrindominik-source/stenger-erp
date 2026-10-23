-- ============================================================
-- 52. Faza E - detail dokumentu v karte zamestnanca: udalosti (stiahnutie
--     k tlaci), vazba papieroveho skenu na verziu s potvrdenim HR, osobne
--     odovzdanie vyhotovenia, nova verzia dokumentu.
--     Pravne pravidla su KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.
-- ============================================================

-- 52.1 Udalosti dokumentu, ktore nemenia stav (napr. stiahnutie nepodpisaneho
--      finalneho PDF k tlaci). Len pridavanie; mazanie len pri trvalom
--      vymazani zamestnanca (cascade + stenger.hard_delete).
create table if not exists public.hr_document_events (
  id text primary key default gen_random_uuid()::text,
  hr_document_id text not null references public.hr_documents(id) on delete cascade,
  event_type text not null check (event_type in ('PRINT_DOWNLOADED')),
  document_sha256 text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists hr_document_events_doc_idx on public.hr_document_events (hr_document_id);
alter table public.hr_document_events enable row level security;
drop policy if exists "hr_document_events_view" on public.hr_document_events;
create policy "hr_document_events_view" on public.hr_document_events
  for select
  using (
    public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC')
    and exists (select 1 from public.hr_documents d where d.id = hr_document_id) -- dedi klasifikaciu dokumentu
  );
drop policy if exists "hr_document_events_insert" on public.hr_document_events;
create policy "hr_document_events_insert" on public.hr_document_events
  for insert
  with check (
    public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC') and created_by = auth.uid()
    and exists (select 1 from public.hr_documents d where d.id = hr_document_id)
  );

create or replace function public.hr_document_events_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' and coalesce(current_setting('stenger.hard_delete', true), '') = 'on' then
    return old;
  end if;
  if TG_OP = 'INSERT' then
    new.created_at := now();
    if new.event_type = 'PRINT_DOWNLOADED' then
      select d.final_pdf_sha256 into new.document_sha256 from public.hr_documents d where d.id = new.hr_document_id;
    end if;
    return new;
  end if;
  raise exception 'Udalost dokumentu je nemenna.';
end;
$$;
drop trigger if exists hr_document_events_guard on public.hr_document_events;
create trigger hr_document_events_guard before insert or update or delete on public.hr_document_events
  for each row execute function public.hr_document_events_guard();

-- 52.2 Papierovy sken: patri k verzii (finalne PDF) dokumentu, na ktory sa
--      nahrava, a HR potvrdi, ze sken zodpoveda originalu. Trigger bezi PRED
--      hr_document_signatures_guard (abecedne), aby sa hash verzie zapocital
--      do evidence_sha256.
-- Zamerne SECURITY INVOKER: hr_is_server_role() musi vidiet skutocnu rolu.
create or replace function public.hr_document_signatures_bind_version()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_final text;
begin
  if new.method <> 'PAPER' then
    return new;
  end if;
  select d.final_pdf_sha256 into v_final from public.hr_documents d where d.id = new.hr_document_id;
  if v_final is not null then
    new.signed_content_sha256 := coalesce(new.signed_content_sha256, v_final);
    if new.signed_content_sha256 is distinct from v_final then
      raise exception 'Sken patri k jine verzi dokumentu (otisk finalniho PDF nesouhlasi).';
    end if;
  end if;
  if not public.hr_is_server_role() then
    if new.scan_matches_original_confirmed_by is distinct from auth.uid() then
      raise exception 'Chybi potvrzeni HR, ze sken odpovida originalu.';
    end if;
    if coalesce(new.document_hash, '') = '' or new.file_path is null then
      raise exception 'Papirovy podpis vyzaduje nahrany sken s otiskem.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists hr_document_signatures_bind_version on public.hr_document_signatures;
create trigger hr_document_signatures_bind_version before insert on public.hr_document_signatures
  for each row execute function public.hr_document_signatures_bind_version();

-- 52.3 Osobne odovzdanie vyhotovenia. Pisomnosti § 334 (jednostranne ukony
--      zamestnavatela vratane mzdoveho vymeru, zrusenie ve zkusebni dobe) sa
--      osobne dorucuju len proti podpisu potvrdenia prevzatia.
create or replace function public.hr_is_s334_document(p_doc_type text, p_legal_act_type text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_legal_act_type, '') = 'EMPLOYER_UNILATERAL'
      or p_doc_type in ('platovy_vymer', 'mzdovy_vymer', 'vypoved_zamestnavatele', 'zruseni_ve_zkusebni_dobe');
$$;

create or replace function public.hr_document_deliveries_in_person()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.hr_documents%rowtype;
begin
  if new.channel not in ('IN_PERSON_PAPER', 'IN_PERSON_ELECTRONIC_COPY') then
    if TG_OP = 'INSERT' and new.delivery_basis = 'HANDED_OVER' then
      raise exception 'Duvod "predano osobne" jen pro osobni predani.';
    end if;
    return new;
  end if;
  select * into v_doc from public.hr_documents where id = new.hr_document_id;
  if new.delivery_basis is not null and new.delivery_basis not in ('HANDED_OVER', 'SIGNED_RECEIPT') then
    raise exception 'Nepripustny duvod doruceni pro osobni predani.';
  end if;
  if public.hr_is_s334_document(v_doc.doc_type, v_doc.legal_act_type) and new.delivery_basis is distinct from 'SIGNED_RECEIPT'
     and new.delivered_at is not null then
    raise exception 'Pisemnost § 334 se osobne doruci jen proti podpisu potvrzeni o prevzeti.';
  end if;
  if new.delivery_basis = 'SIGNED_RECEIPT' and new.confirmation_evidence is null then
    raise exception 'Chybi zaznam o potvrzeni prevzeti.';
  end if;
  if TG_OP = 'INSERT' then
    new.handed_over_by := coalesce(new.handed_over_by, auth.uid());
    new.delivered_document_sha256 := coalesce(new.delivered_document_sha256, v_doc.signed_pdf_sha256);
    if new.delivered_at is not null and new.delivered_at > now() + interval '5 minutes' then
      raise exception 'Datum predani nemuze byt v budoucnosti.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists hr_document_deliveries_in_person on public.hr_document_deliveries;
create trigger hr_document_deliveries_in_person before insert or update on public.hr_document_deliveries
  for each row execute function public.hr_document_deliveries_in_person();

-- 52.4 Nova verzia: kopia nepodpisaneho dokumentu ako DRAFT (verzia + 1),
--      povodny -> SUPERSEDED s dovodom. Podpisany dokument sa nenahradza -
--      len zneplatni (VOIDED s dovodom) a vytvori sa novy.
create or replace function public.hr_document_new_version(p_document_id text, p_reason text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.hr_documents%rowtype;
  v_new text := gen_random_uuid()::text;
begin
  if not (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_GENERATE')) then
    raise exception 'Neopravneno - nova verze vyzaduje HR_DOCUMENT_GENERATE.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Uvedte duvod nove verze.';
  end if;
  select * into v_doc from public.hr_documents where id = p_document_id for update;
  if v_doc.id is null or exists (
    select 1 from unnest(public.hr_document_required_permissions(v_doc.id)) as perm where not public.hr_has_permission(perm)
  ) then
    raise exception 'Dokument nenalezen.';
  end if;
  if v_doc.status in ('SIGNED', 'ARCHIVED', 'VOIDED', 'SUPERSEDED') then
    raise exception 'Podepsany, zneplatneny nebo nahrazeny dokument nelze nahradit novou verzi.';
  end if;
  insert into public.hr_documents (id, employee_id, employment_id, onboarding_session_id, doc_type, template_id, template_version_id,
    origin, status, generated_at, generated_by, file_path, variables_snapshot, legal_act_type, version_no, supersedes_document_id, notes)
  values (v_new, v_doc.employee_id, v_doc.employment_id, v_doc.onboarding_session_id, v_doc.doc_type, v_doc.template_id, v_doc.template_version_id,
    v_doc.origin, 'DRAFT', now(), auth.uid(), v_doc.file_path, v_doc.variables_snapshot, v_doc.legal_act_type, v_doc.version_no + 1, v_doc.id, v_doc.notes);
  update public.hr_documents set status = 'SUPERSEDED', superseded_by = v_new, void_reason = trim(p_reason), updated_at = now()
    where id = v_doc.id;
  return v_new;
end;
$$;
revoke execute on function public.hr_document_new_version(text, text) from public, anon;
grant execute on function public.hr_document_new_version(text, text) to authenticated;
