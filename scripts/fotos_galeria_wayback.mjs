// Última pasada de fotos: para productos SIN foto, lee su página archivada y toma la
// primera imagen de galería cuyo archivo esté CONFIRMADO en el índice CDX de capturas
// (exacto o variante de tamaño). Así la foto es del producto correcto y sí sirve.
// Uso: node scripts/fotos_galeria_wayback.mjs <cdx-paginas.json> <cdx-imagenes.json>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rutaProductos = path.join(raiz, "data", "productos.json");
const productos = JSON.parse(readFileSync(rutaProductos, "utf-8"));
const paginas = JSON.parse(readFileSync(process.argv[2], "utf-8")).slice(1);
const imagenes = JSON.parse(readFileSync(process.argv[3], "utf-8")).slice(1);

const porSlug = new Map();
for (const [original, ts] of paginas) {
  try {
    const partes = new URL(original).pathname.split("/").filter(Boolean);
    if (!partes.length) continue;
    const ultimo = decodeURIComponent(partes[partes.length - 1]).toLowerCase();
    const previo = porSlug.get(ultimo);
    if (!previo || ts > previo.ts) porSlug.set(ultimo, { original, ts });
  } catch { /* ignorar */ }
}

// Índice de imágenes confirmadas: por URL exacta y por base sin sufijo de tamaño
const clave = (u) => u.replace(/^https?:\/\/(www\.)?/, "").split("?")[0].toLowerCase();
const laBase = (u) => decodeURIComponent(u.split("/").pop().split("?")[0])
  .replace(/\.(jpe?g|png|webp|gif)$/i, "").replace(/-(\d{2,4})x(\d{2,4})$/, "").toLowerCase();
const porUrl = new Map(), porBase = new Map();
for (const [original, ts, mime] of imagenes) {
  if (!/image/.test(mime)) continue;
  porUrl.set(clave(original), { original, ts });
  const b = laBase(original);
  const archivo = decodeURIComponent(original.split("/").pop().split("?")[0]);
  const m = archivo.match(/-(\d{2,4})x(\d{2,4})\./);
  const area = m ? Number(m[1]) * Number(m[2]) : Infinity;
  const e = porBase.get(b);
  if (!e || area > e.area) porBase.set(b, { original, ts, area });
}

const espera = (ms) => new Promise(r => setTimeout(r, ms));
const sinFoto = productos.filter(p =>
  (!p.imagen || /favicon|cropped-|\/logo/i.test(p.imagen)) &&
  !p.sku.toUpperCase().startsWith("PRUEBA") && porSlug.has(p.slug.toLowerCase()));
console.log(`Sin foto con página archivada: ${sinFoto.length}`);

let logradas = 0;
for (const p of sinFoto) {
  const { original, ts } = porSlug.get(p.slug.toLowerCase());
  let html = "";
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await fetch(`https://web.archive.org/web/${ts}/${original}`,
        { signal: AbortSignal.timeout(45000) });
      if (r.ok) { html = await r.text(); break; }
      if (r.status === 429) await espera(15000 * intento);
      else await espera(3000 * intento);
    } catch { await espera(3000 * intento); }
  }
  if (!html) { console.log(`  [sin snapshot] ${p.sku}`); continue; }

  // Solo el bloque de la galería del producto (nunca el favicon del <head> ni el
  // logo del header, y cortando antes de los "productos relacionados").
  const desde = html.search(/woocommerce-product-gallery|product-images|single-product/i);
  const hasta = html.search(/related[ _-]products|productos relacionados|<footer/i);
  const zona = desde >= 0 ? html.slice(desde, hasta > desde ? hasta : undefined) : html;
  const crudas = [...zona.matchAll(/(?:src|data-src|data-large_image|href)="([^"]*wp-content\/uploads[^"]+?\.(?:jpe?g|png|webp))"/gi)]
    .map(m => m[1].replace(/^.*\/web\/\d+(?:im_)?\//, "").replace(/^\/\//, "https://"))
    .map(u => u.startsWith("http") ? u : "https://equipmaster.com.co" + u)
    .filter(u => !/favicon|cropped-|\/logo|placeholder/i.test(u));
  let elegida = null;
  for (const u of crudas) {
    const exacta = porUrl.get(clave(u));
    if (exacta) { elegida = exacta; break; }
    const variante = porBase.get(laBase(u));
    if (variante) { elegida = variante; break; }
  }
  if (elegida) {
    p.imagen = `https://web.archive.org/web/${elegida.ts}im_/${elegida.original}`;
    logradas++;
    console.log(`  [foto] ${p.sku}`);
  } else console.log(`  [nada archivado] ${p.sku} (${crudas.length} candidatas)`);
  await espera(700);
}

writeFileSync(rutaProductos, JSON.stringify(productos, null, 1));
const conFoto = productos.filter(p => p.imagen).length;
console.log(`\nRecuperadas: ${logradas} | TOTAL con foto: ${conFoto}/${productos.length}`);
