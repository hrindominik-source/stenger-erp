// Faza I: prohlaseni a pouceni pro existujiciho zamestnance (§ 21 oznameni,
// § 335 pouceni / souhlas / odvolani). PDF generuje server z aktualni verze
// textu (hr-declarations); podepisuje se beznym postupem v detailu dokumentu
// (tablet / papir). Po uplnem podpisu vznikne vyhlaseni v DB.
import React, { useState, useEffect, useCallback } from "react";
import { FileSignature } from "lucide-react";
import { supabase } from "../supabaseClient.js";

export async function invokeDeclarations(body) {
  const { data, error } = await supabase.functions.invoke("hr-declarations", { body });
  if (data) return data;
  const detail = error?.context ? await error.context.json().catch(() => null) : null;
  throw new Error(detail?.error || "Spojení se serverem se nezdařilo. Zkuste to znovu.");
}

const KINDS = [
  { kind: "S21", label: "Oznámení elektronické adresy (§ 21)" },
  { kind: "S335_NOTICE", label: "Poučení o elektronickém doručování (§ 335)" },
  { kind: "S335", label: "Souhlas s elektronickým doručováním (§ 335)" },
  { kind: "S335_REVOCATION", label: "Odvolání souhlasu (§ 335)" },
];

export default function DeclarationsPanel({ employee, onCreated, onCancel }) {
  const [state, setState] = useState(null); // { s21, s335, unrevokedConsent, s335Enabled }
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const [s21, s335, consents, setting] = await Promise.all([
      supabase.rpc("hr_valid_contact_declaration", { p_employee_id: employee.id, p_kind: "S21_ADDRESS_NOTICE" }),
      supabase.rpc("hr_valid_contact_declaration", { p_employee_id: employee.id, p_kind: "S335_CONSENT" }),
      supabase.from("employee_contact_declarations").select("id").eq("employee_id", employee.id).eq("kind", "S335_CONSENT").is("revoked_at", null),
      supabase.from("hr_settings").select("value").eq("key", "s335_consent_enabled").maybeSingle(),
    ]);
    setState({ s21: !!s21.data, s335: !!s335.data, unrevokedConsent: (consents.data || []).length > 0, s335Enabled: setting.data?.value === true });
  }, [employee.id]);
  useEffect(() => { load(); }, [load]);

  const email = employee.private_email ? String(employee.private_email).trim() : "";
  const reason = (kind) => {
    if (!state) return "Načítám…";
    if ((kind === "S21" || kind === "S335") && !email) return "Zaměstnanec nemá soukromý e-mail.";
    if ((kind === "S335" || kind === "S335_NOTICE") && !state.s335Enabled) return "Elektronické doručování § 335 je vypnuté (nastavení).";
    if (kind === "S335_REVOCATION" && !state.unrevokedConsent) return "Není platný souhlas k odvolání.";
    return "";
  };
  async function create(kind) {
    setBusy(kind);
    setError("");
    try {
      const r = await invokeDeclarations({ action: "create", employee_id: employee.id, kind });
      onCreated?.(r.document_id);
    } catch (e) { setError(e.message); }
    setBusy("");
  }

  return (
    <div className="border border-slate-200 rounded-md p-3 bg-slate-50 mb-3">
      <div className="font-medium text-sm mb-1">Prohlášení a poučení k elektronické komunikaci</div>
      <div className="text-xs text-slate-600 mb-2">
        Soukromý e-mail: <b>{email || "nevyplněn"}</b>
        {state && <> · § 21 oznámení: <b className={state.s21 ? "text-emerald-700" : "text-slate-600"}>{state.s21 ? "platné" : "chybí"}</b>
          {" "}· § 335 souhlas: <b className={state.s335 ? "text-emerald-700" : "text-slate-600"}>{state.s335 ? "platný" : "není"}</b></>}
      </div>
      <div className="text-xs text-slate-500 mb-2">Dokument se vytvoří z aktuální verze textu a podepíše se v detailu dokumentu (tablet za přítomnosti HR, nebo papír). Prohlášení začne platit až po podpisu; po změně e-mailu je třeba nové.</div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {KINDS.map(({ kind, label }) => {
          const r = reason(kind);
          return (
            <span key={kind} className="inline-flex flex-col">
              <button type="button" disabled={!!r || !!busy} onClick={() => create(kind)}
                className={"text-sm flex items-center gap-1 " + (r ? "text-slate-400 cursor-not-allowed" : "text-teal-700 hover:text-teal-900")}>
                <FileSignature size={14} /> {busy === kind ? "Vytvářím…" : label}
              </button>
              {r && <span className="text-[11px] text-slate-400 max-w-[16rem]">{r}</span>}
            </span>
          );
        })}
      </div>
      {error && <div className="text-xs text-red-700 mt-2">{error}</div>}
      <button type="button" onClick={onCancel} className="text-sm mt-2 text-slate-600">Zavřít</button>
    </div>
  );
}
