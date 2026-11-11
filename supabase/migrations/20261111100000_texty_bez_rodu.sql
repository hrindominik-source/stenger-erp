-- Texty prejavu vole a vyhlaseni bez tvarov "(a)" / "/a" (rodovo neutralne).
-- Nova verzia kazdeho dotknuteho textu ide ako KONCEPT - pouzije sa az po
-- schvaleni jednatelom (hr_approve_legal_text). Starsie verzie ostavaju bez
-- zmeny; schvalena verzia (RECEIPT_CONFIRMATION v1) plati, kym jednatel
-- neschvali novu. Na schvalenie sa ponuka najnovsi koncept.
do $$
declare
  r record;
  v_body text;
begin
  for r in
    select distinct on (text_key) *
    from public.hr_legal_text_versions
    where text_key in ('INTENT_BILATERAL_CONTRACT', 'INTENT_EMPLOYER_SIGNATURE', 'RECEIPT_CONFIRMATION', 'S21_ADDRESS_NOTICE', 'S335_NOTICE')
      and status <> 'VYRAZENO' and version_no < 100000
    order by text_key, version_no desc
  loop
    v_body := r.body;
    v_body := replace(v_body, 'Seznámil/a jsem se s celým obsahem a uzavírám tuto smlouvu.',
      'Po seznámení s celým obsahem uzavírám tuto smlouvu.');
    v_body := replace(v_body, 'Seznámil/a jsem se s celým obsahem dokumentu a podepisuji jej za zaměstnavatele',
      'Po seznámení s celým obsahem dokumentu jej podepisuji za zaměstnavatele');
    v_body := replace(v_body, 'Potvrzuji, že jsem dne uvedeného níže převzal(a) od zaměstnavatele Stenger Czech s.r.o., IČO 28501381, písemnost uvedenou v tomto potvrzení',
      'Potvrzuji převzetí písemnosti uvedené v tomto potvrzení od zaměstnavatele Stenger Czech s.r.o., IČO 28501381, dne uvedeného níže');
    v_body := replace(v_body, 'pokud jsem dosud nezačal(a) plnit práva a povinnosti z ní vyplývající.',
      'nejpozději však do zahájení plnění práv a povinností z ní vyplývajících.');
    v_body := replace(v_body, 'kdekoli budete zastižen(a),', 'kdekoli vás zastihneme,');
    if v_body is distinct from r.body then
      insert into public.hr_legal_text_versions (id, text_key, version_no, title, body, body_sha256)
      values ('lt-bezrodu-' || lower(replace(r.text_key, '_', '-')), r.text_key, r.version_no + 1, r.title, v_body, 'x');
    end if;
  end loop;
end $$;
