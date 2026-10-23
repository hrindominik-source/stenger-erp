-- ============================================================
-- 54. Faza F - podpisovy rezim na tablete pre HR.
--     Prihlaseny HR overi totoznost podla dokladu a vyda JEDNORAZOVY
--     podpisovy token viazany na dokument + otisk finalneho PDF (kratka
--     platnost, jedno pouzitie). Token pouziva len Edge Function hr-signing
--     (service role) - tabulka nema ziadnu politiku pre klientov.
--     Texty su KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.
-- ============================================================

create table if not exists public.hr_signing_tokens (
  id text primary key default gen_random_uuid()::text,
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  hr_document_id text not null references public.hr_documents(id) on delete cascade,
  final_pdf_sha256 text not null,
  signer_type text not null check (signer_type = 'EMPLOYEE'),
  signer_name text not null,
  identity_verification jsonb not null,   -- sposob overenia + kto overil (bez cisla dokladu)
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '2 hours')
);
create index if not exists hr_signing_tokens_doc_idx on public.hr_signing_tokens (hr_document_id);
alter table public.hr_signing_tokens enable row level security;
-- ziadna policy: klienti (anon aj authenticated) nevidia ani nezapisu nic

create or replace function public.hr_signing_tokens_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if coalesce(current_setting('stenger.hard_delete', true), '') = 'on' then
      return old;
    end if;
    raise exception 'Podpisovy token se nemaze.';
  end if;
  if TG_OP = 'INSERT' then
    new.created_at := now();
    return new;
  end if;
  -- len jednorazove doplnenie pouzitia / zrusenia
  if new.token_sha256 is distinct from old.token_sha256 or new.hr_document_id is distinct from old.hr_document_id
     or new.final_pdf_sha256 is distinct from old.final_pdf_sha256 or new.signer_type is distinct from old.signer_type
     or new.signer_name is distinct from old.signer_name or new.identity_verification is distinct from old.identity_verification
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at
     or (old.used_at is not null and new.used_at is distinct from old.used_at)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'Podpisovy token lze jen jednou pouzit nebo zrusit.';
  end if;
  return new;
end;
$$;
drop trigger if exists hr_signing_tokens_guard on public.hr_signing_tokens;
create trigger hr_signing_tokens_guard before insert or update or delete on public.hr_signing_tokens
  for each row execute function public.hr_signing_tokens_guard();

-- Prejav vule zamestnavatela (osoba s plnou mocou).
insert into public.hr_legal_text_versions (id, text_key, version_no, title, body, body_sha256) values
  ('lt-intent-employer-v1', 'INTENT_EMPLOYER_SIGNATURE', 1, 'Projev vůle – za zaměstnavatele',
   'KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU. Seznámil/a jsem se s celým obsahem dokumentu a podepisuji jej za zaměstnavatele Stenger Czech s.r.o. na základě plné moci.', 'x')
on conflict (id) do nothing;

-- Pisomnost § 334 (napr. mzdovy vymer) zamestnavatel elektronicky
-- nepodpisuje obrazkom podpisu - len uznavanym el. podpisom (PAdES) alebo
-- na papieri (sken).
create or replace function public.hr_document_signatures_employer_method()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.hr_documents%rowtype;
begin
  if new.signer_type = 'EMPLOYER' and new.method = 'ELECTRONIC_TABLET' then
    select * into v_doc from public.hr_documents where id = new.hr_document_id;
    if public.hr_is_s334_document(v_doc.doc_type, v_doc.legal_act_type) then
      raise exception 'Pisemnost § 334 podepisuje zamestnavatel uznavanym elektronickym podpisem nebo na papire, ne obrazkem podpisu.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists hr_document_signatures_employer_method on public.hr_document_signatures;
create trigger hr_document_signatures_employer_method before insert on public.hr_document_signatures
  for each row execute function public.hr_document_signatures_employer_method();
