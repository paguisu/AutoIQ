# Seguridad HMAC

Seguros911 lee `AUTOIQ_SERVICE_SECRET`; AutoIQ lee `SEGUROS911_SERVICE_SECRET`. Deben contener el mismo secreto, administrado fuera de Git, y la comunicación debe usar HTTPS en producción.

Headers obligatorios: `x-autoiq-timestamp` (epoch en milisegundos), `x-autoiq-nonce` (UUID recomendado) y `x-autoiq-signature` (hex minúsculo). Actor opcional: `x-autoiq-actor-id`, `x-autoiq-actor-name` codificado con `encodeURIComponent`, `x-autoiq-actor-role` (`supervisor`, `admin` o `superadmin` para mutaciones).

Algoritmo:

1. Serializar exactamente el JSON enviado con `JSON.stringify`; body ausente produce cadena vacía.
2. `bodyHash = SHA-256(bodyBytes UTF-8)` en hex.
3. Construir `METHOD + "\n" + PATH_WITH_QUERY + "\n" + TIMESTAMP + "\n" + NONCE + "\n" + bodyHash`.
4. `signature = HMAC-SHA-256(secret, canonical UTF-8)` en hex.

La URL canónica incluye path y query en el orden realmente enviado. AutoIQ tolera ±5 minutos. Cada nonce aceptado queda en memoria 5 minutos; un reinicio borra ese registro y múltiples instancias no comparten nonces: usar un store distribuido es deuda técnica.

| Caso | HTTP / código |
|---|---|
| secreto AutoIQ ausente | 503 `SERVICE_AUTH_NOT_CONFIGURED` |
| header faltante, firma inválida o reloj vencido | 401 `INVALID_SERVICE_SIGNATURE` |
| nonce repetido | 401 `REPLAYED_SERVICE_REQUEST` |
| rol insuficiente | 403 `INSUFFICIENT_ROLE` |

Rotación sin corte requiere una ventana dual-secret, todavía no implementada. Hasta resolverla: desplegar primero el nuevo secreto en AutoIQ y Seguros911 dentro de una ventana coordinada, verificar `/health` y un GET firmado, y retirar el anterior. Nunca registrar secretos, firmas, credenciales, PII, body completo ni `raw` de proveedores.

Los ejemplos válidos se generan en tests porque timestamp/nonce/firma expiran. `signature-invalid.json`, `nonce-replayed.json` y `clock-skew.json` muestran errores sanitizados.

