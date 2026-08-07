// Kurz CZK je vzdy 1 (interna mena firmy). Pre ine meny sa pyta Edge Function
// "cnb-rate" (proxy k CNB API, ktore nema CORS hlavicky - viac v supabase/functions/cnb-rate).
export async function getCnbRate(dateDdMmYyyy, currencyCode, supabaseUrl, anonKey) {
  const currency = (currencyCode || "CZK").toUpperCase();
  if (currency === "CZK") return { rate: 1, currencyCode: "CZK", validFor: dateDdMmYyyy };

  const m = String(dateDdMmYyyy || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) throw new Error("Neplatny datum faktury pre zistenie kurzu.");
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;

  const res = await fetch(`${supabaseUrl}/functions/v1/cnb-rate?date=${iso}&currency=${currency}`, {
    headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Nepodarilo sa zistit kurz CNB.");
  return data;
}
