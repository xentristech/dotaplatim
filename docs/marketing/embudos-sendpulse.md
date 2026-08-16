# Embudos de captación — SendPulse (2026-08-15)

Decisión de Farid: **SendPulse** (no systeme.io). Directriz de marca: **paleta
gris/negro/blanco, SIN logos de PLATIM; la marca visible es XENTRIS** (wordmark).

## Arquitectura

La API de SendPulse no crea landing pages, así que el embudo vive en dos partes:

1. **Páginas de captura propias** (server-rendered en `src/rutas.js`, mismo dominio
   del marketplace):
   - `/cotizar-dotacion` — "La dotación de tus empleados, resuelta en una semana"
     (nombre, empresa, WhatsApp, nº empleados, correo → CTA "Recibir mi cotización gratis")
   - `/vincular-ferreteria` — "Tu ferretería vendiendo en internet, sin montar página web"
     (nombre, ferretería, ciudad, WhatsApp, correo → CTA "Quiero vincular mi ferretería")
   - Página de gracias embebida: botón "Adelantar por WhatsApp →" (302 366 0481) +
     enlace al catálogo.
2. **`POST /api/leads`**: valida, guarda en la tabla `leads` (respaldo local) y empuja
   el contacto a la libreta de SendPulse que corresponda (`src/sendpulse.js`, OAuth
   client_credentials, variables: nombre/telefono/empresa/ciudad/empleados/origen).
   Sin credenciales el embudo NO se cae: el lead queda en la base y `sendpulse: false`.
3. **Panel**: `GET /api/admin/leads` (últimos 200) y `GET /api/admin/sendpulse`
   (diagnóstico de conexión + libretas).

## Variables de entorno (local `.env` y Vercel → Settings → Environment Variables)

| Variable | Qué es |
|---|---|
| `SENDPULSE_ID` | API ID (SendPulse → Settings → API) |
| `SENDPULSE_SECRET` | API Secret |
| `SENDPULSE_LIBRETA_DOTACION` | id de la libreta para leads de dotación |
| `SENDPULSE_LIBRETA_FERRETERIA` | id de la libreta para ferreterías interesadas |

## En SendPulse (una vez conectado)

- Crear 2 libretas: "Leads dotación" y "Leads ferreterías" (puedo crearlas vía API
  y leer sus ids con `estadoSendPulse`).
- Automation360: bienvenida + seguimiento por libreta (se configura en SendPulse).

## Estado
- [x] Páginas de captura en producción (gris/negro/blanco, marca XENTRIS)
- [x] API de leads + respaldo local + push a SendPulse listo
- [ ] Credenciales API de SendPulse (Farid: Settings → API → ID y Secret)
- [ ] Libretas creadas y sus ids en las variables de entorno
- [ ] Automatizaciones de correo en Automation360
