// Rutas del marketplace PLATIM. crearApp(db, secret) arma la app de Express sobre
// cualquier base (archivo local o memoria en la nube), sin listen ni estáticos:
// eso lo pone cada entrada (src/server.js local, api/index.js en Vercel).
import express from "express";
import { createHmac, scryptSync, timingSafeEqual, randomBytes } from "node:crypto";

export function crearApp(db, SECRET) {
  const app = express();
  app.use(express.json());

  // --- Tokens (HMAC firmado, sin dependencias) ---
  const firmar = (dato) => {
    const cuerpo = Buffer.from(JSON.stringify(dato)).toString("base64url");
    return cuerpo + "." + createHmac("sha256", SECRET).update(cuerpo).digest("base64url");
  };
  const verificar = (token) => {
    const [cuerpo, firma] = (token || "").split(".");
    if (!cuerpo || !firma) return null;
    const esperada = createHmac("sha256", SECRET).update(cuerpo).digest("base64url");
    if (firma.length !== esperada.length ||
        !timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
    const dato = JSON.parse(Buffer.from(cuerpo, "base64url").toString());
    return dato.exp > Date.now() ? dato : null;
  };
  const conSesion = (req, res, next) => {
    const sesion = verificar((req.headers.authorization || "").replace("Bearer ", ""));
    if (!sesion) return res.status(401).json({ error: "token inválido o vencido" });
    req.sesion = sesion;
    next();
  };
  const soloMarketplace = (req, res, next) =>
    req.sesion.rol === "marketplace" ? next()
      : res.status(403).json({ error: "solo el administrador del marketplace" });

  // --- Auth ---
  app.post("/api/login", (req, res) => {
    const { email, password } = req.body || {};
    const u = db.prepare("SELECT * FROM usuarios WHERE email = ?").get(email || "");
    if (u) {
      const hash = scryptSync(password || "", u.salt, 64).toString("hex");
      if (timingSafeEqual(Buffer.from(hash), Buffer.from(u.hash))) {
        const token = firmar({ id: u.id, rol: u.rol, ferreteria_id: u.ferreteria_id,
                               exp: Date.now() + 8 * 3600e3 });
        return res.json({ token, nombre: u.nombre, rol: u.rol });
      }
    }
    res.status(401).json({ error: "credenciales incorrectas" });
  });

  // --- Lectura pública ---
  app.get("/api/ferreterias", (_req, res) => {
    res.json(db.prepare(`SELECT f.id, f.nombre, f.slug, f.ciudad, COUNT(p.id) AS productos
                         FROM ferreterias f LEFT JOIN productos p ON p.ferreteria_id = f.id
                         WHERE f.activa = 1 GROUP BY f.id`).all());
  });

  app.get("/api/marcas", (_req, res) => {
    res.json(db.prepare(`SELECT marca, COUNT(*) AS productos FROM productos
                         WHERE activo = 1 AND marca != '' GROUP BY marca
                         ORDER BY productos DESC`).all());
  });

  app.get("/api/productos", (req, res) => {
    const { q = "", marca = "", ferreteria = "", page = "1" } = req.query;
    const porPagina = 24;
    const filtros = ["p.activo = 1"], args = [];
    if (q) { filtros.push("(p.nombre LIKE ? OR p.sku LIKE ?)"); args.push(`%${q}%`, `%${q}%`); }
    if (marca) { filtros.push("p.marca = ?"); args.push(marca); }
    if (ferreteria) { filtros.push("p.ferreteria_id = ?"); args.push(Number(ferreteria)); }
    const where = filtros.join(" AND ");
    const total = db.prepare(`SELECT COUNT(*) AS n FROM productos p WHERE ${where}`).get(...args).n;
    const filas = db.prepare(
      `SELECT p.id, p.sku, p.nombre, p.slug, p.precio, p.precio_regular, p.marca,
              f.nombre AS ferreteria
       FROM productos p JOIN ferreterias f ON f.id = p.ferreteria_id
       WHERE ${where} ORDER BY p.nombre LIMIT ? OFFSET ?`
    ).all(...args, porPagina, (Number(page) - 1) * porPagina);
    res.json({ total, page: Number(page), porPagina, productos: filas });
  });

  app.get("/api/productos/:slug", (req, res) => {
    const p = db.prepare(
      `SELECT p.*, f.nombre AS ferreteria FROM productos p
       JOIN ferreterias f ON f.id = p.ferreteria_id WHERE p.slug = ? AND p.activo = 1`
    ).get(req.params.slug);
    p ? res.json(p) : res.status(404).json({ error: "producto no encontrado" });
  });

  // --- Panel (requiere sesión) ---
  app.get("/api/me", conSesion, (req, res) => {
    const u = db.prepare(`SELECT u.id, u.email, u.nombre, u.rol, u.ferreteria_id,
                                 f.nombre AS ferreteria
                          FROM usuarios u LEFT JOIN ferreterias f ON f.id = u.ferreteria_id
                          WHERE u.id = ?`).get(req.sesion.id);
    res.json(u);
  });

  app.post("/api/ferreterias", conSesion, soloMarketplace, (req, res) => {
    const { nombre, slug, ciudad = "", telefono = "", email, password } = req.body || {};
    if (!nombre || !slug) return res.status(400).json({ error: "faltan campos: nombre, slug" });
    try {
      const r = db.prepare(`INSERT INTO ferreterias (nombre, slug, ciudad, telefono)
                            VALUES (?, ?, ?, ?)`).run(nombre, slug, ciudad, telefono);
      if (email && password) {
        const salt = randomBytes(16).toString("hex");
        const hash = scryptSync(password, salt, 64).toString("hex");
        db.prepare(`INSERT INTO usuarios (email, nombre, rol, ferreteria_id, hash, salt)
                    VALUES (?, ?, 'ferreteria', ?, ?, ?)`)
          .run(email, nombre, r.lastInsertRowid, hash, salt);
      }
      res.status(201).json({ ok: true, id: Number(r.lastInsertRowid) });
    } catch (e) {
      res.status(400).json({ error: "slug o email ya existe" });
    }
  });

  app.put("/api/ferreterias/:id", conSesion, soloMarketplace, (req, res) => {
    const { nombre, ciudad, telefono, activa } = req.body || {};
    const f = db.prepare("SELECT * FROM ferreterias WHERE id = ?").get(Number(req.params.id));
    if (!f) return res.status(404).json({ error: "no existe" });
    db.prepare(`UPDATE ferreterias SET nombre = ?, ciudad = ?, telefono = ?, activa = ?
                WHERE id = ?`)
      .run(nombre ?? f.nombre, ciudad ?? f.ciudad, telefono ?? f.telefono,
           activa === undefined ? f.activa : (activa ? 1 : 0), f.id);
    res.json({ ok: true });
  });

  app.get("/api/admin/productos", conSesion, (req, res) => {
    const { q = "", ferreteria = "", page = "1" } = req.query;
    const porPagina = 50;
    const filtros = [], args = [];
    if (req.sesion.rol === "ferreteria") {
      filtros.push("p.ferreteria_id = ?"); args.push(req.sesion.ferreteria_id);
    } else if (ferreteria) {
      filtros.push("p.ferreteria_id = ?"); args.push(Number(ferreteria));
    }
    if (q) { filtros.push("(p.nombre LIKE ? OR p.sku LIKE ?)"); args.push(`%${q}%`, `%${q}%`); }
    const where = filtros.length ? filtros.join(" AND ") : "1=1";
    const total = db.prepare(`SELECT COUNT(*) AS n FROM productos p WHERE ${where}`).get(...args).n;
    const filas = db.prepare(
      `SELECT p.*, f.nombre AS ferreteria FROM productos p
       JOIN ferreterias f ON f.id = p.ferreteria_id
       WHERE ${where} ORDER BY p.nombre LIMIT ? OFFSET ?`
    ).all(...args, porPagina, (Number(page) - 1) * porPagina);
    res.json({ total, page: Number(page), porPagina, productos: filas });
  });

  app.put("/api/productos/:id", conSesion, (req, res) => {
    const p = db.prepare("SELECT * FROM productos WHERE id = ?").get(Number(req.params.id));
    if (!p) return res.status(404).json({ error: "no existe" });
    if (req.sesion.rol !== "marketplace" && p.ferreteria_id !== req.sesion.ferreteria_id) {
      return res.status(403).json({ error: "no es un producto de tu ferretería" });
    }
    const c = req.body || {};
    db.prepare(`UPDATE productos SET nombre = ?, descripcion_corta = ?, descripcion = ?,
                  meta_descripcion = ?, precio = ?, precio_regular = ?, marca = ?, activo = ?
                WHERE id = ?`)
      .run(c.nombre ?? p.nombre, c.descripcion_corta ?? p.descripcion_corta,
           c.descripcion ?? p.descripcion, c.meta_descripcion ?? p.meta_descripcion,
           c.precio === undefined ? p.precio : c.precio,
           c.precio_regular === undefined ? p.precio_regular : c.precio_regular,
           c.marca ?? p.marca, c.activo === undefined ? p.activo : (c.activo ? 1 : 0), p.id);
    res.json({ ok: true });
  });

  app.post("/api/productos", conSesion, (req, res) => {
    const p = req.body || {};
    const ferreteriaId = req.sesion.rol === "marketplace"
      ? p.ferreteria_id : req.sesion.ferreteria_id;
    if (!ferreteriaId || !p.sku || !p.nombre || !p.slug) {
      return res.status(400).json({ error: "faltan campos: ferreteria_id, sku, nombre, slug" });
    }
    db.prepare(`INSERT INTO productos (ferreteria_id, sku, nombre, descripcion_corta,
                  descripcion, slug, meta_descripcion, precio, precio_regular, marca)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ferreteriaId, p.sku, p.nombre, p.descripcion_corta || "", p.descripcion || "",
           p.slug, p.meta_descripcion || "", p.precio ?? null, p.precio_regular ?? null,
           p.marca || "");
    res.status(201).json({ ok: true });
  });

  return app;
}
