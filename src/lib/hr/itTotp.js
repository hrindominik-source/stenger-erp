// Len pre lokalne integracne a e2e testy (migracia 67 - povinne MFA pre
// profily Jednatel a Personalista): vypocet TOTP kodu (RFC 6238, SHA-1,
// 6 cislic, 30 s) a prihlasenie na uroven aal2 bez telefonu.
import crypto from "node:crypto";
import { Buffer } from "node:buffer";

function base32Decode(s) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret, time = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}

// Zmaze vsetky faktory pouzivatela (service role) - dalsie prihlasenie = nova registracia.
export async function resetMfa(service, email) {
  const { data, error } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`Uzivatel ${email} neexistuje.`);
  const { data: f, error: fErr } = await service.auth.admin.mfa.listFactors({ userId: user.id });
  if (fErr) throw fErr;
  for (const factor of f.factors || []) await service.auth.admin.mfa.deleteFactor({ id: factor.id, userId: user.id });
}

// Prihlasenie klienta na aal2: registracia TOTP a overenie vypocitanym kodom.
export async function signInAal2(client, service, email, password) {
  await resetMfa(service, email);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const { data: en, error: eErr } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `test-${Date.now()}` });
  if (eErr) throw eErr;
  const { error: vErr } = await client.auth.mfa.challengeAndVerify({ factorId: en.id, code: totp(en.totp.secret) });
  if (vErr) throw vErr;
}
