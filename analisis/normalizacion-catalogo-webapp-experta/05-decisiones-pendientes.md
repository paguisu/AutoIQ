# 5. Decisiones pendientes

Estas decisiones no bloquean el análisis, pero sí conviene cerrarlas antes de modificar producción.

## Ranking después de desagrupar

Propuesta: conservar `ranking_origen` y usar `subranking_desempate`. Así Palio y Siena pueden heredar la posición 10 sin renumerar toda la marca. Más adelante se puede definir un ranking independiente por marca y año.

## Modelos históricos visibles

Qashqai y Tiida no aparecen en el rango actualmente disponible del catálogo de modelos de Experta. Decidir si siguen visibles por valor comercial/histórico y se resuelven por InfoAuto, o si se ocultan en años sin correspondencia confirmada.

## Familias Citroën

Experta expone C3, C4 y C5 como modelo y deriva Aircross, Cactus o Lounge a la versión. Propuesta: conservar las etiquetas específicas en UX sólo cuando una regla año–versión pueda garantizar que no se mezclen resultados.

## Marcas legacy

Journey y RAM históricos pueden requerir `CHRYSLER` en Experta aunque se muestren como Dodge. Propuesta: aceptar la diferencia mediante la tabla de correspondencias, sin modificar la marca visible.

## Alcance del catálogo inicial

La tabla actual es un ranking curado de 120 entradas, no un catálogo vehicular completo. Decidir si la Webapp:

- muestra primero los modelos curados y permite buscar el catálogo completo; o
- limita la navegación sólo a los modelos curados.

La primera alternativa maximiza cobertura sin perder el orden comercial.

## Fuente maestra

Propuesta: la identidad de versión se apoya en InfoAuto; Experta aporta catálogo y código propio; la capa canónica de la Webapp mantiene nombres visibles y aliases. Ningún proveedor individual debería ser la única fuente maestra de toda la taxonomía.

