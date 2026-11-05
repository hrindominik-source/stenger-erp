// Zmensi fotku pred odoslanim (mensi upload aj menej tokenov pre AI). PDF a male
// obrazky vrati bez zmeny. Vrati { blob, ext }.
export async function zmensitFotku(file, maxPx = 2000, kvalita = 0.85) {
  if (!file.type.startsWith("image/")) return { blob: file, ext: (file.name.split(".").pop() || "pdf").toLowerCase() };
  const bitmap = await createImageBitmap(file);
  const pomer = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  if (pomer === 1 && file.type === "image/jpeg") return { blob: file, ext: "jpg" };
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * pomer);
  canvas.height = Math.round(bitmap.height * pomer);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", kvalita));
  return { blob: blob || file, ext: blob ? "jpg" : (file.name.split(".").pop() || "jpg").toLowerCase() };
}
