// Spolocne casti textov e-mailov zamestnancovi (hrMail.ts): oslovenie menom,
// tvar slovesa podla pohlavia a podpis. Texty su KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.

// 5. pad (vokativ) priezviska muza - len bezne, spolahlive vzory. Ked si nie
// sme isti, vrati null a oslovenie bude bez mena (radsej nic nez zly tvar).
export function vokativPriezviskaMuz(priezvisko) {
  const p = String(priezvisko || "").trim();
  if (!p || /\s|-/.test(p)) return null; // dvojite priezviska - nevieme spolahlivo
  if (/[ýí]$/i.test(p)) return p; // Černý, Krejčí - pridavne mena sa nemenia
  if (/[^aeiouyáéíóúůý]a$/i.test(p)) return p.slice(0, -1) + "o"; // Svoboda -> Svobodo
  if (/[^aeiouyáéíóúůý]ek$/i.test(p)) return p.slice(0, -2) + "ku"; // Marek -> Marku, Hájek -> Hájku
  if (/(k|h|g|ch)$/i.test(p)) return p + "u"; // Novák -> Nováku, Vích -> Víchu
  return null;
}

// Oslovenie na zaciatku e-mailu. employee: { last_name, gender: "muz" | "zena" }
export function osloveni(employee) {
  const e = employee || {};
  const priezvisko = String(e.last_name || "").trim();
  if (e.gender === "zena") return priezvisko ? `Vážená paní ${priezvisko},` : "Vážená paní,";
  if (e.gender === "muz") {
    const v = vokativPriezviskaMuz(priezvisko);
    return v ? `Vážený pane ${v},` : "Vážený pane,";
  }
  return "Dobrý den,";
}

// Tvar minuleho casu podla pohlavia: rod({gender:"zena"}, "oznámil", "oznámila").
export function rod(employee, muz, zena) {
  const g = employee && employee.gender;
  if (g === "muz") return muz;
  if (g === "zena") return zena;
  return `${muz}(a)`;
}

export const PODPIS = "S pozdravem\n\nStenger Czech s.r.o.\npersonální oddělení\n\nS dotazy se na nás obraťte odpovědí na tento e-mail.";
