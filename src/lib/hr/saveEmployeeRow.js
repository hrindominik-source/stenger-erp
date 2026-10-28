// Zapis do employee_sensitive_data / employee_payroll_data (migracia 68):
// pouzivatel tieto tabulky nesmie priamo citat (citanie len cez funkcie so
// zaznamom), a upsert by potreboval pravo citat zapisovane stlpce. Preto
// update podla kluca a ak riadok este nie je, insert.
export async function saveEmployeeRow(supabase, table, employeeId, values) {
  const { employee_id: _ignored, ...rest } = values;
  const { data, error } = await supabase.from(table).update(rest).eq("employee_id", employeeId).select("employee_id");
  if (error) return { error };
  if (data && data.length) return { error: null };
  const { error: insErr } = await supabase.from(table).insert({ employee_id: employeeId, ...rest });
  if (insErr?.code === "23505") {
    // medzitym ho zalozil niekto iny - prepisat
    const { error: upErr } = await supabase.from(table).update(rest).eq("employee_id", employeeId);
    return { error: upErr };
  }
  return { error: insErr };
}
