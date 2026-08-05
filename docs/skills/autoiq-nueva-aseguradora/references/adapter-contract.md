# AutoIQ Adapter Contract

## Proposito

Definir el shape operativo que un adapter de aseguradora deberia devolver para integrarse con el flujo actual sin tocar de mas la consolidacion comun.

## Resultado esperado

El branch de `cotizarFila(...)` deberia devolver un objeto parecido a este:

```js
{
  ok: true,
  operacion: "141676",
  suma_asegurada: "154700",
  coberturas: [
    {
      codigoDeCobertura: "36",
      descripcionDeCobertura: "RESPONSABILIDAD CIVIL",
      codigoDeProducto: "52",
      descripcionDeProducto: "BASICA",
      importePrima: "146.75",
      importePremio: "180.8",
      importeIVA: "30.82",
      importeTotalImpuestos: "34.05",
      importeRecargoFinanciero: "0",
      sumaAsegurada: "154700",
      requiereInspeccion: "false",
      valorComisionPAS: "12.5",
      porcentajeComisionPAS: "8.5",
      franquicia: "4000",
      franquiciaRobo: "0",
      conRecuperador: "N"
    }
  ],
  raw: "<xml or json raw>",
  used: {
    medioDePago: "T",
    cantidadDeCuotas: "1",
    codigoPostal: "1005",
    descuentoComercial: "20"
  }
}
```

En errores no tecnicos:

```js
{
  ok: false,
  error: "mensaje entendible",
  operacion: "0",
  coberturas: [],
  raw: "<raw response>"
}
```

En fallos tecnicos o retryables, preservar o permitir que el flujo comun derive:

- `pending`
- `technical_error`
- `retryable`
- `http_status`

## Regla importante de consolidacion

Cada item de `coberturas` se aplana con `flattenForExcel(cob, 'cot_')`. Eso significa que una propiedad como:

- `codigoDeCobertura`

termina convertida en:

- `cot_codigoDeCobertura`

y luego la consolidacion canonica ya sabe leer varias de esas claves.

## Nombres recomendados para las coberturas

Tomar esta lista como nombres preferidos, no como una obligacion rigida. La idea es reusar propiedades que la consolidacion actual ya sabe interpretar:

- `codigoDeCobertura`
- `descripcionDeCobertura`
- `codigoDeProducto`
- `descripcionDeProducto`
- `plan`
- `importePrima`
- `importePremio`
- `importePremioDebito`
- `importePremioEfectivo`
- `importeIVA`
- `importeTotalImpuestos`
- `importeRecargoFinanciero`
- `sumaAsegurada`
- `requiereInspeccion`
- `inspeccionable`
- `valorComisionPAS`
- `porcentajeComisionPAS`
- `franquicia`
- `franquiciaRobo`
- `conRecuperador`
- `duracion`
- `formapago`
- `formapago_descripcion`

## Regla para `used`

`used` deberia guardar lo que despues ayuda a explicar el resultado o a auditar el request:

- medio de pago enviado,
- cuotas,
- descuento o bonificacion,
- modalidad,
- clausula de ajuste,
- productor o agente,
- codigo postal final usado,
- aliases o fallbacks aplicados.

## Regla para `raw`

- Si la respuesta original es XML, guardar XML.
- Si es JSON, guardar el objeto o un string JSON.
- No borrar `raw` salvo que haya una razon de seguridad o volumen explicita.

## Regla para datos incompletos

- Si la compania no devuelve un dato, dejarlo vacio.
- No crear propiedades nuevas de cobertura solo para una aseguradora si ya existe una clave equivalente consumida por la consolidacion.
- Si hay que mapear una propiedad propia, hacerlo a un nombre ya reconocido por el builder canonico.
