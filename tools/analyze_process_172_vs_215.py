import json
import math
import re
import statistics
import sys
import unicodedata
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from xml.etree.ElementTree import iterparse

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
COMMON = {"allianz", "atm", "experta", "mapfre", "provincia", "rivadavia", "sancor", "smg", "victoria"}
TARGET_CPS = {"1014": "CABA", "1712": "Zona Oeste", "1824": "Zona Sur", "1638": "Zona Norte",
              "5000": "Córdoba", "5500": "Mendoza", "2000": "Rosario"}
TC_GROUPS = {"C", "C+", "C++", "C PREMIUM"}


def norm(value):
    value = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]+", " ", value.upper()).strip()


def num(value):
    try:
        value = str(value or "").strip().replace("$", "").replace(" ", "")
        if not value:
            return None
        if "," in value and "." in value:
            value = value.replace(".", "").replace(",", ".")
        elif "," in value:
            value = value.replace(",", ".")
        result = float(value)
        return result if math.isfinite(result) else None
    except ValueError:
        return None


def percentile(values, p):
    if not values:
        return None
    values = sorted(values)
    pos = (len(values) - 1) * p
    lo, hi = math.floor(pos), math.ceil(pos)
    return values[lo] if lo == hi else values[lo] + (values[hi] - values[lo]) * (pos - lo)


def stats(values):
    values = [v for v in values if v is not None and math.isfinite(v)]
    if not values:
        return {"n": 0}
    return {"n": len(values), "promedio_pct": round(statistics.fmean(values), 2),
            "mediana_pct": round(statistics.median(values), 2),
            "p10_pct": round(percentile(values, .1), 2), "p90_pct": round(percentile(values, .9), 2),
            "min_pct": round(min(values), 2), "max_pct": round(max(values), 2)}


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
    result = {}
    for sheet in wb.find(NS + "sheets"):
        target = targets[sheet.attrib[REL_NS + "id"]].lstrip("/")
        result[sheet.attrib["name"]] = target if target.startswith("xl/") else "xl/" + target
    return result


def shared_strings(zf):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    values = []
    for _, elem in iterparse(zf.open("xl/sharedStrings.xml"), events=("end",)):
        if elem.tag == NS + "si":
            values.append("".join(t.text or "" for t in elem.iter(NS + "t")))
            elem.clear()
    return values


def cell_value(cell, strings):
    kind = cell.attrib.get("t")
    if kind == "inlineStr":
        return "".join(t.text or "" for t in cell.iter(NS + "t"))
    value = cell.find(NS + "v")
    if value is None or value.text is None:
        return ""
    return strings[int(value.text)] if kind == "s" else value.text


FIELDS = ["Aseguradora", "Fila", "Vehiculo Anio", "Vehiculo Marca", "Vehiculo Modelo", "Vehiculo Codigo Infoauto", "Vehiculo Tipo",
          "Vehiculo CP", "Vehiculo Localidad", "Grupo Cobertura Codigo", "Cobertura Codigo",
          "Cobertura Descripcion", "Producto Codigo", "Producto Descripcion", "Plan", "Franquicia",
          "Periodo Facturacion", "Duracion", "Cuotas", "Importe Cuota", "Prima Mensual", "Premio Mensual", "Suma Asegurada"]


def rows(path):
    with zipfile.ZipFile(path) as zf:
        strings = shared_strings(zf)
        sheet = workbook_parts(zf).get("Cotizaciones")
        headers = None
        indices = None
        for _, elem in iterparse(zf.open(sheet), events=("end",)):
            if elem.tag != NS + "row":
                continue
            cells = {col_index(c.attrib["r"]): cell_value(c, strings) for c in elem.findall(NS + "c")}
            if headers is None:
                headers = [cells.get(i, "") for i in range(max(cells) + 1)]
                indices = {field: headers.index(field) for field in FIELDS if field in headers}
            else:
                yield {field: cells.get(idx, "") for field, idx in indices.items()}
            elem.clear()


def risk_key(row):
    return (str(row.get("Vehiculo Codigo Infoauto", "")).removesuffix(".0"),
            str(row.get("Vehiculo Anio", "")).removesuffix(".0"),
            str(row.get("Vehiculo CP", "")).removesuffix(".0"))


