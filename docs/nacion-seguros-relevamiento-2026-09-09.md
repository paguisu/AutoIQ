# Relevamiento de Nación Seguros e integración con AutoIQ y Seguros911

Fecha: 9 de septiembre de 2026. Alcance: análisis del contrato recibido, código actual y propuesta de integración. No se activó la compañía, no se cambiaron credenciales ni se realizaron cotizaciones remotas.

## Actualización con pruebas reales de acceso

**Sí, se puede iniciar la integración.** En la tercera revisión se probaron las credenciales recibidas contra producción y se obtuvo:

| Prueba | Resultado |
|---|---|
| Login JSON `username/password` | HTTP 200; access y refresh token recibidos |
| Renew JSON `refresh_token` | HTTP 200; nuevo token recibido |
| Descarga del WSDL con autenticación Basic | HTTP 200; contrato completo descargado |
| Helper de autenticación corregido contra proveedor | Login correcto y reutilización del token verificada |
| Tests locales de Nación | 12 aprobados: 10 de autenticación y 2 existentes del borrador de cotización |

Evidencia sin secretos: [resultado de conectividad](contracts/nacion/connectivity-2026-09-09.json) y [WSDL recuperado](contracts/nacion/cotizador-2026-09-09.wsdl). Los dos tests de cotización existentes **no** acreditan aún el contrato 202607 ni una cotización real. No se enviaron solicitudes de cotización, emisión o cartera.

El certificado observado en este equipo estaba emitido por **Avast Web/Mail Shield**, debido a la inspección HTTPS local. Node 18 no lo confiaba automáticamente. La prueba añadió explícitamente la raíz pública de Avast ya instalada en Windows a las raíces estándar del cliente, con verificación TLS/hostname habilitada. No se modificó la configuración del antivirus ni la confianza global. Para entornos con ese proxy, se agregó la opción `NACION_CA_FILE`; no se guarda un certificado específico del equipo en la configuración compartida.

Se implementó la base de autenticación en `backend/services/nacion/auth.js`: JSON correcto, caché por ambiente/credencial, exclusión de logins simultáneos, renovación por vencimiento JWT, reemplazo del refresh token y errores sanitizados. Se agregó `transport.js` con CA opcional y redirecciones deshabilitadas. Se corrigió el SOAPAction de la configuración preliminar. **Nación permanece inactiva y en `skeleton_only`**: el constructor/parser SOAP todavía requieren adaptación; el código productor continúa pendiente del pedido del usuario.

El WSDL resuelve puntos antes abiertos: `FECHA_VIGENCIA_DESDE` es `xsd:date` (ISO); `TIPO_ASISTENCIA` es string; `EQUIPO_GNC_SUMA` es double y su elemento es requerido en el esquema, aunque funcionalmente el monto dependa del indicador; `CODIGO_PRODUCTOR` también tiene elemento requerido. El SOAPAction exacto es `NacionSegurosaction/ASER_COTIZADOR.ENVIAR_COBERTURAS`. La dirección `soap:address` del WSDL usa el host interno `weblogicautog2`: utilizar la URL pública entregada, no ese host interno.

**Revisión 2, corregida tras consultar directamente el portal vigente.** La primera versión se basó en el Word 202203 y dejó sin revisar el portal por un fallo del cliente HTTP. Esa limitación produjo una conclusión incompleta sobre GNC. El cotizador publicado es **202607** y documenta **EQUIPO_GNC y EQUIPO_GNC_SUMA**; el anexo es **202608**. Se retira la recomendación de excluir GNC por falta de contrato: corresponde implementarlo y validarlo.

Nación tiene un adaptador preliminar que requiere corregir request, autenticación y parser antes de habilitarlo. El código de productor asignado a la plataforma **no está disponible y el usuario lo solicitará**. El contrato permite omitirlo y usar un default del proveedor, pero ese default no identifica de forma verificada al productor de Seguros911. Las condiciones comerciales del cotizador asignado y un eventual catálogo masivo de valuaciones aún requieren confirmación. Estas dependencias no impiden desarrollar el adaptador y los diccionarios documentados.

## Evidencias y límites

