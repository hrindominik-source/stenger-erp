-- Migracia 74 (balik H): sledovanie legislativy a revizie.
-- 1. Polrocna revizia sablon, textov a zakonnych parametrov k 1. 1. a 1. 7.
--    (pripomienka 30 dni vopred, kym ju jednatel nepotvrdi) a revizia
--    sablony/textu k jej datumu revizie (next_review_date).
-- 2. Strazca zmien zakona c. 262/2006 Sb. (zakonnik prace): server (hr-legislativa)
--    stiahne nastaveny zdroj, porovna odtlacok a pri zmene upozorni jednatela.
--    Nic sa nemeni automaticky. Zdroj je predvolene nenastaveny a vypnuty -
--    strojovo citatelne rozhranie e-Sbirky treba najprv overit (docs/audit/05).
-- Bez pg_cron: hr_revision_notify spusti otvorenie prehladu jednatela a na
-- vlastnom serveri denny planovac cez hr-legislativa (plan nasadenia).

-- ---------- 1. revizie ----------
create table if not exists public.hr_revision_reviews (
  period date primary key check (extract(day from period) = 1 and extract(month from period) in (1, 7)),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz not null default now(),
  note text not null check (length(trim(note)) >= 3)
);
alter table public.hr_revision_reviews enable row level security;
revoke all on public.hr_revision_reviews from anon, authenticated;
grant select on public.hr_revision_reviews to authenticated;
create policy hr_revision_reviews_select on public.hr_revision_reviews for select
  using (public.hr_role_ok() and public.hr_has_permission('HR_VIEW_BASIC'));
drop trigger if exists audit_hr_revision_reviews on public.hr_revision_reviews;
create trigger audit_hr_revision_reviews after insert or update on public.hr_revision_reviews
  for each row execute function public.audit_trigger();

-- Najblizsi polrocny termin, ktory uz "plati" (30 dni vopred) a nie je potvrdeny.
create or replace function public.hr_revision_period(p_on date default current_date)
returns date language sql immutable as $$
  select case when p_on + 30 >= make_date(extract(year from p_on + 30)::int, 7, 1)
    then make_date(extract(year from p_on + 30)::int, 7, 1)
    else make_date(extract(year from p_on + 30)::int, 1, 1) end;
$$;

create or replace function public.hr_revision_items()
returns table (kind text, entity text, entity_id text, label text, due_date date)
language sql stable security definer set search_path = public as $$
  select 'SEMIANNUAL', 'hr_revision_reviews', public.hr_revision_period()::text,
    'Pololetní revize šablon, právních textů a zákonných parametrů', public.hr_revision_period()
  where not exists (select 1 from public.hr_revision_reviews r where r.period = public.hr_revision_period())
  union all
  select 'TEMPLATE', 'hr_document_templates', t.id, 'Revize šablony: ' || t.name, t.next_review_date
  from public.hr_document_templates t
  where t.active and t.next_review_date is not null and t.next_review_date <= current_date + 30
  union all
  select 'LEGAL_TEXT', 'hr_legal_text_versions', v.id, 'Revize textu: ' || v.title, v.next_review_date
  from public.hr_legal_text_versions v
  where v.status = 'SCHVALENO' and v.next_review_date is not null and v.next_review_date <= current_date + 30;
$$;
revoke all on function public.hr_revision_items() from public, anon, authenticated;

