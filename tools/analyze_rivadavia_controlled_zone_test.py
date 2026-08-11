import json
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, "tools")
from analyze_process_172_vs_215 import norm, num, risk_key, rows


def mean(values):
    return round(statistics.fmean(values), 2) if values else None


controlled = json.load(open("data/procesos/rivadavia-prueba-controlada-coeficientes-zona-norte.json", encoding="utf-8"))
targets = {(str(item["codigo_infoauto"]), str(item["cp"])) for item in controlled["results"]}
old = {}
for row in rows("data/procesos/proceso-172/descargas/proceso-172-cotizaciones.xlsx"):
    if norm(row.get("Aseguradora")).lower() != "rivadavia":
        continue
    risk = risk_key(row)
    if (risk[0], risk[2]) not in targets:
        continue
    plan = norm(row.get("Cobertura Codigo")) or norm(row.get("Plan"))
    premium, installment = num(row.get("Premio Mensual")), num(row.get("Importe Cuota"))
    price = installment if installment and premium and premium / installment > 2 else premium
    if price:
        old[(risk[0], risk[2], plan)] = price

current = {}
for item in controlled["results"]:
    for product in item["products"]:
        current[(str(item["codigo_infoauto"]), str(item["cp"]), norm(product["plan"]), str(item["coefficient"]))] = product["premio_mensual"]

groups = defaultdict(lambda: {"base": [], "coef": [], "total": []})
for (vehicle, cp, plan), old_price in old.items():
    price1 = current.get((vehicle, cp, plan, "1"))
    price09 = current.get((vehicle, cp, plan, "0.9"))
    if not price1 or not price09:
        continue
    bucket = groups[cp]
    bucket["base"].append((price1 / old_price - 1) * 100)
    bucket["coef"].append((price09 / price1 - 1) * 100)
    bucket["total"].append((price09 / old_price - 1) * 100)

labels = {item["cp"]: item["localidad"] for item in controlled["results"]}
output = []
for cp, bucket in groups.items():
    output.append({"cp": cp, "localidad": labels.get(cp, ""), "n": len(bucket["total"]),
                   "efecto_tarifa_canal_pct": mean(bucket["base"]),
                   "efecto_coeficiente_pct": mean(bucket["coef"]),
                   "efecto_total_pct": mean(bucket["total"])})
output.sort(key=lambda x: x["efecto_total_pct"])
print(json.dumps(output, ensure_ascii=False, indent=2))
