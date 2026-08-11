// Arranque local: base SQLite en archivo + estáticos de public/ + listen.
// (La versión en la nube vive en api/index.js con base en memoria.)
import express from "express";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { abrirDb } from "./db.js";
import { crearApp } from "./app.js";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// .env plano (sin dependencia dotenv)
const envPath = path.join(raiz, ".env");
if (existsSync(envPath)) {
  for (const linea of readFileSync(envPath, "utf-8").split("\n")) {
    const m = linea.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const app = crearApp(abrirDb(), process.env.TOKEN_SECRET || randomBytes(32).toString("hex"));
app.use(express.static(path.join(raiz, "public")));

const puerto = process.env.PORT || 3000;
app.listen(puerto, () => console.log(`PLATIM marketplace en http://localhost:${puerto}`));
