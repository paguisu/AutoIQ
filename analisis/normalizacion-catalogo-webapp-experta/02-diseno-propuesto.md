# 2. Diseño propuesto

## Principios

1. La UX muestra nombres comerciales claros y estables.
2. Las integraciones reciben los valores exactos de cada proveedor.
3. Los aliases sólo ayudan a localizar una identidad; nunca crean por sí solos una versión válida.
4. El año participa en la resolución de catálogo, no en el nombre visible del modelo.
5. InfoAuto se conserva como clave de versión cuando esté disponible.
6. Toda transformación mantiene trazabilidad al dato original.

## Entidades recomendadas

### Marca

- `id_marca`: clave interna estable.
- `nombre_visible`: por ejemplo `Citroën`.
- `nombre_normalizado`: por ejemplo `CITROEN`.
- `activa_webapp`: controla exposición pública.
- `ranking`: orden comercial, separado de la identidad.

### Modelo

- `id_catalogo`: clave estable formada inicialmente como `MARCA:MODELO` normalizados.
- `id_marca`.
- `modelo_visible`: texto de UX, por ejemplo `I10`.
- `tipo`: clasificación editorial.
- `ranking_origen` y `subranking_desempate`.
- `activo_webapp`.
- metadatos visuales y prompt de imagen.

### Alias

- `id_catalogo`.
- `alias`: forma humana o de proveedor.
- `alias_normalizado`: mayúsculas sin tildes, espacios ni signos.
- `origen`: tabla actual, Experta o regla propuesta.

Debe existir una restricción única por `id_catalogo + alias_normalizado`. Un alias ambiguo entre dos modelos de una misma marca se rechaza o pasa a revisión.

### Correspondencia por proveedor

Una tabla separada evita agregar una columna nueva por cada aseguradora:

- `id_catalogo`.
- `proveedor`: `experta`, `infoauto`, etc.
- `anio_desde` / `anio_hasta`, cuando corresponda.
- `marca_proveedor`.
- `modelo_proveedor`.
- `tipo_regla`: exacta, alias, familia o legacy.
- `requiere_resolver_version`: booleano.
- `estado`: confirmado, revisar o inactivo.

### Versión

La versión debería almacenar:

- `codigo_infoauto` como referencia transversal cuando exista;
- código interno de Experta;
- descripción visible limpia;
- descripción exacta del proveedor;
- año;
- combustible, carrocería, puertas, cilindrada, transmisión y nivel de equipamiento cuando puedan inferirse con seguridad;
- texto original completo para auditoría.

No conviene intentar descomponer versiones sólo con una expresión regular definitiva. Debe existir un parser conservador y un estado `requiere_revision` para descripciones ambiguas.

## Regla de normalización

Para búsqueda se propone: Unicode NFD, eliminación de tildes, mayúsculas, eliminación de signos y espacios. Ejemplo: `X-Trail`, `X Trail` y `XTRAIL` producen `XTRAIL`.

La clave normalizada no reemplaza el texto visible ni el texto del proveedor. Se usa para candidatos y deduplicación.

## Resolución recomendada en la Webapp

1. El usuario elige año.
2. La Webapp muestra marcas comerciales activas.
3. Muestra modelos visibles compatibles con ese año según correspondencias confirmadas.
4. El backend traduce a marca/modelo exactos del proveedor.
5. Consulta versiones para ese año.
6. Usa `codigo_infoauto` para confirmar la versión cuando esté disponible.
7. Si hay más de una versión, la elección es explícita; no se selecciona por similitud débil.

## Tratamiento de ejemplos solicitados

| Marca visible | Modelo visible | Experta | Decisión |
|---|---|---|---|
| Hyundai | I10 | HYUNDAI / I 10 | alias tipográfico |
| Jeep | Renegade | JEEP / RENEGADE | quitar marca del modelo; aceptar typo `Renagade` sólo como alias de entrada |
| Jeep | Compass | JEEP / COMPASS | modelo independiente |
| Hyundai | Tucson | HYUNDAI / TUCSON | modelo independiente |
| Hyundai | Santa Fe | HYUNDAI / SANTA FE | modelo independiente |
| Kia | Sportage | KIA / SPORTAGE | modelo independiente |
| Peugeot | 207 | PEUGEOT / 207 | `Compact` se resuelve como versión |
| Fiat | Palio | FIAT / PALIO | separar |
| Fiat | Siena | FIAT / SIENA | separar |

## Lo que no se recomienda

- Guardar `Hyundai Tucson` como modelo si ya existe el campo marca.
- Usar una agrupación editorial como clave para cotizar.
- Elegir versiones por distancia de texto sin validar año y código InfoAuto.
- Sobrescribir el nombre visible con el nombre técnico de una aseguradora.
- Duplicar modelos sólo por puntuación o espaciado.

