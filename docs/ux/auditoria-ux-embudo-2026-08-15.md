# Auditoría UX + embudo de conversión — PLATIM Marketplace

Fecha: 2026-08-15 · Auditor: Claude (skill `ux-audit` + lente de embudo de marketing)
Objetivo: https://platim-marketplace.vercel.app (producción)

```
═══════════════════════════════════════════════════════════
VEREDICTO: Conditional Pass → Pass tras los arreglos de esta sesión

Persona: Encargado(a) de compras de una PYME colombiana que necesita
dotación/EPP para ~15 empleados; poco tiempo; quiere cotizar rápido,
de preferencia cerrar por WhatsApp. + lente de usuario primerizo.

Superficies auditadas: / (portada+carrito+asesor+ficha), /p/:slug,
checkout completo (pedido real P-0001 enviado y confirmado), 375/768/1280/1440px.

Hard gates (tras arreglos): errores consola 0 · warnings 0 reportables
(2 allowlisted: "Deprecated API" causados por el propio script de medición),
red 5xx 0 · 4xx 0 · colapso de layout 0 · axe Critical 0 · axe Serious 0.
Rendimiento (portada): TTFB 2.8s / carga 4.2s EN ARRANQUE FRÍO serverless
(siembra la BD en memoria) — conocido, se resuelve con Neon (pendiente #5);
en caliente responde < 1s.

Hallazgos: Critical 0 · High 2 · Medium 3 · Low 2 — TODOS CORREGIDOS ✓
═══════════════════════════════════════════════════════════
```

## Manifiesto de interacción (resumen)

Se interactuó de verdad: se escribió en el buscador ("guantes" → 6, "botas
seguridad" → 4), se agregó un producto, se llenó y ENVIÓ el checkout (pedido
P-0001 confirmado con mensaje de éxito), se conversó con el asesor ("necesito
dotación para 15 empleados" → 4 productos de dotación con botón Agregar), se
visitó /p/:slug, se probaron 4 viewports y se corrió axe-core en / y /p/.
Capturas y manifiesto completo en el scratchpad de la sesión (`ux-audit/embudo/`).

## Hallazgos y arreglos (commit `7a0cb4c`)

| ID | Sev. | Hallazgo | Arreglo |
|----|------|----------|---------|
| F1 | High (embudo) | El tope del embudo le hablaba a las ferreterías ("¿Quieres que tu ferretería esté aquí?"), no al comprador; la persona compradora no veía propuesta de valor | Hero para el comprador ("Herramienta, dotación y EPP para tu empresa") con CTA "🦺 Cotizar mi dotación" (abre el asesor con la consulta ya enviada) y "💬 Cotizar por WhatsApp". El banner de ferreterías bajó debajo del catálogo (mismo ancla #unirse) |
| F2 | High (a11y, axe serious ×24) | Cada tarjeta era `role="button"` con `<a>` y `<button>` adentro (controles interactivos anidados) | La tarjeta ya no es control: el enlace del título es el acceso accesible (Enter abre la ficha, verificado); el clic de ratón en la tarjeta se conserva |
| F3 | Medium (embudo) | Primera impresión: 3 ahoyadoras de $5.4M SIN foto (placeholder) arriba del catálogo | El API ordena productos CON foto primero (`ORDER BY imagen`), la primera pantalla ahora es 100% fotos reales |
| F4 | Medium (embudo) | El carrito solo ofrecía el formulario; sin ruta de escape se pierde al que no quiere llenar datos | Botón "💬 Prefiero pedirlo por WhatsApp" que arma el mensaje con los items y el total |
| F5 | Medium (embudo) | El éxito post-checkout no daba siguiente paso accionable | El mensaje de éxito incluye enlace "Escríbenos ahora →" a WhatsApp con el número de pedido |
| F6 | Low (a11y moderate) | /p/ sin landmark `<main>`, contenido fuera de regiones, salto de encabezados | `<main>` envuelve la página y `<h2>Descripción</h2>` antes de la descripción larga — axe /p/: 0 violaciones |
| F7 | Low (robustez) | Una foto de Wayback caída mostraba el texto alternativo gigante en la tarjeta | `onerror` en las imágenes: si la foto falla, vuelve al emoji de la categoría (tarjeta y ficha) |
| — | Micro | Placeholder del buscador solo nombraba herramientas | Ahora: "Ej: guantes, botas, taladro, motobomba…" (paridad con la tienda de dotación) |

## Lo que ya estaba bien (con prueba)

- ✅ Agregar al carrito abre el panel "Tu pedido" al instante (feedback inmediato).
- ✅ Checkout de 4 campos + notas, todos con placeholder claro y autocomplete; pedido de prueba confirmado ("¡Pedido P-0001 recibido por $5.439.000!").
- ✅ Asesor entiende "dotación para 15 empleados" y sugiere productos agregables con chips de refinamiento ("Más económico" / "Algo más profesional").
- ✅ Móvil 375px sin scroll horizontal (los chips de categoría son fila desplazable).
- ✅ 0 respuestas de red ≥400 en toda la caminata.

## Embudo resultante

1. **Atracción** — SEO técnico (/p/, sitemap, JSON-LD) + hero con propuesta de valor para el comprador.
2. **Interés** — catálogo fotos-primero, búsqueda con plurales, chips de categoría, asesor IA que recomienda.
3. **Decisión** — ficha con precio COP, sello de ferretería verificada, franja de confianza.
4. **Acción** — checkout de 4 campos O pedido directo por WhatsApp (doble ruta).
5. **Retención/cierre** — confirmación con número de pedido + enlace directo a WhatsApp.

## Pendientes que la auditoría NO puede arreglar sola

- TTFB de arranque frío (~3s): migrar a Neon/Postgres (pendiente técnico nº1).
- 81 productos sin foto (no existen en el archivo histórico): pedirlas a la ferretería.
- Precios de referencia de la tienda PLATIM: revisar por Farid.

## Para sostener la calidad (regla de proyecto sugerida)

Antes de dar por hecho un cambio de UI: abrir la página afectada, escribir en un
input, clicar la acción primaria, mirar 2 segundos el resultado, abrir una vista
relacionada y leer la consola (drill de 30 segundos).

---

*En la mano, el marketplace ya se siente como un objeto sólido: entra un
comprador con afán, ve fotos reales, entiende en 3 segundos qué es esto, y tiene
dos caminos cortos para soltar la plata — el formulario o el WhatsApp. Lo que
aún se siente "de demo" es la espera del arranque frío y los huecos de foto en
las páginas interiores; ambos tienen dueño en la lista de pendientes.*
