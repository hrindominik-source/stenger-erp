// Cisto datovy vypocet stavu pracovnelekarskej prehliadky (bez zavislosti na
// React/appke) - rovnaky vzor ako hrContractRules.js. Prah "coskoro
// vyprsi" je KONFIGUROVATELNY parameter (default 60 dni), nie natvrdo v UI
// komponente - viz zadanie bod 4 "Thresholds nehardcoduj do komponent."
export const MEDICAL_STATUS = {
  VALID: "VALID",
  EXPIRING: "EXPIRING",
  EXPIRED: "EXPIRED",
  UNKNOWN: "UNKNOWN",
};

export const DEFAULT_EXPIRING_THRESHOLD_DAYS = 60;

function daysBetween(fromIso, toIso) {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

// validUntil chybajuce/nerozpoznatelne -> UNKNOWN (nikdy sa nedomyslana ako
// VALID) - presne ako pri "Vyžaduje kontrolu" v hrContractRules.js, ticha
// falosne presna odpoved je horsia nez priznanie, ze sa to nedá bezpecne urcit.
export function computeMedicalStatus(validUntilIso, todayIso, thresholdDays = DEFAULT_EXPIRING_THRESHOLD_DAYS) {
  if (!validUntilIso || !/^\d{4}-\d{2}-\d{2}$/.test(validUntilIso)) return MEDICAL_STATUS.UNKNOWN;
  const today = todayIso || new Date().toISOString().slice(0, 10);
  const daysLeft = daysBetween(today, validUntilIso);
  if (daysLeft < 0) return MEDICAL_STATUS.EXPIRED;
  if (daysLeft <= thresholdDays) return MEDICAL_STATUS.EXPIRING;
  return MEDICAL_STATUS.VALID;
}

export const MEDICAL_STATUS_LABEL = {
  VALID: "Platná",
  EXPIRING: "Brzy končí",
  EXPIRED: "Propadlá",
  UNKNOWN: "Neznámý stav",
};
