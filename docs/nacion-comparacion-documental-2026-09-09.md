# Comparación documental antes de integrar Nación Seguros

Fecha: 9 de septiembre de 2026. Se compara el relevamiento de Nación con el contenido existente de `D:/AutoIQ/docs`. Esta auditoría no modifica contratos, código, configuración ni documentos fuente; registra discrepancias y propone cómo resolverlas antes de continuar.

**Conclusión:** el acceso real a Nación está comprobado y no contradice los otros documentos. Sin embargo, hay discrepancias en los contratos de entrada, ejemplos, tratamiento comercial y documentación de operación que pueden producir una integración incorrecta. Parte del problema es documentación genérica incompleta; otra parte son frases desactualizadas que quedaron en el propio relevamiento de Nación.

## Alcance y criterio

El inventario previo a esta auditoría contiene 35 archivos: 16 Markdown, 15 JSON, 3 YAML y un WSDL. Se revisaron el paquete Seguros911, OpenAPI y sus ejemplos, el plan de catálogos, el avance de Mercantil Andina, las guías y referencias de integración/Excel, y la evidencia de acceso/WSDL de Nación. Los YAML de agentes describen las guías y no agregan contratos de negocio.

Se hicieron comprobaciones locales de estructura sobre el ejemplo JSON de la guía y el schema YAML. Cuando fue necesario distinguir documentación histórica de comportamiento actual, se consultaron puntualmente las rutas de integración/proceso y utilidades de condiciones comerciales, catálogo y TLS. No se volvió a ejecutar el backend Seguros911, no se realizaron llamadas a aseguradoras ni se generaron cotizaciones durante esta auditoría.

Clasificaciones usadas: **contradicción comprobada**, **documentación desactualizada**, **brecha de diseño** y **diferencia válida que requiere aclaración**. Las propuestas siguientes no se presentan como contratos ya aprobados o implementados.

## Discrepancias que deben resolverse antes del recorrido completo

### 1. La fila canónica de la guía no cumple OpenAPI

**Contradicción comprobada.** La [guía de consumo](D:/AutoIQ/docs/integracion-seguros911-consumo-cotizacion.md:109) usa `suma`, `CP` y `tipo_uso`. [OpenAPI](D:/AutoIQ/docs/openapi/seguros911-private-api.yaml:144) exige `cp`, documenta `suma_asegurada` y no declara `tipo_uso` como propiedad específica. El relevamiento de Nación propone conservar los nombres de la guía, por lo que hereda esta discrepancia.

La comprobación local encontró `cp` obligatorio ausente. `suma`, `CP` y `tipo_uso` quedan permitidos como propiedades adicionales, pero eso no satisface el requerido `cp`. El schema no reconoce la suma bajo el nombre de la guía como su campo tipado.

**Impacto:** un cliente generado desde OpenAPI puede rechazar el ejemplo oficial o construir un riesgo distinto del que espera otra capa. Que algunos adaptadores toleren aliases no establece un contrato único.

**Propuesta:** elegir nombres canónicos para la frontera Seguros911→AutoIQ, alinear guía/schema/fixtures y mantener aliases de compatibilidad dentro del normalizador. Mi propuesta es usar `cp` y `suma_asegurada` en esa frontera por coincidir con OpenAPI, declarando también `tipo_uso`; validar antes los consumidores existentes. No cambiar masivamente columnas de archivos ni nombres internos para resolverlo.

### 2. La validación de GNC está escrita, pero no asegurada por el schema

**Brecha documentada, más ejemplos incompletos.** La [guía](D:/AutoIQ/docs/integracion-seguros911-consumo-cotizacion.md:90) requiere monto positivo con GNC y rechaza monto positivo sin GNC. [LEER-PRIMERO](D:/AutoIQ/docs/LEER-PRIMERO.md:51) advierte expresamente que el `/cotizar` normal de Seguros911 no exige ese monto, a diferencia de la recotización.

[CanonicalRisk](D:/AutoIQ/docs/openapi/seguros911-private-api.yaml:160) sólo describe la condición en texto: `suma_gnc` acepta número, string o null, sin condicional que exija presencia/positividad. El endpoint AutoIQ `quote-inputs` examinado sólo exige que `row` sea un objeto. No se verificó si el backend Seguros911 fue corregido después del estado descrito en LEER-PRIMERO.

Además, [quote-with-gnc.json](D:/AutoIQ/docs/openapi/examples/quote-with-gnc.json) y su variante sin GNC omiten `cerokm` y `tipo_vehiculo`, pese a que LEER-PRIMERO pide hechos del riesgo explícitos. También omiten `tipo_uso`, aunque incluyen el texto `uso`. El schema permite estas omisiones.

