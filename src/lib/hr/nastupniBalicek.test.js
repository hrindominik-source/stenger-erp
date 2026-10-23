import { describe, it, expect } from "vitest";
import { nastupChecklist, nastupSummary, nastupRelevant, registraceCssz } from "./nastupniBalicek.js";

const emp = { id: "e1", start_date: "2026-10-01", status: "ACTIVE" };
const byKey = (items) => Object.fromEntries(items.map((i) => [i.key, i]));

describe("nástupní balíček", () => {
  it("zobrazuje se jen krátce po nástupu", () => {
    expect(nastupRelevant(emp, "2026-10-14")).toBe(true);
    expect(nastupRelevant({ ...emp, start_date: "2026-11-01" }, "2026-10-14")).toBe(true);
    expect(nastupRelevant({ ...emp, start_date: "2026-01-01" }, "2026-10-14")).toBe(false);
    expect(nastupRelevant({ ...emp, status: "TERMINATED" }, "2026-10-14")).toBe(false);
  });
  it("prázdný balíček - vše chybí, přihlášky po lhůtě", () => {
    const items = nastupChecklist({ employment: emp, canPayroll: true, today: "2026-10-14" });
    const s = nastupSummary(items);
    expect(items.map((i) => i.key)).toEqual(["ps", "vymer", "napln", "skoleni", "dotaznik", "prohlaseni", "cssz", "zp"]);
    expect(s.missing).toBe(8);
    expect(s.overdue).toBe(true);
    expect(byKey(items).cssz.detail).toBe("podat do 09.10.2026");
  });
  it("stavy z dokumentů a agendy", () => {
    const items = nastupChecklist({
      employment: emp, canPayroll: true, today: "2026-10-05",
      documents: [
        { doc_type: "pracovni_smlouva_cizinec", status: "SIGNED", employment_id: "e1" },
        { doc_type: "platovy_vymer", status: "DRAFT", employment_id: "e1" },
        { doc_type: "vstupni_skoleni", status: "SIGNED", employment_id: "jiny" },
      ],
      agenda: [{ urad: "cssz", typ: "Přihláška", datum: "2026-10-02" }, { urad: "zp", typ: "Přihláška", datum: "2026-10-02" }, { urad: "zp", typ: "Odhláška", datum: "2026-10-03" }],
      timeline: [{ event_type: "JMHZ_EXPORT", event_date: "2026-09-28" }],
      payroll: { data: { prohlaseni_poplatnika: [{ rok: 2026 }] } },
    });
    const k = byKey(items);
    expect(k.ps.state).toBe("signed");
    expect(k.ps.detail).toBe("podepsáno – nepředáno");
    expect(k.vymer.state).toBe("created");
    expect(k.skoleni.state).toBe("missing");
    expect(k.dotaznik.state).toBe("done");
    expect(k.prohlaseni.state).toBe("done");
    expect(k.cssz.state).toBe("done");
    expect(k.zp.state).toBe("missing");
    expect(k.zp.overdue).toBe(false);
    expect(nastupSummary(items)).toMatchObject({ missing: 3, toSign: 1, notHanded: 1, done: false });
  });
  it("chybí / k podpisu / podepsáno – nepředáno / hotovo", () => {
    const docs = [
      { id: "ps", doc_type: "pracovni_smlouva", status: "SIGNED" },
      { id: "ps-old", doc_type: "pracovni_smlouva", status: "SUPERSEDED" },
      { id: "mv", doc_type: "mzdovy_vymer", status: "READY_FOR_SIGNATURE", locked_at: "2026-10-02" },
      { id: "nap", doc_type: "popis_pracovniho_mista", status: "SIGNED" },
      { id: "sk", doc_type: "vstupni_skoleni", status: "SIGNED" },
      { id: "dot", doc_type: "osobni_dotaznik", status: "SIGNED" },
    ];
    const k = byKey(nastupChecklist({
      employment: emp, canPayroll: true, today: "2026-10-05", documents: docs,
      deliveries: [{ hr_document_id: "ps", delivered_at: "2026-10-02" }, { hr_document_id: "nap", sent_at: "2026-10-02" }],
    }));
    expect([k.ps.state, k.ps.detail]).toEqual(["done", "podepsáno a předáno"]);
    expect([k.vymer.state, k.vymer.detail]).toEqual(["created", "k podpisu – čeká na další podpis"]);
    expect([k.napln.state, k.napln.detail]).toEqual(["signed", "podepsáno – nepředáno"]); // odoslane, nedorucene
    expect(k.skoleni.state).toBe("created"); // podpisane, ale bez evidencie skolenia
    expect([k.dotaznik.state, k.dotaznik.detail]).toEqual(["done", "podepsán (dotazník na tabletu)"]);
    const zrusena = byKey(nastupChecklist({ employment: emp, today: "2026-10-05", documents: [{ id: "x", doc_type: "pracovni_smlouva", status: "VOIDED" }] }));
    expect(zrusena.ps.state).toBe("missing");
  });
  it("bez mzdových práv bez výměru a prohlášení; nepodepisuje = hotovo", () => {
    expect(nastupChecklist({ employment: emp, canPayroll: false, today: "2026-10-05" }).map((i) => i.key)).toEqual(["ps", "napln", "skoleni", "dotaznik", "cssz", "zp"]);
    const k = byKey(nastupChecklist({ employment: emp, canPayroll: true, uplatnujeSlevy: false, today: "2026-10-05" }));
    expect(k.prohlaseni.state).toBe("done");
  });
  it("registrace ČSSZ dokončena až s OIČ i ID PPV", () => {
    expect(registraceCssz({ data: { oic: "123" } }, { data: {} }).done).toBe(false);
    const employee = { data: { oic: "1234567890" } };
    const employment = { ...emp, data: { id_ppv: "987" } };
    expect(registraceCssz(employee, employment).done).toBe(true);
    const k = byKey(nastupChecklist({ employee, employment, canPayroll: false, today: "2026-10-14" }));
    expect(k.cssz.state).toBe("done");
    expect(k.cssz.detail).toBe("registrace dokončena (OIČ + ID PPV)");
    expect(k.zp.state).toBe("missing");
  });
  it("školení: hotovo jen s podpisem a evidencí školení s úspěšným ověřením znalostí", () => {
    const run = (docs, trainings) => byKey(nastupChecklist({ employment: emp, today: "2026-10-05", documents: docs, trainings })).skoleni;
    const sk = { id: "sk", doc_type: "vstupni_skoleni", status: "READY_FOR_SIGNATURE" };
    expect(run([sk], []).detail).toBe("k podpisu – nejdřív doplňte evidenci školení");
    expect(run([{ ...sk, training_record_id: "t1" }], [{ id: "t1", knowledge_check_result: "PASSED" }]).detail).toBe("k podpisu");
    expect(run([{ ...sk, status: "SIGNED" }], []).detail).toBe("podepsáno bez evidence školení a ověření znalostí");
    expect(run([{ ...sk, status: "SIGNED", training_record_id: "t1" }], [{ id: "t1", knowledge_check_result: "FAILED" }]).state).toBe("created");
    expect(run([{ ...sk, status: "SIGNED", training_record_id: "t1" }], [{ id: "t1", knowledge_check_result: "PASSED" }]))
      .toMatchObject({ state: "done", detail: "podepsáno, znalosti ověřeny" });
  });
});
