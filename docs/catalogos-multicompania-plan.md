# Plan de implementación segura: Gestión de tablas por compañía

Este plan propone incorporar una pestaña de **Gestión de tablas** por aseguradora, sin romper el flujo actual de cotización.

## Objetivos

1. Separar catálogos por compañía (`atm`, futuras compañías, etc.).
2. Permitir actualización manual por tabla y masiva por compañía.
3. Generar reportes descargables de novedades (altas, bajas, cambios).
4. Mantener compatibilidad con lo que hoy funciona.

## Principios de no-regresión

- No modificar rutas existentes usadas por cotización (`/proceso`, `/cabeceras`, `/cotizacion`).
- Agregar nuevas rutas bajo un prefijo nuevo: `/catalogos`.
- Mantener estructura actual de `data/atm/diccionarios/*.json` como fuente vigente durante transición.
- Activar UI nueva detrás de flag (`CATALOGOS_UI_ENABLED`) hasta terminar validación.

## Modelo de datos sugerido

```text
data/
  catalogos/
    atm/
      ws_au_usos/
        current.json
        history/2026-03-10T18-00-00Z.json
      ws_au_rastreo_satelital/
        current.json
        history/2026-03-10T18-00-00Z.json
      reports/
        run-2026-03-10T18-00-00Z.json
        run-2026-03-10T18-00-00Z.csv
    <otra_compania>/...
```

## Endpoints nuevos (sin tocar los existentes)

- `GET /catalogos/companias`
  - Lista compañías configuradas.
- `GET /catalogos/:slug/tablas`
  - Lista tablas disponibles para la compañía.
- `POST /catalogos/:slug/sync/:tabla`
  - Ejecuta actualización de una tabla.
- `POST /catalogos/:slug/sync-all`
  - Ejecuta actualización de todas las tablas.
- `GET /catalogos/:slug/reportes/:runId`
  - Devuelve reporte JSON.
- `GET /catalogos/:slug/reportes/:runId.csv`
  - Descarga CSV de novedades.

## Formato del reporte de novedades

```json
{
  "runId": "run-2026-03-10T18-00-00Z",
  "compania": "atm",
  "tabla": "ws_au_rastreo_satelital",
  "resumen": {
    "altas": 2,
    "bajas": 1,
    "modificados": 3,
    "sin_cambios": false
  },
  "altas": [{ "codigo": "99", "descripcion": "Nuevo rastreo" }],
  "bajas": [{ "codigo": "13", "descripcion": "Proveedor legacy" }],
  "modificados": [
    {
      "codigo": "5",
      "antes": { "descripcion": "Pago contado" },
      "despues": { "descripcion": "Pago contado/transferencia" }
    }
  ]
}
```

## Estrategia de comparación (diff)

1. Normalizar registros por clave primaria (`codigo` o configurable por tabla).
2. Indexar `anterior` y `nuevo` por clave.
3. Detectar:
   - **altas**: está en nuevo y no en anterior.
   - **bajas**: está en anterior y no en nuevo.
   - **modificados**: misma clave, distinto contenido normalizado.

## Hoja de ruta en 3 PRs

### PR 1 (backend base, sin UI)

- Crear módulo `backend/services/catalogos/` con:
  - lectura/escritura snapshot,
  - diff,
  - generación JSON/CSV de reporte.
- Exponer endpoints `/catalogos/*` en modo local (fuente: archivos JSON).
- Sin afectar ninguna ruta actual.

### PR 2 (UI en Base Propia, protegida por flag)

- Reemplazar contenido de pestaña "Base Propia" por:
  - selector de compañía,
  - listado de tablas,
  - acciones de sync,
  - descarga de reporte.
- Activación por `CATALOGOS_UI_ENABLED=true`.

### PR 3 (jobs y proveedores reales)

- Agregar scheduler opcional (`node-cron`) para sync periódico.
- Conectar proveedores reales por compañía (ATM primero).
- Telemetría de runs y tiempos.

## Checklist de implementación local

1. Crear rama `feat/catalogos-multicompania`.
2. Implementar PR 1 y validar endpoints nuevos con Postman/curl.
3. Confirmar que `/proceso/ejecutar` y cabeceras siguen funcionando.
4. Implementar PR 2 y habilitar flag en entorno dev.
5. Probar reporte de novedades con una tabla de ejemplo.
6. Integrar PR 3 sólo después de validar operación manual.

## Riesgos y mitigación

- **Riesgo**: sobreescribir catálogos usados por producción.
  - **Mitigación**: snapshots versionados + `current.json` atómico.
- **Riesgo**: cambios de contrato por compañía.
  - **Mitigación**: adaptadores por compañía (`providers/<slug>.js`).
- **Riesgo**: confundir usuarios con tablas de distintas compañías.
  - **Mitigación**: segmentación explícita por `slug` y badges visuales.