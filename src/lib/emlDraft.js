// Koncept e-mailu (.eml) s prilohami. mailto: odkaz prilohu pridat nevie;
// .eml s hlavickou "X-Unsent: 1" Outlook otvori ako novu neodoslanu spravu
// (adresat, predmet, text aj priloha) - staci kliknut Odoslat.

// Zoznam adries z textu oddeleneho ciarkou, bodkociarkou, medzerou alebo novym riadkom.
export function rozdelEmaily(text) {
  return String(text || "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
}

// Adresy pre Outlook: oddelene bodkociarkou (ciarku Outlook ako oddelovac nebere).
export function emailyPreOutlook(text) {
  return rozdelEmaily(text).join(";");
}

function b64FromBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64Utf8(text) {
  return b64FromBytes(new TextEncoder().encode(String(text ?? "")));
}

// riadky base64 max. 76 znakov (RFC 2045)
function wrap76(s) {
  return s.replace(/.{1,76}/g, "$&\r\n").replace(/\r\n$/, "");
}

// hlavicka s diakritikou (RFC 2047)
function headerWord(text) {
  const t = String(text ?? "");
  return /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${b64Utf8(t)}?=`;
}

// nazov suboru v hlavicke bez uvodzoviek a riadkovania
function safeName(name) {
  return String(name || "priloha").replace(/["\r\n\\]/g, "_");
}

// attachments: [{ filename, contentType, bytes (ArrayBuffer | Uint8Array) }]
export function buildEmlDraft({ to = "", cc = "", subject = "", body = "", attachments = [] }, boundary = "=_stenger_" + Date.now().toString(36)) {
  const kopia = rozdelEmaily(cc);
  const lines = [
    "MIME-Version: 1.0",
    "X-Unsent: 1",
    `To: ${rozdelEmaily(to).join(", ")}`,
    ...(kopia.length ? [`Cc: ${kopia.join(", ")}`] : []),
    `Subject: ${headerWord(subject)}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64Utf8(String(body).replace(/\r?\n/g, "\r\n"))),
  ];
  for (const a of attachments) {
    const name = safeName(a.filename);
    lines.push(
      "",
      `--${boundary}`,
      `Content-Type: ${a.contentType || "application/octet-stream"}; name="${headerWord(name)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${headerWord(name)}"`,
      "",
      wrap76(b64FromBytes(a.bytes)),
    );
  }
  lines.push("", `--${boundary}--`, "");
  return lines.join("\r\n");
}

export function downloadEmlDraft(filename, draft) {
  const blob = new Blob([buildEmlDraft(draft)], { type: "message/rfc822" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