def product_key(row):
    group = norm(row.get("Grupo Cobertura Codigo"))
    codes = tuple(norm(row.get(x)) for x in ("Cobertura Codigo", "Producto Codigo", "Plan"))
    franchise = round(num(row.get("Franquicia")) or 0, 0)
    if any(codes):
        return (group, *codes, franchise)
    return (group, norm(row.get("Cobertura Descripcion")), norm(row.get("Producto Descripcion")), franchise)


def effective_price(row, process_id, diagnostics):
    premium = num(row.get("Premio Mensual"))
    installment = num(row.get("Importe Cuota"))
    company = norm(row.get("Aseguradora")).lower()
    if premium and installment:
        diagnostics[(process_id, company)].append(premium / installment)
    # ATM informa premio trimestral y la cuota efectiva mensual por separado.
    if company == "atm" and installment:
        return installment
    # Experta informa un premio por la duración de 3 meses; la cuota del Excel 215
    # no siempre fue desagregada, por eso se normaliza explícitamente por duración.
    if company == "experta" and premium:
        duration = num(row.get("Duracion")) or num(row.get("Cuotas")) or 3
        return premium / duration if duration > 1 else premium
    # El 172 es anterior a la corrección canónica de Rivadavia: la cuota es el mensual real.
    if process_id == 172 and company == "rivadavia" and installment and premium and premium / installment > 2:
        return installment
    # Victoria cambió vigencia y condiciones comerciales entre las cabeceras 20 y 33.
    # El proceso 172 no conserva duración suficiente para convertir su total a mensual.
    if process_id == 172 and company == "victoria":
        return None
    return premium


def compact_record(row, price):
    return {"company": norm(row.get("Aseguradora")).lower(), "risk": risk_key(row), "product": product_key(row),
            "price": price, "brand": str(row.get("Vehiculo Marca", "")).strip(),
            "model": str(row.get("Vehiculo Modelo", "")).strip(), "cp": risk_key(row)[2],
            "locality": str(row.get("Vehiculo Localidad", "")).strip(),
            "group": norm(row.get("Grupo Cobertura Codigo")),
            "product_desc": str(row.get("Producto Descripcion") or row.get("Cobertura Descripcion") or "").strip()}


def grouped_spikes(pairs, fields, minimum):
    groups = defaultdict(list)
    for item in pairs:
        groups[tuple(item[f] for f in fields)].append(item["pct"])
    result = []
    for key, values in groups.items():
        if len(values) >= minimum:
            s = stats(values)
            result.append({**{field: key[i] for i, field in enumerate(fields)}, **s})
    return sorted(result, key=lambda x: (x["promedio_pct"], x["n"]), reverse=True)


def ranking(records, process_id, target_group):
    selected = defaultdict(dict)
    descriptions = defaultdict(Counter)
    for rec in records:
        if rec["cp"] not in TARGET_CPS or not rec["price"] or rec["price"] <= 0:
            continue
        is_target = rec["group"] == "A" if target_group == "RC" else rec["group"] in TC_GROUPS
        if not is_target:
            continue
        key = (rec["cp"], rec["company"])
        old = selected[key].get(rec["risk"])
        choose = old is None or (rec["price"] < old[0] if target_group == "RC" else rec["price"] > old[0])
        if choose:
            selected[key][rec["risk"]] = (rec["price"], rec["product_desc"])

    output = []
    for cp, zone in TARGET_CPS.items():
        company_maps = {company: risks for (row_cp, company), risks in selected.items() if row_cp == cp and len(risks) >= 3}
        if not company_maps:
            output.append({"proceso": process_id, "tipo": target_group, "zona": zone, "cp_usado": cp, "ranking": []})
            continue
        common_risks = set.intersection(*(set(risks) for risks in company_maps.values()))
        ranking_rows = []
        for company, risks in company_maps.items():
            use = common_risks if common_risks else set(risks)
            prices = [risks[r][0] for r in use if r in risks]
            desc = Counter(risks[r][1] for r in use if r in risks and risks[r][1])
            if prices:
                ranking_rows.append({"compania": company, "precio_promedio": round(statistics.fmean(prices), 2),
                                     "mediana": round(statistics.median(prices), 2), "vehiculos": len(prices),
                                     "producto_mas_frecuente": desc.most_common(1)[0][0] if desc else ""})
        ranking_rows.sort(key=lambda x: x["precio_promedio"])
        for pos, item in enumerate(ranking_rows, 1):
            item["puesto"] = pos
        output.append({"proceso": process_id, "tipo": target_group, "zona": zone, "cp_usado": cp,
                       "vehiculos_canasta_comun": len(common_risks), "companias_comparadas": len(company_maps),
                       "ranking": ranking_rows[:5]})
    return output


