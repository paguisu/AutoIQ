# 3. Plan de implementación posterior en `2-nuevo multi`

## Fase 0 — resguardo

1. Abrir el proyecto `2-nuevo multi` como workspace activo.
2. Confirmar el estado de Git y preservar cambios existentes.
3. Identificar si el CSV actual es fuente real de runtime, fuente editorial o sólo apoyo visual.
4. Identificar los endpoints reales de marcas, modelos y versiones. El maquetado observado usa `/catalogo/modelos` y `/catalogo/versiones`; esto debe confirmarse en el backend productivo.

## Fase 1 — modelo de datos

1. Crear tablas o archivos separados para marcas, modelos, aliases y correspondencias de proveedor.
2. No eliminar aún las columnas anteriores.
3. Cargar `catalogo_modelos_propuesto.csv` en una tabla staging.
4. Cargar `aliases_modelos_propuestos.csv` y validar unicidad.
5. Registrar fecha, fuente y versión del catálogo importado.

## Fase 2 — migración compatible

1. Incorporar IDs estables sin cambiar inicialmente el contrato público.
2. Traducir la respuesta nueva al formato que hoy consume la Webapp.
3. Separar las marcas agrupadas.
4. Dividir Palio/Siena.
5. Consolidar 207/207 Compact bajo 207 y resolver Compact en versiones.
6. Mantener temporalmente aliases para URLs, favoritos o datos persistidos que contengan nombres viejos.

## Fase 3 — resolución de versiones

1. Implementar consulta por año, marca Experta y modelo Experta.
2. Para familias C3/C4/C5, filtrar la lista de versiones con reglas explícitas y testeadas.
3. Priorizar coincidencia por `codigo_infoauto`.
4. Si falta código, usar atributos estructurados; similitud textual queda como sugerencia, no como selección automática.
5. Guardar texto y códigos originales de Experta para auditoría.

## Fase 4 — endpoints y UX

1. `/catalogo/marcas`: devolver marcas reales, activas y ordenadas.
2. `/catalogo/modelos?anio=&marca=`: devolver modelos visibles compatibles, con ID estable.
3. `/catalogo/versiones?anio=&modelo_id=`: devolver versiones resueltas y códigos requeridos.
4. La etiqueta visible debe ser `marca + modelo` sólo al presentar el vehículo completo; no dentro del campo modelo.
5. La búsqueda puede usar aliases, pero los resultados muestran el nombre canónico.

## Fase 5 — transición

1. Ejecutar ambos catálogos en paralelo detrás de una bandera.
2. Comparar selecciones y requests generados.
3. Medir modelos sin versión, aliases ambiguos y fallas por proveedor.
4. Activar gradualmente el catálogo nuevo.
5. Retirar compatibilidad vieja sólo después de validar datos persistidos y analítica.

## Orden técnico sugerido

1. Persistencia y migración.
2. Servicio de normalización puro, sin dependencias HTTP.
3. Adaptador Experta.
4. Endpoints.
5. Cambios de selector en Webapp.
6. Instrumentación y pruebas E2E.

## Reversibilidad

La primera puesta debe ser reversible mediante feature flag. No se debe reemplazar destructivamente el archivo actual: se conserva como fuente de trazabilidad y rollback durante la transición.

