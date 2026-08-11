"""Registra en la bitacora cada orden que se le da al agente (hook UserPromptSubmit).

Lo llama Claude Code solo, por el hook configurado en .claude/settings.json. Recibe por
stdin el JSON del hook ({session_id, prompt, cwd, ...}) y agrega una linea a
docs/bitacora/ordenes.jsonl.

REDACCION: el prompt puede traer secretos pegados por el usuario. Antes de escribir se
enmascara lo que parezca credencial. La bitacora esta en .gitignore igual, pero un log en
claro en disco tambien es un riesgo.

Nunca falla ruidosamente: si algo sale mal, sale con codigo 0 y no escribe nada, porque un
hook que rompe bloquea el envio del mensaje del usuario.
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
LOG = RAIZ / "docs" / "bitacora" / "ordenes.jsonl"

# Patrones de cosas que NO deben quedar en claro en el log.
SECRETOS = [
    # app password de Google: 16 letras, a veces en grupos de 4
    (re.compile(r"\b(?:[a-z]{4}[ -]?){3}[a-z]{4}\b"), "[APP-PASSWORD-REDACTADA]"),
    # prefijos conocidos de tokens de API; ampliar la lista cada vez que aparezca un
    # proveedor nuevo
    (re.compile(r"\b(sk-|pk_|rk_|ghp_|gho_|xox[abpr]-|bxt_|EAA)[A-Za-z0-9_\-]{10,}"),
     "[TOKEN-REDACTADO]"),
    (re.compile(r"\b\d{2}-\d{7}\b"), "[EIN-REDACTADO]"),
    (re.compile(r"(?i)\b(password|contrase[nñ]a|clave|secret|api[_ -]?key)\b\s*[:=]\s*\S+"),
     r"\1: [REDACTADO]"),
    # "la clave es soidsomos", "el password por ahora seria X" — sin dos puntos.
    # Sin esto se colaba: el filtro de arriba exige ':' o '='.
    (re.compile(r"(?i)\b(password|contrase[nñ]a|clave)\b[^.\n]{0,40}?\b(es|seria|será|sera)\b\s+\S+"),
     r"\1 \2 [REDACTADO]"),
]

LIMITE = 4000  # no guardar prompts gigantes; el transcript completo ya vive aparte


def limpiar(texto: str) -> str:
    for patron, reemplazo in SECRETOS:
        texto = patron.sub(reemplazo, texto)
    return texto[:LIMITE]


def main() -> None:
    datos = json.load(sys.stdin)
    prompt = datos.get("prompt") or ""
    if not prompt.strip():
        return

    LOG.parent.mkdir(parents=True, exist_ok=True)
    entrada = {
        "ts": datetime.now().astimezone().isoformat(timespec="seconds"),
        "tipo": "orden",
        "sesion": (datos.get("session_id") or "")[:8],
        "texto": limpiar(prompt),
    }
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entrada, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001 - un hook nunca debe tumbar el turno del usuario
        pass
    sys.exit(0)
