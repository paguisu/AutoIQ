import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analyze_process_172_vs_215 import norm, num, percentile, risk_key, rows


def parameter_counts(path):
    counts = {name: Counter() for name in ("coefRC", "coefCasco", "tipoUso", "tipoVehiculo", "descripcionTipoVehiculo", "attemptSource")}
    ok = 0
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            item = json.loads(line)
            if not item.get("ok"):
                continue
            ok += 1
            used = item.get("used") or {}
            for name, counter in counts.items():
                value = used.get(name)
                counter["<ausente>" if value is None or value == "" else str(value)] += 1
    return {"ok": ok, **{name: dict(counter.most_common()) for name, counter in counts.items()}}


def risk_types(path):
    result = {}
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            item = json.loads(line)
            if not item.get("ok"):
                continue
            preview, used = item.get("fila_preview") or {}, item.get("used") or {}
            key = (str(preview.get("infoautocod", "")), str(preview.get("anio", "")), str(preview.get("cp", "")))
            result[key] = str(used.get("descripcionTipoVehiculo") or used.get("tipoVehiculo") or "")
    return result


def quote_rows(path, old=False):
    output = {}
    for row in rows(path):
        if norm(row.get("Aseguradora")).lower() != "rivadavia":
            continue
        premium = num(row.get("Premio Mensual"))
        installment = num(row.get("Importe Cuota"))
        price = installment if old and installment and premium and premium / installment > 2 else premium
        if not price or price <= 0:
            continue
        risk = risk_key(row)
        coverage = norm(row.get("Cobertura Codigo")) or norm(row.get("Plan"))
        output[(risk, coverage)] = {
            "risk": risk, "coverage": coverage, "group": norm(row.get("Grupo Cobertura Codigo")),
            "price": price, "brand": str(row.get("Vehiculo Marca", "")).strip(),
            "model": str(row.get("Vehiculo Modelo", "")).strip(), "vehicle_type": str(row.get("Vehiculo Tipo", "")).strip(),
            "cp": risk[2], "locality": str(row.get("Vehiculo Localidad", "")).strip(),
            "sum": num(row.get("Suma Asegurada")),
        }
    return output


def summary(values):
    if not values:
        return {"n": 0}
    return {"n": len(values), "promedio_pct": round(statistics.fmean(values), 2),
            "mediana_pct": round(statistics.median(values), 2), "p10_pct": round(percentile(values, .1), 2),
            "p90_pct": round(percentile(values, .9), 2), "min_pct": round(min(values), 2), "max_pct": round(max(values), 2)}


def grouped(pairs, fields, minimum):
    buckets = defaultdict(list)
    for pair in pairs:
        buckets[tuple(pair[f] for f in fields)].append(pair["pct"])
    result = []
    for key, values in buckets.items():
        if len(values) >= minimum:
            result.append({**{field: key[i] for i, field in enumerate(fields)}, **summary(values)})
    return sorted(result, key=lambda x: x["promedio_pct"])


def main(xlsx172, xlsx215, jsonl172, jsonl215, output):
    old, new = quote_rows(xlsx172, True), quote_rows(xlsx215, False)
    pairs = []
    for key, current in new.items():
        prior = old.get(key)
        if not prior:
            continue
        sum_change = None
        if current["sum"] and prior["sum"]:
            sum_change = (current["sum"] / prior["sum"] - 1) * 100
        pairs.append({**current, "old": prior["price"], "new": current["price"],
                      "pct": (current["price"] / prior["price"] - 1) * 100, "sum_pct": sum_change})
    types_old, types_new = risk_types(jsonl172), risk_types(jsonl215)
    transitions = Counter((types_old[key], types_new[key]) for key in types_old.keys() & types_new.keys())
    north_cps = {"1605", "1607", "1609", "1638", "1642", "1643", "1646", "1648", "1611", "1617"}
    north_pairs = [p for p in pairs if p["cp"] in north_cps]
    report = {
        "parametros_172": parameter_counts(jsonl172), "parametros_215": parameter_counts(jsonl215),
        "transiciones_tipo_vehiculo": [{"desde": key[0], "hacia": key[1], "n": value}
                                        for key, value in transitions.most_common()],
        "riesgos_comunes": len({p["risk"] for p in pairs}), "pares_producto": len(pairs),
        "total": summary([p["pct"] for p in pairs]),
        "canasta_agregada_pct": round((sum(p["new"] for p in pairs) / sum(p["old"] for p in pairs) - 1) * 100, 2),
        "suma_asegurada": summary([p["sum_pct"] for p in pairs if p["sum_pct"] is not None]),
        "por_cobertura": grouped(pairs, ["coverage", "group"], 30),
        "por_tipo_vehiculo": grouped(pairs, ["vehicle_type"], 30),
        "por_zona": grouped(pairs, ["cp", "locality"], 30),
        "por_modelo": grouped(pairs, ["brand", "model"], 30),
        "zona_norte": {
            "total": summary([p["pct"] for p in north_pairs]),
            "por_modelo": grouped(north_pairs, ["brand", "model"], 20),
            "por_tipo_vehiculo": grouped(north_pairs, ["vehicle_type"], 20),
            "por_cobertura": grouped(north_pairs, ["coverage", "group"], 20),
        },
    }
    Path(output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": output, "riesgos": report["riesgos_comunes"], "pares": len(pairs), "total": report["total"]}, ensure_ascii=False))


if __name__ == "__main__":
    main(*sys.argv[1:6])
