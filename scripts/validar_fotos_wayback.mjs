// Valida TODAS las fotos archivadas del catálogo:
//  1. Si la URL original no está en el índice CDX de capturas reales, intenta otra
//     variante de tamaño de la misma imagen que sí esté archivada.
//  2. Verifica cada foto con un GET real (siguiendo redirects del Archive).
//  3. Las que no sirvan quedan sin foto (mejor el emoji de categoría que un enlace roto).
// Uso: node scripts/validar_fotos_wayback.mjs <cdx-imagenes.json>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rutaProductos = path.join(raiz, "data", "productos.json");
const productos = JSON.parse(readFileSync(rutaProductos, "utf-8"));
const filas = JSON.parse(readFileSync(process.argv[2], "utf-8")).slice(1);

// Índices de capturas reales: por URL exacta y por nombre base (sin sufijo de tamaño)
const norm = (u) => u.replace(/^https?:\/\/(www\.)?/, "").toLowerCase();
const porUrl = new Map(), porBase = new Map();
for (const [original, ts] of filas) {
  const clave = norm(original);
  if (!porUrl.has(clave) || ts > porUrl.get(clave).ts) porUrl.set(clave, { original, ts });
  const archivo = decodeURIComponent(original.split("/").pop().split("?")[0]);
  const sinExt = archivo.replace(/\.(jpe?g|png|webp|gif)$/i, "");
  const m = sinExt.match(/^(.*?)-(\d{2,4})x(\d{2,4})$/);
  const base = (m ? m[1] : sinExt).toLowerCase();
  const area = m ? Number(m[2]) * Number(m[3]) : Infinity;
  const e = porBase.get(base);
  if (!e || area > e.area) porBase.set(base, { original, ts, area });
}

// Paso 1: re-anclar cada foto a una captura que exista de verdad
let reancladas = 0;
for (const p of productos) {
  if (!p.imagen) continue;
  const m = p.imagen.match(/\/web\/\d+im_\/(.+)$/);
  if (!m) continue;
  const original = m[1];
  const exacta = porUrl.get(norm(original));
  if (exacta) {
    p.imagen = `https://web.archive.org/web/${exacta.ts}im_/${exacta.original}`;
    continue;
  }
  const archivo = decodeURIComponent(original.split("/").pop().split("?")[0]);
  const base = archivo.replace(/\.(jpe?g|png|webp|gif)$/i, "")
    .replace(/-(\d{2,4})x(\d{2,4})$/, "").toLowerCase();
  const variante = porBase.get(base);
  if (variante) {
    p.imagen = `https://web.archive.org/web/${variante.ts}im_/${variante.original}`;
    reancladas++;
  }
  // si no hay variante, la verificación del paso 2 decidirá
}
console.log(`Re-ancladas a variantes archivadas: ${reancladas}`);

// Paso 2: GET real a todas — SECUENCIAL y amable con el Archive (si vamos en
// paralelo devuelve 429 y no hay que confundir "me limitaste" con "no existe").
// Solo un 404 confirmado dos veces retira la foto; ante 429/5xx/timeout se conserva.
const conFoto = productos.filter(p => p.imagen);
console.log(`Verificando ${conFoto.length} fotos (secuencial)…`);
let vivas = 0, muertas = [], dudosas = 0;
const espera = (ms) => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < conFoto.length; i++) {
  const p = conFoto[i];
  let veces404 = 0, viva = false;
  for (let intento = 1; intento <= 3 && !viva; intento++) {
    try {
      const r = await fetch(p.imagen, { redirect: "follow", signal: AbortSignal.timeout(30000) });
      const tipo = r.headers.get("content-type") || "";
      if (r.ok && tipo.startsWith("image/")) viva = true;
      else if (r.status === 404) { veces404++; if (veces404 >= 2) break; await espera(2000); }
      else if (r.status === 429) await espera(15000 * intento); // limitados: frenar en seco
      else await espera(3000 * intento);
    } catch { await espera(3000 * intento); }
  }
  if (viva) vivas++;
  else if (veces404 >= 2) { muertas.push(p.sku); p.imagen = ""; }
  else dudosas++; // no confirmado: se conserva la foto
  if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${conFoto.length} (vivas ${vivas}, rotas ${muertas.length})`);
  await espera(500);
}
console.log(`Dudosas conservadas (no se pudo confirmar): ${dudosas}`);

writeFileSync(rutaProductos, JSON.stringify(productos, null, 1));
console.log(`\nFotos vivas: ${vivas} | retiradas por rotas: ${muertas.length}`);
if (muertas.length) console.log("Sin foto (rotas): " + muertas.join(", "));
