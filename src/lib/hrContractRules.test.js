import { describe, it, expect } from "vitest";
import { addMonthsIso, computeFixedTermStatus, canProposeExtension, FIXED_TERM_RULES } from "./hrContractRules.js";

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
});

describe("canProposeExtension", () => {
  it("je alias/wrapper okolo computeFixedTermStatus pre navrhovany novy koniec", () => {
    const result = canProposeExtension({ startDate: "2024-01-01", proposedEndDate: "2024-06-01", events: [] });
    expect(result.withinLimits).toBe(true);
  });
});
