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
    if (!sesion) return res.status(401).json({ error: "Tu sesión venció. Vuelve a iniciar sesión." });
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
    res.status(401).json({ error: "Correo o contraseña incorrectos. Revisa e intenta de nuevo." });
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

  app.get("/api/categorias", (_req, res) => {
    res.json(db.prepare(`SELECT categoria, COUNT(*) AS productos FROM productos
                         WHERE activo = 1 AND categoria != '' GROUP BY categoria
                         ORDER BY productos DESC`).all());
  });

  app.get("/api/productos", (req, res) => {
    const { q = "", marca = "", categoria = "", ferreteria = "", page = "1" } = req.query;
    const porPagina = 24;
    const filtros = ["p.activo = 1"], args = [];
    if (q) {
      // Búsqueda inteligente: cada palabra debe aparecer en nombre, SKU, marca,
      // categoría o descripción corta (así "taladro dewalt 20v" encuentra lo correcto).
      for (const palabra of q.split(/\s+/).filter(Boolean).slice(0, 6)) {
        filtros.push(`(p.nombre LIKE ? OR p.sku LIKE ? OR p.marca LIKE ?
                       OR p.categoria LIKE ? OR p.descripcion_corta LIKE ?)`);
        args.push(...Array(5).fill(`%${palabra}%`));
      }
    }
    if (marca) { filtros.push("p.marca = ?"); args.push(marca); }
    if (categoria) { filtros.push("p.categoria = ?"); args.push(categoria); }
    if (ferreteria) { filtros.push("p.ferreteria_id = ?"); args.push(Number(ferreteria)); }
    const where = filtros.join(" AND ");
    const total = db.prepare(`SELECT COUNT(*) AS n FROM productos p WHERE ${where}`).get(...args).n;
    const filas = db.prepare(
      `SELECT p.id, p.sku, p.nombre, p.slug, p.precio, p.precio_regular, p.marca,
              p.categoria, p.imagen, f.nombre AS ferreteria
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

  // --- Asesor IA de ventas ---
  // Motor de intenciones sobre el catálogo: entiende la necesidad en lenguaje natural,
  // recomienda productos y empuja el cierre (agregar al pedido / WhatsApp).
  // Diseñado para poder reemplazar el motor por un LLM (Claude API) sin tocar el frontend.
  const sinAcentos = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const INTENCIONES = [
    { claves: ["fumig", "plaga", "cultivo", "aspersor", "veneno", "herbicida"],
      categoria: "Fumigación",
      texto: "Para proteger tu cultivo estas fumigadoras son las más pedidas:" },
    { claves: ["perfor", "hueco", "pared", "concreto", "taladr", "atornill", "tornillo"],
      q: "taladro",
      texto: "Para perforar y atornillar, mira estos taladros:" },
    { claves: ["cortar arbol", "arbol", "lena", "madera", "motosierra", "poda", "tronco"],
      q: "motosierra",
      texto: "Para corte de madera y poda, estas motosierras responden:" },
    { claves: ["pasto", "cesped", "jardin", "guadan", "maleza", "monte"],
      categoria: "Jardín y forestal",
      texto: "Para mantener el jardín o el lote a raya:" },
    { claves: ["luz", "apagon", "energia", "electricidad", "planta electrica", "generador"],
      categoria: "Energía",
      texto: "Para no quedarte sin energía, estas opciones:" },
    { claves: ["agua", "pozo", "tanque", "riego", "bomba", "presion", "inundacion"],
      categoria: "Bombas y agua",
      texto: "Para mover o presurizar agua, esto es lo que hay:" },
    { claves: ["lavar", "hidrolavadora", "carro", "fachada", "limpieza"],
      categoria: "Lavado y limpieza",
      texto: "Para lavado a presión y limpieza:" },
    { claves: ["soldar", "soldadura", "soldador"],
      q: "motosoldador",
      texto: "Para soldadura en campo:" },
    { claves: ["finca", "ganado", "vaca", "ordeno", "maiz", "grano", "moler", "alimento"],
      categoria: "Agro y ganadería",
      texto: "Para el trabajo de la finca:" },
    { claves: ["obra", "construccion", "placa", "cortar piso", "compresor", "andamio", "demoler"],
      categoria: "Construcción",
      texto: "Para la obra, estos equipos:" },
    { claves: ["pulir", "pulidora", "cortar metal", "esmeril", "disco"],
      q: "pulidora",
      texto: "Para pulir y cortar con disco:" },
    { claves: ["lancha", "bote", "rio", "fuera de borda", "navegar"],
      q: "fuera de borda",
      texto: "Para tu embarcación, motores fuera de borda HIDEA:" },
  ];

  app.post("/api/asesor", (req, res) => {
    const mensaje = String((req.body || {}).mensaje || "").slice(0, 300);
    const plano = sinAcentos(mensaje);
    if (!plano.trim()) {
      return res.json({
        texto: "Cuéntame qué necesitas resolver y te recomiendo el equipo exacto. " +
               "Por ejemplo: «necesito fumigar mi cultivo» o «se va mucho la luz en la finca».",
        productos: [],
        sugerencias: ["Necesito fumigar mi cultivo", "Se va mucho la luz",
                      "Algo para perforar concreto", "Una bomba para un pozo"],
      });
    }

    // Presupuesto y orden: "barato/económico" o una cifra tope
    let orden = "p.precio IS NULL, p.precio ASC", tope = null;
    const cifra = plano.replace(/[.,]/g, "").match(/\b(\d{5,9})\b/);
    if (cifra) tope = Number(cifra[1]);
    if (/(profesional|potente|industrial|pesad)/.test(plano)) {
      orden = "p.precio IS NULL, p.precio DESC";
    }

    // Marca mencionada
    const marcas = db.prepare("SELECT DISTINCT marca FROM productos WHERE marca != ''").all();
    const marca = marcas.find(m => plano.includes(sinAcentos(m.marca)))?.marca;

    // Intención por palabras clave
    const intencion = INTENCIONES.find(i => i.claves.some(c => plano.includes(c)));

    const filtros = ["p.activo = 1"], args = [];
    if (intencion?.categoria) { filtros.push("p.categoria = ?"); args.push(intencion.categoria); }
    if (intencion?.q) {
      filtros.push("(p.nombre LIKE ? OR p.descripcion_corta LIKE ?)");
      args.push(`%${intencion.q}%`, `%${intencion.q}%`);
    }
    if (marca) { filtros.push("p.marca = ?"); args.push(marca); }
    if (tope) { filtros.push("p.precio <= ?"); args.push(tope); }
    if (!intencion) {
      // Sin intención clara: usar las palabras del mensaje como búsqueda amplia
      const palabras = plano.split(/\s+/).filter(w => w.length > 3).slice(0, 4);
      if (palabras.length) {
        filtros.push("(" + palabras.map(() =>
          "(p.nombre LIKE ? OR p.categoria LIKE ? OR p.marca LIKE ?)").join(" OR ") + ")");
        for (const w of palabras) args.push(`%${w}%`, `%${w}%`, `%${w}%`);
      }
    }

    const productos = db.prepare(
      `SELECT p.id, p.sku, p.nombre, p.slug, p.precio, p.marca, p.categoria, p.imagen,
              f.nombre AS ferreteria
       FROM productos p JOIN ferreterias f ON f.id = p.ferreteria_id
       WHERE ${filtros.join(" AND ")} ORDER BY ${orden} LIMIT 4`
    ).all(...args);

    let texto;
    if (!productos.length) {
      texto = "No encontré un equipo exacto para eso en el catálogo, pero un asesor humano " +
              "te lo consigue: escríbenos por WhatsApp y lo cotizamos. " +
              "¿O me lo cuentas con otras palabras?";
    } else {
      texto = (intencion?.texto || "Esto es lo que te puedo ofrecer:") +
        (marca ? ` (marca ${marca})` : "") +
        (tope ? ` con presupuesto hasta $${tope.toLocaleString("es-CO")}` : "") +
        " Toca «Agregar» y te lo despachamos a cualquier parte del país.";
    }
    res.json({
      texto,
      productos,
      sugerencias: productos.length
        ? ["Más económico", "Algo más profesional", "Ver otra categoría"]
        : ["Necesito fumigar mi cultivo", "Se va mucho la luz", "Una bomba para un pozo"],
    });
  });

  // --- Pedidos (crear es público: es el checkout del catálogo) ---
  app.post("/api/pedidos", (req, res) => {
    const { cliente, telefono, ciudad, direccion, notas = "", items } = req.body || {};
    if (!cliente || !telefono || !ciudad || !direccion || !Array.isArray(items) || !items.length) {
      return res.status(400).json({
        error: "Completa tu nombre, teléfono, ciudad y dirección para poder despacharte." });
    }
    const detalle = [];
    for (const it of items) {
      const p = db.prepare("SELECT * FROM productos WHERE id = ? AND activo = 1")
        .get(Number(it.producto_id));
      const cantidad = Math.floor(Number(it.cantidad));
      if (!p || !(cantidad > 0)) {
        return res.status(400).json({
          error: "Uno de los productos ya no está disponible. Quítalo del pedido e intenta de nuevo." });
      }
      detalle.push({ p, cantidad });
    }
    const total = detalle.reduce((s, d) => s + (d.p.precio ?? 0) * d.cantidad, 0);
    const numero = "P-" + String(
      db.prepare("SELECT COUNT(*) AS n FROM pedidos").get().n + 1).padStart(4, "0");
    const r = db.prepare(`INSERT INTO pedidos (numero, cliente, telefono, ciudad, direccion,
                            notas, total) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(numero, cliente, telefono, ciudad, direccion, notas, total);
    const insItem = db.prepare(`INSERT INTO pedido_items
        (pedido_id, producto_id, ferreteria_id, cantidad, precio_unitario)
        VALUES (?, ?, ?, ?, ?)`);
    for (const d of detalle) {
      insItem.run(r.lastInsertRowid, d.p.id, d.p.ferreteria_id, d.cantidad, d.p.precio);
    }
    res.status(201).json({ ok: true, numero, total });
  });

  // Listado del panel: el marketplace ve todos; una ferretería, los que traen items suyos.
  app.get("/api/admin/pedidos", conSesion, (req, res) => {
    const esFerreteria = req.sesion.rol === "ferreteria";
    const pedidos = db.prepare(
      esFerreteria
        ? `SELECT DISTINCT pe.* FROM pedidos pe
           JOIN pedido_items i ON i.pedido_id = pe.id
           WHERE i.ferreteria_id = ? ORDER BY pe.id DESC LIMIT 100`
        : `SELECT * FROM pedidos ORDER BY id DESC LIMIT 100`
    ).all(...(esFerreteria ? [req.sesion.ferreteria_id] : []));
    const itemsDe = db.prepare(
      `SELECT i.cantidad, i.precio_unitario, p.nombre, p.sku, f.nombre AS ferreteria
       FROM pedido_items i
       JOIN productos p ON p.id = i.producto_id
       JOIN ferreterias f ON f.id = i.ferreteria_id
       WHERE i.pedido_id = ?` + (esFerreteria ? " AND i.ferreteria_id = ?" : ""));
    res.json(pedidos.map(pe => ({
      ...pe,
      items: itemsDe.all(...(esFerreteria ? [pe.id, req.sesion.ferreteria_id] : [pe.id])),
    })));
  });

  app.put("/api/pedidos/:id/estado", conSesion, soloMarketplace, (req, res) => {
    const estados = ["recibido", "confirmado", "despachado", "entregado", "cancelado"];
    const { estado } = req.body || {};
    if (!estados.includes(estado)) {
      return res.status(400).json({ error: "estado inválido; usar: " + estados.join(", ") });
    }
    const r = db.prepare("UPDATE pedidos SET estado = ? WHERE id = ?")
      .run(estado, Number(req.params.id));
    r.changes ? res.json({ ok: true }) : res.status(404).json({ error: "no existe" });
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
    if (!nombre || !slug) return res.status(400).json({
      error: "Escribe el nombre de la ferretería y su URL corta." });
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
      res.status(400).json({
        error: "Ya existe una ferretería con esa URL corta o un usuario con ese correo." });
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
                  meta_descripcion = ?, precio = ?, precio_regular = ?, marca = ?,
                  categoria = ?, imagen = ?, activo = ?
                WHERE id = ?`)
      .run(c.nombre ?? p.nombre, c.descripcion_corta ?? p.descripcion_corta,
           c.descripcion ?? p.descripcion, c.meta_descripcion ?? p.meta_descripcion,
           c.precio === undefined ? p.precio : c.precio,
           c.precio_regular === undefined ? p.precio_regular : c.precio_regular,
           c.marca ?? p.marca, c.categoria ?? p.categoria, c.imagen ?? p.imagen,
           c.activo === undefined ? p.activo : (c.activo ? 1 : 0), p.id);
    res.json({ ok: true });
  });

  app.post("/api/productos", conSesion, (req, res) => {
    const p = req.body || {};
    const ferreteriaId = req.sesion.rol === "marketplace"
      ? p.ferreteria_id : req.sesion.ferreteria_id;
    if (!ferreteriaId || !p.sku || !p.nombre || !p.slug) {
      return res.status(400).json({ error: "Completa el SKU y el nombre del producto." });
    }
    db.prepare(`INSERT INTO productos (ferreteria_id, sku, nombre, descripcion_corta,
                  descripcion, slug, meta_descripcion, precio, precio_regular, marca,
                  categoria, imagen)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ferreteriaId, p.sku, p.nombre, p.descripcion_corta || "", p.descripcion || "",
           p.slug, p.meta_descripcion || "", p.precio ?? null, p.precio_regular ?? null,
           p.marca || "", p.categoria || "", p.imagen || "");
    res.status(201).json({ ok: true });
  });

  return app;
}
