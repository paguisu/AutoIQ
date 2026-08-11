# AutoIQ New Insurer Touchpoints

## Realidad actual del codigo

El alta de una aseguradora nueva en AutoIQ es parcialmente dinamica y parcialmente explicita:

- El listado visible de aseguradoras activas sale de `data/<slug>/aseguradora.json`.
- La ejecucion real de cotizacion sigue cableada por `slug` dentro de `backend/routes/proceso.js`.

Por eso, un alta nueva no queda terminada solo con agregar una carpeta en `data/`.

## Archivos que suelen participar

### 1. Configuracion y catalogos

- `data/<slug>/aseguradora.json`
  - requerido para que la aseguradora exista a nivel de configuracion y aparezca en el listado.
- `data/<slug>/diccionarios/*.json`
  - opcional; usar solo cuando la aseguradora necesite mapear uso, tipo de vehiculo, CP, aliases, etc.
- `data/<slug>/...`
  - se permiten catalogos o archivos auxiliares propios de la aseguradora, pero mantenerlos bien encapsulados.

### 2. Servicios

- `backend/services/<slug>/quote.js`
  - punto principal para construir request y parsear response.
- `backend/services/<slug>/auth.js`
  - usar si la autenticacion es independiente.
- `backend/services/<slug>/client.js`
  - usar si el transporte o headers merecen encapsulacion aparte.
- `backend/services/<slug>/commons.js`
  - usar si el adapter necesita helpers propios reutilizables.

### 3. Orquestacion comun

- `backend/routes/proceso.js`
  - imports del adapter;
  - `loadAsegConfig(slug)` para overlay por env;
  - `cotizarFila(...)` para el branch explicito del `slug`;
  - `getCompanyQueueConfig(...)` si la compania necesita throttling o retries especiales.

### 4. Tests

- `backend/tests/<slug>.quote.test.js`
  - minimo recomendado.
- `backend/tests/<slug>.auth.test.js`
  - si hay login o token propio.
- `backend/tests/<slug>.client.test.js`
  - si el cliente hace logica relevante.

## Puntos del flujo que ya son genericos

- `listAvailableAseguradoras()` detecta directorios en `data/` con `aseguradora.json`.
- `/aseguradoras/:slug/parametros` y `/aseguradoras/:slug/diccionarios/:nombre` usan rutas genericas.
- El preprocesador comun puede leer `data/<slug>/diccionarios/uso.json` y `tipo_vehiculo.json`.

## Puntos del flujo que NO son genericos

- El overlay de credenciales y variables de entorno en `loadAsegConfig(slug)`.
- El branch de ejecucion dentro de `cotizarFila(...)`.
- Reglas especiales de CP, retries o parsing tecnico.

## Heuristica de implementacion

### Si la aseguradora es nueva

- Crear `data/<slug>/aseguradora.json`.
- Crear `backend/services/<slug>/quote.js`.
- Agregar imports en `backend/routes/proceso.js`.
- Agregar branch para `slug` en `cotizarFila(...)`.
- Idealmente agregar test dedicado.

### Si la aseguradora ya existe

- Priorizar tocar su adapter actual.
- Evitar mover logica de negocio al flujo comun salvo que sirva para varias companias.

## Evidencias utiles para debug

Despues de una corrida, revisar:

- `data/procesos/proceso-<id>/evidencias/<slug>/fila-0000/`
- `data/procesos/proceso-<id>/resumen.json`
- `data/procesos/proceso-<id>/excel_manifest.json`

Estos artefactos sirven para confirmar:

- request realmente enviado,
- response cruda,
- parseo final,
- parametros `used`,
- y efecto real en el Excel.
