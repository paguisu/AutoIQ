# Matriz de aseguradoras

Estado basado en adaptadores y tests del checkout; “llamada real” sólo cuando la metadata/configuración lo afirma explícitamente. Timeouts concretos dependen de configuración del cliente/proveedor.

| Compañía | Protocolo/auth | GNC (indicador / suma) | Uso/rastreo/0km | Estado y tests |
|---|---|---|---|---|
| Allianz | SOAP, usuario/clave | accesorio catálogo / `sumaAccesorio` | sí/parcial/sí | validado mediante `allianz.quote.test.js` |
| ATM | SOAP/API key | `gnc` / `suma_gnc` | sí/sí/sí | validado por tests de proceso/catálogos |
| Experta | REST, login/API key | `gnc=501` / `valorGnc` | sí/parcial/sí | validado mediante `experta.quote.test.js` |
| Mapfre | SOAP, agente/clave | `conGNC` / `valorGNC` | sí/parcial/sí | tests + sugerencia; proveedor real pendiente |
| Mercantil Andina | REST/OAuth+subscription | `vehiculo.gnc` / sin suma separada | sí/parcial/sí | adaptador indica validación real; `mercantil_andina.quote.test.js` |
| Meridional | SOAP, credenciales | accesorio / suma separada | sí/sí/sí | validado mediante test; real pendiente |
| Provincia | REST/OAuth | `montoAccesorios` (total accesorios) | sí/parcial/sí | validado mediante test |
| Rivadavia | REST/SOAP, OAuth/productor | `POSEE_GNC` o `PoseeGNC` / suma accesorios | sí/parcial/sí | validado mediante test; ramas múltiples |
| Sancor | SOAP/token | `HasGNC` / `GNCValue` | sí/parcial/sí | validado mediante auth/quote tests |
| SMG | SOAP, usuario/clave | `nMontoGNC` (0 o monto) | sí/sí/sí | validado mediante test |
| Victoria | REST/MultiPas | `vehicle.gnc` / no suma observada | sí/sí/sí | validado mediante test; soporte de suma parcial |
| Nación | SOAP/token; portal cotizador 202607 y WSDL recuperado | WS documenta `EQUIPO_GNC` (`S`/blanco) y `EQUIPO_GNC_SUMA` condicional | WS: uso 1/2 y `ES_0KM`; rastreo no documentado | Login/renew y WSDL validados en producción; auth corregido con caché. Cotización desactivada: faltan request/parser y prueba real; productor pendiente |

Para Nación, distinguir soporte documentado del proveedor de soporte implementado en AutoIQ. El portal confirma GNC y suma del equipo; el borrador local todavía no los envía. Ver [relevamiento revisado](nacion-seguros-relevamiento-2026-09-09.md) y [contrato oficial 202607](https://nsd.nacion-seguros.com.ar/apis/#api-030-01).

“Soporta GNC” significa que el request del adapter contiene un campo verificable, no que la matriz comercial tenga una opción. La respuesta rara vez confirma GNC: la evidencia primaria es el request sanitizado y la aceptación del proveedor. Principales fallos comunes: credencial, catálogo/código, localidad, vehículo no asegurable, timeout, respuesta inválida y rechazo comercial. Los reintentos sólo corresponden a transporte/timeout marcados recuperables.
