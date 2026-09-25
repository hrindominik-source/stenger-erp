import { describe, it, expect } from "vitest";
import { formatDateForDoc, formatAddress, formatMoneyField, buildDocumentData, TEMPLATE_REQUIRED_KEYS, KNOWN_TEMPLATE_KEYS } from "./docxMapping.js";

describe("formatMoneyField", () => {
  it("hole cislo dostane priponu ',-' (ceska konvencia pre ciastku bez haleru)", () => {
    expect(formatMoneyField("155")).toBe("155,-");
    expect(formatMoneyField(155)).toBe("155,-");
  });
  it("hodnota uz s priponou ',-' sa neduplikuje", () => {
    expect(formatMoneyField("155,-")).toBe("155,-");
  });
  it("prazdna/chybajuca hodnota vrati prazdny retazec, nie ',-'", () => {
    expect(formatMoneyField("")).toBe("");
    expect(formatMoneyField(null)).toBe("");
    expect(formatMoneyField(undefined)).toBe("");
  });
});

describe("formatDateForDoc", () => {
  it("formatuje ISO datum na d.m.rrrr (bez 0-padding, presne podla MASTER_PROMPT)", () => {
    expect(formatDateForDoc("2026-03-05")).toBe("5.3.2026");
    expect(formatDateForDoc("2026-12-25")).toBe("25.12.2026");
  });
  it("prazdny/chybajuci vstup vrati prazdny retazec, nie 'Invalid Date'", () => {
    expect(formatDateForDoc(null)).toBe("");
    expect(formatDateForDoc(undefined)).toBe("");
    expect(formatDateForDoc("")).toBe("");
  });
});

describe("formatAddress", () => {
  it("zlozi adresu z jsonb tvaru na jeden riadok", () => {
    expect(formatAddress({ street: "Hlavní 12", zip: "60200", city: "Brno" })).toBe("Hlavní 12, 60200 Brno");
  });
  it("chybajuca/prazdna adresa vrati prazdny retazec, nie 'undefined, undefined'", () => {
    expect(formatAddress(null)).toBe("");
    expect(formatAddress({})).toBe("");
  });
  it("podporuje aj skutocny tvar pouzity v PersonalistikaModule.jsx ({ulice, mesto, psc})", () => {
    expect(formatAddress({ ulice: "Hlavní 12", psc: "60200", mesto: "Brno", stat: "ČR" })).toBe("Hlavní 12, 60200 Brno");
  });
});

describe("TEMPLATE_REQUIRED_KEYS - vsetky kluce su na allowliste", () => {
  it("kazdy povinny kluc kazdej sablony existuje v KNOWN_TEMPLATE_KEYS", () => {
    const known = new Set(KNOWN_TEMPLATE_KEYS);
    Object.entries(TEMPLATE_REQUIRED_KEYS).forEach(([template, keys]) => {
      keys.forEach((k) => expect(known.has(k), `${template}: ${k} chýba v allowliste`).toBe(true));
    });
  });
});

describe("buildDocumentData", () => {
  it("zostavi kompletny data objekt zo separovanych zdrojov (person/sensitive/documentFields)", () => {
    const person = {
      maiden_name: "Nováková", date_of_birth: "1990-03-05", place_of_birth: "Brno",
      permanent_address: { street: "Hlavní 12", zip: "60200", city: "Brno" },
      phone: "+420 777 123 456", private_email: "jana@example.cz",
    };
    const sensitive = { birth_number: "9003051234", id_document_number: "123456789", bank_account: "123456789/0800" };
    const documentFields = {
      cele_jmeno: "Jana Testovací", rodinny_stav: "svobodná", pojistovna: "111 - VZP",
      zarazeni: "Dělnice", druh_prace: "Balení", mzda_hod: "155", priplatek_noc: "15", priplatek_vikend: "20",
      datum: "2026-10-01", zastupce: "Ing. X", zastupce_pad7: "Ing. Xem",
    };
    const data = buildDocumentData({ person, sensitive, documentFields });
    expect(data.rodne_prijmeni).toBe("Nováková");
    expect(data.datum_narozeni).toBe("5.3.1990");
    expect(data.rodne_cislo).toBe("9003051234");
    expect(data.trvala_adresa).toBe("Hlavní 12, 60200 Brno");
    expect(data.ucet).toBe("123456789/0800");
    expect(data.datum).toBe("1.10.2026");
    expect(data.mzda_hod).toBe("155,-");
  });

  it("dorucovacia adresa padne spat na trvalu, ak nie je zadana zvlast", () => {
    const person = { permanent_address: { street: "A", city: "B", zip: "1" } };
    const data = buildDocumentData({ person, sensitive: {}, documentFields: {} });
    expect(data.dorucovaci_adresa).toBe(data.trvala_adresa);
  });

  it("chybajuce zdrojove udaje NIKDY nevytvoria 'undefined' v datach (vzdy prazdny retazec)", () => {
    const data = buildDocumentData({ person: null, sensitive: null, documentFields: {} });
    Object.values(data).forEach((v) => expect(v).not.toBe(undefined));
  });
});
