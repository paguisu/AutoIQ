# AutoIQ New Insurer Validation

## Minimo aceptable

Antes de considerar integrada una aseguradora nueva, validar:

- request armado correctamente;
- parseo exitoso;
- parseo de error;
- shape del resultado compatible con el flujo comun;
- salida comparable en el Excel;
- ausencia de regresiones evidentes en otras aseguradoras.

## Tests recomendados

### Tests unitarios dirigidos

```powershell
npm test -- --runInBand backend/tests/<slug>.quote.test.js
```

Si aplica:

```powershell
npm test -- --runInBand backend/tests/<slug>.auth.test.js
npm test -- --runInBand backend/tests/<slug>.client.test.js
```

### Suite mas amplia

```powershell
npm test -- --runInBand
```

## Casos que conviene cubrir

- request con defaults minimos;
- request con parametros propios de la aseguradora;
- response exitosa con una cobertura;
- response exitosa con varias coberturas o planes;
- error funcional de negocio;
- error tecnico HTTP o timeout si aplica;
- medios de pago relevantes para esa compania.

## Control operativo de bonificacion y descuento

No tratar la verificacion de bonificacion o descuento como requisito obligatorio de cada alta nueva.

Hacer ese control con una cadencia operativa, por ejemplo una vez por mes, idealmente aprovechando la actualizacion de la tabla InfoAuto de ATM.

Cuando se haga ese control:

- correr al menos una prueba con descuento o bonificacion y otra sin ese parametro;
- verificar si la aseguradora devuelve el dato en response;
- verificar si, cuando no lo devuelve, AutoIQ conserva el fallback desde request de forma consistente.

## Validacion manual de una corrida

Si el entorno y las credenciales lo permiten:

1. Ejecutar una corrida controlada con una sola fila y la nueva aseguradora.
2. Revisar `data/procesos/proceso-<id>/evidencias/<slug>/fila-0000/`.
3. Revisar `data/procesos/proceso-<id>/resumen.json`.
4. Revisar `data/procesos/proceso-<id>/excel_manifest.json`.
5. Descargar o abrir el Excel final y confirmar que la fila entra en el contrato comun.

## Checklist de cierre

- El `slug` aparece en el listado de aseguradoras disponibles.
- La configuracion vive en `data/<slug>/aseguradora.json`.
- El adapter vive en `backend/services/<slug>/`.
- `cotizarFila(...)` sabe ejecutar esa aseguradora.
- El resultado devuelve `coberturas` compatibles con la consolidacion.
- No se agregaron columnas nuevas al Excel.
- Los campos de negocio relevantes quedan comparables con otras aseguradoras.
- Si hay bonificacion, se entiende de donde sale: response o fallback de request.
- Si hay franquicia, entra en `franquicia` y `franquicia_robo` solo cuando corresponda.
