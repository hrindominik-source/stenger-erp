import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Eraser } from "lucide-react";

/* Podpisove pole (prst / stylus / mys). Kazdy dokument dostava NOVY podpis -
   komponent sa po podpise vymaze a obrazok sa nikdy neprenasa medzi
   dokumentmi (DB to navyse vynucuje unikatnostou obrazka). */
// Minimum bodov podpisu - rovnake pravidlo ako na serveri (validSignatureImage).
export const MIN_SIGNATURE_POINTS = 10;

// Preco je „Podepsat“ neaktivne (null = moze sa podpisat). nameConfirmed
// undefined = formular potvrdenie mena nema (kiosk).
export function signBlockedReason({ view, nameConfirmed, points }) {
  if (!view?.allViewed) {
    return view?.total ? `Projděte prosím celý dokument až na konec (zobrazeno ${view.pagesViewed?.length || 0} z ${view.total} stran).` : "Projděte prosím celý dokument až na konec.";
  }
  if (nameConfirmed === false) return "Potvrďte prosím jméno zaškrtnutím nahoře.";
  if (!points) return "Podepište se prosím do podpisového pole.";
  if (points < MIN_SIGNATURE_POINTS) return "Podpis je příliš krátký – podepište se prosím celým podpisem.";
  return null;
}

const SignaturePad = forwardRef(function SignaturePad({ onChange, height = 180 }, ref) {
  const canvas = useRef(null);
  const strokes = useRef([]);
  const drawing = useRef(false);
  const [points, setPoints] = useState(0);

  function ctx() {
    const c = canvas.current;
    const g = c.getContext("2d");
    g.lineWidth = 2.2 * (window.devicePixelRatio || 1);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#0f172a";
    return g;
  }
  function resize() {
    const c = canvas.current;
    if (!c) return;
    const r = window.devicePixelRatio || 1;
    c.width = c.clientWidth * r;
    c.height = height * r;
    redraw();
  }
  function redraw() {
    const c = canvas.current;
    const g = ctx();
    g.clearRect(0, 0, c.width, c.height);
    const r = window.devicePixelRatio || 1;
    for (const s of strokes.current) {
      g.beginPath();
      s.forEach(([x, y], i) => (i ? g.lineTo(x * r, y * r) : g.moveTo(x * r, y * r)));
      g.stroke();
    }
  }
  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pos(e) {
    const b = canvas.current.getBoundingClientRect();
    return [Math.round((e.clientX - b.left) * 10) / 10, Math.round((e.clientY - b.top) * 10) / 10];
  }
  function changed() {
    const n = strokes.current.reduce((a, s) => a + s.length, 0);
    setPoints(n);
    onChange?.({ empty: n < MIN_SIGNATURE_POINTS, points: n });
  }
  function down(e) {
    e.preventDefault();
    canvas.current.setPointerCapture(e.pointerId);
    drawing.current = true;
    strokes.current.push([pos(e)]);
  }
  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const s = strokes.current[strokes.current.length - 1];
    const p = pos(e);
    const r = window.devicePixelRatio || 1;
    const g = ctx();
    const [px, py] = s[s.length - 1];
    g.beginPath(); g.moveTo(px * r, py * r); g.lineTo(p[0] * r, p[1] * r); g.stroke();
    s.push(p);
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    changed();
  }
  function clear() {
    strokes.current = [];
    redraw();
    changed();
  }

  useImperativeHandle(ref, () => ({
    clear,
    isEmpty: () => strokes.current.reduce((a, s) => a + s.length, 0) < MIN_SIGNATURE_POINTS,
    getStrokes: () => strokes.current.map((s) => s.map((p) => [...p])),
    toPngBase64: () => canvas.current.toDataURL("image/png").split(",")[1],
  }));

  return (
    <div>
      <div className="relative border-2 border-dashed border-slate-300 rounded-lg bg-white">
        <canvas
          ref={canvas}
          style={{ width: "100%", height, touchAction: "none", display: "block" }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}
          aria-label="Podpisové pole"
        />
        {points === 0 && <div className="absolute inset-0 flex items-center justify-center text-slate-300 pointer-events-none text-lg">Podepište se zde</div>}
        <div className="absolute left-6 right-6 bottom-8 border-b border-slate-200 pointer-events-none" />
      </div>
      <button type="button" onClick={clear} className="mt-2 text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1"><Eraser size={14} /> Smazat podpis</button>
    </div>
  );
});
export default SignaturePad;