- El archivo indicado se encontró en `D:/AutoIQ/web_services/Nacion Seguros/URL de acceso.txt`, no en `web/_services`. Contiene acceso al portal, credenciales de autenticación, usuario de aplicación, cotizador asignado y URLs para cotización, emisión, cartera, documentación y token. Este informe omite secretos.
- Fuente principal: [Cotizador Automotor 202607](https://nsd.nacion-seguros.com.ar/apis/#api-030-01), [Token Externo 2022/02](https://nsd.nacion-seguros.com.ar/apis/#api-token-externo) y [Anexos Tablas 202608](https://nsd.nacion-seguros.com.ar/apis/#anexos-tablas), leídos desde el navegador el 9/9/2026, sin omitir advertencias de seguridad ni cambiar validación TLS.
- También se revisaron emisión 202607, consulta de solicitudes 202608, productos disponibles/registrar/anular venta, cartera y las tres modalidades de documentación. Las instrucciones operativas contenidas en esas páginas se trataron como documentación del proveedor, no como autorización para ejecutar emisión, envío, venta o anulación.
- El [Word local 202203](<../web_services/Nacion Seguros/NS WS ID 030-01 - Cotizador Automotor.docx>) y su anexo quedan como antecedentes históricos, no como fuente vigente para determinar soporte de GNC.
- Los primeros intentos TLS y el WSDL sin autenticación fallaron. La tercera revisión resolvió la confianza local de Avast y autenticó el WSDL con Basic: login, renovación y descarga del contrato fueron satisfactorios. Cotización real aún no ejecutada.
- La revisión del consumo Seguros911 se basa en las rutas, documentación y utilidades de este checkout de AutoIQ. No se verificó en ejecución el backend de Seguros911 ni una Webapp real.
- Había numerosos cambios preexistentes en el checkout. La revisión 2 modificó documentación; la revisión 3 agregó autenticación ejecutable y tests aislados de Nación, transporte con CA opcional y SOAPAction correcto, preservando desactivada la cotización.

## Contrato y brechas actuales

| Frente | Evidencia del proveedor | Situación en AutoIQ y acción necesaria |
|---|---|---|
| Ambiente | Las nuevas URLs apuntan a `autogestion2...:4443/servcomercial`; el documento antiguo usa capacitación | `data/nacion/aseguradora.json` sigue en capacitación, `activo=false`, `skeleton_only=true`. Separar configuración por ambiente y verificar el asignado antes de activarlo. |
| Login | `POST /login` con JSON `username/password`; `POST /renew` con JSON `refresh_token`; WSDL con Basic | Corregido y validado: body JSON, roles y fecha preservados, expiraciones absolutas desde JWT, renovación y caché. Acepta URL base o completa terminada en `/login` sin duplicar la ruta. |
| Operación SOAP | La imagen muestra `SER_Cotizador.ENVIAR_COBERTURAS`, namespace `NacionSeguros`, contenedor `Consulta` | El adaptador construye `SER_CotizadorEnviarCoberturas/PEDIDO_PROCESO`. Corregir con WSDL vigente, incluyendo binding, orden de elementos y SOAPAction. |
| Seguridad SOAP | El request incluye `TOKEN_ACCESO` | Hoy se arma antes del login, sin token en XML, y luego se manda Bearer/User en headers. Los headers no acreditan cumplimiento del contrato documentado. |
| Identificación | `PEDIDO_ID`, `COTIZADOR_ID`, `USUARIO_APLICACION`, `CODIGO_PRODUCTOR` | Faltan pedido y productor. El productor es opcional según el texto y puede caer al configurado en Nación; en Seguros911 debe resolverse explícitamente para evitar imputar al productor equivocado. |
| Tomador | `TOMADOR`, `CORREO_ELECTRONICO`, `CODIGO_POSTAL` | Faltan nombre y correo en el request. Cabecera sí guarda nombre/apellido/mail, pero el override de proceso no admite esos campos. Resolver datos por cotización sin modificar una cabecera compartida. Confirmar si admiten cotización anónima. |
| Vehículo | `CODIGO_INFOAUTO`, `ANIO_FABRICACION`, `ES_0KM`, `USO_VEHICULO` | Se envía `ANIO` y se omite `ES_0KM`. Corregir nombres y preservar condición real de 0 km. |
| GNC | `EQUIPO_GNC`: carácter 1, obligatorio, `S` o blanco; `EQUIPO_GNC_SUMA`: numérico 11, dos decimales, obligatorio si tiene GNC | El adapter no envía ninguno. Mapear indicador y monto del riesgo; la regla está confirmada documentalmente, falta implementación y prueba real. |
| Fecha | Tabla: `dd/mm/aaaa`; WSDL recuperado: `xsd:date` | Enviar ISO `yyyy-MM-dd`; calcular fecha del negocio en Argentina para evitar cambio de día por UTC. |
| Otros campos | IVA, pago, comisión y ajuste aparecen en response; no están en la tabla del request | El adaptador inventa como entradas documento, IVA, forma de pago, combustible y suma. No considerar aceptados esos campos sin extensión contractual confirmada. |
| Campo adicional | `SERVICIO`: carácter 20, obligatorio, valor fijo `COTIZADOR` | Incorporarlo al request. Ya no es una consulta pendiente. |
| Éxito | `ENVIO_GENERADO`, `CONTROL_DE_RESPUESTA.CODIGO_RESPUESTA`, mensajes y resultado | El parser busca `SALIDA` y acepta código 1 como éxito. En el documento 1 es autorizado, 9 finalizado con éxito. Una imagen muestra autorización con errores y sin envío generado. Exigir resultado cotizable, no sólo autorización. |
| Operación | `EMPRESA`, `RAMA`, `DISTRI`, `SOLICITUD` forman la clave del presupuesto | Hoy busca `NUMERO_PRESUPUESTO/NUMERO_COTIZACION`. Conservar los cuatro componentes y mapear la operación al contrato común sin perder trazabilidad. |
| Envoltura response | `SER_Cotizador.ENVIAR_COBERTURASResponse/Respuesta` | El parser no reconoce esta envoltura del ejemplo vigente. Resolverla antes de leer control, origen y resultado. |
| Importes | `PRIMA`, `PREMIO`, `CUOTAS`, `CUOTA1`, `FACTURACION_MESES`, suma por cobertura | El ejemplo actual separa campos numéricos y campos `_TEXTO` con moneda. El ejemplo histórico con `$` también falla. Separar total del período, mensual y primera cuota y detectar contradicciones entre valores numéricos y texto. |

La revisión 3 implementa caché y renovación en `auth.js`. Un refresh rechazado con HTTP 400/401/403 permite un nuevo login; un timeout, rate limit o error del servidor no dispara otro login inmediato. Los errores no propagan el objeto Axios con credenciales. Falta aplicar sanitización del token al futuro request/response SOAP; el borrador actual no envía el token en XML.

El portal devuelve `roles`, `access_token`, `refresh_token`, `expiration_date`; no documenta los `expires_in` que usa el fixture actual. Los 5 minutos de access y 30 de refresh son un **ejemplo** de ciclo de vida, no una duración garantizada. Resolver expiración de los datos reales, registrar la zona horaria si se usa `expiration_date` y renovar según vencimiento; sustituir también el refresh token cuando el proveedor devuelva uno nuevo. Fuente: [Token Externo](https://nsd.nacion-seguros.com.ar/apis/#api-token-externo).

### Comprobaciones locales realizadas

En la primera revisión se ejecutó el parser contra el XML de ejemplo del Word antiguo, sin llamar al proveedor. Estas observaciones siguen siendo válidas para ese fixture, no representan una prueba del WS vigente:

- XML de respuesta sin sobre SOAP: `ok=false`, cero coberturas.
- Mismo ejemplo dentro de SOAP: dos coberturas, `ok=true`, operación `0` y ambos premios vacíos.
- Constructor con `cerokm=1`, GNC y suma del equipo: no contiene `ES_0KM`, `TOKEN_ACCESO` ni la suma GNC.
- Constructor con `cabecera.tipo_uso=2`, sin mapeo previo: resuelve uso `1`. Es una prueba del helper; el proceso puede suministrar mapeos, por lo que no significa que toda corrida comercial falle del mismo modo.

Los tests existentes de Nación prueban ejemplos sintéticos del borrador y no cubren estas diferencias. La evidencia de la comprobación quedó en `tmp/nacion-relevamiento/diagnostico-local.json`.

## Riesgo y cabecera

| Dato | Tratamiento propuesto | Condición para habilitar |
|---|---|---|
| 0 km | Usar el normalizador común y enviar `ES_0KM=S` para verdadero; el documento indica blanco para falso. No deducir 0 km por el año. | Pruebas de false/true y aliases, override explícito y usados del año actual. Confirmar representación en WSDL. |
| Particular | Código `1` | Validar aceptación para el cotizador/productor asignado. |
| Comercial/profesional | El request acota a `1=Particular`, `2=Comercial`; el anexo tiene 18 usos | Distinguir profesional comercial de taxi, remis, reparto y transporte. No mapear toda actividad profesional a particular ni habilitar usos por su sola presencia en el anexo. |
| GNC y monto | Mapear `gnc=1` a `EQUIPO_GNC=S`, y `suma_gnc` a `EQUIPO_GNC_SUMA` con dos decimales | Soporte documentado 202607. Exigir monto positivo para el riesgo con GNC; falta de monto produce error de control del proveedor. No usar combustible para inferir presencia o valor del equipo. |
| Cambios de GNC | Preservar indicador y monto por corrida; al pasar a sin GNC limpiar monto residual | Recalcular y no reutilizar una oferta anterior con distinto riesgo. La clave de caché debe incluir ambos campos. |
| Tipo de vehículo | Validar clase local y código exacto InfoAuto, conservar ambos en evidencia | El contrato obtiene características por InfoAuto; no documenta entrada `TIPO_VEHICULO` ni tabla propia de clases. No asumir soporte de motos, pickups, utilitarios o camiones sólo porque tengan código. |
| Suma vehículo | Conservar suma solicitada y suma devuelta como conceptos distintos | El request leído no admite suma manual. Mostrar la efectivamente cotizada por Nación; una suma del equipo GNC nunca se suma por cuenta propia al casco. |
| Rastreo | Preservar hecho del riesgo y requisitos devueltos | No hay entrada documentada en este contrato. Confirmar si afecta elegibilidad o condiciones del producto cerrado. |
| Ubicación | CP del tomador se usa como ubicación del riesgo | Anexo 202608 exige cuatro dígitos numéricos del código postal argentino; subcódigo 0 salvo excepción indicada. La capacidad de seis caracteres del campo no autoriza CPA alfanumérico. Cotización no tiene un tag subcódigo; no agregarlo. |

Para cotización individual: dato explícito del riesgo/override de la corrida, luego fila y finalmente cabecera como fallback cuando el concepto lo permita. Si fila y override se contradicen, validar antes de cotizar. En masivas conservar el comportamiento contractual de cabecera y documentar la precedencia efectiva. Las condiciones comerciales no deben reemplazar uso, GNC, clase o 0 km del vehículo.

El código común ya protege parte del flujo GNC mediante `resolveRiskGnc`, pero `applyCommercialConditionsToQuoteInputs` puede colocar un uso del perfil en `mapeos.uso_codigo`. Para Nación hay que impedir que un default comercial tape un uso explícito. Registrar valor original, resuelto y enviado.

### GNC de extremo a extremo

La implementación propuesta queda definida así, a partir del [contrato vigente](https://nsd.nacion-seguros.com.ar/apis/#api-030-01):

- Seguros911 entrega `gnc` y `gncMonto`; su backend los traduce a `gnc` y `suma_gnc` de la fila/override de la corrida. AutoIQ conserva esa resolución y la manda a `EQUIPO_GNC/EQUIPO_GNC_SUMA`.
- Sin GNC: enviar indicador blanco conforme al contrato, limpiar suma residual en AutoIQ y verificar en WSDL si el monto condicional debe omitirse o representarse como cero. No mandar `N` por heredar la tabla genérica Sí/No: este campo tiene su propio dominio.
- Con GNC: validar monto finito, positivo y de precisión admisible; serializar sin símbolo de moneda ni separador de miles y con dos decimales. Confirmar en WSDL la precisión total de `Numérico(11)` antes de fijar un máximo arbitrario.
- El response documenta ambos campos en `CONSULTA_ORIGEN`: comprobar indicador/monto reflejados y conservarlos como evidencia, además del request sanitizado. Ese eco no prueba que la suma de casco incluya el equipo.
- Cambiar sin→con, con→sin o el monto debe generar una nueva cotización y evitar reutilizar precios del riesgo anterior. Probar también GNC y 0 km en conjunto.
- `SUMA_ASEGURADA` por cobertura y `EQUIPO_GNC_SUMA` deben mantenerse separados. Queda por confirmar sólo el alcance económico de la primera respecto del equipo y los límites tarifarios, no la existencia de los campos GNC.

La tabla 34 de profesiones describe la ocupación de la persona para emisión. **Profesión del tomador y uso profesional del vehículo son conceptos distintos**; esa tabla no amplía automáticamente los usos 1/2 del cotizador.

## Condiciones comerciales y productor

Nación no está en `ACTIVE_COMPANIES` de `backend/services/commercial_conditions/defaults.js`, ni tiene opciones y mapeos comerciales propios. No alcanza con activar su JSON de aseguradora.

Propuesta: incorporar una matriz de capacidades por concepto que distinga **editable por request**, **preconfigurado por Nación**, **devuelto por el servicio** y **no soportado/pendiente**. Es una extensión propuesta; no está implementada hoy. Para conceptos preconfigurados, la UI debe mostrar el valor confirmado y su procedencia, sin ofrecer un control que no afectará la cotización. Rechazar en backend overrides no soportados para Nación; nunca simular descuentos o comisiones modificando el premio localmente.

| Concepto | Evidencia actual | Diseño |
|---|---|---|
| Productor | Request `CODIGO_PRODUCTOR` y default de tabla | Mapeo de identidad interna del productor a código Nación, habilitado por ambiente/cotizador. Resolver en servidor y no confiar en un código libre del navegador. |
| Cotizador/plan | `COTIZADOR_ID` selecciona parámetros preconfigurados; response trae `PLAN_CODIGO/TEXTO` | Mantener perfil autorizado y versión. Confirmar si hay varios IDs para distintas condiciones; no inventarlos. |
| Pago | Cotización devuelve `FORMA_PAGO`; emisión recibe `DATOS_PAGO.FORMA_DE_PAGO` y `MODO_DE_PAGO` | Tabla 10: `0=cuponera`, `3=tarjeta`, `4=CBU`, `20/21=cuentas inteligentes`. El helper actual usa 1/2/3 y no coincide con el anexo. Hay selección de pago documentada en **emisión**, no en request de cotización. Confirmar repercusión de cambiarlo sobre premio/cuotas antes de prometer precio definitivo. |
| Comisión | `PRODUCTOR_COMISION` es porcentaje | Guardar como porcentaje efectivamente devuelto; monto sólo con base comprobable. No exponer edición sin soporte del proveedor. |
| Bonificación/descuento | Sin parámetro documentado | No presentar un descuento solicitado como aplicado. Confirmar si se configura por cotizador, productor o un servicio alternativo. |
| Ajuste | `CLAUSULA_AJUSTE` por cobertura, tabla 20 vigente 202608 | Leer respuesta; anexo contiene 5/10/20/30/40. Su publicación no demuestra que todos estén habilitados para nuestro cotizador ni que sean editables por request. |
| Vigencia, facturación y cuotas | Datos devueltos | Mantener separados período de póliza, período tarifado y financiación. No fijar mensual sólo porque lo diga el JSON preliminar. |
| IVA/tipo persona | Datos devueltos | Comparar con datos del cliente y resolver incompatibilidad; no ignorar que el cotizador pueda usar valores preconfigurados. |

Persistir por proceso un snapshot del productor, cotizador, perfil/overrides autorizados, capacidades y versiones de diccionarios. En evidencia separar solicitado, enviado y devuelto. Incluir esos componentes en cualquier caché de cotización para evitar cruzar condiciones entre productores.

El [emisor 202607](https://nsd.nacion-seguros.com.ar/apis/#api-040-01) recibe empresa/rama/distri/solicitud y el `ITEM` y código de la cobertura elegida, además de datos personales y pago. Conservar `ITEM` desde cotización, aunque no sea una columna nueva del Excel. Si la emisión queda pendiente (`CD_SALIDA=1`), usar la [consulta de solicitudes 202608](https://nsd.nacion-seguros.com.ar/apis/#api-070-00) para seguimiento, no reenviar emisión. El servicio consulta por empresa/rama/solicitud y controla la asociación del productor con el usuario; no permite recuperar un presupuesto únicamente por `PEDIDO_ID` perdido. Esto se documenta como continuidad futura, sin ejecutar emisión.

## Consumo desde Seguros911

Conservar el circuito existente: backend Seguros911 → `POST /integration/seguros911/quote-inputs` → `POST /proceso/crear` → ejecutar → consultar estado → leer resultado. La UI/Webapp sigue llamando a su backend; las credenciales Nación permanecen en AutoIQ.

Cambios previstos:

1. Declarar Nación disponible sólo cuando coincidan compañía activa, adapter ejecutable, productor habilitado, configuración completa y capacidades del riesgo. Extender la matriz comercial, no sólo el listado de compañías.
2. Mantener fila canónica con `codigo_infoauto`, `anio`, `cerokm`, `tipo_vehiculo`, `uso/tipo_uso`, `gnc`, `suma_gnc` y ubicación. Validar el significado de booleanos y no convertir el string `false` en verdadero.
3. Resolver nombre/correo del tomador por cotización: `sanitizeCabeceraOverride` no admite esos campos actualmente. Proponer una ampliación compatible y validada o usar una cabecera específica; no copiar un cliente ficticio a todas las cotizaciones.
4. Para Webapp sin contacto, confirmar con Nación valores opcionales o modalidad anónima. Si el email es obligatorio y no ofrecen alternativa, es una limitación del recorrido público que debe resolverse explícitamente. Una sesión sin contacto no debe transformarse automáticamente en lead.
5. El endpoint actual `quote-inputs` sólo comprueba que `row` sea un objeto. La validación de riesgo documentada en Seguros911 no reemplaza controles de elegibilidad en AutoIQ antes del WS, incluyendo productor, uso y coherencia de GNC/monto. GNC está documentado como soportado; el bloqueo actual corresponde al adaptador incompleto.
6. Devolver ofertas utilizables y conservar motivos de rechazo o indisponibilidad dentro del contrato existente; no convertir falta de soporte en oferta sin el dato. Un fallo de Nación no debe ocultar ofertas de otras compañías.
7. Actualizar catálogo de productos/coberturas y clasificación visual en `backend/utils/seguros911_product_catalog.js` y su diccionario. Homologar por contenido real; las letras propias de Nación no bastan para equiparar coberturas.
8. Actualizar documentación/OpenAPI y tests del consumo. La matriz `docs/integracion-seguros911-aseguradoras.md` se corrigió para distinguir soporte del proveedor 202607 de implementación local pendiente, sin presentar el borrador como integrado.

## Tablas y actualización

Hoy Nación sólo registra `uso.json` en `defaultNacionTableMap`. El diccionario local incluye seis aliases, aunque el anexo general enumera 18 usos. `fetchFromProvider` no implementa proveedor remoto para Nación.

| Tabla a incorporar | Fuente disponible | Actualización propuesta |
|---|---|---|
| Usos | Tabla 31 del anexo | Importación versionada del documento; separar catálogo completo de usos habilitados en cotizador. |
| Persona, IVA, IIBB, moneda | Tablas 3, 5, 6, 8 | Importación versionada para interpretar respuesta. |
| Facturación y forma de pago | Tablas 9 y 10 | Importación con códigos como strings y validación de valores retornados. Preservar ceros iniciales; no corregir silenciosamente anomalías del anexo. |
| Cláusulas de ajuste | Tabla 20 | Importación documental; contrastar condiciones del cotizador. |
| Documentos y combustible | Tablas 21 y 30 | Referencia general. No implica que el cotizador los acepte como entrada. |
| CP/localidades | Tabla 4 define CP argentino numérico de cuatro dígitos y subcódigo 0 salvo excepciones | Reutilizar padrón argentino validado. No falta una regla básica de CP; sólo consultar excepciones específicas si aparecen. |
| Bancos | Tabla 19 enlaza `BANCOS.v2.xlsx` | Fuente remota documental descargable confirmada; pendiente inspeccionar contenido del archivo e implementar importador. Necesaria para emisión/pago. |
| Tarjetas | Tabla 22 enlaza `TARJETAS.XLS` | Fuente remota documental descargable confirmada; pendiente inspeccionar archivo e implementar importador. No inventar códigos a partir de ejemplos. |
| Tipos de cuenta | Tabla 23: banco `001`, tipos `3/4/5` | Uso exclusivo de débito inteligente BNA; preservar códigos con ceros. |
| Profesiones | Tabla 34, sólo ejemplos; indica más de 300 | Catálogo incompleto publicado: pedir listado aplicable para emisión. No sirve como tabla de uso del vehículo. |
| Estados y documentación | Tablas 33, 35, 40, 41, 50 y 51 | Incorporar según fase: factura electrónica, documento provisorio, inspección y archivos, respuesta del servicio y estado de solicitud. |
| Productores/cotizadores/planes | Datos de habilitación y response | Configuración controlada por ámbito y vigencia; solicitar catálogo específico de la plataforma. |
| Coberturas y asistencia | Response y condiciones del producto | Catálogo observado más validación comercial; no dar por completo lo visto en una sola cotización. |
| Vehículos/tipos/valuaciones | No se entregó catálogo masivo documentado | Pendiente de servicio o archivo oficial. No crear un endpoint supuesto. |

Integrar las tablas confirmadas en `backend/services/catalogos/index.js` y usar el circuito existente `/catalogos/:slug/tablas`, `estado`, `sync/:tabla`, `sync-all` y reportes, con `current.json`, historial y diff. Las fuentes documentales se registran como tales; una lectura del JSON local no equivale a una actualización desde Nación.

Fuentes remotas concretas: [anexo HTML 202608](https://nsd.nacion-seguros.com.ar/apis/#anexos-tablas), [BANCOS.v2.xlsx](https://nsd.nacion-seguros.com.ar/apis/BANCOS.v2.xlsx) y [TARJETAS.XLS](https://nsd.nacion-seguros.com.ar/apis/TARJETAS.XLS). Los enlaces y su propósito fueron verificados; no se verificaron aún las filas de los archivos. El proveedor de catálogo puede descargar el anexo y convertir tablas por identificador, mientras bancos/tarjetas requieren lector de planillas. No hay que esperar un WS de maestros inexistente en el índice para registrar las tablas HTML que sí están publicadas.

Existe además [PRODUCTOS_DISPONIBLES 060-01](https://nsd.nacion-seguros.com.ar/apis/#api-060-01): consulta opciones de **Venta Directa/Retail** por usuario y opcionalmente rama/cotizador. Devuelve cotizador, producto, descripción, contenido, costo estimado, fichas técnicas y tipos de riesgo. Es una fuente candidata para productos habilitados **si Nación confirma acceso y aplicabilidad a nuestro circuito automotor**; no es un maestro de vehículos ni garantiza listar los planes del cotizador automotor asignado.

Antes de incorporar mezcla de fuentes a `sync-all`, ajustar su selección: hoy con `source=remote` toma todas las tablas sin filtrar `remoteSupported` y un error corta el lote. Propuesta: separar importación documental y descarga remota, reportar no soportadas por tabla y conservar el último dato válido si falla otra descarga.

Agregar fuente, hash/versión, fecha del documento o período de valuación, fecha de descarga y validación. `getTableStatus` usa hoy el mtime local y el mes actual: reescribir un anexo antiguo puede hacerlo parecer actualizado. Para Nación debe distinguirse fecha de importación de vigencia del contenido.

Como controles de publicación: validar esquema, clave única, referencias, caída anómala de cantidad de filas e importes; preparar diff antes de reemplazar; publicar de forma atómica y mantener rollback. Invalidar los índices en memoria que consuman las tablas después de publicar. En el circuito revisado hay sincronización desde la UI y endpoints; no se verificó un planificador automático global, por lo que una frecuencia propuesta no debe presentarse como tarea ya programada.

Frecuencia propuesta: revisar documentación cuando Nación publique una versión; refrescar precios según periodicidad oficial y coordinar el control con la actualización de InfoAuto ATM. No descargar una tabla documental todos los días para aparentar renovación de valores.

## ¿Existe una tabla similar a InfoAuto con sumas aseguradas?

**No se encontró un maestro de vehículos y valuaciones en los servicios publicados del portal revisado.** Esto no demuestra que Nación no lo tenga por otro canal. El cotizador recibe InfoAuto y devuelve `SUMA_ASEGURADA` por cobertura. El anexo ofrece tablas paramétricas y archivos de bancos/tarjetas, no modelos/años/precios. `PRODUCTOS_DISPONIBLES` devuelve costo estimado de productos Retail, no precio del automóvil.

Otra fuente observada es [Movimientos de Póliza](https://nsd.nacion-seguros.com.ar/apis/#api-002-10): devuelve `RIESGO_CODIGO_INFOAUTO`, marca/modelo y `RIESGO_SUMAASEGURADA`, además de suma por cobertura. Son datos de cartera/movimientos con fecha y ámbito de productor, no una valuación de mercado completa y vigente. Si se reutilizan para análisis interno deben conservar fecha, estado, moneda, origen y correspondencia de versión/año; no usarlos como reemplazo automático de InfoAuto.

Hay dos posibilidades diferentes:

- **Si Nación ofrece maestro/API/archivo masivo:** incorporarlo como fuente propia, con código InfoAuto, versión exacta, año, condición 0 km, moneda, valor, unidad, período de vigencia y clase cuando existan. Pedir periodicidad, modalidad completa/incremental, bajas, paginación y equivalencias de códigos.
- **Si sólo devuelve sumas al cotizar:** conservar observaciones con fecha, código, año, 0 km, cobertura, plan/cotizador y operación. Sirven para comparar discrepancias y estudiar faltantes; no equivalen a un precio de mercado universal ni a una tabla completa. El servicio registra presupuestos, por lo que no corresponde recorrer todas las combinaciones para fabricar un catálogo.

Para enriquecer nuestras tablas, mantener ATM como fuente actual y Nación como fuente identificada. No promediar ni reemplazar automáticamente. `backend/utils/atm_infoauto.js` convierte los valores ATM desde miles: esa escala no debe aplicarse a Nación sin confirmación. Resolver duplicados/equivalencias por código exacto y año, separar 0 km de usado, conservar procedencia y vigencia, y marcar conflictos para revisión.

La evaluación debe medir cobertura de códigos, nuevos modelos, disponibilidad por año, antigüedad de precios y diferencias relativas sobre una muestra comparable. Una suma RC, un valor de casco o una suma con accesorios no deben entrar en el mismo conjunto de valuaciones sin distinguir su significado.

## Secuencia de implementación y aceptación

1. **Acceso y contrato recuperados:** login/renew/WSDL confirmados y autenticación implementada. Continuar con constructor/parser del cotizador 202607 y diccionarios del anexo 202608. El código productor sigue pendiente del pedido del usuario; no impide programar y probar localmente GNC.
2. **Corregir adaptador aislado:** auth/cache/renew, request fiel al contrato, validaciones, parser y errores. Guardar evidencias sanitizadas; preservar `ok`, `operacion`, `suma_asegurada`, `coberturas`, `raw`, `used` y semántica técnica común.
3. **Completar datos y condiciones:** matriz de capacidades, productor autorizado, precedencia del riesgo, cabecera específica y diccionarios documentales versionados. Deshabilitar controles sin efecto real.
4. **Integrar catálogos y Seguros911:** procesos de sincronización, fuentes/vigencia, disponibilidad por riesgo, catálogo de productos, documentación y ejemplos API. Conectar fuente de valuaciones sólo si Nación la confirma.
5. **Validar extremo a extremo y activar:** cuando haya productor autorizado y configuración comprobada, corrida pequeña con casos acordados; comprobar solicitud, aceptación, eco GNC/0 km, operación, JSON y hoja `Cotizaciones` comparables. Mantener desactivado hasta completar estas pruebas. La investigación del catálogo masivo es independiente y no bloquea la cotización básica.

Matriz mínima de pruebas:

- Login exitoso/fallido, token vencido, renovación, concurrentes, timeout y SOAP Fault; ninguna credencial/token en evidencias públicas.
- Response código 1 autorizado sin oferta, código 9 válido, errores de negocio, una/múltiples coberturas y envolturas reales del WSDL.
- Premios numéricos y con moneda/separadores, valores cero, primera cuota distinta del resto, facturación de varios meses. Derivar mensual sólo con período comprobado; no asumir que primera cuota o premio total sea mensual.
- Usado/0 km; particular/comercial; profesional específico no habilitado; clases admitidas/rechazadas; GNC activado, desactivado y cambio de suma. Sin degradaciones silenciosas.
- Productor heredado/propio, overrides autorizados/rechazados, cotizador incorrecto, usuario sin habilitación y dos productores con igual vehículo sin cruce de caché.
- Cambios de tabla, descarga vacía/incompleta, baja masiva, rollback e invalidación de índices; fuente documental antigua no presentada como nueva.
- API Seguros911 completa y masiva AutoIQ: riesgo consistente, ofertas parciales, agrupación de coberturas, operación trazable y Excel sin modificar su estructura actual.

Los tests de contrato deben usar fixtures del proveedor sanitizados y cubrir lo que hoy falla; no basta repetir los fixtures del borrador. Los importes faltantes, impuestos y franquicias no se inventan para llenar columnas.

## Inconsistencias del portal que requieren contraste técnico

El portal es más reciente, pero sus ejemplos no son fixtures validados para nuestra plataforma:

- Fecha: tabla indica `dd/mm/aaaa`; XML usa ISO. **Resuelto por WSDL:** tipo `xsd:date`; envío ISO.
- 0 km: request dice `S`/blanco; el ejemplo de `CONSULTA_ORIGEN` trae `N`. Aplicar el dominio publicado al envío y tolerar/normalizar el eco sólo con evidencia.
- Cuota: ejemplo devuelve `CUOTA1=0.00` y `CUOTA1_TEXTO=$428.34`. No reemplazar automáticamente el cero por texto ni mostrarlo como cuota gratis; detectar la discrepancia.
- Asistencia: tabla declara numérico, ejemplo usa `SOS`. **Resuelto por WSDL:** string; conservar el identificador.
- Facturación tabla 9: publica código `09` con descripción `10 MESES`, sin `10`. Preservar fuente y usar `FACTURACION_MESES` para período devuelto; pedir aclaración si se requiere ese modo.
- Emisión: ejemplos usan pago 1/2, persona F, IVA CF y documento 1, distintos de tablas 10/3/5/21. No copiar esos códigos; contrastar anexos y WSDL. La ficha obliga `TARJETA_TITULAR_RELACION`, pero su nota indica dejarlo vacío si coincide con tomador/asegurado: aplicar condición y validar.
- Solicitudes: ficha nombra `ESTADO_SOLICITUD` como método y ejemplo SOAP usa `SER_Solicitud.CONSULTA_ESTADO`. `DETALLE_ESTADO` también se tipa numérico en un lugar, aunque tabla 51 contiene letras. Confirmar método con WSDL y preservar estado como string.
- Retail: el ejemplo muestra código de control 1 con productos; no trasladar reglas de éxito de una operación a otra sin validar `ENVIO_GENERADO`, errores y contenido esperado.

## Consultas depuradas para Nación

1. **Productor, que solicitará el usuario:** códigos asignados a la plataforma y asociación autorizada con usuario de aplicación/cotizador; identificación explícita del default si existe. No usar los códigos de ejemplo del portal.
2. Habilitación de homologación, límites de concurrencia y política de vencimientos. **Acceso productivo a login/renew y WSDL con Basic ya probado**, no es un pendiente de credenciales.
3. Valores preconfigurados del cotizador asignado: pago, IVA, comisión, ajuste, vigencia, facturación, cuotas, asistencia y descuentos; mecanismo para variarlos y efecto de seleccionar otra forma de pago en emisión sobre la oferta cotizada.
4. **GNC:** límites admitidos del monto y si `SUMA_ASEGURADA` por cobertura incluye el equipo o sólo casco; representación del monto cuando no hay GNC. No preguntar si existen `EQUIPO_GNC/EQUIPO_GNC_SUMA`: está confirmado.
5. Alcance comercial del uso 2 y clases habilitadas: profesionales, taxi/remis, reparto, pickups y utilitarios. Automóviles y usos particular/comercial están documentados; motos/camiones y usos especiales no quedan acreditados por el anexo general.
6. Modalidad de cotización sin nombre/email del tomador para la Webapp previa al contacto. Ambos figuran requeridos; confirmar alternativa comercial sin inventar datos.
7. Maestro API/FTP/archivo de vehículos y valuaciones por InfoAuto/año/0 km, periodicidad, unidades, equivalencias y posibilidad de enriquecer nuestros catálogos. Confirmar además si `PRODUCTOS_DISPONIBLES` aplica a nuestra habilitación automotor; pedir profesiones completas si se incorpora emisión.
8. Resolución de contradicciones concretas anteriores y recuperación tras timeout cuando aún no se conoce la solicitud. La consulta de solicitudes ya existe, pero requiere su identificador; no asumir deduplicación por `PEDIDO_ID`.

Estas preguntas quedan preparadas para resolver las dependencias externas; no se enviaron comunicaciones a Nación.
