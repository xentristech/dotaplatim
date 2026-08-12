// Módulo IA de PLATIM: genera SEO por producto y el estudio de competencia de cada
// ferretería. Trabaja en dos modos con el MISMO contrato de respuesta:
//  - Con ANTHROPIC_API_KEY en el entorno: redacta con Claude (claude-sonnet-5).
//  - Sin clave: motor de plantillas sobre los datos del catálogo (funciona igual en
//    la demo). El campo `motor` de cada respuesta dice cuál se usó.

const MODELO = "claude-sonnet-5";

// --- Inteligencia de mercado (investigación agosto 2026, ecommerce ferretero Colombia) ---
export const MERCADO = {
  competidores: [
    { nombre: "Homecenter / Sodimac", sitio: "homecenter.com.co", tipo: "Retail gigante",
      fuerte: "Domina el SEO de categoría («taladros», «motosierras») y tiene logística propia.",
      flanco: "Sin asesoría cercana; débil en agro, fumigación y maquinaria de finca." },
    { nombre: "Mercado Libre", sitio: "mercadolibre.com.co", tipo: "Marketplace generalista",
      fuerte: "Se lleva la búsqueda de cola larga y el tráfico de precio.",
      flanco: "Vendedores anónimos, sin asesoría técnica ni garantía de tienda real." },
    { nombre: "TUL", sitio: "tul.com.co", tipo: "Marketplace B2B de construcción",
      fuerte: "Fuerte con ferreterías como COMPRADORAS (les surte inventario).",
      flanco: "No vende al consumidor final: no compite por tu cliente, compite por tu ferretería." },
    { nombre: "Falabella / Linio y Éxito", sitio: "falabella.com.co", tipo: "Retail generalista",
      fuerte: "Marca conocida y campañas de descuento masivas.",
      flanco: "Catálogo ferretero superficial; cero especialización técnica." },
    { nombre: "Easy (Cencosud)", sitio: "easy.com.co", tipo: "Retail hogar y construcción",
      fuerte: "Presencia física en ciudades principales.",
      flanco: "Poca profundidad en maquinaria y marcas profesionales." },
    { nombre: "Ferreterías online de nicho", sitio: "ferreterialuispenagos.com, ferreco.com, ferragro.com",
      tipo: "Especialistas independientes",
      fuerte: "El espejo directo de PLATIM: SEO de producto + envío nacional.",
      flanco: "Cada una pelea sola; PLATIM suma el catálogo de muchas ferreterías reales." },
  ],
  // Dónde puede ganar PLATIM aunque los gigantes tengan más tráfico.
  ventajas: [
    "Agro, forestal y fumigación (STIHL, HUSQVARNA, fumigadoras): los gigantes lo tienen flojo y el campo colombiano lo busca.",
    "Asesoría real por WhatsApp: Homecenter y Mercado Libre no conversan; el ferretero sí.",
    "Ferreterías locales verificadas con despacho nacional: confianza de barrio a escala país.",
    "Cola larga por SKU y modelo exacto («MS 250», «DCD777»): el que busca el modelo ya quiere comprar.",
  ],
  // Búsquedas con intención de compra por categoría del catálogo.
  keywords: {
    "Jardín y forestal": ["motosierra stihl precio colombia", "guadaña husqvarna precio",
      "motosierra para finca", "podadora de altura"],
    "Fumigación": ["fumigadora estacionaria colombia", "fumigadora de espalda 20 litros",
      "aspersora para cultivo precio"],
    "Herramientas eléctricas": ["taladro percutor dewalt 20v precio", "pulidora bosch colombia",
      "rotomartillo inalámbrico"],
    "Bombas y agua": ["motobomba 3 pulgadas precio", "bomba para pozo profundo colombia",
      "electrobomba de presión"],
    "Energía": ["planta eléctrica 3500w precio colombia", "generador a gasolina para finca"],
    "Construcción": ["compresor de aire colombia", "vibrador de concreto precio",
      "cortadora de piso"],
    "Agro y ganadería": ["molino de martillos colombia", "picapasto precio", "ordeñadora portátil"],
    "Lavado y limpieza": ["hidrolavadora precio colombia", "hidrolavadora para carros"],
    "Motores": ["motor a gasolina 6.5 hp precio", "motor fuera de borda colombia"],
    "Protección y EPP": ["elementos de proteccion personal colombia", "casco de seguridad industrial precio",
      "guantes de seguridad industrial", "kit epp para obra"],
    "Uniformes y dotación": ["dotacion empresarial colombia", "uniformes empresariales bogota",
      "dotacion de ley para empleados", "uniformes antifluido salud"],
    "Calzado de seguridad": ["botas de seguridad punta de acero precio", "botas dielectricas colombia",
      "calzado de dotacion empresarial"],
  },
};

