// Ostre PDA rozhranie (?pda=1): prihlasenie existujucim uctom (Sklad) a
// PdaMain nad Supabase. Testovaci rezim (?pda=test) je v PdaTestMode.jsx
// a tento subor (ani Supabase API) vobec nepouziva.

import React, { useMemo, useEffect, lazy } from "react";
import { Loader2, AlertCircle, LogOut } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { useAuth } from "../lib/auth.js";
import Login from "../Login.jsx";
import { createSupabasePdaApi } from "./pdaApi.js";
import { PdaApiContext, PdaMain } from "./PdaMobileView.jsx";

// Prijem tovaru je ten isty ako v Stenger ONE (sken etikiet, dodak fotkou,
// kontroly) - nacita sa az po kliknuti.
const PrijemTab = lazy(() => import("../SkladView.jsx").then((m) => ({ default: m.PrijemTab })));

// Ikona na ploche Zebry (PWA): manifest len pre ?pda=1, aby "Pridat na plochu"
// otvaralo rovno PDA na celu obrazovku.
function usePdaManifest() {
  useEffect(() => {
    if (document.querySelector('link[rel="manifest"]')) return;
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = `${import.meta.env.BASE_URL}pda.webmanifest`;
    document.head.appendChild(link);
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#0f172a";
    document.head.appendChild(meta);
  }, []);
}

const FONT = { fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" };

export default function PdaApp() {
  const { loading, session, profile, profileError, signIn, signOut } = useAuth();
  usePdaManifest();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500" style={FONT}><Loader2 className="animate-spin mr-2" size={20} /> Načítám...</div>;
  }
  if (!session) return <Login onSignIn={signIn} />;
  const role = profile && profile.role;
  if (profileError || (role !== "sklad" && role !== "office")) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 text-center text-slate-600" style={FONT}>
        <AlertCircle size={24} className="text-red-500" />
        <p className="max-w-sm text-sm">{profileError || "Tento účet nemá přístup k PDA / Expedici."}</p>
        <button onClick={signOut} className="flex items-center gap-1.5 text-sm text-teal-700"><LogOut size={14} /> Odhlásit</button>
      </div>
    );
  }
  return <PdaWithSupabase onSignOut={signOut} />;
}

function PdaWithSupabase({ onSignOut }) {
  const api = useMemo(() => createSupabasePdaApi(supabase), []);
  return (
    <PdaApiContext.Provider value={api}>
      <PdaMain onSignOut={onSignOut} Prijem={PrijemTab} />
    </PdaApiContext.Provider>
  );
}
