// Remate: para productos que aún no tienen foto, saca la imagen de la galería
// WooCommerce del snapshot archivado (cuando el og:image no existía).
// También imprime el precio que muestra la página archivada de los SKU que se pasen
// como argumentos extra, para auditar datos sospechosos del sheet.
// Uso: node scripts/rematar_fotos_wayback.mjs <cdx-paginas.json> [SKU-a-auditar...]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rutaProductos = path.join(raiz, "data", "productos.json");
const productos = JSON.parse(readFileSync(rutaProductos, "utf-8"));
const paginas = JSON.parse(readFileSync(process.argv[2], "utf-8")).slice(1);
const auditar = new Set(process.argv.slice(3).map(s => s.toUpperCase()));

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

const espera = (ms) => new Promise(r => setTimeout(r, ms));
const objetivo = productos.filter(p =>
  (!p.imagen || auditar.has(p.sku.toUpperCase())) && porSlug.has(p.slug.toLowerCase()));
console.log(`A revisar: ${objetivo.map(p => p.sku).join(", ")}`);

for (const p of objetivo) {
  const { original, ts } = porSlug.get(p.slug.toLowerCase());
  let html = "";
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await fetch(`https://web.archive.org/web/${ts}/${original}`);
      if (r.ok) { html = await r.text(); break; }
    } catch { /* red */ }
    await espera(2500 * intento);
  }
  if (!html) { console.log(`  [sin snapshot] ${p.sku}`); continue; }

  if (!p.imagen) {
    // Galería Woo: primer <img> que apunte a wp-content/uploads (ya archivado)
    const m = html.match(/<img[^>]+src="([^"]*wp-content\/uploads[^"]+\.(?:jpe?g|png|webp))"/i);
    if (m) {
      let img = m[1];
      const arch = img.match(/\/web\/(\d+)(?:im_)?\/(.+)$/);
      img = arch ? `https://web.archive.org/web/${arch[1]}im_/${arch[2]}`
                 : `https://web.archive.org/web/${ts}im_/${img.startsWith("http") ? img : "https://equipmaster.com.co" + img}`;
      p.imagen = img;
      console.log(`  [foto galería] ${p.sku}`);
    } else console.log(`  [página sin imagen] ${p.sku}`);
  }
  if (auditar.has(p.sku.toUpperCase())) {
    const precios = [...html.matchAll(/woocommerce-Price-amount[^>]*>(?:<bdi>)?[^0-9]*([\d.,]{4,})/g)]
      .map(x => x[1]).slice(0, 4);
    console.log(`  [auditoría precio] ${p.sku}: sheet=${p.precio} | página archivada muestra: ${precios.join(" / ") || "sin precio"}`);
  }
  await espera(800);
}

writeFileSync(rutaProductos, JSON.stringify(productos, null, 1));
const conFoto = productos.filter(p => p.imagen).length;
console.log(`TOTAL: ${conFoto}/${productos.length} con foto`);