create or replace function public.hr_revision_due_list()
returns table (kind text, entity text, entity_id text, label text, due_date date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.hr_has_permission('HR_ADMIN') then raise exception 'Neopravneno.' using errcode = '42501'; end if;
  return query select * from public.hr_revision_items() order by 5;
end $$;
revoke all on function public.hr_revision_due_list() from public, anon;
grant execute on function public.hr_revision_due_list() to authenticated;

-- Upozornenia (idempotentne): nova polozka -> KE_SCHVALENI; vyriesena -> zavriet.
create or replace function public.hr_revision_notify()
returns int language plpgsql volatile security definer set search_path = public as $$
declare r record; n int := 0;
begin
  -- v SECURITY DEFINER je current_user vlastnik - rozhoduje rola poziadavky
  -- (service_role = planovac; 'none' = migracia/psql) alebo jednatel
  if coalesce(current_setting('role', true), 'none') not in ('service_role', 'none') and not public.hr_has_permission('HR_ADMIN') then
    raise exception 'Neopravneno.' using errcode = '42501';
  end if;
  for r in select * from public.hr_revision_items() loop
    if not exists (select 1 from public.hr_notifications where event_type = 'REVISION_DUE' and entity = r.entity
        and entity_id = r.entity_id and resolved_at is null and (data->>'due_date')::date = r.due_date) then
      perform public.hr_notify('REVISION_DUE', 'KE_SCHVALENI', r.label || ' (do ' || to_char(r.due_date, 'DD.MM.YYYY') || ')',
        r.entity, r.entity_id, null, jsonb_build_object('kind', r.kind, 'due_date', r.due_date));
      n := n + 1;
    end if;
  end loop;
  update public.hr_notifications n2 set resolved_at = now(), read_at = coalesce(read_at, now())
  where n2.event_type = 'REVISION_DUE' and n2.resolved_at is null
    and not exists (select 1 from public.hr_revision_items() i where i.entity = n2.entity and i.entity_id = n2.entity_id
      and i.due_date = (n2.data->>'due_date')::date);
  return n;
end $$;
revoke all on function public.hr_revision_notify() from public, anon;
grant execute on function public.hr_revision_notify() to authenticated, service_role;

create or replace function public.hr_revision_confirm(p_period date, p_note text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.hr_has_permission('HR_ADMIN') then raise exception 'Revizi potvrzuje jednatel.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Uveďte, co bylo zkontrolováno.'; end if;
  insert into public.hr_revision_reviews (period, reviewed_by, note) values (p_period, auth.uid(), trim(p_note));
  perform public.hr_revision_notify();
exception when unique_violation then
  raise exception 'Revize k tomuto termínu už je potvrzena.';
end $$;
revoke all on function public.hr_revision_confirm(date, text) from public, anon;
grant execute on function public.hr_revision_confirm(date, text) to authenticated;

-- ---------- 2. strazca legislativy ----------
create table if not exists public.hr_legislation_watch (
  id text primary key,
  act_label text not null,
  source_url text check (source_url is null or source_url ~ '^https://([a-z0-9-]+\.)*(e-sbirka\.gov\.cz|e-sbirka\.cz)(/|$)'),
  enabled boolean not null default false,
  last_fingerprint text,
  last_version_label text,
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  last_error text,
  consecutive_errors int not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  check (not enabled or source_url is not null)
);
alter table public.hr_legislation_watch enable row level security;
revoke all on public.hr_legislation_watch from anon, authenticated;
grant select on public.hr_legislation_watch to authenticated;
grant update (source_url, enabled) on public.hr_legislation_watch to authenticated;
create policy hr_legislation_watch_select on public.hr_legislation_watch for select using (public.hr_has_permission('HR_ADMIN'));
create policy hr_legislation_watch_update on public.hr_legislation_watch for update
  using (public.hr_has_permission('HR_ADMIN')) with check (public.hr_has_permission('HR_ADMIN'));

create or replace function public.hr_legislation_watch_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
    new.updated_at := now();
    -- novy zdroj = novy zaciatok porovnavania
    if new.source_url is distinct from old.source_url then
      new.last_fingerprint := null;
      new.last_version_label := null;
      new.consecutive_errors := 0;
      new.last_error := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists hr_legislation_watch_stamp on public.hr_legislation_watch;
create trigger hr_legislation_watch_stamp before update on public.hr_legislation_watch
  for each row execute function public.hr_legislation_watch_stamp();
drop trigger if exists audit_hr_legislation_watch on public.hr_legislation_watch;
create trigger audit_hr_legislation_watch after update of source_url, enabled on public.hr_legislation_watch
  for each row execute function public.audit_trigger();

insert into public.hr_legislation_watch (id, act_label) values
  ('ZP_262_2006', 'Zákon č. 262/2006 Sb., zákoník práce')
on conflict (id) do nothing;

-- Vysledok kontroly (len server). Prvy odtlacok sa len ulozi; zmena =
-- upozornenie jednatelovi; 3 chyby za sebou = upozornenie (raz za den).
create or replace function public.hr_legislation_record(p_id text, p_fingerprint text, p_version_label text, p_error text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare w public.hr_legislation_watch;
begin
  select * into w from public.hr_legislation_watch where id = p_id for update;
  if not found then raise exception 'Neznámý zdroj.'; end if;
  if p_error is not null then
    update public.hr_legislation_watch set last_checked_at = now(), last_error = left(p_error, 500), consecutive_errors = consecutive_errors + 1 where id = p_id;
    if w.consecutive_errors + 1 >= 3 and not exists (select 1 from public.hr_notifications
        where event_type = 'LEGISLATION_CHECK_FAILED' and entity_id = p_id and created_at > now() - interval '1 day') then
      perform public.hr_notify('LEGISLATION_CHECK_FAILED', 'NA_VEDOMI', 'Kontrola změn zákona selhává: ' || w.act_label,
        'hr_legislation_watch', p_id, null, jsonb_build_object('error', left(p_error, 300)));
    end if;
    return 'ERROR';
  end if;
  update public.hr_legislation_watch set last_checked_at = now(), last_error = null, consecutive_errors = 0,
    last_fingerprint = p_fingerprint, last_version_label = p_version_label,
    last_changed_at = case when w.last_fingerprint is not null and w.last_fingerprint <> p_fingerprint then now() else last_changed_at end
  where id = p_id;
  if w.last_fingerprint is null then return 'FIRST'; end if;
  if w.last_fingerprint = p_fingerprint then return 'SAME'; end if;
  perform public.hr_notify('LEGISLATION_CHANGED', 'KE_SCHVALENI',
    'Možná změna: ' || w.act_label || ' – zkontrolujte s právničkou šablony, texty a zákonné parametry (nic se nezměnilo automaticky)',
    'hr_legislation_watch', p_id, null,
    jsonb_build_object('previous_version', w.last_version_label, 'version', p_version_label, 'source_url', w.source_url));
  return 'CHANGED';
end $$;
revoke all on function public.hr_legislation_record(text, text, text, text) from public, anon, authenticated;
grant execute on function public.hr_legislation_record(text, text, text, text) to service_role;
