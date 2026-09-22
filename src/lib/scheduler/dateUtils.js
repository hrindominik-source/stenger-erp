// Male lokalne datumove pomocky - rovnaky decoupling vzor ako planSmienGuard.js
// (nezavisle na PlanSmienView.jsx, kde tieto funkcie nie su exportovane).

function pad2(n) {
  return String(n).padStart(2, "0");
}
export function toISOLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function parseISOLocal(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDaysLocal(iso, n) {
  const d = parseISOLocal(iso);
  d.setDate(d.getDate() + n);
  return toISOLocal(d);
}
export function dayOfWeekIndex(iso) {
  // 0 = pondelok ... 6 = nedela (na rozdiel od Date#getDay(), kde 0=nedela)
  const js = parseISOLocal(iso).getDay();
  return js === 0 ? 6 : js - 1;
}