// --- Cliente Claude (fetch directo, sin dependencias) ---
async function preguntarClaude(prompt, maxTokens = 1000) {
  const clave = process.env.ANTHROPIC_API_KEY;
  if (!clave) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": clave, "anthropic-version": "2023-06-01",
                 "content-type": "application/json" },
      body: JSON.stringify({ model: MODELO, max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) return null;
    return (await r.json()).content?.[0]?.text ?? null;
  } catch { return null; }
}

const recortar = (t, max) => t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
const cop = (n) => "$" + Number(n).toLocaleString("es-CO");

// Tipo de equipo = primeras palabras del nombre sin la marca ni códigos.
function tipoDe(p) {
  const sinMarca = p.nombre.replace(new RegExp(p.marca, "ig"), "");
  const palabras = sinMarca.toLowerCase()
    .replace(/[^a-záéíóúñü\s]/g, " ").split(/\s+/).filter(w => w.length > 2);
  return palabras.slice(0, 2).join(" ") || p.nombre.toLowerCase();
}

// --- SEO por producto ---
export async function generarSeo(p) {
  const tipo = tipoDe(p);
  const conClaude = await preguntarClaude(
    `Eres el SEO de PLATIM, marketplace ferretero colombiano con despacho nacional y asesoría
por WhatsApp. Genera SEO para este producto y responde SOLO un JSON válido con las llaves
titulo (máx 60 caracteres), meta_descripcion (máx 155, con llamado a la acción),
keywords (lista de 5 búsquedas colombianas con intención de compra) y consejo (una frase
para el vendedor). Producto: ${JSON.stringify({ nombre: p.nombre, marca: p.marca,
  categoria: p.categoria, sku: p.sku, precio: p.precio,
  descripcion_corta: String(p.descripcion_corta || "").replace(/<[^>]+>/g, " ").slice(0, 300) })}`);
  if (conClaude) {
    try {
      const j = JSON.parse(conClaude.replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
      if (j.titulo && j.meta_descripcion) return { motor: "claude", ...j };
    } catch { /* JSON malo: cae al motor de plantillas */ }
  }

  // Motor de plantillas: mismas reglas que usaría un SEO humano.
  const titulo = recortar(`${p.nombre} | PLATIM Colombia`, 60);
  const precioTxt = p.precio ? `por ${cop(p.precio)}` : "al mejor precio";
  const meta_descripcion = recortar(
    `Compra ${p.nombre} ${precioTxt} en PLATIM. ` +
    `${p.marca ? p.marca + " original con garantía y " : ""}despacho a toda Colombia. ` +
    `Pide asesoría gratis por WhatsApp.`, 155);
  const keywords = [
    ...(MERCADO.keywords[p.categoria] || []).slice(0, 2),
    `${tipo} ${p.marca}`.trim().toLowerCase() + " precio",
    `comprar ${tipo} online colombia`,
    `${p.sku.toLowerCase()} precio colombia`,
  ];
  const consejo = p.precio == null
    ? "Este producto no tiene precio publicado: en internet, sin precio no hay clic. Publícalo y entra a competir."
    : `Usa el modelo exacto (${p.sku}) en el título de tus redes: quien busca el modelo ya decidió comprar.`;
  return { motor: "plantillas", titulo, meta_descripcion, keywords, consejo };
}

// --- Estudio de competencia y posicionamiento de una ferretería (o del marketplace) ---
export async function estudioCompetencia(db, ferreteriaId = null) {
  const donde = ferreteriaId ? "AND p.ferreteria_id = ?" : "";
  const args = ferreteriaId ? [ferreteriaId] : [];
  const resumen = db.prepare(`
    SELECT COUNT(*) AS productos,
           SUM(p.precio IS NOT NULL) AS con_precio,
           SUM(p.precio IS NULL) AS sin_precio,
           SUM(p.imagen = '') AS sin_imagen,
           SUM(p.meta_descripcion = '') AS sin_meta,
           COUNT(DISTINCT p.categoria) AS categorias,
           COUNT(DISTINCT p.marca) AS marcas
    FROM productos p WHERE p.activo = 1 ${donde}`).get(...args);
  const porCategoria = db.prepare(`
    SELECT p.categoria, COUNT(*) AS productos,
           MIN(p.precio) AS desde, MAX(p.precio) AS hasta
    FROM productos p WHERE p.activo = 1 AND p.categoria != '' ${donde}
    GROUP BY p.categoria ORDER BY productos DESC`).all(...args);

  // Oportunidades concretas calculadas sobre el catálogo real.
  const oportunidades = [];
  if (resumen.sin_precio > 0) oportunidades.push(
    `${resumen.sin_precio} productos sin precio publicado. En Homecenter o Mercado Libre un ` +
    `producto sin precio no existe: publícalos y entran a competir hoy mismo.`);
  if (resumen.sin_imagen > resumen.productos * 0.3) oportunidades.push(
    `${resumen.sin_imagen} productos sin foto. La foto es el 70% del clic en un marketplace: ` +
    `una foto con celular sobre fondo claro ya vende.`);
  if (resumen.sin_meta > 0) oportunidades.push(
    `${resumen.sin_meta} productos sin descripción SEO. Usa el botón ✨ de la tabla de ` +
    `productos y la IA se la escribe en segundos.`);
  const fuertes = porCategoria.filter(c => MERCADO.keywords[c.categoria] && c.productos >= 5);
  for (const c of fuertes.slice(0, 3)) oportunidades.push(
    `Eres fuerte en «${c.categoria}» (${c.productos} productos). Los gigantes flojean ahí: ` +
    `apunta a búsquedas como «${MERCADO.keywords[c.categoria][0]}».`);
  const debiles = Object.keys(MERCADO.keywords)
    .filter(cat => !porCategoria.some(c => c.categoria === cat));
  if (debiles.length) oportunidades.push(
    `Categorías con demanda que aún no cubres: ${debiles.join(", ")}. ` +
    `Cada ferretería nueva que se vincule puede llenar uno de estos huecos.`);

  const keywords = porCategoria
    .filter(c => MERCADO.keywords[c.categoria])
    .map(c => ({ categoria: c.categoria, buscan: MERCADO.keywords[c.categoria] }));

  // Narrativa: con Claude si hay clave; si no, la arma el motor local.
  let narrativa = await preguntarClaude(
    `Eres consultor de ecommerce ferretero en Colombia. En máximo 120 palabras y tono directo,
dile a esta ferretería cómo posicionarse frente a Homecenter, Mercado Libre y TUL.
Datos: ${JSON.stringify({ resumen, porCategoria: porCategoria.slice(0, 6) })}. Ventajas de la
plataforma: ${MERCADO.ventajas.join(" | ")}`, 400);
  const motor = narrativa ? "claude" : "plantillas";
  if (!narrativa) {
    const top = porCategoria[0];
    narrativa =
      `Con ${resumen.productos} productos de ${resumen.marcas} marcas no vas a ganarle a ` +
      `Homecenter en volumen — y no toca. Se le gana por el flanco: ${top ? `tu fuerte es ` +
      `«${top.categoria}» y ` : ""}el agro y la maquinaria de finca son territorio libre, ` +
      `con asesoría real por WhatsApp que ningún gigante da. Publica precio y foto en todo ` +
      `el catálogo, usa los títulos SEO con modelo exacto, y deja que PLATIM te sume el ` +
      `tráfico de las demás ferreterías: juntos somos el marketplace; solos somos una página más.`;
  }

  return { motor, resumen, porCategoria, oportunidades, keywords,
           competidores: MERCADO.competidores, ventajas: MERCADO.ventajas, narrativa };
}
