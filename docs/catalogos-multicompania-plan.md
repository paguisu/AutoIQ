# Plan de implementación segura: Gestión de tablas por compañía

Objetivo: incorporar gestión de catálogos por aseguradora sin romper cotización actual.

## Fases
1) Backend `/catalogos` + snapshots + reportes.
2) UI en Base Propia (flag).
3) Jobs periódicos y proveedores reales.

## Endpoints
- GET /catalogos/companias
- GET /catalogos/:slug/tablas
- POST /catalogos/:slug/sync/:tabla
- POST /catalogos/:slug/sync-all
- GET /catalogos/:slug/reportes/:runId
- GET /catalogos/:slug/reportes/:runId.csv
