// Genera api/_credenciales.js (usuarios con hash + secret — pequeño, viaja solo a Vercel,
// NUNCA a git) y api/_datos.js (catálogo embebido, modo --slim opcional; hoy no se usa en
// el deploy: la versión cloud carga data/productos.json desde el repo de GitHub).
// Correr después de cambiar el catálogo o las credenciales.
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  readFileSync(path.join(raiz, ".env"), "utf-8").split("\n")
    .map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]));

const conHash = (email, nombre, rol, ferreteria_id, password) => {
  const salt = randomBytes(16).toString("hex");
  return { email, nombre, rol, ferreteria_id,
           salt, hash: scryptSync(password, salt, 64).toString("hex") };
};

// --slim: sin descripciones HTML (aligera el paquete para la demo serverless)
const slim = process.argv.includes("--slim");
const productos = JSON.parse(readFileSync(path.join(raiz, "data", "productos.json"), "utf-8"))
  .filter(p => !p.sku.toUpperCase().startsWith("PRUEBA"))
  .map(p => slim
    ? { sku: p.sku, nombre: p.nombre, descripcion_corta: "", descripcion: "",
        slug: p.slug, meta_descripcion: "", precio: p.precio,
        precio_regular: p.precio_regular, marca: p.marca }
    : p);

const datos = {
  secret: env.TOKEN_SECRET,
  ferreterias: [
    { id: 1, nombre: "Ferretería Fundadora", slug: "ferreteria-fundadora", ciudad: "Colombia" },
    { id: 2, nombre: "PLATIM", slug: "platim", ciudad: "Colombia" },
  ],
  usuarios: [
    conHash(env.MARKETPLACE_ADMIN_EMAIL, "Administrador Marketplace", "marketplace",
            null, env.MARKETPLACE_ADMIN_PASSWORD),
    conHash(env.FERRETERIA_FUNDADORA_EMAIL, "Ferretería Fundadora", "ferreteria",
            1, env.FERRETERIA_FUNDADORA_PASSWORD),
  ],
  productos,
};

mkdirSync(path.join(raiz, "api"), { recursive: true });
writeFileSync(path.join(raiz, "api", "_datos.js"),
  "// Generado por scripts/exportar_cloud.js — no editar a mano.\n" +
  "export default " + JSON.stringify(datos) + ";\n");
const { productos: _omitir, ...credenciales } = datos;
writeFileSync(path.join(raiz, "api", "_credenciales.js"),
  "// Generado por scripts/exportar_cloud.js — hashes y secret. NO subir a git.\n" +
  "export default " + JSON.stringify(credenciales) + ";\n");
console.log(`api/_datos.js y api/_credenciales.js generados: ${productos.length} productos, ${datos.usuarios.length} usuarios`);
