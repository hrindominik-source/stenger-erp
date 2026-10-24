// Len pre lokalne integracne a e2e testy: od migracie 66 sa koncepty textov
// nepouzivaju a § 21 / § 335 aj prejavy vole ostavaju neschvalene. Test si vlozi docasnu
// schvalenu verziu s rovnakym textom a po teste ju vyradi - lokalna DB potom
// zostane bez schvaleneho § 21 / § 335 ako na produkcii.
export const ECOMM_TEXT_KEYS = ["S21_ADDRESS_NOTICE", "S335_NOTICE", "S335_CONSENT", "S335_REVOCATION"];
// prejavy vole - bez nich elektronicky podpis (tablet, kiosk) nejde
export const ESIGN_TEXT_KEYS = ["INTENT_BILATERAL_CONTRACT", "INTENT_RECEIPT_ACKNOWLEDGEMENT", "INTENT_TRAINING_RECORD",
  "INTENT_EMPLOYEE_DECLARATION", "INTENT_EMPLOYER_SIGNATURE", "INTENT_QUESTIONNAIRE"];

export async function approveTextsForTest(service, keys = [...ECOMM_TEXT_KEYS, ...ESIGN_TEXT_KEYS], run = Date.now().toString(36)) {
  const ids = [];
  for (const key of keys) {
    const id = `lt-it-${key.toLowerCase().replaceAll("_", "-")}-${run}`;
    // testy bezia paralelne - pri kolizii cisla verzie skusi dalsie
    for (let attempt = 0; ; attempt++) {
      const { data: versions, error } = await service.from("hr_legal_text_versions").select("*").eq("text_key", key)
        .order("version_no", { ascending: false });
      if (error) throw error;
      const source = versions.find((v) => v.status === "KONCEPT") || versions[0];
      const { error: insErr } = await service.from("hr_legal_text_versions").insert({
        id, text_key: key, version_no: versions[0].version_no + 1 + attempt, title: source.title, body: source.body, body_sha256: "x",
        status: "SCHVALENO", approval_note: "Dočasně schváleno pro lokální test.",
      });
      if (!insErr) break;
      if (insErr.code !== "23505" || attempt >= 5) throw insErr;
    }
    ids.push(id);
  }
  return {
    ids,
    cleanup: async () => { await service.from("hr_legal_text_versions").update({ status: "VYRAZENO" }).in("id", ids); },
  };
}
