// Siembra inicial del marketplace PLATIM:
//  1. Usuario "marketplace" (administrador de toda la plataforma).
//  2. Primera ferretería vinculada, con su usuario propio.
//  3. Su catálogo completo desde data/productos.json (filas de prueba se omiten).
// Las contraseñas se generan al azar y quedan SOLO en .env (ignorado por git).
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { abrirDb } from "./db.js";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const db = abrirDb();

function crearUsuario(email, nombre, rol, ferreteriaId, password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  // Upsert: si la base se recreó, el hash queda alineado con la clave del .env
  db.prepare(`INSERT INTO usuarios (email, nombre, rol, ferreteria_id, hash, salt)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(email) DO UPDATE SET hash = excluded.hash, salt = excluded.salt`)
    .run(email, nombre, rol, ferreteriaId, hash, salt);
}

// --- 1. Tiendas base: la ferretería fundadora y PLATIM mismo (el marketplace también
//        vende sus propios productos). Renombrables: UPDATE ferreterias SET nombre=...
db.prepare(`INSERT OR IGNORE INTO ferreterias (id, nombre, slug, ciudad)
            VALUES (1, 'Ferretería Fundadora', 'ferreteria-fundadora', 'Colombia')`).run();
db.prepare(`INSERT OR IGNORE INTO ferreterias (id, nombre, slug, ciudad)
            VALUES (2, 'PLATIM', 'platim', 'Colombia')`).run();

// --- 2. Usuarios ---
// Si el .env ya existe se REUTILIZAN sus contraseñas (re-sembrar nunca rompe el login);
// si no existe, se generan nuevas y se guardan abajo.
const envPath = path.join(raiz, ".env");
const envActual = existsSync(envPath)
  ? Object.fromEntries(readFileSync(envPath, "utf-8").split(/\r?\n/)
      .filter(l => l.includes("=") && !l.startsWith("#"))
      .map(l => l.split(/=(.*)/s).slice(0, 2)))
  : {};
const passAdmin = envActual.MARKETPLACE_ADMIN_PASSWORD || randomBytes(9).toString("base64url");
const passFerre = envActual.FERRETERIA_FUNDADORA_PASSWORD || randomBytes(9).toString("base64url");
crearUsuario("admin@platim.co", "Administrador Marketplace", "marketplace", null, passAdmin);
crearUsuario("fundadora@platim.co", "Ferretería Fundadora", "ferreteria", 1, passFerre);

// --- 3. Catálogos: ferretería fundadora (tienda 1) y PLATIM dotación/EPP (tienda 2) ---
const insertar = db.prepare(`
  INSERT OR REPLACE INTO productos
    (ferreteria_id, sku, nombre, descripcion_corta, descripcion, slug,
     meta_descripcion, precio, precio_regular, marca, categoria, imagen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

function sembrarCatalogo(archivo, ferreteriaId) {
  const ruta = path.join(raiz, "data", archivo);
  if (!existsSync(ruta)) return 0;
  let cargados = 0, omitidos = 0;
  for (const p of JSON.parse(readFileSync(ruta, "utf-8"))) {
    if (p.sku.toUpperCase().startsWith("PRUEBA")) { omitidos++; continue; }
    insertar.run(ferreteriaId, p.sku, p.nombre, p.descripcion_corta, p.descripcion, p.slug,
                 p.meta_descripcion, p.precio, p.precio_regular, p.marca,
                 p.categoria || "", p.imagen || "");
    cargados++;
  }
  console.log(`Tienda ${ferreteriaId}: ${cargados} productos de ${archivo}` +
              (omitidos ? ` (omitidos de prueba: ${omitidos})` : ""));
  return cargados;
}
const cargados = sembrarCatalogo("productos.json", 1) + sembrarCatalogo("productos-platim.json", 2);

// --- Guardar credenciales en .env (solo si es la primera vez) ---
if (!existsSync(envPath)) {
  writeFileSync(envPath, [
    "# Credenciales generadas por src/seed.js — NO subir a git (.env está en .gitignore)",
    `MARKETPLACE_ADMIN_EMAIL=admin@platim.co`,
    `MARKETPLACE_ADMIN_PASSWORD=${passAdmin}`,
    `FERRETERIA_FUNDADORA_EMAIL=fundadora@platim.co`,
    `FERRETERIA_FUNDADORA_PASSWORD=${passFerre}`,
    `TOKEN_SECRET=${randomBytes(32).toString("hex")}`,
    "",
  ].join("\n"));
  console.log("Credenciales nuevas guardadas en .env");
} else {
  console.log(".env ya existe: se conservan las credenciales anteriores");
}

console.log(`Siembra completa. Productos totales cargados: ${cargados}`);
