// Base de datos del marketplace (SQLite nativo de Node, sin dependencias externas).
// Multi-tenant: cada producto pertenece a una ferretería; los usuarios son del
// marketplace (administran todo) o de una ferretería (administran la suya).
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const RUTA_DB = path.join(raiz, "data", "platim.db");

export function abrirDb() {
  const db = new DatabaseSync(RUTA_DB);
  db.exec("PRAGMA journal_mode = WAL");
  crearEsquema(db);
  return db;
}

// Esquema separado para poder crear también bases en memoria (versión cloud/demo).
export function crearEsquema(db) {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS ferreterias (
      id         INTEGER PRIMARY KEY,
      nombre     TEXT NOT NULL,
      slug       TEXT NOT NULL UNIQUE,
      ciudad     TEXT DEFAULT '',
      telefono   TEXT DEFAULT '',
      activa     INTEGER NOT NULL DEFAULT 1,
      creada_en  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id            INTEGER PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      nombre        TEXT NOT NULL,
      rol           TEXT NOT NULL CHECK (rol IN ('marketplace', 'ferreteria')),
      ferreteria_id INTEGER REFERENCES ferreterias(id),
      hash          TEXT NOT NULL,
      salt          TEXT NOT NULL,
      creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS productos (
      id                INTEGER PRIMARY KEY,
      ferreteria_id     INTEGER NOT NULL REFERENCES ferreterias(id),
      sku               TEXT NOT NULL,
      nombre            TEXT NOT NULL,
      descripcion_corta TEXT DEFAULT '',
      descripcion       TEXT DEFAULT '',
      slug              TEXT NOT NULL,
      meta_descripcion  TEXT DEFAULT '',
      precio            INTEGER,
      precio_regular    INTEGER,
      marca             TEXT DEFAULT '',
      activo            INTEGER NOT NULL DEFAULT 1,
      creado_en         TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (ferreteria_id, sku)
    );
    CREATE INDEX IF NOT EXISTS idx_productos_marca ON productos(marca);
    CREATE INDEX IF NOT EXISTS idx_productos_slug ON productos(slug);

    CREATE TABLE IF NOT EXISTS pedidos (
      id         INTEGER PRIMARY KEY,
      numero     TEXT NOT NULL UNIQUE,
      cliente    TEXT NOT NULL,
      telefono   TEXT NOT NULL,
      ciudad     TEXT NOT NULL,
      direccion  TEXT NOT NULL,
      notas      TEXT DEFAULT '',
      estado     TEXT NOT NULL DEFAULT 'recibido'
                 CHECK (estado IN ('recibido','confirmado','despachado','entregado','cancelado')),
      total      INTEGER NOT NULL,
      creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pedido_items (
      id              INTEGER PRIMARY KEY,
      pedido_id       INTEGER NOT NULL REFERENCES pedidos(id),
      producto_id     INTEGER NOT NULL REFERENCES productos(id),
      ferreteria_id   INTEGER NOT NULL REFERENCES ferreterias(id),
      cantidad        INTEGER NOT NULL,
      precio_unitario INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_items_pedido ON pedido_items(pedido_id);
    CREATE INDEX IF NOT EXISTS idx_items_ferreteria ON pedido_items(ferreteria_id);
  `);
}
