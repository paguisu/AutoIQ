# Preparación — normalización del catálogo vehicular de la Webapp

Fecha de corte: 7 de agosto de 2026.

Este paquete deja preparado el trabajo para implementar posteriormente dentro de `2-nuevo multi`. No se modificó ningún archivo de ese proyecto.

## Contenido

- `01-diagnostico-y-hallazgos.md`: análisis del problema, evidencia y criterios adoptados.
- `02-diseno-propuesto.md`: modelo de datos, reglas de aliases y resolución de versiones.
- `03-plan-de-implementacion-en-2-nuevo-multi.md`: secuencia concreta de cambios y migración.
- `04-plan-de-pruebas-y-aceptacion.md`: controles funcionales y técnicos.
- `05-decisiones-pendientes.md`: decisiones de producto que conviene cerrar antes de implementar.
- `archivos/tabla_webapp_original.csv`: copia de la tabla analizada, preservada sin cambios.
- `archivos/catalogo_modelos_propuesto.csv`: propuesta normalizada, lista para revisión.
- `archivos/aliases_modelos_propuestos.csv`: aliases de búsqueda y correspondencia.
- `archivos/casos_a_revisar.csv`: casos no confirmados automáticamente contra Experta.
- `archivos/experta_marcas_snapshot.json` y `experta_modelos_snapshot.json`: evidencia de los catálogos usados.
- `archivos/resumen_validacion.json`: métricas reproducibles del análisis.

## Cómo leer la propuesta

La identidad primaria es `marca_visible + modelo_visible`. El grupo o terminal original queda sólo como trazabilidad. El año no se incorpora a esa identidad: se aplica al consultar modelos y versiones en Experta.

Ejemplos:

| Antes | Propuesta visible | Consulta Experta |
|---|---|---|
| Hyundai/Kia — Hyundai i10 | Hyundai — I10 | HYUNDAI — I 10 |
| Chrysler/Jeep/RAM — Jeep Renegade | Jeep — Renegade | JEEP — RENEGADE |
| Fiat — Palio/Siena | Fiat — Palio y Fiat — Siena | dos modelos distintos |
| Peugeot — 207/207 Compact | Peugeot — 207 | 207; “Compact” se resuelve en versión |
| Citroën — C4 Cactus | Citroën — C4 Cactus | CITROEN — C4; “Cactus” se valida en versión |

## Reproducción

Desde `D:\AutoIQ`:

```powershell
node tools/generar-paquete-normalizacion-webapp.js
```

El script vuelve a generar los CSV y el resumen usando la tabla original y los diccionarios locales de Experta.

