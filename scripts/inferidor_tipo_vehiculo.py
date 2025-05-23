import sys
import pandas as pd
import requests
import time
import os

def inferir_tipo_vehiculo(row):
    anio = int(row['anio'])
    marca = row['Marca']
    modelo = row['Modelo']

    try:
        r = requests.get(f'https://www.fueleconomy.gov/ws/rest/vehicle/menu/options?year={anio}&make={marca}&model={modelo}', headers={'Accept': 'application/json'})
        if r.status_code != 200:
            return None

        data = r.json()
        if not data or 'menuItem' not in data:
            return None

        opciones = data['menuItem']
        for opcion in opciones:
            if 'SUV' in opcion['text']:
                return 'SUV'
            elif 'Pickup' in opcion['text']:
                return 'Pick-Up'
            elif 'Van' in opcion['text']:
                return 'Camioneta'
            elif 'Wagon' in opcion['text']:
                return 'Rural'
            elif 'Convertible' in opcion['text']:
                return 'Convertible'
            elif 'Coupe' in opcion['text']:
                return 'Coupé'
        return 'Sedán'
    except Exception:
        return None

def main(ruta_excel):
    df = pd.read_excel(ruta_excel)

    if 'tipo_vehiculo' not in df.columns:
        df['tipo_vehiculo'] = None

    modificados = 0
    total = len(df)
    progreso_path = ruta_excel.replace(".xlsx", "-progreso.txt")

    for i, row in df.iterrows():
        if pd.isna(row['tipo_vehiculo']):
            with open(progreso_path, 'w', encoding='utf-8') as f:
                f.write(f"Procesando {i+1} de {total} registros...")
            tipo = inferir_tipo_vehiculo(row)
            if tipo:
                df.at[i, 'tipo_vehiculo'] = tipo
                modificados += 1
            time.sleep(1)

    ruta_salida = ruta_excel.replace('.xlsx', '-inferido.xlsx')
    df.to_excel(ruta_salida, index=False)

    # mensaje final
    with open(progreso_path, 'w', encoding='utf-8') as f:
        f.write(f"Inferencia finalizada. {modificados} registros modificados.")

    # eliminar archivo de progreso
    time.sleep(2)  # da tiempo a que el frontend lea el último mensaje
    try:
        os.remove(progreso_path)
    except Exception:
        pass

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("Uso: python inferidor_tipo_vehiculo.py archivo.xlsx")
        sys.exit(1)

    archivo = sys.argv[1]
    if not os.path.exists(archivo):
        print(f"Archivo no encontrado: {archivo}")
        sys.exit(1)

    main(archivo)