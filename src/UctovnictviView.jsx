import React from "react";
import { LogOut, ArrowLeft, Wallet } from "lucide-react";

export default function UctovnictviView({ fullName, onSignOut, onBack }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <header className="bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-slate-400 hover:text-white"><ArrowLeft size={20} /></button>
            <img src="/stenger-logo.png" alt="Stenger" className="h-10 w-auto" />
            <div>
              <div className="text-xs tracking-wider text-slate-400">Stenger Czech s.r.o.</div>
              <div className="text-lg font-semibold">Účetnictví</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-300">{fullName}</span>
            <button onClick={onSignOut} className="flex items-center gap-1.5 text-slate-300 hover:bg-slate-800 px-3 py-1.5 rounded-md text-sm">
              <LogOut size={16} /> Odhlásit
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-16 text-center">
        <span className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-400 to-sky-600 text-white shadow-lg mb-4">
          <Wallet size={30} />
        </span>
        <h1 className="text-xl font-semibold mb-2">Připravujeme</h1>
        <p className="text-sm text-slate-500 max-w-sm mx-auto">Tato sekce zatím není vyplněná. Řekněte, co konkrétně sem má přibýt, a rovnou to postavíme.</p>
      </main>
    </div>
  );
}
