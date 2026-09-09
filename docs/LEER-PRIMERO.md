# LEER PRIMERO — Integración Seguros911 → AutoIQ

Este paquete documenta cómo el backend de Seguros911 debe pedir una cotización individual a AutoIQ y cómo debe entregar el resultado a su UI o Webapp.

Seguros911 no utiliza aquí el cotizador masivo. La UI/Webapp nunca debe llamar directamente a AutoIQ ni conocer el secreto de integración.

## Orden recomendado de lectura

1. **`integracion-seguros911-consumo-cotizacion.md`**  
   Documento principal. Describe el flujo completo: datos capturados por la UI, validaciones del backend Seguros911, armado del riesgo, creación del input en AutoIQ, creación y ejecución del proceso, polling, resultados y extensiones futuras como uso comercial o motos.

2. **`integracion-seguros911-seguridad.md`**  
   Explica cómo el backend Seguros911 firma las llamadas con HMAC, cuáles son los headers obligatorios, cómo se construye la firma y cómo tratar errores, replay y rotación del secreto.

3. **`integracion-seguros911-operacion.md`**  
   Runbook de configuración, arranque y diagnóstico. Sirve para investigar problemas de conexión, base de datos, procesos detenidos, catálogos, timeouts o diferencias entre la solicitud y la respuesta.

4. **`integracion-seguros911-aseguradoras.md`**  
   Referencia sobre cómo AutoIQ traduce el mismo riesgo al protocolo de cada compañía. Seguros911 no debe implementar esas diferencias; sólo debe enviar correctamente el riesgo común.

5. **`openapi/seguros911-private-api.yaml`**  
   Especificación técnica verificable de la API privada HMAC: productores, condiciones comerciales, catálogos y preparación del input individual.

6. **`openapi/examples/`**  
   Requests y responses sanitizados. Sirven como fixtures para implementar o probar el cliente de Seguros911.

## Qué archivo usar según la tarea

| Necesidad | Archivo |
|---|---|
| Implementar o corregir `/cotizar` en Seguros911 | `integracion-seguros911-consumo-cotizacion.md` |
| Agregar un campo nuevo al riesgo | guía principal + OpenAPI + ejemplo correspondiente |
| Incorporar uso comercial o motos | sección “Cómo extender mañana” de la guía principal |
| Corregir firma inválida o autorización | `integracion-seguros911-seguridad.md` |
| Diagnosticar timeout, DB o proceso detenido | `integracion-seguros911-operacion.md` |
| Entender por qué una compañía recibe otro formato | `integracion-seguros911-aseguradoras.md` |
| Generar tests automáticos del cliente | OpenAPI y `openapi/examples/` |

## Reglas que no deben romperse

- La UI/Webapp llama al backend Seguros911; sólo el backend llama a AutoIQ.
- Seguros911 envía una cotización individual con datos completos y códigos de catálogo, no sólo etiquetas visibles.
- AutoIQ recibe un riesgo común y se ocupa de traducirlo para todas las compañías solicitadas.
- Los hechos del riesgo —vehículo, uso, ubicación, GNC, 0 km y rastreo— deben enviarse explícitamente y no depender de condiciones comerciales.
- Seguros911 debe persistir `historial_id` y `proceso_id` para trazabilidad.
- Un proceso terminado puede ser parcial; Seguros911 debe revisar resultados por compañía.
- Nunca se expone a la UI el secreto HMAC, las credenciales de compañías ni el `raw` del proveedor.

## Estado conocido que requiere ajuste en Seguros911

El schema normal de `/cotizar` acepta actualmente `gnc=true` sin exigir un `gncMonto` positivo. La recotización de oportunidades sí realiza esa comprobación. Ambas entradas deberían aplicar la misma validación antes de llamar a AutoIQ.

