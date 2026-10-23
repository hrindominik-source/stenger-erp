import { describe, it, expect } from "vitest";
import { defaultLegalActType, documentRequiredSigners, missingSigners, signingState } from "./signingRules.js";

const H = "a".repeat(64);
const tablet = (signer_type, sha = H) => ({ signer_type, method: "ELECTRONIC_TABLET", signed_content_sha256: sha });
const paper = (signer_type) => ({ signer_type, method: "PAPER" });

describe("kto musi podpisat (zrkadlo DB, migracia 51)", () => {
  it("typ ukonu podla druhu dokumentu", () => {
    expect(defaultLegalActType("pracovni_smlouva")).toBe("BILATERAL_CONTRACT");
    expect(defaultLegalActType("dodatek")).toBe("BILATERAL_CONTRACT");
    expect(defaultLegalActType("mzdovy_vymer")).toBe("EMPLOYER_UNILATERAL");
    expect(defaultLegalActType("vstupni_skoleni")).toBe("TRAINING_RECORD");
    expect(defaultLegalActType("zruseni_ve_zkusebni_dobe")).toBe(null);
  });
  it("zmluva: zamestnanec aj zamestnavatel; explicitny typ ma prednost", () => {
    expect(documentRequiredSigners({ doc_type: "pracovni_smlouva" })).toEqual(["EMPLOYEE", "EMPLOYER"]);
    expect(documentRequiredSigners({ doc_type: "mzdovy_vymer" })).toEqual(["EMPLOYER"]);
    expect(documentRequiredSigners({ doc_type: "pracovni_smlouva", legal_act_type: "EMPLOYEE_DECLARATION" })).toEqual(["EMPLOYEE"]);
  });
});

describe("zamknuty != podpisany", () => {
  const contract = { doc_type: "pracovni_smlouva", final_pdf_sha256: H, status: "READY_FOR_SIGNATURE", locked_at: "2026-10-22" };
  it("zmluva len s podpisom zamestnanca: ceka na zamestnavatela", () => {
    expect(missingSigners(contract, [tablet("EMPLOYEE")])).toEqual(["EMPLOYER"]);
    expect(signingState(contract, [tablet("EMPLOYEE")])).toEqual({ state: "partial", missing: ["EMPLOYER"] });
  });
  it("podpis inej verzie (hash) sa nepocita", () => {
    expect(missingSigners(contract, [tablet("EMPLOYEE"), tablet("EMPLOYER", "b".repeat(64))])).toEqual(["EMPLOYER"]);
  });
  it("papierovy sken s oboma stranami = kompletne", () => {
    expect(missingSigners(contract, [paper("EMPLOYEE"), paper("EMPLOYER")])).toEqual([]);
  });
  it("bez podpisu = nepodpisane; SIGNED = podpisane", () => {
    expect(signingState(contract, []).state).toBe("unsigned");
    expect(signingState({ ...contract, status: "SIGNED" }, []).state).toBe("signed");
  });
});

describe("pisomnost § 334", async () => {
  const { isS334Document } = await import("./signingRules.js");
  it("mzdovy vymer a jednostranne ukony zamestnavatela", () => {
    expect(isS334Document({ doc_type: "mzdovy_vymer" })).toBe(true);
    expect(isS334Document({ doc_type: "zruseni_ve_zkusebni_dobe" })).toBe(true);
    expect(isS334Document({ doc_type: "pracovni_smlouva" })).toBe(false);
    expect(isS334Document({ doc_type: "other", legal_act_type: "EMPLOYER_UNILATERAL" })).toBe(true);
  });
});
