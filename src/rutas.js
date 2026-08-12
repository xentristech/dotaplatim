// Rutas del marketplace PLATIM. crearApp(db, secret) arma la app de Express sobre
// cualquier base (archivo local o memoria en la nube), sin listen ni estáticos:
// eso lo pone cada entrada (src/server.js local, api/index.js en Vercel).
import express from "express";
import { createHmac, scryptSync, timingSafeEqual, randomBytes } from "node:crypto";
import { generarSeo, estudioCompetencia } from "./ia.js";

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
      // Cada palabra se prueba también en singular ("botas" encuentra "bota de seguridad").
      for (const palabra of q.split(/\s+/).filter(Boolean).slice(0, 6)) {
        const formas = [...new Set([palabra,
          palabra.replace(/([a-záéíóú])s$/i, "$1"),
          palabra.replace(/([a-záéíóú])es$/i, "$1")])];
        filtros.push("(" + formas.map(() =>
          `(p.nombre LIKE ? OR p.sku LIKE ? OR p.marca LIKE ?
            OR p.categoria LIKE ? OR p.descripcion_corta LIKE ?)`).join(" OR ") + ")");
        for (const f of formas) args.push(...Array(5).fill(`%${f}%`));
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

  // --- SEO técnico: robots, sitemap y páginas de producto indexables ---
  const baseUrl = (req) => `https://${req.get("host")}`;
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  app.get("/robots.txt", (req, res) => {
    res.type("text/plain").send(
      `User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /api/\n` +
      `Sitemap: ${baseUrl(req)}/sitemap.xml\n`);
  });

  app.get("/sitemap.xml", (req, res) => {
    const base = baseUrl(req);
    const filas = db.prepare(
      "SELECT slug, creado_en FROM productos WHERE activo = 1 ORDER BY id").all();
    const urls = [`<url><loc>${base}/</loc><changefreq>daily</changefreq></url>`,
      ...filas.map(f => `<url><loc>${base}/p/${encodeURIComponent(f.slug)}</loc>` +
        `<lastmod>${(f.creado_en || "").slice(0, 10)}</lastmod></url>`)];
    res.type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`);
  });

  // Página de producto renderizada en el servidor: es la que Google indexa y
  // posiciona (título, meta, JSON-LD Product). El catálogo interactivo la enlaza.
  app.get("/p/:slug", (req, res) => {
    const p = db.prepare(
      `SELECT p.*, f.nombre AS ferreteria FROM productos p
       JOIN ferreterias f ON f.id = p.ferreteria_id WHERE p.slug = ? AND p.activo = 1`
    ).get(req.params.slug);
    if (!p) return res.status(404).type("html").send(
      `<meta charset="utf-8"><title>Producto no encontrado — PLATIM</title>
       <p>Este producto ya no está publicado. <a href="/">Volver al catálogo</a></p>`);
    const base = baseUrl(req);
    const titulo = `${p.nombre} | PLATIM Colombia`.slice(0, 60);
    const meta = (p.meta_descripcion ||
      `Compra ${p.nombre} en PLATIM con despacho a toda Colombia y asesoría por WhatsApp.`)
      .replace(/<[^>]+>/g, " ").slice(0, 160);
    const jsonLd = {
      "@context": "https://schema.org", "@type": "Product",
      name: p.nombre, sku: p.sku, brand: { "@type": "Brand", name: p.marca || "PLATIM" },
      description: meta, url: `${base}/p/${p.slug}`,
      ...(p.imagen ? { image: p.imagen } : {}),
      ...(p.precio ? { offers: { "@type": "Offer", price: p.precio, priceCurrency: "COP",
        availability: "https://schema.org/InStock",
        seller: { "@type": "Organization", name: p.ferreteria } } } : {}),
    };
    res.type("html").send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(meta)}">
<link rel="canonical" href="${base}/p/${esc(p.slug)}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(meta)}">
<meta property="og:type" content="product">
${p.imagen ? `<meta property="og:image" content="${esc(p.imagen)}">` : ""}
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;
color:#0D1B2A;line-height:1.5}a.btn{display:inline-block;background:#4d7a16;color:#fff;
padding:.7rem 1.2rem;border-radius:9px;text-decoration:none;font-weight:700;margin:.3rem .4rem 0 0}
img{max-width:100%;max-height:320px;object-fit:contain}.precio{font-size:1.6rem;font-weight:800}
small{color:#51607a}</style></head><body>
<p><a href="/">← PLATIM Marketplace</a> · ${esc(p.categoria || "Catálogo")}</p>
<h1>${esc(p.nombre)}</h1>
<small>${esc(p.marca || "")} · SKU ${esc(p.sku)} · Vendido por ${esc(p.ferreteria)} (verificada)</small>
${p.imagen ? `<p><img src="${esc(p.imagen)}" alt="${esc(p.nombre)}"></p>` : ""}
<p class="precio">${p.precio ? "$" + p.precio.toLocaleString("es-CO") + " COP" : "Precio a consultar"}</p>
<div>${p.descripcion_corta || ""}</div>
<p><a class="btn" href="/?q=${encodeURIComponent(p.sku)}">Comprar en el catálogo</a>
<a class="btn" style="background:#0D1B2A"
   href="https://wa.me/573023660481?text=${encodeURIComponent(`Hola PLATIM, quiero información de ${p.nombre} (SKU ${p.sku})`)}">
   Preguntar por WhatsApp</a></p>
<div>${p.descripcion || ""}</div>
<p><small>Despacho a toda Colombia desde ferreterías verificadas · PLATIM Marketplace</small></p>
</body></html>`);
  });

  // --- Asesor IA de ventas ---
  // Motor de intenciones sobre el catálogo: entiende la necesidad en lenguaje natural,
  // recomienda productos y empuja el cierre (agregar al pedido / WhatsApp).
  // Diseñado para poder reemplazar el motor por un LLM (Claude API) sin tocar el frontend.
  const sinAcentos = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const INTENCIONES = [
    { claves: ["dotacion", "uniforme", "camisa", "pantalon", "scrub", "bata", "delantal"],
      categoria: "Uniformes y dotación",
      texto: "Para la dotación de tu equipo, PLATIM confecciona con tu logo:" },
    { claves: ["epp", "casco", "guante", "gafa", "tapon", "respirador", "tapaboca",
               "chaleco", "overol", "proteccion"],
      categoria: "Protección y EPP",
      texto: "Para proteger a tu gente, estos elementos de seguridad:" },
    { claves: ["bota", "calzado", "zueco", "zapato", "punta de acero", "dielectric"],
      categoria: "Calzado de seguridad",
      texto: "Para los pies de tu equipo, este calzado de seguridad:" },
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

  // --- IA para el vendedor (requiere sesión) ---
  // Genera el paquete SEO de un producto; con { guardar: true } lo aplica a la ficha.
  app.post("/api/ia/seo", conSesion, async (req, res) => {
    const { producto_id, guardar } = req.body || {};
    const p = db.prepare(
      `SELECT p.*, f.nombre AS ferreteria FROM productos p
       JOIN ferreterias f ON f.id = p.ferreteria_id WHERE p.id = ?`).get(Number(producto_id));
    if (!p) return res.status(404).json({ error: "producto no encontrado" });
    if (req.sesion.rol !== "marketplace" && p.ferreteria_id !== req.sesion.ferreteria_id) {
      return res.status(403).json({ error: "no es un producto de tu ferretería" });
    }
    const seo = await generarSeo(p);
    if (guardar) {
      db.prepare("UPDATE productos SET meta_descripcion = ? WHERE id = ?")
        .run(seo.meta_descripcion, p.id);
      seo.guardado = true;
    }
    res.json(seo);
  });

  // Estudio de competencia: cada ferretería ve el suyo; el marketplace, el global
  // o el de una tienda puntual con ?ferreteria=ID.
  app.get("/api/ia/competencia", conSesion, async (req, res) => {
    const ferreteriaId = req.sesion.rol === "ferreteria"
      ? req.sesion.ferreteria_id
      : (req.query.ferreteria ? Number(req.query.ferreteria) : null);
    res.json(await estudioCompetencia(db, ferreteriaId));
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
