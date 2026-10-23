-- ROLLBACK migracie 20261023110000_tablet_podpis_hr.sql (spustit PRED rollbackom 53).
-- Zastavi sa, ak uz existuju podpisy cez tablet HR (token) alebo podpisy
-- za zamestnavatela s textom INTENT_EMPLOYER_SIGNATURE - najprv ich exportujte.
-- Edge Function hr-signing treba pred rollbackom vypnut (undeploy).
begin;
do $$
begin
  if exists (select 1 from public.hr_signing_tokens where used_at is not null)
     or exists (select 1 from public.hr_document_signatures s join public.hr_legal_text_versions t on t.id = s.intent_text_version_id
                where t.text_key = 'INTENT_EMPLOYER_SIGNATURE') then
    raise exception 'Rollback zastaven: existuji podpisy z tabletu HR nebo podpisy za zamestnavatele.';
  end if;
end;
$$;
drop trigger if exists hr_document_signatures_employer_method on public.hr_document_signatures;
drop function if exists public.hr_document_signatures_employer_method();
set local stenger.hard_delete = 'on';
drop table if exists public.hr_signing_tokens;
drop function if exists public.hr_signing_tokens_guard();
-- text lt-intent-employer-v1 ostava (verzie pravnych textov su nemenne, hr_legal_texts_guard)
commit;
