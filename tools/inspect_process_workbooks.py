import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree.ElementTree import iterparse

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    value = 0
    for ch in letters:
        value = value * 26 + ord(ch) - 64
    return value - 1


def workbook_parts(zf):
    import xml.etree.ElementTree as ET
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    targets = {r.attrib["Id"]: r.attrib["Target"] for r in rels.findall(PKG_REL_NS + "Relationship")}
    out = {}
    for sheet in wb.find(NS + "sheets"):
        target = targets[sheet.attrib[REL_NS + "id"]].lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        out[sheet.attrib["name"]] = target
    return out


def shared_strings(zf):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    values = []
    for event, elem in iterparse(zf.open("xl/sharedStrings.xml"), events=("end",)):
        if elem.tag == NS + "si":
            values.append("".join(t.text or "" for t in elem.iter(NS + "t")))
            elem.clear()
    return values


def cell_value(cell, strings):
    kind = cell.attrib.get("t")
    if kind == "inlineStr":
        return "".join(t.text or "" for t in cell.iter(NS + "t"))
    v = cell.find(NS + "v")
    if v is None or v.text is None:
        return ""
    if kind == "s":
        return strings[int(v.text)]
    return v.text


def inspect(path):
    wanted_cps = {"1005", "1714", "1824", "1636", "5000", "5500", "2000"}
    with zipfile.ZipFile(path) as zf:
        strings = shared_strings(zf)
        parts = workbook_parts(zf)
        sheet = parts.get("Cotizaciones") or next(iter(parts.values()))
        headers = []
        cp_col = None
        insurer_col = None
        cp_counts = Counter()
        cp_localities = Counter()
        insurers = Counter()
        row_count = 0
        for event, elem in iterparse(zf.open(sheet), events=("end",)):
            if elem.tag != NS + "row":
                continue
            cells = {}
            for cell in elem.findall(NS + "c"):
                cells[col_index(cell.attrib["r"])] = cell_value(cell, strings)
            if not headers:
                max_col = max(cells) if cells else -1
                headers = [cells.get(i, "") for i in range(max_col + 1)]
                cp_col = headers.index("Vehiculo CP") if "Vehiculo CP" in headers else None
                insurer_col = headers.index("Aseguradora") if "Aseguradora" in headers else None
            else:
                row_count += 1
                if cp_col is not None:
                    cp = str(cells.get(cp_col, "")).strip().removesuffix(".0")
                    if cp in wanted_cps:
                        cp_counts[cp] += 1
                    if cp.isdigit() and 1000 <= int(cp) <= 1999:
                        loc_col = headers.index("Vehiculo Localidad") if "Vehiculo Localidad" in headers else None
                        locality = str(cells.get(loc_col, "")).strip() if loc_col is not None else ""
                        cp_localities[(cp, locality)] += 1
                if insurer_col is not None:
                    insurers[str(cells.get(insurer_col, "")).strip().lower()] += 1
            elem.clear()
        return {"path": str(path), "rows": row_count, "headers": headers, "requested_cp_rows": cp_counts,
                "cp_1000_1999": [{"cp": k[0], "localidad": k[1], "rows": v} for k, v in cp_localities.most_common()],
                "insurer_rows": insurers}


if __name__ == "__main__":
    print(json.dumps([inspect(Path(p)) for p in sys.argv[1:]], ensure_ascii=False, indent=2, default=dict))
