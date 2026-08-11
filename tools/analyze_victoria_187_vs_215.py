import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analyze_process_172_vs_215 import norm, num, percentile, risk_key, rows


PARAM_KEYS = (
    "vigenciaId", "formaPagoCode", "cantidadCuotas", "variacionId", "variacion32080",
    "clausulaAjusteId", "clausulaAjuste", "descuentoSeguroNuevoId", "descuentoSeguroNuevo",
    "descuentoComercial", "useId", "tipoPersonaId", "tipoDocumentoId", "ivaCode",
)


def parameter_signatures(path):
    signatures = Counter()
    ok = 0
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            item = json.loads(line)
            if not item.get("ok"):
                continue
            ok += 1
            used = item.get("used") or {}
            signature = tuple((key, used.get(key)) for key in PARAM_KEYS)
            signatures[signature] += 1
    return {"ok": ok, "signatures": [{"count": count, "values": dict(signature)} for signature, count in signatures.most_common()]}


def product_key(row):
    return (norm(row.get("Grupo Cobertura Codigo")), norm(row.get("Cobertura Codigo")),
            norm(row.get("Producto Codigo")), norm(row.get("Producto Descripcion")), norm(row.get("Plan")))


def load_quotes(path):
    result = {}
    for row in rows(path):
        if norm(row.get("Aseguradora")).lower() != "victoria":
            continue
        price = num(row.get("Premio Mensual"))
        if not price or price <= 0:
            continue
        risk = risk_key(row)
        key = (risk, product_key(row))
        result[key] = {
            "price": price,
            "risk": risk,
            "group": norm(row.get("Grupo Cobertura Codigo")),
            "brand": str(row.get("Vehiculo Marca", "")).strip(),
            "model": str(row.get("Vehiculo Modelo", "")).strip(),
            "cp": risk[2],
            "locality": str(row.get("Vehiculo Localidad", "")).strip(),
            "product": str(row.get("Producto Descripcion") or row.get("Cobertura Descripcion") or "").strip(),
        }
    return result


def summary(values):
    if not values:
        return {"n": 0}
    return {"n": len(values), "promedio_pct": round(statistics.fmean(values), 2),
            "mediana_pct": round(statistics.median(values), 2),
            "p10_pct": round(percentile(values, .1), 2), "p90_pct": round(percentile(values, .9), 2),
            "min_pct": round(min(values), 2), "max_pct": round(max(values), 2)}


def grouped(pairs, fields, minimum):
    buckets = defaultdict(list)
    for pair in pairs:
        buckets[tuple(pair[f] for f in fields)].append(pair["pct"])
    output = []
    for key, values in buckets.items():
        if len(values) >= minimum:
            output.append({**{field: key[i] for i, field in enumerate(fields)}, **summary(values)})
    return sorted(output, key=lambda x: x["promedio_pct"], reverse=True)


def main(xlsx187, xlsx215, jsonl187, jsonl215, output):
    old = load_quotes(xlsx187)
    new = load_quotes(xlsx215)
    pairs = []
    for key, current in new.items():
        prior = old.get(key)
        if prior:
            pairs.append({**current, "old": prior["price"], "new": current["price"],
                          "pct": (current["price"] / prior["price"] - 1) * 100})
    report = {
        "parametros_187": parameter_signatures(jsonl187),
        "parametros_215": parameter_signatures(jsonl215),
        "riesgos_187": len({item[0] for item in old}),
        "riesgos_215": len({item[0] for item in new}),
        "riesgos_comunes": len({p["risk"] for p in pairs}),
        "pares_producto": len(pairs),
        "total": summary([p["pct"] for p in pairs]),
        "precio_187_promedio": round(statistics.fmean(p["old"] for p in pairs), 2),
        "precio_215_promedio": round(statistics.fmean(p["new"] for p in pairs), 2),
        "canasta_agregada_pct": round((sum(p["new"] for p in pairs) / sum(p["old"] for p in pairs) - 1) * 100, 2),
        "por_grupo": grouped(pairs, ["group"], 20),
        "por_zona": grouped(pairs, ["cp", "locality"], 20),
        "por_modelo": grouped(pairs, ["brand", "model"], 20),
    }
    Path(output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": output, "riesgos_comunes": report["riesgos_comunes"],
                      "pares": report["pares_producto"], "total": report["total"]}, ensure_ascii=False))


if __name__ == "__main__":
    main(*sys.argv[1:6])