**Impacto en Nación:** aceptar un input no significa que sea cotizable; `EQUIPO_GNC=S` sin monto fallará. Los ejemplos actuales tampoco prueban preservación de 0 km o clase.

**Propuesta:** normalizar y validar antes del WS, compartir la misma regla entre cotizar/recotizar y agregar ejemplos completos. Distinguir rechazar un input contradictorio de limpiar el monto residual cuando el usuario desactiva GNC: ambas reglas son compatibles si se aplican en el momento correcto.

### 3. Productor interno y código Nación no tienen un enlace documentado suficiente

**Brecha de diseño.** La guía usa `producer_public_uuid` y `commercial_user_id`. [ProducerInput](D:/AutoIQ/docs/openapi/seguros911-private-api.yaml:122) ofrece un `code` general, pero no un mapeo por aseguradora, ambiente y cotizador. El relevamiento Nación sí requiere esa asociación. El código `ensureProducer` confirma que `code` es un único atributo del productor, no una tabla de códigos por compañía.

**Impacto:** asignar directamente el UUID o ese `code` a `CODIGO_PRODUCTOR` puede atribuir la cotización al intermediario incorrecto. El fallback del proveedor tampoco acredita al productor correcto de Seguros911.

**Propuesta:** resolver en servidor una relación explícita productor interno→código Nación autorizado, con ambiente/cotizador. El código que solicitará el usuario es un dato necesario; sigue pendiente definir dónde se conserva y cómo se selecciona para cada productor. No sobrecargar `ProducerInput.code` sin revisar su significado actual.

### 4. Nombre y correo del tomador no forman parte del recorrido individual descrito

**Brecha de diseño ya advertida por Nación, no resuelta en los documentos generales.** La guía de consumo detalla vehículo, ubicación, edad y otros atributos, pero no describe cómo obtener nombre/email por solicitud. El contrato Nación los exige. La cabecera persistida puede almacenarlos, pero el override de proceso actual no los admite.

**Impacto:** usar una cabecera compartida puede mandar el nombre/correo de otra persona; inventarlos para completar el WS altera los datos de la cotización. La Webapp anterior al contacto tampoco tiene garantizado ese correo.

**Propuesta:** documentar la fuente por solicitud y una transferencia compatible y validada, sin modificar una cabecera compartida. Confirmar modalidad anónima con Nación si se necesita cotizar antes de pedir contacto. No exigir estos datos al resto de compañías sólo por incorporarse Nación.

### 5. La precedencia de condiciones comerciales necesita una excepción por capacidad

**Tensión entre una regla general y el contrato específico.** La [guía de consumo](D:/AutoIQ/docs/integracion-seguros911-consumo-cotizacion.md:147) incluye `medio_pago=TC` en el override y afirma que prevalece sobre defaults. El relevamiento Nación explica correctamente que el request de cotización no incluye selección de pago, comisión o descuento; el pago sí puede informarse en emisión.

**Impacto:** aplicar literalmente la precedencia puede mostrar tarjeta/descuento como condiciones cotizadas aunque el proveedor utilice su configuración cerrada. Cambiar el resultado local no sustituye una cotización bajo otra condición comercial.

**Propuesta:** separar hechos del riesgo, parámetros comerciales editables por el WS y condiciones preconfiguradas/devueltas. Un override sólo puede imponerse si la compañía admite ese concepto. Si no, informar incompatibilidad o condición efectiva de forma explícita. Conservar solicitado, enviado y devuelto; confirmar efecto de cambiar pago en emisión sobre el precio ofrecido.

La [regla Excel de bonificación](D:/AutoIQ/docs/skills/autoiq-core-guardrails/references/excel-schema.md:80) permite fallback **si el request envió** descuento. No es una contradicción con Nación: allí no hay descuento documentado en el request. Un valor del perfil local nunca debe contarse como enviado sólo porque exista en cabecera.

### 6. Los ejemplos publicados no son fixtures fiables de todos los contratos

**Contradicciones comprobadas con el modelo actual.**

- [final-result.json](D:/AutoIQ/docs/openapi/examples/final-result.json) presenta `resultados` como array. La guía dice que se organiza por compañía; las funciones de resumen y decoración del código usan un objeto de arrays por slug. No describe el mismo shape. El resumen incremental también puede anunciar almacenamiento JSONL; un ejemplo estático debe aclarar a qué modo corresponde.
- [quote-override.json](D:/AutoIQ/docs/openapi/examples/quote-override.json) y [commercial-own.json](D:/AutoIQ/docs/openapi/examples/commercial-own.json) usan el concepto `bonificacion`. El catálogo actual de conceptos utiliza `descuento_comercial`; la validación de guardado rechaza conceptos inexistentes. No se debe confundir la columna Excel `bonificacion` con un identificador de la matriz comercial.
- OpenAPI cubre `/integration/seguros911/*`, pero no describe crear/ejecutar/consultar `/proceso/*`. Por eso los ejemplos de proceso y override no quedan verificados contra schemas de operaciones de ese archivo. Esto no es una ruta ausente del sistema: es cobertura parcial del contrato formal.

