# AutoIQ Excel Schema

## Decision

El contrato canonico objetivo del Excel final usa nomenclatura tecnica en `snake_case` y el orden exacto definido en este documento. La implementacion actual de `backend/routes/proceso.js` todavia exporta nombres visibles distintos; eso se considera estado transitorio y no reemplaza este contrato objetivo.

## Orden canonico de columnas

```text
proceso_id
historial_id
cabecera_id
aseguradora
fecha_cotizacion
hora_cotizacion
numero_operacion
cabecera
tipo_persona
iva
tipo_doc
medio_pago_request
medio_pago_response
sexo
fecha_nacimiento
edad_cotizada
estado_civil
tipo_uso
rastreo
gnc
clausula_ajuste
bonificacion
vehiculo_anio
vehiculo_marca
vehiculo_modelo
vehiculo_codigo_infoauto
vehiculo_tipo
vehiculo_combustible
vehiculo_uso
vehiculo_provincia
vehiculo_localidad
vehiculo_cp
grupo_cobertura_codigo
grupo_cobertura_descripcion
cobertura_codigo
cobertura_descripcion
producto_codigo
producto_descripcion
plan
periodo_facturacion
cuotas
importe_cuota
prima_mensual
iva_mensual
recargos_mensual
premio_mensual
suma_asegurada
franquicia
franquicia_robo
requiere_recuperador
requiere_inspeccion
comision_intermediario
porcentaje_comision
```

## Criterios generales

- No agregar columnas alternativas para cubrir vacios de una aseguradora.
- No mezclar nombres de negocio y nombres visibles historicos del Excel actual.
- Dejar vacio un campo antes que llenarlo con una equivalencia dudosa.
- Si un valor es calculado o inferido, aplicar una regla comun y estable.

## Observaciones clave para discutir o confirmar

### `iva`

Usar `iva` para la condicion fiscal informada en cabecera, por ejemplo `consumidor_final`. El importe monetario incluido en el premio por concepto de IVA va en `iva_mensual`.

### `bonificacion`

Mantener esta columna en el contrato. Priorizar el valor devuelto por la aseguradora cuando exista. Si la respuesta no lo informa pero el request envio descuento o bonificacion, usar ese parametro como fallback normalizado; si viene como entero o string tipo `20`, interpretarlo como porcentaje `20`.

### `recargos_mensual`

Mantener esta columna separada de impuestos. Si existe `cot_importeRecargoFinanciero` o equivalente, usarlo. No reemplazarla automaticamente por impuestos. Si en el futuro se incorpora `impuestos_mensual` al contrato, debe vivir en una columna separada.

### `franquicia`

Usar `franquicia` a secas como columna canonica. En la practica casi siempre corresponde a productos Todo Riesgo y a franquicia por accidente o dano. Mapear ahi la franquicia generica informada por la aseguradora; dejar `franquicia_robo` solo para los casos en que venga diferenciada.

## Pendientes de validacion operativa

- Ejecutar pruebas rapidas por aseguradora con y sin parametro de descuento/bonificacion para confirmar:
  - si la compania devuelve la bonificacion en response;
  - como nombra ese dato;
  - y si el fallback desde request es estable y homologable.
- No convertir este pendiente en una nueva columna ni en logica especial del Excel; usarlo para cerrar la normalizacion de `bonificacion`.

## Mapeo propuesto por grupos

### Contexto del proceso

| columna | fuente actual probable | criterio |
| --- | --- | --- |
| `proceso_id` | `row.proceso_id` | Id del proceso. |
| `historial_id` | `row.historial_id` | Id del historico origen si existe. |
| `cabecera_id` | `row.cabecera_id` | Id de cabecera asociada. |
| `aseguradora` | `row.aseguradora` | Slug normalizado de compania. |
| `fecha_cotizacion` | `finished_at` | Fecha del intento o respuesta final. |
| `hora_cotizacion` | `finished_at` | Hora del intento o respuesta final. |
| `numero_operacion` | `operacion`, `cot_numCotizacion`, `cot_pricingId`, `cot_solicitud_glm` | Identificador operativo visible de la cotizacion. |
| `cabecera` | `cab_nombre` | Nombre humano de la cabecera. |

### Parametros de cabecera y request

| columna | fuente actual probable | criterio |
| --- | --- | --- |
| `tipo_persona` | `cab_tipopersona` | Valor de request o cabecera. |
| `iva` | `cab_iva` | Condicion fiscal del asegurado, por ejemplo `consumidor_final`. |
| `tipo_doc` | `cab_tipodoc` | Tipo documental del request. |
| `medio_pago_request` | `cab_medio_pago` | Medio solicitado por AutoIQ. |
| `medio_pago_response` | `Forma Pago`, `cot_formapago`, `cot_formapago_descripcion` | Medio devuelto por la aseguradora; fallback al request. |
| `sexo` | `cab_sexo` | Sexo del request. |
| `fecha_nacimiento` | `cab_fec_nac` | Fecha de nacimiento enviada o persistida. |
| `edad_cotizada` | inferida desde `cab_fec_nac` y `finished_at` | Edad al momento de cotizacion. |
| `estado_civil` | `cab_est_civil` | Estado civil del request. |
| `tipo_uso` | `cab_tipo_uso` | Uso declarado en cabecera/request. |
| `rastreo` | `cab_rastreo` | Flag de rastreo solicitado. |
| `gnc` | `cab_gnc` | Flag de GNC solicitado. |
| `clausula_ajuste` | `cab_ajuste`, `used.clausulaDeAjuste`, `used.porcentajeAjuste` | Clausula o porcentaje de ajuste normalizado. |
| `bonificacion` | `cot_montoBonif`, parametros request como `descuento`, `descuento_comercial`, `bonif_adicional` o equivalente | Priorizar response; si falta, usar el request normalizado como porcentaje cuando la semantica sea homologable. |

