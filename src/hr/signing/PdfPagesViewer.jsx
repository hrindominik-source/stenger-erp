import React, { useEffect, useRef, useState } from "react";
import { Loader2, Eye } from "lucide-react";
import { loadPdfjs } from "../../lib/hr/finalPdf.js";

/* Zobrazenie CELEHO finalneho PDF pred podpisom (faza D/F). Kazda strana sa
   vykresli pod seba; strana sa povazuje za zobrazenu, ked bola aspon na 60 %
   viditelna. Rodic dostane zoznam zobrazenych stran (dokaz pre server) a
   priznak, ze boli zobrazene vsetky - az potom smie povolit podpis. */
export default function PdfPagesViewer({ bytes, onViewedChange }) {
  const holder = useRef(null);
  const [state, setState] = useState({ loading: true, error: "", pages: 0 });
  const [viewed, setViewed] = useState(() => new Set());
  const cb = useRef(onViewedChange);
  cb.current = onViewedChange;

  useEffect(() => {
    let cancelled = false;
    let observer = null;
    let doc = null;
    setViewed(new Set());
    setState({ loading: true, error: "", pages: 0 });
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
        if (cancelled) return;
        const el = holder.current;
        el.innerHTML = "";
        const width = Math.min(el.clientWidth || 700, 900);
        const ratio = window.devicePixelRatio || 1;
        observer = new IntersectionObserver((entries) => {
          const hit = entries.filter((e) => e.intersectionRatio >= 0.6).map((e) => Number(e.target.dataset.page));
          if (hit.length) setViewed((prev) => { const n = new Set(prev); hit.forEach((p) => n.add(p)); return n; });
        }, { threshold: [0.6] });
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width / ratio}px`;
          canvas.style.height = `${viewport.height / ratio}px`;
          canvas.className = "block mx-auto bg-white shadow-sm border border-slate-200";
          const wrap = document.createElement("div");
          wrap.dataset.page = String(i);
          wrap.className = "mb-3";
          const label = document.createElement("div");
          label.className = "text-xs text-slate-400 text-center mb-1";
          label.textContent = `Strana ${i} z ${doc.numPages}`;
          wrap.append(label, canvas);
          el.append(wrap);
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
          observer.observe(wrap);
        }
        setState({ loading: false, error: "", pages: doc.numPages });
      } catch (e) {
        console.error(e);
        if (!cancelled) setState({ loading: false, error: "Dokument se nepodařilo zobrazit.", pages: 0 });
      }
    })();
    return () => { cancelled = true; observer?.disconnect(); doc?.destroy?.(); };
  }, [bytes]);

  useEffect(() => {
    if (!state.pages) return;
    const list = [...viewed].sort((a, b) => a - b);
    cb.current?.({ pagesViewed: list, total: state.pages, allViewed: list.length === state.pages });
  }, [viewed, state.pages]);

  return (
    <div>
      <div className="max-h-[65vh] overflow-y-auto bg-slate-100 rounded-lg p-3 border border-slate-200">
        {state.loading && <div className="text-center text-slate-400 py-10"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Načítám dokument…</div>}
        {state.error && <div className="text-red-700 text-sm">{state.error}</div>}
        <div ref={holder} />
      </div>
      {state.pages > 0 && (
        <div className={"text-sm mt-2 flex items-center gap-1.5 " + (viewed.size === state.pages ? "text-emerald-700" : "text-slate-500")}>
          <Eye size={15} /> Zobrazeno {viewed.size} z {state.pages} stran
          {viewed.size < state.pages && " – projděte prosím celý dokument až na konec."}
        </div>
      )}
    </div>
  );
}