def main(path172, path215, output):
    diagnostics = defaultdict(list)
    old = {}
    records172 = []
    risk_sets = {172: set(), 215: set()}
    for row in rows(path172):
        company = norm(row.get("Aseguradora")).lower()
        if company not in COMMON:
            continue
        price = effective_price(row, 172, diagnostics)
        if not price or price <= 0:
            continue
        rec = compact_record(row, price)
        old[(company, rec["risk"], rec["product"])] = rec
        records172.append(rec)
        risk_sets[172].add(rec["risk"])

    pairs = []
    records215 = []
    for row in rows(path215):
        price = effective_price(row, 215, diagnostics)
        if not price or price <= 0:
            continue
        rec = compact_record(row, price)
        records215.append(rec)
        risk_sets[215].add(rec["risk"])
        prior = old.get((rec["company"], rec["risk"], rec["product"]))
        if prior and prior["price"] > 0:
            pairs.append({**rec, "old_price": prior["price"], "new_price": rec["price"],
                          "pct": (rec["price"] / prior["price"] - 1) * 100})

    company_summary = []
    for company in sorted(COMMON):
        subset = [p for p in pairs if p["company"] == company]
        s = stats([p["pct"] for p in subset])
        if subset:
            s["precio_172_promedio"] = round(statistics.fmean(p["old_price"] for p in subset), 2)
            s["precio_215_promedio"] = round(statistics.fmean(p["new_price"] for p in subset), 2)
            s["aumento_canasta_agregada_pct"] = round((sum(p["new_price"] for p in subset) / sum(p["old_price"] for p in subset) - 1) * 100, 2)
        company_summary.append({"compania": company, **s})

    diag = []
    for key, values in diagnostics.items():
        diag.append({"proceso": key[0], "compania": key[1], "n": len(values),
                     "mediana_premio_sobre_cuota": round(statistics.median(values), 3)})

    report = {
        "metodologia": {
            "periodos": {"172": "2026-06", "215": "2026-08"},
            "companias_comunes": sorted(COMMON),
            "precio": "Mensual normalizado: ATM usa Importe Cuota; Experta divide premio por duración; Rivadavia 172 usa Importe Cuota cuando Premio/Importe Cuota > 2; Victoria 172 se excluye por vigencia no homologable",
            "matching": "misma compañía, Infoauto, año, CP, grupo y códigos/plan/franquicia del producto",
            "cp_solicitados_no_presentes": {"1005": "1014", "1714": "1712", "1636": "1638"},
            "cp_usados": TARGET_CPS,
            "ranking": "RC: producto A más barato por riesgo. TC: producto C/C+/C++/C Premium más caro por riesgo. Promedio sobre canasta común de vehículos entre compañías."
        },
        "cobertura_datos": {"riesgos_172": len(risk_sets[172]), "riesgos_215": len(risk_sets[215]),
                            "riesgos_comunes": len(risk_sets[172] & risk_sets[215]), "pares_producto": len(pairs)},
        "aumento_por_compania": company_summary,
        "picos_compania_producto": grouped_spikes(pairs, ["company", "group", "product_desc"], 20)[:40],
        "picos_compania_marca_modelo": grouped_spikes(pairs, ["company", "brand", "model"], 12)[:40],
        "picos_compania_zona": grouped_spikes(pairs, ["company", "cp", "locality"], 15)[:40],
        "picos_compania_grupo": grouped_spikes(pairs, ["company", "group"], 30),
        "diagnostico_premio_cuota": sorted(diag, key=lambda x: (x["proceso"], x["compania"])),
        "rankings_rc_172": ranking(records172, 172, "RC"),
        "rankings_rc_215": ranking(records215, 215, "RC"),
        "rankings_tc_172": ranking(records172, 172, "TC"),
        "rankings_tc_215": ranking(records215, 215, "TC"),
    }
    Path(output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": output, "pares": len(pairs), "riesgos_comunes": report["cobertura_datos"]["riesgos_comunes"]}, ensure_ascii=False))


if __name__ == "__main__":
    main(*sys.argv[1:4])
