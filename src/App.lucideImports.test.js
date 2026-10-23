// Regresia: ikona z lucide-react pouzita v JSX bez importu (napr. <Check />)
// spadne az pri vykresleni. Kazda pouzita ikona musi byt importovana
// alebo definovana v tom istom subore.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as lucide from "lucide-react";

const SRC = path.resolve(__dirname);
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p) : /\.jsx$/.test(e.name) ? [p] : [];
});

function missingIcons(code) {
  const used = new Set([...code.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((m) => m[1]));
  const declared = new Set();
  for (const m of code.matchAll(/import\s*(?:([A-Za-z0-9_$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g)) {
    if (m[1]) declared.add(m[1]);
    for (const part of (m[2] || "").split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) declared.add(name);
    }
  }
  for (const m of code.matchAll(/(?:function|const|let|class)\s+([A-Z][A-Za-z0-9]*)/g)) declared.add(m[1]);
  for (const m of code.matchAll(/(?:icon|Icon)\s*:\s*([A-Z][A-Za-z0-9]*)\b/g)) declared.add(m[1]); // ({ icon: Icon })
  return [...used].filter((n) => n in lucide && !declared.has(n));
}

describe("lucide ikony su importovane", () => {
  it("detektor zachyti chybajuci import", () => {
    expect(missingIcons('import { X } from "lucide-react";\nconst a = <X />; const b = <Check size={1} />;')).toEqual(["Check"]);
  });
  for (const f of files(SRC)) {
    it(path.relative(SRC, f), () => {
      expect(missingIcons(fs.readFileSync(f, "utf8"))).toEqual([]);
    });
  }
});
