// Odhlasenie / ukoncenie pri necinnosti (rozhodnutie jednatela k auditu
// Personalistiky): Personalistika 15 min, kiosk a podpis na tablete 5 min.
// Necinnost = ziadna klavesa, klik, dotyk, posun ani pohyb mysi. Minutu pred
// koncom vrati warning = true (upozornenie na obrazovke).
import { useEffect, useRef, useState } from "react";

export const IDLE_HR_MS = 15 * 60_000;
export const IDLE_DEVICE_MS = 5 * 60_000;
const WARN_MS = 60_000;
// sessionStorage: prihlasovacia obrazovka po odhlaseni vysvetli preco
export const IDLE_LOGOUT_FLAG = "stenger.idleLogout";
const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"];

export function useIdleTimeout(ms, onIdle, { enabled = true } = {}) {
  const [warning, setWarning] = useState(false);
  const last = useRef(Date.now());
  const callback = useRef(onIdle);
  callback.current = onIdle;

  useEffect(() => {
    if (!enabled) { setWarning(false); return undefined; }
    last.current = Date.now();
    setWarning(false);
    const bump = () => { last.current = Date.now(); setWarning(false); };
    EVENTS.forEach((e) => window.addEventListener(e, bump, { passive: true, capture: true }));
    const timer = setInterval(() => {
      const idle = Date.now() - last.current;
      if (idle >= ms) {
        clearInterval(timer);
        setWarning(false);
        callback.current();
      } else {
        setWarning(idle >= ms - WARN_MS);
      }
    }, 1000);
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, bump, { capture: true }));
      clearInterval(timer);
    };
  }, [ms, enabled]);

  return warning;
}

export function IdleWarning({ text }) {
  return (
    <div role="alert" data-testid="idle-warning"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-amber-100 border border-amber-300 text-amber-900 text-sm px-4 py-2 rounded-lg shadow">
      {text}
    </div>
  );
}
