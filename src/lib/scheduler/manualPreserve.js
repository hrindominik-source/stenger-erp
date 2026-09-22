// Pomocky pre "preserveOnReplan" - oznacenie KONKRETNEHO rucne potvrdeneho
// priradenia (nie celeho zamestnanca), ktore ma "Vycistit a preplanovat"
// zachovat namiesto zmazania. Zamerne NEPOUZIVAME nazov "LOCK" (explicitna
// poziadavka) - interny nazov je preserveOnReplan / manualProtected.
//
// Spatne kompatibilne so vsetkymi existujucimi zmenami: chybajuce pole =
// nic nie je chranene (bezpecny default), ziadna migracia dat netreba.
// Tvar: shift.preserveOnReplan = { pos1: bool, pos3: bool, general: string[] }

export function ensurePreserveShape(shift) {
  const p = shift.preserveOnReplan;
  if (p && typeof p === "object") {
    return { pos1: Boolean(p.pos1), pos3: Boolean(p.pos3), general: Array.isArray(p.general) ? p.general : [] };
  }
  return { pos1: false, pos3: false, general: [] };
}

export function isPreserved(shift, roleOrEmployeeId) {
  const p = ensurePreserveShape(shift);
  if (roleOrEmployeeId === "pos1") return p.pos1;
  if (roleOrEmployeeId === "pos3") return p.pos3;
  return p.general.includes(roleOrEmployeeId);
}

export function markPreserved(shift, roleOrEmployeeId) {
  const p = ensurePreserveShape(shift);
  if (roleOrEmployeeId === "pos1") p.pos1 = true;
  else if (roleOrEmployeeId === "pos3") p.pos3 = true;
  else if (!p.general.includes(roleOrEmployeeId)) p.general = [...p.general, roleOrEmployeeId];
  return { ...shift, preserveOnReplan: p };
}

export function unmarkPreserved(shift, roleOrEmployeeId) {
  const p = ensurePreserveShape(shift);
  if (roleOrEmployeeId === "pos1") p.pos1 = false;
  else if (roleOrEmployeeId === "pos3") p.pos3 = false;
  else p.general = p.general.filter((id) => id !== roleOrEmployeeId);
  return { ...shift, preserveOnReplan: p };
}
