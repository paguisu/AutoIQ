const fs = require('fs');
const path = require('path');

const root = 'D:/AutoIQ';
const sourceCsv = 'D:/OneDrive - Productores Asesores de Seguros Novecientos Once S.R.L/Seguros911/2-nuevo multi/recursos/top_modelos_webapp_autoiq.csv';
const outputDir = path.join(root, 'analisis', 'normalizacion-catalogo-webapp-experta');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift();
  return rows.filter(r => r.some(Boolean)).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(file, rows, headers) {
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(','))];
  fs.writeFileSync(file, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
}

function key(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function titleBrand(s) {
  const known = { FIAT:'Fiat', FORD:'Ford', HONDA:'Honda', HYUNDAI:'Hyundai', KIA:'Kia', JEEP:'Jeep', RAM:'RAM', DODGE:'Dodge', CHRYSLER:'Chrysler', PEUGEOT:'Peugeot', CITROEN:'Citroën', CHEVROLET:'Chevrolet', RENAULT:'Renault', TOYOTA:'Toyota', VOLKSWAGEN:'Volkswagen', NISSAN:'Nissan' };
  return known[String(s).toUpperCase()] || s;
}

const source = parseCsv(fs.readFileSync(sourceCsv, 'utf8').replace(/^\uFEFF/, ''));
const modelos = JSON.parse(fs.readFileSync(path.join(root, 'data/experta/diccionarios/modelos.json'), 'utf8'));
const marcas = JSON.parse(fs.readFileSync(path.join(root, 'data/experta/diccionarios/marcas.json'), 'utf8'));

const expByBrand = new Map();
for (const [compound, list] of Object.entries(modelos)) {
  const [year, brand] = compound.split('|');
  if (!expByBrand.has(brand)) expByBrand.set(brand, new Map());
  for (const item of list) {
    const name = item.descripcion;
    const k = key(name);
    if (!expByBrand.get(brand).has(k)) expByBrand.get(brand).set(k, new Map());
    const names = expByBrand.get(brand).get(k);
    if (!names.has(name)) names.set(name, new Set());
    names.get(name).add(Number(year));
  }
}

const explicit = {
  'TOYOTA|RAV4':'RAV 4', 'CHEVROLET|S10':'S 10', 'NISSAN|X-TRAIL':'XTRAIL',
  'HONDA|HR-V':'HRV', 'HONDA|CR-V':'CRV', 'HONDA|WR-V':'WRV', 'HONDA|ZR-V':'ZRV',
  'HYUNDAI|I10':'I 10', 'PEUGEOT|207':'207',
  'CITROEN|C4 LOUNGE':'C4', 'CITROEN|C4 CACTUS':'C4',
  'CITROEN|C3 AIRCROSS':'C3', 'CITROEN|C5 AIRCROSS':'C5'
};

const expertaBrandOverride = {
  'DODGE|JOURNEY':'CHRYSLER',
  'DODGE|RAM':'CHRYSLER'
};

function splitRecord(r) {
  if (r.marca === 'Fiat' && r.modelo === 'Palio/Siena') return [['FIAT','Palio'], ['FIAT','Siena']];
  if (r.marca === 'Peugeot' && r.modelo === '207/207 Compact') return [['PEUGEOT','207']];
  if (r.marca === 'Chrysler/Jeep/RAM') {
    const [prefix, ...rest] = r.modelo.split(' ');
    return [[prefix.toUpperCase(), rest.join(' ')]];
  }
  if (r.marca === 'Hyundai/Kia') {
    const [prefix, ...rest] = r.modelo.split(' ');
    return [[prefix.toUpperCase(), rest.join(' ')]];
  }
  return [[r.marca.toUpperCase().replace('CITROEN','CITROEN'), r.modelo]];
}

function expertaMatch(brand, model) {
  const originalBrand = brand;
  brand = expertaBrandOverride[`${brand}|${model.toUpperCase()}`] || brand;
  const wanted = explicit[`${originalBrand}|${model.toUpperCase()}`] || model;
  const candidates = expByBrand.get(brand);
  if (!candidates) return { brand, name:'', years:'', status:'marca_sin_catalogo_cache' };
  const byKey = candidates.get(key(wanted));
  if (!byKey) return { brand, name:'', years:'', status:'requiere_revision' };
  const ranked = [...byKey.entries()].sort((a,b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  const [name, years] = ranked[0];
  const family = key(wanted) !== key(model);
  const brandChanged = brand !== originalBrand;
  return { brand, name, years:[...years].sort((a,b)=>a-b).join('|'), status:family ? 'familia_experta_version_especifica' : brandChanged ? 'marca_experta_legacy' : name === model.toUpperCase() ? 'exacto' : 'alias_normalizado' };
}

const proposed = [];
const aliases = [];
for (const r of source) {
  const splits = splitRecord(r);
  for (let i = 0; i < splits.length; i++) {
    const [brandRaw, modelRaw] = splits[i];
    const brand = titleBrand(brandRaw);
    let model = modelRaw;
    if (brandRaw === 'HYUNDAI' && key(modelRaw) === 'I10') model = 'I10';
    const match = expertaMatch(brandRaw, model);
    const id = `${key(brand)}:${key(model)}`;
    proposed.push({
      id_catalogo:id,
      marca_visible:brand,
      modelo_visible:model,
      ranking_origen:r.ranking_sugerido,
      subranking_desempate:i + 1,
      tipo:r.tipo,
      marca_experta:match.brand,
      modelo_experta:match.name,
      anios_confirmados_experta:match.years,
      estado_correspondencia:match.status,
      marca_grupo_original:r.marca,
      modelo_original:r.modelo,
      uso_webapp:r.uso_webapp,
      criterio:r.criterio,
      imagen_estandarizable:r.imagen_estandarizable,
      prompt_imagen_propuesto:`${brand} ${model}, vista 3/4 frontal, estilo render realista de vehículo, fondo transparente, imagen cuadrada, sin logos ni texto, iluminación de estudio`,
      observacion:r.modelo.includes('/') ? 'Registro original desagrupado o consolidado según identidad real del modelo.' : (r.marca.includes('/') ? 'Marca comercial separada del grupo original.' : '')
    });
    const aliasSet = new Set([model, modelRaw, r.modelo, match.name].filter(Boolean));
    if (brandRaw === 'HYUNDAI' && key(model) === 'I10') ['I 10','i10','Hyundai i10','Hyundai I 10'].forEach(x=>aliasSet.add(x));
    if (brandRaw === 'JEEP' && key(model) === 'RENEGADE') ['Jeep Renegade','Jeep Renagade','Renagade'].forEach(x=>aliasSet.add(x));
    for (const alias of aliasSet) aliases.push({id_catalogo:id,marca_visible:brand,modelo_visible:model,alias,alias_normalizado:key(alias),origen:alias===match.name?'Experta':alias===r.modelo?'tabla_actual':'regla_propuesta'});
  }
}

proposed.sort((a,b) => a.marca_visible.localeCompare(b.marca_visible,'es') || Number(a.ranking_origen)-Number(b.ranking_origen) || Number(a.subranking_desempate)-Number(b.subranking_desempate));
const dedupAliases = [...new Map(aliases.map(a => [`${a.id_catalogo}|${a.alias_normalizado}`,a])).values()]
  .sort((a,b)=>a.marca_visible.localeCompare(b.marca_visible,'es')||a.modelo_visible.localeCompare(b.modelo_visible,'es')||a.alias.localeCompare(b.alias,'es'));

fs.mkdirSync(path.join(outputDir, 'archivos'), { recursive:true });
writeCsv(path.join(outputDir,'archivos','catalogo_modelos_propuesto.csv'), proposed, Object.keys(proposed[0]));
writeCsv(path.join(outputDir,'archivos','aliases_modelos_propuestos.csv'), dedupAliases, Object.keys(dedupAliases[0]));
writeCsv(path.join(outputDir,'archivos','casos_a_revisar.csv'), proposed.filter(x=>x.estado_correspondencia.includes('revision')||x.estado_correspondencia.includes('sin_catalogo')), Object.keys(proposed[0]));
fs.copyFileSync(sourceCsv, path.join(outputDir,'archivos','tabla_webapp_original.csv'));
fs.copyFileSync(path.join(root,'data/experta/diccionarios/marcas.json'), path.join(outputDir,'archivos','experta_marcas_snapshot.json'));
fs.copyFileSync(path.join(root,'data/experta/diccionarios/modelos.json'), path.join(outputDir,'archivos','experta_modelos_snapshot.json'));

const years = Object.keys(marcas).map(Number).sort((a,b)=>a-b);
const summary = {
  generado_en:new Date().toISOString(), fuente_webapp:sourceCsv,
  filas_origen:source.length, filas_propuestas:proposed.length,
  marcas_origen:[...new Set(source.map(x=>x.marca))].length,
  marcas_propuestas:[...new Set(proposed.map(x=>x.marca_visible))].length,
  aliases:dedupAliases.length,
  correspondencias:Object.fromEntries([...new Set(proposed.map(x=>x.estado_correspondencia))].map(s=>[s,proposed.filter(x=>x.estado_correspondencia===s).length])),
  cache_experta:{anios_marcas:`${years[0]}-${years.at(-1)}`,claves_modelos:Object.keys(modelos).length}
};
fs.writeFileSync(path.join(outputDir,'archivos','resumen_validacion.json'), JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
