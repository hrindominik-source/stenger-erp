-- ============================================================
-- 56. Faza G - dorucovanie e-mailom (§ 21, § 334-335 ZP).
--   E-mail odosiela LEN server (Edge Function hr-delivery); lokalne iba do
--   testovacej schranky Mailpit (hr_settings.email_mode = 'mock'), skutocny
--   poskytovatel nie je nakonfigurovany. Pravidla:
--   - odoslanie != dorucenie; § 21 "dodane" len podla dokladu poskytovatela
--     alebo potvrdenia zamestnanca, potom 7-dnova lehota na odstupenie;
--   - § 335 suhlas: dorucene potvrdenim, inak fikcia 15. den od dodania;
--   - § 335 odst. 3 (mzdovy vymer na inu adresu): len pisomne potvrdenie,
--     bez neho 15 dni od odoslania = neucinne (automaticky);
--   - nedorucitelna sprava = neucinne; zlyhanie = FAILED, max. 3 pokusy.
--   Lehoty a texty su KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.
-- ============================================================

alter table public.hr_document_deliveries
  add column if not exists provider text,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists provider_delivered_at timestamptz,   -- doklad poskytovatela o dodani do schranky
  add column if not exists withdrawal_scan_path text,
  add column if not exists withdrawal_scan_sha256 text check (withdrawal_scan_sha256 is null or withdrawal_scan_sha256 ~ '^[0-9a-f]{64}$');
alter table public.hr_document_deliveries drop constraint if exists hr_document_deliveries_withdrawal_scan_check;
alter table public.hr_document_deliveries add constraint hr_document_deliveries_withdrawal_scan_check
  check ((withdrawal_scan_path is null) = (withdrawal_scan_sha256 is null));
alter table public.hr_document_deliveries drop constraint if exists hr_document_deliveries_attempts_check;
alter table public.hr_document_deliveries add constraint hr_document_deliveries_attempts_check check (attempts between 0 and 3);

