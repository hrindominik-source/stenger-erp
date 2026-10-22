import React, { useEffect, useState } from "react";

// Upozornenie na novu verziu aplikacie. Otvorena karta prehliadaca bezi so
// starym JS az do obnovenia - napr. dokumenty by sa generovali starym kodom.
// Porovnava hlavny skript (/assets/index-<hash>.js) s aktualnym index.html.
const CHECK_MS = 5 * 60 * 1000;

function currentScript() {
  const s = [...document.querySelectorAll('script[type="module"][src]')].find((x) => x.src.includes("/assets/"));
  return s ? new URL(s.src).pathname : null;
}

export default function UpdateBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const mine = currentScript();
    if (!mine) return undefined; // dev server - nic na porovnanie
    let alive = true;
    async function check() {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}index.html?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const html = await res.text();
        const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]+\/assets\/[^"]+\.js)"/);
        if (alive && m && new URL(m[1], window.location.href).pathname !== mine) setStale(true);
      } catch {
        // offline / docasna chyba - skusi sa pri dalsej kontrole
      }
    }
    const id = setInterval(check, CHECK_MS);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    check();
    return () => { alive = false; clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, []);
  if (!stale) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900 text-white text-sm rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 max-w-[calc(100vw-2rem)]">
      <span>Je k dispozici nová verze aplikace.</span>
      <button onClick={() => window.location.reload()} className="bg-teal-500 hover:bg-teal-400 text-slate-900 font-medium rounded-md px-3 py-1">Obnovit</button>
    </div>
  );
}
