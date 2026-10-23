// Stav odovzdania / dorucenia dokumentu a lehoty (faza E). Len zobrazenie -
// pravidla vynucuje DB (hr_document_deliveries_guard, migracie 48 a 52).
// Lehoty su KONCEPT – KE SCHVÁLENÍ PRÁVNIČKOU.

export const S21_WITHDRAWAL_DAYS = 7; // § 21 odst. 2 ZP - odstoupeni od smlouvy uzavrene elektronicky
export const S335_FICTION_DAYS = 15; // § 335 - fikce doruceni / lhuta pro potvrzeni
export const S335_WARN_DAY = 10; // upozorneni HR pred koncem lhuty
export const MAX_SEND_ATTEMPTS = 3; // DB: hr_document_deliveries_attempts_check

export const DELIVERY_CHANNEL_LABELS = {
  IN_PERSON_PAPER: "osobně – papír",
  IN_PERSON_ELECTRONIC_COPY: "osobně – elektronická kopie",
  EMAIL_S21: "e-mail (§ 21)",
  EMAIL_S335_CONSENT: "e-mail se souhlasem (§ 335)",
  EMAIL_S335_WAGE_OTHER_ADDRESS: "e-mail na jinou adresu (§ 335 odst. 3)",
  DATA_BOX: "datová schránka",
  POST: "pošta",
};

export const DELIVERY_BASIS_LABELS = {
  SIGNED_RECEIPT: "podpis potvrzení převzetí",
  EMPLOYEE_CONFIRMATION: "potvrzení zaměstnance",
  FICTION_15_DAYS: "fikce – 15. den",
  DATA_BOX_LOGIN: "přihlášení do datové schránky",
  PROVIDER_DELIVERED_S21: "dodáno do schránky",
  HANDED_OVER: "předáno osobně",
};

const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
export const addDays = (iso, n) => { const d = new Date(day(iso) + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const czDate = (iso) => (iso ? day(iso).split("-").reverse().join(".") : "");
// Datum dodani do schranky (doklad od poskytovatele, zapisuje server - faza G).
const providerDeliveredAt = (dl) => dl?.provider_delivered_at || null;

// key: NOT_HANDED | SENT_UNCONFIRMED | DELIVERED | INEFFECTIVE | FAILED
export function deliveryState(dl) {
  if (!dl) return { key: "NOT_HANDED", label: "nepředáno" };
  if (dl.ineffective_at || dl.send_status === "BOUNCED") {
    return { key: "INEFFECTIVE", label: "neúčinné", reason: dl.ineffective_reason || (dl.send_status === "BOUNCED" ? "nedoručitelná zpráva" : null) };
  }
  if (dl.delivered_at) {
    return { key: "DELIVERED", label: `doručeno (${DELIVERY_BASIS_LABELS[dl.delivery_basis] || dl.delivery_basis})`, at: dl.delivered_at };
  }
  if (dl.send_status === "FAILED") {
    const left = Math.max(0, MAX_SEND_ATTEMPTS - (dl.attempts || 0));
    return { key: "FAILED", label: `odeslání selhalo – nedoručeno${left ? ` (zbývá pokusů: ${left})` : " – pokusy vyčerpány, předejte osobně"}`, reason: dl.send_error || null };
  }
  if (dl.send_status === "QUEUED") return { key: "SENT_UNCONFIRMED", label: "čeká na odeslání" };
  if (dl.channel?.startsWith("EMAIL") && providerDeliveredAt(dl)) return { key: "SENT_UNCONFIRMED", label: "odesláno – dodáno do schránky, doručení nepotvrzeno" };
  if (dl.channel?.startsWith("EMAIL") && dl.sent_at) return { key: "SENT_UNCONFIRMED", label: "odesláno – dodání neověřeno" };
  if (dl.sent_at || dl.queued_at || dl.send_status) return { key: "SENT_UNCONFIRMED", label: "odesláno – nepotvrzeno" };
  return { key: "NOT_HANDED", label: "nepředáno" };
}

// Lehoty k zobrazeni: [{ key, label, date, state: "running" | "warn" | "over" | "info" }]
export function deliveryDeadlines(dl, { today, startDate } = {}) {
  const out = [];
  if (!dl) return out;
  const status = (date, warnFrom) => (today && today > date ? "over" : warnFrom && today && today >= warnFrom ? "warn" : "running");
  if (dl.channel === "EMAIL_S21") {
    const from = day(dl.delivered_at) || day(providerDeliveredAt(dl));
    if (dl.withdrawal_received_at) {
      out.push({ key: "s21", label: `Odstoupení přijato ${czDate(dl.withdrawal_received_at)}`, state: "info" });
    } else if (from) {
      const date = day(dl.withdrawal_deadline) || addDays(from, S21_WITHDRAWAL_DAYS);
      const started = startDate && startDate <= date;
      out.push({
        key: "s21", date, state: status(date),
        label: `Lhůta k odstoupení (§ 21, ${S21_WITHDRAWAL_DAYS} dní od dodání) do ${czDate(date)}${started ? ` – jen do začátku plnění (nástup ${czDate(startDate)})` : ""}`,
      });
    } else if (dl.sent_at) {
      out.push({ key: "s21", label: "Lhůta k odstoupení (§ 21) neběží – dodání neověřeno", state: "info" });
    }
  }
  if (dl.channel === "EMAIL_S335_CONSENT" && !dl.delivered_at && !dl.ineffective_at) {
    const from = day(providerDeliveredAt(dl));
    if (from) {
      const date = addDays(from, S335_FICTION_DAYS);
      out.push({ key: "s335", date, state: status(date), label: `Fikce doručení (§ 335, ${S335_FICTION_DAYS}. den od dodání) ${czDate(date)}, pokud zaměstnanec nepotvrdí dříve` });
    } else if (dl.sent_at) {
      out.push({ key: "s335", label: "Fikce doručení (§ 335) neběží – chybí doklad o dodání", state: "info" });
    }
  }
  if (dl.channel === "EMAIL_S335_WAGE_OTHER_ADDRESS" && !dl.delivered_at && !dl.ineffective_at && dl.sent_at) {
    const date = addDays(dl.sent_at, S335_FICTION_DAYS);
    out.push({
      key: "s335-3", date, state: status(date, addDays(dl.sent_at, S335_WARN_DAY)),
      label: `Bez písemného potvrzení převzetí do ${czDate(date)} je doručení neúčinné – pak předat osobně`,
    });
  }
  return out;
}

// Souhrnny stav odovzdania dokumentu (vsetky zaznamy).
export function documentDeliveryState(deliveries = []) {
  if (!deliveries.length) return deliveryState(null);
  const delivered = deliveries.find((d) => deliveryState(d).key === "DELIVERED");
  if (delivered) return deliveryState(delivered);
  const latest = [...deliveries].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
  return deliveryState(latest);
}
