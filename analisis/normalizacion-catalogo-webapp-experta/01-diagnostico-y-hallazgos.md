# 1. Diagnóstico y hallazgos

## Alcance y fuentes

Se comparó la tabla curada de la Webapp `top_modelos_webapp_autoiq.csv` con los catálogos locales de marcas y modelos obtenidos de Experta. Se completó el caché de modelos de Experta para las marcas involucradas y los años disponibles. La tabla de la Webapp se copió al paquete, pero no se alteró en su ubicación original.

La tabla actual contiene 120 filas: 12 rótulos de marca y 10 posiciones por rótulo. Dos rótulos no son marcas reales sino agrupaciones: `Chrysler/Jeep/RAM` y `Hyundai/Kia`.

## Problemas detectados

### 1. Marca, terminal y grupo comercial están mezclados

`Chrysler/Jeep/RAM` y `Hyundai/Kia` sirven como agrupaciones editoriales, pero no son valores adecuados para una clave de catálogo. Experta, InfoAuto y las aseguradoras esperan una marca concreta. Además, dentro del primer grupo aparecen vehículos Dodge, que agrega una cuarta marca.

La propuesta produce 16 marcas visibles reales a partir de los 12 rótulos originales. El grupo original se conserva en `marca_grupo_original` para auditoría.

### 2. Algunos modelos repiten la marca

Ejemplos actuales: `Jeep Renegade`, `Hyundai Tucson`, `Kia Sportage`. Si la marca ya es un campo separado, repetirla en el modelo complica búsquedas, aliases, comparaciones y presentación. La salida propuesta usa `Jeep + Renegade`, `Hyundai + Tucson` y `Kia + Sportage`.

### 3. Hay registros que agrupan modelos distintos

`Palio/Siena` representa dos modelos con carrocerías e historiales diferentes. Se divide en dos filas. Por eso la propuesta pasa de 120 a 121 filas.

### 4. Hay rótulos que mezclan modelo y variante

`207/207 Compact` no necesita dos opciones de UX si Experta resuelve la denominación completa en la versión. La propuesta deja `207` como modelo visible.

El mismo principio debe aplicarse con cuidado a familias como C3, C4 y C5: la UX puede mostrar `C4 Cactus` o `C4 Lounge`, pero Experta puede exigir primero `C4` y recién distinguir `Cactus/Lounge` en la lista de versiones del año.

### 5. Diferencias tipográficas no implican modelos distintos

Se confirmaron equivalencias como:

- `I10` visible ↔ `I 10` en Experta.
- `RAV4` ↔ `RAV 4`.
- `S10` ↔ `S 10`.
- `X-Trail` ↔ `XTRAIL`.
- `HR-V` ↔ `HRV`.

Estas diferencias se resuelven mediante aliases y una clave normalizada, no cambiando el texto visible al formato menos amigable.

### 6. Existen clasificaciones legacy del proveedor

Experta ubica `Journey` y `RAM` de ciertos años bajo `CHRYSLER`, aunque comercialmente se muestren como Dodge. La marca visible y la marca de consulta deben poder diferir. No conviene contaminar la UX con la clasificación interna del proveedor.

### 7. El catálogo depende del año

La presencia y el nombre de un modelo cambian según el año. Por eso un catálogo consolidado no debe interpretarse como autorización para enviar cualquier combinación año–marca–modelo. La consulta correcta es progresiva: año → marca Experta → modelo Experta → versión Experta.

## Cobertura y limitaciones

La comparación automática usa normalización de mayúsculas, tildes, espacios y signos. También incorpora reglas explícitas para familias conocidas y marcas legacy. Los casos que permanezcan en `casos_a_revisar.csv` no deben resolverse con similitud difusa silenciosa.

Los diccionarios de Experta no contienen suma asegurada. Sirven para identidad, códigos y versiones; la suma debe continuar viniendo de InfoAuto o de la respuesta de cotización, según el contrato de cada compañía.

## Conclusión

Experta mejora sensiblemente la calidad de la taxonomía y permite validar la combinación año–marca–modelo–versión, pero no debe reemplazar a InfoAuto como identificador transversal ni como fuente de valuación. La arquitectura aconsejada es complementaria: UX normalizada + aliases + código InfoAuto + adaptador específico por aseguradora.

