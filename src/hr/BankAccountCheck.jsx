// Zmena cisla uctu (migracia 78): oznacenie v mzdovych udajoch, kym zmenu
// nepotvrdi jednatel alebo uctovnicka. Zobrazuje sa len poslednych 4 cislic.
import React, { useState, useEffect, useCallback } from "react";
import { ShieldAlert } from "lucide-react";
import { supabase } from "../supabaseClient.js";

export const BANK_ACCOUNT_CHANGED_LABEL = "Účet změněn od poslední výplaty – ověřte";

// Potvrdzuje jednatel alebo uctovnicka (mzdovy pristup bez prava upravovat).
export function canConfirmBankAccount(permissions = []) {
  return permissions.includes("HR_ADMIN") || (permissions.includes("HR_VIEW_PAYROLL") && !permissions.includes("HR_EDIT"));
}

export default function BankAccountCheck({ employeeId, permissions }) {
  const [check, setCheck] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("hr_bank_account_checks").select("*").eq("employee_id", employeeId).maybeSingle();
    setCheck(data || null);
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  async function confirm() {
    setBusy(true); setError("");
    const { error: err } = await supabase.rpc("hr_bank_account_confirm", { p_employee_id: employeeId });
    setBusy(false);
    if (err) { setError(err.message); return; }
    load();
  }

  if (!check || check.confirmed_at) return null;
  return (
    <div className="bg-red-50 border border-red-300 rounded-lg px-3 py-2.5 mb-3 text-sm" data-testid="bank-account-check">
      <div className="font-semibold text-red-800 flex items-center gap-1.5"><ShieldAlert size={15} /> {BANK_ACCOUNT_CHANGED_LABEL}</div>
      <div className="text-xs text-red-800 mt-0.5">
        {check.last4 ? `Nový účet končí …${check.last4}` : "Účet byl odebrán"} · změnil: {check.changed_by_name} · {new Date(check.changed_at).toLocaleString("cs-CZ")}
      </div>
      <div className="text-xs text-slate-600 mt-1">Před výplatou ověřte změnu přímo u zaměstnance (ne odpovědí na e-mail nebo zprávu, ze které změna přišla).</div>
      {canConfirmBankAccount(permissions) && (
        <button type="button" disabled={busy} onClick={confirm} className="mt-2 text-xs bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-md">
          Ověřeno – potvrdit změnu účtu
        </button>
      )}
      {error && <div className="text-xs text-red-700 mt-1">{error}</div>}
    </div>
  );
}
