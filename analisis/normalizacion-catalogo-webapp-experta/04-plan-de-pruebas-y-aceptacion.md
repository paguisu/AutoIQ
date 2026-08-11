# 4. Plan de pruebas y aceptación

## Pruebas de datos

- No existen marcas visibles con `/`.
- Ningún modelo visible comienza con su propia marca.
- `Palio` y `Siena` tienen IDs distintos.
- `207/207 Compact` no aparece como modelo visible.
- `I10` se muestra sin espacio y resuelve `I 10` en Experta.
- Los aliases son únicos dentro de una marca/modelo.
- Cada registro conserva `marca_grupo_original` y `modelo_original`.
- No hay IDs duplicados.

## Pruebas de resolución

Casos mínimos por año disponible:

- Hyundai I10.
- Jeep Renegade y Compass.
- Hyundai Tucson y Santa Fe.
- Kia Sportage.
- Peugeot 207 con una versión Compact.
- Fiat Palio y Siena.
- Citroën C4 Lounge y C4 Cactus, verificando que no se crucen versiones.
- Dodge Journey, verificando traducción visible Dodge → Experta CHRYSLER.

Para cada caso se valida: marca enviada, modelo enviado, lista de versiones, código InfoAuto y descripción elegida.

## Pruebas de contrato

- Los endpoints existentes continúan respondiendo durante la transición.
- Los IDs nuevos no rompen campos obligatorios actuales.
- La Webapp pública no consume rutas de la UI interna.
- Los errores del proveedor no exponen credenciales ni payloads sensibles.

## Pruebas de UX

- No se muestran marcas combinadas.
- No se repite la marca en el modelo.
- La búsqueda por `Renagade` sugiere `Renegade` sin guardar el typo.
- La búsqueda por `I 10` y `Hyundai i10` encuentra `I10`.
- Cambiar el año invalida una versión que ya no sea compatible.
- Volver atrás conserva una selección válida o explica por qué se invalidó.

## Observabilidad

Registrar sin datos personales:

- año, ID interno, proveedor y resultado de resolución;
- alias utilizado;
- coincidencia exacta, por familia o manual;
- catálogo y fecha de actualización;
- ausencia o ambigüedad de versión.

## Criterio de aceptación

La migración puede activarse cuando los casos de referencia pasan, no hay aliases ambiguos activos, los casos pendientes tienen decisión explícita y los requests de cotización conservan códigos/valores correctos para cada aseguradora.

