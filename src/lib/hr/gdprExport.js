// Cesty suborov v exporte udajov zamestnanca (migracia 72): dokumenty
// (vygenerovany, finalny, podpisany) a prilohy z mzdovych udajov (prilohy*).
export function exportFilePaths(data) {
  const paths = [];
  for (const d of data?.documents || []) {
    for (const k of ["file_path", "final_pdf_path", "signed_pdf_path"]) if (d[k]) paths.push(d[k]);
  }
  const pd = data?.payroll?.data || {};
  for (const [k, v] of Object.entries(pd)) {
    if (k.startsWith("prilohy") && Array.isArray(v)) v.forEach((x) => x?.path && paths.push(x.path));
  }
  return [...new Set(paths)];
}
