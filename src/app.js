// Entrada de la app en Vercel (preset Express: el default export ES la app y debe
// importar express directamente). Esta es la versión que corre en
// https://platim-marketplace.vercel.app — VERSIÓN DEMO/VITRINA: base SQLite en memoria
// sembrada al arrancar la instancia. El catálogo y las páginas se descargan de este
// mismo repo (rama main); los usuarios son cuentas demo creadas al vuelo (estado
// efímero). Operación real: migrar a Neon/Postgres.
// La versión local (npm start) NO usa este archivo: usa src/server.js + src/rutas.js.
import express from "express";
import { randomBytes, scryptSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { crearEsquema } from "./db.js";
import { crearApp } from "./rutas.js";

const RAW = "https://raw.githubusercontent.com/xentristech/dotaplatim/main";
const CLAVE_DEMO = "PlatimDemo-2026"; // acceso de demostración

const db = new DatabaseSync(":memory:");
crearEsquema(db);

const insFerr = db.prepare(
  "INSERT INTO ferreterias (id, nombre, slug, ciudad) VALUES (?, ?, ?, ?)");
insFerr.run(1, "Ferretería Fundadora", "ferreteria-fundadora", "Colombia");
insFerr.run(2, "PLATIM", "platim", "Colombia");

const insUsr = db.prepare(
  "INSERT INTO usuarios (email, nombre, rol, ferreteria_id, hash, salt) VALUES (?, ?, ?, ?, ?, ?)");
for (const u of [
  { email: "admin@platim.co", nombre: "Administrador Marketplace", rol: "marketplace", ferreteria_id: null },
  { email: "fundadora@platim.co", nombre: "Ferretería Fundadora", rol: "ferreteria", ferreteria_id: 1 },
]) {
  const salt = randomBytes(16).toString("hex");
  insUsr.run(u.email, u.nombre, u.rol, u.ferreteria_id,
             scryptSync(CLAVE_DEMO, salt, 64).toString("hex"), salt);
}

let productos = [], indexHtml = "", adminHtml = "";
try {
  [productos, indexHtml, adminHtml] = await Promise.all([
    fetch(`${RAW}/data/productos.json`).then(r => r.json()),
    fetch(`${RAW}/public/index.html`).then(r => r.text()),
    fetch(`${RAW}/public/admin.html`).then(r => r.text()),
  ]);
} catch (e) {
  console.error("No se pudo cargar catálogo/páginas desde GitHub:", e.message);
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

// La app: express() aquí mismo + rutas de la API montadas encima.
// Secret por instancia: suficiente para la demo (el estado es efímero igual).
const app = express();
app.get(["/", "/index.html"], (_req, res) => res.type("html").send(indexHtml));
app.get("/admin.html", (_req, res) => res.type("html").send(adminHtml));
app.use(crearApp(db, randomBytes(32).toString("hex")));

export default app;
