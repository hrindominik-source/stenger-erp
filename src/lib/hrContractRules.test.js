import { describe, it, expect } from "vitest";
import { addMonthsIso, computeFixedTermStatus, canProposeExtension, FIXED_TERM_RULES, sortContractEventsChronologically, shouldMarkEmployeeInactive } from "./hrContractRules.js";

describe("addMonthsIso", () => {
  it("prida mesiace k datumu", () => {
    expect(addMonthsIso("2024-03-01", 4)).toBe("2024-07-01");
  });
  it("spravne prejde cez koniec roka", () => {
    expect(addMonthsIso("2024-11-15", 3)).toBe("2025-02-15");
  });
  it("vrati null bez vstupu", () => {
    expect(addMonthsIso("", 4)).toBe(null);
    expect(addMonthsIso(null, 4)).toBe(null);
  });
});

describe("computeFixedTermStatus", () => {
  it("bez ziadnej udalosti je v poriadku, s 2 zostavajucimi predlzeniami", () => {
    const status = computeFixedTermStatus({ startDate: "2024-03-01", currentEndDate: "2025-02-28", events: [] });
    expect(status.extensionsCount).toBe(0);
    expect(status.remainingExtensions).toBe(2);
    expect(status.overExtensionLimit).toBe(false);
    expect(status.overDurationLimit).toBe(false);
    expect(status.withinLimits).toBe(true);
  });

  it("spocita pocet EXTENDED udalosti, ignoruje ine typy", () => {
    const events = [
      { event_type: "CREATED" },
      { event_type: "EXTENDED" },
      { event_type: "EXTENDED" },
    ];
    const status = computeFixedTermStatus({ startDate: "2022-01-01", currentEndDate: "2024-12-31", events });
    expect(status.extensionsCount).toBe(2);
    expect(status.remainingExtensions).toBe(0);
    expect(status.overExtensionLimit).toBe(true);
    expect(status.withinLimits).toBe(false);
  });

  it("oznaci prekrocenie 3-rocneho limitu od nastupu", () => {
    const status = computeFixedTermStatus({ startDate: "2022-01-01", currentEndDate: "2025-06-01", events: [] });
    expect(status.maxAllowedEndDate).toBe("2025-01-01");
    expect(status.overDurationLimit).toBe(true);
    expect(status.withinLimits).toBe(false);
  });

  it("presne na hranici 3 rokov este NEPRESAHUJE limit", () => {
    const status = computeFixedTermStatus({ startDate: "2022-01-01", currentEndDate: "2025-01-01", events: [] });
    expect(status.overDurationLimit).toBe(false);
  });

  it("zaznamena legalny override nezavisle od vypoctu limitov", () => {
    const events = [{ event_type: "EXTENDED" }, { event_type: "EXTENDED" }, { event_type: "EXTENDED", is_legal_override: true, override_reason: "vyjimka" }];
    const status = computeFixedTermStatus({ startDate: "2020-01-01", currentEndDate: "2024-01-01", events });
    expect(status.hasOverride).toBe(true);
    expect(status.overExtensionLimit).toBe(true);
    // override nemeni surovy vypocet limitu - len appka podla neho vie povolit vynimku
    expect(status.canExtendWithoutOverride).toBe(false);
  });

  it("respektuje volitelne vlastne pravidla namiesto default FIXED_TERM_RULES", () => {
    const status = computeFixedTermStatus({ startDate: "2024-01-01", currentEndDate: "2024-06-01", events: [{ event_type: "EXTENDED" }] }, { maxTotalMonths: 12, maxExtensions: 0 });
    expect(status.overExtensionLimit).toBe(true);
    expect(status.remainingExtensions).toBe(0);
  });

  it("FIXED_TERM_RULES ma ocakavane hodnoty podla ceskej legislativy", () => {
    expect(FIXED_TERM_RULES.maxTotalMonths).toBe(36);
    expect(FIXED_TERM_RULES.maxExtensions).toBe(2);
  });

  it("chybajuci startDate -> requiresReview=true a withinLimits=false (nikdy tiche 'v poriadku')", () => {
    const status = computeFixedTermStatus({ startDate: null, currentEndDate: "2025-01-01", events: [] });
    expect(status.requiresReview).toBe(true);
    expect(status.withinLimits).toBe(false);
    expect(status.maxAllowedEndDate).toBe(null);
  });

  it("bezny pripad so znamym startDate NEMA requiresReview", () => {
    const status = computeFixedTermStatus({ startDate: "2024-03-01", currentEndDate: "2025-02-28", events: [] });
    expect(status.requiresReview).toBe(false);
  });
});

describe("canProposeExtension", () => {
  it("je alias/wrapper okolo computeFixedTermStatus pre navrhovany novy koniec", () => {
    const result = canProposeExtension({ startDate: "2024-01-01", proposedEndDate: "2024-06-01", events: [] });
    expect(result.withinLimits).toBe(true);
  });
});

describe("sortContractEventsChronologically", () => {
  it("zoradi udalosti podla event_date vzostupne", () => {
    const events = [
      { event_type: "EXTENDED", event_date: "2025-06-01" },
      { event_type: "CREATED", event_date: "2024-01-01" },
      { event_type: "CONTRACT_SIGNED", event_date: "2024-06-01" },
    ];
    const sorted = sortContractEventsChronologically(events);
    expect(sorted.map((e) => e.event_type)).toEqual(["CREATED", "CONTRACT_SIGNED", "EXTENDED"]);
  });

  it("pri zhode event_date rozhoduje created_at (poradie zapisu v ramci jedneho dna)", () => {
    const events = [
      { event_type: "B", event_date: "2024-01-01", created_at: "2024-01-01T12:00:00Z" },
      { event_type: "A", event_date: "2024-01-01", created_at: "2024-01-01T09:00:00Z" },
    ];
    const sorted = sortContractEventsChronologically(events);
    expect(sorted.map((e) => e.event_type)).toEqual(["A", "B"]);
  });

  it("nemutuje povodne pole (vracia novu kopiu)", () => {
    const events = [{ event_type: "B", event_date: "2024-06-01" }, { event_type: "A", event_date: "2024-01-01" }];
    const original = [...events];
    sortContractEventsChronologically(events);
    expect(events).toEqual(original);
  });

  it("chybajuce event_date/created_at sa neroztrhne (radi ako prazdny retazec)", () => {
    const events = [{ event_type: "B", event_date: "2024-01-01" }, { event_type: "A" }];
    expect(() => sortContractEventsChronologically(events)).not.toThrow();
  });
});

describe("shouldMarkEmployeeInactive", () => {
  it("bez ziadneho zostavajuceho ACTIVE/PLANNED/NOTICE_PERIOD pracovneho pomeru -> true (byvaly zamestnanec)", () => {
    expect(shouldMarkEmployeeInactive(0)).toBe(true);
  });

  it("s aspon jednym zostavajucim pracovnym pomerom -> false (rehire ostava aktivny)", () => {
    expect(shouldMarkEmployeeInactive(1)).toBe(false);
    expect(shouldMarkEmployeeInactive(2)).toBe(false);
  });
});
