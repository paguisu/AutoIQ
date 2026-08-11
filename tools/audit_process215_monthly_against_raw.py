import json
import math
import sys
from collections import defaultdict

sys.path.insert(0, "tools")
from analyze_process_172_vs_215 import norm, num, rows

BASE = "data/procesos/proceso-215"
COMPANIES = ["allianz", "atm", "experta", "mapfre", "mercantil_andina", "meridional",
             "provincia", "rivadavia", "sancor", "smg", "victoria"]


def close(a, b):
    return a is not None and b is not None and abs(a - b) <= 0.03


def expected(company, cov):
    if company == "allianz":
        return num(cov.get("importePremio")), num(cov.get("importePrima")), num(cov.get("importePremio"))
    if company == "atm":
        cuotas = num(cov.get("cuotas")) or 1
        return num(cov.get("impcuotas")), (num(cov.get("prima")) or 0) / cuotas, num(cov.get("impcuotas"))
    if company == "experta":
        return num(cov.get("importePremio")), num(cov.get("importePrima")), num(cov.get("importePremio"))
    if company == "mapfre":
        return num(cov.get("montoPrimeraCuota")), num(cov.get("montoPrimaTotal")), num(cov.get("montoPremio"))
    if company in {"mercantil_andina", "meridional", "provincia", "smg", "victoria"}:
        return num(cov.get("importeCuota") or cov.get("premioMensual") or cov.get("premiumMonthly") or cov.get("importePremio")), \
               num(cov.get("primaMensual") or cov.get("importePrima")), \
               num(cov.get("premioMensual") or cov.get("premiumMonthly") or cov.get("importePremio"))
    if company == "rivadavia":
        return num(cov.get("importeCuota") or cov.get("premioMensual")), None, num(cov.get("premioMensual") or cov.get("importeCuota"))
    if company == "sancor":
        return num(cov.get("premiumMonthly") or cov.get("premio")), \
               num(cov.get("purePremiumMonthlyTotal") or cov.get("importePrima")), \
               num(cov.get("premiumMonthly") or cov.get("premio"))
    return None, None, None


excel = defaultdict(list)
for row in rows(f"{BASE}/descargas/proceso-215-cotizaciones.xlsx"):
    company = norm(row.get("Aseguradora")).lower().replace(" ", "_")
    index = int(float(str(row.get("Fila") or 0)))
    excel[(company, index)].append((num(row.get("Importe Cuota")), num(row.get("Prima Mensual")), num(row.get("Premio Mensual"))))

report = {}
for company in COMPANIES:
    counts = {"raw_rows": 0, "excel_rows": 0, "coverage_count_mismatch": 0,
              "importe_cuota_ok": 0, "importe_cuota_bad": 0,
              "prima_mensual_ok": 0, "prima_mensual_missing_derivable": 0, "prima_mensual_legit_empty": 0, "prima_mensual_bad": 0,
              "premio_mensual_ok": 0, "premio_mensual_bad": 0}
    with open(f"{BASE}/resultados/{company}.jsonl", encoding="utf-8") as handle:
        for line in handle:
            item = json.loads(line)
            if not item.get("ok"):
                continue
            index = int(item.get("index"))
            raw_covs = item.get("coberturas") or []
            excel_covs = excel.get((company, index), [])
            counts["raw_rows"] += len(raw_covs)
            counts["excel_rows"] += len(excel_covs)
            if len(raw_covs) != len(excel_covs):
                counts["coverage_count_mismatch"] += 1
                continue
            for cov, actual in zip(raw_covs, excel_covs):
                exp = expected(company, cov)
                counts["importe_cuota_ok" if close(actual[0], exp[0]) else "importe_cuota_bad"] += 1
                if exp[1] is None:
                    counts["prima_mensual_legit_empty" if actual[1] is None else "prima_mensual_bad"] += 1
                elif actual[1] is None:
                    counts["prima_mensual_missing_derivable"] += 1
                else:
                    counts["prima_mensual_ok" if close(actual[1], exp[1]) else "prima_mensual_bad"] += 1
                counts["premio_mensual_ok" if close(actual[2], exp[2]) else "premio_mensual_bad"] += 1
    report[company] = counts

print(json.dumps(report, ensure_ascii=False, indent=2))
