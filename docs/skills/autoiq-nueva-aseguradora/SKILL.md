---
name: autoiq-nueva-aseguradora
description: Integrar una aseguradora nueva o corregir de forma estructural una integracion existente en AutoIQ sin romper el flujo comun. Usar cuando haya que agregar un nuevo slug de aseguradora, crear su carpeta de configuracion en `data`, implementar archivos en `backend/services`, conectar el dispatcher en `backend/routes/proceso.js`, mapear request y response al contrato comun del Excel, o agregar tests especificos de quote, auth o client para una aseguradora.
---

# AutoIQ Nueva Aseguradora

## Overview

Usar este skill para onboardear o rearmar una integracion de aseguradora dentro del flujo real de AutoIQ. Este skill explica como sumar una compania al pipeline actual, no como redisenar toda la arquitectura.

Aplicar primero las reglas de `autoiq-core-guardrails`. Si ese skill todavia no esta instalado, leer:

- [../autoiq-core-guardrails/SKILL.md](../autoiq-core-guardrails/SKILL.md)
- [../autoiq-core-guardrails/references/contracts.md](../autoiq-core-guardrails/references/contracts.md)
- [../autoiq-core-guardrails/references/excel-schema.md](../autoiq-core-guardrails/references/excel-schema.md)

Leer tambien:

- [references/touchpoints.md](references/touchpoints.md)
- [references/adapter-contract.md](references/adapter-contract.md)
- [references/validation.md](references/validation.md)

## Workflow

### 1. Confirmar el tipo de trabajo

- Si la aseguradora ya existe y solo hay un ajuste puntual, tocar el adapter existente antes de crear archivos nuevos.
- Si el `slug` es nuevo, asumir que vas a necesitar cambios en `data/<slug>`, `backend/services/<slug>` y `backend/routes/proceso.js`.
- No asumir que alcanza con crear `data/<slug>/aseguradora.json`: el listado es dinamico, pero el dispatcher de cotizacion no.

### 2. Preparar la superficie de configuracion

- Crear `data/<slug>/aseguradora.json` con `activo`, `nombre_publico`, `base_url`, `soap_path` y los parametros propios de la compania.
- Crear `data/<slug>/diccionarios/*.json` solo si la integracion los necesita de verdad.
- Mantener la configuracion comun en JSON y las credenciales sensibles preferentemente sobreescribibles via env.
- Si la compania necesita tuning de concurrencia, reintentos o throttling, definirlo via `parametros_extras`.

### 3. Implementar el adapter de la aseguradora

- Poner la logica especifica en `backend/services/<slug>/`.
- Usar `quote.js` para construir request y parsear response.
- Agregar `auth.js`, `client.js` o `commons.js` solo si la aseguradora lo necesita.
- Mantener dentro del adapter:
  - transformaciones de request,
  - autenticacion,
  - parseo de response,
  - normalizacion de nombres propios de la compania.
- Evitar meter reglas cosmeticas o de Excel dentro del adapter; el objetivo es devolver un resultado normalizado y consistente.

### 4. Conectar la aseguradora al flujo actual

- Importar los helpers del adapter en `backend/routes/proceso.js`.
- Actualizar `loadAsegConfig(slug)` si la nueva compania necesita sobreescrituras por env.
- Agregar un branch explicito dentro de `cotizarFila(...)` para ese `slug`.
- Si la compania necesita validaciones especiales de CP, localidad, auth o retries, mantener esas reglas encapsuladas en su branch o en helpers propios.
- Tocar `getCompanyQueueConfig` solo si la compania realmente necesita un throttling distinto del default.

### 5. Normalizar la salida al contrato comun

- El resultado del adapter debe respetar el shape operativo documentado en [references/adapter-contract.md](references/adapter-contract.md).
- Priorizar nombres de propiedades ya consumidos por la normalizacion actual para no tocar de mas el builder del Excel.
- Devolver siempre:
  - `ok`,
  - `operacion`,
  - `suma_asegurada`,
  - `coberturas`,
  - `raw`,
  - `used`.
- Si hay fallos tecnicos o retryables, preservar la semantica actual de `pending`, `technical_error` y `retryable`.

### 6. Probar la integracion

- Idealmente agregar `backend/tests/<slug>.quote.test.js`.
- Agregar tests de `auth` o `client` si la compania tiene login separado o transporte no trivial y el cambio lo amerita.
- Cubrir como minimo:
  - armado de request,
  - parseo exitoso,
  - parseo de error,
  - y salida normalizada comparable con otras aseguradoras.
- No exigir validacion puntual de bonificacion o descuento en cada integracion nueva si no hace falta para cerrar el cambio.

### 7. Validar con artefactos reales

- Si hay credenciales y entorno disponibles, ejecutar una corrida controlada.
- Revisar:
  - `data/procesos/proceso-<id>/evidencias/<slug>/`,
  - `data/procesos/proceso-<id>/resumen.json`,
  - `data/procesos/proceso-<id>/excel_manifest.json`,
  - y el Excel final descargable.
- Confirmar que la nueva compania entra al mismo contrato comun sin agregar columnas ni romper otras integraciones.

## Reglas practicas

- Mantener la logica especifica de la compania fuera del flujo comun siempre que sea posible.
- Reusar nombres de campos ya reconocidos por la consolidacion antes de inventar nuevos.
- Dejar vacio un dato antes que mapearlo con una equivalencia dudosa.
- No tocar la estructura canonica del Excel para acomodar una compania.
- No dar por integrada una aseguradora solo porque devuelve HTTP 200; la integracion cierra cuando el Excel queda coherente y comparable.

## Heuristicas de salida

- Si la respuesta de la compania trae varias coberturas o planes, devolver una entrada por cobertura en `coberturas`.
- Si la compania solo devuelve un resultado resumido, construir igualmente una `coberturas` con el mejor nivel de detalle disponible.
- Guardar en `used` los parametros relevantes enviados, especialmente cuando despues impactan en lectura de negocio:
  - medio de pago,
  - cuotas,
  - bonificacion/descuento,
  - clausula de ajuste,
  - CP o match geografico,
  - productor o modalidad usada.

## Antipatrones

- No meter toda la implementacion nueva directamente en `backend/routes/proceso.js`.
- No devolver shapes distintos por aseguradora si el sistema ya sabe consumir un shape comun.
- No mezclar "dato que vino de response" con "dato inferido" sin dejar trazabilidad en `used` o en el mapping.
- No agregar columnas nuevas al Excel para salvar un parser incompleto.

## Referencias

- [references/touchpoints.md](references/touchpoints.md): mapa real de archivos y puntos de enganche.
- [references/adapter-contract.md](references/adapter-contract.md): shape operativo esperado del resultado y de `coberturas`.
- [references/validation.md](references/validation.md): checklist y comandos de prueba.
