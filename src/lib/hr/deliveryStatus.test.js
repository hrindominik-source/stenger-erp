import { describe, it, expect } from "vitest";
import { deliveryState, deliveryDeadlines, documentDeliveryState } from "./deliveryStatus.js";

describe("stav odovzdania", () => {
  it("bez zaznamu = nepredano", () => {
    expect(deliveryState(null).label).toBe("nepředáno");
    expect(documentDeliveryState([]).key).toBe("NOT_HANDED");
  });
  it("odoslany e-mail nie je doruceny", () => {
    expect(deliveryState({ channel: "EMAIL_S335_CONSENT", sent_at: "2026-10-01T10:00:00Z", send_status: "SENT" }).label).toBe("odesláno – nepotvrzeno");
  });
  it("dorucene s dovodom", () => {
    expect(deliveryState({ channel: "IN_PERSON_PAPER", delivered_at: "2026-10-01", delivery_basis: "HANDED_OVER" }).label).toBe("doručeno (předáno osobně)");
  });
  it("neucinne a bounce", () => {
    expect(deliveryState({ ineffective_at: "2026-10-16", ineffective_reason: "bez potvrzení" })).toMatchObject({ key: "INEFFECTIVE", reason: "bez potvrzení" });
    expect(deliveryState({ sent_at: "2026-10-01", send_status: "BOUNCED" }).key).toBe("INEFFECTIVE");
  });
  it("zlyhanie odoslania ostava otvorene (nie neucinne)", () => {
    expect(deliveryState({ send_status: "FAILED", send_error: "smtp" })).toMatchObject({ key: "FAILED", reason: "smtp" });
  });
  it("suhrn: dorucenie ma prednost pred neskorsim pokusom", () => {
    const s = documentDeliveryState([
      { created_at: "2026-10-01", delivered_at: "2026-10-01", delivery_basis: "SIGNED_RECEIPT" },
      { created_at: "2026-10-05", sent_at: "2026-10-05", send_status: "SENT" },
    ]);
    expect(s.key).toBe("DELIVERED");
  });
});

describe("lehoty", () => {
  it("§ 21: 7 dni od dodania, upozornenie na zaciatok plnenia", () => {
    const [d] = deliveryDeadlines({ channel: "EMAIL_S21", delivered_at: "2026-10-01T09:00:00Z", delivery_basis: "PROVIDER_DELIVERED_S21" }, { today: "2026-10-03", startDate: "2026-10-05" });
    expect(d).toMatchObject({ date: "2026-10-08", state: "running" });
    expect(d.label).toContain("nástup 05.10.2026");
  });
  it("§ 21: bez dokladu o dodani lehota nebezi", () => {
    expect(deliveryDeadlines({ channel: "EMAIL_S21", sent_at: "2026-10-01" })[0].label).toContain("neběží");
  });
  it("§ 335 suhlas: fikcia 15. den od dodania, nie od odoslania", () => {
    const [d] = deliveryDeadlines({ channel: "EMAIL_S335_CONSENT", sent_at: "2026-10-01", confirmation_evidence: { provider_delivered_at: "2026-10-02" } }, { today: "2026-10-20" });
    expect(d).toMatchObject({ date: "2026-10-17", state: "over" });
    expect(deliveryDeadlines({ channel: "EMAIL_S335_CONSENT", sent_at: "2026-10-01" })[0].label).toContain("chybí doklad");
  });
  it("§ 335 odst. 3 (ina adresa): neucinne po 15 dnoch, upozornenie od 10. dna", () => {
    const dl = { channel: "EMAIL_S335_WAGE_OTHER_ADDRESS", sent_at: "2026-10-01T08:00:00Z" };
    expect(deliveryDeadlines(dl, { today: "2026-10-05" })[0]).toMatchObject({ date: "2026-10-16", state: "running" });
    expect(deliveryDeadlines(dl, { today: "2026-10-11" })[0].state).toBe("warn");
    expect(deliveryDeadlines(dl, { today: "2026-10-17" })[0].state).toBe("over");
    expect(deliveryDeadlines({ ...dl, delivered_at: "2026-10-03", delivery_basis: "SIGNED_RECEIPT" }, { today: "2026-10-17" })).toEqual([]);
  });
  it("osobne odovzdanie nema lehoty", () => {
    expect(deliveryDeadlines({ channel: "IN_PERSON_PAPER", delivered_at: "2026-10-01", delivery_basis: "HANDED_OVER" })).toEqual([]);
  });
});