### Datos del vehiculo

| columna | fuente actual probable | criterio |
| --- | --- | --- |
| `vehiculo_anio` | `veh_anio` | Anio del vehiculo. |
| `vehiculo_marca` | `veh_marca` | Marca normalizada. |
| `vehiculo_modelo` | `veh_modelo` | Modelo normalizado. |
| `vehiculo_codigo_infoauto` | `veh_codigo_infoauto` | Codigo Infoauto. |
| `vehiculo_tipo` | `veh_tipo_vehiculo`, metadata usada por aseguradora | Tipo homologado de vehiculo. |
| `vehiculo_combustible` | inferido por helper actual | Combustible homologado. |
| `vehiculo_uso` | `veh_uso` | Uso del vehiculo. |
| `vehiculo_provincia` | `veh_provincia` | Provincia del riesgo. |
| `vehiculo_localidad` | `veh_localidad` | Localidad del riesgo. |
| `vehiculo_cp` | `veh_CP` | Codigo postal del riesgo. |

### Cobertura y producto

| columna | fuente actual probable | criterio |
| --- | --- | --- |
| `grupo_cobertura_codigo` | heuristica comun `inferCoverageGroup` + overrides | Grupo comun comparable entre aseguradoras. |
| `grupo_cobertura_descripcion` | idem | Descripcion del grupo comun. |
| `cobertura_codigo` | `cot_codigo`, `cot_codigoDeCobertura`, `cot_cobertura` | Codigo de cobertura puntual. |
| `cobertura_descripcion` | `cot_descripcion`, `cot_descripcionDeCobertura`, `cot_cobertura` | Descripcion de cobertura puntual. |
| `producto_codigo` | `cot_codigoDeProducto`, `cot_codigoModalidad`, `cot_plan` | Codigo de producto o modalidad homologable. |
| `producto_descripcion` | `cot_descripcionDeProducto`, `cot_nombreProducto` | Descripcion de producto homologada. |
| `plan` | `cot_plan`, `cot_plan_cot`, `Plan` | Nombre o identificador de plan visible. |

### Valores economicos

| columna | fuente actual probable | criterio |
| --- | --- | --- |
| `periodo_facturacion` | `cot_periodoFact`, `cab_refacturacion`, inferencia por cuotas | Etiqueta de facturacion comparable. |
| `cuotas` | `cot_cuotas`, `cot_cantidadCuotas`, metadata usada | Cantidad de cuotas. |
| `importe_cuota` | `cot_impcuotas`, `cot_importeCuota`, `cot_montoPrimeraCuota` | Importe unitario de cuota. |
| `prima_mensual` | `cot_prima`, `cot_importePrima`, `cot_montoPrimaTotal`, `cot_premiumMonthly` | Prima mensual comparable. |
| `iva_mensual` | `cot_importeIVA`, `cot_montoIVA`, `cot_ivaMonthly` | IVA monetario mensual. |
| `recargos_mensual` | `cot_importeRecargoFinanciero`, campo equivalente de recargo | No mezclar con impuestos. Si luego existe `impuestos_mensual`, debe ser otro campo. |
| `premio_mensual` | `cot_premio`, `cot_importePremio`, `cot_montoPremio`, `cot_premiumMonthly`, `cot_premium` | Premio mensual comparable. |
| `suma_asegurada` | `cot_sumaAsegurada`, `suma_asegurada`, `Suma Asegurada` | Suma asegurada final de la cobertura. |

### Franquicias, requerimientos y comisiones

| columna | fuente actual probable | criterio |
| --- | --- | --- |
| `franquicia` | `cot_franquicia`, `cot_montoFranquicia`, `cot_nombreFranquicia` | Franquicia principal generica. En la mayoria de los casos corresponde a Todo Riesgo. |
| `franquicia_robo` | `cot_franquiciaRobo` | Franquicia especifica de robo si existe. |
| `requiere_recuperador` | `cot_conRecuperador`, `cot_hasTrackingEquipment`, parseo comun | Flag homologado. |
| `requiere_inspeccion` | `cot_requiereInspeccion`, `cot_inspeccionable`, parseo comun | Flag homologado. |
| `comision_intermediario` | `cot_comision`, `cot_valorComisionPAS` | Valor monetario de comision. |
| `porcentaje_comision` | `cot_porcentajeComisionPAS` o derivado desde comision/prima | Porcentaje homologado. |

## Regla de llenado ante faltantes

- Si un dato existe con semantica clara, normalizarlo al campo canonico.
- Si un dato puede inferirse de manera estable, inferirlo en una capa comun.
- Si un dato no existe o es ambiguo, dejarlo vacio.
- No crear nuevas columnas para resolver particularidades de una sola aseguradora.
