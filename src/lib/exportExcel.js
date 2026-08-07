function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// sheets: [{ name, rows, colWidth? }]. rows are arrays of plain objects with
// human-readable header keys - XLSX.utils.json_to_sheet takes the keys of the
// first row as the header, so every row in a sheet must share the same keys.
export async function exportSheetsToExcel(sheets, fileNamePrefix) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const { name, rows, colWidth = 18 } of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const width = Object.keys(rows[0] || {}).length;
    if (width) ws["!cols"] = new Array(width).fill({ wch: colWidth });
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  XLSX.writeFile(wb, `${fileNamePrefix}_${stamp()}.xlsx`);
}

export async function exportRowsToExcel(rows, sheetName, fileNamePrefix, colWidth) {
  return exportSheetsToExcel([{ name: sheetName, rows, colWidth }], fileNamePrefix);
}
