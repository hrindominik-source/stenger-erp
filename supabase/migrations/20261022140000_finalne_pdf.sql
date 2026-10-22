-- ============================================================
-- 49. Finalne PDF a podpisany original (faza C) - zapisuje ich LEN server.
--     Edge Functions hr-finalize-pdf / hr-signed-original (service role)
--     samy nacitaju subor z uloziska, spocitaju SHA-256 a overia obsah.
--     Hash ani vysledok kontroly z prehliadaca sa nikdy neprijme: zmena
--     final_pdf_* / signed_pdf_* od roly authenticated/anon je odmietnuta.
--     Po zamknuti ich dalej strazi hr_documents_guard (48.3).
-- ============================================================
create or replace function public.hr_is_server_role()
returns boolean
language sql
stable
as $$
  select current_user in ('service_role', 'postgres', 'supabase_admin');
$$;

create or replace function public.hr_documents_finalize()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_final_changed boolean;
  v_signed_changed boolean;
begin
  if TG_OP = 'INSERT' then
    v_final_changed := new.final_pdf_sha256 is not null or new.final_pdf_path is not null or new.final_pdf_text_check is not null;
    v_signed_changed := new.signed_pdf_sha256 is not null or new.signed_pdf_path is not null;
  else
    v_final_changed := new.final_pdf_sha256 is distinct from old.final_pdf_sha256
      or new.final_pdf_path is distinct from old.final_pdf_path
      or new.final_pdf_text_check is distinct from old.final_pdf_text_check
      or new.finalized_by is distinct from old.finalized_by
      or (new.finalized_at is distinct from old.finalized_at and new.final_pdf_sha256 is not distinct from old.final_pdf_sha256);
    v_signed_changed := new.signed_pdf_sha256 is distinct from old.signed_pdf_sha256
      or new.signed_pdf_path is distinct from old.signed_pdf_path;
  end if;

  if v_signed_changed and not public.hr_is_server_role() then
    raise exception 'Podepsany original uklada jen server (hr-signed-original).';
  end if;

  if not v_final_changed then
    return new;
  end if;
  if not public.hr_is_server_role() then
    raise exception 'Finalni PDF a jeho kontrolu uklada jen server (hr-finalize-pdf) - hodnoty z prohlizece se neprijimaji.';
  end if;
  if new.final_pdf_sha256 is null then
    raise exception 'Finalni PDF nelze odebrat - nahrajte novou verzi.';
  end if;
  if new.final_pdf_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Neplatny SHA-256 finalniho PDF.';
  end if;
  if coalesce((new.final_pdf_text_check->>'server_verified')::boolean, false) is not true
     or coalesce((new.final_pdf_text_check->>'ok')::boolean, false) is not true then
    raise exception 'Finalizovat lze jen PDF, ktere proslo kontrolou na serveru.';
  end if;
  if new.status in ('SIGNED', 'ARCHIVED', 'VOIDED', 'SUPERSEDED') then
    raise exception 'Podepsany nebo zneplatneny dokument uz nelze finalizovat.';
  end if;
  new.finalized_at := now();
  return new;
end;
$$;
drop trigger if exists hr_documents_finalize on public.hr_documents;
create trigger hr_documents_finalize before insert or update on public.hr_documents
  for each row execute function public.hr_documents_finalize();
