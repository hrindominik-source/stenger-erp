// Dvojfazove prihlasenie do Personalistiky (migracia 67, obnova 69): pre
// profily s povinnym MFA DB bez overenia kodom (aal2) nevrati ziadne opravnenia.
// Prve prihlasenie = registracia autentifikacnej aplikacie (QR kod) a zalozne
// kody (zobrazia sa raz), dalsie = kod z aplikacie alebo zalozny kod.
// TOTP cez Supabase Auth, bez poplatkov.
import React, { useState, useEffect } from "react";
import { Loader2, ShieldCheck, Printer } from "lucide-react";
import { supabase } from "../supabaseClient.js";

async function invokeMfa(body) {
  const { data, error } = await supabase.functions.invoke("hr-mfa", { body });
  if (!error) return data;
  let message = "Akce se nezdařila.";
  try { message = (await error.context.json()).error || message; } catch { /* odpoved bez JSON */ }
  throw new Error(message);
}

export default function MfaGate({ onVerified }) {
  const [factor, setFactor] = useState(null); // { id, enrolling, qr, secret }
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState(null); // zalozne kody po registracii
  const [saved, setSaved] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [round, setRound] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFactor(null);
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
  }, [round]);

  async function verify(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    if (vErr) { setBusy(false); setError("Kód nesouhlasí nebo vypršel. Zadejte aktuální kód z aplikace."); setCode(""); return; }
    if (!factor.enrolling) { setBusy(false); onVerified(); return; }
    // nova registracia -> zalozne kody (stare tym prestanu platit)
    const { data: list, error: cErr } = await supabase.rpc("hr_mfa_generate_recovery_codes");
    setBusy(false);
    if (cErr || !list?.length) { setError("Ověření proběhlo, ale záložní kódy se nepodařilo vytvořit. Obnovte stránku."); return; }
    setCodes(list);
  }

  async function useRecovery(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await invokeMfa({ action: "use_recovery_code", code: recoveryCode });
      setRecovery(false);
      setRecoveryCode("");
      setCode("");
      setRound((r) => r + 1); // nova registracia aplikacie
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-md mx-auto" data-testid="mfa-recovery-codes">
        <div className="flex items-center gap-2 font-semibold mb-2"><ShieldCheck size={18} className="text-teal-700" /> Záložní kódy</div>
        <p className="text-sm text-slate-600 mb-3">
          Pokud ztratíte telefon, přihlásíte se jedním z těchto kódů. Každý kód platí jen jednou.
          <b> Vytiskněte je nebo si je uložte na bezpečné místo mimo telefon – znovu se nezobrazí.</b>
        </p>
        <ol className="grid grid-cols-2 gap-1 font-mono text-sm bg-slate-50 border border-slate-200 rounded-md p-3 mb-3 list-none">
          {codes.map((c) => <li key={c} data-testid="mfa-recovery-code">{c}</li>)}
        </ol>
        <button type="button" onClick={() => window.print()} className="flex items-center gap-1.5 text-sm text-teal-700 hover:text-teal-900 mb-3"><Printer size={15} /> Vytisknout</button>
        <label className="flex items-start gap-2 text-sm text-slate-700 mb-3">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5" />
          Záložní kódy jsem si vytiskl(a) nebo bezpečně uložil(a).
        </label>
        <button type="button" disabled={!saved} onClick={onVerified} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">Pokračovat</button>
      </div>
    );
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
        factor && !recovery && <p className="text-sm text-slate-600 mb-3">Zadejte šestimístný kód z ověřovací aplikace v telefonu.</p>
      )}
      {factor && !recovery && (
        <form onSubmit={verify} className="flex gap-2">
          <label className="sr-only" htmlFor="mfa-code">Kód z aplikace</label>
          <input id="mfa-code" aria-label="Kód z aplikace" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="border border-slate-300 rounded-md px-3 py-2 text-lg tracking-widest w-36" autoFocus />
          <button type="submit" disabled={busy || code.length !== 6} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">Ověřit</button>
        </form>
      )}
      {factor && !factor.enrolling && !recovery && (
        <button type="button" onClick={() => { setRecovery(true); setError(""); }} className="text-xs text-teal-700 hover:text-teal-900 mt-3">Nemám telefon – použít záložní kód</button>
      )}
      {recovery && (
        <form onSubmit={useRecovery}>
          <p className="text-sm text-slate-600 mb-2">Zadejte jeden ze záložních kódů. Ověřovací aplikace se tím zruší a hned si zaregistrujete novou (dostanete i nové záložní kódy). Jednatel dostane upozornění.</p>
          <div className="flex gap-2">
            <input aria-label="Záložní kód" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} autoComplete="off"
              className="border border-slate-300 rounded-md px-3 py-2 font-mono uppercase w-44" autoFocus />
            <button type="submit" disabled={busy || !recoveryCode.trim()} className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md">Použít</button>
          </div>
          <button type="button" onClick={() => { setRecovery(false); setError(""); }} className="text-xs text-slate-500 mt-2">Zpět na kód z aplikace</button>
        </form>
      )}
      {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mt-3">{error}</div>}
      <div className="text-xs text-slate-400 mt-4">Ztracený telefon i záložní kódy? Personalistce a externí účetní ověření zruší jednatel, jednateli IT.</div>
    </div>
  );
}
