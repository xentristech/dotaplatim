// Completa fotos y precios leyendo las PÁGINAS de producto archivadas en la Wayback
// Machine: para cada producto sin foto (o sin precio) busca su página por slug,
// descarga el snapshot y extrae og:image (foto exacta) y el precio de WooCommerce.
// Uso: node scripts/completar_desde_paginas_wayback.mjs <cdx-paginas.json>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rutaProductos = path.join(raiz, "data", "productos.json");
const productos = JSON.parse(readFileSync(rutaProductos, "utf-8"));
const paginas = JSON.parse(readFileSync(process.argv[2], "utf-8")).slice(1);

// Índice: último segmento del path → captura más reciente
const porSlug = new Map();
for (const [original, ts] of paginas) {
  try {
    const partes = new URL(original).pathname.split("/").filter(Boolean);
    if (!partes.length) continue;
    const ultimo = decodeURIComponent(partes[partes.length - 1]).toLowerCase();
    const previo = porSlug.get(ultimo);
    if (!previo || ts > previo.ts) porSlug.set(ultimo, { original, ts });
  } catch { /* URL rara del CDX: ignorar */ }
}
console.log(`Páginas indexadas por slug: ${porSlug.size}`);

const objetivo = productos.filter(p => !p.imagen || p.precio == null);
console.log(`Productos a completar (sin foto o sin precio): ${objetivo.length}`);
const conPagina = objetivo.filter(p => porSlug.has(p.slug.toLowerCase()));
console.log(`Con página archivada: ${conPagina.length}`);

const espera = (ms) => new Promise(r => setTimeout(r, ms));
let fotos = 0, precios = 0, fallos = 0;

for (const p of conPagina) {
  const { original, ts } = porSlug.get(p.slug.toLowerCase());
  const url = `https://web.archive.org/web/${ts}/${original}`;
  let html = "";
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await fetch(url, { redirect: "follow" });
      if (r.ok) { html = await r.text(); break; }
      if (r.status === 404) break;
    } catch { /* red: reintentar */ }
    await espera(2500 * intento);
  }
  if (!html) { fallos++; console.log(`  [sin snapshot] ${p.sku}`); continue; }

  if (!p.imagen) {
    const og = html.match(/property="og:image"[^>]*content="([^"]+)"/) ||
               html.match(/content="([^"]+)"[^>]*property="og:image"/);
    if (og) {
      // La URL archivada viene como /web/{ts}/https://...: convertirla a im_ (imagen cruda)
      let img = og[1];
      const m = img.match(/\/web\/(\d+)(?:im_)?\/(.+)$/);
      img = m ? `https://web.archive.org/web/${m[1]}im_/${m[2]}`
              : `https://web.archive.org/web/${ts}im_/${img}`;
      p.imagen = img;
      fotos++;
    }
  }
  if (p.precio == null) {
    // Precio Woo: <span class="woocommerce-Price-amount"...>$&nbsp;1.234.567</span>
    const m = html.match(/woocommerce-Price-amount[^>]*>(?:<bdi>)?[^0-9]*([\d.,]{4,})/);
    if (m) {
      const valor = Number(m[1].replace(/[.,]/g, ""));
      if (valor > 10000 && valor < 500000000) { p.precio = valor; precios++; }
    }
  }
  console.log(`  [ok] ${p.sku}${p.imagen ? " foto" : ""}${p.precio != null ? " precio " + p.precio : ""}`);
  await espera(800); // respetar al Archive
}

writeFileSync(rutaProductos, JSON.stringify(productos, null, 1));
const resumen = productos.reduce((s, p) => ({
  conFoto: s.conFoto + (p.imagen ? 1 : 0),
  sinPrecio: s.sinPrecio + (p.precio == null ? 1 : 0) }), { conFoto: 0, sinPrecio: 0 });
console.log(`\nFotos nuevas: ${fotos} | precios nuevos: ${precios} | fallos: ${fallos}`);
console.log(`TOTAL: ${resumen.conFoto}/${productos.length} con foto, ${resumen.sinPrecio} sin precio`);
