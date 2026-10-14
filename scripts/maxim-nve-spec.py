"""Vytiahne z originalneho MAXIM NVE listu (.xls) ROZLOZENIE a FORMATOVANIE
(bez obchodnych dat) do src/lib/__fixtures__/nveListMaxim.layout.json.

Spusta sa len ked sa zmeni format MAXIM exportu:
    python -I scripts/maxim-nve-spec.py pda-podklady/2026-2212015.xls

Vyzaduje Python + xlrd (pip install xlrd). Ulozi pre kazdu "ulohu" riadku
(nadpis, adresa, hlavicka, prvy/stredny/posledny datovy riadok, sucet,
medzera, TOTAL) a stlpec A-H: pismo, ciselny format, zarovnanie, oramovanie.
Konstantne texty (hlavicky stlpcov, TOTAL, jednotky) uklada tiez - nie su to
obchodne data. Hodnoty z dat (SSCC, datumy, adresa, cislo LS) sa NEUKLADAJU.
"""
import json
import os
import sys

import xlrd

BORDER = {0: None, 1: "thin", 2: "medium", 3: "dashed", 4: "dotted", 5: "thick", 6: "double", 7: "hair"}
HALIGN = {0: "general", 1: "left", 2: "center", 3: "right"}
VALIGN = {0: "top", 1: "middle", 2: "bottom"}
COLS = "ABCDEFGH"


def style(wb, sh, r, c):
    xf = wb.xf_list[sh.cell_xf_index(r, c)]
    font = wb.font_list[xf.font_index]
    b = xf.border
    return {
        "font": {"name": font.name, "size": font.height / 20, "bold": bool(font.bold), "italic": bool(font.italic)},
        "numFmt": wb.format_map[xf.format_key].format_str,
        "hAlign": HALIGN.get(xf.alignment.hor_align, "general"),
        "vAlign": VALIGN.get(xf.alignment.vert_align, "bottom"),
        "border": {
            "top": BORDER[b.top_line_style],
            "bottom": BORDER[b.bottom_line_style],
            "left": BORDER[b.left_line_style],
            "right": BORDER[b.right_line_style],
        },
    }


def main(path, out):
    wb = xlrd.open_workbook(path, formatting_info=True)
    sh = wb.sheet_by_index(0)
    # Najdi hlavicku (riadok s "SSCC code") a TOTAL.
    header = next(r for r in range(sh.nrows) if sh.cell_value(r, 3) == "SSCC code")
    total = next(r for r in range(sh.nrows) if sh.cell_value(r, 3) == "TOTAL")
    first, last = header + 1, total - 3
    roles = {
        "title": 0, "address1": 1, "address2": 2, "address3": 3,
        "header": header, "dataFirst": first, "dataMiddle": first + 1, "dataLast": last,
        "sum": total - 2, "spacer": total - 1, "total": total,
    }
    spec = {
        "_zdroj": "MAXIM NVE list - len rozlozenie/formatovanie, bez obchodnych dat (scripts/maxim-nve-spec.py)",
        "sheetName": sh.name,
        "merges": [f"{COLS[c1]}{r1 + 1}:{COLS[c2 - 1]}{r2}" for (r1, r2, c1, c2) in sh.merged_cells],
        "columnWidths": {COLS[c]: round(sh.colinfo_map[c].width / 256, 2) for c in range(8)},
        "rowHeights": {role: (sh.rowinfo_map[r].height / 20 if r in sh.rowinfo_map else None) for role, r in roles.items()},
        "emptyRowBeforeHeader": header - roles["address3"] - 1,
        "headerLabels": [sh.cell_value(header, c) for c in range(8)],
        "constants": {
            "titlePrefix": sh.cell_value(0, 0).split(":")[0] + ": ",
            "datePrefix": sh.cell_value(0, 7).split(":")[0] + ": ",
            "unit": sh.cell_value(first, 5),
            "totalLabel": sh.cell_value(total, 3),
            "totalUnit": sh.cell_value(total, 5),
        },
        "titleCells": {"A1": style(wb, sh, 0, 0), "H1": style(wb, sh, 0, 7)},
        "roles": {role: {COLS[c]: style(wb, sh, r, c) for c in range(8)} for role, r in roles.items()},
        "cellTypes": {
            "data": {COLS[c]: ("number" if sh.cell_type(first, c) == xlrd.XL_CELL_NUMBER else "text") for c in range(8)},
            "sum": {"E": "number"},
            "total": {"E": "number"},
        },
    }
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(spec, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("ulozene:", out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "src/lib/__fixtures__/nveListMaxim.layout.json")
