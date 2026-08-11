// Entrada serverless (Vercel): base SQLite EN MEMORIA sembrada al arrancar la instancia.
// El catálogo completo se descarga del repo público al arrancar; usuarios y secret vienen
// de api/_credenciales.js (que viaja solo en el deploy, nunca en git).
// Es la versión demo/vitrina — los cambios del panel viven mientras viva la instancia.
// Para operación real: migrar a una base persistente en la nube (Neon/Postgres).
import { DatabaseSync } from "node:sqlite";
import { crearEsquema } from "../src/db.js";
import { crearApp } from "../src/app.js";
import credenciales from "./_credenciales.js";

const URL_DATA =
  "https://raw.githubusercontent.com/xentristech/dotaplatim/main/data/productos.json";

const db = new DatabaseSync(":memory:");
crearEsquema(db);

const insFerr = db.prepare(
  "INSERT INTO ferreterias (id, nombre, slug, ciudad) VALUES (?, ?, ?, ?)");
for (const f of credenciales.ferreterias) insFerr.run(f.id, f.nombre, f.slug, f.ciudad);

const insUsr = db.prepare(
  "INSERT INTO usuarios (email, nombre, rol, ferreteria_id, hash, salt) VALUES (?, ?, ?, ?, ?, ?)");
for (const u of credenciales.usuarios) {
  insUsr.run(u.email, u.nombre, u.rol, u.ferreteria_id, u.hash, u.salt);
}

let productos = [];
try {
  productos = await (await fetch(URL_DATA)).json();
} catch (e) {
  console.error("No se pudo cargar el catálogo desde GitHub:", e.message);
}
const insProd = db.prepare(`
  INSERT INTO productos (ferreteria_id, sku, nombre, descripcion_corta, descripcion,
                         slug, meta_descripcion, precio, precio_regular, marca)
  VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
for (const p of productos) {
  if (p.sku.toUpperCase().startsWith("PRUEBA")) continue;
  insProd.run(p.sku, p.nombre, p.descripcion_corta, p.descripcion, p.slug,
              p.meta_descripcion, p.precio, p.precio_regular, p.marca);
}

export default crearApp(db, credenciales.secret);
