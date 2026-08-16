// Rutas del marketplace PLATIM. crearApp(db, secret) arma la app de Express sobre
// cualquier base (archivo local o memoria en la nube), sin listen ni estáticos:
// eso lo pone cada entrada (src/server.js local, api/index.js en Vercel).
import express from "express";
import { createHmac, scryptSync, timingSafeEqual, randomBytes } from "node:crypto";
import { generarSeo, estudioCompetencia } from "./ia.js";
import { enviarLeadSendPulse, estadoSendPulse } from "./sendpulse.js";

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
       WHERE ${where}
       ORDER BY (p.imagen IS NULL OR p.imagen = ''), p.nombre LIMIT ? OFFSET ?`
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
color:#1b1b1b;line-height:1.5}a.btn{display:inline-block;background:#2e2e2e;color:#fff;
padding:.7rem 1.2rem;border-radius:9px;text-decoration:none;font-weight:700;margin:.3rem .4rem 0 0}
img{max-width:100%;max-height:320px;object-fit:contain}.precio{font-size:1.6rem;font-weight:800}
small{color:#5f5f5f}</style></head><body>
<main>
<p><a href="/">← PLATIM Marketplace</a> · ${esc(p.categoria || "Catálogo")}</p>
<h1>${esc(p.nombre)}</h1>
<small>${esc(p.marca || "")} · SKU ${esc(p.sku)} · Vendido por ${esc(p.ferreteria)} (verificada)</small>
${p.imagen ? `<p><img src="${esc(p.imagen)}" alt="${esc(p.nombre)}"></p>` : ""}
<p class="precio">${p.precio ? "$" + p.precio.toLocaleString("es-CO") + " COP" : "Precio a consultar"}</p>
<div>${p.descripcion_corta || ""}</div>
<p><a class="btn" href="/?q=${encodeURIComponent(p.sku)}">Comprar en el catálogo</a>
<a class="btn" style="background:#111111"
   href="https://wa.me/573023660481?text=${encodeURIComponent(`Hola PLATIM, quiero información de ${p.nombre} (SKU ${p.sku})`)}">
   Preguntar por WhatsApp</a></p>
${p.descripcion ? `<h2>Descripción</h2><div>${p.descripcion}</div>` : ""}
<p><small>Despacho a toda Colombia desde ferreterías verificadas · PLATIM Marketplace</small></p>
</main>
</body></html>`);
  });

  // --- Embudos de captación (páginas de aterrizaje + leads → SendPulse) ---
  // Directriz de marca: paleta gris/negro/blanco, wordmark XENTRIS, sin logos PLATIM.
  const EMBUDOS = {
    dotacion: {
      titulo: "La dotación de tus empleados, resuelta en una semana",
      sub: "Uniformes, EPP y calzado de seguridad con el logo de tu empresa, entregados " +
           "en cualquier ciudad de Colombia. Tú mandas la lista; nosotros la resolvemos.",
      bullets: ["Cotización en menos de 24 horas", "Marcas originales certificadas",
                "Confección con el logo de tu empresa", "Despacho nacional"],
      campos: `<input name="nombre" placeholder="Tu nombre *" required autocomplete="name">
        <input name="empresa" placeholder="Empresa *" required autocomplete="organization">
        <input name="whatsapp" type="tel" placeholder="WhatsApp *" required autocomplete="tel">
        <input name="empleados" inputmode="numeric" placeholder="Nº de empleados">
        <input name="correo" type="email" placeholder="Correo *" required autocomplete="email">`,
      cta: "Recibir mi cotización gratis",
      gracias: "¡Listo! Recibimos tu solicitud. Un asesor te escribe hoy mismo.",
      wsp: "Hola, acabo de pedir una cotización de dotación para mi empresa",
      meta: "Cotiza la dotación de ley de tu empresa: uniformes, EPP y calzado de seguridad " +
            "con despacho a toda Colombia. Respuesta en menos de 24 horas.",
      problema: { titulo: "Cada abril, agosto y diciembre, la misma carrera",
        parrafos: [
          "La ley (art. 230 del CST) obliga a entregar dotación tres veces al año a " +
          "quien gane hasta dos salarios mínimos: antes del 30 de abril, del 31 de " +
          "agosto y del 20 de diciembre. Y siempre pasa lo mismo: el proveedor se " +
          "cuelga, las tallas llegan malas y la fecha se viene encima.",
          "Incumplir no es solo un regaño: es sanción laboral y demandas. Y resolverlo " +
          "a la carrera es pagar de más por menos calidad.",
          "Con una sola lista — cuántas personas, qué puestos, qué tallas — te " +
          "devolvemos una cotización clara y llegamos antes de la fecha." ] },
      pasos: [
        ["1", "Cuéntanos tu necesidad", "Llena el formulario: cuántas personas y para qué cargos. Dos minutos."],
        ["2", "Recibe tu cotización en 24 h", "Precios por volumen, tallas y opciones de marca. Sin compromiso."],
        ["3", "Recibe la dotación", "Confección con tu logo y despacho a tu sede, en cualquier ciudad del país."]],
      prueba: { titulo: "Esto no es una promesa: ya está funcionando",
        items: [
          "Catálogo de dotación en línea con precios publicados: overoles, camibusos, botas con puntera, cascos, guantes y más",
          "Kit de dotación de ley (art. 230 CST) ya armado: camisa + pantalón + calzado por trabajador",
          "Marcas de seguridad certificadas y confección con tu logo bordado o estampado",
          "Respaldo de un marketplace ferretero con más de 230 productos y despacho nacional" ] },
      faq: [
        ["¿Hay un pedido mínimo?", "No. Cotizamos desde equipos pequeños hasta plantas completas; el precio mejora con el volumen."],
        ["¿Manejan facturación?", "Sí, factura electrónica a nombre de tu empresa, como lo exige tu contabilidad."],
        ["¿Qué pasa si una talla llega mal?", "Se cambia. Tomamos la tabla de tallas contigo antes de confeccionar para que casi nunca pase."],
        ["¿En cuánto tiempo entregan?", "La cotización llega en 24 horas. La confección y entrega típica toma entre una y dos semanas según el volumen y la ciudad."],
        ["¿Atienden mi ciudad?", "Sí: despachamos a toda Colombia con transportadoras nacionales."]],
      ctaFinal: "La próxima fecha de dotación no se mueve. Tu cotización tarda 2 minutos.",
    },
    ferreteria: {
      titulo: "Tu ferretería vendiendo en internet, sin montar página web",
      sub: "La plataforma, el posicionamiento en Google y la logística los ponemos nosotros. " +
           "Tú publicas tus productos y despachas ventas.",
      bullets: ["Catálogo en línea en días, no meses", "Pedidos y despachos gestionados",
                "SEO y asesor con IA incluidos", "Sin costos de desarrollo"],
      campos: `<input name="nombre" placeholder="Tu nombre *" required autocomplete="name">
        <input name="empresa" placeholder="Nombre de la ferretería *" required>
        <input name="ciudad" placeholder="Ciudad *" required>
        <input name="whatsapp" type="tel" placeholder="WhatsApp *" required autocomplete="tel">
        <input name="correo" type="email" placeholder="Correo *" required autocomplete="email">`,
      cta: "Quiero vincular mi ferretería",
      gracias: "¡Recibido! Te contactamos para mostrarte la plataforma funcionando en vivo.",
      wsp: "Hola, quiero vincular mi ferretería a la plataforma",
      meta: "Pon tu ferretería a vender en internet sin montar página web: plataforma, " +
            "posicionamiento y despachos a todo el país incluidos.",
      problema: { titulo: "Tus clientes ya compran en internet. Solo que no te compran a ti",
        parrafos: [
          "Cada día, gente de tu ciudad busca en Google «taladro percutor precio» o " +
          "«motobomba 3 pulgadas»… y termina comprándole a Homecenter o a un vendedor " +
          "anónimo de Mercado Libre, aunque tú tengas el producto en la vitrina.",
          "Montar tienda propia cuesta millones, tarda meses y luego nadie la visita: " +
          "el problema no es la página, es el posicionamiento y la logística.",
          "En el marketplace tu catálogo se publica con SEO, cada producto muestra el " +
          "nombre de TU ferretería, y los pedidos te llegan listos para despachar." ] },
      pasos: [
        ["1", "Mándanos tu catálogo", "Un Excel, fotos o hasta la lista de tu proveedor. Nosotros lo organizamos."],
        ["2", "Lo publicamos con SEO", "Fichas con foto, precio y posicionamiento en Google. Tu marca visible en cada producto."],
        ["3", "Recibes pedidos y vendes", "Panel con tus pedidos, estudio de competencia con IA y despachos nacionales coordinados."]],
      prueba: { titulo: "La plataforma ya está andando, con ferreterías reales",
        items: [
          "Más de 230 productos publicados de marcas como STIHL, HUSQVARNA y DeWalt",
          "La primera ferretería vinculada ya tiene su catálogo completo en línea, con fotos y SEO por producto",
          "Cada producto tiene página propia indexable en Google, con precio y botón de compra",
          "Asesor de ventas con IA que atiende a los compradores y estudio de competencia para cada ferretería" ] },
      faq: [
        ["¿Cuánto cuesta?", "No pagas desarrollo ni montaje. El modelo comercial se acuerda contigo según tu catálogo — sin sorpresas ni permanencias."],
        ["¿Pierdo mi marca o mis clientes?", "No: cada producto muestra el nombre de tu ferretería, con el sello de tienda verificada."],
        ["¿Necesito saber de computadores?", "No. Nos mandas el catálogo como lo tengas y nosotros lo dejamos publicado."],
        ["¿Quién hace los despachos?", "Los coordinamos juntos con transportadoras nacionales; tú entregas el producto, el pedido llega listo."],
        ["¿Y si quiero salirme?", "Sin permanencia: tu catálogo es tuyo, entras y sales cuando quieras."]],
      ctaFinal: "Cada mes fuera de internet son ventas que se lleva otro. Vincularte tarda 2 minutos.",
    },
  };

  const paginaEmbudo = (tipo) => {
    const e = EMBUDOS[tipo];
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(e.titulo)} — XENTRIS</title>
<meta name="description" content="${esc(e.meta)}">
<meta name="robots" content="index,follow">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: system-ui, sans-serif; background: #F4F4F4; color: #1b1b1b;
         line-height: 1.5; min-height: 100vh; display: flex; flex-direction: column; }
  header { padding: 1.1rem 1.4rem; font-weight: 900; letter-spacing: .25em;
           font-size: 1.05rem; } header small { letter-spacing: 0; color: #5f5f5f;
           font-weight: 400; margin-left: .8rem; }
  main { flex: 1; display: flex; flex-direction: column; align-items: center;
         padding: 1.5rem 1rem 3rem; gap: 2.2rem; }
  .caja { background: #fff; border: 1px solid #DCDCDC; border-radius: 16px;
          max-width: 520px; width: 100%; padding: 2rem 1.8rem;
          box-shadow: 0 8px 28px rgb(0 0 0 / .08); }
  .seccion { max-width: 640px; width: 100%; }
  .seccion h2 { font-size: 1.3rem; margin-bottom: .7rem; }
  .seccion p { color: #3d3d3d; margin-bottom: .7rem; }
  .pasos { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
           gap: .8rem; }
  .paso { background: #fff; border: 1px solid #DCDCDC; border-radius: 12px;
          padding: 1rem; }
  .paso .num { display: inline-flex; width: 2rem; height: 2rem; border-radius: 50%;
               background: #111; color: #fff; align-items: center; justify-content: center;
               font-weight: 800; margin-bottom: .5rem; }
  .paso b { display: block; margin-bottom: .3rem; }
  .paso span { color: #5f5f5f; font-size: .9rem; }
  .prueba li { padding: .25rem 0; color: #3d3d3d; }
  .prueba li b { color: #111; margin-right: .4rem; }
  details { background: #fff; border: 1px solid #DCDCDC; border-radius: 10px;
            padding: .8rem 1rem; margin-bottom: .5rem; }
  summary { font-weight: 700; cursor: pointer; }
  details p { margin-top: .5rem; color: #3d3d3d; }
  .cta-final { text-align: center; background: linear-gradient(100deg, #111, #3a3a3a);
               color: #fff; border-radius: 16px; padding: 1.8rem 1.4rem; max-width: 640px;
               width: 100%; }
  .cta-final p { font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem; }
  .cta-final a { display: inline-block; background: #e8e8e8; color: #1b1b1b;
                 font-weight: 800; text-decoration: none; border-radius: 10px;
                 padding: .9rem 1.4rem; }
  h1 { font-size: 1.55rem; line-height: 1.25; }
  .sub { color: #5f5f5f; margin: .7rem 0 1rem; }
  ul { list-style: none; margin-bottom: 1.2rem; }
  li { padding: .2rem 0; } li b { color: #111; margin-right: .4rem; }
  form { display: flex; flex-direction: column; gap: .6rem; }
  input { border: 1px solid #DCDCDC; border-radius: 9px; padding: .8rem .9rem;
          font-size: 1rem; background: #fff; color: #1b1b1b; }
  input:focus { outline: 2px solid #111; border-color: #111; }
  button { background: #111; color: #fff; border: none; border-radius: 10px;
           padding: .95rem; font-size: 1.05rem; font-weight: 800; cursor: pointer;
           min-height: 48px; }
  button:disabled { opacity: .6; }
  .error { color: #b42318; min-height: 1.2em; font-size: .9rem; }
  .gracias { text-align: center; display: none; }
  .gracias h2 { margin-bottom: .6rem; }
  .gracias a.wsp { display: inline-block; background: #111; color: #fff; font-weight: 800;
                   text-decoration: none; border-radius: 10px; padding: .9rem 1.3rem;
                   margin-top: 1rem; }
  .gracias a.cat { display: block; margin-top: .9rem; color: #5f5f5f; }
  footer { text-align: center; color: #5f5f5f; font-size: .8rem; padding: 1rem; }
</style></head><body>
<header>XENTRIS<small>soluciones digitales para negocios reales</small></header>
<main><div class="caja" id="arriba">
  <div id="captura">
    <h1>${esc(e.titulo)}</h1>
    <p class="sub">${esc(e.sub)}</p>
    <ul>${e.bullets.map(b => `<li><b>✓</b>${esc(b)}</li>`).join("")}</ul>
    <form id="f">
      ${e.campos}
      <button type="submit">${esc(e.cta)}</button>
      <p class="error" id="error" aria-live="polite"></p>
    </form>
  </div>
  <div class="gracias" id="gracias" aria-live="polite">
    <h2>${esc(e.gracias)}</h2>
    <a class="wsp" target="_blank" rel="noopener"
       href="https://wa.me/573023660481?text=${encodeURIComponent(e.wsp)}">
       Adelantar por WhatsApp &rarr;</a>
    <a class="cat" href="/">Mientras tanto, mira el catálogo &rarr;</a>
  </div>
</div>
<section class="seccion">
  <h2>${esc(e.problema.titulo)}</h2>
  ${e.problema.parrafos.map(p => `<p>${esc(p)}</p>`).join("")}
</section>
<section class="seccion">
  <h2>Así funciona</h2>
  <div class="pasos">${e.pasos.map(([n, t, d]) =>
    `<div class="paso"><span class="num">${esc(n)}</span><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join("")}
  </div>
</section>
<section class="seccion prueba">
  <h2>${esc(e.prueba.titulo)}</h2>
  <ul>${e.prueba.items.map(i => `<li><b>✓</b>${esc(i)}</li>`).join("")}</ul>
</section>
<section class="seccion">
  <h2>Preguntas frecuentes</h2>
  ${e.faq.map(([q, a]) =>
    `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}
</section>
<div class="cta-final">
  <p>${esc(e.ctaFinal)}</p>
  <a href="#arriba">${esc(e.cta)} &uarr;</a>
</div>
</main>
<footer>Operado por XENTRIS · Despachos a toda Colombia</footer>
<script>
document.getElementById("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const boton = ev.target.querySelector("button");
  boton.disabled = true; boton.textContent = "Enviando…";
  const datos = Object.fromEntries(new FormData(ev.target));
  datos.tipo = ${JSON.stringify(tipo)};
  const r = await fetch("/api/leads", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) })
    .then(x => x.json()).catch(() => ({ error: "No se pudo enviar. Intenta de nuevo." }));
  if (r.error) {
    document.getElementById("error").textContent = r.error;
    boton.disabled = false; boton.textContent = ${JSON.stringify(e.cta)};
    return;
  }
  document.getElementById("captura").style.display = "none";
  document.getElementById("gracias").style.display = "block";
});
</script></body></html>`;
  };

  app.get("/cotizar-dotacion", (_req, res) => res.type("html").send(paginaEmbudo("dotacion")));
  app.get("/vincular-ferreteria", (_req, res) => res.type("html").send(paginaEmbudo("ferreteria")));

  app.post("/api/leads", async (req, res) => {
    const c = req.body || {};
    const tipo = c.tipo === "ferreteria" ? "ferreteria" : "dotacion";
    const nombre = String(c.nombre || "").trim().slice(0, 120);
    const whatsapp = String(c.whatsapp || "").trim().slice(0, 30);
    const correo = String(c.correo || "").trim().slice(0, 160);
    if (!nombre || !whatsapp || !/.+@.+\..+/.test(correo)) {
      return res.status(400).json({
        error: "Completa tu nombre, WhatsApp y un correo válido para poder contactarte." });
    }
    const lead = { tipo, nombre, whatsapp, correo,
      empresa: String(c.empresa || "").trim().slice(0, 160),
      ciudad: String(c.ciudad || "").trim().slice(0, 80),
      empleados: String(c.empleados || "").trim().slice(0, 20) };
    const enviado = await enviarLeadSendPulse(lead); // false si no hay credenciales aún
    db.prepare(`INSERT INTO leads (tipo, nombre, empresa, ciudad, whatsapp, correo,
                                   empleados, sendpulse)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(lead.tipo, lead.nombre, lead.empresa, lead.ciudad, lead.whatsapp,
           lead.correo, lead.empleados, enviado ? 1 : 0);
    res.status(201).json({ ok: true, sendpulse: enviado });
  });

  // Panel: ver los leads capturados y el estado de la conexión SendPulse.
  app.get("/api/admin/leads", conSesion, (_req, res) => {
    res.json(db.prepare("SELECT * FROM leads ORDER BY id DESC LIMIT 200").all());
  });
  app.get("/api/admin/sendpulse", conSesion, async (_req, res) => {
    res.json(await estadoSendPulse());
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
                      "Dotación para mis empleados", "Una bomba para un pozo"],
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
