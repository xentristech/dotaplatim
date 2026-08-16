// Integración con SendPulse (embudos de captación). Sin dependencias: OAuth
// client_credentials + REST. Si no hay credenciales en el entorno, el embudo
// sigue funcionando (el lead queda en la base local) y esto devuelve false.
// Variables de entorno:
//   SENDPULSE_ID / SENDPULSE_SECRET        — API ID y Secret (SendPulse → Settings → API)
//   SENDPULSE_LIBRETA_DOTACION             — id de la libreta para leads de dotación
//   SENDPULSE_LIBRETA_FERRETERIA           — id de la libreta para ferreterías interesadas

let tokenCache = { valor: null, vence: 0 };

async function token() {
  const id = process.env.SENDPULSE_ID, secret = process.env.SENDPULSE_SECRET;
  if (!id || !secret) return null;
  if (tokenCache.valor && Date.now() < tokenCache.vence) return tokenCache.valor;
  try {
    const r = await fetch("https://api.sendpulse.com/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials",
                             client_id: id, client_secret: secret }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    tokenCache = { valor: j.access_token, vence: Date.now() + (j.expires_in - 60) * 1000 };
    return tokenCache.valor;
  } catch { return null; }
}

// Suma el contacto a la libreta del embudo con sus datos como variables.
export async function enviarLeadSendPulse(lead) {
  const t = await token();
  if (!t) return false;
  const libreta = lead.tipo === "ferreteria"
    ? process.env.SENDPULSE_LIBRETA_FERRETERIA
    : process.env.SENDPULSE_LIBRETA_DOTACION;
  if (!libreta) return false;
  try {
    const r = await fetch(`https://api.sendpulse.com/addressbooks/${libreta}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
      body: JSON.stringify({ emails: [{
        email: lead.correo,
        variables: {
          nombre: lead.nombre, telefono: lead.whatsapp,
          empresa: lead.empresa || "", ciudad: lead.ciudad || "",
          empleados: lead.empleados || "", origen: "embudo-" + lead.tipo,
        },
      }] }),
    });
    return r.ok;
  } catch { return false; }
}

// Diagnóstico de conexión (para el panel o pruebas).
export async function estadoSendPulse() {
  const t = await token();
  if (!t) return { conectado: false };
  try {
    const r = await fetch("https://api.sendpulse.com/addressbooks", {
      headers: { authorization: `Bearer ${t}` } });
    if (!r.ok) return { conectado: false };
    const libretas = await r.json();
    return { conectado: true,
             libretas: libretas.map(l => ({ id: l.id, nombre: l.name })) };
  } catch { return { conectado: false }; }
}
