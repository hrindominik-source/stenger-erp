// Kontrola pracovneho pomeru podla zakonnych parametrov (migracia 70, balik D).
// Vysledok pocita DB (hr_check_employment); BLOK = zakonny limit, ktory DB
// nepusti ani pri generovani a podpise dokumentu, UPOZORNENI = ostatne.
import React, { useState, useEffect } from "react";
import { AlertTriangle, Ban, Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient.js";

// Typy dokumentov, ktore DB pri generovani kontroluje (zhodne s triggerom).
export const LEGAL_CHECKED_DOC_TYPES = ["pracovni_smlouva", "pracovni_smlouva_cizinec", "mzdovy_vymer", "dodatek"];

export async function legalCheck(employmentId) {
  if (!employmentId) return { issues: [] };
  const { data, error } = await supabase.rpc("hr_check_employment", { p_employment_id: employmentId });
  if (error) throw new Error("Kontrolu podle zákonných parametrů se nepodařilo provést.");
  return data || { issues: [] };
}

// Pred nahranim suboru: zakonny limit = chyba so zoznamom dovodov.
export async function assertNoLegalBlocks(employmentId) {
  const blocks = ((await legalCheck(employmentId)).issues || []).filter((i) => i.level === "BLOCK");
  if (blocks.length) throw new Error("Zákonný limit – dokument nelze vytvořit: " + blocks.map((b) => b.message).join(" "));
}

export function LegalCheckPanel({ employmentId, refreshKey, onBlocks, title = "Kontrola podle zákonných parametrů" }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError("");
    legalCheck(employmentId)
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        onBlocks?.((r.issues || []).filter((i) => i.level === "BLOCK"));
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employmentId, refreshKey]);

  if (!employmentId) return null;
  if (error) return <div className="text-xs text-red-700 bg-red-50 px-3 py-2 rounded-md mb-2">{error}</div>;
  if (!result) return <div className="text-xs text-slate-400 mb-2 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Kontroluji zákonné limity…</div>;
  const issues = result.issues || [];
  if (issues.length === 0) return <div className="text-xs text-emerald-700 bg-emerald-50 px-3 py-2 rounded-md mb-2" data-testid="legal-check-ok">{title}: bez nálezů.</div>;
  return (
    <div className="mb-2 space-y-1" data-testid="legal-check">
      {issues.map((i, n) => (
        <div key={n} data-testid={i.level === "BLOCK" ? "legal-block" : "legal-warn"}
          className={"text-xs px-3 py-2 rounded-md flex items-start gap-1.5 " + (i.level === "BLOCK" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800")}>
          {i.level === "BLOCK" ? <Ban size={14} className="shrink-0 mt-px" /> : <AlertTriangle size={14} className="shrink-0 mt-px" />}
          <span>{i.level === "BLOCK" ? "Zákonný limit: " : ""}{i.message}</span>
        </div>
      ))}
      {issues.some((i) => i.level === "BLOCK") && (
        <div className="text-xs text-slate-500">Dokument nelze vygenerovat ani podepsat, dokud se údaje v kartě neopraví. Výjimku může schválit jen jednatel.</div>
      )}
    </div>
  );
}
