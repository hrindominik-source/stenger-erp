-- Rollback migracie 62: vrati anon a PUBLIC pravo EXECUTE na funkcie, ktore
-- ho mali pred migraciou (zoznam z lokalnej DB a katalogu produkcie
-- 24.10.2026), a predvolene prava pre nove funkcie. Data sa nemenia.
begin;
do $$
declare
  sig text;
begin
  foreach sig in array array[
    'public.approve_order_draft(text)', 'public.audit_trigger()',
    'public.dochadzka_has_worker_pin(text)', 'public.dochadzka_reset_worker_pin(text)',
    'public.dochadzka_set_worker_pin(text, text)', 'public.dochadzka_verify_worker_pin(text, text)',
    'public.get_orders_for_sklad()', 'public.hr_admin_delete_employee(text)',
    'public.hr_contact_declarations_guard()', 'public.hr_default_legal_act_type(text)',
    'public.hr_document_deliveries_email_rules()', 'public.hr_document_deliveries_email_server()',
    'public.hr_document_deliveries_guard()', 'public.hr_document_deliveries_in_person()',
    'public.hr_document_deliveries_receipt()', 'public.hr_document_deliveries_receipt_server()',
    'public.hr_document_deliveries_s334_electronic()', 'public.hr_document_deliveries_server_only()',
    'public.hr_document_deliveries_signed()', 'public.hr_document_events_guard()',
    'public.hr_document_required_permissions(text)', 'public.hr_document_signatures_bind_version()',
    'public.hr_document_signatures_employer_method()', 'public.hr_document_signatures_employer_signatory()',
    'public.hr_document_signatures_guard()', 'public.hr_document_signatures_server_only()',
    'public.hr_document_signatures_training()', 'public.hr_documents_declaration_signed()',
    'public.hr_documents_final_freeze()', 'public.hr_documents_finalize()', 'public.hr_documents_guard()',
    'public.hr_documents_links_guard()', 'public.hr_documents_signed_complete()',
    'public.hr_documents_void_declaration()', 'public.hr_documents_void_permission()',
    'public.hr_employees_record_flag_guard()', 'public.hr_employment_terms_as_of(text, date)',
    'public.hr_garnishment_doc_count(text)', 'public.hr_get_permissions()', 'public.hr_has_permission(text)',
    'public.hr_is_employee_declaration(text)', 'public.hr_is_s334_document(text, text)',
    'public.hr_is_server_role()', 'public.hr_legal_texts_guard()', 'public.hr_object_path_visible(text)',
    'public.hr_onboarding_start_session()',
    'public.hr_onboarding_submit(text)', 'public.hr_required_signers(text)',
    'public.hr_revoke_s335_consent(text, timestamp with time zone, text)', 'public.hr_signatories_guard()',
    'public.hr_signature_images_guard()', 'public.hr_signature_verifications_guard()',
    'public.hr_signing_tokens_guard()', 'public.hr_training_records_guard()',
    'public.hr_valid_contact_declaration(text, text)', 'public.next_material_order_number()',
    'public.next_order_numbers()', 'public.set_expedovana(text, text)',
    'public."current_role"()', 'public.plan_smien_has_employee_pin(text)',
    'public.plan_smien_reset_employee_pin(text, text)', 'public.plan_smien_set_admin_pin(text, text)',
    'public.plan_smien_set_employee_pin(text, text)', 'public.plan_smien_verify_admin_pin(text)',
    'public.plan_smien_verify_employee_pin(text, text)'
  ] loop
    if to_regprocedure(sig) is not null then
      execute format('grant execute on function %s to public, anon', to_regprocedure(sig));
    end if;
  end loop;
end $$;
alter default privileges for role postgres in schema public grant execute on functions to anon;
alter default privileges for role postgres grant execute on functions to public;
commit;
