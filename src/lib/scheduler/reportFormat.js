// Cisto na reporting/diagnostiku (testy, konzolove vystupy) - NEPOUZIVA sa
// v beznom behu enginu, takze nema vplyv na runtime bundle/chovanie.
import { weekShiftCount, shiftTotal, shiftPeopleIds } from "../../PlanSmienView.jsx";
import { employeeDailySequence } from "./blockAnalysis.js";

const SEQ_SYMBOL = { day: "D", night: "N", OFF: "-" };

export function formatEmployeeLine(employee, week, warnings = []) {
  const seq = employeeDailySequence(week, employee.id);
  const dCount = seq.filter((s) => s === "day").length;
  const nCount = seq.filter((s) => s === "night").length;
  const sanitation = week.shifts.some((s) => s.type === "sanitation" && shiftPeopleIds(s).includes(employee.id)) ? 1 : 0;
  const total = weekShiftCount(week, employee.id);
  const ownWarnings = warnings.filter((w) => w.employeeId === employee.id);
  const seqStr = seq.map((s) => SEQ_SYMBOL[s]).join(" ");
  const warnStr = ownWarnings.length ? `  [!] ${ownWarnings.map((w) => w.code).join(", ")}` : "";
  return `${employee.name.padEnd(18)} ${seqStr}   total=${total} D=${dCount} N=${nCount} San=${sanitation}  roles=${employee.roles.join("/")}${warnStr}`;
}

export function formatWeekRoster(week, employees, warnings = []) {
  const activeEmployees = employees.filter((e) => e.active);
  const lines = activeEmployees.map((e) => formatEmployeeLine(e, week, warnings));
  return lines.join("\n");
}

export function formatShiftCoverage(week) {
  return week.shifts
    .map((s) => {
      const total = shiftTotal(s);
      if (total === 0) return null;
      const filled = shiftPeopleIds(s).length;
      return `${s.date} ${s.type.padEnd(10)} ${filled}/${total}  pos1=${s.assigned.pos1 || "-"} pos3=${s.assigned.pos3 || "-"} general=[${s.assigned.general.join(",")}]`;
    })
    .filter(Boolean)
    .join("\n");
}