**Impacto:** LEER-PRIMERO recomienda estos ejemplos como base de implementación/tests; un cliente puede quedar programado contra formatos incorrectos y los tests seguir aprobando fixtures sintéticos.

**Propuesta:** regenerar ejemplos sanitizados desde handlers/contratos actuales, identificando capa y modo de respuesta; dar schema al ciclo de proceso por separado si se mantiene el alcance de la API privada. No adaptar Nación para devolver el array del ejemplo erróneo.

## Diferencias operativas y del propio relevamiento

### 7. Avast ya tenía un antecedente y Nación usa otro mecanismo de configuración

**Antecedente omitido y diferencia operativa.** [Mercantil Andina, sección TLS](D:/AutoIQ/docs/mercantil-andina-avance.md:36), de agosto de 2026, ya describía el fallo Node/Axios por Avast y su solución con CA confiable. Debí consultar ese antecedente antes de presentar el acceso como impedimento para leer la documentación.

Mercantil busca automáticamente una CA mediante varias variables y un PEM local. Nación introduce `NACION_CA_FILE` y mantiene las raíces estándar. Ambos mantienen validación TLS; no se contradicen en seguridad, pero sí ofrecen procedimientos de arranque distintos.

**Impacto:** que el probe Nación funcione con una ruta CA explícita no significa que el servidor normalmente iniciado tenga esa ruta provisionada. El [runbook](D:/AutoIQ/docs/integracion-seguros911-operacion.md:5) no documenta aún esa opción.

**Propuesta:** documentar la provisión de la CA pública por entorno y decidir si se reutiliza una interfaz común de confianza. No copiar un certificado específico de este equipo al entorno productivo ni desactivar TLS. No hace falta rehacer ahora todas las integraciones para resolver esta diferencia.

### 8. Actualizar tablas Nación no las entrega automáticamente al catálogo Seguros911

**Brecha de alcance.** El [plan multicompañía](D:/AutoIQ/docs/catalogos-multicompania-plan.md:7) y el relevamiento Nación coinciden en catálogos por slug, historial y diffs. Pero [VehicleSnapshot](D:/AutoIQ/docs/openapi/seguros911-private-api.yaml:138) sólo define `brands`, `infoauto`, `infoautoDc`, `localities`; el handler actual los obtiene específicamente de ATM.

**Impacto:** sumar `data/nacion/diccionarios` y `/catalogos/nacion/...` no hace que Seguros911 reciba esas tablas ni que incorpore una fuente de valuaciones nueva.

**Propuesta:** conservar los maestros compartidos actuales; determinar qué tablas Nación consume sólo el adaptador y cuáles debe recibir Seguros911. Si aparece una fuente real de valuaciones, diseñar su incorporación con procedencia y compatibilidad explícitas. Bancos/tarjetas sirven para pago/emisión, no para enriquecer modelos/precios.

El scheduler y la escritura atómica del plan son objetivos propuestos, no prueba de implementación. El relevamiento los trata como mejoras pendientes; no hay contradicción en ese punto. La UI y rutas de sync sí existen, por lo que el plan histórico no debe leerse como lista íntegra de trabajo aún no iniciado.

### 9. Persistieron frases antiguas dentro del informe Nación

**Documentación desactualizada interna.** La actualización inicial afirma autenticación corregida y WSDL recuperado, pero párrafos posteriores aún dicen que se debe corregir autenticación o verificar en WSDL aspectos ya conocidos.

- La introducción histórica dice que falta corregir autenticación, sin acotar qué etapa. Login/renew/caché están implementados; sí falta integrar el token en el SOAP.
- GNC propone comprobar si `EQUIPO_GNC_SUMA` se omite. El WSDL ya demuestra que su elemento es obligatorio y de tipo double. Lo pendiente es la convención funcional sin GNC —por ejemplo cero—, no su presencia en el esquema.
- Se sugiere confirmar precisión total en WSDL; éste declara double y no un decimal restringido a 11 dígitos. El límite de negocio debe confirmarse por documentación funcional/proveedor.
- El productor se describe como omisible funcionalmente, pero su elemento XML es obligatorio en WSDL. Son dos niveles distintos: no omitir el tag suponiendo que la optionalidad de negocio lo permite. Aún no hay código autorizado ni default confirmado.

