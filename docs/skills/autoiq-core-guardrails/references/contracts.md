# AutoIQ Contracts

## Proposito

Definir las invariantes del sistema para que AutoIQ pueda evolucionar sin romper flujos operativos, integraciones existentes ni entregables consumidos por negocio.

## Jerarquia de verdad

1. El contrato aprobado por negocio para el entregable final.
2. La compatibilidad operativa del codigo actual en produccion o uso activo.
3. Los artefactos historicos del repo como evidencia util, pero no como definicion final.

En este skill, el contrato canonico objetivo del Excel vive en [excel-schema.md](excel-schema.md). La implementacion actual puede diferir parcialmente y debe migrarse con cuidado.

## Invariantes del sistema

### 1. Preservacion

- No eliminar ni modificar funcionalidades existentes sin justificacion explicita.
- No simplificar archivos existentes si eso cambia comportamiento, puntos de extension o trazabilidad.
- No cambiar endpoints ni rutas ya operativas sin aprobacion explicita.
- No alterar el flujo general de cotizacion, procesos y consolidacion salvo que la tarea lo requiera de manera directa.
- Cualquier cambio debe seguir siendo compatible con las aseguradoras actualmente integradas.

### 2. Contrato canonico del Excel

- El Excel final tiene un esquema unico y fijo.
- Todas las aseguradoras deben converger al mismo conjunto de columnas.
- No agregar columnas nuevas sin validacion explicita.
- No eliminar ni renombrar columnas existentes sin validacion explicita.
- No alterar el orden de columnas.
- Cada fila representa una cotizacion individual.

### 3. Consistencia entre aseguradoras

- No crear columnas alternativas para la misma informacion.
- Normalizar datos para que sean comparables.
- Si una aseguradora no provee un dato:
  - calcularlo solo si la regla es general y confiable;
  - dejarlo vacio si no hay base solida para inferirlo.
- Evitar mover logica puntual de una aseguradora al flujo general.

### 4. Integracion de nuevas aseguradoras

- Agregar una aseguradora nueva no debe cambiar el esquema comun ni romper a las existentes.
- El fit debe hacerse contra el esquema base, no al reves.
- El parseo especifico debe quedar en su modulo o adaptador.
- La normalizacion hacia el contrato comun debe ser explicita y testeable.

### 5. Validacion del entregable

Los entregables principales son:

- el Excel final de cotizaciones, especialmente la hoja canonica `Cotizaciones`;
- la respuesta consumida por la webapp de Seguros911 o por consumidores equivalentes del resumen de proceso.

Las hojas o artefactos auxiliares como `Raw`, `Errores`, `Skipped`, `resumen.csv` o evidencias son utiles para auditoria y debugging, pero no reemplazan al contrato principal.

## Regla especial para la webapp

La respuesta JSON actual del proceso es sensible a compatibilidad, pero todavia no esta cerrada con el mismo nivel de revision que el Excel. Por eso:

- preservar su shape actual salvo necesidad real;
- evitar cambios cosmeticos o restructuraciones innecesarias;
- si una tarea requiere cambiarla, hacerlo como decision explicita y separada del resto.

## Checklist minimo antes de cerrar un cambio

- Verificar que el flujo principal siga funcionando.
- Verificar que no se rompieron otras aseguradoras.
- Verificar que el Excel mantenga estructura, orden y legibilidad.
- Verificar que los datos homologos sigan siendo comparables entre aseguradoras.
- Verificar que no se haya introducido una segunda nomenclatura para el mismo concepto.
- Si el cambio toca descuento o bonificacion, comparar al menos una corrida con y sin ese parametro para la aseguradora afectada.
