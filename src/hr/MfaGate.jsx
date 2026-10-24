// Dvojfazove prihlasenie do Personalistiky (migracia 67): pre profily s
// povinnym MFA DB bez overenia kodom (aal2) nevrati ziadne opravnenia.
// Prve prihlasenie = registracia autentifikacnej aplikacie (QR kod), dalsie =
// len kod z aplikacie. TOTP cez Supabase Auth, bez poplatkov.
import React, { useState, useEffect } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "../supabaseClient.js";

export default function MfaGate({ onVerified }) {
  const [factor, setFactor] = useState(null); // { id, enrolling, qr, secret }
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: lErr } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (lErr) { setError("Nepodařilo se načíst ověření."); return; }
      const verified = (data?.totp || [])[0];
      if (verified) { setFactor({ id: verified.id, enrolling: false }); return; }
      // nedokoncena registracia z predchadzajuceho pokusu sa zahodi
      for (const f of (data?.all || []).filter((x) => x.factor_type === "totp" && x.status !== "verified")) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: en, error: eErr } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Stenger HR ${new Date().toISOString().slice(0, 10)}` });
      if (cancelled) return;
      if (eErr) { setError("Registrace ověřovací aplikace se nezdařila."); return; }
      setFactor({ id: en.id, enrolling: true, qr: en.totp.qr_code, secret: en.totp.secret });
    })();
    return () => { cancelled = true; };
  }, []);

  async function verify(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    setBusy(false);
    if (vErr) { setError("Kód nesouhlasí nebo vypršel. Zadejte aktuální kód z aplikace."); setCode(""); return; }
    onVerified();
  }

  if (!factor && !error) return <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám ověření...</div>;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-md mx-auto" data-testid="mfa-gate">
      <div className="flex items-center gap-2 font-semibold mb-2"><ShieldCheck size={18} className="text-teal-700" /> Dvoufázové ověření</div>
      {factor?.enrolling ? (
        <>
          <p className="text-sm text-slate-600 mb-3">
            Personalistika obsahuje citlivé údaje, proto je při přihlášení nutný i kód z ověřovací aplikace v telefonu
            (např. Google Authenticator nebo Microsoft Authenticator – zdarma). Naskenujte QR kód aplikací a opište zobrazený šestimístný kód.
          </p>
          {factor.qr && <img src={factor.qr} alt="QR kód pro ověřovací aplikaci" className="w-44 h-44 mx-auto mb-2" />}
          <div className="text-xs text-slate-500 text-center mb-4">Nelze skenovat? Zadejte do aplikace klíč: <code className="font-mono break-all" data-testid="mfa-secret">{factor.secret}</code></div>
        </>
      ) : (
        factor && <p className="text-sm text-slate-600 mb-3">Zadejte šestimístný kód z ověřovací aplikace v telefonu.</p>
      )}
      {factor && (
        <form onSubmit={verify} className="flex gap-2">
          <label className="sr-only" htmlFor="mfa-code">Kód z aplikace</label>
          <input id="mfa-code" aria-label="Kód z aplikace" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="border border-slate-300 rounded-md px-3 py-2 text-lg tracking-widest w-36" autoFocus />
          <button type="submit" disabled={busy || code.length !== 6} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">Ověřit</button>
        </form>
      )}
      {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mt-3">{error}</div>}
      <div className="text-xs text-slate-400 mt-4">Ztracený telefon? Požádejte správce systému o zrušení ověření – po novém přihlášení si aplikaci zaregistrujete znovu.</div>
    </div>
  );
}
