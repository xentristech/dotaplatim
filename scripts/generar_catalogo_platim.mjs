// Genera data/productos-platim.json: el catálogo de la tienda PLATIM (id 2) en el
// marketplace, construido desde las líneas reales del sitio platim.co (EPP, uniformes
// y calzado). Los PRECIOS SON DE REFERENCIA del mercado colombiano 2026 — ajustarlos
// en el panel es un clic. Las fotos salen del repo público del sitio (xentristech/platim).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const IMG = "https://raw.githubusercontent.com/xentristech/platim/main/assets/images/products";
const EPP = "Protección y EPP", UNI = "Uniformes y dotación", CAL = "Calzado de seguridad";

// [sku, nombre, categoria, precio, precioRegular, imagen, resumen, detalles[]]
const P = [
  // --- Protección y EPP (líneas de epp.html) ---
  ["PLT-EPP-001", "Casco de seguridad industrial con ratchet", EPP, 28000, 34000, "epp-prod1-1.png",
   "Casco tipo I con suspensión de ratchet para ajuste rápido. Protección contra impacto en obra e industria.",
   ["Suspensión de 4 puntos con ratchet", "Ranuras para accesorios (orejeras, careta)", "Colores por cargo disponibles", "Cumple normas de SST"]],
  ["PLT-EPP-002", "Barbuquejo con mentonera", EPP, 6500, null, "epp-prod1-1.png",
   "Barbuquejo elástico de 3 puntos con mentonera: el casco se queda en su puesto en altura y movimiento.",
   ["3 puntos de anclaje", "Mentonera plástica", "Compatible con cascos estándar"]],
  ["PLT-EPP-003", "Gafas de seguridad lente claro", EPP, 9500, null, "epp-prod2.png",
   "Gafas livianas con lente claro antirrayadura y protección UV para uso diario en planta y obra.",
   ["Lente de policarbonato antiimpacto", "Protección lateral integrada", "También disponibles en lente oscuro"]],
  ["PLT-EPP-004", "Monogafas de seguridad ventiladas", EPP, 18500, null, "epp-prod2.png",
   "Monogafas con sello facial y ventilación indirecta: protección contra salpicaduras y partículas.",
   ["Banda elástica ajustable", "Compatibles con gafas formuladas", "Ventilación indirecta antiempañante"]],
  ["PLT-EPP-005", "Tapones auditivos con cordón (par)", EPP, 3500, null, "pair-of-orange-earplugs-with-string-on-gray-2026-03-16-05-10-58-utc.jpg",
   "Tapones de silicona reutilizables con cordón, reducción de ruido para jornadas completas.",
   ["Silicona lavable y reutilizable", "Cordón antiextravío", "Presentación individual higiénica"]],
  ["PLT-EPP-006", "Orejeras de protección auditiva", EPP, 32000, 38000, "yellow-and-black-earmuffs-isolated-on-white-2026-03-08-23-02-38-utc.jpg",
   "Orejeras tipo copa con diadema acolchada para ambientes de ruido alto y continuo.",
   ["Copas con espuma de alta densidad", "Diadema ajustable", "Uso con o sin casco"]],
  ["PLT-EPP-007", "Respirador media cara con filtros", EPP, 68000, null, "epp-prod4.png",
   "Respirador reutilizable de media cara con filtros intercambiables para polvos, neblinas y vapores.",
   ["Filtros intercambiables según riesgo", "Arnés de 4 puntos", "Silicona de sello suave"]],
  ["PLT-EPP-008", "Mascarilla N95 (unidad)", EPP, 4500, null, "man-wearing-a-surgical-cap-and-mask-2026-03-18-16-04-45-utc.jpeg",
   "Mascarilla de alta eficiencia para material particulado, ajuste nasal metálico.",
   ["Eficiencia de filtrado 95%", "Clip nasal moldeable", "Descuentos por caja"]],
  ["PLT-EPP-009", "Tapabocas desechables (caja x50)", EPP, 18000, null, "man-wearing-a-surgical-cap-and-mask-2026-03-18-16-04-45-utc.jpeg",
   "Caja de 50 tapabocas de tres capas con ajuste nasal, para dotación de planta y salud.",
   ["3 capas con filtro", "Elásticos suaves", "Caja dispensadora"]],
  ["PLT-EPP-010", "Guantes de vaqueta reforzados (par)", EPP, 14000, null, "cloth-work-gloves-isolated-on-white-background-cl-2026-03-25-09-44-43-utc.jpg",
   "Guante de carnaza y vaqueta con refuerzo en palma para carga, obra y mantenimiento.",
   ["Refuerzo doble en palma", "Costuras de alta resistencia", "Tallas S a XL"]],
  ["PLT-EPP-011", "Guantes de nitrilo (caja x100)", EPP, 32000, null, "pair-of-protective-work-gloves-on-white-2026-03-09-23-09-51-utc.jpg",
   "Guantes desechables de nitrilo sin polvo, tacto fino para salud, alimentos y laboratorio.",
   ["Sin látex: aptos para pieles sensibles", "Ambidiestros", "Tallas S a XL"]],
  ["PLT-EPP-012", "Guantes de látex calibre 35 (par)", EPP, 9500, null, "yellow-and-black-gloves-for-industrial-use-2026-03-24-09-07-56-utc.jpg",
   "Guante industrial de látex calibre 35 con interior afelpado para aseo y químicos suaves.",
   ["Calibre 35 de larga vida", "Superficie antideslizante", "Interior afelpado"]],
  ["PLT-EPP-013", "Overol industrial en drill (enterizo)", EPP, 95000, 110000, "man-in-orange-construction-outfit-using-mobile-pho-2026-03-27-01-39-51-utc.jpg",
   "Overol enterizo en drill resistente con cintas reflectivas, marcado con el logo de tu empresa.",
   ["Drill 100% algodón", "Cintas reflectivas grises", "Bordado o estampado del logo incluido en pedidos de dotación"]],
  ["PLT-EPP-014", "Chaleco reflectivo de alta visibilidad", EPP, 22000, null, "high-visibility-safety-vest-on-a-white-background-2026-01-07-05-38-46-utc.jpg",
   "Chaleco de malla con cintas reflectivas de alta visibilidad, cierre frontal y bolsillos.",
   ["Cintas reflectivas de 2 pulgadas", "Malla fresca para clima cálido", "Marcaje con logo disponible"]],
  ["PLT-EPP-015", "Delantal industrial en polietileno (x10)", EPP, 15000, null, "man-wearing-apron-and-gloves-against-white-backdro-2026-01-08-00-55-33-utc.jpg",
   "Paquete de 10 delantales desechables en polietileno para alimentos, aseo y procesos húmedos.",
   ["Impermeables", "Tiras de amarre reforzadas", "También disponibles en látex reutilizable"]],
  ["PLT-EPP-016", "Polainas de protección (par)", EPP, 18000, null, "construction-safety-gear-still-life-on-white-backg-2026-03-18-17-42-23-utc.jpg",
   "Polainas de carnaza para soldadura y trabajos con proyección de partículas o chispas.",
   ["Carnaza resistente al calor", "Ajuste con hebillas", "Protegen empeine y pantorrilla"]],
  ["PLT-EPP-017", "Gorro oruga desechable (paquete x100)", EPP, 22000, null, "epp-prod8.png",
   "Gorros tipo oruga para manipulación de alimentos, salud e higiene industrial.",
   ["Paquete x100 unidades", "Elástico perimetral", "También en malla y polietileno"]],
  ["PLT-EPP-018", "Kit EPP básico de obra", EPP, 78000, 92000, "hard-hat-and-safety-equipment-still-life-2026-03-10-22-42-44-utc.jpg",
   "Kit de arranque por trabajador: casco con barbuquejo, gafas, tapones y guantes de vaqueta.",
   ["Casco + barbuquejo + gafas + tapones + guantes", "Ideal para ingreso de personal nuevo", "Precio por kit — descuentos por volumen"]],

  // --- Uniformes y dotación (líneas de uniformes.html) ---
  ["PLT-UNI-001", "Camisa oxford corporativa bordada", UNI, 65000, null, "tan-button-down-shirt-on-white-background-2026-01-07-01-48-39-utc.jpg",
   "Camisa oxford manga larga con bordado del logo: imagen profesional para oficina y atención al cliente.",
   ["Tela oxford durable", "Bordado del logo incluido", "Tallas y cortes dama/caballero"]],
  ["PLT-UNI-002", "Camibuso tipo polo con logo", UNI, 45000, null, "tan-button-down-shirt-on-white-background-2026-01-07-01-48-39-utc.jpg",
   "Polo en piqué de algodón con cuello tejido y logo bordado, el básico de toda dotación.",
   ["Piqué 50/50 fresco", "Colores institucionales", "Bordado incluido en pedidos de dotación"]],
  ["PLT-UNI-003", "Pantalón de trabajo en drill", UNI, 70000, null, "blue-jeans-on-a-white-background-view-from-above-2026-03-20-00-15-00-utc.jpg",
   "Pantalón en drill de alta resistencia con costuras reforzadas para operación diaria.",
   ["Drill pesado", "Bolsillos reforzados", "Opción con cintas reflectivas"]],
  ["PLT-UNI-004", "Jean industrial dotación", UNI, 75000, null, "blue-jeans-on-a-white-background-view-from-above-2026-03-20-00-15-00-utc.jpg",
   "Jean 14 onzas triple costura, el pantalón de dotación que más aguanta en planta y campo.",
   ["Índigo 14 oz", "Triple costura", "Tallas 28 a 44"]],
  ["PLT-UNI-005", "Camisa de trabajo con reflectivos", UNI, 58000, null, "red-uniforms-reflective-stripes-in-different-views-2026-03-26-23-57-53-utc.jpg",
   "Camisa manga larga en drill con cintas reflectivas para operación exigente y visibilidad.",
   ["Cintas reflectivas certificadas", "Drill fresco", "Marcaje con logo"]],
  ["PLT-UNI-006", "Conjunto scrub antifluido", UNI, 110000, 125000, "assortment-of-medical-scrub-sets-on-white-backgrou-2026-03-26-23-57-44-utc.jpg",
   "Conjunto médico (filipina + pantalón) en tela antifluido para clínicas, laboratorios y odontología.",
   ["Tela antifluido lavable", "Colores por servicio", "Bordado del nombre y cargo disponible"]],
  ["PLT-UNI-007", "Bata de laboratorio antifluido", UNI, 55000, null, "medical-worker-uniform-and-stethoscope-isolated-on-2026-05-25-14-58-42-utc.jpg",
   "Bata manga larga antifluido con puño en rib, para laboratorio, salud y alimentos.",
   ["Antifluido", "Puños ajustados", "Marcaje institucional"]],
  ["PLT-UNI-008", "Delantal industrial en lona", UNI, 38000, null, "man-wearing-apron-and-gloves-against-white-backdro-2026-01-08-00-55-33-utc.jpg",
   "Delantal de lona resistente con bolsillos, para talleres, cocinas industriales y operación diaria.",
   ["Lona de alto tráfico", "Bolsillos frontales", "Tiras graduables"]],
  ["PLT-UNI-009", "Uniforme escolar institucional (conjunto)", UNI, 85000, null, "happy-children-in-school-uniform-on-white-backgrou-2026-03-19-23-17-54-utc.jpg",
   "Conjunto escolar confeccionado a la medida del manual de tu institución: identidad y resistencia.",
   ["Confección por lotes institucionales", "Telas resistentes al lavado diario", "Cotización por cantidad de estudiantes"]],
  ["PLT-UNI-010", "Kit dotación de ley (camisa + pantalón + botas)", UNI, 240000, 265000, "cloth-work-gloves-isolated-on-white-background-cl-2026-03-25-09-44-43-utc.jpg",
   "El kit que cumple la dotación de ley colombiana (art. 230 CST): camisa, pantalón y calzado, tres veces al año.",
   ["Cumple la obligación legal de dotación", "Marcaje con logo incluido", "Entrega por empleado con tallaje en sitio", "Descuentos por volumen"]],

  // --- Calzado de seguridad (líneas de calzado-proteccion.html) ---
  ["PLT-CAL-001", "Bota de seguridad punta de acero", CAL, 145000, 165000, "tan-work-boots-on-wood-table-2026-03-26-07-37-11-utc.jpg",
   "Bota de cuero con puntera de acero y suela antideslizante para obra, industria y carga.",
   ["Puntera de acero certificada", "Suela antideslizante resistente a hidrocarburos", "Plantilla anatómica", "Tallas 34 a 45"]],
  ["PLT-CAL-002", "Bota dieléctrica de seguridad", CAL, 165000, null, "tan-work-boots-on-wood-table-2026-03-26-07-37-11-utc.jpg",
   "Bota con puntera no metálica y suela dieléctrica para trabajos con riesgo eléctrico.",
   ["Puntera composite (sin metal)", "Aislamiento dieléctrico", "Cuero graso resistente al agua"]],
  ["PLT-CAL-003", "Bota de caucho caña alta", CAL, 45000, null, "one-unique-brown-boot-in-the-row-of-black-boots-m-2026-01-08-07-42-14-utc.jpg",
   "Bota impermeable de caucho para aseo, agro y ambientes húmedos; fácil de lavar.",
   ["100% impermeable", "Suela antideslizante", "Con y sin puntera de acero"]],
  ["PLT-CAL-004", "Calzado institucional de dotación", CAL, 120000, null, "colorful-fashionable-sneakers-on-a-white-backgroun-2026-01-11-11-08-27-utc.jpg",
   "Calzado cómodo y de buena presentación para personal administrativo, comercial y de atención.",
   ["Cuero de presentación", "Suela ligera antideslizante", "Referencias dama y caballero"]],
  ["PLT-CAL-005", "Zueco hospitalario antideslizante", CAL, 85000, null, "comfortable-white-leather-clog-on-white-background-2026-03-19-07-58-22-utc.jpg",
   "Zueco cerrado, lavable y antideslizante para clínicas, hospitales y laboratorios.",
   ["Fácil de higienizar", "Plantilla anatómica removible", "Suela certificada antideslizante"]],
  ["PLT-CAL-006", "Botín de seguridad tipo tenis", CAL, 135000, null, "colorful-fashionable-sneakers-on-a-white-backgroun-2026-01-11-11-08-27-utc.jpg",
   "Botín liviano estilo deportivo con puntera composite: seguridad sin sacrificar comodidad.",
   ["Puntera composite liviana", "Malla transpirable", "Ideal para logística y bodega"]],
];

const sinAcentos = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
const slugDe = (n) => sinAcentos(n).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const cop = (n) => "$" + n.toLocaleString("es-CO");

const productos = P.map(([sku, nombre, categoria, precio, precio_regular, img, resumen, detalles]) => ({
  sku, nombre, categoria, precio, precio_regular,
  marca: "PLATIM",
  slug: slugDe(nombre),
  imagen: `${IMG}/${img}`,
  descripcion_corta: `<p>${resumen}</p>`,
  descripcion: `<p>${resumen}</p><ul>${detalles.map(d => `<li>${d}</li>`).join("")}</ul>` +
    `<p>Dotación y EPP con marcaje de tu empresa. Cotiza por volumen: PLATIM despacha a toda Colombia.</p>`,
  meta_descripcion: `Compra ${nombre} por ${cop(precio)} en PLATIM. Dotación y EPP con despacho a toda Colombia. Pide asesoría gratis por WhatsApp.`.slice(0, 155),
}));

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const destino = path.join(raiz, "data", "productos-platim.json");
writeFileSync(destino, JSON.stringify(productos, null, 1));
console.log(`${productos.length} productos PLATIM escritos en ${destino}`);
