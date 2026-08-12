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
  db.prepare(`INSERT OR IGNORE INTO usuarios (email, nombre, rol, ferreteria_id, hash, salt)
              VALUES (?, ?, ?, ?, ?, ?)`).run(email, nombre, rol, ferreteriaId, hash, salt);
}

// --- 1. Tiendas base: la ferretería fundadora y PLATIM mismo (el marketplace también
//        vende sus propios productos). Renombrables: UPDATE ferreterias SET nombre=...
db.prepare(`INSERT OR IGNORE INTO ferreterias (id, nombre, slug, ciudad)
            VALUES (1, 'Ferretería Fundadora', 'ferreteria-fundadora', 'Colombia')`).run();
db.prepare(`INSERT OR IGNORE INTO ferreterias (id, nombre, slug, ciudad)
            VALUES (2, 'PLATIM', 'platim', 'Colombia')`).run();

// --- 2. Usuarios ---
const passAdmin = randomBytes(9).toString("base64url");
const passFerre = randomBytes(9).toString("base64url");
crearUsuario("admin@platim.co", "Administrador Marketplace", "marketplace", null, passAdmin);
crearUsuario("fundadora@platim.co", "Ferretería Fundadora", "ferreteria", 1, passFerre);

// --- 3. Catálogo ---
const productos = JSON.parse(readFileSync(path.join(raiz, "data", "productos.json"), "utf-8"));
const insertar = db.prepare(`
  INSERT OR REPLACE INTO productos
    (ferreteria_id, sku, nombre, descripcion_corta, descripcion, slug,
     meta_descripcion, precio, precio_regular, marca, categoria, imagen)
  VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

let cargados = 0, omitidos = 0;
for (const p of productos) {
  if (p.sku.toUpperCase().startsWith("PRUEBA")) { omitidos++; continue; }
  insertar.run(p.sku, p.nombre, p.descripcion_corta, p.descripcion, p.slug,
               p.meta_descripcion, p.precio, p.precio_regular, p.marca,
               p.categoria || "", p.imagen || "");
  cargados++;
}

// --- Guardar credenciales en .env (solo si es la primera vez) ---
const envPath = path.join(raiz, ".env");
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

console.log(`Ferretería 1 lista. Productos cargados: ${cargados} (omitidos de prueba: ${omitidos})`);