**Propuesta:** consolidar el documento en un único estado actual, dejando el historial como apartado separado. Cambiar estas frases por distinciones precisas entre esquema, regla de negocio, implementación y validación real.

### 10. Reintentos, evidencia y valores mensuales requieren reglas explícitas al integrar

**Diferencias válidas con riesgo de interpretación.**

- El [runbook](D:/AutoIQ/docs/integracion-seguros911-operacion.md:13) prohíbe repetir POST no idempotentes ante respuesta incierta. El [fixture de timeout](D:/AutoIQ/docs/openapi/examples/company-timeout.json) marca genéricamente `retryable=true`. Para Nación, cotizar registra un presupuesto: no copiar ese fixture como política universal. Un timeout posterior al envío no acredita que no se haya creado solicitud. Definir qué casos permiten repetir y cuáles requieren conciliación; no inventar deduplicación por `PEDIDO_ID`.
- [Adapter contract](D:/AutoIQ/docs/skills/autoiq-nueva-aseguradora/references/adapter-contract.md:122) pide conservar `raw`, con excepción explícita de seguridad; [seguridad](D:/AutoIQ/docs/integracion-seguros911-seguridad.md:23) prohíbe registrar secretos/PII/body/raw y la guía prohíbe exponerlo a UI. La excepción permite sanitizar, pero falta describir qué evidencia interna se conserva y qué se publica. Para Nación, tokens y datos del tomador pueden aparecer también en el response.
- El [schema Excel](D:/AutoIQ/docs/skills/autoiq-core-guardrails/references/excel-schema.md:163) ofrece fuentes como importePrima/importePremio para columnas mensuales, pero no basta copiar el importe total de Nación a ellas. El período real se obtiene de `FACTURACION_MESES`; cuotas y duración no son equivalentes. La regla común de cálculo fiable/no inventar valores es compatible con Nación, pero el mapeo específico debe quedar explícito y probado.

**Propuesta:** documentar por operación las condiciones de reintento, conservar evidencia sanitizada con acceso controlado y separar total del período, primera cuota e importe mensual sin alterar columnas del Excel.

## Aspectos que sí están alineados

- La matriz de aseguradoras y el informe actualizado coinciden: login/renew/WSDL Nación probados, cotización desactivada, productor pendiente y GNC soportado por el proveedor pero aún no enviado por el constructor local.
- La arquitectura sigue siendo UI/Webapp→backend Seguros911→AutoIQ→Nación. HMAC entre sistemas y JWT/Basic de Nación son capas distintas; no hay contradicción.
- El override del riesgo individual prevalece sobre defaults comerciales; se conserva el modo masivo de AutoIQ. Que el paquete Seguros911 documente sólo cotización individual no prohíbe que el adaptador atienda ambos flujos.
- Particular/comercial, 0 km y GNC pertenecen al riesgo. El anexo de profesiones de emisión no amplía los usos ni habilita motos u otros tipos de vehículo.
- Las guías distinguen Excel objetivo de nomenclatura visible actual. Integrar Nación manteniendo estructura actual y normalizando por adaptador es compatible; no se necesita migrar todo el Excel en este trabajo.
- Los 12 tests locales informados no se presentaron como cotización real: son 10 de autenticación y 2 del borrador. Las guías exigen además validar request/response, JSON y Excel antes de dar por integrada una compañía; Nación todavía no cumple ese cierre.
- No hay en los demás documentos evidencia de una tabla masiva de valuaciones Nación. El padrón ATM existente no demuestra que Nación publique uno equivalente.

## Orden propuesto para resolverlo

1. Corregir nombres canónicos, schema y fixtures de entrada/salida; consolidar el estado actual del propio relevamiento.
2. Definir mapeo del productor Nación y origen por solicitud de nombre/correo del tomador.
3. Cerrar capacidades comerciales: tratamiento del pago solicitado, preconfigurado y devuelto; prohibir descuentos locales sin soporte WS.
4. Definir validaciones de riesgo, reintentos ante resultado incierto, evidencia sanitizada y normalización económica.
5. Documentar provisión TLS y frontera entre tablas del adaptador y snapshot compartido de Seguros911.
6. Continuar con el constructor/parser Nación, manteniendo la activación para después de productor y pruebas completas.

Se puede continuar programando partes aisladas con el WSDL actual, pero estos puntos deben quedar alineados antes de probar el recorrido completo y publicar ofertas de Nación. Esta auditoría deja las correcciones propuestas para revisión; no las da por implementadas.
