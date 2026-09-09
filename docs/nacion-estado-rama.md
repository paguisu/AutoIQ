# Rama de integración Nación: estado inicial

Fecha: 2026-09-09. Rama `codex/nacion-seguros`, creada desde `origin/master` en `dddd2be9` (PR #13). Este archivo describe el estado de esta rama; los informes fechados conservan la evidencia obtenida de los checkouts originales y no afirman que todos esos cambios se hayan trasladado.

## Incorporado

- Avance previo de login JSON, renovación, caché y transporte con CA explícita de Nación, más sus tests.
- SOAPAction comprobado y WSDL sin credenciales.
- Correcciones comunes existentes: GNC declarado prevalece sobre perfil y la cabecera efectiva se conserva al generar Excel. No se cambian columnas.
- Pruebas del contrato privado y de firma; documentación de APIs y auditorías, con sus discrepancias pendientes identificadas.
- `NACION_PRODUCER_CODE` reservado, vacío, en `.env.example`. Es preparación del contrato de configuración: el borrador SOAP aún no lo consume.

## Productor y credenciales

El archivo privado actualizado de `D:/AutoIQ/web_services/Nacion Seguros/URL de acceso.txt` contiene ahora el código productor. Por lo tanto, **la falta del código ya no es un pendiente de recepción**. No se copió ese archivo ni sus valores al repositorio. Queda implementar la selección productor/ambiente/cotizador y validar el código con el servicio. El código recibido no prueba habilitación para todos los productores de Seguros911.

La ruta mencionada con `web/_services` no existe en este checkout; se verificó la ubicación anterior. No se copió `.env`, certificados ni credenciales a la nueva copia de trabajo.

## Separación del trabajo

Las carpetas originales permanecen intactas. Se guardó inventario SHA-256 de sus 145 archivos modificados/sin seguimiento y parches de cambios versionados en `D:/AutoIQ/tmp/nacion-branch-preparation`. Los archivos originales no se borran ni se guardan en stash.

No se trasladan a esta rama las modificaciones locales de Victoria, los catálogos descargados, la nueva columna de versión del Excel, normalización general de vehículos, sesiones, logs, temporales ni archivos de UI. Las APIs del PR #13 se toman de master; no se reaplican como si fueran nuevas.

Seguros911 tiene su rama `codex/nacion-seguros` desde `c36e253` de `main`. Allí sólo se trasladó el helper de diagnóstico de ofertas publicables y una prueba sintética; no se cambió el recorrido de publicación ni la UI. Los cambios comunes y los específicos de Nación se guardan en commits separados.

## Pendiente antes de cotizar y publicar

1. Recuperación de resultados JSONL por API y autenticación/contexto del ciclo de proceso.
2. Precedencia de uso, validación inicial/recotización, tipos de vehículo y captura en Webapp.
3. Tomador por solicitud y selección del productor Nación.
4. Request/parser SOAP vigente, token XML, GNC, 0 km y tratamiento de resultado incierto.
5. Importe mensual, período, cuota, cobertura e identidad de producto consistentes entre AutoIQ, Seguros911 y Excel.
6. Condiciones comerciales efectivamente admitidas, alta de compañía/habilitación y tablas reales con actualización.
7. Prueba integral por API y proveedor antes de activar.

Nación permanece desactivada y con `skeleton_only=true`. Estas ramas preparan la integración, no la dan por terminada. No se hicieron cotizaciones, emisiones ni cambios en bases operativas durante su preparación.

## Validación de la preparación

- AutoIQ: 41 pruebas entre auth Nación, borrador quote Nación, contrato Seguros911, firma, Excel y condiciones comerciales. Se resolvió la exportación de utilidades de prueba del middleware al trasladar el test; no se cambió su política de firma.
- Seguros911: una prueba aislada distingue coberturas recibidas, ofertas publicables y rechazos. No requiere DB ni API reales. El helper queda disponible; su conexión al servicio se revisará con la devolución integral.
- Los dos tests históricos de quote Nación sólo comprueban el borrador anterior; no validan el WSDL vigente.

Los documentos OpenAPI y sus ejemplos se conservan como material de trabajo con las discrepancias detalladas en `nacion-comparacion-documental-2026-09-09.md`; todavía no son un contrato reconciliado. Usar este estado y las auditorías para ordenar las próximas correcciones.
