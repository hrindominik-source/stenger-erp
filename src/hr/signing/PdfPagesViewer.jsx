import React, { useEffect, useRef, useState } from "react";
import { Loader2, Eye } from "lucide-react";
import { loadPdfjs } from "../../lib/hr/finalPdf.js";

/* Zobrazenie CELEHO finalneho PDF pred podpisom (faza D/F). Kazda strana sa
   vykresli pod seba na sirku okna (bez vodorovneho posuvnika). Strana sa
   povazuje za zobrazenu, ked sa jej spodny okraj objavil vo viditelnej casti
   (funguje pri lubovolnej vyske strany aj okna). Rodic dostane zoznam
   zobrazenych stran (dokaz pre server) a priznak, ze boli zobrazene vsetky -
   az potom smie povolit podpis. */
export default function PdfPagesViewer({ bytes, onViewedChange }) {
  const box = useRef(null);
  const holder = useRef(null);
  const [state, setState] = useState({ loading: true, error: "", pages: 0 });
  const [viewed, setViewed] = useState(() => new Set());
  const cb = useRef(onViewedChange);
  cb.current = onViewedChange;

  useEffect(() => {
    let cancelled = false;
    let doc = null;
    const scroller = box.current;
    // viditelna cast = prienik prehliadaca PDF a okna prehliadaca
    const check = () => {
      if (cancelled || !holder.current) return;
      const b = scroller.getBoundingClientRect();
      const top = Math.max(b.top, 0);
      const bottom = Math.min(b.bottom, window.innerHeight || document.documentElement.clientHeight);
      const hit = [];
      for (const wrap of holder.current.querySelectorAll("[data-page][data-rendered=true]")) {
        const end = wrap.getBoundingClientRect().bottom;
        if (end <= bottom + 2 && end >= top - 2) hit.push(Number(wrap.dataset.page));
      }
      if (hit.length) setViewed((prev) => (hit.every((p) => prev.has(p)) ? prev : new Set([...prev, ...hit])));
    };
    scroller.addEventListener("scroll", check, { passive: true });
    window.addEventListener("scroll", check, { passive: true, capture: true });
    window.addEventListener("resize", check);
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
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          // sirka podla kontajnera (CSS), vyska podla pomeru strany
          canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
          canvas.className = "block w-full h-auto box-border bg-white shadow-sm border border-slate-200";
          const wrap = document.createElement("div");
          wrap.dataset.page = String(i);
          wrap.className = "mb-3 mx-auto max-w-[900px]";
          const label = document.createElement("div");
          label.className = "text-xs text-slate-400 text-center mb-1";
          label.textContent = `Strana ${i} z ${doc.numPages}`;
          wrap.append(label, canvas);
          el.append(wrap);
          // nepriehladne biele platno - priehladne pozadie by sa citalo/zobrazilo ako cierne
          const ctx = canvas.getContext("2d", { alpha: false });
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport, background: "#ffffff" }).promise;
          wrap.dataset.rendered = "true";
          check();
        }
        setState({ loading: false, error: "", pages: doc.numPages });
        check();
      } catch (e) {
        console.error(e);
        if (!cancelled) setState({ loading: false, error: "Dokument se nepodařilo zobrazit.", pages: 0 });
      }
    })();
    return () => {
      cancelled = true;
      scroller.removeEventListener("scroll", check);
      window.removeEventListener("scroll", check, { capture: true });
      window.removeEventListener("resize", check);
      doc?.destroy?.();
    };
  }, [bytes]);

  useEffect(() => {
    if (!state.pages) return;
    const list = [...viewed].sort((a, b) => a - b);
    cb.current?.({ pagesViewed: list, total: state.pages, allViewed: list.length === state.pages });
  }, [viewed, state.pages]);

  return (
    <div>
      <div ref={box} data-pdf-scroll className="max-h-[65vh] overflow-y-auto overflow-x-hidden bg-slate-100 rounded-lg p-3 border border-slate-200">
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