-- Platne vyhlasenie pre aktualny private_email - verzia pre server (bez
-- kontroly roly office; hr_valid_contact_declaration je pre UI).
create or replace function public.hr_valid_contact_declaration_server(p_employee_id text, p_kind text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.id
  from public.employee_contact_declarations d
  join public.employees e on e.id = d.employee_id
  where d.employee_id = p_employee_id and d.kind = p_kind and p_kind in ('S21_ADDRESS_NOTICE', 'S335_CONSENT')
    and d.superseded_at is null and d.revoked_at is null
    and e.private_email is not null and d.email_snapshot = lower(trim(e.private_email))
  order by d.declared_at desc
  limit 1;
$$;
revoke all on function public.hr_valid_contact_declaration_server(text, text) from public, anon, authenticated;
grant execute on function public.hr_valid_contact_declaration_server(text, text) to service_role;

-- E-mailove zaznamy a stav odoslania zapisuje len server (INVOKER kvoli
-- hr_is_server_role). HR doplna len to, co nema vplyv na odoslanie.
-- Nazov "a_..." = spusti sa pred ostatnymi triggrami (abecedne poradie).
create or replace function public.hr_document_deliveries_email_server()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.hr_is_server_role() then
    return new;
  end if;
  if TG_OP = 'INSERT' and new.channel like 'EMAIL%' then
    raise exception 'E-mailem odesila jen server (Odeslat e-mailem v detailu dokumentu).';
  end if;
  if TG_OP = 'UPDATE' and (
       new.send_status is distinct from old.send_status or new.sent_at is distinct from old.sent_at
       or new.queued_at is distinct from old.queued_at or new.provider_message_id is distinct from old.provider_message_id
       or new.provider_delivered_at is distinct from old.provider_delivered_at or new.attempts is distinct from old.attempts
       or new.last_attempt_at is distinct from old.last_attempt_at or new.send_error is distinct from old.send_error
       or new.provider is distinct from old.provider
       or new.withdrawal_scan_path is distinct from old.withdrawal_scan_path
       or (old.channel like 'EMAIL%' and (new.delivered_at is distinct from old.delivered_at or new.withdrawal_received_at is distinct from old.withdrawal_received_at))) then
    raise exception 'Stav odeslani, doruceni e-mailem a odstoupeni zapisuje server.';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_document_deliveries_a_email_server on public.hr_document_deliveries;
create trigger hr_document_deliveries_a_email_server before insert or update on public.hr_document_deliveries
  for each row execute function public.hr_document_deliveries_email_server();

create or replace function public.hr_document_deliveries_email_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text := case when TG_OP = 'UPDATE' then old.send_status else null end;
begin
  if new.channel not like 'EMAIL%' then
    if new.withdrawal_received_at is not null or new.provider_delivered_at is not null then
      raise exception 'Odstoupeni a doklad o dodani jen u e-mailu.';
    end if;
    return new;
  end if;

  -- prechody stavu odoslania
  if new.send_status is distinct from v_old_status then
    if not (
         (v_old_status is null and new.send_status = 'QUEUED')
      or (v_old_status = 'QUEUED' and new.send_status in ('SENT', 'FAILED'))
      or (v_old_status = 'FAILED' and new.send_status = 'QUEUED' and new.attempts < 3)
      or (v_old_status = 'SENT' and new.send_status = 'BOUNCED')) then
      raise exception 'Neplatny prechod stavu odeslani % -> %.', coalesce(v_old_status, '-'), new.send_status;
    end if;
    if new.send_status = 'QUEUED' then
      new.queued_at := coalesce(new.queued_at, now());
      new.send_error := null;
    end if;
    if new.send_status = 'SENT' and new.sent_at is null then
      raise exception 'Odeslano bez casu odeslani.';
    end if;
    if new.send_status = 'FAILED' and coalesce(new.send_error, '') = '' then
      raise exception 'Selhani odeslani bez chyby.';
    end if;
  end if;
  if new.ineffective_at is not null and TG_OP = 'UPDATE' and old.ineffective_at is null and new.send_status in ('QUEUED') then
    raise exception 'Neucinne doruceni se znovu neodesila.';
  end if;

  -- doklad o dodani do schranky: raz, len po odoslani
  if new.provider_delivered_at is not null and (TG_OP = 'INSERT' or old.provider_delivered_at is null) then
    if new.send_status is distinct from 'SENT' or new.sent_at is null then
      raise exception 'Doklad o dodani jen u odeslane zpravy.';
    end if;
  end if;
  if TG_OP = 'UPDATE' and old.provider_delivered_at is not null and new.provider_delivered_at is distinct from old.provider_delivered_at then
    raise exception 'Doklad o dodani nelze menit.';
  end if;

  -- nedorucitelna sprava = neucinne (§ 335 odst. 5; pri § 21 vyhotovenie nedodane)
  if new.send_status = 'BOUNCED' and v_old_status is distinct from 'BOUNCED' then
    if new.delivered_at is not null then
      raise exception 'Dorucena zprava nemuze byt vracena.';
    end if;
    new.ineffective_at := coalesce(new.ineffective_at, now());
    new.ineffective_reason := coalesce(new.ineffective_reason, 'Zprava se vratila jako nedorucitelna – doruceni je neucinne.');
  end if;

  -- dovody dorucenia podla kanala
  if new.delivered_at is not null and (TG_OP = 'INSERT' or old.delivered_at is null) then
    if new.delivered_at > now() + interval '5 minutes' then
      raise exception 'Datum doruceni nemuze byt v budoucnosti.';
    end if;
    if new.delivery_basis = 'PROVIDER_DELIVERED_S21' and (new.channel <> 'EMAIL_S21' or new.provider_delivered_at is null) then
      raise exception 'Dodani do schranky jen u § 21 s dokladem poskytovatele.';
    end if;
    if new.delivery_basis = 'EMPLOYEE_CONFIRMATION' and new.receipt_scan_path is null then
      raise exception 'Potvrzeni prevzeti e-mailem vyzaduje ulozene pisemne potvrzeni zamestnance.';
    end if;
    if new.delivery_basis = 'FICTION_15_DAYS' and (new.channel <> 'EMAIL_S335_CONSENT' or new.provider_delivered_at is null
         or (new.delivered_at at time zone 'Europe/Prague')::date <> ((new.provider_delivered_at at time zone 'Europe/Prague')::date + 15)) then
      raise exception 'Fikce doruceni jen u § 335 se souhlasem, 15. den od dodani.';
    end if;
    if new.channel = 'EMAIL_S21' and new.delivery_basis not in ('PROVIDER_DELIVERED_S21', 'EMPLOYEE_CONFIRMATION') then
      raise exception 'Nepripustny duvod doruceni pro § 21.';
    end if;
    if new.channel = 'EMAIL_S21' then
      new.withdrawal_deadline := coalesce(new.withdrawal_deadline, (new.delivered_at at time zone 'Europe/Prague')::date + 7);
    end if;
  end if;

  -- pisomne odstupenie od zmluvy (§ 21 odst. 2)
  if new.withdrawal_received_at is not null and (TG_OP = 'INSERT' or old.withdrawal_received_at is null) then
    if new.channel <> 'EMAIL_S21' then
      raise exception 'Odstoupeni jen u smlouvy zaslane podle § 21.';
    end if;
    if new.withdrawal_received_at > now() + interval '5 minutes' then
      raise exception 'Datum odstoupeni nemuze byt v budoucnosti.';
    end if;
    if new.withdrawal_deadline is not null and (new.withdrawal_received_at at time zone 'Europe/Prague')::date > new.withdrawal_deadline then
      raise exception 'Odstoupeni doslo po lhute (do %).', new.withdrawal_deadline;
    end if;
    if new.withdrawal_scan_path is null then
      raise exception 'Odstoupeni vyzaduje ulozeny sken pisemneho odstoupeni.';
    end if;
  end if;
  if TG_OP = 'UPDATE' and old.withdrawal_scan_path is not null and new.withdrawal_scan_path is distinct from old.withdrawal_scan_path then
    raise exception 'Sken odstoupeni je nemenny.';
  end if;
  if new.withdrawal_scan_path is not null and new.withdrawal_scan_path not like 'prevzeti/' || new.hr_document_id || '/%' then
    raise exception 'Sken odstoupeni musi byt ve slozce dokumentu.';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_document_deliveries_email_rules on public.hr_document_deliveries;
create trigger hr_document_deliveries_email_rules before insert or update on public.hr_document_deliveries
  for each row execute function public.hr_document_deliveries_email_rules();

-- Automaticke vyhodnotenie lehot (spusta UI pri nacitani doruceni a server;
-- vysledok je deterministicky dany datami - moze ho spustit ktokolvek z HR).
create or replace function public.hr_document_deliveries_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
  v_k int;
begin
  -- SECURITY DEFINER: hr_is_server_role() by tu videl vlastnika funkcie.
  -- Server (service_role) nema auth.uid(); anon funkciu spustit nemoze.
  if auth.uid() is not null and not (public.current_role() = 'office' and public.hr_has_permission('HR_VIEW_BASIC')) then
    raise exception 'Neopravneno.';
  end if;
  -- § 335 odst. 3: bez pisomneho potvrdenia do 15 dni od odoslania = neucinne
  update public.hr_document_deliveries
    set ineffective_at = sent_at + interval '15 days',
        ineffective_reason = 'Bez pisemneho potvrzeni prevzeti do 15 dnu od odeslani (§ 335 odst. 3) – doruceni je neucinne, predejte osobne.'
    where channel = 'EMAIL_S335_WAGE_OTHER_ADDRESS' and send_status = 'SENT' and delivered_at is null and ineffective_at is null
      and now() >= sent_at + interval '15 days';
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  -- § 335 odst. 2: fikcia dorucenia 15. den od dodania (len s dokladom o dodani)
  update public.hr_document_deliveries
    set delivered_at = (((provider_delivered_at at time zone 'Europe/Prague')::date + 15)::timestamp at time zone 'Europe/Prague'),
        delivery_basis = 'FICTION_15_DAYS'
    where channel = 'EMAIL_S335_CONSENT' and send_status = 'SENT' and provider_delivered_at is not null
      and delivered_at is null and ineffective_at is null
      and now() >= (((provider_delivered_at at time zone 'Europe/Prague')::date + 15)::timestamp at time zone 'Europe/Prague');
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end;
$$;
revoke all on function public.hr_document_deliveries_sweep() from public, anon;
grant execute on function public.hr_document_deliveries_sweep() to authenticated, service_role;
