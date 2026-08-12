# Estudio de competencia y plan SEO — PLATIM Marketplace

*Investigación: agosto 2026 · Fuentes: búsqueda web (Similarweb, El Tiempo, CCE, sitios de los competidores) + catálogo real de PLATIM (204 productos, 35 marcas).*

## 1. El tablero: quién compite por el cliente ferretero en Colombia

| Competidor | Tipo | Su fuerte | Su flanco débil (la entrada de PLATIM) |
|---|---|---|---|
| **Homecenter / Sodimac** (homecenter.com.co) | Retail gigante (Falabella + Corona) | Domina el SEO de categoría («taladros», «motosierras») y logística propia | Sin asesoría cercana; débil en agro, fumigación y maquinaria de finca |
| **Mercado Libre** | Marketplace generalista | Se lleva la búsqueda de cola larga y el tráfico de precio | Vendedores anónimos; sin asesoría técnica ni respaldo de tienda real |
| **TUL** (tul.com.co) | Marketplace B2B de construcción | Fuerte con ferreterías como **compradoras** (les surte inventario) | No vende al consumidor final: compite por tu ferretería, no por tu cliente |
| **Falabella / Linio y Éxito** | Retail generalista | Marca conocida, campañas masivas | Catálogo ferretero superficial, cero especialización |
| **Easy (Cencosud)** | Retail hogar/construcción | Presencia física en ciudades principales | Poca profundidad en maquinaria profesional |
| **Ferreterías online de nicho** (Luis Penagos, Ferreco, Ferragro, Aldia) | Especialistas independientes | El espejo directo de PLATIM: SEO de producto + envío nacional | Cada una pelea sola; PLATIM suma el catálogo de muchas |

## 2. La estrategia: no pelear de frente, ganar por el flanco

1. **Agro, forestal y fumigación** (STIHL, HUSQVARNA, fumigadoras): los gigantes lo tienen flojo y el campo colombiano lo busca. Es la categoría más fuerte del catálogo actual.
2. **Asesoría real por WhatsApp**: Homecenter y Mercado Libre no conversan; el ferretero sí. Es el diferencial en cada página y en el asesor IA.
3. **Ferreterías locales verificadas + despacho nacional**: confianza de barrio a escala país. Es el pitch a clientes y a ferreterías nuevas.
4. **Cola larga por SKU/modelo exacto** («MS 250», «DCD777»): quien busca el modelo ya decidió comprar. Cada producto tiene ahora su página indexable.

## 3. Lo que quedó construido (agosto 2026)

- **SEO técnico en producción**: `robots.txt`, `sitemap.xml` (205 URLs), páginas de producto `/p/{slug}` renderizadas en servidor con JSON-LD `Product`, canonical y Open Graph; portada con metadatos completos y JSON-LD `Organization` + `WebSite`.
- **Módulo IA en el panel** (pestaña «✨ Estudio IA»): estudio de competencia por ferretería (números del catálogo, oportunidades, keywords, competidores) y botón ✨ por producto que genera título/meta/keywords y los aplica a la ficha. Funciona con motor de plantillas; si se configura `ANTHROPIC_API_KEY`, redacta con Claude (`claude-sonnet-5`) sin tocar el frontend.
- **Asesor IA de ventas** en el catálogo público (intenciones → recomendación → cierre por carrito o WhatsApp).

## 4. Keywords objetivo por categoría

- **Jardín y forestal**: motosierra stihl precio colombia · guadaña husqvarna precio · motosierra para finca
- **Fumigación**: fumigadora estacionaria colombia · fumigadora de espalda 20 litros
- **Herramientas eléctricas**: taladro percutor dewalt 20v precio · pulidora bosch colombia
- **Bombas y agua**: motobomba 3 pulgadas precio · bomba para pozo profundo colombia
- **Energía**: planta eléctrica 3500w precio colombia · generador a gasolina para finca
- **Construcción**: compresor de aire colombia · vibrador de concreto precio
- **Agro y ganadería**: molino de martillos colombia · picapasto precio
- **Lavado y limpieza**: hidrolavadora precio colombia
- **Motores**: motor a gasolina 6.5 hp precio · motor fuera de borda colombia

## 5. Próximos pasos para posicionar de verdad

1. **Dominio propio** (`app.platim.co`): el SEO serio no se construye sobre `vercel.app`. Al apuntar el dominio, todo lo técnico ya queda listo.
2. **Google Search Console**: registrar el dominio y enviar el `sitemap.xml`.
3. **Completar el catálogo**: 6 productos sin precio y fotos faltantes (la IA del panel lo señala solo).
4. **Base persistente** (Neon/Postgres) para que el SEO aplicado desde el panel no sea efímero en la nube.
5. **Perfil de Google Business** por ferretería vinculada (búsqueda local: «ferretería + ciudad»).

*Fuentes: [Similarweb — competidores de homecenter.com.co](https://www.similarweb.com/es/website/homecenter.com.co/competitors/) · [El Tiempo — competidores de Homecenter en internet](https://www.eltiempo.com/economia/empresas/quienes-son-los-competidores-de-homecenter-en-internet-808446) · [TUL](https://tul.com.co/) · [Argos — ferreterías virtuales](https://colombia.argos.co/ferreteros/ferreterias-virtuales-el-reto-de-vender-en-internet/) · [envioclick — marketplaces de Colombia](https://blog.envioclick.com/los-mejores-marketplaces-de-colombia-top-5/)*
