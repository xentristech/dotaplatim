// Cruza las imágenes archivadas de equipmaster.com.co (Wayback Machine) con los
// productos de la ferretería fundadora, por SKU y por tokens del slug.
// Uso: node scripts/cruzar_fotos_wayback.mjs <cdx-imagenes.json>
// Actualiza data/productos.json (campo imagen) y reporta el detalle del cruce.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rutaCdx = process.argv[2];
if (!rutaCdx) { console.error("Falta la ruta del cdx-imagenes.json"); process.exit(1); }

const filas = JSON.parse(readFileSync(rutaCdx, "utf-8")).slice(1)
  .filter(f => /image/.test(f[2]));

// Nombre base del archivo sin tamaño (-115x140) ni extensión; variantes agrupadas.
const variantes = new Map(); // base -> { mejor: {url, ts, area}, original: {url, ts} }
for (const [original, ts] of filas) {
  const archivo = decodeURIComponent(original.split("/").pop().split("?")[0]);
  const sinExt = archivo.replace(/\.(jpe?g|png|webp|gif)$/i, "");
  const m = sinExt.match(/^(.*?)-(\d{2,4})x(\d{2,4})$/);
  const base = (m ? m[1] : sinExt).toLowerCase();
  const area = m ? Number(m[2]) * Number(m[3]) : Infinity; // sin sufijo = imagen completa
  const e = variantes.get(base) || {};
  if (!e.mejor || area > e.mejor.area) e.mejor = { url: original, ts, area };
  variantes.set(base, e);
}
console.log(`Imágenes únicas (agrupando tamaños): ${variantes.size}`);

const norm = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();
const PARO = new Set(["de", "la", "el", "los", "las", "con", "para", "por", "y", "en",
  "a", "un", "una", "x", "equipmaster", "producto", "copia", "copy", "logo", "img",
  "image", "foto", "nueva", "new", "scaled", "final", "web", "1", "2", "3"]);
const tokens = (t) => norm(t).split(" ").filter(w => w.length > 1 && !PARO.has(w));

const candidatos = [...variantes.entries()].map(([base, e]) => ({
  base, baseCompacta: base.replace(/[^a-z0-9]/g, ""), toks: new Set(tokens(base)), ...e.mejor,
}));

const productos = JSON.parse(readFileSync(path.join(raiz, "data", "productos.json"), "utf-8"));
let porSku = 0, porSlug = 0, sinFoto = [];
for (const p of productos) {
  // Códigos derivados del SKU: completo, sin sufijo regional (-B3), por partes
  // ("BT 131-200" → bt131200, bt131) — solo códigos con dígito y 4+ caracteres,
  // para no casar palabras genéricas.
  const partes = p.sku.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const codigos = [...new Set([
    partes.join(""),
    partes.filter(t => !/^b3$/.test(t)).join(""),
    partes.slice(0, 2).join(""),
    ...partes,
  ])].filter(c => c.length >= 4 && /\d/.test(c) && /[a-z]/.test(c) || c.length >= 5 && /\d/.test(c));
  let elegido = null, como = "";
  // 1) Algún código del SKU dentro del nombre de archivo (del código más largo al más corto)
  for (const codigo of codigos.sort((a, b) => b.length - a.length)) {
    const porCodigo = candidatos.filter(c => c.baseCompacta.includes(codigo));
    if (porCodigo.length) {
      elegido = porCodigo.sort((a, b) => a.base.length - b.base.length)[0];
      como = "sku";
      break;
    }
  }
  // 2) Tokens del slug: el archivo cuyo nombre mejor se solape con el producto
  if (!elegido) {
    const toksProducto = new Set(tokens(p.slug.replace(/-/g, " ")));
    let mejor = null, mejorPuntaje = 0;
    for (const c of candidatos) {
      if (!c.toks.size) continue;
      let comunes = 0;
      for (const t of c.toks) if (toksProducto.has(t)) comunes++;
      // puntaje: cobertura del nombre del archivo, ponderada por cantidad de tokens
      const puntaje = (comunes / c.toks.size) * Math.min(comunes, 5);
      if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = c; }
    }
    // Exigente: el archivo debe estar (casi) contenido en el nombre del producto
    if (mejor && mejorPuntaje >= 2.65) { elegido = mejor; como = "slug"; }
  }
  if (elegido) {
    p.imagen = `https://web.archive.org/web/${elegido.ts}im_/${elegido.url}`;
    como === "sku" ? porSku++ : porSlug++;
  } else if (!p.imagen) {
    sinFoto.push(`${p.sku} — ${p.nombre}`);
  }
}

writeFileSync(path.join(raiz, "data", "productos.json"), JSON.stringify(productos, null, 1));
console.log(`Con foto por SKU: ${porSku} | por slug: ${porSlug} | sin foto: ${sinFoto.length}`);
if (sinFoto.length) console.log("SIN FOTO:\n  " + sinFoto.join("\n  "));
