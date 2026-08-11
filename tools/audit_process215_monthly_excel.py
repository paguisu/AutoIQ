import json
import statistics
import sys
from collections import Counter, defaultdict

sys.path.insert(0, "tools")
from analyze_process_172_vs_215 import norm, num, rows


def ratio_bucket(value):
    if value is None:
        return "n/a"
    for target in (1, 2, 3, 4, 5, 6, 12):
        if abs(value - target) <= 0.03:
            return f"~{target}x"
    return "otro"


path = "data/procesos/proceso-215/descargas/proceso-215-cotizaciones.xlsx"
audit = defaultdict(lambda: {
    "rows": 0, "importe_cuota_nonempty": 0, "prima_mensual_nonempty": 0, "premio_mensual_nonempty": 0,
    "periodos": Counter(), "duraciones": Counter(), "cuotas": Counter(),
    "premio_sobre_cuota": Counter(), "prima_sobre_cuota": Counter(),
    "premio_eq_cuota": 0, "prima_eq_cuota": 0,
})
for row in rows(path):
    company = norm(row.get("Aseguradora")).lower()
    item = audit[company]
    item["rows"] += 1
    installment = num(row.get("Importe Cuota"))
    prima = num(row.get("Prima Mensual"))
    premio = num(row.get("Premio Mensual"))
    if installment is not None:
        item["importe_cuota_nonempty"] += 1
    if prima is not None:
        item["prima_mensual_nonempty"] += 1
    if premio is not None:
        item["premio_mensual_nonempty"] += 1
    item["periodos"][str(row.get("Periodo Facturacion") or "<vacío>")] += 1
    item["duraciones"][str(row.get("Duracion") or "<vacío>")] += 1
    item["cuotas"][str(row.get("Cuotas") or "<vacío>")] += 1
    if premio is not None and installment not in (None, 0):
        item["premio_sobre_cuota"][ratio_bucket(premio / installment)] += 1
        if abs(premio - installment) <= 0.02:
            item["premio_eq_cuota"] += 1
    if prima is not None and installment not in (None, 0):
        item["prima_sobre_cuota"][ratio_bucket(prima / installment)] += 1
        if abs(prima - installment) <= 0.02:
            item["prima_eq_cuota"] += 1

out = {}
for company, item in audit.items():
    out[company] = {key: (dict(value.most_common()) if isinstance(value, Counter) else value) for key, value in item.items()}
print(json.dumps(out, ensure_ascii=False, indent=2))
