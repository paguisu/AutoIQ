---
name: autoiq-core-guardrails
description: Preservar la compatibilidad operativa y el contrato de salida de AutoIQ al modificar flujos de cotizacion, consolidacion, Excel final, resumenes de proceso o integraciones de aseguradoras. Usar cuando una tarea toque `backend/routes/proceso.js`, `backend/routes/cotizacion.js`, `backend/routes/cabeceras.js`, `backend/services/*`, `backend/tests/*` o cualquier cambio que pueda afectar funcionalidades existentes, el esquema canonico del Excel, la respuesta consumida por la webapp o la consistencia entre aseguradoras.
---

# AutoIQ Core Guardrails

## Overview

Usar este skill para trabajar en AutoIQ sin romper comportamiento existente ni degradar el contrato comun entre aseguradoras. Tratar este skill como un set de invariantes de arquitectura y de entregable, no como una guia cosmetica.

Leer primero [references/contracts.md](references/contracts.md). Si la tarea toca el Excel final o cualquier normalizacion de salida, leer tambien [references/excel-schema.md](references/excel-schema.md).

## Workflow

### 1. Clasificar el cambio antes de editar

- Determinar si el cambio es:
  - especifico de una aseguradora,
  - de normalizacion comun,
  - de contrato de salida,
  - o de validacion/observabilidad.
- Mantener la logica especifica de aseguradora dentro de su modulo o adaptador siempre que sea posible.
- Evitar mover reglas de una aseguradora al flujo general salvo que la normalizacion aplique realmente a todas.

### 2. Reunir contexto minimo pero suficiente

- Si el cambio afecta el Excel o la consolidacion, revisar `backend/routes/proceso.js`.
- Si el cambio afecta inicio/seguimiento de procesos, revisar `backend/routes/cotizacion.js`.
- Si el cambio afecta cabecera o defaults de entrada, revisar `backend/routes/cabeceras.js`.
- Si el cambio afecta una aseguradora puntual, revisar `backend/services/<slug>/quote.js` y sus tests asociados.
- Tratar los archivos historicos y los Excels de prueba como evidencia util, no como autoridad final del contrato.

### 3. Proteger contratos antes de implementar

- No eliminar ni modificar funcionalidades existentes sin justificacion explicita.
- No simplificar archivos grandes solo por estilo si eso altera comportamiento, trazabilidad o puntos de extension.
- No cambiar endpoints, rutas ni formatos de respuesta operativos sin aprobacion explicita.
- No alterar el flujo general de cotizacion, procesos y consolidacion si la tarea no lo exige.
- Considerar `references/excel-schema.md` como contrato canonico objetivo del Excel aunque la implementacion actual todavia no este completamente alineada.

### 4. Implementar con aislamiento y compatibilidad

- Para una nueva aseguradora:
  - agregar o ajustar su servicio,
  - adaptar su parseo,
  - normalizar la salida al esquema comun,
  - y evitar tocar integraciones existentes salvo necesidad real.
- Para campos faltantes:
  - calcularlos si la fuente lo permite con una regla general y defendible;
  - dejarlos vacios si no hay una derivacion confiable;
  - no crear columnas alternativas para resolver una ausencia.
- Cuando el codigo actual use nombres de columnas distintos del canon objetivo, preferir una migracion controlada y explicita en vez de propagar nomenclaturas mezcladas.

### 5. Validar entregables

- Verificar siempre el Excel final `Cotizaciones` y, si aplica, la respuesta consumida por la webapp.
- Confirmar:
  - estructura,
  - orden de columnas,
  - consistencia entre aseguradoras,
  - tipos de dato razonables,
  - legibilidad,
  - y ausencia de cambios cosmeticos innecesarios.
- Si el cambio toca salida canonicamente visible, revisar tambien muestras reales en `data/procesos/*/resumen.json` o `excel_manifest.json` cuando existan.

## Guardrails Especificos

### Preservacion del sistema

- Mantener compatibilidad con las aseguradoras actuales.
- Evitar regresiones silenciosas en rutas, consolidacion o armado de resultados.
- Preferir cambios localizados, testeables y reversibles.

### Esquema unico de salida

- Mantener un unico contrato de columnas para el Excel final.
- No agregar, eliminar, renombrar ni reordenar columnas sin validacion explicita.
- Tratar cada fila del Excel como una cotizacion individual comparable con el resto.
- Separar con claridad columnas de request, columnas inferidas y columnas devueltas por aseguradora.

### Consistencia multiaseguradora

- No crear columnas alternativas para una misma informacion.
- Normalizar datos para compararlos entre aseguradoras.
- Si una aseguradora no provee un dato, mantener la estructura; calcular solo cuando la derivacion sea confiable.
- Mantener la heuristica comun en la capa comun y la traduccion puntual en la capa especifica de cada aseguradora.

### Integracion de nuevas aseguradoras

- Integrar nuevas aseguradoras sin modificar el comportamiento de las existentes.
- Encajar la respuesta nueva en el esquema comun en lugar de expandir el esquema para una sola compania.
- Agregar tests o adaptar los existentes para demostrar que la integracion respeta el contrato comun.

## Notas de Implementacion Actual

- La implementacion actual en `backend/routes/proceso.js` exporta un Excel canonico con nombres visibles distintos de la nomenclatura objetivo acordada en `references/excel-schema.md`.
- Tratar esa diferencia como deuda de alineacion, no como razon para abandonar la nomenclatura objetivo.
- Si una tarea exige convivir temporalmente con ambas nomenclaturas, documentar el puente de compatibilidad en el cambio y no mezclar conceptos distintos bajo el mismo nombre.

## Referencias

- [references/contracts.md](references/contracts.md): invariantes del sistema y criterio de compatibilidad.
- [references/excel-schema.md](references/excel-schema.md): contrato canonico objetivo del Excel y observaciones de mapeo con la implementacion actual.
