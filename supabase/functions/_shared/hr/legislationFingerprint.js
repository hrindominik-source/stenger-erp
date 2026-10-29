// Odtlacok obsahu zdroja legislativy (migracia 74, hr-legislativa).
// JSON sa porovnava v kanonickom tvare (poradie klucov nehra rolu), iny
// obsah ako text. Pouziva server (Deno) aj testy (vitest).
export function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}

export function normalizeForFingerprint(body, contentType = "") {
  if (String(contentType).includes("json")) {
    try { return JSON.stringify(canonical(JSON.parse(body))); } catch { /* nie je JSON - porovna sa text */ }
  }
  return body;
}

export async function fingerprint(body, contentType = "") {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeForFingerprint(body, contentType)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
