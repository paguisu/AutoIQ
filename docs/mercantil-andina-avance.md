# Mercantil Andina - avance de integracion

Fecha: 2026-08-05

## Estado

- Login validado contra produccion.
- Cotizacion real validada contra produccion.
- La compania quedo activa en `data/mercantil_andina/aseguradora.json`.
- El adapter existente de Mercantil Andina ya esta conectado al flujo de AutoIQ.
- Queda pendiente retomar con una corrida operativa desde proceso/UI y revisar salida final.

## Credenciales y endpoint

Mercantil Andina envio credenciales nuevas para produccion.

Configuracion actualizada en:

- `data/mercantil_andina/aseguradora.json`

Valores operativos relevantes:

- `base_url`: `https://api.mercantilandina.com.ar`
- `auth_url`: `https://api.mercantilandina.com.ar/credenciales/v2/`
- `soap_path`: `/cotizaciones/v2/auto`
- `client_id`: `api-clientes-login`
- `usuario`: actualizado a usuario productivo recibido
- `subscription_key`: actualizada a la nueva key recibida
- `producer_code`: `98082`
- `comision`: `20`
- `bonificacion`: `20`
- `descuento_comercial`: `20`

Tambien se agrego bloque de variables en `.env.example` con `MERCANTIL_ANDINA_*`, sin secretos.

## TLS / Avast

Problema detectado:

- `curl.exe` autenticaba correctamente porque usa el almacen de certificados de Windows.
- Node/Axios fallaba con `unable to verify the first certificate` por inspeccion TLS de Avast.

Solucion aplicada:

- Se exporto el certificado Avast actual a PEM:
  - `tools/avast-root-current.pem`
- Se agrego helper propio:
  - `backend/services/mercantil_andina/tls.js`
- `backend/services/mercantil_andina/auth.js` y `client.js` ahora usan ese CA automaticamente si existe.

Resultado:

- Mercantil Andina funciona sin depender de levantar el backend con variables manuales.
- No se desactiva validacion TLS.
- No se usa `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Pruebas realizadas

### Login directo

Con la nueva Subscription Key:

- HTTP exitoso.
- Token Bearer recibido.
- `expires_in`: `3600`.

### Login desde adapter AutoIQ

Usando `fetchMercantilAndinaToken(...)`:

- OK.
- Token Bearer recibido.
- Sin setear `NODE_EXTRA_CA_CERTS` manualmente luego del helper TLS.

### Cotizacion real

Se uso la fila de evidencia del proceso 197:

- Archivo base: `data/procesos/proceso-197/evidencias/mercantil_andina/fila-0000/fila_input.json`
- Vehiculo: NISSAN KICKS 1.6 EXCLUSIVE CVT L/22
- CP: `1718`
- Localidad: SAN ANTONIO DE PADUA

Resultado final validado:

- HTTP: `201`
- `ok`: `true`
- Operacion: `597326728`
- Coberturas: `11`

Una prueba anterior de la misma fila, antes de resolver TLS/key, fallaba con:

- `unable to verify the first certificate`

## Tests

Comando ejecutado:

```powershell
npm test -- --runInBand backend/tests/mercantil_andina.quote.test.js
```

Resultado:

- 11 tests OK.

Cubre:

- armado de payload;
- comision y bonificacion;
- 0km;
- localidad explicita y fallback por CP;
- forma de pago;
- parseo exitoso;
- parseo de error funcional;
- headers de cliente;
- body/headers de login;
- login + cotizacion mockeados con Bearer token.

## Pendiente para retomar

1. Ejecutar una corrida desde AutoIQ/UI con `mercantil_andina` incluida.
2. Revisar evidencias:
   - `mercantil_andina-json_request.json`
   - `mercantil_andina-raw_response.json`
   - `mercantil_andina-parsed.json`
   - `mercantil_andina-coberturas.json`
3. Revisar `resumen.json` y que `resultados.mercantil_andina` quede con el shape comun.
4. Descargar/revisar Excel final, hoja `Cotizaciones`.
5. Confirmar que la Webapp/Seguros911 consume `mercantil_andina` sin catalogo hardcodeado adicional.
6. Si la corrida larga de hoy genera proceso nuevo, usarlo como evidencia real para cerrar la integracion.

## Nota operativa

AutoIQ ya mantiene keep-awake durante `ejecutarProceso`, por lo que una corrida larga no deberia suspender la PC mientras el proceso siga `en curso`.
