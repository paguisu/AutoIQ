# AutoIQ

Cotizador masivo de seguros de autos.

Restauración AutoIQ - Agosto 2025

Este documento resume la funcionalidad, estructura y requerimientos de los archivos clave restaurados en el proyecto AutoIQ.

📁 Estructura del Proyecto

AutoIQ/
├── backend/
│   ├── server.js
│   ├── config/
│   │   └── db.js
│   ├── utils/
│   │   └── validarColumnas.js
├── scripts/
│   └── combinador.js
├── frontend/
│   └── index.html
├── data/
│   ├── archivos_subidos/
│   └── combinados/

⚙️ Archivos Restaurados

backend/server.js

Servidor principal en Express

Soporta:

Subida de archivos para modo combinatorio y taxativo

Validación de columnas obligatorias

Autocompletado de campos vacíos ('uso', 'tipo_vehiculo')

Escritura y descarga de archivos combinados

Registro de historial en MySQL (historial_combinaciones)

Endpoint /cotizar con soporte para múltiples compañías y datos del asegurado

frontend/index.html

Interfaz dividida en pestañas:

Inputs: Subida de archivos

Cabecera: Datos del asegurado (edad, fecha nacimiento, género, estado civil, medio de pago)

Histórico: Tabla con historial de combinaciones generadas

Base Propia: (placeholder actual)

Incluye lógica en JS para pestañas y fetch de historial

backend/utils/validarColumnas.js

Verifica columnas requeridas por tipo de operación:

combinatoriaVehiculos: marca, modelo, codigo_infoauto

combinatoriaCP: codigo_postal, localidad

taxativa: marca, modelo, codigo_infoauto, codigo_postal, localidad

backend/config/db.js

Conexión MySQL vía mysql2/promise

Con pool de conexiones

Base configurada: autoIQ

scripts/combinador.js

Lógica de combinación cartesiana entre registros de vehículos y códigos postales

Genera un Excel con hoja Combinado


🔄 Requisitos para ejecución local

1- Tener MySQL corriendo con base autoIQ y tabla:

CREATE TABLE historial_combinaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre_archivo VARCHAR(255),
  fecha DATETIME,
  cantidad_registros INT
);

2- Node.js v18+

3- Instalar dependencias:

npm install express multer xlsx mysql2

4- Ejecutar servidor:

cd backend
node server.js

5- Acceder desde navegador:

http://localhost:3000

📌 Notas adicionales

* Las rutas de archivos usan path.join(__dirname, ...) para asegurar compatibilidad

* Todos los errores se reportan en el HTML de respuesta o en la consola del servidor

* Se puede extender el cotizador con nuevas aseguradoras fácilmente

Actualizado por Vera · Agosto 2025 ✅