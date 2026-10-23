-- ============================================================
-- 57. Faza H - opravnenia pre podpisy a dorucovanie.
--   Nove opravnenia (HR_ADMIN ma vsetko, hr_has_permission):
--   - HR_DOCUMENT_VOID      zneplatnenie dokumentu (aj "zneplatnit a nova
--                           verzia" pri zamknutom dokumente)
--   - HR_SIGN_FOR_EMPLOYER  podpis za zamestnavatela na tablete (navyse
--                           platna osoba s plnou mocou v hr_signatories)
--   Existujuce: HR_DOCUMENT_SEND (odovzdanie/odoslanie), HR_LEGAL_TEXTS_ADMIN
--   (texty vyhlaseni a pouceni), HR_DOCUMENT_SIGN (papier, tablet zamestnanca,
--   nahratie PAdES), HR_ADMIN (osoby s plnou mocou, nastavenia).
--   Po nasadeni ich HR_ADMIN priradi ludom (docs/podpisy-dorucovani).
-- ============================================================

-- Opravnenie konkretneho pouzivatela (server overuje podpisujuceho, nie volajuceho).
create or replace function public.hr_user_has_permission(p_user_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hr_permissions hp join auth.users u on lower(u.email) = lower(hp.user_email)
    where u.id = p_user_id and (p_permission = any(hp.permissions) or 'HR_ADMIN' = any(hp.permissions))
  );
$$;
revoke all on function public.hr_user_has_permission(uuid, text) from public, anon, authenticated;
grant execute on function public.hr_user_has_permission(uuid, text) to service_role;

-- ---------- zneplatnenie ----------
-- INVOKER: current_user rozlisi priamy zapis klienta od RPC/servera.
--   - priamo z klienta: VOIDED vzdy len s HR_DOCUMENT_VOID;
--   - cez RPC (napr. nova verzia) v mene pouzivatela: zamknuty dokument
--     (aspon jeden podpis) len s HR_DOCUMENT_VOID. Automaticke zneplatnenie
--     nepodpisanych konceptov kiosku zostava bez noveho opravnenia.
create or replace function public.hr_documents_void_permission()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'VOIDED' and old.status is distinct from 'VOIDED' then
    if (not public.hr_is_server_role() or (old.locked_at is not null and auth.uid() is not null))
       and not public.hr_has_permission('HR_DOCUMENT_VOID') then
      raise exception 'Zneplatneni dokumentu vyzaduje opravneni HR_DOCUMENT_VOID.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists hr_documents_void_permission on public.hr_documents;
create trigger hr_documents_void_permission before update on public.hr_documents
  for each row execute function public.hr_documents_void_permission();

-- ---------- podpis za zamestnavatela na tablete ----------
-- Podpisujuci musi byt platna osoba s plnou mocou (k datumu podpisu),
-- naviazana na pouzivatela s HR_SIGN_FOR_EMPLOYER; meno sa musi zhodovat.
create or replace function public.hr_document_signatures_employer_signatory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sig public.hr_signatories%rowtype;
begin
  if new.signer_type <> 'EMPLOYER' or new.method <> 'ELECTRONIC_TABLET' then
    return new;
  end if;
  select * into v_sig from public.hr_signatories where id = new.evidence->>'signatory_id';
  if v_sig.id is null then
    raise exception 'Podpis za zamestnavatele bez osoby s plnou moci.';
  end if;
  if v_sig.user_id is null or v_sig.user_id is distinct from new.signer_user_id then
    raise exception 'Za zamestnavatele podepisuje jen prihlaseny uzivatel uvedeny u osoby s plnou moci.';
  end if;
  if (coalesce(new.signed_at, now()) at time zone 'Europe/Prague')::date < v_sig.valid_from
     or (v_sig.valid_to is not null and (coalesce(new.signed_at, now()) at time zone 'Europe/Prague')::date > v_sig.valid_to) then
    raise exception 'Plna moc v den podpisu neplati.';
  end if;
  if lower(trim(new.signed_by_name)) <> lower(trim(v_sig.full_name)) then
    raise exception 'Jmeno podepisujiciho neodpovida osobe s plnou moci.';
  end if;
  if not public.hr_user_has_permission(v_sig.user_id, 'HR_SIGN_FOR_EMPLOYER') then
    raise exception 'Podepisujici nema opravneni HR_SIGN_FOR_EMPLOYER.';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_document_signatures_employer_signatory on public.hr_document_signatures;
create trigger hr_document_signatures_employer_signatory before insert on public.hr_document_signatures
  for each row execute function public.hr_document_signatures_employer_signatory();

-- ---------- citlivost dokumentu aj pre podpisove zaznamy ----------
-- Baseline: podpisy videl kazdy s HR_VIEW_BASIC, aj pri dokumente, ktory
-- sam nevidi (citlivost sablony). Teraz len ked vidi dokument (RLS hr_documents).
drop policy if exists "hr_document_signatures_view" on public.hr_document_signatures;
create policy "hr_document_signatures_view" on public.hr_document_signatures
  for select
  using (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC')
    and exists (select 1 from public.hr_documents d where d.id = hr_document_signatures.hr_document_id));
-- Zapis (sken podpisu, predanie) tiez len k dokumentu, ktory pouzivatel vidi.
drop policy if exists "hr_document_signatures_insert" on public.hr_document_signatures;
create policy "hr_document_signatures_insert" on public.hr_document_signatures
  for insert
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SIGN')
    and exists (select 1 from public.hr_documents d where d.id = hr_document_signatures.hr_document_id));
drop policy if exists "hr_document_deliveries_insert" on public.hr_document_deliveries;
create policy "hr_document_deliveries_insert" on public.hr_document_deliveries
  for insert
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SEND')
    and exists (select 1 from public.hr_documents d where d.id = hr_document_deliveries.hr_document_id));
drop policy if exists "hr_document_deliveries_update" on public.hr_document_deliveries;
create policy "hr_document_deliveries_update" on public.hr_document_deliveries
  for update
  using (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SEND')
    and exists (select 1 from public.hr_documents d where d.id = hr_document_deliveries.hr_document_id))
  with check (public.current_role() = 'office' and public.hr_has_permission('HR_DOCUMENT_SEND')
    and exists (select 1 from public.hr_documents d where d.id = hr_document_deliveries.hr_document_id));
