# Operación, despliegue y soporte

## Configuración persistente

AutoIQ carga una única `.env` desde la raíz antes de importar DB/rutas. La plantilla versionada es `.env.example`; la `.env` real no se versiona. Obligatorios según uso: `PORT`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SEGUROS911_SERVICE_SECRET` y credenciales de cada compañía habilitada. Seguros911 requiere `AUTOIQ_BASE_URL`, `AUTOIQ_SERVICE_SECRET` y su timeout.

El incidente observado (worktree sin `.env`, luego sin secreto y después sin DB) se evita con esta secuencia única: provisionar `.env` desde el gestor de secretos → validar variables requeridas → iniciar DB → iniciar AutoIQ → comprobar `/health` y GET HMAC → iniciar Seguros911 → smoke test de catálogo y cotización. No copiar `.env` entre repositorios ni duplicar secretos en scripts.

Desarrollo puede usar HTTP sólo en loopback; prueba/producción requieren HTTPS, DB persistente y secretos administrados. Health actual sólo demuestra que Express responde, no DB/proveedores: health profundo es deuda técnica.

## Timeouts y reintentos

Seguros911 usa el timeout configurado; sync de catálogos admite hasta 4 minutos. Los adaptadores tienen configuración propia. Reintentar GET/PUT con backoff y jitter; no reintentar POST/PATCH no idempotentes tras una respuesta incierta. Circuit breaker y `retryable` prevalecen sobre reintentos genéricos.

## Catálogo de errores

| Clase/código | HTTP típico | Retry | UI / acción |
|---|---:|---|---|
| validación local | 400 | no | corregir riesgo |
| `INVALID_SERVICE_SIGNATURE` | 401 | no inmediato | revisar reloj/canonical/secreto |
| `REPLAYED_SERVICE_REQUEST` | 401 | con nonce nuevo sólo si operación segura | regenerar nonce |
| `INSUFFICIENT_ROLE` | 403 | no | elevar rol autorizado |
| `SERVICE_AUTH_NOT_CONFIGURED` / `AUTOIQ_NOT_CONFIGURED` | 503 | tras configurar | completar secretos/base URL |
| DB no disponible | 500/502 | sí con backoff | restaurar DB |
| compañía/credencial no configurada | resultado técnico | tras configurar | habilitar credencial |
| timeout/circuit breaker | parcial/pending | según `retryable` | esperar/reanudar |
| catálogo/mapeo/respuesta inválida | 400 o parcial | no ciego | refrescar catálogo/revisar adapter |
| rechazo comercial/sin coberturas | resultado válido | no técnico | explicar al usuario |
| proceso parcial | 200 con estado/resumen | por compañía | conservar resultados válidos |

Fuera de HMAC todavía no hay códigos estables uniformes; es deuda técnica y no se reestructuró aquí.

## Runbook seguro

```powershell
Invoke-WebRequest http://127.0.0.1:3000/health
Get-Content .\data\procesos\proceso-123\metadata.json
Get-Content .\data\procesos\proceso-123\run_end.json
Get-Content .\data\procesos\proceso-123\resultados\allianz.jsonl -Tail 5
```

No imprimir `.env`, headers HMAC ni `raw`. Para firma inválida: comparar método, path+query, timestamp ms y hash de los bytes exactos. Para DB caída: verificar conectividad y credenciales sin mostrarlas. Para proceso detenido: metadata, run_end, pendientes y circuit breaker. Para GNC ignorado se requieren cinco evidencias sanitizadas: input original, input efectivo, request proveedor, response proveedor y resultado normalizado; comparar premio es evidencia secundaria, no prueba.

Catálogo vencido: consultar estado y ejecutar sync autorizado. Diferencias Webapp/AutoIQ: correlacionar `sessionUuid`/oportunidad con `historial_id`/`proceso_id`, preservando PII fuera de logs.

